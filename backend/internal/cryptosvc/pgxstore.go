package cryptosvc

import (
	"context"
	"errors"
	"time"

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

const swapCols = `id::text, user_id::text, provider, provider_account_id, COALESCE(provider_swap_id,''), status,
	received_amount::text, side, ngn_kobo, fee_bps, fee_kobo, COALESCE(provider_quote_id,''), COALESCE(idempotency_key,''),
	from_currency, to_currency, from_amount::text, quoted_to_amount::text, quoted_price::text, expires_at, (execute_attempted_at IS NOT NULL), updated_at`

func scanSwap(row pgx.Row) (SwapRecord, error) {
	var (
		r                           SwapRecord
		state, side                 string
		received                    *string
		fromAmt, quotedTo, quotedPx string
		expires                     *time.Time
	)
	if err := row.Scan(&r.ID, &r.UserID, &r.Provider, &r.ProviderAccountID, &r.ProviderSwapID, &state, &received,
		&side, &r.NGNKobo, &r.FeeBps, &r.FeeKobo, &r.ProviderQuoteID, &r.IdempotencyKey,
		&r.FromCurrency, &r.ToCurrency, &fromAmt, &quotedTo, &quotedPx, &expires, &r.ExecuteAttempted, &r.UpdatedAt); err != nil {
		return SwapRecord{}, err
	}
	r.State = cryptoprov.SwapState(state)
	r.Side = Side(side)
	var err error
	if received != nil {
		if r.ReceivedAmount, err = decimal.NewFromString(*received); err != nil {
			return SwapRecord{}, err
		}
	}
	if r.FromAmount, err = decimal.NewFromString(fromAmt); err != nil {
		return SwapRecord{}, err
	}
	if r.QuotedToAmount, err = decimal.NewFromString(quotedTo); err != nil {
		return SwapRecord{}, err
	}
	if r.QuotedPrice, err = decimal.NewFromString(quotedPx); err != nil {
		return SwapRecord{}, err
	}
	if expires != nil {
		r.ExpiresAt = *expires
	}
	return r, nil
}

func (s *PGStore) SwapByProviderID(ctx context.Context, provider, providerSwapID string) (SwapRecord, bool, error) {
	r, err := scanSwap(s.pool.QueryRow(ctx,
		`SELECT `+swapCols+` FROM public.crypto_swaps WHERE provider = $1 AND provider_swap_id = $2`, provider, providerSwapID))
	if errors.Is(err, pgx.ErrNoRows) {
		return SwapRecord{}, false, nil
	}
	return r, err == nil, err
}

func (s *PGStore) StaleSwaps(ctx context.Context, state cryptoprov.SwapState, olderThan time.Time, limit int) ([]SwapRecord, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+swapCols+` FROM public.crypto_swaps WHERE status = $1 AND updated_at < $2 ORDER BY updated_at LIMIT $3`,
		string(state), olderThan, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SwapRecord
	for rows.Next() {
		r, err := scanSwap(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ListByState backs the admin needs_review queue: all swaps in state, oldest parked
// first (updated_at asc, id as a stable tiebreak), paginated. Read-only; no row locks.
func (s *PGStore) ListByState(ctx context.Context, state cryptoprov.SwapState, limit, offset int) ([]SwapRecord, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+swapCols+` FROM public.crypto_swaps WHERE status = $1 ORDER BY updated_at, id LIMIT $2 OFFSET $3`,
		string(state), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SwapRecord
	for rows.Next() {
		r, err := scanSwap(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Backlog rolls the open swaps up by state in one read-only statement; no swap contents leave it.
func (s *PGStore) Backlog(ctx context.Context) ([]BacklogState, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT status, count(*), COALESCE(sum(ngn_kobo + fee_kobo), 0)::bigint, min(updated_at)
		  FROM public.crypto_swaps
		 WHERE status IN ('quoted','confirming','processing','needs_review')
		 GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BacklogState
	for rows.Next() {
		var b BacklogState
		var st string
		if err := rows.Scan(&st, &b.Count, &b.HeldKobo, &b.OldestUpdatedAt); err != nil {
			return nil, err
		}
		b.State = cryptoprov.SwapState(st)
		out = append(out, b)
	}
	return out, rows.Err()
}

// SwapByIDAny reads a swap by id with no user scoping, for the admin resolution path.
func (s *PGStore) SwapByIDAny(ctx context.Context, id string) (SwapRecord, bool, error) {
	r, err := scanSwap(s.pool.QueryRow(ctx, `SELECT `+swapCols+` FROM public.crypto_swaps WHERE id = $1::uuid`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return SwapRecord{}, false, nil
	}
	return r, err == nil, err
}

func (s *PGStore) TouchSwap(ctx context.Context, id string, state cryptoprov.SwapState) error {
	_, err := s.pool.Exec(ctx, `UPDATE public.crypto_swaps SET updated_at = now() WHERE id = $1::uuid AND status = $2`, id, string(state))
	return err
}

func (s *PGStore) SwapByIdempotencyKey(ctx context.Context, userID, key string) (SwapRecord, bool, error) {
	r, err := scanSwap(s.pool.QueryRow(ctx,
		`SELECT `+swapCols+` FROM public.crypto_swaps WHERE user_id = $1::uuid AND idempotency_key = $2`, userID, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return SwapRecord{}, false, nil
	}
	return r, err == nil, err
}

func (s *PGStore) SwapByID(ctx context.Context, userID, id string) (SwapRecord, bool, error) {
	r, err := scanSwap(s.pool.QueryRow(ctx,
		`SELECT `+swapCols+` FROM public.crypto_swaps WHERE id = $1::uuid AND user_id = $2::uuid`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return SwapRecord{}, false, nil
	}
	return r, err == nil, err
}

func (s *PGStore) InsertSwap(ctx context.Context, n NewSwap) (SwapRecord, bool, error) {
	var id string
	err := s.pool.QueryRow(ctx,
		`INSERT INTO public.crypto_swaps (user_id, provider, provider_account_id, provider_quote_id, idempotency_key,
		   from_currency, to_currency, from_amount, quoted_to_amount, quoted_price, side, ngn_kobo, fee_bps, fee_kobo, expires_at, status)
		 VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8::numeric,$9::numeric,$10::numeric,$11,$12,$13,$14,$15,'quoted')
		 ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		 RETURNING id::text`,
		n.UserID, n.Provider, n.ProviderAccountID, n.ProviderQuoteID, n.IdempotencyKey,
		n.FromCurrency, n.ToCurrency, n.FromAmount.String(), n.QuotedToAmount.String(), n.QuotedPrice.String(),
		string(n.Side), n.NGNKobo, n.FeeBps, n.FeeKobo, n.ExpiresAt).Scan(&id)
	created := err == nil
	if errors.Is(err, pgx.ErrNoRows) { // conflict: return the existing row
		r, rerr := scanSwap(s.pool.QueryRow(ctx,
			`SELECT `+swapCols+` FROM public.crypto_swaps WHERE user_id = $1::uuid AND idempotency_key = $2`, n.UserID, n.IdempotencyKey))
		return r, false, rerr
	}
	if err != nil {
		return SwapRecord{}, false, err
	}
	r, rerr := scanSwap(s.pool.QueryRow(ctx, `SELECT `+swapCols+` FROM public.crypto_swaps WHERE id = $1::uuid`, id))
	return r, created, rerr
}

func (s *PGStore) MarkExecuteAttempt(ctx context.Context, id string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE public.crypto_swaps SET execute_attempted_at = now(), updated_at = now()
		  WHERE id = $1::uuid AND execute_attempted_at IS NULL`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *PGStore) SetProviderSwapID(ctx context.Context, id, providerSwapID string) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`UPDATE public.crypto_swaps SET provider_swap_id = $2, updated_at = now()
		  WHERE id = $1::uuid AND (provider_swap_id IS NULL OR provider_swap_id = $2)`, id, providerSwapID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *PGStore) ProviderAccount(ctx context.Context, userID, provider string) (string, bool, error) {
	var acct string
	err := s.pool.QueryRow(ctx, `SELECT provider_account_id FROM public.crypto_accounts WHERE user_id = $1::uuid AND provider = $2`, userID, provider).Scan(&acct)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return acct, err == nil, err
}

func (s *PGStore) SaveProviderAccount(ctx context.Context, userID, provider, accountID string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO public.crypto_accounts (user_id, provider, provider_account_id) VALUES ($1::uuid,$2,$3)
		 ON CONFLICT (user_id, provider) DO NOTHING`, userID, provider, accountID)
	return err
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
