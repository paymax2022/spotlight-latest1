package connectprofessional

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
		c.JSON(http.StatusNotFound, gin.H{"error": "no professional profile"})
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

// RequestVerification — POST /professional/verification {evidence_ref}.
// The handler accepts only an opaque encrypted reference; never raw documents.
func (h *Handler) RequestVerification(c *gin.Context) {
	var body struct {
		EvidenceRef string `json:"evidence_ref" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "evidence_ref required"})
		return
	}
	if err := h.svc.RequestBusinessVerification(c.Request.Context(), uid(c), body.EvidenceRef); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"data": gin.H{"status": "pending"}})
}

func (h *Handler) Discover(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	out, err := h.svc.Discover(c.Request.Context(), uid(c), c.Query("industry"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) SendIntro(c *gin.Context) {
	var in IntroInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.SendIntro(c.Request.Context(), uid(c), in)
	if err != nil {
		if errors.Is(err, ErrSelfIntro) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": r})
}

func (h *Handler) RespondIntro(c *gin.Context) {
	var body IntroResponse
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.RespondIntro(c.Request.Context(), uid(c), c.Param("id"), body.Accept)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotRecipient):
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

func (h *Handler) UpsertCard(c *gin.Context) {
	var in CardInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	bc, err := h.svc.UpsertCard(c.Request.Context(), uid(c), in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": bc})
}

// ExchangeCard — POST /professional/contacts {contact_id}. Requires accepted intro.
func (h *Handler) ExchangeCard(c *gin.Context) {
	var body struct {
		ContactID string `json:"contact_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sc, err := h.svc.ExchangeCard(c.Request.Context(), uid(c), body.ContactID)
	if err != nil {
		if errors.Is(err, ErrNoConsent) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": sc})
}

func (h *Handler) ListContacts(c *gin.Context) {
	out, err := h.svc.ListContacts(c.Request.Context(), uid(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) CreateRoom(c *gin.Context) {
	var in RoomInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.CreateRoom(c.Request.Context(), uid(c), in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": r})
}

func (h *Handler) JoinRoom(c *gin.Context) {
	if err := h.svc.JoinRoom(c.Request.Context(), uid(c), c.Param("id")); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"joined": true}})
}

func (h *Handler) ModerateRoom(c *gin.Context) {
	var in RoomModerationInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ModerateRoom(c.Request.Context(), uid(c), c.Param("id"), in); err != nil {
		if errors.Is(err, ErrNotRoomOwner) {
			c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"ok": true}})
}

// --- Admin ---

// AdminReviewVerification — POST /admin/business/verification {user_id, approve, reason}.
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
	if err := h.svc.ReviewBusinessVerification(c.Request.Context(), uid(c), body.UserID, body.Approve, body.Reason); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"reviewed": true}})
}
