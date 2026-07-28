package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data layer for the marketplace. It NEVER mutates ledger
// tables — money moves via the finance ledger service; this repo records
// marketplace-domain rows (listings, orders, disputes, boosts, offers, reviews,
// saved-searches, flags, outbox, admin audit).
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the marketplace repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

func nullStr(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// ─── Listings ────────────────────────────────────────────────────────────────

const listingCols = `id, market_id, seller_id, category_id, title, description,
	price_kobo, currency, condition, attrs, status, quality_score, escrow_eligible,
	state, lga, moderation_reason_code, view_count, save_count,
	created_at, updated_at, expires_at, sold_at`

func scanListing(row pgx.Row) (*Listing, error) {
	var l Listing
	var status string
	var attrsRaw []byte
	if err := row.Scan(
		&l.ID, &l.MarketID, &l.SellerID, &l.CategoryID, &l.Title, &l.Description,
		&l.PriceKobo, &l.Currency, &l.Condition, &attrsRaw, &status, &l.QualityScore, &l.EscrowEligible,
		&l.State, &l.LGA, &l.ModerationReasonCode, &l.ViewCount, &l.SaveCount,
		&l.CreatedAt, &l.UpdatedAt, &l.ExpiresAt, &l.SoldAt,
	); err != nil {
		return nil, err
	}
	l.Status = ListingStatus(status)
	if len(attrsRaw) > 0 {
		_ = json.Unmarshal(attrsRaw, &l.Attrs)
	}
	if l.Attrs == nil {
		l.Attrs = map[string]any{}
	}
	return &l, nil
}

// InsertListing creates a listing row (status supplied by the service after guard).
func (r *Repository) InsertListing(ctx context.Context, l *Listing) (*Listing, error) {
	if l.Attrs == nil {
		l.Attrs = map[string]any{}
	}
	attrs, _ := json.Marshal(l.Attrs)
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_listings
			(market_id, seller_id, category_id, title, description, price_kobo, currency,
			 condition, attrs, status, escrow_eligible, state, lga)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING `+listingCols,
		l.MarketID, l.SellerID, l.CategoryID, l.Title, l.Description, l.PriceKobo, orStr(l.Currency, "NGN"),
		orStr(l.Condition, "used"), attrs, string(l.Status), l.EscrowEligible, l.State, nullStr(&l.LGA),
	)
	out, err := scanListing(row)
	if err != nil {
		return nil, wrapInternal("insert listing", err)
	}
	return out, nil
}

// GetListing loads a listing by id.
func (r *Repository) GetListing(ctx context.Context, id string) (*Listing, error) {
	row := r.db.QueryRow(ctx, `SELECT `+listingCols+` FROM public.mkt_listings WHERE id=$1`, id)
	l, err := scanListing(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrListingNotFound
		}
		return nil, wrapInternal("get listing", err)
	}
	return l, nil
}

// SetListingStatus performs a guarded, status-conditioned update. The WHERE on the
// current status is the optimistic guard: a 0-row update means a concurrent writer
// raced (or the listing left the expected state). moderationReason is stored on
// removal transitions (never NULL when rejected).
func (r *Repository) SetListingStatus(ctx context.Context, id string, from, to ListingStatus, moderationReason *string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.mkt_listings
		SET status=$2::listing_status,
		    moderation_reason_code=COALESCE($4, moderation_reason_code),
		    sold_at = CASE WHEN $2::listing_status='sold'::listing_status THEN now() ELSE sold_at END,
		    updated_at=now()
		WHERE id=$1 AND status=$3::listing_status`, id, string(to), string(from), moderationReason)
	if err != nil {
		return wrapInternal("set listing status", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// UpdateListingMutable updates the editable subset of a listing (title/desc/price/attrs).
func (r *Repository) UpdateListingMutable(ctx context.Context, id string, in UpdateListingInput) error {
	var attrs any
	if in.Attrs != nil {
		b, _ := json.Marshal(in.Attrs)
		attrs = b
	}
	ct, err := r.db.Exec(ctx, `
		UPDATE public.mkt_listings SET
			title=COALESCE($2,title),
			description=COALESCE($3,description),
			price_kobo=COALESCE($4,price_kobo),
			attrs=COALESCE($5,attrs),
			updated_at=now()
		WHERE id=$1`, id, in.Title, in.Description, in.PriceKobo, attrs)
	if err != nil {
		return wrapInternal("update listing", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrListingNotFound
	}
	return nil
}

// CountNonTerminalOrdersForListing counts orders referencing a listing that are not
// in a terminal state (§8: block price/core edits while a live order exists).
func (r *Repository) CountNonTerminalOrdersForListing(ctx context.Context, listingID string) (int, error) {
	const q = `SELECT COUNT(*) FROM public.mkt_orders
		WHERE listing_id=$1 AND status NOT IN ('released','cancelled','refunded','split_settled')`
	var n int
	err := r.db.QueryRow(ctx, q, listingID).Scan(&n)
	return n, err
}

// ListSellerListings returns a seller's listings newest-first.
func (r *Repository) ListSellerListings(ctx context.Context, sellerID string, limit, offset int) ([]Listing, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, `SELECT `+listingCols+`
		FROM public.mkt_listings WHERE seller_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
		sellerID, limit, offset)
	if err != nil {
		return nil, wrapInternal("list seller listings", err)
	}
	defer rows.Close()
	return collectListings(rows)
}

// ModerationQueue returns pending_review listings for the admin moderation queue.
func (r *Repository) ModerationQueue(ctx context.Context, limit, offset int) ([]Listing, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, `SELECT `+listingCols+`
		FROM public.mkt_listings WHERE status='pending_review' ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
		limit, offset)
	if err != nil {
		return nil, wrapInternal("moderation queue", err)
	}
	defer rows.Close()
	return collectListings(rows)
}

// ExpiredActiveListings returns active listings past expires_at (cron sweep).
func (r *Repository) ExpiredActiveListings(ctx context.Context, now time.Time, limit int) ([]Listing, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, `SELECT `+listingCols+`
		FROM public.mkt_listings WHERE status='active' AND expires_at < $1 ORDER BY expires_at ASC LIMIT $2`,
		now, limit)
	if err != nil {
		return nil, wrapInternal("expired listings", err)
	}
	defer rows.Close()
	return collectListings(rows)
}

func collectListings(rows pgx.Rows) ([]Listing, error) {
	var out []Listing
	for rows.Next() {
		l, err := scanListing(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *l)
	}
	return out, rows.Err()
}

// ─── Outbox (A writes, Agent B reads) ────────────────────────────────────────

// InsertOutbox appends a search-CDC row. Called inside the same tx/flow as any
// listing status change that affects discovery.
func (r *Repository) InsertOutbox(ctx context.Context, tx pgx.Tx, listingID, op string, payload any) error {
	b, _ := json.Marshal(payload)
	q := `INSERT INTO public.mkt_listings_outbox (listing_id, op, payload) VALUES ($1,$2,$3)`
	if tx != nil {
		_, err := tx.Exec(ctx, q, listingID, op, b)
		return err
	}
	_, err := r.db.Exec(ctx, q, listingID, op, b)
	return err
}

// ─── Orders ──────────────────────────────────────────────────────────────────

const orderCols = `id, market_id, listing_id, buyer_id, seller_id, offer_id,
	amount_kobo, escrow_fee_kobo, delivery_fee_kobo, status,
	ledger_fund_ref, ledger_release_ref, delivery_ref, pod_photo_url,
	inspection_deadline, idempotency_key,
	created_at, updated_at, funded_at, delivered_at, released_at, cancelled_at`

func scanOrder(row pgx.Row) (*Order, error) {
	var o Order
	var status string
	if err := row.Scan(
		&o.ID, &o.MarketID, &o.ListingID, &o.BuyerID, &o.SellerID, &o.OfferID,
		&o.AmountKobo, &o.EscrowFeeKobo, &o.DeliveryFeeKobo, &status,
		&o.LedgerFundRef, &o.LedgerReleaseRef, &o.DeliveryRef, &o.PODPhotoURL,
		&o.InspectionDeadline, &o.IdempotencyKey,
		&o.CreatedAt, &o.UpdatedAt, &o.FundedAt, &o.DeliveredAt, &o.ReleasedAt, &o.CancelledAt,
	); err != nil {
		return nil, err
	}
	o.Status = OrderStatus(status)
	return &o, nil
}

// InsertOrder creates an order in `initiated`. idempotency_key is UNIQUE (§1) — a
// duplicate key returns a pgx unique-violation the service maps to a replay.
func (r *Repository) InsertOrder(ctx context.Context, o *Order) (*Order, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_orders
			(market_id, listing_id, buyer_id, seller_id, offer_id, amount_kobo,
			 escrow_fee_kobo, delivery_fee_kobo, status, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING `+orderCols,
		o.MarketID, o.ListingID, o.BuyerID, o.SellerID, o.OfferID, o.AmountKobo,
		o.EscrowFeeKobo, o.DeliveryFeeKobo, string(OrderInitiated), o.IdempotencyKey,
	)
	out, err := scanOrder(row)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrConflict // caller maps to idempotency replay
		}
		return nil, wrapInternal("insert order", err)
	}
	return out, nil
}

// InsertOrderAtomic creates an escrow order under a DB-level optimistic lock so two
// buyers racing on the same single-quantity listing cannot both succeed (§8 CreateOrder
// race). It runs in a transaction that:
//  1. SELECT … FOR UPDATE on the listing row (serializes concurrent CreateOrder calls
//     on the same listing — the loser blocks until the winner commits),
//  2. re-verifies listing.status = 'active' INSIDE the lock (closes the read-then-write
//     TOCTOU: a status flip by the winner is now visible),
//  3. rejects if a non-terminal order already references the listing (single-quantity),
//  4. inserts the order.
//
// On the race-loser path it returns ErrListingNotActiveRace so the service maps a clean
// 422 LISTING_NOT_ACTIVE. A UNIQUE(idempotency_key) violation still surfaces as
// ErrConflict for the idempotency-replay path.
func (r *Repository) InsertOrderAtomic(ctx context.Context, o *Order) (*Order, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, wrapInternal("begin order tx", err)
	}
	defer tx.Rollback(ctx)

	// (1) Lock the listing row; (2) read its current status under the lock.
	var status string
	if err := tx.QueryRow(ctx,
		`SELECT status FROM public.mkt_listings WHERE id=$1 FOR UPDATE`, o.ListingID,
	).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrListingNotFound
		}
		return nil, wrapInternal("lock listing", err)
	}
	if ListingStatus(status) != ListingActive {
		return nil, ErrListingNotActiveRace
	}

	// (3) Single-quantity guarantee: no other non-terminal order on this listing.
	var live int
	if err := tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.mkt_orders
		 WHERE listing_id=$1 AND status NOT IN ('cancelled','refunded')`, o.ListingID,
	).Scan(&live); err != nil {
		return nil, wrapInternal("count live orders", err)
	}
	if live > 0 {
		return nil, ErrListingNotActiveRace
	}

	// (4) Insert the order inside the same transaction.
	row := tx.QueryRow(ctx, `
		INSERT INTO public.mkt_orders
			(market_id, listing_id, buyer_id, seller_id, offer_id, amount_kobo,
			 escrow_fee_kobo, delivery_fee_kobo, status, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING `+orderCols,
		o.MarketID, o.ListingID, o.BuyerID, o.SellerID, o.OfferID, o.AmountKobo,
		o.EscrowFeeKobo, o.DeliveryFeeKobo, string(OrderInitiated), o.IdempotencyKey,
	)
	out, err := scanOrder(row)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrConflict // caller maps to idempotency replay
		}
		return nil, wrapInternal("insert order", err)
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrConflict
		}
		return nil, wrapInternal("commit order tx", err)
	}
	return out, nil
}

