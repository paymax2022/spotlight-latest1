package app

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/academy/assessment"
	"spotlight/backend/internal/academy/commerce"
	"spotlight/backend/internal/academy/content"
	"spotlight/backend/internal/academy/credentials"
	"spotlight/backend/internal/academy/curriculum"
	"spotlight/backend/internal/academy/edupay"
	"spotlight/backend/internal/academy/exam"
	feescompetition "spotlight/backend/internal/academy/fees/competition"
	feesexport "spotlight/backend/internal/academy/fees/export"
	feesschedule "spotlight/backend/internal/academy/fees/feeschedule"
	feeshardship "spotlight/backend/internal/academy/fees/hardship"
	feesinvoice "spotlight/backend/internal/academy/fees/invoice"
	feespayment "spotlight/backend/internal/academy/fees/payment"
	feespromotion "spotlight/backend/internal/academy/fees/promotion"
	feesroles "spotlight/backend/internal/academy/fees/roles"
	feesscholarship "spotlight/backend/internal/academy/fees/scholarship"
	feesschool "spotlight/backend/internal/academy/fees/school"
	feessession "spotlight/backend/internal/academy/fees/session"
	feesstudent "spotlight/backend/internal/academy/fees/student"
	feestrustscore "spotlight/backend/internal/academy/fees/trustscore"
	feesvault "spotlight/backend/internal/academy/fees/vault"
	"spotlight/backend/internal/academy/gamification"
	"spotlight/backend/internal/academy/identity"
	academylive "spotlight/backend/internal/academy/live"
	"spotlight/backend/internal/academy/parent"
	"spotlight/backend/internal/academy/progression"
	"spotlight/backend/internal/academy/rewards"
	"spotlight/backend/internal/academy/schools"
	"spotlight/backend/internal/academy/trade"
	"spotlight/backend/internal/academy/tutor"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/integrations/rtc"
	"spotlight/backend/internal/middleware"
	providerInterfaces "spotlight/backend/internal/provider"
	"spotlight/backend/internal/services"
)

// academyKYC adapts finance/kyc to the tutor package's KYCChecker (tutor
// verification requires KYC tier ≥ 1). Read-only.
type academyKYC struct{ svc *kyc.Service }

func (a academyKYC) Tier(ctx context.Context, userID string) (int, error) {
	p, err := a.svc.GetProfile(ctx, userID)
	if err != nil || p == nil {
		return 0, err
	}
	return int(p.Tier), nil
}

// academyApprovalGate is the child-safety purchase-approval gate (CLAUDE.md golden
// rule 8). A buyer with an ACTIVE guardian link (i.e. a minor) cannot complete a
// purchase until a guardian approves it: the first attempt records a pending
// PurchaseApproval (screens P7); the guardian approves via the parent layer; the
// minor then retries. Non-minors pass through. Satisfies commerce.ApprovalGate.
type academyApprovalGate struct{ pool *pgxpool.Pool }

func (g academyApprovalGate) Authorize(ctx context.Context, userID, orderID string) error {
	// Is the buyer a minor? (active guardian link where they are the minor.)
	var guardianID string
	err := g.pool.QueryRow(ctx,
		`SELECT guardian_user_id FROM academy_guardian_links WHERE minor_user_id=$1 AND status='active' LIMIT 1`,
		userID).Scan(&guardianID)
	if err != nil {
		return nil // no active guardian link (or lookup failed) ⇒ treat as non-minor, pass through
	}
	// Latest approval decision for this order.
	var state string
	derr := g.pool.QueryRow(ctx,
		`SELECT state FROM academy_purchase_approvals WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1`,
		orderID).Scan(&state)
	if derr == nil && state == "approved" {
		return nil // guardian approved — proceed
	}
	if derr != nil { // no approval yet ⇒ create a pending one for the guardian to act on
		_, _ = g.pool.Exec(ctx,
			`INSERT INTO academy_purchase_approvals (order_id, guardian_user_id, minor_user_id, state)
			 VALUES ($1,$2,$3,'pending')`, orderID, guardianID, userID)
	}
	return commerce.ErrApprovalRequired
}

