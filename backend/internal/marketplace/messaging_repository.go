package marketplace

import (
	"context"
	"errors"
	"spotlight/backend/go-common/dbutil"
	"time"

	"github.com/jackc/pgx/v5"
)

// messaging_repository.go is the pgx data layer for the ADR-023 listings-and-connect
// "connect" model: persistent 1:1 buyer↔seller conversations ABOUT a listing. This is
// pure metadata — NO ledger, NO idempotency key (messaging is not a money path). Every
// method is PARTICIPANT-SCOPED: only the thread's buyer or seller may read/write it,
// and the scoping is enforced here (and re-asserted in the service) rather than via RLS,
// exactly like the other mkt_* tables (see 20260905000000_marketplace_v1.sql).

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
		if dbutil.IsForeignKeyViolation(err) {
			// mkt_threads.listing_id FK → mkt_listings(id): the listing was
			// removed between the seller resolution above and this upsert —
			// the same ErrListingNotFound the resolution itself returns.
			return nil, ErrListingNotFound
		}
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
	defer func() { _ = tx.Rollback(ctx) }()

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

// deal_reviews_repository.go is the pgx data layer for ADR-023 THREAD-KEYED
// reviews behind the "mark met" signal. A "deal" == a messaging thread
// (mkt_threads). Once a participant marks the deal met, EITHER participant may
// leave the counterparty a single review (mkt_deal_reviews, UNIQUE(thread_id,
// reviewer_id)). This is pure metadata — NO ledger, NO idempotency key, NO money
// path — but participant-level authorization is MANDATORY and is enforced by the
// participant-scoped queries here (re-asserted in the service), exactly like the
// messaging repository and every other mkt_* table (no RLS).
// NOTE: the wire struct is named DealReview (not Review) to avoid colliding with
// the dead order-keyed model.Review (mkt_reviews) that still backs GET
// /sellers/:id/reviews. Its JSON tags are the frozen camelCase mobile contract —
// the Go type name is internal and never crosses the wire.

// DealReview is the caller-relative wire shape for one mkt_deal_reviews row. JSON
// tags are camelCase (the frozen mobile "connect" contract). DealID carries the
// thread_id (dealId == threadId). Rating / Comment / SellerReply are pointers so
// an absent value serializes as JSON null (never 0 / ""), matching the mobile
// Review type (rating: number|null, comment: string|null, sellerReply: string|null).
type DealReview struct {
	ID           string `json:"id"`
	DealID       string `json:"dealId"`
	ReviewerID   string `json:"reviewerId"`
	RevieweeID   string `json:"revieweeId"`
	ReviewerName string `json:"reviewerName"`
	Rating       *int   `json:"rating"`
	// ProductQualityRating is the second sub-score: how the buyer rates the
	// ITEM transacted for, separate from Rating (the overall/seller score).
	// Nullable — a review submitted before this field existed, or one where
	// the reviewer skipped it, has no product-specific score.
	ProductQualityRating *int      `json:"productQualityRating"`
	Comment              *string   `json:"comment"`
	Tags                 []string  `json:"tags"`
	SellerReply          *string   `json:"sellerReply"`
	IsPlaceholder        bool      `json:"isPlaceholder"`
	ModerationState      string    `json:"moderationState"`
	CreatedAt            time.Time `json:"createdAt"`
}

// scanDealReview scans one mkt_deal_reviews row joined to public.user_profiles (for
// reviewerName), in the column order emitted by dealReviewSelectCols.
func scanDealReview(row pgx.Row) (DealReview, error) {
	var rv DealReview
	var tags []string
	if err := row.Scan(
		&rv.ID, &rv.DealID, &rv.ReviewerID, &rv.RevieweeID,
		&rv.Rating, &rv.ProductQualityRating, &rv.Comment, &tags, &rv.SellerReply,
		&rv.IsPlaceholder, &rv.ModerationState, &rv.CreatedAt, &rv.ReviewerName,
	); err != nil {
		return DealReview{}, err
	}
	if tags == nil {
		tags = []string{}
	}
	rv.Tags = tags
	return rv, nil
}

// dealReviewSelectCols is the shared projection: mkt_deal_reviews columns in the
// order scanDealReview expects, with the reviewer's full_name sourced from the
// shared public.user_profiles table (no FK; COALESCE to ” when absent so a
// missing profile never breaks the read) — the same cross-module name source the
// messaging read-model uses. Aliases the row source as `r`, so it serves both the
// base-table read and the INSERT ... RETURNING CTE (aliased `ins r`).
const dealReviewSelectCols = `
	r.id, r.thread_id, r.reviewer_id, r.reviewee_id,
	r.rating, r.product_quality_rating, r.comment, r.tags, r.seller_reply,
	r.is_placeholder, r.moderation_state, r.created_at,
	COALESCE((
		SELECT up.full_name FROM public.user_profiles up WHERE up.id = r.reviewer_id
	), '') AS reviewer_name`

