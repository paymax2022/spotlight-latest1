package preconsult

import (
	"encoding/json"
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// handler.go — member (patient + assigned doctor) HTTP surface for the pre-consult
// intake, mounted under the health member group (/api/finance/health/intake/...).

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uuidAppointmentID gates :appointmentId before it reaches pgx —
// health_appointments.id is uuid, so a malformed value otherwise surfaces as a
// driver error instead of a clean 400.
func uuidAppointmentID(c *gin.Context) bool {
	if _, err := uuid.Parse(c.Param("appointmentId")); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "appointmentId must be a uuid")
		return false
	}
	return true
}

// preconsultFail maps service errors onto statuses that do not leak existence:
// ErrAppointmentNotFound / ErrIntakeNotFound (missing OR foreign — uniform) →
// 404; ErrUploadsNotConfigured → 503; anything else → the caller's default
// status. FailOK sanitizes the message.
func preconsultFail(c *gin.Context, err error, defCode int) {
	switch {
	case errors.Is(err, ErrAppointmentNotFound):
		ginutil.FailOK(c, http.StatusNotFound, "appointment not found")
	case errors.Is(err, ErrIntakeNotFound):
		ginutil.FailOK(c, http.StatusNotFound, "intake not found")
	case errors.Is(err, ErrUploadsNotConfigured):
		ginutil.FailOK(c, http.StatusServiceUnavailable, err.Error())
	default:
		ginutil.FailOK(c, defCode, err.Error())
	}
}

// GetAppointmentIntake — GET /intake/appointments/:appointmentId
// Patient: get-or-create the intake + pinned schema + prefill + consent text + draft.
func (h *Handler) GetAppointmentIntake(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !uuidAppointmentID(c) {
		return
	}
	view, err := h.svc.GetForPatient(c.Request.Context(), id, c.Param("appointmentId"))
	if err != nil {
		preconsultFail(c, err, http.StatusForbidden)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": view})
}

// SaveDraft — PUT /intake/appointments/:appointmentId/draft  (patient autosave)
func (h *Handler) SaveDraft(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Answers map[string]any `json:"answers"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if !uuidAppointmentID(c) {
		return
	}
	it, err := h.svc.SaveDraft(c.Request.Context(), id, c.Param("appointmentId"), req.Answers)
	if err != nil {
		preconsultFail(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "intake": it})
}

// Submit — POST /intake/appointments/:appointmentId/submit
// Patient: validate + red-flag + consent + gate. Returns red-flag interstitial data.
func (h *Handler) Submit(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Answers        map[string]any `json:"answers"`
		ConsentVersion int            `json:"consent_version"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if !uuidAppointmentID(c) {
		return
	}
	res, err := h.svc.Submit(c.Request.Context(), id, c.Param("appointmentId"), req.Answers, req.ConsentVersion)
	if err != nil {
		preconsultFail(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "data": res})
}

// PresignAttachment — POST /intake/appointments/:appointmentId/attachments/presign
func (h *Handler) PresignAttachment(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Kind        string `json:"kind"`
		FileName    string `json:"fileName"`
		ContentType string `json:"contentType"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if !uuidAppointmentID(c) {
		return
	}
	res, err := h.svc.PresignAttachment(c.Request.Context(), id, c.Param("appointmentId"), req.Kind, req.FileName, req.ContentType)
	if err != nil {
		preconsultFail(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": res})
}

// RecordAttachment — POST /intake/appointments/:appointmentId/attachments
// Echoes back the server-issued key + content type after the client PUTs to R2.
func (h *Handler) RecordAttachment(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Kind        string `json:"kind"`
		StorageKey  string `json:"storage_key"`
		ContentType string `json:"content_type"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if !uuidAppointmentID(c) {
		return
	}
	it, err := h.svc.RecordAttachment(c.Request.Context(), id, c.Param("appointmentId"), req.Kind, req.StorageKey, req.ContentType)
	if err != nil {
		preconsultFail(c, err, http.StatusBadRequest)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "intake": it})
}

// DoctorSummary — GET /intake/appointments/:appointmentId/doctor-summary
// Assigned doctor only; access is logged before PHI is returned.
func (h *Handler) DoctorSummary(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if !uuidAppointmentID(c) {
		return
	}
	sum, err := h.svc.GetForDoctor(c.Request.Context(), id, c.Param("appointmentId"))
	if err != nil {
		preconsultFail(c, err, http.StatusForbidden)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "summary": sum})
}

// HealthProfile — GET /intake/health-profile  (M17 longitudinal profile)
func (h *Handler) HealthProfile(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	hp, err := h.svc.HealthProfile(c.Request.Context(), id)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "profile": hp})
}