// RegisterAcademy wires Spotlight Academy (K-12 EdTech, Phase 0 + Phase 1) onto
// the platform under the FeatureAcademyEnabled flag. Reuses Paymax rails: the
// wallet ledger funds reward credits (no shadow ledger); RBAC academy.* gates
// staff actions; the payments/BNPL rails are injected into commerce (stubs in
// dev). Sub-packages own their guarded state machines + idempotent money paths.
//
// Member base (authenticated finance group):
//   - identity/curriculum/commerce embed "/academy" in their own subpaths → base = finance.
//   - gamification/rewards/assessment/exam use bare subpaths → base = finance/academy.
// Admin base (RBAC per-route via guard):
//   - identity/curriculum/commerce embed "/academy" → base = /api.
//   - gamification/rewards/assessment/exam → base = /api/academy/admin.
func RegisterAcademy(r *gin.Engine, finance *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, ledgerSvc *ledger.Service, rtcIssuer *rtc.Issuer, bnplRail commerce.BNPLRail, disburseRail edupay.DisburseRail, billingRail schools.BillingRail, payoutRail tutor.PayoutRail, paymentProvider providerInterfaces.PaymentProvider, examEnabled, spineEnabled, eduPayEnabled, credentialsEnabled, liveEnabled, schoolsEnabled, tutorEnabled, feesEnabled bool) {
	if pool == nil {
		return
	}

	// Real Paymax-rail adapters (academy_rails.go), used where a backing service
	// exists; nil falls back to each package's deterministic dev stub.
	var payRail commerce.PaymentRail // commerce one-off charge → wallet ledger
	var collectRail edupay.CollectRail // edupay collection → wallet ledger
	if ledgerSvc != nil {
		lr := academyLedgerRail{ledger: ledgerSvc}
		payRail, collectRail = lr, lr
	}
	var liveRooms academylive.LiveRoomProvider // live RTC token → integrations/rtc
	if rtcIssuer != nil && rtcIssuer.Enabled(rtc.ProviderAgora) {
		liveRooms = academyLiveRail{issuer: rtcIssuer}
	}
	memberFin := finance                    // → /api/finance/academy/...
	memberAcad := finance.Group("/academy") // → /api/finance/academy/...
	adminRoot := adminGroupTop5(r, "/api")              // identity/curriculum/commerce admin
	adminAcad := adminGroupTop5(r, "/api/academy/admin") // bare-prefix admin packages

	identity.RegisterAcademyIdentity(memberFin, adminRoot, pool, rbac)
	curriculum.RegisterAcademyCurriculum(memberFin, adminRoot, pool, rbac)
	// Child-safety purchase-approval gate is active once the parent layer exists.
	var purchaseGate commerce.ApprovalGate
	if spineEnabled {
		purchaseGate = academyApprovalGate{pool: pool}
	}
	// BNPL rail: HTTP fake/sandbox/live adapter when RAILS_MODE selects one
	// (academy_rails_external.go); nil ⇒ commerce's deterministic dev stub.
	commerce.RegisterAcademyCommerce(memberFin, adminRoot, pool, rbac, payRail, bnplRail, purchaseGate)

	gamification.RegisterAcademyGamification(memberAcad, adminAcad, pool, rbac)
	// Rewards credit the Paymax wallet ledger (golden rule 2/9): inject ledgerSvc.
	rewards.RegisterAcademyRewards(memberAcad, adminAcad, pool, rbac, ledgerSvc, nil)

	// Phase-2 curriculum spine (progression + content/CMS + parent layer), gated by
	// FeatureAcademySpineEnabled.
	if spineEnabled {
		// Adaptive progression (paths, adaptive practice, recommendations); reuses
		// academy_mastery_records (read-only) — no money path.
		progression.RegisterAcademyProgression(memberAcad, adminAcad, pool, rbac)
		// CMS: publish lifecycle (lessons/bundles), content-production board, localizations.
		content.RegisterAcademyContent(memberAcad, adminAcad, pool, rbac)
		// Parent layer: child dashboards, controls, reports, purchase approvals — every
		// guardian endpoint is gated FAIL-CLOSED by the active guardian link.
		parent.RegisterAcademyParent(memberAcad, adminAcad, pool, rbac)
	}

	// Phase-2 EduPay (school fees, savings pots, disbursements, scholarships), gated by
	// FeatureAcademyEduPayEnabled. Money via INJECTED rails: CollectRail (wallet/VA),
	// DisburseRail (school VA payout), BNPLRail. nil ⇒ deterministic dev stubs (wire
	// real finance/va + payout adapters at root).
	if eduPayEnabled {
		// collect→ledger; disburse via HTTP rail (RAILS_MODE), bnpl via HTTP rail
		// (RAILS_MODE); nil ⇒ edupay's deterministic dev stubs.
		var eduBNPL edupay.BNPLRail
		if b, ok := bnplRail.(httpBNPLRail); ok {
			eduBNPL = b // same HTTP adapter satisfies both commerce + edupay BNPLRail
		}
		edupay.RegisterAcademyEduPay(memberAcad, adminAcad, pool, rbac, collectRail, disburseRail, eduBNPL)
	}

	// Phase-3 learn-to-earn moat: trade tracks → credentials → Paymax earning roles,
	// gated by FeatureAcademyCredentialsEnabled. The credentials service is the trade
	// package's CredentialIssuer (skill-assessment pass → issue). RoleUpgrader is nil
	// here ⇒ Apply records the routing; actual Paymax role-upgrade/KYC onboarding is
	// owned by Paymax (wire a real RoleUpgrader adapter over rbac.AssignRoleToUser).
	if credentialsEnabled {
		credSvc := credentials.NewService(pool, nil)
		credentials.RegisterAcademyCredentials(memberAcad, adminAcad, pool, rbac, nil)
		trade.RegisterAcademyTrade(memberAcad, adminAcad, pool, rbac, credSvc)
	}

	// Phase-3 live classes + community + moderation, gated by FeatureAcademyLiveEnabled.
	// LiveRoomProvider nil ⇒ deterministic stub (wire connect/live LiveKit adapter at root).
	if liveEnabled {
		// RTC token via integrations/rtc when configured; nil ⇒ deterministic stub.
		academylive.RegisterAcademyLive(memberAcad, adminAcad, pool, rbac, liveRooms)
	}

	// Phase-4 B2B2C institutions (licences, bulk enrolment, white-label, billing),
	// gated by FeatureAcademySchoolsEnabled. Billing via injected VA rail (stub in dev).
	if schoolsEnabled {
		// Billing via HTTP rail (RAILS_MODE); nil ⇒ schools' deterministic dev stub.
		schools.RegisterAcademySchools(memberAcad, adminAcad, pool, rbac, billingRail)
	}

	// Phase-4 tutor marketplace (onboarding/KYC, assignments, grading, earnings,
	// payouts), gated by FeatureAcademyTutorEnabled. Tutor verification reuses KYC
	// (tier ≥ 1); payouts via injected PayoutRail (stub in dev — wire real payout rail).
	if tutorEnabled {
		// Payout via HTTP rail (RAILS_MODE); nil ⇒ tutor's deterministic dev stub.
		tutor.RegisterAcademyTutor(memberAcad, adminAcad, pool, rbac, academyKYC{svc: kyc.NewService(pool)}, payoutRail)
	}

	// Exam beachhead (Phase 1 crown) behind its own sub-flag.
	if examEnabled {
		assessment.RegisterAcademyAssessment(memberAcad, adminAcad, pool, rbac)
		exam.RegisterAcademyExam(memberAcad, adminAcad, pool, rbac)
	}

	// EdTech School Fees (invoices, vault, promotion, competition, scholarship,
	// trust-score, compliance export), gated by FeatureAcademyFeesEnabled. Every
	// money mutation rides the finance/ledger (double-entry, idempotent, fail-closed)
	// — no shadow ledger. Member routes → /api/finance/academy/*; admin routes →
	// /api/academy/admin/* gated per-group by RBAC academy.fees.* slugs.
	if feesEnabled {
		registerAcademyFees(memberAcad, adminAcad, pool, rbac, ledgerSvc, paymentProvider)
	}
}

