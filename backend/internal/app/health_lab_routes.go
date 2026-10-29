package app

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/crypto"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	healthconsent "spotlight/backend/internal/health/consent"
	healthlab "spotlight/backend/internal/health/lab"
	healthrecords "spotlight/backend/internal/health/records"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/transport"
)

// RegisterHealthLab wires HEALTH-BUILD Phase-2 Laboratory onto the finance member
// group + a health lab admin group. It is the ONLY wiring point for the lab
// vertical and edits no existing file. All reuse is by import:
//   - escrow.Service         — HL-9 payment HELD→RELEASE→REFUND (idempotent).
//   - transport.Service      — phlebotomist dispatch + results courier (last-mile rail).
//   - healthrecords.Service  — HL-8 result release → consent-gated, signed-URL vault.
//   - finance/kyc.Service    — HL-10 payout KYC gating.
//   - member: /api/finance/health/lab/*  (member-authenticated; user_id mirrored)
//   - admin : /api/health/lab/admin/*    (per-route RBAC health.lab.*)
//
// Gated by FeatureHealthLabEnabled at the orchestrator. Auditing is nil-safe.
func RegisterHealthLab(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit services.AuditService, cfg config.Config, supabase *integrations.SupabaseRestClient) {
	if pool == nil {
		log.Println("[health.lab] nil pool — skipping lab routes")
		return
	}

	// Reuse rails (by import, never copy).
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	escrowSvc := escrow.NewService(pool, ledgerSvc, nil)
	// transport.Service needs a real settlement instance for its own escrow
	// (phlebotomist dispatch payout) — a nil settlement service isn't a
	// no-op, it's a nil pointer BookParcel dereferences unconditionally.
	// Identical bug to PHARMACY-004: any home-collection Schedule call would
	// panic (500) inside settlement.Service.Escrow. Mirrors the pharmacy fix
	// and finance_routes.go's own transport.NewService wiring.
	transportSvc := transport.NewService(pool, settlement.NewService(pool, ledgerSvc))
	kycSvc := kyc.NewService(pool)
	recordsSvc := healthrecords.NewService(pool, nil, nil, nil)

	svc := healthlab.NewService(
		pool,
		&labEscrowAdapter{e: escrowSvc},
		&labDispatchAdapter{t: transportSvc},
		&labProviderGateAdapter{db: pool},
		&labPayoutGateAdapter{kyc: kycSvc},
		&labNotifierAdapter{db: pool},
		&labVaultAdapter{r: recordsSvc},
		audit, // real immutable-audit sink injected by orchestrator (HL-12) — nil-safe
	)

	// Results vault sharing: consent via the shared consent module (HL-8), and
	// signed report URLs via a records service that carries the R2 signer. An
	// unconfigured R2 leaves signed URLs unavailable (503) — never a fabricated URL.
	consentSvc := healthconsent.NewService(pool, nil)
	vaultReadSvc := healthrecords.NewService(pool, consentSvc, labReportSigner{p: r2.New(r2.Config{
		AccountEndpoint: cfg.R2AccountEndpoint,
		Bucket:          cfg.R2Bucket,
		AccessKeyID:     cfg.R2AccessKeyID,
		SecretAccessKey: cfg.R2SecretAccessKey,
		Region:          cfg.R2Region,
	})}, nil)
	svc.SetResultSharing(&labConsentAdapter{c: consentSvc}, &labVaultReaderAdapter{r: vaultReadSvc})
	svc.SetEarningsReader(&labEarningsReader{l: ledgerSvc})

	// Central Commission & Profit recording at the lab order settlement point
	// (Release → escrow release). Best-effort + idempotent + nil-safe: constructed
	// with a nil ledger so the earning row is appended WITHOUT re-posting to the
	// ledger (lab's own escrow split already posts the platform cut). Reuses the
	// shared commissionRecorderAdapter (marketplace_routes.go). Gated on the flag ⇒
	// off leaves the recorder nil ⇒ silent no-op.
	if cfg.FeatureCommissionEnabled {
		svc.SetCommissionRecorder(commissionRecorderAdapter{svc: withReferralSplit(commission.NewService(commission.NewRepository(pool), nil), pool, cfg)})
	}

	// Crypto payment (Phase 2 Task 5.1): sell a holding into the wallet, then the
	// normal escrow HOLD. Double-gated; flag off ⇒ the payer stays nil ⇒ 503.
	if cfg.FeatureHealthLabCryptoPayment && cfg.FeatureCryptoEnabled {
		cryptoPrice, _, _ := crypto.ProvidersFromConfig(crypto.ProviderConfig{
			Provider:    cfg.CryptoProvider,
			Live:        cfg.IsProd(),
			TestKey:     cfg.CryptoQuidaxTestKey,
			TestBaseURL: cfg.CryptoQuidaxTestBaseURL,
			LiveKey:     cfg.CryptoQuidaxLiveKey,
			LiveBaseURL: cfg.CryptoQuidaxLiveBaseURL,
		})
		svc.SetCryptoPayer(labCryptoAdapter{c: crypto.NewService(pool, ledgerSvc, cryptoPrice)})
	}

	isAdmin := func(c *gin.Context) bool { return isHealthLabAdmin(c, rbac) }
	h := healthlab.NewHandler(svc, isAdmin)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	lg := member.Group("/health/lab")
	lg.GET("/tests", h.ListTests)                    // catalog: prep, TAT, price
	lg.POST("/tests", h.UpsertTest)                  // lab owner, HL-2 catalog governance
	lg.GET("/packages", h.ListPackages)              // bundle catalog, same shape as ListTests
	lg.GET("/tests/:id", h.GetTest)                  // one active test (detail screen)
	lg.GET("/packages/:id", h.GetPackage)            // one active package
	lg.GET("/labs", h.ListLabs)                      // discoverable MLSCN labs, nearest-first with lat/lng (HL-2)
	lg.GET("/labs/:id", h.GetLab)
	lg.GET("/labs/:id/reviews", h.ListLabReviews)
	lg.GET("/results", h.ListResults)                // my released/escalated results (no values)
	lg.GET("/results/shared", h.SharedResults)       // results others shared with me (HL-8 consent)
	lg.GET("/results/:id", h.GetResult)              // detail: owner after acknowledgement, or consented grantee
	lg.POST("/results/:id/consent", h.AcknowledgeResult)
	lg.POST("/results/:id/share", h.ShareResult)     // grants LAB_RESULTS via the shared consent module
	lg.GET("/results/:id/signed-url", h.ResultSignedURL)
	lg.GET("/phlebotomist/assignments", h.ListAssignments)             // my route: assigned + unassigned pool of labs I staff
	lg.POST("/phlebotomist/assignments/:id/status", h.SetCollectionStatus) // en_route | arrived (+ optional position)
	lg.GET("/phlebotomist/assignments/:id/checklist", h.GetChecklist)
	lg.POST("/phlebotomist/assignments/:id/custody", h.LogCustody)     // bedside scan: collects + opens chain of custody (HL-6)
	lg.POST("/phlebotomist/assignments/:id/drop-off", h.DropOff)       // custody to the lab's accession desk
	lg.GET("/orders/:id/phlebotomist", h.OrderPhlebotomist)            // patient/lab: who is collecting
	lg.GET("/provider/earnings", h.ProviderEarnings) // lab owner: read-only; withdrawals use the wallet bank-transfer corridor
	lg.GET("/provider/reviews", h.ProviderReviews)
	lg.POST("/reviews", h.SubmitReview)              // verified-purchase review (released order, once)
	lg.GET("/provider/orders", h.ListProviderOrders) // lab staff order list (owner-scoped, HL-2)
	lg.POST("/staff", h.UpsertStaff)                 // lab owner registers/suspends staff (HL-2 affiliation, ADR-PR641)
	lg.POST("/orders/quote", middleware.PerUserRateLimit(nil, "health-lab-quote", 30), h.QuoteOrder) // server price: tests + packages + home fee (what CreateOrder will hold); rate-limited per user
	lg.POST("/orders/crypto-quote", h.QuoteCryptoPayment)                                          // price the order in a crypto asset (read-only)
	lg.POST("/orders/pay-crypto", h.PayWithCrypto)                                                 // sell holding -> wallet -> escrow HELD; Idempotency-Key required
	lg.POST("/orders", h.CreateOrder)                                                              // patient, payment HELD (HL-9)
	lg.GET("/orders", h.ListMyOrders)                // patient's own order history + active-order card
	lg.GET("/orders/:id", h.Get)                     // object-level authZ
	lg.GET("/orders/:id/results", h.Results)         // object-level authZ (HL-8)
	lg.GET("/orders/:id/custody", h.Custody)         // chain-of-custody trail (HL-6/12)
	lg.POST("/orders/:id/schedule", h.Schedule)      // phlebotomist dispatch (HOME)
	lg.POST("/orders/:id/collect", h.Collect)
	lg.POST("/orders/:id/results", h.EnterResults) // scientist enter + validate (HL-7)
	lg.POST("/orders/:id/release", h.Release)      // sign-off → vault; release payment (HL-7/8/9)
	lg.POST("/orders/:id/cancel", h.Cancel)        // pre-collection → refund (HL-9)
	lg.POST("/samples/:id/accession", h.Accession) // lab intake, HL-6 chain gate
	lg.POST("/samples/:id/handover", h.Handover)   // custody transfer (HL-6)
	lg.POST("/samples/:id/breach", h.FlagBreach)   // chain break → recollect (HL-6)

	ag := admin.Group("")
	// Identical bug to PHARMACY-006: `admin` here is adminGroupTop5
	// (top5_admin_group.go), which applies ONLY requireUserID() — a guard
	// that checks ginutil.UserID(c) with nothing upstream of it ever
	// setting that context key. Every lab admin route (old and new) 401'd
	// "authentication required" regardless of token validity. Fixed the same
	// way pharmacy was: the caller (finance_routes.go) now passes a plain
	// r.Group(...) instead of adminGroupTop5, and RequireAuthContext runs
	// here as this group's own first middleware.
	ag.Use(middleware.RequireAuthContext(supabase, rbac))
	// Dashboard is an extension of the SAME admin-oversight surface /orders
	// already sits behind — reusing health.lab.orders rather than minting a
	// new permission slug (mirrors pharmacy's PHARMACY-001 dashboard route).
	ag.GET("/dashboard", guard("health.lab.orders"), h.AdminDashboard)                   // platform-wide KPI aggregate
	ag.GET("/orders", guard("health.lab.orders"), h.AdminListOrders)                     // order/results oversight
	ag.GET("/custody-audit", guard("health.lab.custody"), h.AdminCustodyAudit)           // chain-of-custody oversight (HL-6)
	ag.GET("/escalations", guard("health.lab.escalation"), h.AdminEscalations)           // critical-result escalation (HL-7)
	ag.POST("/tests/:id/deactivate", guard("health.lab.catalog"), h.AdminDeactivateTest) // catalog governance

	log.Println("[health.lab] lab routes registered — tests/orders/collect/accession/results/release + custody + provider orders + admin")
}

