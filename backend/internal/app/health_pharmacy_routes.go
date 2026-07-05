package app

import (
	"context"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	healthpharmacy "spotlight/backend/internal/health/pharmacy"
	healthrx "spotlight/backend/internal/health/rx"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/transport"
)

// RegisterHealthPharmacy wires HEALTH-BUILD Phase-1 Pharmacy onto the finance
// member group + a health pharmacy admin group. It is the ONLY wiring point for
// the pharmacy vertical and edits no existing file. All reuse is by import:
//
//   - escrow.Service      — HL-9 payment HELD→RELEASE→REFUND (idempotent).
//
//   - healthrx.Service    — HL-3 pharmacist verify + dispense-once (server-side).
//
//   - transport.Service   — last-mile delivery dispatch (no routing rebuild).
//
//   - finance/kyc.Service — HL-10 payout KYC gating.
//
//   - member: /api/finance/health/pharmacy/*  (member-authenticated; user_id mirrored)
//
//   - admin : /api/health/pharmacy/admin/*    (per-route RBAC health.pharmacy.*)
//
// Gated by FeatureHealthPharmacyEnabled at the orchestrator. Auditing is nil-safe.
//
// Returns the pharmacy service so the orchestrator can hand it optional
// collaborators (e.g. the symptom-search ReviewCaseOpener seam — PRD §10);
// nil when the pool is absent.
func RegisterHealthPharmacy(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *healthpharmacy.Service {
	if pool == nil {
		log.Println("[health.pharmacy] nil pool — skipping pharmacy routes")
		return nil
	}

	// Reuse rails (by import, never copy).
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	escrowSvc := escrow.NewService(pool, ledgerSvc, nil)
	rxSvc := healthrx.NewService(pool, nil)
	transportSvc := transport.NewService(pool, nil)
	kycSvc := kyc.NewService(pool)

	svc := healthpharmacy.NewService(
		pool,
		&escrowAdapter{e: escrowSvc},
		&rxGateAdapter{rx: rxSvc, db: pool},
		&rxVerifierAdapter{rx: rxSvc},
		&dispatchAdapter{t: transportSvc},
		&providerGateAdapter{db: pool},
		&payoutGateAdapter{kyc: kycSvc},
		nil, // audit sink injected by orchestrator (HL-12) — nil-safe here
	)

	isAdmin := func(c *gin.Context) bool { return isHealthPharmacyAdmin(c, rbac) }
	h := healthpharmacy.NewHandler(svc, isAdmin)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// --- Member routes (/api/finance/health/pharmacy) — HEALTH-BUILD §6 ---
	pg := member.Group("/health/pharmacy")
	pg.GET("/products", h.ListProducts)                        // NAFDAC-gated, Rx flag (HL-5)
	pg.GET("/products/:id", h.GetProduct)                      // single product + owning pharmacy
	pg.POST("/products", h.UpsertProduct)                      // pharmacy owner, HL-5 write-gate
	pg.POST("/prescriptions/:id/verify", h.VerifyPrescription) // pharmacist, HL-3
	pg.GET("/pharmacies", h.DiscoverPharmacies)                // browse ALL pharmacies — proximity/rating (HL-2)
	pg.GET("/pharmacies/:id", h.GetPharmacy)                   // pharmacy detail
	pg.GET("/pharmacies/:id/reviews", h.ListPharmacyReviews)   // public rating feed
	pg.POST("/pharmacies/:id/profile", h.UpsertPharmacyProfile) // verified owner storefront settings (HL-2)
	pg.POST("/orders", h.CreateOrder)                          // patient, payment HELD (HL-9)
	pg.GET("/orders/:id", h.Get)                               // object-level authZ
	pg.POST("/orders/:id/confirm", h.Confirm)                  // HL-3 verified e-Rx gate
	pg.POST("/orders/:id/dispense", h.Dispense)                // pharmacist (HL-1/HL-3)
	pg.POST("/orders/:id/dispatch", h.Dispatch)                // transport last-mile rail
	pg.POST("/orders/:id/complete", h.Complete)                // release payment (HL-9)
	pg.POST("/orders/:id/cancel", h.Cancel)                    // pre-dispense → refund (HL-9)
	pg.POST("/orders/:id/reviews", h.SubmitReview)             // patient, order must be completed

	// --- Admin routes (/api/health/pharmacy/admin, RBAC health.pharmacy.*) ---
	ag := admin.Group("")
	ag.GET("/orders", guard("health.pharmacy.orders"), h.AdminListOrders)
	ag.GET("/dispense-audit", guard("health.pharmacy.audit"), h.AdminDispenseAudit)
	ag.POST("/products/:id/recall", guard("health.pharmacy.recall"), h.AdminRecallProduct)

	log.Println("[health.pharmacy] pharmacy routes registered — catalog/orders/rx-verify/dispense/dispatch/complete + admin")
	return svc
}

// isHealthPharmacyAdmin reports whether the caller holds the pharmacy admin audit
// permission (drives admin-basis order reads).
func isHealthPharmacyAdmin(c *gin.Context, rbac services.RBACService) bool {
	if rbac == nil {
		return false
	}
	uid := c.GetString("user_id")
	if uid == "" {
		return false
	}
	ok, err := rbac.CheckPermission(uid, "health.pharmacy.audit", "global", "")
	return err == nil && ok
}

// ─── Adapters: bridge the reused rails to the package's narrow interfaces ─────

type escrowAdapter struct{ e *escrow.Service }

type holdRef struct{ id string }

func (h holdRef) HoldID() string { return h.id }

func (a *escrowAdapter) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (healthpharmacy.HoldRef, error) {
	hold, err := a.e.Hold(ctx, payerID, reference, moduleType, idemKey, amountKobo)
	if err != nil {
		return nil, err
	}
	return holdRef{id: hold.ID}, nil
}
func (a *escrowAdapter) Release(ctx context.Context, escrowID, payeeID string) error {
	return a.e.Release(ctx, escrowID, payeeID)
}
func (a *escrowAdapter) Refund(ctx context.Context, escrowID string) error {
	return a.e.Refund(ctx, escrowID)
}

// rxGateAdapter bridges healthrx for the fulfilment path (HL-3 dispense-once).
type rxGateAdapter struct {
	rx *healthrx.Service
	db *pgxpool.Pool
}

func (a *rxGateAdapter) EnsureVerified(ctx context.Context, requesterID, rxID, patientID, pharmacyProviderID string) error {
	// HL-3: the e-Rx must be VERIFIED and bound to this patient + pharmacy. We read
	// state directly (parameterised) — the authoritative VERIFIED transition is
	// owned by healthrx; this is a fulfilment-time gate before CONFIRM.
	var state, rxPatient string
	var rxPharmacy *string
	const q = `SELECT state, patient_id, pharmacy_provider_id FROM health_prescriptions WHERE id=$1`
	if err := a.db.QueryRow(ctx, q, rxID).Scan(&state, &rxPatient, &rxPharmacy); err != nil {
		return err
	}
	if rxPatient != patientID {
		return errRxMismatch
	}
	if rxPharmacy != nil && *rxPharmacy != "" && *rxPharmacy != pharmacyProviderID {
		return errRxMismatch
	}
	if state != "VERIFIED" {
		return errRxNotVerified
	}
	return nil
}
func (a *rxGateAdapter) Dispense(ctx context.Context, pharmacistID, rxID string) error {
	_, err := a.rx.Dispense(ctx, pharmacistID, rxID)
	return err
}
func (a *rxGateAdapter) Fulfill(ctx context.Context, actorID, rxID string) error {
	_, err := a.rx.Fulfill(ctx, actorID, rxID)
	return err
}

// rxVerifierAdapter bridges the pharmacist verify decision to healthrx.
type rxVerifierAdapter struct{ rx *healthrx.Service }

func (a *rxVerifierAdapter) Verify(ctx context.Context, pharmacistID, rxID string, approve bool, reason string) error {
	_, err := a.rx.Verify(ctx, pharmacistID, rxID, approve, reason)
	return err
}
func (a *rxVerifierAdapter) BeginVerify(ctx context.Context, pharmacistID, rxID string) error {
	_, err := a.rx.BeginVerify(ctx, pharmacistID, rxID)
	return err
}

// dispatchAdapter creates a medication delivery as a parcel job on the transport
// last-mile rail (REUSE — no routing rebuild). The pharmacy supplies the route;
// here the minimal job is booked under the patient as sender. The returned
// reference is the parcel id tracked by the transport module.
type dispatchAdapter struct{ t *transport.Service }

func (a *dispatchAdapter) CreateDelivery(ctx context.Context, senderID, reference, idemKey string) (string, error) {
	req := transport.ParcelBookRequest{
		Pickup:         transport.Place{Lat: 0, Lng: 0, Address: "pharmacy"},
		Dropoff:        transport.Place{Lat: 0, Lng: 0, Address: "patient"},
		ReceiverName:   "patient",
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

// providerGateAdapter enforces HL-2 against health_providers (parameterised).
type providerGateAdapter struct{ db *pgxpool.Pool }

func (a *providerGateAdapter) VerifiedPharmacyOwner(ctx context.Context, userID, providerID string) (bool, error) {
	var ok bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM health_providers
		WHERE id=$1 AND owner_user_id=$2 AND domain='PHARMACY' AND status='APPROVED')`
	if err := a.db.QueryRow(ctx, q, providerID, userID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}
func (a *providerGateAdapter) IsApprovedPharmacy(ctx context.Context, providerID string) (bool, error) {
	var ok bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM health_providers
		WHERE id=$1 AND domain='PHARMACY' AND status='APPROVED')`
	if err := a.db.QueryRow(ctx, q, providerID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// payoutGateAdapter enforces HL-10: the pharmacy owner must hold a KYC tier >= 1
// before a settlement is released.
type payoutGateAdapter struct{ kyc *kyc.Service }

func (a *payoutGateAdapter) PayoutEligible(ctx context.Context, ownerUserID string) (bool, error) {
	p, err := a.kyc.GetProfile(ctx, ownerUserID)
	if err != nil {
		return false, nil // fail-closed: no verifiable profile → not eligible
	}
	return int(p.Tier) >= 1, nil
}

var (
	errRxMismatch    = ginError("pharmacy: prescription does not match this patient/pharmacy")
	errRxNotVerified = ginError("pharmacy: prescription is not VERIFIED (HL-3)")
)

type ginError string

func (e ginError) Error() string { return string(e) }
