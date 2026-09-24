package paystackcheckout

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IntentRepository is the pgx-backed IntentStore over
// public.restaurant_order_paystack_intents. Lives in this package because
// IntentStore's method set references the unexported intentRecord type.
type IntentRepository struct{ db *pgxpool.Pool }

// NewIntentStore builds the pgx IntentStore. Wire it at the composition root.
func NewIntentStore(pool *pgxpool.Pool) *IntentRepository { return &IntentRepository{db: pool} }

const intentCols = `reference, restaurant_id, customer_id, request_json, amount_kobo, idempotency_key, status, order_id`

func scanIntent(row pgx.Row) (*intentRecord, error) {
	var r intentRecord
	if err := row.Scan(
		&r.Reference, &r.RestaurantID, &r.CustomerID, &r.RequestJSON,
		&r.AmountKobo, &r.IdempotencyKey, &r.Status, &r.OrderID,
	); err != nil {
		return nil, err
	}
	return &r, nil
}

// PutIntent records a pending intent idempotently on idempotency_key. On a
// fresh insert it returns (nil, true, nil). On a replay (same key) it returns
// the EXISTING row (existing, false, nil) so the caller reuses the same
// reference/gateway session.
func (s *IntentRepository) PutIntent(ctx context.Context, in intentRecord) (*intentRecord, bool, error) {
	const ins = `INSERT INTO public.restaurant_order_paystack_intents
	  (reference, restaurant_id, customer_id, request_json, amount_kobo, idempotency_key, status)
	  VALUES ($1,$2,$3,$4,$5,$6,'pending')
	  ON CONFLICT (idempotency_key) DO NOTHING
	  RETURNING ` + intentCols
	if _, err := scanIntent(s.db.QueryRow(ctx, ins,
		in.Reference, in.RestaurantID, in.CustomerID, in.RequestJSON,
		in.AmountKobo, in.IdempotencyKey,
	)); err == nil {
		return nil, true, nil // freshly inserted — no prior record
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	// Conflict on idempotency_key → return the existing row (replay).
	const sel = `SELECT ` + intentCols + ` FROM public.restaurant_order_paystack_intents WHERE idempotency_key = $1`
	existing, err := scanIntent(s.db.QueryRow(ctx, sel, in.IdempotencyKey))
	if err != nil {
		return nil, false, err
	}
	return existing, false, nil
}

// GetByReference resolves a pending intent by gateway reference. Not-found
// returns ErrUnknownReference so callers can treat it as a benign no-op.
func (s *IntentRepository) GetByReference(ctx context.Context, reference string) (*intentRecord, error) {
	const q = `SELECT ` + intentCols + ` FROM public.restaurant_order_paystack_intents WHERE reference = $1`
	rec, err := scanIntent(s.db.QueryRow(ctx, q, reference))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

// GetByOrderID resolves the intent that placed orderID. Used only by
// RefundExternalSettlement, called from restaurant with an order id (not a
// gateway reference) — see IntentStore's doc comment.
func (s *IntentRepository) GetByOrderID(ctx context.Context, orderID string) (*intentRecord, error) {
	const q = `SELECT ` + intentCols + ` FROM public.restaurant_order_paystack_intents WHERE order_id = $1`
	rec, err := scanIntent(s.db.QueryRow(ctx, q, orderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

// ClaimForProcessing atomically transitions "pending" → "processing" via a
// single conditional UPDATE, so two concurrent deliveries for the same
// reference (a redelivered webhook racing a status-poll self-heal, or two
// redelivered webhooks) can never both proceed to refund or place an order.
func (s *IntentRepository) ClaimForProcessing(ctx context.Context, reference string) (bool, error) {
	tag, err := s.db.Exec(ctx,
		`UPDATE public.restaurant_order_paystack_intents SET status = 'processing' WHERE reference = $1 AND status = 'pending'`,
		reference,
	)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// MarkStatus sets the intent's terminal (or "processing") status and,
// when provided, the resulting order id / refund reference.
func (s *IntentRepository) MarkStatus(ctx context.Context, reference, status string, orderID, refundReference *string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE public.restaurant_order_paystack_intents
		 SET status = $2, order_id = COALESCE($3, order_id), refund_reference = COALESCE($4, refund_reference),
		     confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE confirmed_at END
		 WHERE reference = $1`,
		reference, status, orderID, refundReference,
	)
	return err
}