// GetOrder loads an order by id.
func (r *Repository) GetOrder(ctx context.Context, id string) (*Order, error) {
	row := r.db.QueryRow(ctx, `SELECT `+orderCols+` FROM public.mkt_orders WHERE id=$1`, id)
	o, err := scanOrder(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOrderNotFound
		}
		return nil, wrapInternal("get order", err)
	}
	return o, nil
}

// GetOrderByIdempotencyKey finds a prior order created with the same key (24h replay
// backstop when Redis is cold).
func (r *Repository) GetOrderByIdempotencyKey(ctx context.Context, key string) (*Order, error) {
	row := r.db.QueryRow(ctx, `SELECT `+orderCols+` FROM public.mkt_orders WHERE idempotency_key=$1`, key)
	o, err := scanOrder(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOrderNotFound
		}
		return nil, wrapInternal("get order by idem", err)
	}
	return o, nil
}

// GetOrderByDeliveryRef finds an order by its logistics delivery_ref (webhook idem).
func (r *Repository) GetOrderByDeliveryRef(ctx context.Context, deliveryRef string) (*Order, error) {
	row := r.db.QueryRow(ctx, `SELECT `+orderCols+` FROM public.mkt_orders WHERE delivery_ref=$1`, deliveryRef)
	o, err := scanOrder(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOrderNotFound
		}
		return nil, wrapInternal("get order by delivery_ref", err)
	}
	return o, nil
}

