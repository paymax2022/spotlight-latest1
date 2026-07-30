package app

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/config"
	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	healthlab "spotlight/backend/internal/health/lab"
	healthrecords "spotlight/backend/internal/health/records"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/transport"
)

// RegisterHealthLab wires HEALTH-BUILD Phase-2 Laboratory onto the finance member
// group + a health lab admin group. It is the ONLY wiring point for the lab
// vertical and edits no existing file. All reuse is by import:
//
//   - escrow.Service         — HL-9 payment HELD→RELEASE→REFUND (idempotent).
//
//   - transport.Service      — phlebotomist dispatch + results courier (last-mile rail).
//
//   - healthrecords.Service  — HL-8 result release → consent-gated, signed-URL vault.
//
//   - finance/kyc.Service    — HL-10 payout KYC gating.
//
//   - member: /api/finance/health/lab/*  (member-authenticated; user_id mirrored)
//
//   - admin : /api/health/lab/admin/*    (per-route RBAC health.lab.*)
//
// Gated by FeatureHealthLabEnabled at the orchestrator. Auditing is nil-safe.
func RegisterHealthLab(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, audit services.AuditService, cfg config.Config) {
	if pool == nil {
		log.Println("[health.lab] nil pool — skipping lab routes")
		return
	}

	// Reuse rails (by import, never copy).
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	escrowSvc := escrow.NewService(pool, ledgerSvc, nil)
	transportSvc := transport.NewService(pool, nil)
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

	// Central Commission & Profit recording at the lab order settlement point
	// (Release → escrow release). Best-effort + idempotent + nil-safe: constructed
	// with a nil ledger so the earning row is appended WITHOUT re-posting to the
	// ledger (lab's own escrow split already posts the platform cut). Reuses the
	// shared commissionRecorderAdapter (marketplace_routes.go). Gated on the flag ⇒
	// off leaves the recorder nil ⇒ silent no-op.
	if cfg.FeatureCommissionEnabled {
		svc.SetCommissionRecorder(commissionRecorderAdapter{svc: commission.NewService(commission.NewRepository(pool), nil)})
	}

	isAdmin := func(c *gin.Context) bool { return isHealthLabAdmin(c, rbac) }
	h := healthlab.NewHandler(svc, isAdmin)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// --- Member routes (/api/finance/health/lab) — HEALTH-BUILD §6 Laboratory ---
	lg := member.Group("/health/lab")
	lg.GET("/tests", h.ListTests)                  // catalog: prep, TAT, price
	lg.POST("/tests", h.UpsertTest)                // lab owner, HL-2 catalog governance
	lg.POST("/orders", h.CreateOrder)              // patient, payment HELD (HL-9)
	lg.GET("/orders/:id", h.Get)                   // object-level authZ
	lg.GET("/orders/:id/results", h.Results)       // object-level authZ (HL-8)
	lg.GET("/orders/:id/custody", h.Custody)       // chain-of-custody trail (HL-6/12)
	lg.POST("/orders/:id/schedule", h.Schedule)    // phlebotomist dispatch (HOME)
	lg.POST("/orders/:id/collect", h.Collect)      // phlebotomist: sample + custody (HL-6)
	lg.POST("/orders/:id/results", h.EnterResults) // scientist enter + validate (HL-7)
	lg.POST("/orders/:id/release", h.Release)      // sign-off → vault; release payment (HL-7/8/9)
	lg.POST("/orders/:id/cancel", h.Cancel)        // pre-collection → refund (HL-9)
	lg.POST("/samples/:id/accession", h.Accession) // lab intake, HL-6 chain gate
	lg.POST("/samples/:id/handover", h.Handover)   // custody transfer (HL-6)
	lg.POST("/samples/:id/breach", h.FlagBreach)   // chain break → recollect (HL-6)

	// --- Admin routes (/api/health/lab/admin, RBAC health.lab.*) ---
	ag := admin.Group("")
	ag.GET("/orders", guard("health.lab.orders"), h.AdminListOrders)                     // order/results oversight
	ag.GET("/custody-audit", guard("health.lab.custody"), h.AdminCustodyAudit)           // chain-of-custody oversight (HL-6)
	ag.GET("/escalations", guard("health.lab.escalation"), h.AdminEscalations)           // critical-result escalation (HL-7)
	ag.POST("/tests/:id/deactivate", guard("health.lab.catalog"), h.AdminDeactivateTest) // catalog governance

	log.Println("[health.lab] lab routes registered — tests/orders/collect/accession/results/release + custody + admin")
}

// isHealthLabAdmin reports whether the caller holds the lab admin order-oversight
// permission (drives admin-basis order/result reads).
func isHealthLabAdmin(c *gin.Context, rbac services.RBACService) bool {
	if rbac == nil {
		return false
	}
	uid := c.GetString("user_id")
	if uid == "" {
		return false
	}
	ok, err := rbac.CheckPermission(uid, "health.lab.orders", "global", "")
	return err == nil && ok
}

// ─── Adapters: bridge the reused rails to the package's narrow interfaces ─────

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
func (a *labProviderGateAdapter) IsVerifiedScientist(ctx context.Context, userID, providerID string) (bool, error) {
	return a.hasCapability(ctx, userID, "lab_scientist")
}
func (a *labProviderGateAdapter) IsVerifiedPhlebotomist(ctx context.Context, userID, providerID string) (bool, error) {
	return a.hasCapability(ctx, userID, "phlebotomist")
}
func (a *labProviderGateAdapter) hasCapability(ctx context.Context, userID, providerType string) (bool, error) {
	var ok bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM health_providers
		WHERE owner_user_id=$1 AND domain='LAB' AND provider_type=$2 AND status='APPROVED')`
	if err := a.db.QueryRow(ctx, q, userID, providerType).Scan(&ok); err != nil {
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
