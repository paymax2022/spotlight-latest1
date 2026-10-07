package social

import (
	"context"
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/finance/tiers"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Handler exposes the Social Pay member API. user_id is mirrored onto the gin
// context by the finance group. Object-level authZ is enforced in the service:
// the caller's session id is ALWAYS used as the acting identity (never a
// client-supplied id) so a user can never act as someone else.
type Handler struct {
	svc  *Service
	tags *cashtag.Service
}

func NewHandler(svc *Service, tags *cashtag.Service) *Handler {
	return &Handler{svc: svc, tags: tags}
}

// errMap is the sentinel→status table for social handlers; WriteOK preserves
// the {"success": false, "error": ...} envelope. Tier refusals map to 403 — the
// same status the canonical transfer rail's errMap gives them.
var errMap = httperr.New(http.StatusBadRequest,
	httperr.R(http.StatusForbidden, ErrForbidden, tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded),
	httperr.R(http.StatusServiceUnavailable, ErrTierGateUnwired),
	httperr.R(http.StatusNotFound, ErrNotFound, cashtag.ErrNotFound),
	httperr.R(http.StatusConflict, ErrIdempotencyKeyConflict),
	httperr.R(http.StatusTooManyRequests, ErrAMLSingleLimit, ErrAMLCountLimit, ErrAMLAmountLimit),
)

func (h *Handler) ClaimHandle(c *gin.Context) {
	var req struct {
		Handle string `json:"handle"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	hd, err := h.tags.Claim(c.Request.Context(), ginutil.UserID(c), req.Handle)
	if err != nil {
		switch {
		case errors.Is(err, cashtag.ErrTaken), errors.Is(err, cashtag.ErrAlreadyClaimed):
			c.JSON(http.StatusConflict, gin.H{"success": false, "error": httperr.Msg(c, http.StatusConflict, err)})
		case errors.Is(err, cashtag.ErrReserved), errors.Is(err, cashtag.ErrImpersonation):
			c.JSON(http.StatusForbidden, gin.H{"success": false, "error": httperr.Msg(c, http.StatusForbidden, err)})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": httperr.Msg(c, http.StatusBadRequest, err)})
		}
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "handle": hd})
}

func (h *Handler) ResolveHandle(c *gin.Context) {
	id, err := h.tags.Resolve(c.Request.Context(), c.Param("handle"))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "user_id": id})
}

func (h *Handler) MyHandle(c *gin.Context) {
	hd, err := h.tags.HandleFor(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "handle": hd})
}

func (h *Handler) Send(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	var req struct {
		Handle     string `json:"handle"`
		AmountKobo int64  `json:"amount_kobo"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	p, err := h.svc.Send(c.Request.Context(), ginutil.UserID(c), req.Handle, req.Note, key, req.AmountKobo)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "payment": p})
}

func (h *Handler) CreateRequest(c *gin.Context) {
	var req struct {
		Handle     string `json:"handle"`
		AmountKobo int64  `json:"amount_kobo"`
		Note       string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	r, err := h.svc.CreateRequest(c.Request.Context(), ginutil.UserID(c), req.Handle, req.Note, req.AmountKobo)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "request": r})
}

func (h *Handler) PayRequest(c *gin.Context) {
	if err := h.svc.PayRequest(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) DeclineRequest(c *gin.Context) {
	if err := h.svc.DeclineRequest(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) CancelRequest(c *gin.Context) {
	if err := h.svc.CancelRequest(c.Request.Context(), ginutil.UserID(c), c.Param("id")); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) CreateSplit(c *gin.Context) {
	var req struct {
		Title     string       `json:"title"`
		TotalKobo int64        `json:"total_kobo"`
		Mode      string       `json:"mode"`
		Shares    []ShareInput `json:"shares"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	bill, shares, err := h.svc.CreateSplit(c.Request.Context(), ginutil.UserID(c), req.Title, req.TotalKobo, SplitMode(strings.ToUpper(req.Mode)), req.Shares)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "bill": bill, "shares": shares})
}

func (h *Handler) GetSplit(c *gin.Context) {
	splitID := c.Param("id")
	ok, err := h.svc.IsSplitParticipant(c.Request.Context(), splitID, ginutil.UserID(c))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "not a participant"})
		return
	}
	bill, shares, err := h.svc.GetSplit(c.Request.Context(), splitID)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "bill": bill, "shares": shares})
}

func (h *Handler) PayShare(c *gin.Context) {
	// ok was previously ignored: a missing key wrote the 400 above and then
	// STILL paid the share — a money mutation proceeding without the
	// required Idempotency-Key (iron rule #1).
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	if err := h.svc.PayShare(c.Request.Context(), ginutil.UserID(c), c.Param("shareId"), key); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) CreatePool(c *gin.Context) {
	var req struct {
		// A pool with no title is an unlabeled money pot — require it rather
		// than persisting an unnamed OPEN pool nobody can identify.
		Title         string  `json:"title" binding:"required"`
		BeneficiaryID *string `json:"beneficiary_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	p, err := h.svc.CreatePool(c.Request.Context(), ginutil.UserID(c), req.Title, req.BeneficiaryID)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"success": true, "pool": p})
}

func (h *Handler) ContributePool(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	var req struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	bal, err := h.svc.ContributePool(c.Request.Context(), ginutil.UserID(c), c.Param("id"), req.AmountKobo, key)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) PayoutPool(c *gin.Context) {
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	if err := h.svc.PayoutPool(c.Request.Context(), ginutil.UserID(c), c.Param("id"), key); err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (h *Handler) PoolBalance(c *gin.Context) {
	bal, err := h.svc.PoolBalance(c.Request.Context(), c.Param("id"))
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_kobo": bal})
}

func (h *Handler) Activity(c *gin.Context) {
	limit, _ := ginutil.LimitOffset(c)
	items, err := h.svc.ActivityFeed(c.Request.Context(), ginutil.UserID(c), limit)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "activity": items})
}

func (h *Handler) ListRequests(c *gin.Context) {
	limit, _ := ginutil.LimitOffset(c)
	items, err := h.svc.ListRequests(c.Request.Context(), ginutil.UserID(c), limit)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "requests": items})
}

