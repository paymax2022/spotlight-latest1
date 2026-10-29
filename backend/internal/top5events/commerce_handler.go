package top5events

// Events-commerce routes (migration 20271400000000 + FEATURE_EVENTS_COMMERCIAL).
//
// Mounted only by RegisterCommerce, so with the flag off every path below 404s —
// the same gate pattern the payout, comps, team and social routes use.
//
//	member: /api/finance/events/*   (customer quote/receipts/refunds/support/inbox,
//	                                 organiser roster/check-in/refund decisions)
//	admin : /api/events/admin/*     (refunds, moderation, fees, organisers, support)
//
// Object-level authorization lives in the service (authorizeManage, buyer_id
// predicates); the guard here is the platform-role layer only.

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

// RegisterCommerce attaches the commerce + governance routes.
func (h *Handler) RegisterCommerce(member, admin *gin.RouterGroup, guard GuardFunc) {
	// --- customer: price transparency, receipts, refunds, support, inbox ---
	member.GET("/:id/quote", h.Quote)
	member.GET("/my/orders", h.MyOrders)
	member.GET("/my/bookings", h.MyBookings)
	member.GET("/my/bookings/:bookingRef", h.MyBooking)
	member.POST("/tickets/:ticketId/refund-request", h.RequestRefund)
	member.GET("/my/refunds", h.MyRefunds)
	member.GET("/my/notifications", h.MyNotifications)
	member.POST("/my/notifications/read-all", h.ReadAllNotifications)
	member.POST("/notifications/:notificationId/read", h.ReadNotification)

	member.POST("/support/cases", h.OpenCase)
	member.GET("/support/cases", h.MyCases)
	member.GET("/support/cases/:caseId", h.GetCase)
	member.POST("/support/cases/:caseId/replies", h.ReplyCase)

	// --- organiser: governed submit, door operations, own refund queue ---
	member.POST("/:id/submit-review", h.SubmitForReview)
	member.GET("/:id/roster", h.Roster)
	member.GET("/:id/checkin-stats", h.CheckinStats)
	member.GET("/:id/checkin-history", h.CheckinHistory)
	member.POST("/:id/checkin", h.ManualCheckIn)
	member.POST("/:id/checkin/undo", h.UndoCheckIn)
	member.GET("/:id/refunds", h.EventRefunds)
	member.POST("/:id/refunds/:refundId/decide", h.DecideRefund)
	member.POST("/:id/refunds/:refundId/execute", h.ExecuteRefund)
	member.GET("/:id/moderation", h.EventModeration)

	// --- admin: refund desk ---
	refund := guard("events.refund")
	admin.GET("/refunds", refund, h.AdminRefunds)
	admin.GET("/refunds/stats", refund, h.AdminRefundStats)
	admin.POST("/refunds/:refundId/decide", refund, h.AdminDecideRefund)
	admin.POST("/refunds/:refundId/execute", refund, h.AdminExecuteRefund)

	// --- admin: moderation queue, platform fee, organiser sanctions ---
	moderate := guard("events.moderate")
	admin.POST("/events/:id/review/approve", moderate, h.AdminReviewApprove)
	admin.POST("/events/:id/review/reject", moderate, h.AdminReviewReject)
	admin.POST("/events/:id/review/changes", moderate, h.AdminReviewChanges)
	admin.POST("/events/:id/review/suspend", moderate, h.AdminSuspendEvent)
	admin.POST("/events/:id/review/reinstate", moderate, h.AdminReinstateEvent)
	admin.GET("/events/:id/moderation", moderate, h.AdminEventModeration)
	admin.GET("/moderation", moderate, h.AdminModerationQueue)

	fees := guard("events.fees")
	admin.GET("/fees", fees, h.AdminGetFees)
	admin.PUT("/fees", fees, h.AdminSetFees)

	organisers := guard("events.organisers")
	admin.GET("/organisers", organisers, h.AdminOrganisers)
	admin.GET("/organisers/:organiserId", organisers, h.AdminOrganiser)
	admin.POST("/organisers/:organiserId/sanction", organisers, h.AdminSanctionOrganiser)

	// --- admin: support desk (Case/Reply are the same handlers, allowAdmin) ---
	support := guard("events.support")
	admin.GET("/support/queue", support, h.AdminSupportQueue)
	admin.GET("/support/queue/stats", support, h.AdminSupportStats)
	admin.GET("/support/cases/:caseId", support, h.AdminGetCase)
	admin.POST("/support/cases/:caseId/replies", support, h.AdminReplyCase)
	admin.PATCH("/support/cases/:caseId", support, h.AdminUpdateCase)
}

