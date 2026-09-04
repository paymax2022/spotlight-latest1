package care

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the PRD §6 care-loop + SC-5/SC-8 API. AuthN is the finance auth
// chain (user_id mirrored onto the gin context); per-route RBAC is applied at
// registration (admin escalation routes gated by health.triage.review).
type Handler struct {
	svc *CareService
}

// NewHandler builds the care HTTP handler.
func NewHandler(svc *CareService) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// Refer — POST /health/triage/sessions/:id/refer
// body: { level }. Routes the disposition; for emergency returns the SC-8 payload
// and the raised escalation.
func (h *Handler) Refer(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Level int `json:"level"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	res, err := h.svc.Refer(c.Request.Context(), id, c.Param("id"), req.Level)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "result": res})
}

// PayReferral — POST /health/triage/referrals/:id/pay  (wallet charge, idempotent)
func (h *Handler) PayReferral(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		IdempotencyKey string `json:"idempotency_key"`
	}
	_ = c.ShouldBindJSON(&req)
	idem := req.IdempotencyKey
	if hk := c.GetHeader("Idempotency-Key"); hk != "" {
		idem = hk
	}
	ref, err := h.svc.PayReferral(c.Request.Context(), id, c.Param("id"), idem)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, err.Error())
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
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "emergency": info})
}

// ListReferrals — GET /health/triage/referrals  (mine)
func (h *Handler) ListReferrals(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	rows, err := h.svc.ListReferrals(c.Request.Context(), id)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "referrals": rows})
}

// ─── Admin (RBAC health.triage.review) ───────────────────────────────────────

// AdminListEscalations — GET /health/triage/escalations?state=
func (h *Handler) AdminListEscalations(c *gin.Context) {
	rows, err := h.svc.ListEscalations(c.Request.Context(), c.Query("state"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "escalations": rows})
}

// AdminAcknowledge — POST /health/triage/escalations/:id/ack  (clinician picks up)
func (h *Handler) AdminAcknowledge(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	e, err := h.svc.Acknowledge(c.Request.Context(), c.Param("id"), id)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "escalation": e})
}

// AdminResolve — POST /health/triage/escalations/:id/resolve  (clinician closes)
func (h *Handler) AdminResolve(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	e, err := h.svc.Resolve(c.Request.Context(), c.Param("id"), id)
	if err != nil {
		fail(c, http.StatusConflict, err.Error())
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
//	        GET  /health/triage/referrals                     (mine)
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
		// health_triage_routes.go) — these used to re-prepend "/health/triage",
		// doubling the segment and 404ing every escalation admin call.
		admin.GET("/escalations", guard("health.triage.review"), h.AdminListEscalations)
		admin.POST("/escalations/:id/ack", guard("health.triage.review"), h.AdminAcknowledge)
		admin.POST("/escalations/:id/resolve", guard("health.triage.review"), h.AdminResolve)
	}
	log.Println("[health.triage.care] care-routing + escalation routes registered — refer/pay/emergency + escalations")
}
