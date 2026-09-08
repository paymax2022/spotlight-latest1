package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// deal_reviews_repository.go is the pgx data layer for ADR-023 THREAD-KEYED
// reviews behind the "mark met" signal. A "deal" == a messaging thread
// (mkt_threads). Once a participant marks the deal met, EITHER participant may
// leave the counterparty a single review (mkt_deal_reviews, UNIQUE(thread_id,
// reviewer_id)). This is pure metadata — NO ledger, NO idempotency key, NO money
// path — but participant-level authorization is MANDATORY and is enforced by the
// participant-scoped queries here (re-asserted in the service), exactly like the
// messaging repository and every other mkt_* table (no RLS).
//
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
		if isUniqueViolation(err) {
			return DealReview{}, ErrReviewExists
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
