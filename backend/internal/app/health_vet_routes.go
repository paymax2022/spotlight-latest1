package app

import (
	"context"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/escrow"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	healthconsult "spotlight/backend/internal/health/consult"
	healthrecords "spotlight/backend/internal/health/records"
	healthrx "spotlight/backend/internal/health/rx"
	healthscheduling "spotlight/backend/internal/health/scheduling"
	healthvet "spotlight/backend/internal/health/vet"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/scheduler"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/transport"
)

// RegisterHealthVet wires HEALTH-BUILD Phase-3 Veterinary onto the finance member
// group + a health vet admin group. It is the ONLY wiring point for the vet
// vertical and edits no existing file. All reuse is by import:
//
//   - escrow.Service          — HL-9 payment HELD→RELEASE→REFUND (idempotent).
//   - transport.Service       — home-visit dispatch (last-mile/MapService rail).
//   - healthscheduling.Service — appointment state machine (subject_type=PET).
//   - healthconsult.Service   — tele-consult engine + SOAP ClinicalNote.
//   - healthrx.Service        — e-prescription engine → pharmacy handoff (HL-3).
//   - healthrecords.Service   — HL-8 pet records vault (subject_type=PET).
//   - scheduler.Service       — vaccination reminders.
//   - finance/kyc.Service     — HL-10 payout KYC gating.
//
//   - member: /api/finance/health/vet/*  (member-authenticated; user_id mirrored)
//   - admin : /api/health/vet/admin/*    (per-route RBAC health.vet.*)
//
// Gated by FeatureHealthVetEnabled at the orchestrator. Auditing is nil-safe.
func RegisterHealthVet(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[health.vet] nil pool — skipping vet routes")
		return
	}

	// Reuse rails (by import, never copy).
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	escrowSvc := escrow.NewService(pool, ledgerSvc, nil)
	transportSvc := transport.NewService(pool, nil)
	kycSvc := kyc.NewService(pool)

	// Reuse the shared health engines (same construction as RegisterHealth).
	sched := scheduler.NewService(pool)
	schedulingSvc := healthscheduling.NewService(pool, sched, nil)
	consultSvc := healthconsult.NewService(pool, os.Getenv("HEALTH_AV_SIGNING_KEY"), nil)
	rxSvc := healthrx.NewService(pool, nil)
	recordsSvc := healthrecords.NewService(pool, nil, nil, nil)

	svc := healthvet.NewService(
		pool,
		&vetEscrowAdapter{e: escrowSvc},
		&vetDispatchAdapter{t: transportSvc},
		&vetProviderGateAdapter{db: pool},
		&vetPayoutGateAdapter{kyc: kycSvc},
		schedulingSvc,
		consultSvc,
		rxSvc,
		recordsSvc,
		sched,
		nil, // audit sink injected by orchestrator (HL-12) — nil-safe here
	)

	isAdmin := func(c *gin.Context) bool { return isHealthVetAdmin(c, rbac) }
	h := healthvet.NewHandler(svc, isAdmin)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// --- Member routes (/api/finance/health/vet) — HEALTH-BUILD §6 Veterinary ---
	vg := member.Group("/health/vet")
	vg.POST("/pets", h.CreatePet)                             // owner; seeds PET vault record (HL-8)
	vg.GET("/pets", h.ListPets)                               // owner reads own pets (HL-8)
	vg.POST("/pets/:id/vaccinations", h.ScheduleVaccination) // reminder via scheduler
	vg.GET("/vets", h.DiscoverVets)                          // map/list discovery (HL-2, PostGIS)
	vg.POST("/services", h.UpsertService)                    // verified vet owner; fee governance
	vg.POST("/appointments", h.Book)                        // tele/home/clinic; payment HELD (HL-9)
	vg.GET("/appointments/:id", h.Get)                      // object-level authZ
	vg.POST("/appointments/:id/accept", h.Accept)          // verified vet (HL-2)
	vg.POST("/appointments/:id/confirm", h.Confirm)        // ACCEPTED → CONFIRMED
	vg.POST("/appointments/:id/cancel", h.Cancel)          // owner/vet → refund HELD (HL-9)
	vg.POST("/appointments/:id/dispatch", h.Dispatch)      // home visit on transport rail
	vg.POST("/consults/:id/start", h.StartConsult)         // verified vet; consult engine (HL-2)
	vg.POST("/consults/:id/complete", h.CompleteConsult)   // SOAP + e-Rx/lab handoff; RELEASE (HL-9)
	vg.POST("/sos", h.EmergencySOS)                        // HL-11: nearest in-person vet + disclaimer

	// --- Admin routes (/api/health/vet/admin, RBAC health.vet.*) ---
	ag := admin.Group("")
	ag.GET("/appointments", guard("health.vet.appointments"), h.AdminListAppointments) // appointment oversight
	ag.GET("/vcn-audit", guard("health.vet.vcn"), h.AdminVCNAudit)                      // VCN credential audit (HL-2)
	ag.GET("/erx-audit", guard("health.vet.erx"), h.AdminERxAudit)                      // e-prescription audit (HL-3)
	ag.POST("/services/:id/deactivate", guard("health.vet.services"), h.AdminDeactivateService) // service/fee governance

	log.Println("[health.vet] vet routes registered — pets/vets/appointments/consults/dispatch/sos + admin")
}

