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
	ID              string    `json:"id"`
	DealID          string    `json:"dealId"`
	ReviewerID      string    `json:"reviewerId"`
	RevieweeID      string    `json:"revieweeId"`
	ReviewerName    string    `json:"reviewerName"`
	Rating          *int      `json:"rating"`
	Comment         *string   `json:"comment"`
	Tags            []string  `json:"tags"`
	SellerReply     *string   `json:"sellerReply"`
	IsPlaceholder   bool      `json:"isPlaceholder"`
	ModerationState string    `json:"moderationState"`
	CreatedAt       time.Time `json:"createdAt"`
}

// scanDealReview scans one mkt_deal_reviews row joined to public.user_profiles (for
// reviewerName), in the column order emitted by dealReviewSelectCols.
func scanDealReview(row pgx.Row) (DealReview, error) {
	var rv DealReview
	var tags []string
	if err := row.Scan(
		&rv.ID, &rv.DealID, &rv.ReviewerID, &rv.RevieweeID,
		&rv.Rating, &rv.Comment, &tags, &rv.SellerReply,
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
// shared public.user_profiles table (no FK; COALESCE to '' when absent so a
// missing profile never breaks the read) — the same cross-module name source the
// messaging read-model uses. Aliases the row source as `r`, so it serves both the
// base-table read and the INSERT ... RETURNING CTE (aliased `ins r`).
const dealReviewSelectCols = `
	r.id, r.thread_id, r.reviewer_id, r.reviewee_id,
	r.rating, r.comment, r.tags, r.seller_reply,
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
func (r *Repository) InsertDealReview(ctx context.Context, threadID, reviewerID, revieweeID string, rating int, comment string, tags []string) (DealReview, error) {
	if tags == nil {
		tags = []string{}
	}
	var commentArg any
	if comment != "" {
		commentArg = comment
	}
	row := r.db.QueryRow(ctx, `
		WITH ins AS (
			INSERT INTO public.mkt_deal_reviews (thread_id, reviewer_id, reviewee_id, rating, comment, tags)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id, thread_id, reviewer_id, reviewee_id, rating, comment, tags,
			          seller_reply, is_placeholder, moderation_state, created_at
		)
		SELECT `+dealReviewSelectCols+`
		FROM ins r`,
		threadID, reviewerID, revieweeID, rating, commentArg, tags)
	rv, err := scanDealReview(row)
	if err != nil {
		if isUniqueViolation(err) {
			return DealReview{}, ErrReviewExists
		}
		return DealReview{}, wrapInternal("insert deal review", err)
	}
	return rv, nil
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