// isHealthLabAdmin reports whether the caller holds the lab admin order-oversight
// permission (drives admin-basis order/result reads).
func isHealthLabAdmin(c *gin.Context, rbac services.RBACService) bool {
	if rbac == nil {
		return false
	}
	uid := ginutil.UserID(c)
	if uid == "" {
		return false
	}
	ok, err := rbac.CheckPermission(uid, "health.lab.orders", "global", "")
	return err == nil && ok
}

type labEscrowAdapter struct{ e *escrow.Service }

type labHoldRef struct{ id string }

func (h labHoldRef) HoldID() string { return h.id }

func (a *labEscrowAdapter) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (healthlab.HoldRef, error) {
	hold, err := a.e.Hold(ctx, payerID, reference, moduleType, idemKey, amountKobo)
	if err != nil {
		return nil, err
	}
	return labHoldRef{id: hold.ID}, nil
}
func (a *labEscrowAdapter) Release(ctx context.Context, escrowID, payeeID string) error {
	return a.e.Release(ctx, escrowID, payeeID)
}
func (a *labEscrowAdapter) Refund(ctx context.Context, escrowID string) error {
	return a.e.Refund(ctx, escrowID)
}
func (a *labEscrowAdapter) RefundIf(ctx context.Context, escrowID string, guard func(context.Context, pgx.Tx) error) error {
	return a.e.RefundIf(ctx, escrowID, guard)
}