// SuggestComplaint — POST /intake/symptom-assist  (optional AI pre-fill, M4)
func (h *Handler) SuggestComplaint(c *gin.Context) {
	id := ginutil.UserID(c)
	if id == "" {
		ginutil.FailOK(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Text string `json:"text"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	sug, err := h.svc.SuggestComplaint(c.Request.Context(), req.Text)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "suggestion": sug})
}

// HTTP surface for the admin console (A2–A13), mounted under
// /api/health/admin/intake with RBAC health.admin.intake at the wiring layer.

type AdminHandler struct{ svc *Service }

func NewAdminHandler(svc *Service) *AdminHandler { return &AdminHandler{svc: svc} }

// ListRules — Red-flag rules (A2)
func (h *AdminHandler) ListRules(c *gin.Context) {
	rules, err := h.svc.ListRedFlagRules(c.Request.Context())
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rules": rules})
}

func (h *AdminHandler) UpsertRule(c *gin.Context) {
	var r RedFlagRule
	if err := c.ShouldBindJSON(&r); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.UpsertRedFlagRule(c.Request.Context(), ginutil.UserID(c), r)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rule": out})
}

func (h *AdminHandler) ToggleRule(c *gin.Context) {
	var req struct {
		Active bool `json:"active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.ToggleRedFlagRule(c.Request.Context(), ginutil.UserID(c), c.Param("code"), req.Active)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rule": out})
}

// ListConsent — Consent versions (A4)
func (h *AdminHandler) ListConsent(c *gin.Context) {
	out, err := h.svc.ListConsentVersions(c.Request.Context())
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "versions": out})
}

func (h *AdminHandler) CreateConsent(c *gin.Context) {
	var v ConsentVersion
	if err := c.ShouldBindJSON(&v); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.CreateConsentVersion(c.Request.Context(), ginutil.UserID(c), v)
	if err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "version": out})
}

// ListVocab — Clinical vocab (A3)
func (h *AdminHandler) ListVocab(c *gin.Context) {
	out, err := h.svc.ListVocab(c.Request.Context(), c.Query("kind"))
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "vocab": out})
}

func (h *AdminHandler) UpsertVocab(c *gin.Context) {
	var req struct {
		Kind   string `json:"kind"`
		Code   string `json:"code"`
		Label  string `json:"label"`
		Active bool   `json:"active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.UpsertVocab(c.Request.Context(), ginutil.UserID(c), req.Kind, req.Code, req.Label, req.Active); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// GetConfig — Config get/set (A1/A5/A6/A7)
func (h *AdminHandler) GetConfig(c *gin.Context) {
	raw, err := h.svc.GetConfig(c.Request.Context(), c.Param("key"))
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	if raw == nil {
		raw = json.RawMessage("null")
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "key": c.Param("key"), "value": raw})
}

func (h *AdminHandler) SetConfig(c *gin.Context) {
	var req struct {
		Value json.RawMessage `json:"value"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.SetConfig(c.Request.Context(), ginutil.UserID(c), c.Param("key"), req.Value); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Monitoring — Intake monitoring (A8)
func (h *AdminHandler) Monitoring(c *gin.Context) {
	incompleteOnly := c.Query("incomplete") == "true"
	near, _ := strconv.Atoi(c.Query("near_minutes"))
	out, err := h.svc.Monitoring(c.Request.Context(), incompleteOnly, near)
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointments": out})
}

// ViewIntake — Intake record viewer (A9; access-logged)
func (h *AdminHandler) ViewIntake(c *gin.Context) {
	if !uuidAppointmentID(c) {
		return
	}
	out, err := h.svc.AdminViewIntake(c.Request.Context(), ginutil.UserID(c), c.Param("appointmentId"))
	if err != nil {
		ginutil.FailOK(c, http.StatusNotFound, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "record": out})
}

// AccessLog — Access & audit log (A10)
func (h *AdminHandler) AccessLog(c *gin.Context) {
	out, err := h.svc.AccessLog(c.Request.Context(), c.Query("intake_id"))
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "access": out})
}

// RedFlagQueue — Red-flag queue (A11)
func (h *AdminHandler) RedFlagQueue(c *gin.Context) {
	out, err := h.svc.RedFlagQueue(c.Request.Context())
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "queue": out})
}

func (h *AdminHandler) Analytics(c *gin.Context) {
	out, err := h.svc.Analytics(c.Request.Context())
	if err != nil {
		ginutil.FailOK(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "analytics": out})
}