// SetOrderStatus performs a guarded, status-conditioned transition and stamps the
// per-transition columns (fund/release refs, delivery ref, deadlines, timestamps).
// The WHERE on the from-status is the optimistic concurrency guard.
func (r *Repository) SetOrderStatus(ctx context.Context, id string, from, to OrderStatus, patch OrderPatch) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.mkt_orders SET
			status=$3,
			ledger_fund_ref    = COALESCE($4, ledger_fund_ref),
			ledger_release_ref = COALESCE($5, ledger_release_ref),
			delivery_ref       = COALESCE($6, delivery_ref),
			pod_photo_url      = COALESCE($7, pod_photo_url),
			inspection_deadline= COALESCE($8, inspection_deadline),
			funded_at    = CASE WHEN $3='funded'    THEN now() ELSE funded_at    END,
			delivered_at = CASE WHEN $3='delivered' THEN now() ELSE delivered_at END,
			released_at  = CASE WHEN $3='released'  THEN now() ELSE released_at  END,
			cancelled_at = CASE WHEN $3='cancelled' THEN now() ELSE cancelled_at END,
			updated_at=now()
		WHERE id=$1 AND status=$2`,
		id, string(from), string(to),
		patch.LedgerFundRef, patch.LedgerReleaseRef, patch.DeliveryRef, patch.PODPhotoURL, patch.InspectionDeadline,
	)
	if err != nil {
		return wrapInternal("set order status", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// OrderPatch carries the optional per-transition column updates.
type OrderPatch struct {
	LedgerFundRef      *string
	LedgerReleaseRef   *string
	DeliveryRef        *string
	PODPhotoURL        *string
	InspectionDeadline *time.Time
}

// ListOrders returns orders for a user filtered by role (buyer|seller) and status.
func (r *Repository) ListOrders(ctx context.Context, userID, role, status string, limit, offset int) ([]Order, error) {
	limit = clampLimit(limit)
	col := "buyer_id"
	if role == "seller" {
		col = "seller_id"
	}
	q := `SELECT ` + orderCols + ` FROM public.mkt_orders WHERE ` + col + `=$1`
	args := []any{userID}
	if status != "" {
		q += ` AND status=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`
		args = append(args, status, limit, offset)
	} else {
		q += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`
		args = append(args, limit, offset)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, wrapInternal("list orders", err)
	}
	defer rows.Close()
	var out []Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// DueForAutoRelease returns inspection_window orders past their deadline with no open