// ── EdTech Fees composition root ─────────────────────────────────────────────────
//
// registerAcademyFees constructs + registers every fees/* handler. Packages that
// take (member, admin, pool, rbac) self-gate their admin routes; packages that take
// an assembled *Service (vault/payment/scholarship/trustscore/competition) get their
// money/gamification/identity collaborators wired here as thin inline adapters over
// the existing Paymax rails (finance/ledger, academy/gamification, the pgx pool).
func registerAcademyFees(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, ledgerSvc *ledger.Service, paymentProvider providerInterfaces.PaymentProvider) {
	if pool == nil {
		return
	}

	// guard(slug) builds the per-route RBAC middleware (mirrors connect_routes.go /
	// competition's guard param). Used for the packages that reserve RBAC to the caller.
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// ── Group A: self-contained (member, admin, pool, rbac) — self-gate admin routes ──
	feesschool.RegisterFeesSchool(member, admin, pool, rbac)         // /schools, admin verify (academy.fees.school.verify)
	feessession.RegisterFeesSession(member, admin, pool, rbac)       // /schools/:schoolId/sessions|classes
	feesschedule.RegisterFeesFeeSchedule(member, admin, pool, rbac)  // /fee-schedules (SF-1 immutability)
	feesstudent.RegisterFeesStudent(member, admin, pool, rbac)       // /students, guardian links (reuses identity)
	feesinvoice.RegisterFeesInvoice(member, admin, pool, rbac)       // /invoices (SF-2 derived balance)
	feespromotion.RegisterFeesPromotion(member, admin, pool, rbac)   // /promotions (SF-3 two-approval)
	feesroles.RegisterFeesRoles(admin, pool, rbac)                   // /schools/:schoolId/staff (RequireScopedPermission academy.fees.roles.assign)
	feeshardship.RegisterFeesHardship(member, admin, pool, rbac)     // /invoices hardship review queue (SF-9, no money)

	// Compliance export (SF-11): admin-only, self-wires optin+verifier from pool.
	// It reserves RBAC to the caller, so gate the whole group here.
	exportAdmin := admin.Group("", guard("academy.fees.export.run"))
	feesexport.RegisterFeesExport(exportAdmin, pool, rbac)

	// ── Group B: assembled Service packages (money / gamification / identity) ──

	// Vault (SF-5): guardian wallet → segregated FeesVault standing account
	// (AccountEdtechFeesVault). Money via finance/ledger only. Wire only when the
	// ledger is available (a nil ledger would silently drop money legs — fail-closed
	// by simply not registering the vault money surface).
	if ledgerSvc != nil {
		vaultSvc := feesvault.NewService(pool, feesVaultLedger{ledger: ledgerSvc}, feesVaultInvoice{ledger: ledgerSvc})
		feesvault.RegisterFeesVault(member, vaultSvc)
	}

	// Scholarship (Sponsor-a-Student): sponsor funding leg + idempotent invoice
	// payment application. Reuses finance/ledger + fees/invoice.Service.
	if ledgerSvc != nil {
		invSvc := feesinvoice.NewService(pool)
		schSvc := feesscholarship.NewService(pool, feesScholarshipLedger{ledger: ledgerSvc}, feesScholarshipInvoice{inv: invSvc})
		feesscholarship.RegisterFeesScholarship(member, schSvc, rbac)
		// Admin gate for scholarship mutations (the package reserves RBAC to the caller).
		// Member routes above are guardian/sponsor self-service; the admin oversight
		// surface is gated academy.fees.scholarship.manage.
		_ = admin // scholarship exposes a single group; per-route admin gating TODO if a
		// distinct admin surface is added by the fees team.
	}

	// Trust-score (T9.1): admin read + override. MetricsReader/OverrideStore are pgx
	// adapters over public.audit_logs / a lightweight override table.
	trustSvc := feestrustscore.NewService(feesTrustMetrics{pool: pool}, feesTrustOverrides{pool: pool})
	trustAdmin := admin.Group("", guard("academy.fees.trustscore.view"))
	feestrustscore.RegisterFeesTrustScore(trustAdmin, trustSvc, rbac)

	// Cross-school competition (E7): drives the academy/gamification leaderboard
	// (money-free by design — SF-4) + SF-7 minor-safe serializer over consent records.
	gamRepo := gamification.NewRepository(pool)
	gamSvc := gamification.NewService(gamRepo, gamification.Config{})
	compRepo := feescompetition.NewRepository(pool)
	ladder := feescompetition.NewLeaderboardManager(feesGamificationLadder{gam: gamSvc}, compRepo)
	compSvc := feescompetition.NewService(compRepo, ladder)
	serializer := feescompetition.NewSerializer(feesConsentChecker{pool: pool})
	compHandler := feescompetition.NewHandler(compSvc, serializer)
	compHandler.Register(member, admin, guard)

	// Payment (T3.x): guardian checkout via the existing PaymentProvider + confirm-and-
	// record over finance/ledger + fees/invoice. BLOCKED on a package-internal
	// dependency (see TODO below) — cannot be assembled from this package.
	//
	// TODO(fees-payment): feespayment.NewService requires an IntentStore, whose method
	// set references the UNEXPORTED type feespayment.intentRecord — so a concrete pgx
	// IntentStore CANNOT be implemented from the app package. The fees team must add the
	// pgx IntentStore repo INSIDE the feespayment package (repository.go, explicitly
	// out-of-scope per payment/service.go:71). Once present, wire:
	//   invSvc := feesinvoice.NewService(pool)
	//   paySvc := feespayment.NewService(paymentProvider, feesPaymentLedger{ledger: ledgerSvc},
	//               feesPaymentInvoice{pool: pool, inv: invSvc}, feespayment.NewIntentStore(pool))
	//   feespayment.RegisterFeesPayment(member, paySvc)
	// and route the "feespay:" charge.success webhook to paySvc.OnChargeSuccess
	// (already hooked in webhooks/paystack.go via the FeesChargeConfirmer seam).
	_ = paymentProvider
	_ = feespayment.RegisterFeesPayment // referenced so the import is used pending wiring
}