// commerceStatus maps the commerce sentinels onto HTTP. Everything that refuses
// because of the row's current state (already checked in, refund decided, window
// closed) is a 409 — the client's next move is to re-read, not to retry blindly.
func commerceStatus(err error) int {
	switch {
	case err == nil:
		return http.StatusOK
	case errors.Is(err, ErrForbidden), errors.Is(err, ErrOrganiserRequired), errors.Is(err, ErrKYCRequired):
		return http.StatusForbidden
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrValidation), errors.Is(err, ErrUnknownRef), errors.Is(err, ErrBadSupportArg):
		return http.StatusBadRequest
	case errors.Is(err, ErrSoldOut), errors.Is(err, ErrInviteOnly), errors.Is(err, ErrTierNotOnSale),
		errors.Is(err, ErrNotPurchasable), errors.Is(err, ErrPromoNotApplicable),
		errors.Is(err, ErrCheckinNotOpen), errors.Is(err, ErrCheckinClosed),
		errors.Is(err, ErrAlreadyCheckedIn), errors.Is(err, ErrNotCheckedIn),
		errors.Is(err, ErrNotRefundable), errors.Is(err, ErrRefundUsed), errors.Is(err, ErrRefundExists),
		errors.Is(err, ErrRefundDecided), errors.Is(err, ErrRefundWindow), errors.Is(err, ErrRefundAutomatic),
		errors.Is(err, ErrCaseTerminal), errors.Is(err, ErrNotSuspended):
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}

func commerceRespond(c *gin.Context, data any, err error) {
	if err != nil {
		status := commerceStatus(err)
		c.JSON(status, gin.H{"error": httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: data})
}

func commerceOK(c *gin.Context, err error) { commerceRespond(c, nil, err) }

func queryInt(c *gin.Context, name string, def int) int {
	v := c.Query(name)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

// --- customer: quote + receipts ---

func (h *Handler) Quote(c *gin.Context) {
	tierID := c.Query("tier_id")
	if tierID == "" {
		commerceRespond(c, nil, ErrValidation)
		return
	}
	out, err := h.svc.Quote(c.Request.Context(), c.GetString("user_id"), c.Param("id"),
		tierID, c.Query("promo"), queryInt(c, "quantity", 1))
	commerceRespond(c, out, err)
}

func (h *Handler) MyOrders(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.MyOrders(c.Request.Context(), u, queryInt(c, "limit", 50), queryInt(c, "offset", 0))
	commerceRespond(c, out, err)
}

func (h *Handler) MyBookings(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.MyBookings(c.Request.Context(), u, queryInt(c, "limit", 30), queryInt(c, "offset", 0))
	commerceRespond(c, out, err)
}

func (h *Handler) MyBooking(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.Booking(c.Request.Context(), u, c.Param("bookingRef"))
	commerceRespond(c, out, err)
}

// --- customer: refunds ---

type reasonRequest struct {
	Reason string `json:"reason"`
}

func (h *Handler) RequestRefund(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req reasonRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.RequestRefund(c.Request.Context(), u, c.Param("ticketId"), req.Reason, idemKey(c))
	commerceRespond(c, out, err)
}

func (h *Handler) MyRefunds(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.ListMyRefunds(c.Request.Context(), u)
	commerceRespond(c, out, err)
}

// --- organiser: refunds + door ---

func (h *Handler) EventRefunds(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.ListRefundsForEvent(c.Request.Context(), u, c.Param("id"), c.Query("status"))
	commerceRespond(c, out, err)
}

type decideRequest struct {
	Approve bool   `json:"approve"`
	Note    string `json:"note"`
}

func (h *Handler) DecideRefund(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req decideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.DecideRefund(c.Request.Context(), u, c.Param("refundId"), req.Approve, req.Note, false)
	commerceRespond(c, out, err)
}

func (h *Handler) ExecuteRefund(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.ExecuteRefund(c.Request.Context(), u, c.Param("refundId"), false)
	commerceRespond(c, out, err)
}

type checkinRequest struct {
	TicketID string `json:"ticket_id" binding:"required"`
	Gate     string `json:"gate"`
	Reason   string `json:"reason"`
}

func (h *Handler) ManualCheckIn(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req checkinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.ManualCheckIn(c.Request.Context(), u, req.TicketID, req.Gate, req.Reason)
	commerceRespond(c, out, err)
}

func (h *Handler) UndoCheckIn(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req checkinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.UndoCheckIn(c.Request.Context(), u, req.TicketID, req.Reason)
	commerceRespond(c, out, err)
}

func (h *Handler) Roster(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.AttendeesFiltered(c.Request.Context(), u, c.Param("id"), CheckinFilter{
		State:  c.Query("state"),
		Gate:   c.Query("gate"),
		Q:      c.Query("q"),
		Limit:  queryInt(c, "limit", 0),
		Offset: queryInt(c, "offset", 0),
	})
	commerceRespond(c, out, err)
}

func (h *Handler) CheckinStats(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.AttendeeStats(c.Request.Context(), u, c.Param("id"))
	commerceRespond(c, out, err)
}

func (h *Handler) CheckinHistory(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.CheckinHistory(c.Request.Context(), u, c.Param("id"), queryInt(c, "limit", 100), queryInt(c, "offset", 0))
	commerceRespond(c, out, err)
}

// --- governance: submit + review ---

func (h *Handler) SubmitForReview(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	commerceOK(c, h.svc.SubmitForReview(c.Request.Context(), u, c.Param("id")))
}

func (h *Handler) EventModeration(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.ListModerationDecisions(c.Request.Context(), u, c.Param("id"))
	commerceRespond(c, out, err)
}

type reviewRequest struct {
	Reason string `json:"reason"`
}

func (h *Handler) adminReview(c *gin.Context, kind string) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req reviewRequest
	// A reason is optional for an approval and required by the service for a
	// rejection, so a body-less approve still works.
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&req); err != nil {
			bindFail(c, err)
			return
		}
	}
	ctx := c.Request.Context()
	eventID := c.Param("id")
	var err error
	switch kind {
	case "approve":
		err = h.svc.ReviewApprove(ctx, u, eventID)
	case "reject":
		err = h.svc.ReviewReject(ctx, u, eventID, req.Reason)
	case "changes":
		err = h.svc.ReviewRequestChanges(ctx, u, eventID, req.Reason)
	case "suspend":
		err = h.svc.SuspendEvent(ctx, u, eventID, req.Reason)
	case "reinstate":
		err = h.svc.ReinstateEvent(ctx, u, eventID, req.Reason)
	}
	commerceOK(c, err)
}

