package preconsult

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// admin_handler.go — HTTP surface for the admin console (A2–A13), mounted under
// /api/health/admin/intake with RBAC health.admin.intake at the wiring layer.

type AdminHandler struct{ svc *Service }

func NewAdminHandler(svc *Service) *AdminHandler { return &AdminHandler{svc: svc} }

// Red-flag rules (A2)
func (h *AdminHandler) ListRules(c *gin.Context) {
	rules, err := h.svc.ListRedFlagRules(c.Request.Context())
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rules": rules})
}

func (h *AdminHandler) UpsertRule(c *gin.Context) {
	var r RedFlagRule
	if err := c.ShouldBindJSON(&r); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.UpsertRedFlagRule(c.Request.Context(), uid(c), r)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rule": out})
}

func (h *AdminHandler) ToggleRule(c *gin.Context) {
	var req struct {
		Active bool `json:"active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.ToggleRedFlagRule(c.Request.Context(), uid(c), c.Param("code"), req.Active)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rule": out})
}

// Consent versions (A4)
func (h *AdminHandler) ListConsent(c *gin.Context) {
	out, err := h.svc.ListConsentVersions(c.Request.Context())
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "versions": out})
}

func (h *AdminHandler) CreateConsent(c *gin.Context) {
	var v ConsentVersion
	if err := c.ShouldBindJSON(&v); err != nil {
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	out, err := h.svc.CreateConsentVersion(c.Request.Context(), uid(c), v)
	if err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "version": out})
}

// Clinical vocab (A3)
func (h *AdminHandler) ListVocab(c *gin.Context) {
	out, err := h.svc.ListVocab(c.Request.Context(), c.Query("kind"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
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
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.UpsertVocab(c.Request.Context(), uid(c), req.Kind, req.Code, req.Label, req.Active); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Config get/set (A1/A5/A6/A7)
func (h *AdminHandler) GetConfig(c *gin.Context) {
	raw, err := h.svc.GetConfig(c.Request.Context(), c.Param("key"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
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
		fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.svc.SetConfig(c.Request.Context(), uid(c), c.Param("key"), req.Value); err != nil {
		fail(c, http.StatusBadRequest, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Intake monitoring (A8)
func (h *AdminHandler) Monitoring(c *gin.Context) {
	incompleteOnly := c.Query("incomplete") == "true"
	near, _ := strconv.Atoi(c.Query("near_minutes"))
	out, err := h.svc.Monitoring(c.Request.Context(), incompleteOnly, near)
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "appointments": out})
}

// Intake record viewer (A9; access-logged)
func (h *AdminHandler) ViewIntake(c *gin.Context) {
	out, err := h.svc.AdminViewIntake(c.Request.Context(), uid(c), c.Param("appointmentId"))
	if err != nil {
		fail(c, http.StatusNotFound, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "record": out})
}

// Access & audit log (A10)
func (h *AdminHandler) AccessLog(c *gin.Context) {
	out, err := h.svc.AccessLog(c.Request.Context(), c.Query("intake_id"))
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "access": out})
}

// Red-flag queue (A11)
func (h *AdminHandler) RedFlagQueue(c *gin.Context) {
	out, err := h.svc.RedFlagQueue(c.Request.Context())
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "queue": out})
}

// Analytics (A12/A13)
func (h *AdminHandler) Analytics(c *gin.Context) {
	out, err := h.svc.Analytics(c.Request.Context())
	if err != nil {
		fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "analytics": out})
}