// isHealthVetAdmin reports whether the caller holds the vet admin appointment-
// oversight permission (drives admin-basis appointment reads).
func isHealthVetAdmin(c *gin.Context, rbac services.RBACService) bool {
	if rbac == nil {
		return false
	}
	uid := c.GetString("user_id")
	if uid == "" {
		return false
	}
	ok, err := rbac.CheckPermission(uid, "health.vet.appointments", "global", "")
	return err == nil && ok
}

// ─── Adapters: bridge the reused rails to the package's narrow interfaces ─────

type vetEscrowAdapter struct{ e *escrow.Service }

type vetHoldRef struct{ id string }

func (h vetHoldRef) HoldID() string { return h.id }

func (a *vetEscrowAdapter) Hold(ctx context.Context, payerID, reference, moduleType, idemKey string, amountKobo int64) (healthvet.HoldRef, error) {
	hold, err := a.e.Hold(ctx, payerID, reference, moduleType, idemKey, amountKobo)
	if err != nil {
		return nil, err
	}
	return vetHoldRef{id: hold.ID}, nil
}
func (a *vetEscrowAdapter) Release(ctx context.Context, escrowID, payeeID string) error {
	return a.e.Release(ctx, escrowID, payeeID)
}
func (a *vetEscrowAdapter) Refund(ctx context.Context, escrowID string) error {
	return a.e.Refund(ctx, escrowID)
}

// vetDispatchAdapter books a home-visit dispatch as a parcel job on the transport
// last-mile rail (REUSE — no routing rebuild). The returned reference is the
// parcel id tracked by the transport module.
type vetDispatchAdapter struct{ t *transport.Service }

func (a *vetDispatchAdapter) CreateDelivery(ctx context.Context, senderID, reference, idemKey string) (string, error) {
	req := transport.ParcelBookRequest{
		Pickup:         transport.Place{Lat: 0, Lng: 0, Address: "vet"},
		Dropoff:        transport.Place{Lat: 0, Lng: 0, Address: "pet-owner"},
		ReceiverName:   "pet-owner",
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

// vetProviderGateAdapter enforces HL-2 against health_providers (parameterised). A
// vet is an APPROVED health_providers VET capability row; transactions require a
// verified credential (credential-gated supply).
type vetProviderGateAdapter struct{ db *pgxpool.Pool }

func (a *vetProviderGateAdapter) IsApprovedVet(ctx context.Context, providerID string) (bool, error) {
	var ok bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM health_providers
		WHERE id=$1 AND domain='VET' AND provider_type='vet' AND status='APPROVED')`
	if err := a.db.QueryRow(ctx, q, providerID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}
func (a *vetProviderGateAdapter) VerifiedVetOwner(ctx context.Context, userID, providerID string) (bool, error) {
	var ok bool
	const q = `SELECT EXISTS (
		SELECT 1 FROM health_providers
		WHERE id=$1 AND owner_user_id=$2 AND domain='VET' AND provider_type='vet' AND status='APPROVED')`
	if err := a.db.QueryRow(ctx, q, providerID, userID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// vetPayoutGateAdapter enforces HL-10: the vet owner must hold a KYC tier >= 1
// before a settlement is released.
type vetPayoutGateAdapter struct{ kyc *kyc.Service }

func (a *vetPayoutGateAdapter) PayoutEligible(ctx context.Context, ownerUserID string) (bool, error) {
	p, err := a.kyc.GetProfile(ctx, ownerUserID)
	if err != nil {
		return false, nil // fail-closed: no verifiable profile → not eligible
	}
	return int(p.Tier) >= 1, nil
}
