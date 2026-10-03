package engage

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const keyError = "error"

// Handler exposes the engagement endpoints over gin.
type Handler struct{ svc *Service }

// NewHandler constructs an engagement handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GetHelp — GET /help.
func (h *Handler) GetHelp(c *gin.Context) {
	articles, err := h.svc.GetHelp(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": articles})
}

// ListTickets — GET /support/tickets.
func (h *Handler) ListTickets(c *gin.Context) {
	userID := ginutil.UserID(c)
	tickets, err := h.svc.ListTickets(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": tickets})
}

// GetTicket — GET /support/tickets/:id.
func (h *Handler) GetTicket(c *gin.Context) {
	ticket, err := h.svc.GetTicket(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{keyError: "ticket not found"})
		return
	}
	c.JSON(http.StatusOK, ticket)
}

// CreateTicket — POST /support/tickets.
func (h *Handler) CreateTicket(c *gin.Context) {
	userID := ginutil.UserID(c)
	var in CreateTicketInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ticket, err := h.svc.CreateTicket(c.Request.Context(), userID, in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusCreated, ticket)
}

// ReplyTicket — POST /support/tickets/:id/reply.
func (h *Handler) ReplyTicket(c *gin.Context) {
	var in ReplyTicketInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ticket, err := h.svc.ReplyTicket(c.Request.Context(), c.Param("id"), in.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, ticket)
}

// GetNotifications — GET /notifications.
func (h *Handler) GetNotifications(c *gin.Context) {
	userID := ginutil.UserID(c)
	items, err := h.svc.GetNotifications(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": items})
}

// MarkNotificationsRead — POST /notifications/read.
func (h *Handler) MarkNotificationsRead(c *gin.Context) {
	userID := ginutil.UserID(c)
	if err := h.svc.MarkNotificationsRead(c.Request.Context(), userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// GetNotificationPrefs — GET /settings/notifications.
func (h *Handler) GetNotificationPrefs(c *gin.Context) {
	userID := ginutil.UserID(c)
	prefs, err := h.svc.GetNotificationPrefs(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, prefs)
}

// UpdateNotificationPrefs — PUT /settings/notifications.
func (h *Handler) UpdateNotificationPrefs(c *gin.Context) {
	userID := ginutil.UserID(c)
	var prefs NotificationPrefs
	if err := c.ShouldBindJSON(&prefs); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	saved, err := h.svc.UpdateNotificationPrefs(c.Request.Context(), userID, prefs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, saved)
}

// RecordCampaignEvent — POST /campaigns/:id/events.
// Records a VIEW or SHARE for a campaign. Fire-and-forget from the client's
// point of view: analytics must never block or fail a user action, so a bad
// payload is a 400 but a storage failure is still reported honestly rather than
// silently swallowed.
func (h *Handler) RecordCampaignEvent(c *gin.Context) {
	campaignID := c.Param("id")

	var body struct {
		Type        string `json:"type"`
		Source      string `json:"source"`
		AnonymousID string `json:"anonymousId"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid body"})
		return
	}

	// user_id is set by auth middleware when present; campaign pages are public,
	// so an absent user is an anonymous view rather than an error.
	userID := ginutil.UserID(c)

	if err := h.svc.RecordCampaignEvent(c.Request.Context(), campaignID, body.Type, body.Source, userID, body.AnonymousID); err != nil {
		if errors.Is(err, ErrInvalidEvent) {
			c.JSON(http.StatusBadRequest, gin.H{keyError: "type must be VIEW or SHARE"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// Broadcast POST /campaigns/:id/broadcast — creator only.
func (h *Handler) Broadcast(c *gin.Context) {
	var in BroadcastInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.BroadcastToContributors(c.Request.Context(), c.Param("id"), ginutil.UserID(c), in)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// errMap maps a service error to the status the client should see.
// Everything unmapped is a 500: a bad request the caller can fix must never be
// indistinguishable from a server fault they cannot.
var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusUnauthorized, ErrUnauthenticated),
	httperr.R(http.StatusForbidden, ErrNotCampaignCreator, ErrCannotBroadcast, ErrCannotPublishUpdate, ErrNotDocumentOwner),
	httperr.R(http.StatusNotFound, ErrCommentNotFound, ErrCampaignNotFound, ErrUpdateNotFound, ErrDocumentNotFound),
	httperr.R(http.StatusBadRequest,
		ErrEmptyBody, ErrBodyTooLong, ErrReplyToReply,
		ErrBroadcastSubjectTooShort, ErrBroadcastSubjectTooLong,
		ErrBroadcastBodyTooShort, ErrBroadcastBodyTooLong, ErrNoBroadcastChannel,
		ErrEmptyTitle, ErrTitleTooLong, ErrEmptyUpdateBody, ErrUpdateBodyTooLong,
		ErrEmptyLabel, ErrBadDocumentType, ErrMissingUpload),
)

// ListComments GET /campaigns/:id/comments
// The finance group this hangs off requires a bearer token, so a caller is always
// present in practice — the same bar the campaign detail sets. user_id is passed
// through so `reported` can mean "you reported this" rather than "somebody did".
func (h *Handler) ListComments(c *gin.Context) {
	out, err := h.svc.ListComments(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// PostComment POST /campaigns/:id/comments
func (h *Handler) PostComment(c *gin.Context) {
	var in PostCommentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.PostComment(c.Request.Context(), c.Param("id"), ginutil.UserID(c), in)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// ReplyComment POST /comments/:commentId/reply
func (h *Handler) ReplyComment(c *gin.Context) {
	var in ReplyCommentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.ReplyComment(c.Request.Context(), c.Param("commentId"), ginutil.UserID(c), in)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// ReportComment POST /comments/:commentId/report
func (h *Handler) ReportComment(c *gin.Context) {
	if err := h.svc.ReportComment(c.Request.Context(), c.Param("commentId"), ginutil.UserID(c)); err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"reported": true}})
}

// ListDocuments GET /campaigns/:id/documents
func (h *Handler) ListDocuments(c *gin.Context) {
	out, err := h.svc.ListDocuments(c.Request.Context(), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AttachDocument POST /campaigns/:id/documents — creator only.
func (h *Handler) AttachDocument(c *gin.Context) {
	var in AttachDocumentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.AttachDocument(c.Request.Context(), c.Param("id"), ginutil.UserID(c), in)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// ListUpdates GET /campaigns/:id/updates
// The same rows are embedded in the campaign detail; this exists for callers that
// want updates alone. Auth comes from the finance group, as it does for the
// detail — there is no anonymous read of a campaign anywhere in this module.
func (h *Handler) ListUpdates(c *gin.Context) {
	out, err := h.svc.ListUpdates(c.Request.Context(), c.Param("id"))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// PostUpdate POST /campaigns/:id/updates — creator only.
func (h *Handler) PostUpdate(c *gin.Context) {
	var in PostUpdateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.PostUpdate(c.Request.Context(), c.Param("id"), ginutil.UserID(c), in)
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// LikeUpdate POST /updates/:updateId/like — idempotent; returns the new count.
func (h *Handler) LikeUpdate(c *gin.Context) {
	count, err := h.svc.LikeUpdate(c.Request.Context(), c.Param("updateId"), ginutil.UserID(c))
	if err != nil {
		errMap.Write(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"likeCount": count}})
}

// Register wires the crowdfunding engagement routes onto the supplied router
// group. The caller is responsible for mounting `rg` under the crowdfunding
// prefix and applying auth middleware that sets `user_id`.
// Routes (relative to rg):
//
//	GET  /help                       → help-center articles
//	GET  /support/tickets            → caller's support tickets
//	GET  /support/tickets/:id        → single ticket with messages
//	POST /support/tickets            → open a new ticket
//	POST /support/tickets/:id/reply  → append a reply, set ticket PENDING
//	GET  /notifications              → caller's notifications
//	POST /notifications/read         → mark all notifications read
//	POST /campaigns/:id/events       → record a VIEW or SHARE (analytics)
//	GET  /campaigns/:id/comments     → campaign comments + Q&A with replies
//	POST /campaigns/:id/comments     → post a comment or question
//	POST /comments/:commentId/reply  → creator reply to a comment
//	POST /comments/:commentId/report → flag a comment (idempotent)
//	GET  /campaigns/:id/updates      → campaign updates, newest first
//	POST /campaigns/:id/updates      → publish an update (creator only)
//	POST /updates/:updateId/like     → like an update (idempotent)
//	GET  /campaigns/:id/documents    → supporting documents
//	POST /campaigns/:id/documents    → attach an uploaded document (creator only)
//	POST /campaigns/:id/broadcast    → message every backer (creator only)
//	GET  /settings/notifications     → notification preferences
//	PUT  /settings/notifications     → upsert notification preferences
func Register(rg *gin.RouterGroup, db *pgxpool.Pool) {
	h := NewHandler(NewService(db))

	rg.GET("/help", h.GetHelp)

	rg.GET("/support/tickets", h.ListTickets)
	rg.GET("/support/tickets/:id", h.GetTicket)
	rg.POST("/support/tickets", h.CreateTicket)
	rg.POST("/support/tickets/:id/reply", h.ReplyTicket)

	rg.GET("/notifications", h.GetNotifications)
	rg.POST("/notifications/read", h.MarkNotificationsRead)

	// Engagement events feeding creator analytics. Public-ish: an anonymous
	// view still counts, so this must not require user_id to be set.
	rg.POST("/campaigns/:id/events", h.RecordCampaignEvent)

	// Campaign comments and Q&A. The reply/report routes hang off /comments/:commentId
	// rather than the campaign, because that is the shape the client already calls —
	// it holds a comment id at that point, not a campaign id.
	// The param is named :commentId, NOT :id: gin panics at boot on two different
	// wildcard names at the same position, and /campaigns/:id/* already claims :id
	// on this group.
	rg.GET("/campaigns/:id/comments", h.ListComments)
	rg.POST("/campaigns/:id/comments", h.PostComment)
	rg.POST("/comments/:commentId/reply", h.ReplyComment)
	rg.POST("/comments/:commentId/report", h.ReportComment)

	// Campaign updates. Same :commentId reasoning applies to :updateId — gin panics
	// at boot on two wildcard names in the same position, and /campaigns/:id/*
	// already owns :id on this group.
	rg.GET("/campaigns/:id/updates", h.ListUpdates)
	rg.POST("/campaigns/:id/updates", h.PostUpdate)
	rg.POST("/updates/:updateId/like", h.LikeUpdate)

	rg.GET("/campaigns/:id/documents", h.ListDocuments)
	rg.POST("/campaigns/:id/documents", h.AttachDocument)

	rg.POST("/campaigns/:id/broadcast", h.Broadcast)

	rg.GET("/settings/notifications", h.GetNotificationPrefs)
	rg.PUT("/settings/notifications", h.UpdateNotificationPrefs)
}
