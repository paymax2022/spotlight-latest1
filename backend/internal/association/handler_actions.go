package association

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Write-path (mutation) handlers, kept separate from handler.go to reduce merge
// surface. Error→HTTP mapping uses statusFor (handler.go).

// ─── Engagement ───────────────────────────────────────────────────────────────

// POST /associations/announcements/:id/acknowledge
func (h *Handler) AcknowledgeAnnouncement(c *gin.Context) {
	if err := h.svc.AcknowledgeAnnouncement(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /associations/notifications/read
func (h *Handler) MarkNotificationsRead(c *gin.Context) {
	if err := h.svc.MarkNotificationsRead(c.Request.Context(), c.GetString("user_id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

type rsvpBody struct {
	Status string `json:"status"`
}

// POST /associations/meetings/:id/rsvp
func (h *Handler) RsvpMeeting(c *gin.Context) {
	var b rsvpBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RsvpMeeting(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b.Status); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /associations/meetings/:id/attendance
func (h *Handler) CheckInMeeting(c *gin.Context) {
	if err := h.svc.CheckInMeeting(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

type taskStatusBody struct {
	Status string `json:"status" binding:"required"`
}

// PATCH /associations/tasks/:id
func (h *Handler) UpdateTaskStatus(c *gin.Context) {
	var b taskStatusBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateTaskStatus(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b.Status); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Documents ────────────────────────────────────────────────────────────────

// POST /associations/documents/:id/acknowledge
func (h *Handler) AcknowledgeDocument(c *gin.Context) {
	if err := h.svc.AcknowledgeDocument(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Committees ───────────────────────────────────────────────────────────────

// POST /associations/committees/:id/join
func (h *Handler) JoinCommittee(c *gin.Context) {
	if err := h.svc.RequestJoinCommittee(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Events ───────────────────────────────────────────────────────────────────

type eventRsvpBody struct {
	Rsvp string `json:"rsvp"`
}
type eventFeedbackBody struct {
	Rating  int    `json:"rating"`
	Comment string `json:"comment"`
}

// POST /associations/events/:id/rsvp
func (h *Handler) RsvpEvent(c *gin.Context) {
	var b eventRsvpBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RsvpEvent(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b.Rsvp); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /associations/events/:id/register
func (h *Handler) RegisterEvent(c *gin.Context) {
	ticket, err := h.svc.RegisterEvent(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "ticketCode": ticket})
}

// POST /associations/events/:id/feedback
func (h *Handler) SubmitEventFeedback(c *gin.Context) {
	var b eventFeedbackBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SubmitEventFeedback(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b.Rating, b.Comment); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ─── Admin: offline payment + member actions ──────────────────────────────────

type offlineDecisionBody struct {
	Approve bool `json:"approve"`
}
type suspendBody struct {
	Reason string `json:"reason"`
}
type transferBody struct {
	Chapter string `json:"chapter" binding:"required"`
}
type roleBody struct {
	Role string `json:"role" binding:"required"`
}

// POST /associations/admin/finance/offline/:id/decision
func (h *Handler) DecideOfflinePayment(c *gin.Context) {
	var b offlineDecisionBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	idemKey := c.GetHeader("Idempotency-Key")
	if err := h.svc.DecideOfflinePayment(c.Request.Context(), c.GetString("user_id"), c.Param("id"), idemKey, b.Approve); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /associations/admin/members/:id/suspend
func (h *Handler) SuspendMember(c *gin.Context) {
	var b suspendBody
	_ = c.ShouldBindJSON(&b) // reason optional
	if err := h.svc.SuspendMember(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b.Reason); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /associations/admin/members/:id/restore
func (h *Handler) RestoreMember(c *gin.Context) {
	if err := h.svc.RestoreMember(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /associations/admin/members/:id/transfer
func (h *Handler) TransferMember(c *gin.Context) {
	var b transferBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.TransferMember(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b.Chapter); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// POST /associations/admin/members/import?org_id=<uuid>
func (h *Handler) BulkImportMembers(c *gin.Context) {
	orgID := c.Query("org_id")
	if orgID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "org_id query param required"})
		return
	}
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "multipart file 'file' required"})
		return
	}
	defer file.Close()
	n, err := h.svc.BulkImportMembers(c.Request.Context(), c.GetString("user_id"), orgID, file)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "imported": n})
}

// POST /associations/admin/members/:id/role
func (h *Handler) AssignRole(c *gin.Context) {
	var b roleBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.AssignRole(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b.Role); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
