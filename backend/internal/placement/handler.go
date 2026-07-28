package placement

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
)

// Handler exposes the member, admin, and public placement routes.
type Handler struct {
	svc *Service
}

// NewHandler constructs the placement handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func ctxUserID(c *gin.Context) string { return c.GetString("user_id") }

// mapErr maps service sentinel errors to HTTP responses.
func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrNotFound), errors.Is(err, ErrZoneNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, ErrSlotTaken):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "SLOT_TAKEN"})
	case errors.Is(err, ErrInsufficient):
		c.JSON(http.StatusPaymentRequired, gin.H{"error": err.Error(), "code": "INSUFFICIENT_FUNDS"})
	case errors.Is(err, ErrIneligible):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "INELIGIBLE"})
	case errors.Is(err, ErrBadState):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "BAD_STATE"})
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrConflict):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "CONFLICT"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Member handlers
// ─────────────────────────────────────────────────────────────────────────────

// CreateCampaign (member): POST /campaigns
func (h *Handler) CreateCampaign(c *gin.Context) {
	uid := ctxUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var body struct {
		SubjectType  string         `json:"subject_type" binding:"required"`
		SubjectID    string         `json:"subject_id" binding:"required"`
		ZoneCode     string         `json:"zone_code" binding:"required"`
		WindowStart  string         `json:"window_start" binding:"required"`
		DurationDays int            `json:"duration_days" binding:"required"`
		Creative     map[string]any `json:"creative"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ws, err := time.Parse(time.RFC3339, body.WindowStart)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid window_start (RFC3339)"})
		return
	}
	camp, err := h.svc.CreateDraft(c.Request.Context(), uid, CreateInput{
		SubjectType:  body.SubjectType,
		SubjectID:    body.SubjectID,
		ZoneCode:     body.ZoneCode,
		WindowStart:  ws,
		DurationDays: body.DurationDays,
		Creative:     body.Creative,
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": camp})
}

// ListCampaigns (member): GET /campaigns
func (h *Handler) ListCampaigns(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rs, err := h.svc.List(c.Request.Context(), ctxUserID(c), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rs})
}

// GetCampaign (member): GET /campaigns/:id
func (h *Handler) GetCampaign(c *gin.Context) {
	camp, err := h.svc.Get(c.Request.Context(), ctxUserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// Quote (member): POST /campaigns/:id/quote
func (h *Handler) Quote(c *gin.Context) {
	camp, err := h.svc.Quote(c.Request.Context(), ctxUserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// Submit (member): POST /campaigns/:id/submit — Idempotency-Key required.
func (h *Handler) Submit(c *gin.Context) {
	if c.GetHeader("Idempotency-Key") == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	camp, err := h.svc.Submit(c.Request.Context(), ctxUserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// Pay (member): POST /campaigns/:id/pay — Idempotency-Key required (PENDING_PAYMENT retry).
func (h *Handler) Pay(c *gin.Context) {
	if c.GetHeader("Idempotency-Key") == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	camp, err := h.svc.Pay(c.Request.Context(), ctxUserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// Cancel (member): POST /campaigns/:id/cancel
func (h *Handler) Cancel(c *gin.Context) {
	camp, err := h.svc.Cancel(c.Request.Context(), ctxUserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// Pause (member): POST /campaigns/:id/pause
func (h *Handler) Pause(c *gin.Context) {
	camp, err := h.svc.Pause(c.Request.Context(), ctxUserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// Resume (member): POST /campaigns/:id/resume
func (h *Handler) Resume(c *gin.Context) {
	camp, err := h.svc.Resume(c.Request.Context(), ctxUserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// Analytics (member): GET /campaigns/:id/analytics
func (h *Handler) Analytics(c *gin.Context) {
	a, err := h.svc.Analytics(c.Request.Context(), ctxUserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": a})
}

// Zones (member): GET /zones?available_from&available_to
func (h *Handler) Zones(c *gin.Context) {
	zones, err := h.svc.ListZones(c.Request.Context())
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": zones})
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin handlers
// ─────────────────────────────────────────────────────────────────────────────

// AdminReviewQueue (admin): GET /review-queue?state=
func (h *Handler) AdminReviewQueue(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	rs, err := h.svc.ReviewQueue(c.Request.Context(), c.Query("state"), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rs})
}

// AdminGetCampaign (admin): GET /campaigns/:id
func (h *Handler) AdminGetCampaign(c *gin.Context) {
	camp, err := h.svc.GetAdmin(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// AdminApprove (admin): POST /campaigns/:id/approve
func (h *Handler) AdminApprove(c *gin.Context) {
	camp, err := h.svc.Approve(c.Request.Context(), ctxUserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// AdminReject (admin): POST /campaigns/:id/reject {reason}
func (h *Handler) AdminReject(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	camp, err := h.svc.Reject(c.Request.Context(), ctxUserID(c), c.Param("id"), body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// AdminRequestInfo (admin): POST /campaigns/:id/request-info {reason}
func (h *Handler) AdminRequestInfo(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	camp, err := h.svc.RequestInfo(c.Request.Context(), ctxUserID(c), c.Param("id"), body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// AdminSuspend (admin): POST /campaigns/:id/suspend {reason}
func (h *Handler) AdminSuspend(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	camp, err := h.svc.Suspend(c.Request.Context(), ctxUserID(c), c.Param("id"), body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": camp})
}

// ─────────────────────────────────────────────────────────────────────────────
// Public handlers (no auth)
// ─────────────────────────────────────────────────────────────────────────────

// Landing (public): GET /api/finance/placement/landing
func (h *Handler) Landing(c *gin.Context) {
	out, err := h.svc.Landing(c.Request.Context(), LandingRequest{
		SessionID: c.Query("session_id"),
		Now:       time.Now(),
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Events (public): POST /api/finance/placement/events — impression/tap batch.
func (h *Handler) Events(c *gin.Context) {
	var body struct {
		Events []EventInput `json:"events"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	n, err := h.svc.RecordEvents(c.Request.Context(), body.Events)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"data": gin.H{"accepted": n}})
}
