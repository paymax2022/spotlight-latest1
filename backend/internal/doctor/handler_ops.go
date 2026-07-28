package doctor

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// handler_ops.go — Wave 4 (operational) Gin handlers.
//
// One handler per service_ops.go method. Reuses the shared helpers from handler.go /
// handler_account.go (h.userID, h.fail, h.idemKey, h.rawBody) and mirrors the established
// style: reads return 200 with the projection; creates return 201; state transitions /
// upserts require an Idempotency-Key (the service enforces it) and return 200/201.
// Everything is scoped to the authed doctor.

// ══ CHAT ════════════════════════════════════════════════════════════════════

func (h *Handler) ListChatThreads(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListChatThreads(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListChatMessages(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListChatMessages(c.Request.Context(), uid, c.Param("threadId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SendChatMessage(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	var req SendChatMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.SendChatMessage(c.Request.Context(), uid, c.Param("threadId"), h.idemKey(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// ══ CALL SESSIONS ═══════════════════════════════════════════════════════════

func (h *Handler) GetCallSession(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetCallSession(c.Request.Context(), uid, c.Param("appointmentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) StartCallSession(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.StartCallSession(c.Request.Context(), uid, c.Param("appointmentId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// IssueCallToken returns a fresh RTC join token for the authed doctor scoped to
// the appointment. No Idempotency-Key (tokens are time-bound); auth + ownership
// are enforced in the service (the call session must belong to this doctor).
func (h *Handler) IssueCallToken(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.IssueCallToken(c.Request.Context(), uid, c.Param("appointmentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) EndCallSession(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.EndCallSession(c.Request.Context(), uid, c.Param("appointmentId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ══ SCHEDULE MANAGEMENT (Section E) ═════════════════════════════════════════

func (h *Handler) ListBlockedDates(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListBlockedDates(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CreateBlockedDate(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.CreateBlockedDate(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) GetVacation(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetVacation(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SetVacation(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SetVacation(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListRecurringRules(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListRecurringRules(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SaveRecurringRule(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SaveRecurringRule(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListReminders(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListReminders(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SaveReminderSettings(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SaveReminderSettings(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SetTimezone(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SetTimezone(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ══ APPOINTMENT QUEUE (Section F) ═══════════════════════════════════════════

func (h *Handler) ListConsultQueue(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListConsultQueue(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListAppointmentRequests(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListAppointmentRequests(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetAppointmentRequest(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetAppointmentRequest(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) AcceptAppointment(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.AcceptAppointment(c.Request.Context(), uid, c.Param("appointmentId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RejectAppointment(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.RejectAppointment(c.Request.Context(), uid, c.Param("appointmentId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RescheduleAppointment(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.RescheduleAppointment(c.Request.Context(), uid, c.Param("appointmentId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ══ HMO CLAIMS (submit / dispute) ═══════════════════════════════════════════

func (h *Handler) SubmitHMOClaim(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SubmitHMOClaim(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) DisputeHMOClaim(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	// NOTE: the gin route param is :id (must match the existing GET /hmo/claims/:id —
	// gin forbids two different param names at the same path position). The OpenAPI
	// spells this {claimId}; the value is identical.
	res, err := h.svc.DisputeHMOClaim(c.Request.Context(), uid, c.Param("id"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ══ MULTI-CLINIC PORTFOLIO ══════════════════════════════════════════════════

func (h *Handler) GetClinicPortfolio(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetClinicPortfolio(c.Request.Context(), uid)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SetActiveClinic(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SetActiveClinic(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) UpdateClinicSchedule(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.UpdateClinicSchedule(c.Request.Context(), uid, c.Param("clinicId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
