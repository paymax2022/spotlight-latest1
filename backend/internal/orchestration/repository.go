package orchestration

import (
	"context"
	"encoding/json"
	"errors"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// sqlStore is the production, Postgres-backed Store. Money moves happen inside a
// single transaction with row-level locking on the source balance, guaranteeing
// no double-spend; idempotency is enforced by a unique index on idempotency_key.
type sqlStore struct {
	db *pgxpool.Pool
}

// NewSQLStore returns a Postgres-backed Store (requires the 20260621 migration).
func NewSQLStore(db *pgxpool.Pool) Store { return &sqlStore{db: db} }

// jsonb columns are written as strings (pgx encodes []byte as bytea, not jsonb).
func feesJSON(fees []Fee) string { b, _ := json.Marshal(fees); return string(b) }
func historyJSON(h []StatusEvent) string { b, _ := json.Marshal(h); return string(b) }

func (s *sqlStore) Balance(ctx context.Context, customer, currency string) (int64, error) {
	var bal int64
	err := s.db.QueryRow(ctx, `SELECT balance_minor FROM orch_balances WHERE customer_id=$1 AND currency=$2`, customer, currency).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return bal, err
}

func (s *sqlStore) Balances(ctx context.Context, customer string) ([]Money, error) {
	rows, err := s.db.Query(ctx, `SELECT currency, balance_minor FROM orch_balances WHERE customer_id=$1 ORDER BY currency`, customer)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Money
	for rows.Next() {
		var m Money
		if err := rows.Scan(&m.Currency, &m.AmountMinor); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *sqlStore) SeedBalance(ctx context.Context, customer, currency string, amt int64) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO orch_balances (customer_id, currency, balance_minor) VALUES ($1,$2,$3)
		ON CONFLICT (customer_id, currency) DO UPDATE SET balance_minor = orch_balances.balance_minor + EXCLUDED.balance_minor, updated_at = now()`,
		customer, currency, amt)
	return err
}

func (s *sqlStore) ApplyConversion(ctx context.Context, c *Conversion, sourceTotalMinor int64) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var bal int64
	err = tx.QueryRow(ctx, `SELECT balance_minor FROM orch_balances WHERE customer_id=$1 AND currency=$2 FOR UPDATE`, c.CustomerID, c.Source.Currency).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) {
		return NewError(ErrInsufficientBalance, "insufficient_balance", "Insufficient "+c.Source.Currency+" balance.")
	}
	if err != nil {
		return err
	}
	if bal < sourceTotalMinor {
		return NewError(ErrInsufficientBalance, "insufficient_balance", "Insufficient "+c.Source.Currency+" balance.")
	}

	if _, err = tx.Exec(ctx, `UPDATE orch_balances SET balance_minor = balance_minor - $3, updated_at=now() WHERE customer_id=$1 AND currency=$2`, c.CustomerID, c.Source.Currency, sourceTotalMinor); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO orch_balances (customer_id, currency, balance_minor) VALUES ($1,$2,$3)
		ON CONFLICT (customer_id, currency) DO UPDATE SET balance_minor = orch_balances.balance_minor + EXCLUDED.balance_minor, updated_at=now()`,
		c.CustomerID, c.Destination.Currency, c.Destination.AmountMinor); err != nil {
		return err
	}

	// Double-entry: debit source balance, credit destination balance.
	if _, err = tx.Exec(ctx, `
		INSERT INTO orch_ledger_entries (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
		VALUES ($1,'customer_balance',$2,'DEBIT',$3,$4,$5)`,
		c.CustomerID, c.Source.Currency, sourceTotalMinor, c.Reference, c.IdempotencyKey+":src"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO orch_ledger_entries (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
		VALUES ($1,'customer_balance',$2,'CREDIT',$3,$4,$5)`,
		c.CustomerID, c.Destination.Currency, c.Destination.AmountMinor, c.Reference, c.IdempotencyKey+":dst"); err != nil {
		return err
	}

	if _, err = tx.Exec(ctx, `
		INSERT INTO orch_conversions (id, reference, customer_id, status, source_currency, source_minor, dest_currency, dest_minor,
			rate, all_in_rate, fees, provider, corridor, rail, provider_ref, transaction_id, idempotency_key, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
		c.ID, c.Reference, c.CustomerID, string(c.Status), c.Source.Currency, c.Source.AmountMinor, c.Destination.Currency, c.Destination.AmountMinor,
		c.Rate, c.AllInRate, feesJSON(c.Fees), c.Route.Provider, c.Route.Corridor, string(c.Route.Rail), c.ProviderRef, c.TransactionID, c.IdempotencyKey, c.CreatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *sqlStore) ApplyTransfer(ctx context.Context, t *Transfer, sourceTotalMinor int64) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var bal int64
	err = tx.QueryRow(ctx, `SELECT balance_minor FROM orch_balances WHERE customer_id=$1 AND currency=$2 FOR UPDATE`, t.CustomerID, t.Source.Currency).Scan(&bal)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && bal < sourceTotalMinor) {
		return NewError(ErrInsufficientBalance, "insufficient_balance", "Insufficient "+t.Source.Currency+" balance.")
	}
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE orch_balances SET balance_minor = balance_minor - $3, updated_at=now() WHERE customer_id=$1 AND currency=$2`, t.CustomerID, t.Source.Currency, sourceTotalMinor); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO orch_ledger_entries (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
		VALUES ($1,'customer_balance',$2,'DEBIT',$3,$4,$5)`,
		t.CustomerID, t.Source.Currency, sourceTotalMinor, t.Reference, t.IdempotencyKey+":out"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO orch_transfers (id, reference, customer_id, status, source_currency, source_minor, dest_currency, dest_minor,
			quoted_rate, executed_rate, fees, provider, corridor, rail, narration, provider_ref, transaction_id, status_history, idempotency_key, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
		t.ID, t.Reference, t.CustomerID, string(t.Status), t.Source.Currency, t.Source.AmountMinor, t.Destination.Currency, t.Destination.AmountMinor,
		t.QuotedRate, t.ExecutedRate, feesJSON(t.Fees), t.Route.Provider, t.Route.Corridor, string(t.Route.Rail), t.Narration, t.ProviderRef, t.TransactionID, historyJSON(t.StatusHistory), t.IdempotencyKey, t.CreatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *sqlStore) ConversionByIdem(ctx context.Context, key string) (*Conversion, bool, error) {
	const q = `SELECT id, reference, customer_id, status, source_currency, source_minor, dest_currency, dest_minor,
		rate, all_in_rate, fees, provider, corridor, rail, provider_ref, transaction_id, created_at
		FROM orch_conversions WHERE idempotency_key=$1`
	c := &Conversion{}
	var feesB []byte
	var status, rail string
	err := s.db.QueryRow(ctx, q, key).Scan(
		&c.ID, &c.Reference, &c.CustomerID, &status, &c.Source.Currency, &c.Source.AmountMinor, &c.Destination.Currency, &c.Destination.AmountMinor,
		&c.Rate, &c.AllInRate, &feesB, &c.Route.Provider, &c.Route.Corridor, &rail, &c.ProviderRef, &c.TransactionID, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	c.Status = ConversionStatus(status)
	c.Route.Rail = Rail(rail)
	_ = json.Unmarshal(feesB, &c.Fees)
	return c, true, nil
}

func (s *sqlStore) TransferByIdem(ctx context.Context, key string) (*Transfer, bool, error) {
	const q = `SELECT id, reference, customer_id, status, source_currency, source_minor, dest_currency, dest_minor,
		quoted_rate, executed_rate, fees, provider, corridor, rail, narration, provider_ref, transaction_id, status_history, created_at
		FROM orch_transfers WHERE idempotency_key=$1`
	t := &Transfer{}
	var feesB, histB []byte
	var status, rail string
	err := s.db.QueryRow(ctx, q, key).Scan(
		&t.ID, &t.Reference, &t.CustomerID, &status, &t.Source.Currency, &t.Source.AmountMinor, &t.Destination.Currency, &t.Destination.AmountMinor,
		&t.QuotedRate, &t.ExecutedRate, &feesB, &t.Route.Provider, &t.Route.Corridor, &rail, &t.Narration, &t.ProviderRef, &t.TransactionID, &histB, &t.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	t.Status = TransferStatus(status)
	t.Route.Rail = Rail(rail)
	_ = json.Unmarshal(feesB, &t.Fees)
	_ = json.Unmarshal(histB, &t.StatusHistory)
	return t, true, nil
}

func (s *sqlStore) SaveCollection(ctx context.Context, va *VirtualAccount) error {
	details, _ := json.Marshal(va.Details)
	_, err := s.db.Exec(ctx, `
		INSERT INTO orch_collections (id, customer_id, currency, type, provider, status, details, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		va.ID, va.CustomerID, va.Currency, va.Type, va.Provider, va.Status, string(details), va.CreatedAt)
	return err
}

func (s *sqlStore) SaveQuote(ctx context.Context, q *Quote) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO orch_quotes (id, customer_id, status, amount_type, source_currency, source_minor, dest_currency, dest_minor,
			rate, all_in_rate, provider, corridor, rail, fees, locked, expires_at, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
		ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, locked=EXCLUDED.locked, expires_at=EXCLUDED.expires_at`,
		q.ID, q.CustomerID, string(q.Status), string(q.AmountType), q.Source.Currency, q.Source.AmountMinor, q.Destination.Currency, q.Destination.AmountMinor,
		q.Rate, q.AllInRate, q.Route.Provider, q.Route.Corridor, string(q.Route.Rail), feesJSON(q.Fees), q.Locked, q.ExpiresAt, q.CreatedAt)
	return err
}

func (s *sqlStore) Transactions(ctx context.Context, customer string) ([]TxView, error) {
	var out []TxView

	cr, err := s.db.Query(ctx, `SELECT id, reference, status, source_currency, source_minor, dest_currency, dest_minor, rate, all_in_rate, provider, corridor, rail, provider_ref, created_at FROM orch_conversions WHERE customer_id=$1`, customer)
	if err != nil {
		return nil, err
	}
	for cr.Next() {
		var v TxView
		var rail string
		if err := cr.Scan(&v.ID, &v.Reference, &v.Status, &v.Source.Currency, &v.Source.AmountMinor, &v.Destination.Currency, &v.Destination.AmountMinor, &v.QuotedRate, &v.ExecutedRate, &v.Route.Provider, &v.Route.Corridor, &rail, &v.ProviderRef, &v.CreatedAt); err != nil {
			cr.Close()
			return nil, err
		}
		v.Type, v.Direction, v.Route.Rail = "conversion", "in", Rail(rail)
		v.Title = v.Source.Currency + " → " + v.Destination.Currency
		out = append(out, v)
	}
	cr.Close()

	tr, err := s.db.Query(ctx, `SELECT id, reference, status, source_currency, source_minor, dest_currency, dest_minor, quoted_rate, executed_rate, provider, corridor, rail, provider_ref, created_at FROM orch_transfers WHERE customer_id=$1`, customer)
	if err != nil {
		return nil, err
	}
	for tr.Next() {
		var v TxView
		var rail string
		if err := tr.Scan(&v.ID, &v.Reference, &v.Status, &v.Source.Currency, &v.Source.AmountMinor, &v.Destination.Currency, &v.Destination.AmountMinor, &v.QuotedRate, &v.ExecutedRate, &v.Route.Provider, &v.Route.Corridor, &rail, &v.ProviderRef, &v.CreatedAt); err != nil {
			tr.Close()
			return nil, err
		}
		v.Type, v.Direction, v.Route.Rail = "transfer", "out", Rail(rail)
		v.Title = "Payout · " + v.Destination.Currency
		out = append(out, v)
	}
	tr.Close()

	col, err := s.db.Query(ctx, `SELECT id, currency, status, created_at FROM orch_collections WHERE customer_id=$1`, customer)
	if err != nil {
		return nil, err
	}
	for col.Next() {
		var v TxView
		if err := col.Scan(&v.ID, &v.Source.Currency, &v.Status, &v.CreatedAt); err != nil {
			col.Close()
			return nil, err
		}
		v.Reference, v.Type, v.Title = v.ID, "collection", "Collection account · "+v.Source.Currency
		out = append(out, v)
	}
	col.Close()

	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (s *sqlStore) AllConversions(ctx context.Context) ([]*Conversion, error) {
	const q = `SELECT id, reference, customer_id, status, source_currency, source_minor, dest_currency, dest_minor,
		rate, all_in_rate, fees, provider, corridor, rail, provider_ref, transaction_id, created_at FROM orch_conversions`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Conversion
	for rows.Next() {
		c := &Conversion{}
		var feesB []byte
		var status, rail string
		if err := rows.Scan(&c.ID, &c.Reference, &c.CustomerID, &status, &c.Source.Currency, &c.Source.AmountMinor,
			&c.Destination.Currency, &c.Destination.AmountMinor, &c.Rate, &c.AllInRate, &feesB, &c.Route.Provider,
			&c.Route.Corridor, &rail, &c.ProviderRef, &c.TransactionID, &c.CreatedAt); err != nil {
			return nil, err
		}
		c.Status = ConversionStatus(status)
		c.Route.Rail = Rail(rail)
		_ = json.Unmarshal(feesB, &c.Fees)
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *sqlStore) AllTransfers(ctx context.Context) ([]*Transfer, error) {
	const q = `SELECT id, reference, customer_id, status, source_currency, source_minor, dest_currency, dest_minor,
		quoted_rate, executed_rate, fees, provider, corridor, rail, narration, provider_ref, transaction_id, created_at FROM orch_transfers`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Transfer
	for rows.Next() {
		t := &Transfer{}
		var feesB []byte
		var status, rail string
		if err := rows.Scan(&t.ID, &t.Reference, &t.CustomerID, &status, &t.Source.Currency, &t.Source.AmountMinor,
			&t.Destination.Currency, &t.Destination.AmountMinor, &t.QuotedRate, &t.ExecutedRate, &feesB, &t.Route.Provider,
			&t.Route.Corridor, &rail, &t.Narration, &t.ProviderRef, &t.TransactionID, &t.CreatedAt); err != nil {
			return nil, err
		}
		t.Status = TransferStatus(status)
		t.Route.Rail = Rail(rail)
		_ = json.Unmarshal(feesB, &t.Fees)
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *sqlStore) UpdateConversionStatus(ctx context.Context, reference, status string) error {
	_, err := s.db.Exec(ctx, `UPDATE orch_conversions SET status=$2 WHERE reference=$1`, reference, status)
	return err
}

func (s *sqlStore) UpdateTransferStatus(ctx context.Context, reference, status string) error {
	_, err := s.db.Exec(ctx, `UPDATE orch_transfers SET status=$2 WHERE reference=$1`, reference, status)
	return err
}

func (s *sqlStore) Transaction(ctx context.Context, customer, id string) (*TxView, bool, error) {
	all, err := s.Transactions(ctx, customer)
	if err != nil {
		return nil, false, err
	}
	for i := range all {
		if all[i].ID == id || all[i].Reference == id {
			return &all[i], true, nil
		}
	}
	return nil, false, nil
}
