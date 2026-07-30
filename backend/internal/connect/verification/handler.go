package connectverification

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Phase-1 selfie/liveness verification endpoints. Additive:
// it does not touch the Phase-0 primitives.
type Handler struct{ svc *StatusService }

// NewHandler builds the verification HTTP handler.
func NewHandler(svc *StatusService) *Handler { return &Handler{svc: svc} }

// selfieRequest is the member body for POST /verification/selfie. The fields hold
// transient, sensitive references that are NEVER logged — only forwarded to the
// provider and discarded.
type selfieRequest struct {
	Level         string `json:"level"` // "l0" | "l1" (defaults l0)
	SelfieRef     string `json:"selfie_ref" binding:"required"`
	LivenessToken string `json:"liveness_token"` // sensitive, transient; not persisted/logged
}

// Selfie — POST /api/v1/connect/verification/selfie (authenticated member).
// Runs an L0–L1 liveness check; evidence is stored encrypted/opaque, never raw.
func (h *Handler) Selfie(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req selfieRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	level := VerificationLevel(req.Level)
	if req.Level != "" && !ValidLevel(level) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid verification level"})
		return
	}
	rec, err := h.svc.SubmitSelfie(c.Request.Context(), LivenessRequest{
		UserID:         userID,
		RequestedLevel: level,
		SelfieRef:      req.SelfieRef,
		LivenessToken:  req.LivenessToken,
	})
	if err != nil {
		// Reason codes/decisions surface in the record; only generic error text leaves here
		// (never the raw payload).
		c.JSON(http.StatusBadRequest, gin.H{"error": "verification could not be processed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}

// Status — GET /api/v1/connect/verification/status (authenticated member).
// Returns the caller's level + badge.
func (h *Handler) Status(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	rec, err := h.svc.Get(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read verification status"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rec})
}