// dispute (§2.2 auto_release; §6.2 cron path).
func (r *Repository) DueForAutoRelease(ctx context.Context, now time.Time, limit int) ([]Order, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, `
		SELECT `+orderCols+` FROM public.mkt_orders o
		WHERE o.status='inspection_window' AND o.inspection_deadline < $1
		  AND NOT EXISTS (
		    SELECT 1 FROM public.mkt_disputes d
		    WHERE d.order_id=o.id AND d.status NOT IN ('closed','executed'))
		ORDER BY o.inspection_deadline ASC LIMIT $2`, now, limit)
	if err != nil {
		return nil, wrapInternal("due for auto-release", err)
	}
	defer rows.Close()
	var out []Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// AgingOrders returns non-terminal orders older than the cutoff (admin aging board, §8).
func (r *Repository) AgingOrders(ctx context.Context, olderThan time.Time, limit, offset int) ([]Order, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, `
		SELECT `+orderCols+` FROM public.mkt_orders
		WHERE status NOT IN ('released','cancelled','refunded','split_settled')
		  AND created_at < $1
		ORDER BY created_at ASC LIMIT $2 OFFSET $3`, olderThan, limit, offset)
	if err != nil {
		return nil, wrapInternal("aging orders", err)
	}
	defer rows.Close()
	var out []Order
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *o)
	}
	return out, rows.Err()
}

// ─── Disputes ────────────────────────────────────────────────────────────────

const disputeCols = `id, order_id, opened_by, reason_code, status, decision,
	decision_notes, decided_by, second_approver_id, requires_dual_approval,
	evidence_deadline, created_at, decided_at, executed_at`

func scanDispute(row pgx.Row) (*Dispute, error) {
	var d Dispute
	var status string
	if err := row.Scan(
		&d.ID, &d.OrderID, &d.OpenedBy, &d.ReasonCode, &status, &d.Decision,
		&d.DecisionNotes, &d.DecidedBy, &d.SecondApproverID, &d.RequiresDualApproval,
		&d.EvidenceDeadline, &d.CreatedAt, &d.DecidedAt, &d.ExecutedAt,
	); err != nil {
		return nil, err
	}
	d.Status = DisputeStatus(status)
	return &d, nil
}

