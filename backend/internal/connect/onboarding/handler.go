package connectonboarding

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// AgeGate — POST /api/v1/connect/onboarding/age-gate (authenticated).
// 200 = adult; 403 = under 18 (queued for review); 400 = invalid DOB.
func (h *Handler) AgeGate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req AgeGateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	res, err := h.svc.AgeGate(c.Request.Context(), userID, req.DOB, c.ClientIP())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	switch {
	case res.Reason == "invalid_dob":
		c.JSON(http.StatusBadRequest, res)
	case !res.Allowed:
		c.JSON(http.StatusForbidden, res)
	default:
		c.JSON(http.StatusOK, res)
	}
}

// Consent — POST /api/v1/connect/onboarding/consent (authenticated).
func (h *Handler) Consent(c *gin.Context) {
	userID := c.GetString("user_id")
	var req ConsentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	st, err := h.svc.RecordConsent(c.Request.Context(), userID, req.Kind, req.Version, c.ClientIP())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, st)
}

// Status — GET /api/v1/connect/onboarding/status (authenticated).
func (h *Handler) Status(c *gin.Context) {
	st, err := h.svc.GetStatus(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, st)
}