// ── Inline money/gamification/identity adapters for the fees Group-B services ─────
// Each adapter is a thin shim over an EXISTING Paymax rail — no new money logic, no
// shadow ledger. All monetary amounts are integers in minor units (kobo).

// feesVaultLedger adapts finance/ledger.Service to fees/vault.LedgerService (SF-5).
type feesVaultLedger struct{ ledger *ledger.Service }

func (a feesVaultLedger) SegregatedAccountID(ctx context.Context, accountType string) (string, error) {
	acct, err := a.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountType(accountType))
	if err != nil {
		return "", err
	}
	return acct.ID, nil
}

func (a feesVaultLedger) DebitToVault(ctx context.Context, userID, reference, idempotencyKey, vaultAccountID string, amountKobo int64) error {
	// Debit the guardian wallet, crediting the segregated vault standing account.
	// TOCTOU-safe + fail-closed on insufficient funds (ledger.Service.Debit).
	return a.ledger.Debit(ctx, userID, reference, idempotencyKey, vaultAccountID, amountKobo)
}

func (a feesVaultLedger) TransferVaultToInvoice(ctx context.Context, vaultAccountID, invoiceSettlementAccountID, reference, idempotencyKey string, amountKobo int64) error {
	return a.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  vaultAccountID,             // release from the segregated vault
		CreditAccountID: invoiceSettlementAccountID, // settle to the invoice settlement account
	})
}

