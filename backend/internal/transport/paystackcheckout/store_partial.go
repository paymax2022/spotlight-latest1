package paystackcheckout

// pgx implementation of PartialRefundStore (partial_refund.go) over
// public.transport_paystack_intent_refunds + the refund counters on
// public.transport_paystack_intents. Lock order is ALWAYS intent row first, then
// the piece row, so concurrent Begin/Mark calls can never deadlock.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const partialCols = `reference, refund_key, settlement_id, amount_kobo, status, gateway_refund_id,
	claim_gen, COALESCE(claimed_at, created_at), attempts, post_attempted_at`

func scanPartial(row pgx.Row) (*PartialRefund, error) {
	var r PartialRefund
	if err := row.Scan(&r.Reference, &r.RefundKey, &r.SettlementID, &r.AmountKobo, &r.Status,
		&r.GatewayRefundID, &r.ClaimGen, &r.ClaimedAt, &r.Attempts, &r.PostAttemptedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *PGStore) BeginPartialRefund(ctx context.Context, reference, refundKey, settlementID string, amount int64, staleAfter time.Duration) (*PartialBegin, error) {
	if amount <= 0 {
		return nil, fmt.Errorf("paystackcheckout: piece refund amount must be positive, got %d", amount)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	var dbNow time.Time
	if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&dbNow); err != nil {
		return nil, err
	}
	var status string
	var total, reserved, refunded int64
	err = tx.QueryRow(ctx,
		`SELECT status, amount_kobo, refund_reserved_kobo, refunded_kobo
		   FROM public.transport_paystack_intents WHERE reference=$1 FOR UPDATE`, reference).Scan(&status, &total, &reserved, &refunded)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	if err != nil {
		return nil, err
	}

	row, err := scanPartial(tx.QueryRow(ctx,
		`SELECT `+partialCols+` FROM public.transport_paystack_intent_refunds
		  WHERE reference=$1 AND refund_key=$2 FOR UPDATE`, reference, refundKey))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if errors.Is(err, pgx.ErrNoRows) {
		row = nil
	}
	if row != nil && row.Status == PartialRefunded {
		return &PartialBegin{AlreadyDone: true, Row: *row, ExpectedRefundedKobo: refunded, Now: dbNow}, nil
	}
	if status != StatusConfirmed {
		return nil, ErrIntentNotRefundable
	}
	if row != nil && (row.AmountKobo != amount || row.SettlementID != settlementID) {
		return nil, fmt.Errorf("paystackcheckout: refund row %s/%s exists for a different settlement/amount", reference, refundKey)
	}
	// One piece in flight per intent (the partial unique index is the backstop).
	var other int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM public.transport_paystack_intent_refunds
		  WHERE reference=$1 AND refund_key<>$2 AND status='refunding'`, reference, refundKey).Scan(&other); err != nil {
		return nil, err
	}
	if other > 0 {
		return nil, ErrPartialInFlight
	}

	var begin PartialBegin
	begin.ExpectedRefundedKobo = refunded
	begin.Now = dbNow
	switch {
	case row == nil:
		if reserved+amount > total {
			return nil, ErrPartialCapExceeded
		}
		if _, err := tx.Exec(ctx,
			`UPDATE public.transport_paystack_intents SET refund_reserved_kobo = refund_reserved_kobo + $2 WHERE reference=$1`,
			reference, amount); err != nil {
			return nil, mapPartialErr(err)
		}
		r, err := scanPartial(tx.QueryRow(ctx,
			`INSERT INTO public.transport_paystack_intent_refunds
			   (reference, refund_key, settlement_id, amount_kobo, status, claim_gen, claimed_at)
			 VALUES ($1,$2,$3,$4,'refunding',1,now()) RETURNING `+partialCols,
			reference, refundKey, settlementID, amount))
		if err != nil {
			return nil, mapPartialErr(err)
		}
		begin.Row, begin.Fence, begin.Prev = *r, r.ClaimGen, ""
	case row.Status == PartialRefunding:
		var stale bool
		if err := tx.QueryRow(ctx, `SELECT $1::timestamptz < now() - make_interval(secs => $2)`, row.ClaimedAt, staleAfter.Seconds()).Scan(&stale); err != nil {
			return nil, err
		}
		if !stale {
			return nil, ErrPartialInFlight
		}
		r, err := scanPartial(tx.QueryRow(ctx,
			`UPDATE public.transport_paystack_intent_refunds
			    SET claim_gen=claim_gen+1, claimed_at=now(), attempts=attempts+1
			  WHERE reference=$1 AND refund_key=$2 RETURNING `+partialCols, reference, refundKey))
		if err != nil {
			return nil, err
		}
		begin.Row, begin.Fence, begin.Prev = *r, r.ClaimGen, PartialRefunding
	default: // failed → re-activate
		if reserved+amount > total {
			return nil, ErrPartialCapExceeded
		}
		if _, err := tx.Exec(ctx,
			`UPDATE public.transport_paystack_intents SET refund_reserved_kobo = refund_reserved_kobo + $2 WHERE reference=$1`,
			reference, amount); err != nil {
			return nil, mapPartialErr(err)
		}
		r, err := scanPartial(tx.QueryRow(ctx,
			`UPDATE public.transport_paystack_intent_refunds
			    SET status='refunding', claim_gen=claim_gen+1, claimed_at=now(), attempts=attempts+1
			  WHERE reference=$1 AND refund_key=$2 RETURNING `+partialCols, reference, refundKey))
		if err != nil {
			return nil, mapPartialErr(err)
		}
		begin.Row, begin.Fence, begin.Prev = *r, r.ClaimGen, PartialFailed
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, mapPartialErr(err)
	}
	return &begin, nil
}

