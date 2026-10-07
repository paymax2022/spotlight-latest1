package paystackcheckout

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/transport"
)

// PGStore is the pgx-backed Store over public.transport_paystack_intents
// (supabase/migrations/20271008090000_transport_paystack_intents.sql). It
// holds NO money state: the ledger / settlements / entity tables stay the
// source of truth for anything that actually moved.
type PGStore struct{ db *pgxpool.Pool }

func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{db: pool} }

const pgCols = `domain, reference, payer_id, request_json, amount_kobo, idempotency_key, status,
	entity_id, COALESCE(authorization_url,''), COALESCE(access_code,''), refund_reference,
	pricing_json, claim_gen, COALESCE(claimed_at, 'epoch'::timestamptz), created_at,
	COALESCE(refund_from,''), COALESCE(refund_amount_kobo,0)`

func scanPG(row pgx.Row) (*Intent, error) {
	var r Intent
	if err := row.Scan(&r.Domain, &r.Reference, &r.PayerID, &r.RequestJSON, &r.AmountKobo,
		&r.IdempotencyKey, &r.Status, &r.EntityID, &r.AuthorizationURL, &r.AccessCode, &r.RefundReference,
		&r.PricingJSON, &r.ClaimGen, &r.ClaimedAt, &r.CreatedAt, &r.RefundFrom, &r.RefundAmountKobo); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *PGStore) Put(ctx context.Context, in Intent) (*Intent, bool, error) {
	const ins = `INSERT INTO public.transport_paystack_intents
	  (domain, reference, payer_id, request_json, amount_kobo, idempotency_key, status, pricing_json)
	  VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)
	  ON CONFLICT DO NOTHING
	  RETURNING reference`
	var ref string
	var pricing any
	if len(in.PricingJSON) > 0 {
		pricing = []byte(in.PricingJSON)
	}
	err := s.db.QueryRow(ctx, ins, in.Domain, in.Reference, in.PayerID, in.RequestJSON, in.AmountKobo, in.IdempotencyKey, pricing).Scan(&ref)
	if err == nil {
		return nil, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	existing, gerr := s.Get(ctx, in.Reference)
	if gerr != nil {
		if errors.Is(gerr, ErrUnknownReference) {
			// The conflict was on a DIFFERENT unique index than (reference /
			// domain+key): the one-open-checkout-per-mover-job index. Another
			// checkout for the same item is already open (a race the quote-time
			// check could not see).
			return nil, false, transport.NewCodedError(http.StatusConflict, "checkout_in_progress",
				"A card checkout for this item is already open. Resume or finish it before starting another.")
		}
		return nil, false, fmt.Errorf("paystackcheckout: intent insert conflicted but row not found: %w", gerr)
	}
	return existing, false, nil
}

func (s *PGStore) Get(ctx context.Context, reference string) (*Intent, error) {
	rec, err := scanPG(s.db.QueryRow(ctx, `SELECT `+pgCols+` FROM public.transport_paystack_intents WHERE reference=$1`, reference))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

func (s *PGStore) GetByEntity(ctx context.Context, domain, entityID string) (*Intent, error) {
	rec, err := scanPG(s.db.QueryRow(ctx, `SELECT `+pgCols+` FROM public.transport_paystack_intents WHERE domain=$1 AND entity_id=$2`, domain, entityID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnknownReference
	}
	return rec, err
}

func (s *PGStore) SaveAuthorization(ctx context.Context, reference, authorizationURL, accessCode string) error {
	_, err := s.db.Exec(ctx,
		`UPDATE public.transport_paystack_intents SET authorization_url=$2, access_code=$3 WHERE reference=$1 AND status='pending'`,
		reference, authorizationURL, accessCode)
	return err
}

func (s *PGStore) Claim(ctx context.Context, reference string, staleAfter time.Duration) (Fence, bool, error) {
	var gen int64
	err := s.db.QueryRow(ctx,
		`UPDATE public.transport_paystack_intents
		   SET status='processing', claimed_at=now(), claim_gen=claim_gen+1
		 WHERE reference=$1
		   AND (status='pending' OR (status='processing' AND claimed_at < now() - make_interval(secs => $2)))
		 RETURNING claim_gen`,
		reference, staleAfter.Seconds()).Scan(&gen)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return Fence(gen), true, nil
}

func (s *PGStore) BeginRefund(ctx context.Context, reference string, from []string, staleAfter time.Duration) (*BeginRefundResult, bool, error) {
	var (
		gen    int64
		prev   string
		rfrom  string
		amount int64
	)
	err := s.db.QueryRow(ctx,
		`WITH cur AS (
		     SELECT reference, status AS prev FROM public.transport_paystack_intents WHERE reference=$1 FOR UPDATE
		 )
		 UPDATE public.transport_paystack_intents t
		    SET status='refunding', claimed_at=now(), claim_gen=t.claim_gen+1,
		        refund_from = CASE WHEN t.status='refunding' THEN COALESCE(t.refund_from, t.status) ELSE t.status END,
		        refund_amount_kobo = COALESCE(t.refund_amount_kobo, t.amount_kobo)
		   FROM cur
		  WHERE t.reference=cur.reference
		    AND (t.status = ANY($2) OR (t.status='refunding' AND t.claimed_at < now() - make_interval(secs => $3)))
		 RETURNING t.claim_gen, cur.prev, t.refund_from, t.refund_amount_kobo`,
		reference, from, staleAfter.Seconds()).Scan(&gen, &prev, &rfrom, &amount)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return &BeginRefundResult{Fence: Fence(gen), Prev: prev, RefundFrom: rfrom, RefundAmountKobo: amount}, true, nil
}

// Mark applies one FENCED transition: it matches only while the row is still in
// t.From AND still carries t.Fence, so a stalled former owner (whose fence was
// superseded by a takeover) and any writer racing a terminal state affect 0
// rows. applied=false is not an error: the caller lost ownership and must
// re-read, not retry.
func (s *PGStore) Mark(ctx context.Context, reference string, t Transition) (bool, error) {
	tag, err := s.db.Exec(ctx,
		`UPDATE public.transport_paystack_intents
		    SET status=$3,
		        entity_id=COALESCE($5, entity_id),
		        refund_reference=COALESCE($6, refund_reference),
		        refund_from = CASE WHEN $3='refunding' THEN NULLIF($7,'') ELSE refund_from END,
		        refund_amount_kobo = CASE WHEN $3='refunding' AND $8 > 0 THEN $8 ELSE refund_amount_kobo END,
		        claimed_at = CASE WHEN $3 IN ('processing','refunding') THEN now() ELSE claimed_at END,
		        confirmed_at = CASE WHEN $3='confirmed' THEN now() ELSE confirmed_at END
		  WHERE reference=$1 AND status=$2 AND claim_gen=$4`,
		reference, t.From, t.To, int64(t.Fence), t.EntityID, t.RefundReference, t.RefundFrom, t.RefundAmountKobo)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *PGStore) ListForSweep(ctx context.Context, statuses []string, olderThan, maxAge time.Duration, limit int) ([]Intent, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := s.db.Query(ctx,
		`SELECT `+pgCols+` FROM public.transport_paystack_intents
		  WHERE status = ANY($1)
		    AND COALESCE(claimed_at, created_at) < now() - make_interval(secs => $2)
		    AND ($3 <= 0 OR created_at > now() - make_interval(secs => $3))
		  ORDER BY COALESCE(claimed_at, created_at) ASC
		  LIMIT $4`,
		statuses, olderThan.Seconds(), maxAge.Seconds(), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Intent
	for rows.Next() {
		r, err := scanPG(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}