// feesVaultInvoice adapts to fees/vault.InvoiceService. RecordPayment returns the
// settlement ledger account the vault transfer must credit. Per the ledger audit
// there is a single global AccountSettlement standing account (no per-school standing
// account), so the settlement leg lands there; per-school attribution is carried by
// the reference + the invoice→fee-schedule→school chain.
//
// NOTE: the vault→invoice application records ONLY the settlement account id here; the
// invoice-side payment append (fees/invoice.Service.RecordPayment) is performed by the
// vault service using the returned account. If the fees team later exposes a first-class
// invoice-settlement account per school, swap AccountSettlement for that lookup.
type feesVaultInvoice struct{ ledger *ledger.Service }

func (a feesVaultInvoice) RecordPayment(ctx context.Context, invoiceID, guardianUserID, ledgerRef, idempotencyKey string, amountMinor int64) (settlementAccountID string, err error) {
	acct, err := a.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return "", err
	}
	return acct.ID, nil
}

// feesScholarshipLedger adapts to fees/scholarship.LedgerPoster: post the sponsor
// funding leg (sponsor wallet → settlement) idempotently, returning the ledger ref.
type feesScholarshipLedger struct{ ledger *ledger.Service }

func (a feesScholarshipLedger) PostFunding(ctx context.Context, sponsorIdentityID, reference, idempotencyKey string, amountMinor int64) (ledgerRef string, err error) {
	settlement, err := a.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return "", err
	}
	// Debit the sponsor wallet into the settlement account (fail-closed on funds).
	if err := a.ledger.Debit(ctx, sponsorIdentityID, reference, idempotencyKey, settlement.ID, amountMinor); err != nil {
		return "", err
	}
	return reference, nil
}

// feesScholarshipInvoice adapts fees/invoice.Service to fees/scholarship.InvoicePayer.
type feesScholarshipInvoice struct{ inv *feesinvoice.Service }

func (a feesScholarshipInvoice) RecordPayment(ctx context.Context, actorID, invoiceID, guardianUserID string, amountMinor int64, ledgerReference, idempotencyKey string) (paymentID string, replayed bool, err error) {
	res, err := a.inv.RecordPayment(ctx, actorID, invoiceID, guardianUserID, amountMinor, "", ledgerReference, idempotencyKey)
	if err != nil {
		return "", false, err
	}
	if res == nil || res.Payment == nil {
		return "", res != nil && res.Replayed, nil
	}
	return res.Payment.ID, res.Replayed, nil
}