// labDispatchAdapter books a phlebotomist dispatch / results courier as a parcel
// job on the transport last-mile rail (REUSE — no routing rebuild). The returned
// reference is the parcel id tracked by the transport module.
type labDispatchAdapter struct{ t *transport.Service }

func (a *labDispatchAdapter) CreateDelivery(ctx context.Context, senderID, reference, idemKey string) (string, error) {
	req := transport.ParcelBookRequest{
		Pickup:         transport.Place{Lat: 0, Lng: 0, Address: "patient"},
		Dropoff:        transport.Place{Lat: 0, Lng: 0, Address: "lab"},
		ReceiverName:   "lab",
		ReceiverPhone:  "n/a",
		Category:       "small",
		Size:           "small",
		Speed:          "standard",
		ProhibitedAck:  true,
		IdempotencyKey: idemKey,
	}
	out, err := a.t.BookParcel(ctx, senderID, req, idemKey)
	if err != nil {
		return "", err
	}
	if id, ok := out["id"].(string); ok {
		return id, nil
	}
	return reference, nil
}

// labProviderGateAdapter enforces HL-2 against health_providers (parameterised).
// A lab, scientist and phlebotomist are each an APPROVED health_providers
// capability row; the scientist/phlebotomist checks confirm the actor holds a
// verified capability (credential-gated supply) before performing a clinical step.
type labProviderGateAdapter struct{ db *pgxpool.Pool }

