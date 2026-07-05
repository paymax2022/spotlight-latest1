package preconsult

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// handler.go — member (patient + assigned doctor) HTTP surface for the pre-consult
// intake, mounted under the health member group (/api/finance/health/intake/...).

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }
func fail(c *gin.Context, status int, msg string) {
	c.JSON(status, gin.H{"success": false, "error": msg})
}

// GetAppointmentIntake — GET /intake/appointments/:appointmentId
// Patient: get-or-create the intake + pinned schema + prefill + consent text + draft.
func (h *Handler) GetAppointmentIntake(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	view, err := h.svc.GetForPatient(c.Request.Context(), id, c.Param("appointmentId"))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": view})
}

// SaveDraft — PUT /intake/appointments/:appointmentId/draft  (patient autosave)
func (h *Handler) SaveDraft(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Answers map[string]any `json:"answers"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	it, err := h.svc.SaveDraft(c.Request.Context(), id, c.Param("appointmentId"), req.Answers)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "intake": it})
}

// Submit — POST /intake/appointments/:appointmentId/submit
// Patient: validate + red-flag + consent + gate. Returns red-flag interstitial data.
func (h *Handler) Submit(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Answers        map[string]any `json:"answers"`
		ConsentVersion int            `json:"consent_version"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	res, err := h.svc.Submit(c.Request.Context(), id, c.Param("appointmentId"), req.Answers, req.ConsentVersion)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": res})
}

// PresignAttachment — POST /intake/appointments/:appointmentId/attachments/presign
func (h *Handler) PresignAttachment(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Kind        string `json:"kind"`
		FileName    string `json:"fileName"`
		ContentType string `json:"contentType"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	res, err := h.svc.PresignAttachment(c.Request.Context(), id, c.Param("appointmentId"), req.Kind, req.FileName, req.ContentType)
	if err != nil {
		if err == ErrUploadsNotConfigured {
			fail(c, http.StatusServiceUnavailable, err.Error())
			return
		}
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": res})
}

// RecordAttachment — POST /intake/appointments/:appointmentId/attachments
// Echoes back the server-issued key + content type after the client PUTs to R2.
func (h *Handler) RecordAttachment(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Kind        string `json:"kind"`
		StorageKey  string `json:"storage_key"`
		ContentType string `json:"content_type"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	it, err := h.svc.RecordAttachment(c.Request.Context(), id, c.Param("appointmentId"), req.Kind, req.StorageKey, req.ContentType)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "intake": it})
}

// DoctorSummary — GET /intake/appointments/:appointmentId/doctor-summary
// Assigned doctor only; access is logged before PHI is returned.
func (h *Handler) DoctorSummary(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	sum, err := h.svc.GetForDoctor(c.Request.Context(), id, c.Param("appointmentId"))
	if err != nil {
		fail(c, http.StatusForbidden, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "summary": sum})
}

// HealthProfile — GET /intake/health-profile  (M17 longitudinal profile)
func (h *Handler) HealthProfile(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	hp, err := h.svc.HealthProfile(c.Request.Context(), id)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "profile": hp})
}

// SuggestComplaint — POST /intake/symptom-assist  (optional AI pre-fill, M4)
func (h *Handler) SuggestComplaint(c *gin.Context) {
	id := uid(c)
	if id == "" {
		fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	sug, err := h.svc.SuggestComplaint(c.Request.Context(), req.Text)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "suggestion": sug})
}
