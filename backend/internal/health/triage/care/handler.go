package care

import (
	"errors"
	"log"
	"net/http"
	triage "spotlight/backend/internal/health/triage"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strconv"
	"time"

	"spotlight/backend/go-common/ginutil"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes the PRD §6 care-loop + SC-5/SC-8 API. AuthN is the finance auth
// chain (user_id mirrored onto the gin context); per-route RBAC is applied at
// registration (admin escalation routes gated by health.triage.review).
type Handler struct {
	svc *CareService
}

// NewHandler builds the care HTTP handler.
func NewHandler(svc *CareService) *Handler { return &Handler{svc: svc} }

// uuidPathID gates the :id path parameter — session/referral/escalation ids are
// uuid columns, so a malformed value would surface as a pg driver error instead
// of a clean 400.
func uuidPathID(c *gin.Context) bool {
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "id must be a uuid")
		return false
	}
	return true
}

// careFail maps service errors: ErrNotFound (missing OR non-owner — folded in
// the service) → 404; ErrIdempotencyRequired → 400; ErrIllegalTransition +
// other state refusals → 409. FailOK sanitizes the message.
func careFail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		ginutil.FailOK(c, http.StatusNotFound, "not found")
	case errors.Is(err, ErrIdempotencyRequired):
		ginutil.FailOK(c, http.StatusBadRequest, "idempotency key required")
	default:
		ginutil.FailOK(c, http.StatusConflict, err.Error())
	}
}

// Refer — POST /health/triage/sessions/:id/refer
// The disposition level is read from the session's stored disposition — a
// client-supplied level is ignored (never trusted). For emergency returns the
// SC-8 payload and the raised escalation.
func (h *Handler) Refer(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	// Body is optional and ignored — the level comes from the session.
	var req struct {
		Level int `json:"level"`
	}
	_ = c.ShouldBindJSON(&req)
	if !uuidPathID(c) {
		return
	}
	res, err := h.svc.Refer(c.Request.Context(), id, c.Param("id"))
	if err != nil {
		careFail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "result": res})
}

// PayReferral — POST /health/triage/referrals/:id/pay  (wallet charge, idempotent)
func (h *Handler) PayReferral(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !uuidPathID(c) {
		return
	}
	var req struct {
		IdempotencyKey string `json:"idempotency_key"`
	}
	_ = c.ShouldBindJSON(&req)
	idem := req.IdempotencyKey
	if hk := ginutil.IdempotencyKey(c); hk != "" {
		idem = hk
	}
	ref, err := h.svc.PayReferral(c.Request.Context(), id, c.Param("id"), idem)
	if err != nil {
		careFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "referral": ref})
}

// NearestEmergency — GET /health/triage/emergency/nearest?lat=&lng=  (SC-8, always on)
func (h *Handler) NearestEmergency(c *gin.Context) {
	lat, _ := strconv.ParseFloat(c.Query("lat"), 64)
	lng, _ := strconv.ParseFloat(c.Query("lng"), 64)
	info, err := h.svc.NearestEmergency(c.Request.Context(), lat, lng)
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "emergency": info})
}

// ListReferrals — GET /health/triage/referrals  (mine)
func (h *Handler) ListReferrals(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	rows, err := h.svc.ListReferrals(c.Request.Context(), id)
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "referrals": rows})
}

// AdminListEscalations — GET /health/triage/escalations?state=
func (h *Handler) AdminListEscalations(c *gin.Context) {
	rows, err := h.svc.ListEscalations(c.Request.Context(), c.Query("state"))
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "escalations": rows})
}

// AdminAcknowledge — POST /health/triage/escalations/:id/ack  (clinician picks up)
func (h *Handler) AdminAcknowledge(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !uuidPathID(c) {
		return
	}
	e, err := h.svc.Acknowledge(c.Request.Context(), c.Param("id"), id)
	if err != nil {
		careFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "escalation": e})
}

// AdminResolve — POST /health/triage/escalations/:id/resolve  (clinician closes)
func (h *Handler) AdminResolve(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !uuidPathID(c) {
		return
	}
	e, err := h.svc.Resolve(c.Request.Context(), c.Param("id"), id)
	if err != nil {
		careFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "escalation": e})
}

