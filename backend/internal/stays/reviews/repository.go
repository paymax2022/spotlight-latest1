package reviews

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the parameterized data layer for reviews + responses.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the reviews repository.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ReservationGate is the verified-guest gate snapshot: it returns the reservation's
// owning guest, property, and state so the service can enforce "review unlocked only
// after a COMPLETED reservation owned by the caller".
type ReservationGate struct {
	GuestUserID string
	PropertyID  string
	State       string
}

// GetReservationGate loads the gate fields for a reservation (or pgx.ErrNoRows).
func (r *Repository) GetReservationGate(ctx context.Context, reservationID string) (ReservationGate, error) {
	var g ReservationGate
	err := r.db.QueryRow(ctx, `
		SELECT guest_user_id::text, COALESCE(property_id::text,''), state
		FROM public.stays_reservation WHERE id = $1`, reservationID).Scan(
		&g.GuestUserID, &g.PropertyID, &g.State)
	return g, err
}

// Create inserts a review. The partial UNIQUE(reservation_id) makes a second review
// for the same reservation fail (ErrAlreadyReviewed mapped in the service).
func (r *Repository) Create(ctx context.Context, rv Review) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_review
			(reservation_id, property_id, guest_user_id, overall_score, sub_scores, title, body, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'PUBLISHED')
		RETURNING id`,
		rv.ReservationID, rv.PropertyID, rv.GuestUserID, rv.OverallScore,
		orMap(rv.SubScores), rv.Title, rv.Body).Scan(&id)
	return id, err
}

// ExistsForReservation reports whether a reservation already has a review.
func (r *Repository) ExistsForReservation(ctx context.Context, reservationID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM public.stays_review WHERE reservation_id = $1)`, reservationID).Scan(&ok)
	return ok, err
}

const reviewCols = `id, reservation_id, property_id, guest_user_id, overall_score,
	sub_scores, title, body, status, flagged_reason, created_at`

func scanReview(row interface{ Scan(dest ...any) error }) (Review, error) {
	var rv Review
	if err := row.Scan(&rv.ID, &rv.ReservationID, &rv.PropertyID, &rv.GuestUserID,
		&rv.OverallScore, &rv.SubScores, &rv.Title, &rv.Body, &rv.Status, &rv.FlaggedReason,
		&rv.CreatedAt); err != nil {
		return Review{}, err
	}
	return rv, nil
}

// ListByProperty returns PUBLISHED reviews for a property (public member surface).
func (r *Repository) ListByProperty(ctx context.Context, propertyID string, limit, offset int) ([]Review, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+reviewCols+` FROM public.stays_review
		WHERE property_id = $1 AND status = 'PUBLISHED'
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, propertyID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Review
	for rows.Next() {
		rv, err := scanReview(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rv)
	}
	return out, rows.Err()
}

// ListByPropertyAll returns all reviews for a property (hotelier/admin surface).
func (r *Repository) ListByPropertyAll(ctx context.Context, propertyID string, limit, offset int) ([]Review, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+reviewCols+` FROM public.stays_review
		WHERE property_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, propertyID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Review
	for rows.Next() {
		rv, err := scanReview(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rv)
	}
	return out, rows.Err()
}

// ListByGuest returns the caller's own reviews.
func (r *Repository) ListByGuest(ctx context.Context, guestUserID string, limit, offset int) ([]Review, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+reviewCols+` FROM public.stays_review
		WHERE guest_user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, guestUserID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Review
	for rows.Next() {
		rv, err := scanReview(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rv)
	}
	return out, rows.Err()
}

// Get returns a review by id.
func (r *Repository) Get(ctx context.Context, reviewID string) (Review, error) {
	row := r.db.QueryRow(ctx, `SELECT `+reviewCols+` FROM public.stays_review WHERE id = $1`, reviewID)
	return scanReview(row)
}

// PropertyOfReview resolves the owning property of a review (object-scope authZ).
func (r *Repository) PropertyOfReview(ctx context.Context, reviewID string) (string, error) {
	var pid string
	err := r.db.QueryRow(ctx, `SELECT property_id::text FROM public.stays_review WHERE id = $1`, reviewID).Scan(&pid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("reviews: review not found")
	}
	return pid, err
}

// SetStatus moderates a review (admin: FLAGGED/HIDDEN/PUBLISHED).
func (r *Repository) SetStatus(ctx context.Context, reviewID, status, reason string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE public.stays_review SET status = $2, flagged_reason = $3, updated_at = now()
		WHERE id = $1`, reviewID, status, reason)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("reviews: review not found")
	}
	return nil
}

// UpsertResponse writes/updates the hotelier response to a review.
func (r *Repository) UpsertResponse(ctx context.Context, reviewID, propertyID, responderUserID, body string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.stays_review_response (review_id, property_id, responder_user_id, body)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (review_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
		RETURNING id`, reviewID, propertyID, responderUserID, body).Scan(&id)
	return id, err
}

// GetResponse returns the response for a review (or pgx.ErrNoRows).
func (r *Repository) GetResponse(ctx context.Context, reviewID string) (Response, error) {
	var rsp Response
	err := r.db.QueryRow(ctx, `
		SELECT id, review_id, property_id, COALESCE(responder_user_id::text,''), body, created_at
		FROM public.stays_review_response WHERE review_id = $1`, reviewID).Scan(
		&rsp.ID, &rsp.ReviewID, &rsp.PropertyID, &rsp.ResponderUserID, &rsp.Body, &rsp.CreatedAt)
	return rsp, err
}

func orMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}