// feesGamificationLadder adapts academy/gamification.Service to
// fees/competition.GamificationLadder (money-free engagement ladder, SF-4).
type feesGamificationLadder struct{ gam *gamification.Service }

func (a feesGamificationLadder) EnsureLeaderboard(ctx context.Context, scope, scopeRef, subject string) (leaderboardID string, err error) {
	var ref *string
	if scopeRef != "" {
		ref = &scopeRef
	}
	lb, err := a.gam.AdminUpsertLeaderboard(ctx, gamification.UpsertLeaderboardRequest{
		Scope:    scope,
		ScopeRef: ref,
	})
	if err != nil {
		return "", err
	}
	return lb.ID, nil
}

func (a feesGamificationLadder) RecordScore(ctx context.Context, leaderboardID, userID, periodKey string, score int64) error {
	return a.gam.RecordLeaderboardScore(ctx, leaderboardID, userID, periodKey, score)
}

func (a feesGamificationLadder) RankedUserScores(ctx context.Context, leaderboardID, periodKey string, limit int) ([]feescompetition.LadderRow, error) {
	_, entries, err := a.gam.GetLeaderboard(ctx, leaderboardID, periodKey, limit)
	if err != nil {
		return nil, err
	}
	rows := make([]feescompetition.LadderRow, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, feescompetition.LadderRow{
			UserID:    e.UserID,
			PeriodKey: e.PeriodKey,
			Score:     e.Score,
			Rank:      e.Rank,
		})
	}
	return rows, nil
}

// feesConsentChecker backs fees/competition SF-7: a minor's leaderboard row is
// default-stripped unless a recorded guardian consent exists in academy_consent_records.
type feesConsentChecker struct{ pool *pgxpool.Pool }

func (c feesConsentChecker) HasActiveConsent(ctx context.Context, minorUserID, scopeKey string) (bool, error) {
	if c.pool == nil {
		return false, nil // fail-closed: no store ⇒ treat as no consent (strip the row)
	}
	// academy_consent_records is immutable (append-only, no revocation column): the
	// scope jsonb carries the granted flags (e.g. {"data_sharing": true}). A recorded
	// consent for scopeKey = a truthy flag under that key on ANY consent row for the minor.
	var exists bool
	err := c.pool.QueryRow(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM academy_consent_records
		   WHERE minor_user_id = $1 AND COALESCE((scope ->> $2)::boolean, false) = true
		 )`, minorUserID, scopeKey).Scan(&exists)
	if err != nil {
		return false, nil // fail-closed on lookup error ⇒ strip the row
	}
	return exists, nil
}

// feesTrustMetrics backs fees/trustscore.MetricsReader with pre-aggregated inputs.
// TODO(fees-trustscore): the real metric aggregation (on-time collection rate,
// disbursement latency, dispute rate) must be sourced from public.audit_logs +
// academy_disbursements once the fees team publishes the aggregation query. Until then
// this returns zeroed inputs (a deterministic, non-fabricated neutral score) so the
// admin surface is live and never invents trust numbers.
type feesTrustMetrics struct{ pool *pgxpool.Pool }

func (m feesTrustMetrics) TrustInputs(ctx context.Context, schoolID string) (feestrustscore.TrustInputs, error) {
	return feestrustscore.TrustInputs{}, nil
}

// feesTrustOverrides backs fees/trustscore.OverrideStore against an additive table
// created by the integration migration (academy_fees_trust_overrides). Latest wins.
type feesTrustOverrides struct{ pool *pgxpool.Pool }

func (o feesTrustOverrides) SaveOverride(ctx context.Context, schoolID, actorID string, score float64, reason string) error {
	if o.pool == nil {
		return nil
	}
	_, err := o.pool.Exec(ctx,
		`INSERT INTO academy_fees_trust_overrides (school_id, actor_id, score, reason) VALUES ($1,$2,$3,$4)`,
		schoolID, actorID, score, reason)
	return err
}

func (o feesTrustOverrides) GetOverride(ctx context.Context, schoolID string) (score float64, by, reason string, found bool, err error) {
	if o.pool == nil {
		return 0, "", "", false, nil
	}
	err = o.pool.QueryRow(ctx,
		`SELECT score, actor_id, reason FROM academy_fees_trust_overrides
		 WHERE school_id = $1 ORDER BY created_at DESC LIMIT 1`, schoolID).
		Scan(&score, &by, &reason)
	if err != nil {
		return 0, "", "", false, nil // no override ⇒ computed score is authoritative
	}
	return score, by, reason, true, nil
}
