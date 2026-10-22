package cryptosvc

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

var _ DepositStore = (*PGStore)(nil)

// UserByProviderAccount implements DepositStore.
func (s *PGStore) UserByProviderAccount(ctx context.Context, provider, accountID string) (string, bool, error) {
	var uid string
	err := s.pool.QueryRow(ctx,
		`SELECT user_id::text FROM public.crypto_accounts WHERE provider = $1 AND provider_account_id = $2`,
		provider, accountID).Scan(&uid)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return uid, err == nil, err
}

// SavedDepositAddress implements DepositStore.
func (s *PGStore) SavedDepositAddress(ctx context.Context, userID, provider, currency, network string) (cryptoprov.DepositAddress, bool, error) {
	a := cryptoprov.DepositAddress{Currency: currency, Network: network}
	err := s.pool.QueryRow(ctx,
		`SELECT address, tag FROM public.crypto_deposit_addresses
		  WHERE user_id = $1::uuid AND provider = $2 AND currency = $3 AND network = $4`,
		userID, provider, currency, network).Scan(&a.Address, &a.Tag)
	if errors.Is(err, pgx.ErrNoRows) {
		return cryptoprov.DepositAddress{}, false, nil
	}
	return a, err == nil, err
}

// SaveDepositAddress implements DepositStore: the first address saved wins.
func (s *PGStore) SaveDepositAddress(ctx context.Context, userID, provider string, a cryptoprov.DepositAddress) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO public.crypto_deposit_addresses (user_id, provider, currency, network, address, tag)
		 VALUES ($1::uuid,$2,$3,$4,$5,$6)
		 ON CONFLICT (user_id, provider, currency, network) DO NOTHING`,
		userID, provider, a.Currency, a.Network, a.Address, a.Tag)
	return err
}

// UpsertDeposit implements DepositStore. The conflict branch only writes when the status
// moves forward from pending or the confirmations increase, so an out-of-order event can
// never regress a deposit. The owner (user_id) of an existing row is never changed.
func (s *PGStore) UpsertDeposit(ctx context.Context, d DepositRecord) (bool, error) {
	tag, err := s.pool.Exec(ctx,
		`INSERT INTO public.crypto_deposits
		   (provider, provider_deposit_id, user_id, currency, network, address, amount, fee, txid, status, confirmations, required_confirmations)
		 VALUES ($1,$2,$3::uuid,$4,$5,$6,$7::numeric,$8::numeric,$9,$10,$11,$12)
		 ON CONFLICT (provider, provider_deposit_id) DO UPDATE SET
		   status = CASE WHEN crypto_deposits.status = 'pending' THEN EXCLUDED.status ELSE crypto_deposits.status END,
		   confirmations = GREATEST(crypto_deposits.confirmations, EXCLUDED.confirmations),
		   required_confirmations = EXCLUDED.required_confirmations,
		   txid = COALESCE(NULLIF(EXCLUDED.txid, ''), crypto_deposits.txid),
		   updated_at = now()
		 WHERE (crypto_deposits.status = 'pending' AND EXCLUDED.status <> 'pending')
		    OR EXCLUDED.confirmations > crypto_deposits.confirmations`,
		d.Provider, d.ProviderDepositID, d.UserID, d.Currency, d.Network, d.Address,
		d.Amount.String(), d.Fee.String(), d.TxID, string(d.Status), d.Confirmations, d.RequiredConfirmations)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// ListDeposits implements DepositStore.
func (s *PGStore) ListDeposits(ctx context.Context, userID string, limit int) ([]DepositRecord, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT provider, provider_deposit_id, user_id::text, currency, network, address, amount::text, fee::text,
		        txid, status, confirmations, required_confirmations, created_at, updated_at
		   FROM public.crypto_deposits WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DepositRecord{}
	for rows.Next() {
		var d DepositRecord
		var amt, fee, st string
		if err := rows.Scan(&d.Provider, &d.ProviderDepositID, &d.UserID, &d.Currency, &d.Network, &d.Address, &amt, &fee,
			&d.TxID, &st, &d.Confirmations, &d.RequiredConfirmations, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		if d.Amount, err = decimal.NewFromString(amt); err != nil {
			return nil, err
		}
		if d.Fee, err = decimal.NewFromString(fee); err != nil {
			return nil, err
		}
		d.Status = cryptoprov.DepositStatus(st)
		out = append(out, d)
	}
	return out, rows.Err()
}
