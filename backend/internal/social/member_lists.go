package social

import (
	"context"
	"time"
)

// Additive DB-backed member list reads surfaced by the mobile integration agents
// (Social Pay go-live gap). Each query is scoped to the calling user so the
// default result is "only what this caller may see" (object-level authZ). All
// amounts stay int64 kobo.

// ActivityItem is a single row of the caller's Social Pay activity feed.
type ActivityItem struct {
	Kind        string    `json:"kind"` // send | receive | request
	ID          string    `json:"id"`
	CounterpartID string  `json:"counterpart_id"`
	AmountKobo  int64     `json:"amount_kobo"`
	Note        string    `json:"note"`
	State       string    `json:"state,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
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
	MyState       string `json:"my_state,omitempty"`   // this caller's share state
	MyAmountKobo  int64  `json:"my_amount_kobo"`       // this caller's share
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
	BalanceKobo    int64 `json:"balance_kobo"`
	MyContribKobo  int64 `json:"my_contribution_kobo"`
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
