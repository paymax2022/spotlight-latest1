package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// messaging_repository.go is the pgx data layer for the ADR-023 listings-and-connect
// "connect" model: persistent 1:1 buyer↔seller conversations ABOUT a listing. This is
// pure metadata — NO ledger, NO idempotency key (messaging is not a money path). Every
// method is PARTICIPANT-SCOPED: only the thread's buyer or seller may read/write it,
// and the scoping is enforced here (and re-asserted in the service) rather than via RLS,
// exactly like the other mkt_* tables (see 20260905000000_marketplace_v1.sql).

// ─── Wire structs (camelCase JSON — the mobile "connect" contract is frozen) ─────

// Message mirrors one public.mkt_messages row. The stored column is `body`; the wire
// field the mobile expects is `text`.
type Message struct {
	ID        string    `json:"id"`
	ThreadID  string    `json:"threadId"`
	SenderID  string    `json:"senderId"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

// DealThread is the inbox read-model for one conversation, RELATIVE TO THE CALLER:
// myRole / counterparty* are computed from whether the caller is the thread's buyer or
// seller, and unread counts messages after the caller's own read cursor that the caller
// did not send. escrowEligible is derived from the listing's escrow_eligible flag (it
// may be false per ADR-023 — the marketplace no longer holds escrow).
type DealThread struct {
	ID               string    `json:"id"`
	ListingID        string    `json:"listingId"`
	ListingTitle     string    `json:"listingTitle"`
	ListingThumbURL  string    `json:"listingThumbUrl"`
	ListingPriceKobo int64     `json:"listingPriceKobo"`
	EscrowEligible   bool      `json:"escrowEligible"`
	CounterpartyID   string    `json:"counterpartyId"`
	CounterpartyName string    `json:"counterpartyName"`
	MyRole           string    `json:"myRole"`
	Unread           int       `json:"unread"`
	LastMessageAt    time.Time `json:"lastMessageAt"`
	// Met is the ADR-023 "mark met" signal: true once either participant has marked
	// the deal met (mkt_threads.met_at IS NOT NULL). It gates review-writes — a
	// participant may only review the counterparty after the deal is marked met.
	Met bool `json:"met"`
}

// threadRow is the minimal identity of a thread returned by GetOrCreateThread — the
// service re-reads the full caller-relative DealThread via GetThread afterwards.
type threadRow struct {
	ID        string
	ListingID string
	BuyerID   string
	SellerID  string
}

// dealThreadSelect is the caller-relative thread read-model. $1 is ALWAYS the caller's
// user id. It joins the listing for title/price/escrow flag, sub-selects the first
// media row for the thumbnail, sub-selects the counterparty's full_name from the shared
// public.user_profiles table (the cross-module name source used by other modules; no FK,
// COALESCE to ” when absent so a missing profile never breaks the inbox), and computes
// myRole + unread from the caller's own read cursor.
const dealThreadSelect = `
	SELECT
		t.id,
		t.listing_id,
		COALESCE(l.title, '')              AS listing_title,
		COALESCE((
			SELECT m.url_thumb FROM public.mkt_listing_media m
			WHERE m.listing_id = t.listing_id
			ORDER BY m.sort_order ASC, m.created_at ASC LIMIT 1
		), '')                             AS listing_thumb_url,
		COALESCE(l.price_kobo, 0)          AS listing_price_kobo,
		COALESCE(l.escrow_eligible, FALSE) AS escrow_eligible,
		CASE WHEN t.buyer_id = $1 THEN t.seller_id ELSE t.buyer_id END AS counterparty_id,
		COALESCE((
			SELECT up.full_name FROM public.user_profiles up
			WHERE up.id = CASE WHEN t.buyer_id = $1 THEN t.seller_id ELSE t.buyer_id END
		), '')                             AS counterparty_name,
		CASE WHEN t.buyer_id = $1 THEN 'buyer' ELSE 'seller' END AS my_role,
		(
			SELECT COUNT(*) FROM public.mkt_messages msg
			WHERE msg.thread_id = t.id
			  AND msg.sender_id <> $1
			  AND msg.created_at > COALESCE(
			        CASE WHEN t.buyer_id = $1 THEN t.buyer_last_read_at ELSE t.seller_last_read_at END,
			        'epoch'::timestamptz)
		)                                  AS unread,
		t.last_message_at,
		(t.met_at IS NOT NULL)             AS met
	FROM public.mkt_threads t
	LEFT JOIN public.mkt_listings l ON l.id = t.listing_id`

func scanDealThread(row pgx.Row) (*DealThread, error) {
	var d DealThread
	if err := row.Scan(
		&d.ID, &d.ListingID, &d.ListingTitle, &d.ListingThumbURL, &d.ListingPriceKobo,
		&d.EscrowEligible, &d.CounterpartyID, &d.CounterpartyName, &d.MyRole, &d.Unread, &d.LastMessageAt,
		&d.Met,
	); err != nil {
		return nil, err
	}
	return &d, nil
}

// GetOrCreateThread resolves the listing's seller and upserts the 1:1 (listing, buyer)
// thread. It rejects self-messaging (buyer == seller) and a non-existent listing. The
// ON CONFLICT DO UPDATE (no-op set) makes the upsert idempotent while still RETURNING the
// existing row, so a buyer re-opening a conversation always lands on the same thread.
func (r *Repository) GetOrCreateThread(ctx context.Context, listingID, buyerID string) (*threadRow, error) {
	var sellerID string
	err := r.db.QueryRow(ctx, `SELECT seller_id FROM public.mkt_listings WHERE id=$1`, listingID).Scan(&sellerID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrListingNotFound
		}
		return nil, wrapInternal("get or create thread: resolve seller", err)
	}
	if sellerID == buyerID {
		return nil, ErrCannotMessageSelf
	}

	var tr threadRow
	err = r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_threads (listing_id, buyer_id, seller_id)
		VALUES ($1,$2,$3)
		ON CONFLICT (listing_id, buyer_id)
		DO UPDATE SET seller_id = public.mkt_threads.seller_id
		RETURNING id, listing_id, buyer_id, seller_id`,
		listingID, buyerID, sellerID,
	).Scan(&tr.ID, &tr.ListingID, &tr.BuyerID, &tr.SellerID)
	if err != nil {
		return nil, wrapInternal("get or create thread: upsert", err)
	}
	return &tr, nil
}