// RegisterHealthTriageCare wires the care-routing + escalation routes onto the
// member group (BARE subpaths) + the admin group. It edits no existing file and is
// fully nil-safe: a nil pool skips registration; nil ports fall back to safe stubs.
//
//	member: POST /health/triage/sessions/:id/refer
//	        POST /health/triage/referrals/:id/pay
//	        GET  /health/triage/emergency/nearest?lat=&lng=   (SC-8, always available)
//	admin (RBAC health.triage.review):
//	        GET  /health/triage/escalations
//	        POST /health/triage/escalations/:id/ack
//	        POST /health/triage/escalations/:id/resolve
func RegisterHealthTriageCare(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, pay Payment, loc EmergencyLocator, notify Notifier, booker CareBooker, audit Auditor) {
	if pool == nil {
		log.Println("[health.triage.care] nil pool — skipping care routes")
		return
	}
	repo := NewRepository(pool, audit) // real immutable-audit sink injected by orchestrator (SC-12) — nil-safe
	svc := NewCareService(repo, pay, loc, notify, booker, nil)
	h := NewHandler(svc)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	if member != nil {
		member.POST("/health/triage/sessions/:id/refer", h.Refer)
		member.POST("/health/triage/referrals/:id/pay", h.PayReferral)
		member.GET("/health/triage/emergency/nearest", h.NearestEmergency) // SC-8 always on
		member.GET("/health/triage/referrals", h.ListReferrals)
	}
	if admin != nil {
		// admin is already rooted at /api/health/triage/admin (adminGroupTop5 in
		// health_triage_routes.go) — subpaths must stay bare.
		admin.GET("/escalations", guard("health.triage.review"), h.AdminListEscalations)
		admin.POST("/escalations/:id/ack", guard("health.triage.review"), h.AdminAcknowledge)
		admin.POST("/escalations/:id/resolve", guard("health.triage.review"), h.AdminResolve)
	}
	log.Println("[health.triage.care] care-routing + escalation routes registered — refer/pay/emergency + escalations")
}

// CareReferral is the routed next-step for a triage session (DB:
// health_triage_care_referrals). It is the CareReferral state machine carrier:
//
//	created → routed(pharmacy|lab|telemed|emergency|self_care) → paid → fulfilled
//	        → follow_up → closed   (emergency/self_care need no payment)
//
// AmountMinor is in kobo; PaymentRef pins the ledger charge once paid; TargetRef
// pins the downstream booking/order id once booked.
type CareReferral struct {
	ID               string               `json:"id"`
	SessionID        string               `json:"session_id"`
	UserID           string               `json:"user_id"`
	DispositionLevel int                  `json:"disposition_level"`
	Route            string               `json:"route"` // pharmacy|lab|telemed|emergency|self_care
	TargetRef        *string              `json:"target_ref,omitempty"`
	State            triage.ReferralState `json:"state"`
	AmountMinor      int64                `json:"amount_minor"`
	PaymentRef       *string              `json:"payment_ref,omitempty"`
	IdempotencyKey   *string              `json:"idempotency_key,omitempty"`
	CreatedAt        time.Time            `json:"created_at"`
	UpdatedAt        time.Time            `json:"updated_at"`
}

// Escalation is a human-in-loop case raised for a high-risk/emergency disposition
// (DB: health_triage_escalations). SC-5: a machine never closes it — a licensed
// clinician acknowledges then resolves. State machine:
//
//	raised → notified → acknowledged → resolved
type Escalation struct {
	ID          string                 `json:"id"`
	SessionID   string                 `json:"session_id"`
	UserID      string                 `json:"user_id"`
	State       triage.EscalationState `json:"state"`
	Reason      string                 `json:"reason"`
	ClinicianID *string                `json:"clinician_id,omitempty"`
	RaisedAt    time.Time              `json:"raised_at"`
	AckAt       *time.Time             `json:"ack_at,omitempty"`
	ResolvedAt  *time.Time             `json:"resolved_at,omitempty"`
}

// EmergencyInfo is the SC-8 emergency-screen payload: nearest ER + ambulance hint
// + first-aid guidance. It carries no PII and is always available.
type EmergencyInfo struct {
	FacilityName    string  `json:"facility_name"`
	FacilityAddress string  `json:"facility_address"`
	DistanceM       float64 `json:"distance_m"`
	AmbulanceNumber string  `json:"ambulance_number"`
	FirstAid        string  `json:"first_aid"`
}

// ReferResult is what Refer returns: the referral, plus (for emergency) the
// always-available emergency payload and the raised escalation so the caller can
// drive the SC-8 emergency screen + SC-5 hand-off in one round-trip.
type ReferResult struct {
	Referral   *CareReferral  `json:"referral"`
	Emergency  *EmergencyInfo `json:"emergency,omitempty"`
	Escalation *Escalation    `json:"escalation,omitempty"`
}

// NigeriaAmbulanceNumber is the national emergency line surfaced on the emergency
// screen. It is a constant (no PII) and always returned with EmergencyInfo.
const NigeriaAmbulanceNumber = "112"

// defaultFirstAid is the conservative, non-diagnostic first-aid guidance shown on
// the emergency screen while help is on the way (SC-1: navigation, not diagnosis).
const defaultFirstAid = "Stay with the patient. Keep them still and calm. " +
	"If unconscious and not breathing normally, begin CPR if trained. " +
	"Do not give food or drink. Call the ambulance number now."
