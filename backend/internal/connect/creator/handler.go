package connectcreator

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string { return c.GetString("user_id") }

func (h *Handler) GetProfile(c *gin.Context) {
	p, err := h.svc.GetProfile(c.Request.Context(), uid(c))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no creator profile"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) UpsertProfile(c *gin.Context) {
	var in ProfileInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.UpsertProfile(c.Request.Context(), uid(c), in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func (h *Handler) AddPortfolio(c *gin.Context) {
	var in PortfolioInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	it, err := h.svc.AddPortfolioItem(c.Request.Context(), uid(c), in)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidKind):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, ErrNoProfile):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": it})
}

func (h *Handler) ListPortfolio(c *gin.Context) {
	out, err := h.svc.ListPortfolio(c.Request.Context(), uid(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RequestVerification — POST /creator/verification {evidence_ref}.
func (h *Handler) RequestVerification(c *gin.Context) {
	var body struct {
		EvidenceRef string `json:"evidence_ref" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "evidence_ref required"})
		return
	}
	if err := h.svc.RequestVerification(c.Request.Context(), uid(c), body.EvidenceRef); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"data": gin.H{"status": "pending"}})
}

// SetFanPolicy — PATCH /creator/fan-messages {fan_messages}.
func (h *Handler) SetFanPolicy(c *gin.Context) {
	var in FanPolicyInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetFanPolicy(c.Request.Context(), uid(c), FanMessagePolicy(in.FanMessages)); err != nil {
		if errors.Is(err, ErrInvalidPolicy) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"fan_messages": in.FanMessages}})
}

// SubmitCollab — POST /creator/collab-requests.
func (h *Handler) SubmitCollab(c *gin.Context) {
	var in CollabInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.SubmitCollab(c.Request.Context(), uid(c), in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": r})
}

// ListCollabs — GET /creator/collab-requests (creator inbox).
func (h *Handler) ListCollabs(c *gin.Context) {
	out, err := h.svc.ListCollabsForCreator(c.Request.Context(), uid(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// RespondCollab — POST /creator/collab-requests/:id/respond {accept}.
func (h *Handler) RespondCollab(c *gin.Context) {
	var body CollabResponse
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.RespondCollab(c.Request.Context(), uid(c), c.Param("id"), body.Accept)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotCreator):
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		case errors.Is(err, ErrBadTransition):
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": r})
}

// --- Admin ---

// AdminVerificationQueue — GET /admin/creator/verification.
func (h *Handler) AdminVerificationQueue(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.ListVerificationQueue(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminReviewVerification — POST /admin/creator/verification {user_id, approve, reason}.
func (h *Handler) AdminReviewVerification(c *gin.Context) {
	var body struct {
		UserID  string `json:"user_id" binding:"required"`
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ReviewVerification(c.Request.Context(), uid(c), body.UserID, body.Approve, body.Reason); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"reviewed": true}})
}