// ListThreadsForUser returns every thread the user participates in (as buyer OR seller),
// newest-activity-first, as caller-relative DealThread read-models.
func (r *Repository) ListThreadsForUser(ctx context.Context, userID string, limit, offset int) ([]DealThread, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, dealThreadSelect+`
		WHERE t.buyer_id = $1 OR t.seller_id = $1
		ORDER BY t.last_message_at DESC
		LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, wrapInternal("list threads", err)
	}
	defer rows.Close()
	var out []DealThread
	for rows.Next() {
		d, serr := scanDealThread(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

// GetThread returns one caller-relative DealThread, PARTICIPANT-SCOPED: ok=false when
// the thread does not exist OR the caller is neither its buyer nor its seller (a
// non-participant cannot distinguish the two — both surface as not-found at the handler).
func (r *Repository) GetThread(ctx context.Context, userID, threadID string) (*DealThread, bool, error) {
	row := r.db.QueryRow(ctx, dealThreadSelect+`
		WHERE t.id = $2 AND (t.buyer_id = $1 OR t.seller_id = $1)`, userID, threadID)
	d, err := scanDealThread(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, false, nil
		}
		return nil, false, wrapInternal("get thread", err)
	}
	return d, true, nil
}

// ListMessages returns a thread's messages oldest-first, PARTICIPANT-SCOPED, and stamps
// the caller's read cursor to now() (mark-read-on-fetch). The read-cursor UPDATE doubles
// as the participant check: 0 rows affected ⇒ the caller is not a participant (or the
// thread is gone) ⇒ ErrThreadNotFound, and no messages are read.
func (r *Repository) ListMessages(ctx context.Context, userID, threadID string, limit, offset int) ([]Message, error) {
	limit = clampLimit(limit)
	ct, err := r.db.Exec(ctx, `
		UPDATE public.mkt_threads
		SET buyer_last_read_at  = CASE WHEN buyer_id  = $1 THEN now() ELSE buyer_last_read_at  END,
		    seller_last_read_at = CASE WHEN seller_id = $1 THEN now() ELSE seller_last_read_at END
		WHERE id = $2 AND (buyer_id = $1 OR seller_id = $1)`, userID, threadID)
	if err != nil {
		return nil, wrapInternal("mark thread read", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrThreadNotFound
	}

	rows, err := r.db.Query(ctx, `
		SELECT id, thread_id, sender_id, body, created_at
		FROM public.mkt_messages
		WHERE thread_id = $1
		ORDER BY created_at ASC
		LIMIT $2 OFFSET $3`, threadID, limit, offset)
	if err != nil {
		return nil, wrapInternal("list messages", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if serr := rows.Scan(&m.ID, &m.ThreadID, &m.SenderID, &m.Text, &m.CreatedAt); serr != nil {
			return nil, serr
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SendMessage inserts one message into a thread, PARTICIPANT-SCOPED, and bumps the
// thread's last_message_at so the conversation sorts to the top of both inboxes. Runs in
// a transaction: the participant-guarded UPDATE (0 rows ⇒ ErrThreadNotFound) and the
// message INSERT commit atomically. body must be pre-validated (non-empty, bounded) by
// the service.
func (r *Repository) SendMessage(ctx context.Context, userID, threadID, body string) (*Message, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, wrapInternal("send message: begin", err)
	}
	defer tx.Rollback(ctx)

	ct, err := tx.Exec(ctx, `
		UPDATE public.mkt_threads SET last_message_at = now()
		WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)`, threadID, userID)
	if err != nil {
		return nil, wrapInternal("send message: bump thread", err)
	}
	if ct.RowsAffected() == 0 {
		return nil, ErrThreadNotFound
	}

	var m Message
	err = tx.QueryRow(ctx, `
		INSERT INTO public.mkt_messages (thread_id, sender_id, body)
		VALUES ($1,$2,$3)
		RETURNING id, thread_id, sender_id, body, created_at`,
		threadID, userID, body,
	).Scan(&m.ID, &m.ThreadID, &m.SenderID, &m.Text, &m.CreatedAt)
	if err != nil {
		return nil, wrapInternal("send message: insert", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, wrapInternal("send message: commit", err)
	}
	return &m, nil
}
