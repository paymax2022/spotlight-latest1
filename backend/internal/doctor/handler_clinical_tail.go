package doctor

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// handler_clinical_tail.go — Gin handlers for the "clinical tail" endpoint groups
// (appointment transitions, rich clinical notes, prescription lifecycle, call
// disputes/feedback, chat state/annotations, emergency cases/escalations, AI
// read-back, HMO eligibility).
//
// One handler per service_clinical_tail.go method. Reuses the shared helpers from
// handler.go / handler_account.go (h.userID, h.fail, h.idemKey, h.rawBody). Reads
// return 200; creates return 201; transitions return 200. Mutations on tables with a
// UNIQUE idempotency_key require the Idempotency-Key header (the service enforces it).
// Everything is scoped to the authenticated doctor.

// ══ APPOINTMENT TRANSITIONS ═════════════════════════════════════════════════

func (h *Handler) StartAppointment(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.StartAppointment(c.Request.Context(), uid, c.Param("appointmentId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) EndAppointment(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.EndAppointment(c.Request.Context(), uid, c.Param("appointmentId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CancelAppointment(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.CancelAppointment(c.Request.Context(), uid, c.Param("appointmentId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) MarkNoShow(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.MarkNoShow(c.Request.Context(), uid, c.Param("appointmentId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ══ CLINICAL NOTES ══════════════════════════════════════════════════════════

func (h *Handler) GetClinicalNote(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetClinicalNote(c.Request.Context(), uid, c.Param("appointmentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SaveClinicalNote(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SaveClinicalNote(c.Request.Context(), uid, c.Param("appointmentId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) FinalizeClinicalNote(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.FinalizeClinicalNote(c.Request.Context(), uid, c.Param("noteId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ShareClinicalNote(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.ShareClinicalNote(c.Request.Context(), uid, c.Param("noteId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ══ PRESCRIPTIONS ═══════════════════════════════════════════════════════════

func (h *Handler) GetIssuedPrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetIssuedPrescription(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) IssuePrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.IssuePrescription(c.Request.Context(), uid, c.Param("id"), h.idemKey(c))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CancelPrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.CancelPrescription(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SharePrescription(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SharePrescription(c.Request.Context(), uid, c.Param("id"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) AttachPrescriptionPharmacy(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.AttachPrescriptionPharmacy(c.Request.Context(), uid, c.Param("id"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SendPrescriptionToPharmacy(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SendPrescriptionToPharmacy(c.Request.Context(), uid, c.Param("id"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) RequestRefillConsultation(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.RequestRefillConsultation(c.Request.Context(), uid, c.Param("id"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// ══ CALLS ═══════════════════════════════════════════════════════════════════

func (h *Handler) GetCallPreCheck(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetCallPreCheck(c.Request.Context(), uid, c.Param("appointmentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetCallRich(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetCallRich(c.Request.Context(), uid, c.Param("appointmentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) DisputeCall(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.DisputeCall(c.Request.Context(), uid, c.Param("appointmentId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) SubmitCallFeedback(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SubmitCallFeedback(c.Request.Context(), uid, c.Param("appointmentId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) SwitchCallProvider(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SwitchCallProvider(c.Request.Context(), uid, c.Param("appointmentId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ══ CHAT ════════════════════════════════════════════════════════════════════

func (h *Handler) GetChatPresence(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetChatPresence(c.Request.Context(), uid, c.Param("threadId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ListChatRichMessages(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ListChatRichMessages(c.Request.Context(), uid, c.Param("threadId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetChatState(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetChatState(c.Request.Context(), uid, c.Param("threadId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetChatTranscript(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetChatTranscript(c.Request.Context(), uid, c.Param("threadId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) SendChatAttachment(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SendChatAttachment(c.Request.Context(), uid, c.Param("threadId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) SendChatVoice(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.SendChatVoice(c.Request.Context(), uid, c.Param("threadId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) EndChatThread(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.EndChatThread(c.Request.Context(), uid, c.Param("threadId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) EscalateChatThread(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.EscalateChatThread(c.Request.Context(), uid, c.Param("threadId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ShareChatThread(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.ShareChatThread(c.Request.Context(), uid, c.Param("threadId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) ReportChatMessage(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.ReportChatMessage(c.Request.Context(), uid, c.Param("messageId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) AnnotateChatMessage(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.AnnotateChatMessage(c.Request.Context(), uid, c.Param("messageId"), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ══ EMERGENCY ═══════════════════════════════════════════════════════════════

func (h *Handler) GetEmergencyCase(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetEmergencyCase(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CreateEmergencyCase(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.CreateEmergencyCase(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) NotifyEmergencyContact(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.NotifyEmergencyContact(c.Request.Context(), uid, c.Param("patientId"), h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) EscalateAmbulance(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.EscalateAmbulance(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

func (h *Handler) EscalateHospital(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	raw, ok := h.rawBody(c)
	if !ok {
		return
	}
	res, err := h.svc.EscalateHospital(c.Request.Context(), uid, h.idemKey(c), raw)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, res)
}

// ══ AI READ-BACK (advisory; nothing is stored) ══════════════════════════════

func (h *Handler) GetStoredNoteSummary(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetStoredNoteSummary(c.Request.Context(), uid, c.Param("appointmentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetStoredRxSafety(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetStoredRxSafety(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetStoredLabExplanation(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetStoredLabExplanation(c.Request.Context(), uid, c.Param("resultId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// ══ HMO ELIGIBILITY ═════════════════════════════════════════════════════════

func (h *Handler) GetHMOEligibility(c *gin.Context) {
	uid, ok := h.userID(c)
	if !ok {
		return
	}
	res, err := h.svc.GetHMOEligibility(c.Request.Context(), uid, c.Param("appointmentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
