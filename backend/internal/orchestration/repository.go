package orchestration

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"github.com/google/uuid"
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
func feesJSON(fees []Fee) string         { b, _ := json.Marshal(fees); return string(b) }
func historyJSON(h []StatusEvent) string { b, _ := json.Marshal(h); return string(b) }

// Balance reads ONE currency's spendable balance from whichever pot holds it —
// the main platform ledger for NGN, orch_balances otherwise. All the routing
// lives in customer_wallet.go so a read and a write can never disagree.
func (s *sqlStore) Balance(ctx context.Context, customer, currency string) (int64, error) {
	return customerBalance(ctx, s.db, customer, currency)
}

// Balances lists every wallet the customer holds, main-ledger NGN included (and
// always present, even at zero, so the FX screen can render a funding CTA).
func (s *sqlStore) Balances(ctx context.Context, customer string) ([]Money, error) {
	return customerBalances(ctx, s.db, customer)
}

// OpenWallet makes a currency visible to the customer at a zero balance so the
// wallet survives a refetch. Previously the endpoint fabricated an
// {available: 0} response and persisted nothing, so a newly "added" wallet
// vanished on the next load and there was no way to hold a non-NGN currency.
//
// NGN is a no-op: its wallet is the main ledger account, created on demand.
func (s *sqlStore) OpenWallet(ctx context.Context, customer, currency string) error {
	cur := strings.ToUpper(strings.TrimSpace(currency))
	if isMainLedgerCurrency(cur) {
		_, _, err := mainWalletAccountID(ctx, s.db, customer)
		return err
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO orch_balances (customer_id, currency, balance_minor) VALUES ($1,$2,0)
		ON CONFLICT (customer_id, currency) DO NOTHING`, customer, cur)
	return err
}

// SeedBalance credits an opening balance (dev/onboarding helper). It routes
// through the same pot selector as real money so that "seed then convert" keeps
// working end to end — seeding NGN into orch_balances while conversions spend
// the main ledger would make every seeded fixture unspendable.
func (s *sqlStore) SeedBalance(ctx context.Context, customer, currency string, amt int64) error {
	if amt <= 0 {
		return NewError(ErrInvalidRequest, "invalid_amount", "Seed amount must be a positive minor-unit value.")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := lockCustomerWallet(ctx, tx, customer); err != nil {
		return err
	}
	// Seeding twice credits twice — matching the additive behaviour this helper
	// has always had — so the idempotency key must be unique per call.
	idem := "seed:" + customer + ":" + strings.ToUpper(currency) + ":" + uuid.NewString()
	if err := creditCustomerWallet(ctx, tx, customer, currency, amt, "fx-seed:"+customer, idem); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// entryLeg is one side of a double-entry posting into orch_ledger_entries. The
// idemSuffix keeps every leg of a single money move distinct under the
// orch_ledger_idem_uniq index while still replaying as a unit.
type entryLeg struct {
	account    string
	currency   string
	entryType  string // DEBIT | CREDIT
	amount     int64
	idemSuffix string
}

// splitSpread apportions sourceTotal between retained FX markup (paymax_spread)
// and the amount handed to the provider (provider_clearing). The quoted spread is
// only recognised when it is a sane fraction of the total — a zero, negative, or
// over-large spread degrades to "everything is provider clearing", which keeps the
// currency balanced either way. Callers must post BOTH returned amounts.
func splitSpread(spreadMinor, sourceTotalMinor int64) (spread, clearing int64) {
	if spreadMinor <= 0 || spreadMinor >= sourceTotalMinor {
		return 0, sourceTotalMinor
	}
	return spreadMinor, sourceTotalMinor - spreadMinor
}

// postLedgerLegs writes each leg, skipping zero/negative amounts (the table's
// amount_minor CHECK forbids them, and a skipped leg never unbalances a currency
// because both sides of a pair carry the same amount and skip together).
func postLedgerLegs(ctx context.Context, tx pgx.Tx, customerID, reference, idemKey string, legs []entryLeg) error {
	const q = `
		INSERT INTO orch_ledger_entries (customer_id, account, currency, type, amount_minor, reference, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	for _, l := range legs {
		if l.amount <= 0 {
			continue
		}
		if _, err := tx.Exec(ctx, q, customerID, l.account, l.currency, l.entryType, l.amount, reference, idemKey+l.idemSuffix); err != nil {
			return err
		}
	}
	return nil
}

func (s *sqlStore) ApplyConversion(ctx context.Context, c *Conversion, sourceTotalMinor int64) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// One advisory lock, taken FIRST and before any row lock, so concurrent FX
	// conversions and wallet transfers for this customer serialise instead of
	// both reading a pre-debit balance (see lockCustomerWallet).
	if err = lockCustomerWallet(ctx, tx, c.CustomerID); err != nil {
		return err
	}
	// Debit source / credit destination through the pot selector: NGN moves in
	// the main ledger, every other currency in orch_balances. The sufficiency
	// check happens inside the debit, under this lock, in this transaction.
	if err = debitCustomerWallet(ctx, tx, c.CustomerID, c.Source.Currency, sourceTotalMinor, c.Reference, c.IdempotencyKey+":src"); err != nil {
		return err
	}
	if err = creditCustomerWallet(ctx, tx, c.CustomerID, c.Destination.Currency, c.Destination.AmountMinor, c.Reference, c.IdempotencyKey+":dst"); err != nil {
		return err
	}

	// Double-entry, balanced WITHIN EACH CURRENCY (ADR-029). A conversion touches two
	// Paymax-held customer balances, so both currencies get a full debit/credit pair:
	//
	//   source: DR customer_balance sourceTotal
	//           CR paymax_spread    spread          (FX markup revenue, may be 0)
	//           CR provider_clearing sourceTotal-spread
	//   dest:   DR provider_clearing destAmount
	//           CR customer_balance  destAmount
	//
	// provider_clearing carries the resulting FX position (long source / short dest)
	// until the provider settles. Posting only the two customer_balance legs would
	// leave each currency single-sided — the pre-ADR-029 bug.
	spread, clearing := splitSpread(feeAmount(c.Fees, FeeSpread), sourceTotalMinor)
	legs := []entryLeg{
		{"customer_balance", c.Source.Currency, "DEBIT", sourceTotalMinor, ":src"},
		{"paymax_spread", c.Source.Currency, "CREDIT", spread, ":src-spread"},
		{"provider_clearing", c.Source.Currency, "CREDIT", clearing, ":src-clearing"},
		{"provider_clearing", c.Destination.Currency, "DEBIT", c.Destination.AmountMinor, ":dst-clearing"},
		{"customer_balance", c.Destination.Currency, "CREDIT", c.Destination.AmountMinor, ":dst"},
	}
	if err = postLedgerLegs(ctx, tx, c.CustomerID, c.Reference, c.IdempotencyKey, legs); err != nil {
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

	if err = lockCustomerWallet(ctx, tx, t.CustomerID); err != nil {
		return err
	}
	// Payout funding goes through the same pot selector as a conversion, so a
	// NGN payout draws down the wallet the rest of the app shows.
	if err = debitCustomerWallet(ctx, tx, t.CustomerID, t.Source.Currency, sourceTotalMinor, t.Reference, t.IdempotencyKey+":out"); err != nil {
		return err
	}
	// Double-entry, balanced within the source currency (ADR-029). A payout only ever
	// touches ONE Paymax-held balance: the destination amount is paid to an external
	// beneficiary out of the provider's float, so there is no dest-currency leg here
	// (that exposure is tracked by the treasury reserve, not orch_ledger_entries).
	//
	//   DR customer_balance  sourceTotal
	//   CR paymax_spread     spread                (FX markup revenue, may be 0)
	//   CR provider_clearing sourceTotal-spread
	spread, clearing := splitSpread(feeAmount(t.Fees, FeeSpread), sourceTotalMinor)
	legs := []entryLeg{
		{"customer_balance", t.Source.Currency, "DEBIT", sourceTotalMinor, ":out"},
		{"paymax_spread", t.Source.Currency, "CREDIT", spread, ":out-spread"},
		{"provider_clearing", t.Source.Currency, "CREDIT", clearing, ":out-clearing"},
	}
	if err = postLedgerLegs(ctx, tx, t.CustomerID, t.Reference, t.IdempotencyKey, legs); err != nil {
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
	ref := strings.TrimSpace(va.ProviderRef)
	if ref == "" {
		// Older adapters put the handle only in details; keep the column populated
		// so every account stays matchable by an inbound webhook.
		if n, ok := va.Details["account_number"].(string); ok {
			ref = n
		}
	}
	var providerRef *string
	if ref != "" {
		providerRef = &ref
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO orch_collections (id, customer_id, currency, type, provider, status, details, provider_ref, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		va.ID, va.CustomerID, va.Currency, va.Type, va.Provider, va.Status, string(details), providerRef, va.CreatedAt)
	return err
}

// VirtualAccountByProviderRef finds the virtual account an inbound deposit was
// paid into, by the handle the provider quotes back in its webhook.
//
// ok=false means the deposit does not match anything we provisioned. The caller
// MUST NOT credit in that case — an unmatched reference has no owner and no
// currency, and guessing either is how orphan credits happen (QA WH-INT-003).
func (s *sqlStore) VirtualAccountByProviderRef(ctx context.Context, provider, ref string) (*VirtualAccount, bool, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, false, nil
	}
	va := &VirtualAccount{}
	var detailsB []byte
	// Matched on the dedicated column first, then on the legacy jsonb key, so
	// accounts provisioned before the backfill still resolve.
	err := s.db.QueryRow(ctx, `
		SELECT id, customer_id, currency, type, provider, status, details, COALESCE(provider_ref,''), created_at
		FROM orch_collections
		WHERE provider=$1 AND (provider_ref=$2 OR details->>'account_number'=$2)
		ORDER BY created_at DESC LIMIT 1`, provider, ref).Scan(
		&va.ID, &va.CustomerID, &va.Currency, &va.Type, &va.Provider, &va.Status, &detailsB, &va.ProviderRef, &va.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	_ = json.Unmarshal(detailsB, &va.Details)
	return va, true, nil
}

// ApplyCollection credits an inbound deposit into the customer's wallet and
// records it, atomically. Returns applied=false for a redelivered webhook.
//
// Idempotency is the unique (provider, provider_event_id) index: the event row
// is inserted FIRST with ON CONFLICT DO NOTHING, and a zero row count means this
// deposit was already credited, so the transaction commits without moving money.
// The wallet lock is taken before that, so two concurrent redeliveries serialise
// rather than racing between the check and the credit.
func (s *sqlStore) ApplyCollection(ctx context.Context, c *CollectionCredit) (bool, error) {
	if c.AmountMinor <= 0 {
		return false, NewError(ErrInvalidRequest, "invalid_amount", "Collection amount must be a positive minor-unit value.")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	if err = lockCustomerWallet(ctx, tx, c.CustomerID); err != nil {
		return false, err
	}

	var nullable = func(v string) *string {
		if strings.TrimSpace(v) == "" {
			return nil
		}
		return &v
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO orch_collection_events
			(id, customer_id, virtual_account_id, currency, amount_minor, provider, provider_event_id, provider_ref, sender_name, reference, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (provider, provider_event_id) DO NOTHING`,
		c.ID, c.CustomerID, c.VirtualAccountID, strings.ToUpper(c.Currency), c.AmountMinor,
		c.Provider, c.ProviderEventID, nullable(c.ProviderRef), nullable(c.SenderName), nullable(c.Reference), c.CreatedAt)
	if err != nil {
		return false, err
	}
	if tag.RowsAffected() == 0 {
		return false, tx.Commit(ctx) // already credited — a redelivery, not an error
	}

	// Credit through the same pot selector as every other FX money path: NGN
	// lands in the main platform ledger, other currencies in orch_balances.
	if err = creditCustomerWallet(ctx, tx, c.CustomerID, c.Currency, c.AmountMinor, "fx-collection:"+c.ID, c.ID); err != nil {
		return false, err
	}

	// Double-entry, balanced within the credited currency (ADR-029). The deposit
	// arrives out of the provider's float, so provider_clearing is the counter-leg:
	//   DR provider_clearing  amount
	//   CR customer_balance   amount
	legs := []entryLeg{
		{"provider_clearing", c.Currency, "DEBIT", c.AmountMinor, ":in-clearing"},
		{"customer_balance", c.Currency, "CREDIT", c.AmountMinor, ":in"},
	}
	if err = postLedgerLegs(ctx, tx, c.CustomerID, c.ID, c.ID, legs); err != nil {
		return false, err
	}
	return true, tx.Commit(ctx)
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

	// Inbound DEPOSITS, from orch_collection_events.
	//
	// This used to list orch_collections — one row per virtual ACCOUNT, which is
	// not a transaction: it had no amount, and it left Destination.Currency as "".
	// The mobile TransactionRow formats that leg through CURRENCIES[currency], so
	// an empty code was `undefined.decimals` and the resulting crash blanked the
	// WHOLE FX screen for any customer who had ever provisioned an account. It
	// also emitted the account's "active" as a status, which is not a member of
	// the client's TxStatus union.
	//
	// A deposit is money arriving 1:1 — no conversion — so both legs carry the
	// same amount and currency.
	col, err := s.db.Query(ctx, `
		SELECT id, COALESCE(reference,''), currency, amount_minor, provider, COALESCE(sender_name,''), created_at
		FROM orch_collection_events WHERE customer_id=$1`, customer)
	if err != nil {
		return nil, err
	}
	for col.Next() {
		var v TxView
		var currency, sender string
		var amount int64
		if err := col.Scan(&v.ID, &v.Reference, &currency, &amount, &v.Route.Provider, &sender, &v.CreatedAt); err != nil {
			col.Close()
			return nil, err
		}
		if v.Reference == "" {
			v.Reference = v.ID
		}
		v.Type, v.Direction, v.Status = "collection", "in", "successful"
		v.Source = NewMoney(amount, currency)
		v.Destination = NewMoney(amount, currency)
		v.Title = "Deposit · " + currency
		if sender != "" {
			v.Title = "Deposit from " + sender
		}
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
