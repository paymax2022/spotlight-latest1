package association

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GET /associations/me/dues
func (h *Handler) GetDues(c *gin.Context) {
	userID := c.GetString("user_id")
	dues, err := h.svc.GetDues(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, dues)
}

// POST /associations/dues/:invoiceId/pay
func (h *Handler) PayInvoice(c *gin.Context) {
	userID := c.GetString("user_id")
	var req PayInvoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.IdempotencyKey = c.GetHeader("Idempotency-Key")
	res, err := h.svc.PayInvoice(c.Request.Context(), userID, c.Param("invoiceId"), req)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// GET /associations/receipts/:receiptId
func (h *Handler) GetReceipt(c *gin.Context) {
	userID := c.GetString("user_id")
	r, err := h.svc.GetReceipt(c.Request.Context(), userID, c.Param("receiptId"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}

// POST /associations/admin/approvals/:id/decision
func (h *Handler) DecideApplication(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req ApprovalDecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.IdempotencyKey = c.GetHeader("Idempotency-Key")
	if err := h.svc.DecideApplication(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Discovery ────────────────────────────────────────────────────────────────

// GET /associations
func (h *Handler) ListOrganisations(c *gin.Context) {
	orgs, err := h.svc.GetOrganisations(c.Request.Context(), c.Query("search"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, orgs)
}

// GET /associations/:id
func (h *Handler) GetOrganisation(c *gin.Context) {
	org, err := h.svc.GetOrganisation(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, org)
}

// ── Member identity & dashboard ───────────────────────────────────────────────

// GET /associations/me/dashboard
func (h *Handler) GetDashboard(c *gin.Context) {
	d, err := h.svc.GetDashboard(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, d)
}

// GET /associations/me/card
func (h *Handler) GetCard(c *gin.Context) {
	card, err := h.svc.GetCard(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, card)
}

// GET /associations/me/profile
func (h *Handler) GetProfile(c *gin.Context) {
	p, err := h.svc.GetProfile(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

// GET /associations/me/privacy
func (h *Handler) GetPrivacy(c *gin.Context) {
	ps, err := h.svc.GetPrivacy(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ps)
}

// PUT /associations/me/privacy
func (h *Handler) UpdatePrivacy(c *gin.Context) {
	var req PrivacySettings
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ps, err := h.svc.UpdatePrivacy(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, ps)
}

// GET /associations/me/activity
func (h *Handler) GetActivity(c *gin.Context) {
	entries, err := h.svc.GetActivity(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, entries)
}

// GET /associations/me/admin-access
func (h *Handler) GetAdminAccess(c *gin.Context) {
	access, err := h.svc.GetAdminAccess(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, access)
}

// ── Directory ─────────────────────────────────────────────────────────────────

// GET /associations/members
func (h *Handler) ListMembers(c *gin.Context) {
	var q MemberDirectoryQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	members, err := h.svc.GetDirectory(c.Request.Context(), c.GetString("user_id"), q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, members)
}

// GET /associations/members/:id
func (h *Handler) GetMember(c *gin.Context) {
	member, err := h.svc.GetMember(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, member)
}

// ── Engagement ────────────────────────────────────────────────────────────────

// GET /associations/announcements
func (h *Handler) ListAnnouncements(c *gin.Context) {
	list, err := h.svc.GetAnnouncements(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/notifications
func (h *Handler) ListNotifications(c *gin.Context) {
	list, err := h.svc.GetNotifications(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// ── Meetings ──────────────────────────────────────────────────────────────────

// GET /associations/meetings
func (h *Handler) ListMeetings(c *gin.Context) {
	list, err := h.svc.GetMeetings(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

// GET /associations/tasks
func (h *Handler) ListTasks(c *gin.Context) {
	list, err := h.svc.GetTasks(c.Request.Context(), c.GetString("user_id"), c.Query("scope"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// ── Documents ─────────────────────────────────────────────────────────────────

// GET /associations/documents
func (h *Handler) ListDocuments(c *gin.Context) {
	list, err := h.svc.GetDocuments(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// ── Community ─────────────────────────────────────────────────────────────────

// GET /associations/committees
func (h *Handler) ListCommittees(c *gin.Context) {
	list, err := h.svc.GetCommittees(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/events
func (h *Handler) ListEvents(c *gin.Context) {
	list, err := h.svc.GetEvents(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// ── Admin reads ───────────────────────────────────────────────────────────────

// GET /associations/admin/kpis
func (h *Handler) GetAdminKpis(c *gin.Context) {
	kpis, err := h.svc.GetAdminKpis(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, kpis)
}

// GET /associations/admin/approvals
func (h *Handler) ListApprovals(c *gin.Context) {
	list, err := h.svc.GetApprovalQueue(c.Request.Context(), c.GetString("user_id"), c.Query("jurisdiction"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/admin/approvals/:id
func (h *Handler) GetApproval(c *gin.Context) {
	app, err := h.svc.GetApplication(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, app)
}

// GET /associations/admin/finance
func (h *Handler) GetFinanceSummary(c *gin.Context) {
	fs, err := h.svc.GetFinanceSummary(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, fs)
}

// GET /associations/admin/finance/offline
func (h *Handler) ListOfflinePayments(c *gin.Context) {
	list, err := h.svc.GetOfflinePayments(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// statusFor maps domain errors to HTTP codes.
func statusFor(err error) int {
	switch {
	case errors.Is(err, ErrIdempotencyRequired), errors.Is(err, ErrInvalidBallot):
		return http.StatusBadRequest
	case errors.Is(err, ErrForbidden), errors.Is(err, ErrIneligible), errors.Is(err, ErrVotingClosed):
		return http.StatusForbidden
	case errors.Is(err, ErrElectionState):
		return http.StatusConflict
	default:
		return http.StatusInternalServerError
	}
}