func (h *Handler) AdminReviewApprove(c *gin.Context)  { h.adminReview(c, "approve") }
func (h *Handler) AdminReviewReject(c *gin.Context)   { h.adminReview(c, "reject") }
func (h *Handler) AdminReviewChanges(c *gin.Context)  { h.adminReview(c, "changes") }
func (h *Handler) AdminSuspendEvent(c *gin.Context)   { h.adminReview(c, "suspend") }
func (h *Handler) AdminReinstateEvent(c *gin.Context) { h.adminReview(c, "reinstate") }

func (h *Handler) AdminEventModeration(c *gin.Context) {
	if _, ok := uid(c); !ok {
		return
	}
	out, err := h.svc.AdminListModerationDecisions(c.Request.Context(), c.Param("id"))
	commerceRespond(c, out, err)
}

// AdminModerationQueue is the review queue: what is waiting on the platform. It
// reuses the admin event list, so the queue and the catalogue can never disagree
// about what is pending.
func (h *Handler) AdminModerationQueue(c *gin.Context) {
	if _, ok := uid(c); !ok {
		return
	}
	status := c.Query("status")
	if status == "" {
		status = "submitted"
	}
	out, err := h.svc.AdminListEvents(c.Request.Context(), status, c.Query("q"))
	commerceRespond(c, out, err)
}

// --- admin: fees, organisers ---

func (h *Handler) AdminGetFees(c *gin.Context) {
	out, err := h.svc.GetFeeSettings(c.Request.Context())
	commerceRespond(c, out, err)
}

type feeRequest struct {
	FeeBps int    `json:"fee_bps"`
	Reason string `json:"reason"`
}

func (h *Handler) AdminSetFees(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req feeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.SetFeeBps(c.Request.Context(), u, req.FeeBps, req.Reason)
	commerceRespond(c, out, err)
}

func (h *Handler) AdminOrganisers(c *gin.Context) {
	out, err := h.svc.ListOrganiserSanctions(c.Request.Context(), c.Query("q"),
		queryInt(c, "limit", 50), queryInt(c, "offset", 0))
	commerceRespond(c, out, err)
}

func (h *Handler) AdminOrganiser(c *gin.Context) {
	out, err := h.svc.GetOrganiserSanction(c.Request.Context(), c.Param("organiserId"))
	commerceRespond(c, out, err)
}

type sanctionRequest struct {
	Suspended bool   `json:"suspended"`
	Reason    string `json:"reason"`
}

