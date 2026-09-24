package connectpayouts

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Handler exposes the creator payout money path over HTTP.
type Handler struct{ svc *Service }

// NewHandler builds a payouts handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func userID(c *gin.Context) string  { return c.GetString("user_id") }
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

func mapMoneyError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
	case errors.Is(err, ErrInvalidAmount):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrTierTooLow):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	default:
		msg := err.Error()
		switch {
		case strings.Contains(msg, "insufficient funds"):
			c.JSON(http.StatusPaymentRequired, gin.H{"error": "insufficient wallet balance"})
		case strings.Contains(msg, "duplicate"):
			c.JSON(http.StatusConflict, gin.H{"error": "duplicate request"})
		case strings.Contains(msg, "limit"), strings.Contains(msg, "disabled"):
			c.JSON(http.StatusForbidden, gin.H{"error": "transaction limit exceeded"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": "payout failed"})
		}
	}
}

// RequestPayout — POST /api/v1/connect/payouts (member, Idempotency-Key required).
func (h *Handler) RequestPayout(c *gin.Context) {
	uid := userID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req RequestPayoutRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.Request(c.Request.Context(), uid, idemKey(c), req)
	if err != nil {
		mapMoneyError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": p})
}

// ListPayouts — GET /api/v1/connect/payouts (member).
func (h *Handler) ListPayouts(c *gin.Context) {
	limit := 0
	if v := c.Query("limit"); v != "" {
		limit, _ = strconv.Atoi(v)
	}
	out, err := h.svc.List(c.Request.Context(), userID(c), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// Register wires the payout routes onto the auth-gated member group.
func Register(member gin.IRouter, svc *Service) {
	h := NewHandler(svc)
	member.POST("/payouts", h.RequestPayout) // Idempotency-Key required
	member.GET("/payouts", h.ListPayouts)
}

// PermissionGuard mirrors middleware.RequirePermission: the route file (which
// has the RBAC service) supplies a guard factory rather than this package
// importing internal/middleware + internal/services directly — same pattern
// as connectvoting.PermissionGuard.
type PermissionGuard func(permission string) gin.HandlerFunc

// AdminPayoutResponse shapes a payout row for the admin console. Field names
// mirror frontend-admin's ConnectPayout type (frontend-admin/src/types/
// connectAdmin.ts) wherever a truthful mapping exists:
//   - reference  ← ledger_ref (the real reference this payout posted under)
//   - user_id    ← creator_id
//   - handle     ← creator's connect_creator_profiles.handle / display_name
//   - tier       ← the creator's CURRENT KYC tier, read live
//   - status     ← the REAL connect_payouts.status values
//     ("requested"/"processing"/"settled"/"failed"). The frontend mock's
//     ('pending'/'review'/'approved'/'paid'/'rejected') do not exist in the
//     schema and are not invented here — see the handoff notes for this gap.
//   - fee_kobo   ← always 0: this payout path charges no separate fee today.
//     This is not a placeholder for a missing field — there is genuinely no
//     fee model yet, and CLAUDE.md's money-handling rule forbids inventing a
//     monetary value, so 0 (truthful) is used rather than a fabricated figure.
type AdminPayoutResponse struct {
	ID             string    `json:"id"`
	Reference      string    `json:"reference"`
	UserID         string    `json:"user_id"`
	Handle         string    `json:"handle"`
	AmountKobo     int64     `json:"amount_kobo"`
	FeeKobo        int64     `json:"fee_kobo"`
	Tier           int       `json:"tier"`
	Status         string    `json:"status"`
	RequestedAt    time.Time `json:"requested_at"`
	DestinationRef *string   `json:"destination_ref,omitempty"`
	SettlementRef  *string   `json:"settlement_ref,omitempty"`
	UpdatedAt      time.Time `json:"updated_at"`
	CreatedAt      time.Time `json:"created_at"`
}

func toAdminPayoutResponse(p AdminPayout) AdminPayoutResponse {
	return AdminPayoutResponse{
		ID:             p.ID,
		Reference:      p.LedgerRef,
		UserID:         p.CreatorID,
		Handle:         p.CreatorHandle,
		AmountKobo:     p.AmountKobo,
		FeeKobo:        0,
		Tier:           p.CreatorTier,
		Status:         p.Status,
		RequestedAt:    p.CreatedAt,
		DestinationRef: p.DestinationRef,
		SettlementRef:  p.SettlementRef,
		UpdatedAt:      p.UpdatedAt,
		CreatedAt:      p.CreatedAt,
	}
}

func toAdminPayoutResponses(rows []AdminPayout) []AdminPayoutResponse {
	out := make([]AdminPayoutResponse, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAdminPayoutResponse(r))
	}
	return out
}

// validPayoutStatuses mirrors the connect_payouts.status CHECK constraint —
// an unrecognised ?status= filter is a client error (400), not a silent
// empty result, so a typo doesn't look like "no payouts pending".
var validPayoutStatuses = map[string]bool{
	"requested": true, "processing": true, "settled": true, "failed": true,
}

// AdminListPayouts — GET /api/connect/admin/payouts (RBAC: connect.payouts.view).
// Query params: status, userId, from, to (RFC3339), limit, offset.
func (h *Handler) AdminListPayouts(c *gin.Context) {
	f := AdminListFilter{Status: c.Query("status")}
	if f.Status != "" && !validPayoutStatuses[f.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status filter"})
		return
	}
	if uid := c.Query("userId"); uid != "" {
		f.CreatorID = &uid
	}
	if v := c.Query("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid from (expect RFC3339)"})
			return
		}
		f.From = &t
	}
	if v := c.Query("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid to (expect RFC3339)"})
			return
		}
		f.To = &t
	}
	if v := c.Query("limit"); v != "" {
		f.Limit, _ = strconv.Atoi(v)
	}
	if v := c.Query("offset"); v != "" {
		f.Offset, _ = strconv.Atoi(v)
	}
	rows, err := h.svc.AdminList(c.Request.Context(), f)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": toAdminPayoutResponses(rows)})
}