func (h *Handler) ListSplits(c *gin.Context) {
	limit, _ := ginutil.LimitOffset(c)
	items, err := h.svc.ListSplits(c.Request.Context(), ginutil.UserID(c), limit)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "splits": items})
}

func (h *Handler) ListPools(c *gin.Context) {
	limit, _ := ginutil.LimitOffset(c)
	items, err := h.svc.ListPools(c.Request.Context(), ginutil.UserID(c), limit)
	if err != nil {
		errMap.WriteOK(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "pools": items})
}

// Register mounts social member routes on the finance group; admin oversight on
// the social admin group (RBAC social.admin.*).
func (h *Handler) Register(member *gin.RouterGroup, admin *gin.RouterGroup, guard func(string) gin.HandlerFunc) {
	g := member.Group("/social")
	// activity feed
	g.GET("/activity", h.Activity)
	// cashtag directory
	g.POST("/handle", h.ClaimHandle)
	g.GET("/handle/me", h.MyHandle)
	g.GET("/handle/:handle", h.ResolveHandle)
	// P2P
	g.POST("/send", h.Send)
	g.GET("/requests", h.ListRequests)
	g.POST("/requests", h.CreateRequest)
	g.POST("/requests/:id/pay", h.PayRequest)
	g.POST("/requests/:id/decline", h.DeclineRequest)
	g.POST("/requests/:id/cancel", h.CancelRequest)
	// split bill
	g.GET("/splits", h.ListSplits)
	g.POST("/splits", h.CreateSplit)
	g.GET("/splits/:id", h.GetSplit)
	g.POST("/splits/:id/shares/:shareId/pay", h.PayShare)
	// group pool
	g.GET("/pools", h.ListPools)
	g.POST("/pools", h.CreatePool)
	g.GET("/pools/:id/balance", h.PoolBalance)
	g.POST("/pools/:id/contribute", h.ContributePool)
	g.POST("/pools/:id/payout", h.PayoutPool)

	if admin != nil && guard != nil {
		admin.GET("/splits/:id", guard("social.admin.view"), h.GetSplit)
	}
}

// Additive DB-backed member list reads surfaced by the mobile integration agents
// (Social Pay go-live gap). Each query is scoped to the calling user so the
// default result is "only what this caller may see" (object-level authZ). All
// amounts stay int64 kobo.