func (h *Handler) AdminSanctionOrganiser(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req sanctionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.SanctionOrganiser(c.Request.Context(), u, c.Param("organiserId"), req.Suspended, req.Reason)
	commerceRespond(c, out, err)
}

// --- admin: refunds ---

func (h *Handler) AdminRefunds(c *gin.Context) {
	out, err := h.svc.AdminListRefunds(c.Request.Context(), c.Query("status"), c.Query("event_id"),
		c.Query("q"), queryInt(c, "limit", 50), queryInt(c, "offset", 0))
	commerceRespond(c, out, err)
}

func (h *Handler) AdminRefundStats(c *gin.Context) {
	out, err := h.svc.GetRefundQueueStats(c.Request.Context())
	commerceRespond(c, out, err)
}

func (h *Handler) adminDecideRefund(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req decideRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.DecideRefund(c.Request.Context(), u, c.Param("refundId"), req.Approve, req.Note, true)
	commerceRespond(c, out, err)
}

func (h *Handler) AdminDecideRefund(c *gin.Context) { h.adminDecideRefund(c) }

func (h *Handler) AdminExecuteRefund(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.ExecuteRefund(c.Request.Context(), u, c.Param("refundId"), true)
	commerceRespond(c, out, err)
}

// --- customer + desk: notifications ---

func (h *Handler) MyNotifications(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, unread, err := h.svc.Notifications(c.Request.Context(), u,
		queryInt(c, "limit", 30), queryInt(c, "offset", 0), c.Query("unread") == "true")
	if err != nil {
		commerceRespond(c, nil, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out, "unread": unread})
}

func (h *Handler) ReadNotification(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	commerceOK(c, h.svc.MarkNotificationRead(c.Request.Context(), u, c.Param("notificationId")))
}

func (h *Handler) ReadAllNotifications(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	n, err := h.svc.MarkAllNotificationsRead(c.Request.Context(), u)
	if err != nil {
		commerceRespond(c, nil, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: gin.H{"marked": n}})
}

// --- support desk ---

type openCaseRequest struct {
	EventID  string `json:"event_id"`
	OrderID  string `json:"order_id"`
	TicketID string `json:"ticket_id"`
	Kind     string `json:"kind"`
	Subject  string `json:"subject"`
	Body     string `json:"body"`
	Priority string `json:"priority"`
}

func (h *Handler) OpenCase(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req openCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.OpenCase(c.Request.Context(), u, SupportCase{
		EventID: req.EventID, OrderID: req.OrderID, TicketID: req.TicketID,
		Kind: req.Kind, Subject: req.Subject, Body: req.Body, Priority: req.Priority,
	})
	commerceRespond(c, out, err)
}

func (h *Handler) MyCases(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.MyCases(c.Request.Context(), u, c.Query("status"),
		queryInt(c, "limit", 50), queryInt(c, "offset", 0))
	commerceRespond(c, out, err)
}

func (h *Handler) GetCase(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.Case(c.Request.Context(), u, c.Param("caseId"), false)
	commerceRespond(c, out, err)
}

type replyRequest struct {
	Body string `json:"body"`
}

func (h *Handler) replyCase(c *gin.Context, allowAdmin bool) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req replyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.Reply(c.Request.Context(), u, c.Param("caseId"), req.Body, allowAdmin)
	commerceRespond(c, out, err)
}

func (h *Handler) ReplyCase(c *gin.Context)      { h.replyCase(c, false) }
func (h *Handler) AdminReplyCase(c *gin.Context) { h.replyCase(c, true) }

func (h *Handler) AdminGetCase(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.Case(c.Request.Context(), u, c.Param("caseId"), true)
	commerceRespond(c, out, err)
}

type updateCaseRequest struct {
	Status     string `json:"status"`
	Priority   string `json:"priority"`
	AssignedTo string `json:"assigned_to"`
	Note       string `json:"note"`
}

func (h *Handler) AdminUpdateCase(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req updateCaseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.UpdateCase(c.Request.Context(), u, c.Param("caseId"),
		req.Status, req.Priority, req.AssignedTo, req.Note)
	commerceRespond(c, out, err)
}

func (h *Handler) AdminSupportQueue(c *gin.Context) {
	out, err := h.svc.AdminListCases(c.Request.Context(), c.Query("status"), c.Query("kind"),
		c.Query("q"), queryInt(c, "limit", 50), queryInt(c, "offset", 0))
	commerceRespond(c, out, err)
}

func (h *Handler) AdminSupportStats(c *gin.Context) {
	out, err := h.svc.SupportQueueStats(c.Request.Context())
	commerceRespond(c, out, err)
}
