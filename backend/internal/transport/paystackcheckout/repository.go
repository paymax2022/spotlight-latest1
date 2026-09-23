package paystackcheckout

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IntentRepository is the pgx-backed IntentStore over
// public.transport_ride_paystack_intents. Lives in this package because
// IntentStore's method set references the unexported intentRecord type.
type IntentRepository struct{ db *pgxpool.Pool }

func NewIntentStore(pool *pgxpool.Pool) *IntentRepository { return &IntentRepository{db: pool} }

const intentCols = `reference, rider_id, request_json, amount_kobo, idempotency_key, status, trip_id`

func scanIntent(row pgx.Row) (*intentRecord, error) {
	var r intentRecord
	if err := row.Scan(
		&r.Reference, &r.RiderID, &r.RequestJSON,
		&r.AmountKobo, &r.IdempotencyKey, &r.Status, &r.TripID,
	); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *IntentRepository) PutIntent(ctx context.Context, in intentRecord) (*intentRecord, bool, error) {
	const ins = `INSERT INTO public.transport_ride_paystack_intents
	  (reference, rider_id, request_json, amount_kobo, idempotency_key, status)
	  VALUES ($1,$2,$3,$4,$5,'pending')
	  ON CONFLICT (idempotency_key) DO NOTHING
	  RETURNING ` + intentCols
	if _, err := scanIntent(s.db.QueryRow(ctx, ins,
		in.Reference, in.RiderID, in.RequestJSON, in.AmountKobo, in.IdempotencyKey,
	)); err == nil {
		return nil, true, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	const sel = `SELECT ` + intentCols + ` FROM public.transport_ride_paystack_intents WHERE idempotency_key = $1`
	existing, err := scanIntent(s.db.QueryRow(ctx, sel, in.IdempotencyKey))
	if err != nil {
		return nil, false, err
	}
	return existing, false, nil
}

func (s *IntentRepository) GetByReference(ctx context.Context, reference string) (*intentRecord, error) {
	const q = `SELECT ` + intentCols + ` FROM public.transport_ride_paystack_intents WHERE reference = $1`
	rec, err := scanIntent(s.db.QueryRow(ctx, q, reference))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

// GetByTripID resolves the intent that booked tripID. Used only by
// RefundExternalSettlement, called from transport with a trip id (not a
// gateway reference) — see IntentStore's doc comment.
func (s *IntentRepository) GetByTripID(ctx context.Context, tripID string) (*intentRecord, error) {
	const q = `SELECT ` + intentCols + ` FROM public.transport_ride_paystack_intents WHERE trip_id = $1`
	rec, err := scanIntent(s.db.QueryRow(ctx, q, tripID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

func (s *IntentRepository) ClaimForProcessing(ctx context.Context, reference string) (bool, error) {
	tag, err := s.db.Exec(ctx,
		`UPDATE public.transport_ride_paystack_intents SET status = 'processing' WHERE reference = $1 AND status = 'pending'`,
		reference,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *IntentRepository) MarkStatus(ctx context.Context, reference, status string, tripID, refundReference *string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE public.transport_ride_paystack_intents
		 SET status = $2, trip_id = COALESCE($3, trip_id), refund_reference = COALESCE($4, refund_reference),
		     confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE confirmed_at END
		 WHERE reference = $1`,
		reference, status, tripID, refundReference,
	)
	return err
}