// ActivityItem is a single row of the caller's Social Pay activity feed.
type ActivityItem struct {
	Kind          string    `json:"kind"` // send | receive | request
	ID            string    `json:"id"`
	CounterpartID string    `json:"counterpart_id"`
	AmountKobo    int64     `json:"amount_kobo"`
	Note          string    `json:"note"`
	State         string    `json:"state,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// ActivityFeed returns the caller's recent P2P payments (sent + received) and
// money requests, newest first, bounded by limit.
func (s *Service) ActivityFeed(ctx context.Context, userID string, limit int) ([]ActivityItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT kind, id, counterpart, amount_kobo, COALESCE(note,''), state, created_at FROM (
			SELECT 'send'::text AS kind, id, recipient_id AS counterpart, amount_kobo, note, ''::text AS state, created_at
			  FROM social_payments WHERE sender_id = $1
			UNION ALL
			SELECT 'receive'::text, id, sender_id, amount_kobo, note, ''::text, created_at
			  FROM social_payments WHERE recipient_id = $1
			UNION ALL
			SELECT 'request'::text, id,
			       CASE WHEN requester_id = $1 THEN payer_id ELSE requester_id END,
			       amount_kobo, note, state, created_at
			  FROM social_requests WHERE requester_id = $1 OR payer_id = $1
		) feed
		ORDER BY created_at DESC
		LIMIT $2`
	rows, err := s.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ActivityItem{}
	for rows.Next() {
		var it ActivityItem
		if err := rows.Scan(&it.Kind, &it.ID, &it.CounterpartID, &it.AmountKobo, &it.Note, &it.State, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// RequestRow is a money request the caller is party to.
type RequestRow struct {
	Request

	Direction string `json:"direction"` // incoming (I owe) | outgoing (owed to me)
}

// ListRequests returns money requests the caller sent or received, newest first.
func (s *Service) ListRequests(ctx context.Context, userID string, limit int) ([]RequestRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, requester_id, payer_id, amount_kobo, COALESCE(note,''), state,
	                  CASE WHEN payer_id = $1 THEN 'incoming' ELSE 'outgoing' END AS direction
	           FROM social_requests
	           WHERE requester_id = $1 OR payer_id = $1
	           ORDER BY created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RequestRow{}
	for rows.Next() {
		var r RequestRow
		var state string
		if err := rows.Scan(&r.ID, &r.RequesterID, &r.PayerID, &r.AmountKobo, &r.Note, &state, &r.Direction); err != nil {
			return nil, err
		}
		r.State = RequestState(state)
		out = append(out, r)
	}
	return out, rows.Err()
}

// SplitRow is a split bill the caller organised or participates in.
type SplitRow struct {
	SplitBill

	MyState       string `json:"my_state,omitempty"` // this caller's share state
	MyAmountKobo  int64  `json:"my_amount_kobo"`     // this caller's share
	PendingShares int    `json:"pending_shares"`
}

// ListSplits returns split bills the caller organised or has a share in.
func (s *Service) ListSplits(ctx context.Context, userID string, limit int) ([]SplitRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT b.id, b.organiser_id, b.title, b.total_kobo, b.mode, b.state, b.created_at, b.updated_at,
	                  COALESCE(sh.state,'') AS my_state,
	                  COALESCE(sh.amount_kobo,0) AS my_amount,
	                  (SELECT COUNT(*) FROM split_shares p WHERE p.split_id=b.id AND p.state='PENDING') AS pending
	           FROM split_bills b
	           LEFT JOIN split_shares sh ON sh.split_id=b.id AND sh.user_id=$1
	           WHERE b.organiser_id=$1 OR sh.user_id=$1
	           ORDER BY b.created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SplitRow{}
	for rows.Next() {
		var r SplitRow
		var mode, state string
		if err := rows.Scan(&r.ID, &r.OrganiserID, &r.Title, &r.TotalKobo, &mode, &state,
			&r.CreatedAt, &r.UpdatedAt, &r.MyState, &r.MyAmountKobo, &r.PendingShares); err != nil {
			return nil, err
		}
		r.Mode = SplitMode(mode)
		r.State = SplitState(state)
		out = append(out, r)
	}
	return out, rows.Err()
}

// PoolRow is a group pool the caller organises or contributed to, with balance.
type PoolRow struct {
	GroupPool

	BalanceKobo   int64 `json:"balance_kobo"`
	MyContribKobo int64 `json:"my_contribution_kobo"`
}

// ListPools returns pools the caller organised or contributed to, with derived
// balances (NL-8) and the caller's own contribution total.
func (s *Service) ListPools(ctx context.Context, userID string, limit int) ([]PoolRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT p.id, p.organiser_id, p.title, p.beneficiary_id, p.state, p.created_at, p.updated_at,
	                  COALESCE((SELECT SUM(amount_kobo) FROM pool_contributions c WHERE c.pool_id=p.id),0) AS balance,
	                  COALESCE((SELECT SUM(amount_kobo) FROM pool_contributions c WHERE c.pool_id=p.id AND c.user_id=$1 AND c.amount_kobo>0),0) AS my_contrib
	           FROM group_pools p
	           WHERE p.organiser_id=$1
	              OR EXISTS (SELECT 1 FROM pool_contributions c WHERE c.pool_id=p.id AND c.user_id=$1)
	           ORDER BY p.created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PoolRow{}
	for rows.Next() {
		var r PoolRow
		var state string
		if err := rows.Scan(&r.ID, &r.OrganiserID, &r.Title, &r.BeneficiaryID, &state,
			&r.CreatedAt, &r.UpdatedAt, &r.BalanceKobo, &r.MyContribKobo); err != nil {
			return nil, err
		}
		r.State = PoolState(state)
		out = append(out, r)
	}
	return out, rows.Err()
}