// MarkDealMet flips the thread's "met" signal, PARTICIPANT-GUARDED. Idempotent:
// COALESCE keeps the FIRST met_at / met_by, so re-marking is a no-op. 0 rows
// affected ⇒ the caller is neither buyer nor seller (or the thread is gone) ⇒
// ErrThreadNotFound (a non-participant cannot tell "missing" from "not yours").
func (r *Repository) MarkDealMet(ctx context.Context, userID, threadID string) (bool, error) {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.mkt_threads
		SET met_at = COALESCE(met_at, now()),
		    met_by = COALESCE(met_by, $1)
		WHERE id = $2 AND (buyer_id = $1 OR seller_id = $1)`, userID, threadID)
	if err != nil {
		return false, wrapInternal("mark deal met", err)
	}
	if ct.RowsAffected() == 0 {
		return false, ErrThreadNotFound
	}
	return true, nil
}

// InsertDealReview inserts one review (reviewer → reviewee) for a thread and
// returns it joined to public.user_profiles for reviewerName. The
// UNIQUE(thread_id, reviewer_id) constraint enforces one review per participant
// per deal: a 23505 unique_violation is mapped to ErrReviewExists (409). The
// caller (service) has already validated participant scope, the met signal, and
// rating range. comment is stored NULL when empty; tags default to an empty array.
func (r *Repository) InsertDealReview(ctx context.Context, threadID, reviewerID, revieweeID string, rating int, productQualityRating *int, comment string, tags []string) (DealReview, error) {
	if tags == nil {
		tags = []string{}
	}
	var commentArg any
	if comment != "" {
		commentArg = comment
	}
	row := r.db.QueryRow(ctx, `
		WITH ins AS (
			INSERT INTO public.mkt_deal_reviews (thread_id, reviewer_id, reviewee_id, rating, product_quality_rating, comment, tags)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id, thread_id, reviewer_id, reviewee_id, rating, product_quality_rating, comment, tags,
			          seller_reply, is_placeholder, moderation_state, created_at
		)
		SELECT `+dealReviewSelectCols+`
		FROM ins r`,
		threadID, reviewerID, revieweeID, rating, productQualityRating, commentArg, tags)
	rv, err := scanDealReview(row)
	if err != nil {
		if dbutil.IsUniqueViolation(err) {
			return DealReview{}, ErrReviewExists
		}
		if dbutil.IsForeignKeyViolation(err) {
			// mkt_deal_reviews.thread_id FK → mkt_threads(id): the thread was
			// removed between the service's participant/met check and this
			// insert — a 404 for the caller, not a 500.
			return DealReview{}, ErrThreadNotFound
		}
		return DealReview{}, wrapInternal("insert deal review", err)
	}
	return rv, nil
}

// ListRevieweeDealReviews returns the visible reviews a user has RECEIVED
// (reviewee_id = userID), newest first — the seller storefront's review list
// (GET /sellers/:id/reviews). This used to read the dead, order-keyed
// mkt_reviews table (snake_case JSON, no rows written to it since ADR-023
// removed escrow orders) while every review since has been written to
// mkt_deal_reviews (camelCase JSON) — so a new deal review never actually
// reached the storefront it's meant to appear on. under_review rows are
// excluded, mirroring the old query's moderation_state='visible' filter.
func (r *Repository) ListRevieweeDealReviews(ctx context.Context, revieweeID string, limit, offset int) ([]DealReview, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, `
		SELECT `+dealReviewSelectCols+`
		FROM public.mkt_deal_reviews r
		WHERE r.reviewee_id=$1 AND r.moderation_state='visible'
		ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`, revieweeID, limit, offset)
	if err != nil {
		return nil, wrapInternal("list reviewee deal reviews", err)
	}
	defer rows.Close()
	out := make([]DealReview, 0)
	for rows.Next() {
		rv, err := scanDealReview(rows)
		if err != nil {
			return nil, wrapInternal("scan reviewee deal review", err)
		}
		out = append(out, rv)
	}
	return out, rows.Err()
}

// GetDealReviewByReviewer returns the caller's OWN review for a thread (if any).
// ok=false when the caller has not reviewed this deal. Participant scope is
// enforced by the service (which loads the thread first); this read is keyed on
// (thread_id, reviewer_id = caller), so it can only ever return the caller's row.
func (r *Repository) GetDealReviewByReviewer(ctx context.Context, threadID, reviewerID string) (DealReview, bool, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+dealReviewSelectCols+`
		FROM public.mkt_deal_reviews r
		WHERE r.thread_id = $1 AND r.reviewer_id = $2`, threadID, reviewerID)
	rv, err := scanDealReview(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DealReview{}, false, nil
		}
		return DealReview{}, false, wrapInternal("get deal review", err)
	}
	return rv, true, nil
}
