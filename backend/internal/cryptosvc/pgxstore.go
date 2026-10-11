package cryptosvc

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

// PGStore is the Postgres Store over crypto_webhook_events and crypto_swaps.
type PGStore struct{ pool *pgxpool.Pool }

// NewPGStore wraps a pool.
func NewPGStore(pool *pgxpool.Pool) *PGStore { return &PGStore{pool: pool} }

var _ Store = (*PGStore)(nil)

func (s *PGStore) InsertWebhookEvent(ctx context.Context, ev WebhookEvent) (bool, error) {
	var payload any
	if len(ev.Payload) > 0 {
		payload = string(ev.Payload)
	}
	tag, err := s.pool.Exec(ctx,
		`INSERT INTO public.crypto_webhook_events (key, provider, type, payload, received_at)
		 VALUES ($1, $2, $3, $4::jsonb, $5)
		 ON CONFLICT (key) DO NOTHING`,
		ev.Key, ev.Provider, ev.Type, payload, ev.ReceivedAt)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *PGStore) DeleteWebhookEvent(ctx context.Context, key string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM public.crypto_webhook_events WHERE key = $1`, key)
	return err
}

func (s *PGStore) SwapByProviderID(ctx context.Context, provider, providerSwapID string) (SwapRecord, bool, error) {
	var (
		r        SwapRecord
		state    string
		received *string
		side     string
	)
	err := s.pool.QueryRow(ctx,
		`SELECT id::text, user_id::text, provider, provider_account_id, provider_swap_id, status, received_amount::text,
		        side, ngn_kobo, fee_bps, fee_kobo
		   FROM public.crypto_swaps WHERE provider = $1 AND provider_swap_id = $2`,
		provider, providerSwapID).
		Scan(&r.ID, &r.UserID, &r.Provider, &r.ProviderAccountID, &r.ProviderSwapID, &state, &received,
			&side, &r.NGNKobo, &r.FeeBps, &r.FeeKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return SwapRecord{}, false, nil
	}
	if err != nil {
		return SwapRecord{}, false, err
	}
	r.State = cryptoprov.SwapState(state)
	r.Side = Side(side)
	if received != nil {
		d, derr := decimal.NewFromString(*received)
		if derr != nil {
			return SwapRecord{}, false, derr
		}
		r.ReceivedAmount = d
	}
	return r, true, nil
}

func (s *PGStore) TransitionSwap(ctx context.Context, id string, from, to cryptoprov.SwapState, received decimal.Decimal, reason string) (bool, error) {
	var recv any
	if received.IsPositive() {
		recv = received.String()
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE public.crypto_swaps
		    SET status = $3,
		        received_amount = COALESCE($4::numeric, received_amount),
		        reason = NULLIF($5, ''),
		        updated_at = now()
		  WHERE id = $1::uuid AND status = $2`,
		id, string(from), string(to), recv, reason)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}
