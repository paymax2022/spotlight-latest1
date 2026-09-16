package association

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Content-authoring handlers. Authorization lives in the service layer
// (requireOrgAdmin / requireCapInOrg); nothing here authorizes on its own.

// bindCreate is the shared shape of every "create under an organisation" route.
func bindCreate[T any](c *gin.Context, fn func(adminID, orgID string, body T) (string, error)) {
	var b T
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := fn(c.GetString("user_id"), c.Param("id"), b)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

// bindUpdate is the shared shape of every "update a child by id" route.
func bindUpdate[T any](c *gin.Context, fn func(adminID, id string, body T) error) {
	var b T
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := fn(c.GetString("user_id"), c.Param("childId"), b); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// bindDelete is the shared shape of every "delete a child by id" route.
func bindDelete(c *gin.Context, fn func(adminID, id string) error) {
	if err := fn(c.GetString("user_id"), c.Param("childId")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Announcements ────────────────────────────────────────────────────────────

func (h *Handler) CreateAnnouncement(c *gin.Context) {
	bindCreate(c, func(a, o string, b AnnouncementRequest) (string, error) {
		return h.svc.CreateAnnouncement(c.Request.Context(), a, o, b)
	})
}

func (h *Handler) UpdateAnnouncement(c *gin.Context) {
	bindUpdate(c, func(a, id string, b AnnouncementRequest) error {
		return h.svc.UpdateAnnouncement(c.Request.Context(), a, id, b)
	})
}

func (h *Handler) DeleteAnnouncement(c *gin.Context) {
	bindDelete(c, func(a, id string) error { return h.svc.DeleteAnnouncement(c.Request.Context(), a, id) })
}

// ── Meetings ─────────────────────────────────────────────────────────────────

func (h *Handler) CreateMeeting(c *gin.Context) {
	bindCreate(c, func(a, o string, b MeetingRequest) (string, error) {
		return h.svc.CreateMeeting(c.Request.Context(), a, o, b)
	})
}

func (h *Handler) UpdateMeeting(c *gin.Context) {
	bindUpdate(c, func(a, id string, b MeetingRequest) error {
		return h.svc.UpdateMeeting(c.Request.Context(), a, id, b)
	})
}

func (h *Handler) DeleteMeeting(c *gin.Context) {
	bindDelete(c, func(a, id string) error { return h.svc.DeleteMeeting(c.Request.Context(), a, id) })
}

// POST /admin/meetings/:childId/minutes  {"published": true}
func (h *Handler) PublishMinutes(c *gin.Context) {
	var b struct {
		Published bool `json:"published"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.PublishMinutes(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), b.Published); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Documents ────────────────────────────────────────────────────────────────

func (h *Handler) CreateDocument(c *gin.Context) {
	bindCreate(c, func(a, o string, b DocumentRequest) (string, error) {
		return h.svc.CreateDocument(c.Request.Context(), a, o, b)
	})
}

func (h *Handler) UpdateDocument(c *gin.Context) {
	bindUpdate(c, func(a, id string, b DocumentRequest) error {
		return h.svc.UpdateDocument(c.Request.Context(), a, id, b)
	})
}

func (h *Handler) DeleteDocument(c *gin.Context) {
	bindDelete(c, func(a, id string) error { return h.svc.DeleteDocument(c.Request.Context(), a, id) })
}

// ── Events ───────────────────────────────────────────────────────────────────

func (h *Handler) CreateEvent(c *gin.Context) {
	bindCreate(c, func(a, o string, b EventRequest) (string, error) {
		return h.svc.CreateEvent(c.Request.Context(), a, o, b)
	})
}

func (h *Handler) UpdateEvent(c *gin.Context) {
	bindUpdate(c, func(a, id string, b EventRequest) error {
		return h.svc.UpdateEvent(c.Request.Context(), a, id, b)
	})
}

func (h *Handler) DeleteEvent(c *gin.Context) {
	bindDelete(c, func(a, id string) error { return h.svc.DeleteEvent(c.Request.Context(), a, id) })
}

// ── Tasks ────────────────────────────────────────────────────────────────────

func (h *Handler) CreateTask(c *gin.Context) {
	bindCreate(c, func(a, o string, b TaskRequest) (string, error) {
		return h.svc.CreateTask(c.Request.Context(), a, o, b)
	})
}

func (h *Handler) UpdateTaskAdmin(c *gin.Context) {
	bindUpdate(c, func(a, id string, b TaskRequest) error {
		return h.svc.UpdateTask(c.Request.Context(), a, id, b)
	})
}

func (h *Handler) DeleteTask(c *gin.Context) {
	bindDelete(c, func(a, id string) error { return h.svc.DeleteTask(c.Request.Context(), a, id) })
}

// ── Dues (money path) ────────────────────────────────────────────────────────

// POST /admin/organisations/:id/dues/run
func (h *Handler) RunDues(c *gin.Context) {
	var b DuesRunRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b.IdempotencyKey = c.GetHeader("Idempotency-Key")
	res, err := h.svc.RunDues(c.Request.Context(), c.GetString("user_id"), c.Param("id"), b)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// POST /admin/invoices
func (h *Handler) CreateInvoice(c *gin.Context) {
	var b InvoiceRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	b.IdempotencyKey = c.GetHeader("Idempotency-Key")
	id, err := h.svc.CreateInvoice(c.Request.Context(), c.GetString("user_id"), b)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

// ── Devices (member self-service) ────────────────────────────────────────────

// POST /me/devices
func (h *Handler) RegisterDevice(c *gin.Context) {
	var b DeviceRequest
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.RegisterDevice(c.Request.Context(), c.GetString("user_id"), b)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

// ── Admin content listings ───────────────────────────────────────────────────
// The member-facing reads join through the CALLER's own memberships, which
// returns nothing for a platform admin. These take an explicit organisation.

// contentList builds a handler for one org-scoped admin listing.
func (h *Handler) contentList(fn func(c *gin.Context, adminID, orgID string, limit, offset int) ([]AdminContentRow, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit, offset := pageParams(c)
		rows, err := fn(c, c.GetString("user_id"), c.Param("id"), limit, offset)
		if err != nil {
			c.JSON(statusFor(err), gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, rows)
	}
}

func (h *Handler) ListAdminAnnouncements() gin.HandlerFunc {
	return h.contentList(func(c *gin.Context, a, o string, l, off int) ([]AdminContentRow, error) {
		return h.svc.ListAdminAnnouncements(c.Request.Context(), a, o, l, off)
	})
}

func (h *Handler) ListAdminMeetings() gin.HandlerFunc {
	return h.contentList(func(c *gin.Context, a, o string, l, off int) ([]AdminContentRow, error) {
		return h.svc.ListAdminMeetings(c.Request.Context(), a, o, l, off)
	})
}

func (h *Handler) ListAdminDocuments() gin.HandlerFunc {
	return h.contentList(func(c *gin.Context, a, o string, l, off int) ([]AdminContentRow, error) {
		return h.svc.ListAdminDocuments(c.Request.Context(), a, o, l, off)
	})
}

func (h *Handler) ListAdminEvents() gin.HandlerFunc {
	return h.contentList(func(c *gin.Context, a, o string, l, off int) ([]AdminContentRow, error) {
		return h.svc.ListAdminEvents(c.Request.Context(), a, o, l, off)
	})
}

func (h *Handler) ListAdminTasks() gin.HandlerFunc {
	return h.contentList(func(c *gin.Context, a, o string, l, off int) ([]AdminContentRow, error) {
		return h.svc.ListAdminTasks(c.Request.Context(), a, o, l, off)
	})
}

func (h *Handler) ListAdminDuesRuns() gin.HandlerFunc {
	return h.contentList(func(c *gin.Context, a, o string, l, off int) ([]AdminContentRow, error) {
		return h.svc.ListAdminDuesRuns(c.Request.Context(), a, o, l, off)
	})
}

// ── Member-proposed meetings ─────────────────────────────────────────────────

// ProposeMeeting — POST /associations/meetings.
// Any active member may call it; an admin's proposal is approved on insert,
// everyone else's starts pending. 201 with the resulting approvalStatus so the
// client can say which of the two happened.
func (h *Handler) ProposeMeeting(c *gin.Context) {
	var r MeetingRequest
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, approval, err := h.svc.ProposeMeeting(c.Request.Context(), c.GetString("user_id"), r)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id, "approvalStatus": approval})
}

// DecideMeeting — POST /associations/admin/meetings/:childId/decision.
func (h *Handler) DecideMeeting(c *gin.Context) {
	var d MeetingApprovalDecision
	if err := c.ShouldBindJSON(&d); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	status, err := h.svc.DecideMeeting(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), d)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"approvalStatus": status})
}

// ListPendingMeetings — GET /associations/admin/organisations/:id/meetings/pending.
func (h *Handler) ListPendingMeetings(c *gin.Context) {
	items, err := h.svc.GetPendingMeetings(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// InviteToEventRequest is the body for POST /admin/events/:childId/invite.
type InviteToEventRequest struct {
	// MembershipIDs in the event's own organisation. Ids from elsewhere are
	// dropped rather than erroring, so one stale id cannot fail the whole invite.
	MembershipIDs []string `json:"membershipIds" binding:"required"`
}

// InviteToEvent — POST /associations/admin/events/:childId/invite.
func (h *Handler) InviteToEvent(c *gin.Context) {
	var r InviteToEventRequest
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	n, err := h.svc.InviteToEvent(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), r.MembershipIDs)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	// `invited` can be lower than what was requested: ids outside the event's
	// organisation are dropped. Reporting the real number lets the client say so.
	c.JSON(http.StatusOK, gin.H{"invited": n, "requested": len(r.MembershipIDs)})
}

// ── Committee membership management ──────────────────────────────────────────

type addCommitteeMembersBody struct {
	MembershipIDs []string `json:"membershipIds" binding:"required"`
}

// AddCommitteeMembers — POST /associations/admin/committees/:childId/members.
func (h *Handler) AddCommitteeMembers(c *gin.Context) {
	var b addCommitteeMembersBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	n, err := h.svc.AddCommitteeMembers(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), b.MembershipIDs)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	// `added` can be lower than requested: ids outside the committee's
	// organisation are dropped rather than failing the batch.
	c.JSON(http.StatusOK, gin.H{"added": n, "requested": len(b.MembershipIDs)})
}

type committeeDecisionBody struct {
	MembershipID string `json:"membershipId" binding:"required"`
	Approve      bool   `json:"approve"`
}

// DecideCommitteeRequest — POST /associations/admin/committees/:childId/requests.
func (h *Handler) DecideCommitteeRequest(c *gin.Context) {
	var b committeeDecisionBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.DecideCommitteeRequest(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), b.MembershipID, b.Approve); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// RemoveCommitteeMember — DELETE /associations/admin/committees/:childId/members/:membershipId.
func (h *Handler) RemoveCommitteeMember(c *gin.Context) {
	if err := h.svc.RemoveCommitteeMember(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), c.Param("membershipId")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

type committeeRoleBody struct {
	Role string `json:"role" binding:"required"`
}

// SetCommitteeMemberRole — PATCH /associations/admin/committees/:childId/members/:membershipId.
func (h *Handler) SetCommitteeMemberRole(c *gin.Context) {
	var b committeeRoleBody
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.SetCommitteeMemberRole(c.Request.Context(), c.GetString("user_id"), c.Param("childId"), c.Param("membershipId"), b.Role); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