func (a *labProviderGateAdapter) IsApprovedLab(ctx context.Context, providerID string) (bool, error) {
	var ok bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM health_providers
		WHERE id=$1 AND domain='LAB' AND provider_type='lab' AND status='APPROVED')`
	if err := a.db.QueryRow(ctx, q, providerID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}
func (a *labProviderGateAdapter) VerifiedLabOwner(ctx context.Context, userID, providerID string) (bool, error) {
	var ok bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM health_providers
		WHERE id=$1 AND owner_user_id=$2 AND domain='LAB' AND provider_type='lab' AND status='APPROVED')`
	if err := a.db.QueryRow(ctx, q, providerID, userID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// IsVerifiedScientist / IsVerifiedPhlebotomist answer "is userID verified staff
// OF providerID": the lab's verified owner, or an ACTIVE lab_staff affiliation
// with the matching role (ADR-PR641). The single-identity capability model
// (a lab_scientist/phlebotomist health_providers row owned by the credential
// holder) names no employing lab, so the affiliation table — granted by the
// lab's owner — is the only non-owner answer. Fail closed on any read error.
func (a *labProviderGateAdapter) IsVerifiedScientist(ctx context.Context, userID, providerID string) (bool, error) {
	return a.staffOrOwner(ctx, userID, providerID, "scientist")
}
func (a *labProviderGateAdapter) IsVerifiedPhlebotomist(ctx context.Context, userID, providerID string) (bool, error) {
	return a.staffOrOwner(ctx, userID, providerID, "phlebotomist")
}
func (a *labProviderGateAdapter) staffOrOwner(ctx context.Context, userID, providerID, role string) (bool, error) {
	var ok bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM health_providers
		WHERE id=$1 AND owner_user_id=$2 AND domain='LAB' AND provider_type='lab' AND status='APPROVED')
		OR EXISTS (
		SELECT 1 FROM lab_staff
		WHERE lab_provider_id=$1 AND user_id=$2 AND status='ACTIVE' AND role=$3)`
	if err := a.db.QueryRow(ctx, q, providerID, userID, role).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// labPayoutGateAdapter enforces HL-10: the lab owner must hold a KYC tier >= 1
// before a settlement is released.
type labPayoutGateAdapter struct{ kyc *kyc.Service }

func (a *labPayoutGateAdapter) PayoutEligible(ctx context.Context, ownerUserID string) (bool, error) {
	p, err := a.kyc.GetProfile(ctx, ownerUserID)
	if err != nil {
		return false, nil // fail-closed: no verifiable profile → not eligible
	}
	return int(p.Tier) >= 1, nil
}

// labNotifierAdapter is the HL-7 human-escalation channel. It records a durable
// escalation notification row addressed to the patient + the ordering clinician so
// a critical result is never a silent in-app flag. (When the full notifications
// service is injected by the orchestrator this adapter is swapped for it; the
// table write here guarantees the escalation is recorded.)
type labNotifierAdapter struct{ db *pgxpool.Pool }

func (a *labNotifierAdapter) NotifyCriticalResult(ctx context.Context, patientID, orderID, status string) error {
	const ins = `
		INSERT INTO lab_critical_notifications (id, order_id, patient_id, status)
		VALUES (gen_random_uuid(), $1, $2, $3)`
	_, err := a.db.Exec(ctx, ins, orderID, patientID, status)
	return err
}

// labVaultAdapter bridges the records vault for result release (HL-8). It creates a
// consent-gated, access-logged LAB_RESULT record under the patient and returns the
// new record id which is pinned onto the order.
type labVaultAdapter struct{ r *healthrecords.Service }

func (a *labVaultAdapter) Create(ctx context.Context, ownerID, createdBy, subjectType, recordType, title, body string, petRef *string) (string, error) {
	rec, err := a.r.Create(ctx, ownerID, createdBy, subjectType, recordType, title, body, petRef)
	if err != nil {
		return "", err
	}
	return rec.ID, nil
}

// labConsentAdapter bridges the shared consent module for lab result sharing.
type labConsentAdapter struct{ c *healthconsent.Service }

func (a *labConsentAdapter) Grant(ctx context.Context, grantorID, granteeID, scope string, expiresAt *time.Time) (string, error) {
	g, err := a.c.Grant(ctx, grantorID, granteeID, "", scope, expiresAt)
	if err != nil {
		return "", err
	}
	return g.ID, nil
}

func (a *labConsentAdapter) HasActiveGrant(ctx context.Context, granteeID, subjectOwnerID, scope string) (string, bool, error) {
	return a.c.HasActiveGrant(ctx, granteeID, subjectOwnerID, scope)
}

// labVaultReaderAdapter resolves a result record's first document to a signed URL
// through the records vault, which access-logs the read (HL-8/HL-12).
type labVaultReaderAdapter struct{ r *healthrecords.Service }

func (a *labVaultReaderAdapter) SignedDocURL(ctx context.Context, accessorID, recordID string) (string, error) {
	rec, err := a.r.Get(ctx, accessorID, recordID, false)
	if err != nil {
		return "", err
	}
	for _, d := range rec.Docs {
		if d.SignedURL != "" {
			return d.SignedURL, nil
		}
	}
	return "", errors.Join(healthlab.ErrSharingUnavailable, errors.New("document delivery is not configured"))
}

// labEarningsReader reads the lab owner's withdrawable wallet balance from the
// ledger (the figure the canonical wallet-to-bank corridor draws on). Read-only.
type labEarningsReader struct{ l *ledger.Service }

func (a *labEarningsReader) AvailableKobo(ctx context.Context, userID string) (int64, error) {
	return a.l.GetBalance(ctx, userID)
}

// labReportSigner adapts the R2 presigner to records.Signer: a short-lived GET URL
// for a stored lab report. The raw storage key is never returned to a client.
type labReportSigner struct{ p *r2.Presigner }

func (s labReportSigner) SignGet(_ context.Context, storageKey string) (string, error) {
	if storageKey == "" {
		return "", errors.New("lab: report has no storage key")
	}
	return s.p.PresignGet(storageKey, 5*time.Minute)
}