// InsertDispute creates a dispute in `opened`. UNIQUE-per-open-order is enforced at
// the service by checking for an existing non-closed dispute first.
func (r *Repository) InsertDispute(ctx context.Context, d *Dispute) (*Dispute, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_disputes
			(order_id, opened_by, reason_code, status, requires_dual_approval, evidence_deadline)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING `+disputeCols,
		d.OrderID, d.OpenedBy, d.ReasonCode, string(DisputeOpened), d.RequiresDualApproval, d.EvidenceDeadline,
	)
	out, err := scanDispute(row)
	if err != nil {
		return nil, wrapInternal("insert dispute", err)
	}
	return out, nil
}

// GetDispute loads a dispute by id.
func (r *Repository) GetDispute(ctx context.Context, id string) (*Dispute, error) {
	row := r.db.QueryRow(ctx, `SELECT `+disputeCols+` FROM public.mkt_disputes WHERE id=$1`, id)
	d, err := scanDispute(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDisputeNotFound
		}
		return nil, wrapInternal("get dispute", err)
	}
	return d, nil
}

// OpenDisputeForOrder returns any non-closed dispute already open for an order.
func (r *Repository) OpenDisputeForOrder(ctx context.Context, orderID string) (*Dispute, error) {
	row := r.db.QueryRow(ctx, `SELECT `+disputeCols+`
		FROM public.mkt_disputes WHERE order_id=$1 AND status NOT IN ('closed') ORDER BY created_at DESC LIMIT 1`, orderID)
	d, err := scanDispute(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDisputeNotFound
		}
		return nil, wrapInternal("open dispute for order", err)
	}
	return d, nil
}

// SetDisputeStatus performs a guarded dispute transition, optionally recording a
// decision, decider, second approver, and dual-approval flag.
func (r *Repository) SetDisputeStatus(ctx context.Context, id string, from, to DisputeStatus, patch DisputePatch) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.mkt_disputes SET
			status=$3,
			decision            = COALESCE($4, decision),
			decision_notes      = COALESCE($5, decision_notes),
			decided_by          = COALESCE($6, decided_by),
			second_approver_id  = COALESCE($7, second_approver_id),
			requires_dual_approval = COALESCE($8, requires_dual_approval),
			decided_at  = CASE WHEN $3='decided'  THEN now() ELSE decided_at  END,
			executed_at = CASE WHEN $3='executed' THEN now() ELSE executed_at END
		WHERE id=$1 AND status=$2`,
		id, string(from), string(to),
		patch.Decision, patch.DecisionNotes, patch.DecidedBy, patch.SecondApproverID, patch.RequiresDualApproval,
	)
	if err != nil {
		return wrapInternal("set dispute status", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// DisputePatch carries optional dispute-decision columns.
type DisputePatch struct {
	Decision             *string
	DecisionNotes        *string
	DecidedBy            *string
	SecondApproverID     *string
	RequiresDualApproval *bool
}

// InsertDisputeEvidence appends one evidence row.
func (r *Repository) InsertDisputeEvidence(ctx context.Context, disputeID, submittedBy, evType, urlOrText string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.mkt_dispute_evidence (dispute_id, submitted_by, evidence_type, url_or_text)
		VALUES ($1,$2,$3,$4)`, disputeID, submittedBy, evType, urlOrText)
	return err
}

// DisputeQueue returns disputes for the admin workbench (optionally by status).
func (r *Repository) DisputeQueue(ctx context.Context, status string, limit, offset int) ([]Dispute, error) {
	limit = clampLimit(limit)
	q := `SELECT ` + disputeCols + ` FROM public.mkt_disputes`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`
		args = append(args, status, limit, offset)
	} else {
		q += ` WHERE status NOT IN ('closed','executed') ORDER BY created_at ASC LIMIT $1 OFFSET $2`
		args = append(args, limit, offset)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, wrapInternal("dispute queue", err)
	}
	defer rows.Close()
	var out []Dispute
	for rows.Next() {
		d, err := scanDispute(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

// ─── Boosts ──────────────────────────────────────────────────────────────────

const boostCols = `id, listing_id, seller_id, tier, duration_days, price_kobo,
	ledger_charge_ref, status, rejection_reason_code, refund_ref, starts_at, ends_at, created_at`

func scanBoost(row pgx.Row) (*Boost, error) {
	var b Boost
	var status string
	if err := row.Scan(
		&b.ID, &b.ListingID, &b.SellerID, &b.Tier, &b.DurationDays, &b.PriceKobo,
		&b.LedgerChargeRef, &status, &b.RejectionReasonCode, &b.RefundRef, &b.StartsAt, &b.EndsAt, &b.CreatedAt,
	); err != nil {
		return nil, err
	}
	b.Status = BoostStatus(status)
	return &b, nil
}

// InsertBoost creates a boost row (charge ref already posted by the service).
func (r *Repository) InsertBoost(ctx context.Context, b *Boost) (*Boost, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_boosts
			(listing_id, seller_id, tier, duration_days, price_kobo, ledger_charge_ref, status, starts_at, ends_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING `+boostCols,
		b.ListingID, b.SellerID, b.Tier, b.DurationDays, b.PriceKobo, b.LedgerChargeRef, string(b.Status), b.StartsAt, b.EndsAt,
	)
	out, err := scanBoost(row)
	if err != nil {
		return nil, wrapInternal("insert boost", err)
	}
	return out, nil
}

// ActiveBoostsForListing returns every boost on a listing that is still in a
// refundable, live state (purchased or active). Used by the §8 boost cascade: when a
// listing is rejected to removed_policy, each such boost must auto-transition
// rejected_with_reason → auto_refunded in the same flow.
func (r *Repository) ActiveBoostsForListing(ctx context.Context, listingID string) ([]Boost, error) {
	rows, err := r.db.Query(ctx, `SELECT `+boostCols+`
		FROM public.mkt_boosts
		WHERE listing_id=$1 AND status IN ('purchased','active')`, listingID)
	if err != nil {
		return nil, wrapInternal("active boosts for listing", err)
	}
	defer rows.Close()
	var out []Boost
	for rows.Next() {
		b, serr := scanBoost(rows)
		if serr != nil {
			return nil, wrapInternal("scan boost", serr)
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// GetBoost loads a boost by id.
func (r *Repository) GetBoost(ctx context.Context, id string) (*Boost, error) {
	row := r.db.QueryRow(ctx, `SELECT `+boostCols+` FROM public.mkt_boosts WHERE id=$1`, id)
	b, err := scanBoost(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrBoostNotFound
		}
		return nil, wrapInternal("get boost", err)
	}
	return b, nil
}

// SetBoostStatus performs a guarded boost transition, optionally recording rejection
// reason + refund ref.
func (r *Repository) SetBoostStatus(ctx context.Context, id string, from, to BoostStatus, rejectionReason, refundRef *string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.mkt_boosts SET
			status=$3,
			rejection_reason_code=COALESCE($4, rejection_reason_code),
			refund_ref=COALESCE($5, refund_ref)
		WHERE id=$1 AND status=$2`, id, string(from), string(to), rejectionReason, refundRef)
	if err != nil {
		return wrapInternal("set boost status", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// ─── Offers ──────────────────────────────────────────────────────────────────

const offerCols = `id, listing_id, buyer_id, offer_price_kobo, status, parent_offer_id, created_at, expires_at`

func scanOffer(row pgx.Row) (*Offer, error) {
	var o Offer
	if err := row.Scan(&o.ID, &o.ListingID, &o.BuyerID, &o.OfferPriceKobo, &o.Status, &o.ParentOfferID, &o.CreatedAt, &o.ExpiresAt); err != nil {
		return nil, err
	}
	return &o, nil
}

// InsertOffer creates a pending offer (optionally chaining a parent for counters).
func (r *Repository) InsertOffer(ctx context.Context, o *Offer) (*Offer, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_offers (listing_id, buyer_id, offer_price_kobo, status, parent_offer_id)
		VALUES ($1,$2,$3,'pending',$4) RETURNING `+offerCols,
		o.ListingID, o.BuyerID, o.OfferPriceKobo, o.ParentOfferID)
	out, err := scanOffer(row)
	if err != nil {
		return nil, wrapInternal("insert offer", err)
	}
	return out, nil
}

// GetOffer loads an offer by id.
func (r *Repository) GetOffer(ctx context.Context, id string) (*Offer, error) {
	row := r.db.QueryRow(ctx, `SELECT `+offerCols+` FROM public.mkt_offers WHERE id=$1`, id)
	o, err := scanOffer(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOfferNotFound
		}
		return nil, wrapInternal("get offer", err)
	}
	return o, nil
}

// SetOfferStatus updates an offer status.
func (r *Repository) SetOfferStatus(ctx context.Context, id, status string) error {
	ct, err := r.db.Exec(ctx, `UPDATE public.mkt_offers SET status=$2 WHERE id=$1`, id, status)
	if err != nil {
		return wrapInternal("set offer status", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrOfferNotFound
	}
	return nil
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

// InsertReview inserts a review (UNIQUE on order_id enforces transaction-gating, §1).
func (r *Repository) InsertReview(ctx context.Context, rev *Review) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.mkt_reviews (order_id, reviewer_id, reviewee_id, rating, comment, is_placeholder, moderation_state)
		VALUES ($1,$2,$3,$4,$5,$6,'visible')`,
		rev.OrderID, rev.ReviewerID, rev.RevieweeID, rev.Rating, rev.Comment, rev.IsPlaceholder)
	if err != nil {
		if isUniqueViolation(err) {
			return &CodedError{Status: 409, Code: CodeReviewExists, Message: "a review already exists for this order"}
		}
		return wrapInternal("insert review", err)
	}
	return nil
}

// ListSellerReviews returns visible reviews for a reviewee (seller profile).
func (r *Repository) ListSellerReviews(ctx context.Context, revieweeID string, limit, offset int) ([]Review, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, `
		SELECT id, order_id, reviewer_id, reviewee_id, rating, comment, seller_reply, is_placeholder, moderation_state, created_at
		FROM public.mkt_reviews WHERE reviewee_id=$1 AND moderation_state='visible'
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, revieweeID, limit, offset)
	if err != nil {
		return nil, wrapInternal("list seller reviews", err)
	}
	defer rows.Close()
	var out []Review
	for rows.Next() {
		var rev Review
		if err := rows.Scan(&rev.ID, &rev.OrderID, &rev.ReviewerID, &rev.RevieweeID, &rev.Rating, &rev.Comment, &rev.SellerReply, &rev.IsPlaceholder, &rev.ModerationState, &rev.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rev)
	}
	return out, rows.Err()
}

// ─── Saved searches ──────────────────────────────────────────────────────────

// InsertSavedSearch creates a saved search.
func (r *Repository) InsertSavedSearch(ctx context.Context, s *SavedSearch) (*SavedSearch, error) {
	filters, _ := json.Marshal(orMapAny(s.Filters))
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_saved_searches (user_id, market_id, query, filters, alert_enabled)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, user_id, market_id, query, filters, alert_enabled, created_at`,
		s.UserID, orStr(s.MarketID, DefaultMarketID), s.Query, filters, s.AlertEnabled)
	out, err := scanSavedSearch(row)
	if err != nil {
		return nil, wrapInternal("insert saved search", err)
	}
	return out, nil
}

func scanSavedSearch(row pgx.Row) (*SavedSearch, error) {
	var s SavedSearch
	var filtersRaw []byte
	if err := row.Scan(&s.ID, &s.UserID, &s.MarketID, &s.Query, &filtersRaw, &s.AlertEnabled, &s.CreatedAt); err != nil {
		return nil, err
	}
	if len(filtersRaw) > 0 {
		_ = json.Unmarshal(filtersRaw, &s.Filters)
	}
	if s.Filters == nil {
		s.Filters = map[string]any{}
	}
	return &s, nil
}

// ListSavedSearches returns a user's saved searches.
func (r *Repository) ListSavedSearches(ctx context.Context, userID string) ([]SavedSearch, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, user_id, market_id, query, filters, alert_enabled, created_at
		FROM public.mkt_saved_searches WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, wrapInternal("list saved searches", err)
	}
	defer rows.Close()
	var out []SavedSearch
	for rows.Next() {
		s, err := scanSavedSearch(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// GetSavedSearchOwner returns the owner user_id of a saved search (OLA check).
func (r *Repository) GetSavedSearchOwner(ctx context.Context, id string) (string, error) {
	var owner string
	err := r.db.QueryRow(ctx, `SELECT user_id FROM public.mkt_saved_searches WHERE id=$1`, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFoundCoded("saved search")
	}
	return owner, err
}

// DeleteSavedSearch removes a saved search.
func (r *Repository) DeleteSavedSearch(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `DELETE FROM public.mkt_saved_searches WHERE id=$1`, id)
	return err
}

// SetSavedSearchAlert toggles the alert flag.
func (r *Repository) SetSavedSearchAlert(ctx context.Context, id string, enabled bool) error {
	_, err := r.db.Exec(ctx, `UPDATE public.mkt_saved_searches SET alert_enabled=$2 WHERE id=$1`, id, enabled)
	return err
}

// ─── Categories ──────────────────────────────────────────────────────────────

// ListCategories returns active categories for a market.
func (r *Repository) ListCategories(ctx context.Context, marketID string) ([]Category, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, market_id, parent_id, slug, name, attribute_schema, risk_tier, commission_bps, is_active
		FROM public.mkt_categories WHERE market_id=$1 AND is_active=TRUE ORDER BY name`, marketID)
	if err != nil {
		return nil, wrapInternal("list categories", err)
	}
	defer rows.Close()
	var out []Category
	for rows.Next() {
		c, err := scanCategory(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// GetCategory loads a category by id.
func (r *Repository) GetCategory(ctx context.Context, id string) (*Category, error) {
	row := r.db.QueryRow(ctx, `
		SELECT id, market_id, parent_id, slug, name, attribute_schema, risk_tier, commission_bps, is_active
		FROM public.mkt_categories WHERE id=$1`, id)
	c, err := scanCategory(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFoundCoded("category")
		}
		return nil, wrapInternal("get category", err)
	}
	return c, nil
}

func scanCategory(row pgx.Row) (*Category, error) {
	var c Category
	var schema []byte
	if err := row.Scan(&c.ID, &c.MarketID, &c.ParentID, &c.Slug, &c.Name, &schema, &c.RiskTier, &c.CommissionBps, &c.IsActive); err != nil {
		return nil, err
	}
	c.AttributeSchema = schema
	return &c, nil
}

// ─── Trust profiles ──────────────────────────────────────────────────────────

// GetTrustProfile loads a seller's trust card (nil-safe defaults when absent).
func (r *Repository) GetTrustProfile(ctx context.Context, userID string) (*TrustProfile, error) {
	row := r.db.QueryRow(ctx, `
		SELECT user_id, market_id, kyc_tier, verified_id_badge, verified_business_badge,
		       completed_escrow_count, dispute_count, trust_score
		FROM public.mkt_trust_scores WHERE user_id=$1`, userID)
	var t TrustProfile
	var tier string
	err := row.Scan(&t.UserID, &t.MarketID, &tier, &t.VerifiedIDBadge, &t.VerifiedBusinessBadge, &t.CompletedEscrowCount, &t.DisputeCount, &t.TrustScore)
	if errors.Is(err, pgx.ErrNoRows) {
		return &TrustProfile{UserID: userID, MarketID: DefaultMarketID, KYCTier: KYCTier0Browse, TrustScore: 0.5}, nil
	}
	if err != nil {
		return nil, wrapInternal("get trust profile", err)
	}
	t.KYCTier = KYCTier(tier)
	return &t, nil
}

// GetBuyerKYCTier returns a user's KYC tier (default tier0 when absent).
func (r *Repository) GetBuyerKYCTier(ctx context.Context, userID string) (KYCTier, error) {
	var tier string
	err := r.db.QueryRow(ctx, `SELECT kyc_tier FROM public.mkt_trust_scores WHERE user_id=$1`, userID).Scan(&tier)
	if errors.Is(err, pgx.ErrNoRows) {
		return KYCTier0Browse, nil
	}
	if err != nil {
		return KYCTier0Browse, wrapInternal("get kyc tier", err)
	}
	return KYCTier(tier), nil
}

// SetVerifiedBadge sets a PERMANENT verification badge (§ trust_scores: never toggled
// off by payment status). Upserts the trust row.
func (r *Repository) SetVerifiedBadge(ctx context.Context, userID string, business bool) error {
	col := "verified_id_badge"
	if business {
		col = "verified_business_badge"
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.mkt_trust_scores (user_id, market_id, `+col+`, account_created_at)
		VALUES ($1,$2,TRUE, now())
		ON CONFLICT (user_id) DO UPDATE SET `+col+`=TRUE, updated_at=now()`, userID, DefaultMarketID)
	return err
}

// ─── Flags ───────────────────────────────────────────────────────────────────

// ListFlags returns open moderation flags.
func (r *Repository) ListFlags(ctx context.Context, status string, limit, offset int) ([]Flag, error) {
	limit = clampLimit(limit)
	if status == "" {
		status = "open"
	}
	rows, err := r.db.Query(ctx, `
		SELECT id, target_type, target_id, reporter_id, reason_code, notes, status, reviewed_by, created_at, reviewed_at
		FROM public.mkt_flags WHERE status=$1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`, status, limit, offset)
	if err != nil {
		return nil, wrapInternal("list flags", err)
	}
	defer rows.Close()
	var out []Flag
	for rows.Next() {
		var f Flag
		if err := rows.Scan(&f.ID, &f.TargetType, &f.TargetID, &f.ReporterID, &f.ReasonCode, &f.Notes, &f.Status, &f.ReviewedBy, &f.CreatedAt, &f.ReviewedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ActionFlag records an admin action (actioned|dismissed) on a flag.
func (r *Repository) ActionFlag(ctx context.Context, id, status, reviewerID string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.mkt_flags SET status=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$1 AND status='open'`,
		id, status, reviewerID)
	if err != nil {
		return wrapInternal("action flag", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// ─── Admin audit log (append-only, immutable) ────────────────────────────────

// InsertAdminAudit writes one immutable mkt_admin_audit_log row. reason_code is
// mandatory (§1 NOT NULL) — the service guarantees it non-empty before calling.
func (r *Repository) InsertAdminAudit(ctx context.Context, e AuditEntry) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.mkt_admin_audit_log
			(admin_id, admin_role, action, target_type, target_id, reason_code, before_state, after_state)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		e.AdminID, orStr(e.AdminRole, "admin"), e.Action, e.TargetType, e.TargetID, e.ReasonCode,
		jsonOrNil(e.BeforeState), jsonOrNil(e.AfterState))
	return err
}

// AuditLog returns audit rows for a target (admin audit-log viewer).
func (r *Repository) AuditLog(ctx context.Context, targetType, targetID string, limit, offset int) ([]AuditRow, error) {
	limit = clampLimit(limit)
	q := `SELECT id, admin_id, admin_role, action, target_type, target_id, reason_code, before_state, after_state, created_at
		FROM public.mkt_admin_audit_log`
	args := []any{}
	if targetType != "" && targetID != "" {
		q += ` WHERE target_type=$1 AND target_id=$2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`
		args = append(args, targetType, targetID, limit, offset)
	} else {
		q += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`
		args = append(args, limit, offset)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, wrapInternal("audit log", err)
	}
	defer rows.Close()
	var out []AuditRow
	for rows.Next() {
		var a AuditRow
		var before, after []byte
		if err := rows.Scan(&a.ID, &a.AdminID, &a.AdminRole, &a.Action, &a.TargetType, &a.TargetID, &a.ReasonCode, &before, &after, &a.CreatedAt); err != nil {
			return nil, err
		}
		a.BeforeState = before
		a.AfterState = after
		out = append(out, a)
	}
	return out, rows.Err()
}

// AuditRow is a read-model of one mkt_admin_audit_log row.
type AuditRow struct {
	ID          int64           `json:"id"`
	AdminID     string          `json:"admin_id"`
	AdminRole   string          `json:"admin_role"`
	Action      string          `json:"action"`
	TargetType  string          `json:"target_type"`
	TargetID    string          `json:"target_id"`
	ReasonCode  string          `json:"reason_code"`
	BeforeState json.RawMessage `json:"before_state"`
	AfterState  json.RawMessage `json:"after_state"`
	CreatedAt   time.Time       `json:"created_at"`
}

// ─── Transactions ────────────────────────────────────────────────────────────

// BeginTx starts a pgx transaction (used where a state change + outbox insert must
// commit atomically).
func (r *Repository) BeginTx(ctx context.Context) (pgx.Tx, error) {
	return r.db.Begin(ctx)
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// sqlStater matches a pgx-wrapped *pgconn.PgError without importing pgconn.
type sqlStater interface{ SQLState() string }

// isUniqueViolation reports whether err is a Postgres 23505 unique_violation.
func isUniqueViolation(err error) bool {
	var pgErr sqlStater
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}

func clampLimit(limit int) int {
	if limit <= 0 || limit > 50 {
		return 20
	}
	return limit
}

func orStr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func orMapAny(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

// ErrNotFoundCoded builds a 404 for a named resource.
func ErrNotFoundCoded(resource string) error {
	return &CodedError{Status: 404, Code: CodeNotFound, Message: fmt.Sprintf("%s not found", resource)}
}