// AdminGetPayout — GET /api/connect/admin/payouts/:id (RBAC: connect.payouts.view).
func (h *Handler) AdminGetPayout(c *gin.Context) {
	p, err := h.svc.AdminGet(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapAdminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": toAdminPayoutResponse(*p)})
}

type adminSettleRequest struct {
	SettlementRef string `json:"settlementRef" binding:"required"`
}

// AdminSettlePayout — POST /api/connect/admin/payouts/:id/settle
// (RBAC: connect.payouts.manage). Confirms out-of-band bank settlement; posts
// no ledger entry (the debit already happened at request time) — see
// Service.AdminSettle.
func (h *Handler) AdminSettlePayout(c *gin.Context) {
	var req adminSettleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.AdminSettle(c.Request.Context(), userID(c), c.Param("id"), req.SettlementRef)
	if err != nil {
		mapAdminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

type adminRejectRequest struct {
	Reason string `json:"reason" binding:"required"`
}

// AdminRejectPayout — POST /api/connect/admin/payouts/:id/reject
// (RBAC: connect.payouts.manage). Reverses the parked settlement debit back to
// the creator's wallet via the ledger's reversal pair — see Service.AdminReject.
func (h *Handler) AdminRejectPayout(c *gin.Context) {
	var req adminRejectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.AdminReject(c.Request.Context(), userID(c), c.Param("id"), req.Reason)
	if err != nil {
		mapAdminError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": p})
}

func mapAdminError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "payout not found"})
	case errors.Is(err, ErrAlreadyTerminal), errors.Is(err, ErrForwardOnly):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// RegisterAdmin wires the admin payout routes onto the RBAC-gated admin group:
// list/detail (connect.payouts.view) and the settle/reject money-adjacent
// actions (connect.payouts.manage). Mirrors connectvoting.RegisterAdmin /
// connectaml.Register's PermissionGuard pattern so the caller
// (connect_money_routes.go) wires this the same way as every other Connect
// admin route group.
func RegisterAdmin(admin gin.IRouter, svc *Service, guard PermissionGuard) {
	h := NewHandler(svc)
	g := admin.Group("/payouts")
	g.GET("", guard("connect.payouts.view"), h.AdminListPayouts)
	g.GET("/:id", guard("connect.payouts.view"), h.AdminGetPayout)
	g.POST("/:id/settle", guard("connect.payouts.manage"), h.AdminSettlePayout)
	g.POST("/:id/reject", guard("connect.payouts.manage"), h.AdminRejectPayout)
}