// mapPartialErr turns the DB-level backstops into the typed errors.
func mapPartialErr(err error) error {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		switch {
		case pe.Code == "23505" && pe.ConstraintName == "uq_tpi_refunds_one_inflight":
			return ErrPartialInFlight
		case pe.Code == "23514" && pe.ConstraintName == "transport_paystack_intents_refund_cap":
			return ErrPartialCapExceeded
		}
	}
	return err
}

func (s *PGStore) MarkPartialRefunded(ctx context.Context, reference, refundKey string, fence Fence, gatewayRefundID string) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	// intent first (lock order), then the piece
	if _, err := tx.Exec(ctx, `SELECT 1 FROM public.transport_paystack_intents WHERE reference=$1 FOR UPDATE`, reference); err != nil {
		return false, err
	}
	var amount int64
	err = tx.QueryRow(ctx,
		`UPDATE public.transport_paystack_intent_refunds
		    SET status='refunded', gateway_refund_id=NULLIF($4,''), completed_at=now()
		  WHERE reference=$1 AND refund_key=$2 AND status='refunding' AND claim_gen=$3
		  RETURNING amount_kobo`, reference, refundKey, int64(fence), gatewayRefundID).Scan(&amount)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE public.transport_paystack_intents
		    SET refunded_kobo = refunded_kobo + $2,
		        status = CASE WHEN refunded_kobo + $2 = amount_kobo AND status='confirmed' THEN 'refunded' ELSE status END,
		        refund_reference = CASE WHEN refunded_kobo + $2 = amount_kobo THEN COALESCE(refund_reference, NULLIF($3,''), 'rf:'||reference) ELSE refund_reference END
		  WHERE reference=$1`, reference, amount, gatewayRefundID); err != nil {
		return false, mapPartialErr(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func (s *PGStore) MarkPartialFailed(ctx context.Context, reference, refundKey string, fence Fence) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := tx.Exec(ctx, `SELECT 1 FROM public.transport_paystack_intents WHERE reference=$1 FOR UPDATE`, reference); err != nil {
		return false, err
	}
	var amount int64
	err = tx.QueryRow(ctx,
		`UPDATE public.transport_paystack_intent_refunds SET status='failed', post_attempted_at=NULL
		  WHERE reference=$1 AND refund_key=$2 AND status='refunding' AND claim_gen=$3
		  RETURNING amount_kobo`, reference, refundKey, int64(fence)).Scan(&amount)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE public.transport_paystack_intents SET refund_reserved_kobo = refund_reserved_kobo - $2 WHERE reference=$1`,
		reference, amount); err != nil {
		return false, mapPartialErr(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func (s *PGStore) MarkPartialPostAttempt(ctx context.Context, reference, refundKey string, fence Fence) (bool, error) {
	tag, err := s.db.Exec(ctx,
		`UPDATE public.transport_paystack_intent_refunds SET post_attempted_at=now()
		  WHERE reference=$1 AND refund_key=$2 AND status='refunding' AND claim_gen=$3`,
		reference, refundKey, int64(fence))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *PGStore) GetPartial(ctx context.Context, reference, refundKey string) (*PartialRefund, error) {
	r, err := scanPartial(s.db.QueryRow(ctx,
		`SELECT `+partialCols+` FROM public.transport_paystack_intent_refunds WHERE reference=$1 AND refund_key=$2`, reference, refundKey))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

func (s *PGStore) ListPartialsForSweep(ctx context.Context, olderThan time.Duration, limit int) ([]PartialRefund, error) {
	return s.listPartials(ctx,
		`SELECT `+partialCols+` FROM public.transport_paystack_intent_refunds
		  WHERE status='refunding' AND COALESCE(claimed_at, created_at) < now() - make_interval(secs => $1)
		  ORDER BY COALESCE(claimed_at, created_at) ASC LIMIT $2`, olderThan.Seconds(), limit)
}

// ListPartialsAwaitingLedger joins the settlements table (same database): a
// refunded piece whose settlement is still escrowed/disputed needs its ledger
// reversal. The join keeps the batch from being filled by healthy old rows.
func (s *PGStore) ListPartialsAwaitingLedger(ctx context.Context, olderThan time.Duration, limit int) ([]PartialRefund, error) {
	return s.listPartials(ctx,
		`SELECT r.reference, r.refund_key, r.settlement_id, r.amount_kobo, r.status, r.gateway_refund_id,
		        r.claim_gen, COALESCE(r.claimed_at, r.created_at), r.attempts, r.post_attempted_at
		   FROM public.transport_paystack_intent_refunds r
		   JOIN public.settlements st ON st.id::text = r.settlement_id
		  WHERE r.status='refunded' AND st.status IN ('escrowed','disputed')
		    AND COALESCE(r.completed_at, r.created_at) < now() - make_interval(secs => $1)
		  ORDER BY COALESCE(r.completed_at, r.created_at) ASC LIMIT $2`, olderThan.Seconds(), limit)
}

func (s *PGStore) listPartials(ctx context.Context, q string, args ...any) ([]PartialRefund, error) {
	if l, ok := args[len(args)-1].(int); ok && l <= 0 {
		args[len(args)-1] = 100
	}
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PartialRefund
	for rows.Next() {
		r, err := scanPartial(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

var (
	_ Store              = (*PGStore)(nil)
	_ PartialRefundStore = (*PGStore)(nil)
)
