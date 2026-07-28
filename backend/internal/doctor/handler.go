package doctor

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/platform/r2"
	platformWS "spotlight/backend/internal/platform/ws"
)

// Handler exposes the doctor MVP over Gin. Routes are mounted under /api/v1/doctor
// with middleware.RequireAuthContext, so the authenticated user is read via
// middleware.GetAuthenticatedUser. Reads/writes are scoped to that user (the doctor).
type Handler struct {
	svc *Service
	hub *platformWS.Hub // optional; nil disables the realtime WS endpoint

	presigner     *r2.Presigner // optional; nil/unconfigured disables presigned uploads
	presignBucket string
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithHub attaches the WebSocket Hub for the realtime endpoint (Wave 6). Additive.
func (h *Handler) WithHub(hub *platformWS.Hub) *Handler {
	h.hub = hub
	return h
}

// WithPresigner attaches an R2 presigner so the upload endpoints can mint
// short-lived presigned PUT URLs. A nil or unconfigured presigner makes the
// presign endpoint fail closed with 503. Additive.
func (h *Handler) WithPresigner(p *r2.Presigner, bucket string) *Handler {
	h.presigner = p
	h.presignBucket = bucket
	return h
}

// ServeWS upgrades the connection to a WebSocket for the authed doctor. The doctor
// is resolved from the RequireAuthContext middleware (Bearer JWT already validated);
// hub.ServeHTTP then registers the connection keyed by the doctor's userID so
// pushDoctor(...) events fan out to all their devices.
func (h *Handler) ServeWS(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	if h.hub == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "realtime not configured"})
		return
	}
	// Hand the underlying net/http writer+request to the hub. gin.Context exposes
	// both via c.Writer / c.Request; the hub does the websocket.Accept upgrade.
	if err := h.hub.ServeHTTP(c.Writer, c.Request, uid); err != nil {
		// The connection is already hijacked on success; an error here means the
		// upgrade failed before writing — surface it without a second write attempt.
		_ = err
	}
}

// userID resolves the authenticated doctor; aborts 401 if absent.
func (h *Handler) userID(c *gin.Context) (string, bool) {
	u, ok := middleware.GetAuthenticatedUser(c)
	if !ok || u.ID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return "", false
	}
	return u.ID, true
}

// fail maps service errors to HTTP statuses (404 not-found, 409 idempotency replay,
// 422 insufficient funds, 400 validation, 500 otherwise).
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	case errors.Is(err, ErrDuplicateRequest), errors.Is(err, ledger.ErrDuplicate):
		c.JSON(http.StatusConflict, gin.H{"error": "duplicate request"})
	case errors.Is(err, ledger.ErrInsufficientFunds):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "insufficient available balance"})
	case errors.Is(err, ErrIdempotencyRequired), errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func (h *Handler) idemKey(c *gin.Context) string {
	return c.GetHeader("Idempotency-Key")
}

// ── Reads ───────────────────────────────────────────────────────────────────

func (h *Handler) GetProfile(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetProfile(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetVerification(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetVerification(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetAvailability(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetAvailability(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListAppointments(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListAppointments(c.Request.Context(), uid, c.Query("status"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetAppointment(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetAppointment(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListNotes(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListNotes(c.Request.Context(), uid, c.Param("appointmentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPatient(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPatientRecord(c.Request.Context(), uid, c.Param("patientId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListPrescriptions(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListPrescriptions(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetPrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetPrescription(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListLabOrders(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListLabOrders(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetLabResult(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetLabResult(c.Request.Context(), uid, c.Param("orderId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetEarnings(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetEarnings(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListNotifications(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListNotifications(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetSettings(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetSettings(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ── Mutations ───────────────────────────────────────────────────────────────

func (h *Handler) SubmitVerification(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SubmitVerificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SubmitVerification(c.Request.Context(), uid, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) UpdateAvailability(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req UpdateAvailabilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.UpdateAvailability(c.Request.Context(), uid, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) UpdateAppointmentStatus(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req UpdateAppointmentStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.UpdateAppointmentStatus(c.Request.Context(), uid, c.Param("appointmentId"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SaveNote(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SaveNoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SaveNote(c.Request.Context(), uid, c.Param("appointmentId"), h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) CreatePrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req CreatePrescriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.CreatePrescription(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) CreateLabOrder(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req CreateLabOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.CreateLabOrder(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) ReviewLabResult(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req ReviewLabResultRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.ReviewLabResult(c.Request.Context(), uid, c.Param("resultId"), h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) UpdateSettings(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req UpdateSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.UpdateSettings(c.Request.Context(), uid, req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) MarkNotificationRead(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	if err := h.svc.MarkNotificationRead(c.Request.Context(), uid, c.Param("id")); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// RequestPayout is the money path. Requires an Idempotency-Key header.
// Replays return 409 with the prior payout result.
func (h *Handler) RequestPayout(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req RequestPayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.RequestPayout(c.Request.Context(), uid, h.idemKey(c), req)
	if err != nil {
		// Idempotency replay returns the prior result alongside the 409.
		if errors.Is(err, ErrDuplicateRequest) && res != nil {
			c.JSON(http.StatusConflict, res)
			return
		}
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}
