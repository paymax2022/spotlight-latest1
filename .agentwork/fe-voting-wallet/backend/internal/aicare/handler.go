package aicare

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) CreateSession(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CreateSessionRequest
	c.ShouldBindJSON(&req)
	sess, err := h.svc.CreateSession(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, sess)
}

func (h *Handler) SendMessage(c *gin.Context) {
	userID := c.GetString("user_id")
	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	userMsg, aiMsg, err := h.svc.SendMessage(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"user_message": userMsg, "ai_reply": aiMsg})
}

func (h *Handler) GetHistory(c *gin.Context) {
	userID := c.GetString("user_id")
	msgs, err := h.svc.GetHistory(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": msgs})
}

func (h *Handler) Escalate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req EscalateRequest
	c.ShouldBindJSON(&req)
	if err := h.svc.Escalate(c.Request.Context(), c.Param("id"), userID, req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) Resolve(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.Resolve(c.Request.Context(), c.Param("id"), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
