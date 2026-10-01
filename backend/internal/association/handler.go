package association

import (
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/platform/r2"
	platformWS "spotlight/backend/internal/platform/ws"
)

// errMap is the package-wide domain-error→HTTP mapping previously spelled
// statusFor: validation sentinels are 400, access/ineligibility 403, illegal
// election moves 409, missing rows/memberships 404, everything else 500.
var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, ErrIdempotencyRequired, ErrInvalidBallot, ErrInvalidInput),
	httperr.R(http.StatusForbidden, ErrForbidden, ErrIneligible, ErrVotingClosed),
	httperr.R(http.StatusConflict, ErrElectionState),
	httperr.R(http.StatusNotFound, ErrNoMembership, pgx.ErrNoRows),
)

// statusFor resolves the HTTP status for err; tests exercise it directly.
func statusFor(err error) int { return errMap.Code(err) }

type Handler struct {
	svc *Service
	// Presigned R2 uploads for organisation logos; see presign.go. Nil until
	// WithPresigner is called, which makes the upload endpoint fail closed.
	presigner     *r2.Presigner
	presignBucket string
	// Realtime chat delivery over the open-source WS hub (platform/ws). Nil until
	// WithHub is called; a nil hub makes ServeWS answer 503 and every push a
	// no-op, so chat degrades to fetch-on-open rather than failing the write.
	hub *platformWS.Hub
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// WithHub attaches the WebSocket Hub for live chat delivery. Additive.
func (h *Handler) WithHub(hub *platformWS.Hub) *Handler {
	h.hub = hub
	return h
}

// GET /associations/me/dues
func (h *Handler) GetDues(c *gin.Context) {
	userID := ginutil.UserID(c)
	dues, err := h.svc.GetDues(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, dues)
}

// POST /associations/dues/:invoiceId/pay
func (h *Handler) PayInvoice(c *gin.Context) {
	userID := ginutil.UserID(c)
	var req PayInvoiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.IdempotencyKey = ginutil.IdempotencyKey(c)
	res, err := h.svc.PayInvoice(c.Request.Context(), userID, c.Param("invoiceId"), req)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GET /associations/receipts/:receiptId
func (h *Handler) GetReceipt(c *gin.Context) {
	userID := ginutil.UserID(c)
	r, err := h.svc.GetReceipt(c.Request.Context(), userID, c.Param("receiptId"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, r)
}

// POST /associations/admin/approvals/:id/decision
func (h *Handler) DecideApplication(c *gin.Context) {
	adminID := ginutil.UserID(c)
	var req ApprovalDecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.IdempotencyKey = ginutil.IdempotencyKey(c)
	if err := h.svc.DecideApplication(c.Request.Context(), adminID, c.Param("id"), req); err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GET /associations
func (h *Handler) ListOrganisations(c *gin.Context) {
	limit, offset := ginutil.LimitOffset(c)
	orgs, err := h.svc.GetOrganisations(c.Request.Context(), c.Query("search"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, orgs)
}

// GET /associations/:id
func (h *Handler) GetOrganisation(c *gin.Context) {
	org, err := h.svc.GetOrganisation(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, org)
}

// GET /associations/me/dashboard
func (h *Handler) GetDashboard(c *gin.Context) {
	d, err := h.svc.GetDashboard(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, d)
}

// GET /associations/me/card
func (h *Handler) GetCard(c *gin.Context) {
	card, err := h.svc.GetCard(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, card)
}

// VerifyCard authenticates a scanned membership-card QR token and returns the
// member's live verification result. An invalid/forged/expired/arrears card is a
// normal outcome (HTTP 200 with valid:false + reason); only a lookup failure is 5xx.
func (h *Handler) VerifyCard(c *gin.Context) {
	var req VerifyCardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	res, err := h.svc.VerifyCard(c.Request.Context(), req.Token)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// GET /associations/me/profile
func (h *Handler) GetProfile(c *gin.Context) {
	p, err := h.svc.GetProfile(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// GET /associations/me/privacy
func (h *Handler) GetPrivacy(c *gin.Context) {
	ps, err := h.svc.GetPrivacy(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
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
	ps, err := h.svc.UpdatePrivacy(c.Request.Context(), ginutil.UserID(c), req)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, ps)
}

// GET /associations/me/activity
func (h *Handler) GetActivity(c *gin.Context) {
	entries, err := h.svc.GetActivity(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, entries)
}

// GET /associations/me/admin-access
func (h *Handler) GetAdminAccess(c *gin.Context) {
	access, err := h.svc.GetAdminAccess(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, access)
}

// GET /associations/members
func (h *Handler) ListMembers(c *gin.Context) {
	var q MemberDirectoryQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	members, err := h.svc.GetDirectory(c.Request.Context(), ginutil.UserID(c), q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, members)
}

// GET /associations/members/:id
func (h *Handler) GetMember(c *gin.Context) {
	member, err := h.svc.GetMember(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, member)
}

// GET /associations/announcements
func (h *Handler) ListAnnouncements(c *gin.Context) {
	list, err := h.svc.GetAnnouncements(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/notifications
func (h *Handler) ListNotifications(c *gin.Context) {
	list, err := h.svc.GetNotifications(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/meetings
func (h *Handler) ListMeetings(c *gin.Context) {
	list, err := h.svc.GetMeetings(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/tasks
func (h *Handler) ListTasks(c *gin.Context) {
	list, err := h.svc.GetTasks(c.Request.Context(), ginutil.UserID(c), c.Query("scope"))
	if err != nil {
		// errMap, not a blanket 500: scope=org is admin-only, and a member
		// asking for it is forbidden rather than a server fault.
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/documents
func (h *Handler) ListDocuments(c *gin.Context) {
	list, err := h.svc.GetDocuments(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/committees
func (h *Handler) ListCommittees(c *gin.Context) {
	list, err := h.svc.GetCommittees(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/events
func (h *Handler) ListEvents(c *gin.Context) {
	list, err := h.svc.GetEvents(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/admin/organisations
func (h *Handler) GetAdminOrganisations(c *gin.Context) {
	limit, offset := ginutil.LimitOffset(c)
	f := AdminOrgFilter{
		Search:    c.Query("search"),
		Category:  c.Query("category"),
		Status:    c.Query("status"),
		Published: ginutil.BoolParam(c, "published"),
		Verified:  ginutil.BoolParam(c, "verified"),
		Limit:     limit,
		Offset:    offset,
	}
	list, err := h.svc.ListAdminOrganisations(c.Request.Context(), ginutil.UserID(c), f)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/admin/kpis
func (h *Handler) GetAdminKpis(c *gin.Context) {
	kpis, err := h.svc.GetAdminKpis(c.Request.Context(), ginutil.UserID(c), c.Query("org_id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, kpis)
}

// GET /associations/admin/approvals
func (h *Handler) ListApprovals(c *gin.Context) {
	list, err := h.svc.GetApprovalQueue(c.Request.Context(), ginutil.UserID(c), c.Query("jurisdiction"), c.Query("org_id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}

// GET /associations/admin/approvals/:id
func (h *Handler) GetApproval(c *gin.Context) {
	app, err := h.svc.GetApplication(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, app)
}

// GET /associations/admin/finance
func (h *Handler) GetFinanceSummary(c *gin.Context) {
	fs, err := h.svc.GetFinanceSummary(c.Request.Context(), ginutil.UserID(c), c.Query("org_id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, fs)
}

// GET /associations/admin/finance/offline
func (h *Handler) ListOfflinePayments(c *gin.Context) {
	list, err := h.svc.GetOfflinePayments(c.Request.Context(), ginutil.UserID(c), c.Query("org_id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}
