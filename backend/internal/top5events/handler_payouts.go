package top5events

// Organiser payout / settlement routes (EVTC-D003, S1). Mounted ONLY by
// RegisterPayouts, which the app layer calls under FEATURE_EVENTS_ORGANISER_PAYOUTS
// (default off — flag off => every route below 404s). The money semantics live
// in payouts.go; this file is auth + transport only.
//
//	member: /api/finance/events/*      (organiser maker + own statements/payouts)
//	admin : /api/events/admin/*        (RBAC events.admin.view reads, events.settle mutations)
//
// Every mutation requires an Idempotency-Key header. Payout release is
// maker-checker: whoever requested the payout can never approve it — approve and
// reject are admin-only routes, so an organiser request always needs an admin
// checker before money moves.

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

const (
	keyError           = "error"
	keyData            = "data"
	keyReason          = "reason"
	keyEvent           = "event"
	keyTier            = "tier"
	keyFee             = "fee"
	keySuccess         = "success"
	keyNet             = "net"
	msgIdemKeyRequired = "Idempotency-Key header required"
)

// RegisterPayouts attaches the organiser payout routes (flag-gated).
func (h *Handler) RegisterPayouts(member, admin *gin.RouterGroup, guard GuardFunc) {
	// Organiser side: request a payout for an owned event, read own
	// statement/payouts. Object-level authZ in the service.
	member.POST("/:id/payouts", h.RequestPayout)
	member.GET("/:id/payout-statement", h.PayoutStatement)
	member.GET("/payouts/mine", h.MyPayouts)
	member.GET("/payouts/:payoutId", h.GetPayout)

	// Admin side: settlement queue + statements are reads; trigger/approve/reject
	// are money mutations behind the same RBAC as vendor settlement.
	adminView := guard("events.admin.view")
	settle := guard("events.settle")
	admin.GET("/payouts", adminView, h.AdminPayouts)
	admin.GET("/payouts/queue", adminView, h.AdminPayoutQueue)
	admin.GET("/events/:id/payout-statement", adminView, h.AdminPayoutStatement)
	admin.POST("/:id/payouts", settle, h.AdminRequestPayout)
	admin.POST("/payouts/:payoutId/approve", settle, h.AdminApprovePayout)
	admin.POST("/payouts/:payoutId/reject", settle, h.AdminRejectPayout)
}

// payoutStatus maps payout sentinels to HTTP statuses.
func payoutStatus(err error) int {
	switch {
	case errors.Is(err, ErrNotFound):
		return http.StatusNotFound
	case errors.Is(err, ErrForbidden), errors.Is(err, ErrKYCRequired):
		return http.StatusForbidden
	case errors.Is(err, ErrIdempotencyKey), errors.Is(err, ErrPayoutNothingDue), errors.Is(err, ErrValidation):
		return http.StatusBadRequest
	case errors.Is(err, ErrPayoutNotEligible), errors.Is(err, ErrPayoutInFlight),
		errors.Is(err, ErrPayoutSameActor), errors.Is(err, ErrPayoutNotPayable), errors.Is(err, ErrPayoutIdemReuse):
		return http.StatusConflict
	case errors.Is(err, ErrPayoutLegFailed):
		return http.StatusUnprocessableEntity
	}
	return http.StatusInternalServerError
}

func payoutFail(c *gin.Context, err error) {
	status := payoutStatus(err)
	if status == http.StatusInternalServerError {
		log.Printf("[top5events] payout %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
	}
	c.JSON(status, gin.H{keyError: httperr.Msg(c, status, err)})
}

func requireIdem(c *gin.Context) (string, bool) {
	key := idemKey(c)
	if key == "" {
		c.JSON(http.StatusBadRequest, gin.H{keyError: msgIdemKeyRequired})
		return "", false
	}
	return key, true
}

// --- organiser (member) ---

// RequestPayout → POST /api/finance/events/:id/payouts. The organiser (maker)
// creates a PENDING payout for the event's currently payable amount; a checker
// must approve it before money moves.
func (h *Handler) RequestPayout(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	out, err := h.svc.RequestOrganiserPayout(c.Request.Context(), u, c.Param("id"), key, false)
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}

// PayoutStatement → GET /api/finance/events/:id/payout-statement. Per-event
// earnings statement for the owning organiser.
func (h *Handler) PayoutStatement(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.OrganiserPayoutStatement(c.Request.Context(), u, c.Param("id"))
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}

// MyPayouts → GET /api/finance/events/payouts/mine. The caller's payouts across
// all their events (per-merchant segregation: own payouts only).
func (h *Handler) MyPayouts(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.ListMyOrganiserPayouts(c.Request.Context(), u)
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "payouts": out})
}

// GetPayout → GET /api/finance/events/payouts/:payoutId. Owner-only read —
// anyone else gets 404 so existence/amounts are never disclosed.
func (h *Handler) GetPayout(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	out, err := h.svc.GetOrganiserPayout(c.Request.Context(), u, c.Param("payoutId"))
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}

// --- admin (RBAC events.*) ---

// AdminPayouts → GET /api/events/admin/payouts[?status=...]
// (events.admin.view). Payout register across events, optionally filtered.
func (h *Handler) AdminPayouts(c *gin.Context) {
	out, err := h.svc.AdminListPayouts(c.Request.Context(), c.Query("status"))
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "payouts": out})
}

// AdminPayoutQueue → GET /api/events/admin/payouts/queue (events.admin.view).
// Settlement queue: CLOSED events with their payable / pending / paid /
// reserve positions.
func (h *Handler) AdminPayoutQueue(c *gin.Context) {
	out, err := h.svc.AdminPayoutQueue(c.Request.Context())
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, "queue": out})
}

// AdminPayoutStatement → GET /api/events/admin/events/:id/payout-statement
// (events.admin.view). Any event's settlement statement.
func (h *Handler) AdminPayoutStatement(c *gin.Context) {
	out, err := h.svc.AdminPayoutStatement(c.Request.Context(), c.Param("id"))
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}

// AdminRequestPayout → POST /api/events/admin/:id/payouts (events.settle). The
// admin maker trigger: creates a PENDING payout for an eligible event.
func (h *Handler) AdminRequestPayout(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	out, err := h.svc.RequestOrganiserPayout(c.Request.Context(), u, c.Param("id"), key, true)
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}

// AdminApprovePayout → POST /api/events/admin/payouts/:payoutId/approve
// (events.settle). The checker step: pending -> processing and the escrow ->
// organiser wallet / escrow -> paymax_revenue legs post under the payout's own
// idempotency keys, so a retry or concurrent approve replays instead of
// double-paying.
func (h *Handler) AdminApprovePayout(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	key, ok := requireIdem(c)
	if !ok {
		return
	}
	out, err := h.svc.ApproveOrganiserPayout(c.Request.Context(), u, c.Param("payoutId"), key)
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}

// AdminRejectPayout → POST /api/events/admin/payouts/:payoutId/reject
// (events.settle). Checker rejection: pending -> failed, no money moves and the
// amount is re-offered to the next request.
func (h *Handler) AdminRejectPayout(c *gin.Context) {
	u, ok := uid(c)
	if !ok {
		return
	}
	var req struct {
		Reason string `json:"reason" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		bindFail(c, err)
		return
	}
	out, err := h.svc.RejectOrganiserPayout(c.Request.Context(), u, c.Param("payoutId"), req.Reason)
	if err != nil {
		payoutFail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, keyData: out})
}
