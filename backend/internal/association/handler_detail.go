package association

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Handlers for the gap-fill endpoints (detail reads, profile update, audit-log,
// ai-note regenerate, chat reaction). Error→HTTP via statusFor.

// GET /associations/announcements/:id
func (h *Handler) GetAnnouncement(c *gin.Context) {
	v, err := h.svc.GetAnnouncement(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// GET /associations/meetings/:id
func (h *Handler) GetMeeting(c *gin.Context) {
	v, err := h.svc.GetMeeting(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// GET /associations/tasks/:id
func (h *Handler) GetTask(c *gin.Context) {
	v, err := h.svc.GetTask(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// GET /associations/documents/:id
func (h *Handler) GetDocument(c *gin.Context) {
	v, err := h.svc.GetDocument(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// GET /associations/committees/:id
func (h *Handler) GetCommittee(c *gin.Context) {
	v, err := h.svc.GetCommittee(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// GET /associations/events/:id
func (h *Handler) GetEvent(c *gin.Context) {
	v, err := h.svc.GetEvent(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// PUT /associations/me/profile
func (h *Handler) UpdateProfile(c *gin.Context) {
	var in UpdateProfileInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.UpdateProfile(c.Request.Context(), c.GetString("user_id"), in)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// GET /associations/admin/audit-log
func (h *Handler) GetAuditLog(c *gin.Context) {
	v, err := h.svc.GetAuditLog(c.Request.Context(), c.GetString("user_id"), c.Query("action"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

// POST /associations/ai-notes/:id/regenerate-summary
func (h *Handler) RegenerateAiNoteSummary(c *gin.Context) {
	if err := h.svc.RegenerateAiNoteSummary(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "status": "PROCESSING"})
}

// POST /associations/chat/threads/:id/messages/:messageId/react
func (h *Handler) ReactToMessage(c *gin.Context) {
	var b ReactRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ReactToMessage(c.Request.Context(), c.GetString("user_id"), c.Param("id"), c.Param("messageId"), b.Emoji); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
