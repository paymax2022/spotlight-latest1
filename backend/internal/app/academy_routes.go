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
func RegisterAcademy(r *gin.Engine, finance *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, ledgerSvc *ledger.Service, rtcIssuer *rtc.Issuer, bnplRail commerce.BNPLRail, disburseRail edupay.DisburseRail, billingRail schools.BillingRail, payoutRail tutor.PayoutRail, examEnabled, spineEnabled, eduPayEnabled, credentialsEnabled, liveEnabled, schoolsEnabled, tutorEnabled bool) {
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
}
