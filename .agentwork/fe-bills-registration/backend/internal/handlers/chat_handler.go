package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/services"
)

type ChatHandler struct{ service services.ChatService }

func NewChatHandler(service services.ChatService) *ChatHandler { return &ChatHandler{service: service} }

func (h *ChatHandler) ListSessions(c *gin.Context) {
	limitRaw := c.DefaultQuery("limit", "50")
	limit, _ := strconv.Atoi(limitRaw)
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	chats, err := h.service.ListSessions(limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load chats"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "chats": chats})
}

func (h *ChatHandler) GetSession(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "chat id is required"})
		return
	}
	detail, err := h.service.GetSessionDetail(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load chat transcript"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success":  true,
		"session":  detail.Session,
		"messages": detail.Messages,
		"events":   detail.Events,
	})
}
