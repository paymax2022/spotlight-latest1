package estate

// notifications_retention_handler.go — the HTTP surface for inbox archive, search, pin and retention
// (estate-d M18: EST-UAT-0359, defect ESTD-D008).
//
// The reads here are always the caller's own rows: the service takes user_id from the token, never from
// the query, so no route in this file can be pointed at another resident's inbox. The two admin routes
// (retention policy, retention run) assert estate_admin in the service, and the sweep they trigger is
// still bound by the database's purge guard — an admin who runs it cannot destroy a pinned notice, a
// protected category, or anything belonging to an estate under legal hold.

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

var notifErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotificationNotFound),
	httperr.R(http.StatusBadRequest, ErrInvalidNotificationState, ErrInvalidNotificationQuery,
		ErrInvalidNotificationLimit, ErrInvalidNotifCategory, ErrInvalidRetentionPolicy),
	httperr.Rule{Status: http.StatusForbidden, Match: isMembershipErr},
)

func writeNotifError(c *gin.Context, err error) { notifErrMap.Write(c, err) }

// notifIntQuery parses a paging parameter, treating absent and malformed as 0 rather than an error: a
// client that sends ?limit=abc is making the same request as one that sent nothing.
func notifIntQuery(c *gin.Context, name string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(c.Query(name)))
	return max(n, 0)
}

// notifBoolQuery reports whether a tri-state flag was sent, and to what.
func notifBoolQuery(c *gin.Context, name string) bool {
	b, _ := strconv.ParseBool(strings.TrimSpace(c.Query(name)))
	return b
}

// Notifications — GET /estate/:id/notifications?state=&unread_only=&category=&q=&limit=&offset=
// (EST-UAT-0359). The same route as before Phase 2.5a, with the filters the case asked for; the response
// keeps its "data" key and adds the paging envelope, so an existing caller still reads a list.
func (h *Handler) Notifications(c *gin.Context) {
	f := NotificationFilter{
		State:      strings.TrimSpace(c.Query("state")),
		UnreadOnly: notifBoolQuery(c, "unread_only"),
		Category:   strings.TrimSpace(c.Query("category")),
		Query:      strings.TrimSpace(c.Query("q")),
		Limit:      notifIntQuery(c, "limit"),
		Offset:     notifIntQuery(c, "offset"),
	}
	page, err := h.svc.ListNotifications(c.Request.Context(), c.Param("id"), ginutil.UserID(c), f)
	if err != nil {
		writeNotifError(c, err)
		return
	}
	c.JSON(http.StatusOK, page)
}

// MarkNotificationRead — POST /estate/:id/notifications/:notificationId/read. Idempotent: the stamp is
// COALESCE(read_at, NOW()), so calling it again does not move the date the retention sweep keys on.
func (h *Handler) MarkNotificationRead(c *gin.Context) {
	if !validUUIDParam(c, "id") || !validUUIDParam(c, "notificationId") {
		return
	}
	n, err := h.svc.MarkNotificationRead(c.Request.Context(), c.Param("id"), ginutil.UserID(c), c.Param("notificationId"))
	if err != nil {
		writeNotifError(c, err)
		return
	}
	c.JSON(http.StatusOK, n)
}

// MarkAllNotificationsRead — POST /estate/:id/notifications/read-all.
func (h *Handler) MarkAllNotificationsRead(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	n, err := h.svc.MarkAllNotificationsRead(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		writeNotifError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"marked_read": n})
}

// notifFlagRequest is the body of both write routes: one boolean, plus the optional recipient for a pin
// applied by an estate admin on somebody's behalf.
type notifFlagRequest struct {
	Archived *bool  `json:"archived"`
	Pinned   *bool  `json:"pinned"`
	UserID   string `json:"user_id"`
}

// ArchiveNotification — POST /estate/:id/notifications/:notificationId/archive {archived}. Defaults to
// archiving; {"archived": false} is the way back. Neither direction deletes anything.
func (h *Handler) ArchiveNotification(c *gin.Context) {
	if !validUUIDParam(c, "id") || !validUUIDParam(c, "notificationId") {
		return
	}
	var req notifFlagRequest
	_ = c.ShouldBindJSON(&req) // an empty body means "archive", which is what the route is named for
	archived := true
	if req.Archived != nil {
		archived = *req.Archived
	}
	n, err := h.svc.SetNotificationArchived(c.Request.Context(), c.Param("id"), ginutil.UserID(c),
		c.Param("notificationId"), archived)
	if err != nil {
		writeNotifError(c, err)
		return
	}
	c.JSON(http.StatusOK, n)
}

// PinNotification — POST /estate/:id/notifications/:notificationId/pin {pinned, user_id}. A member pins
// their own copy; an estate admin may name a recipient, because the pin is what keeps a notice past the
// sweep rather than a personal label.
func (h *Handler) PinNotification(c *gin.Context) {
	if !validUUIDParam(c, "id") || !validUUIDParam(c, "notificationId") {
		return
	}
	var req notifFlagRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if req.Pinned == nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "pinned is required"})
		return
	}
	n, err := h.svc.SetNotificationPinned(c.Request.Context(), c.Param("id"), ginutil.UserID(c),
		req.UserID, c.Param("notificationId"), *req.Pinned)
	if err != nil {
		writeNotifError(c, err)
		return
	}
	c.JSON(http.StatusOK, n)
}

// GetNotificationRetention — GET /estate/:id/notifications/retention (estate admin). Answers with the
// effective policy, default or written, and says which it is.
func (h *Handler) GetNotificationRetention(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	p, err := h.svc.GetNotificationRetentionPolicy(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		writeNotifError(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// SetNotificationRetention — PUT /estate/:id/notifications/retention {enabled, archive_after_days,
// purge_after_days, keep_categories}. Absent fields keep their current value.
func (h *Handler) SetNotificationRetention(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	var req SetNotificationRetentionPolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	p, err := h.svc.SetNotificationRetentionPolicy(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req)
	if err != nil {
		writeNotifError(c, err)
		return
	}
	c.JSON(http.StatusOK, p)
}

// RunNotificationRetention — POST /estate/:id/notifications/retention/run (estate admin). Applies this
// estate's schedule now instead of waiting for the scheduler.
func (h *Handler) RunNotificationRetention(c *gin.Context) {
	if !validUUIDParam(c, "id") {
		return
	}
	res, err := h.svc.ApplyNotificationRetention(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		writeNotifError(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}
