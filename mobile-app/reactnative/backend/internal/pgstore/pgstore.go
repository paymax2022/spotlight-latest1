// Package pgstore is the PostgreSQL implementation of store.Repository (pgx/v5).
// It is a drop-in for the in-memory store — the same interface the handlers and
// adapters depend on. Buy/sell/swap run in a single DB transaction that moves the
// wallet, the position, and writes the double-entry ledger + history atomically.
//
// NOTE: the Repository contract is currently single-user (the in-memory store
// was), so this implementation scopes to one user (`demoUser`). Threading the
// request's authenticated user id (auth.UserID) through the interface is the
// natural next step for full per-user isolation.
package pgstore

import (
	"context"
	"encoding/json"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/engine"
	"paymax/crypto-backend/internal/store"
)

const demoUser = "demo-user"

// Store is a pgx-pool-backed Repository.
type Store struct {
	pool *pgxpool.Pool
	ctx  context.Context
}

// New opens a pool and verifies connectivity.
func New(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool, ctx: ctx}, nil
}

// Close releases the pool.
func (s *Store) Close() { s.pool.Close() }

// Ping verifies database connectivity (used by the /readyz probe).
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// Compile-time check: pgstore satisfies the same contract as the in-memory store.
var _ store.Repository = (*Store)(nil)

func round2(x float64) float64 { return math.Round(x*100) / 100 }

func iso(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// ── Eligibility ───────────────────────────────────────────────────────────────

// Eligibility returns the (single) demo user's compliance facts for the trading
// gate. Suitability + agreement-acceptance facts come from the eligibility tables
// (000004_eligibility.up.sql); when those tables/rows are absent the facts stay
// false and the gate fails closed.
func (s *Store) Eligibility() domain.EligibilityFacts {
	var f domain.EligibilityFacts
	var status string
	if err := s.pool.QueryRow(s.ctx,
		`SELECT kyc_tier, crypto_enabled, COALESCE(status,'active') FROM users WHERE id=$1`, demoUser,
	).Scan(&f.KycTier, &f.CryptoEnabled, &status); err != nil {
		return domain.EligibilityFacts{}
	}
	f.UserActive = status == "active"

	var expiresAt *time.Time
	var includesCrypto bool
	if err := s.pool.QueryRow(s.ctx,
		`SELECT (eligible_products ? 'crypto'), expires_at FROM suitability_profiles
		  WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`, demoUser,
	).Scan(&includesCrypto, &expiresAt); err == nil {
		f.SuitabilityComplete = includesCrypto
		f.SuitabilityExpired = expiresAt != nil && !time.Now().Before(*expiresAt)
	}

	var required, accepted int
	if err := s.pool.QueryRow(s.ctx, `
		WITH req AS (SELECT code, version FROM required_agreements WHERE active=TRUE)
		SELECT (SELECT count(*) FROM req),
		       (SELECT count(*) FROM req r WHERE EXISTS (
		          SELECT 1 FROM agreement_acceptances aa
		           WHERE aa.user_id=$1 AND aa.code=r.code AND aa.version=r.version))`,
		demoUser,
	).Scan(&required, &accepted); err == nil {
		f.AgreementsAccepted = required > 0 && accepted == required
	}
	return f
}

// ── Assets ────────────────────────────────────────────────────────────────────

const assetSelect = `SELECT id, symbol, name, decimals, icon_color, risk_rating, status,
  buy_enabled, sell_enabled, deposit_enabled, withdrawal_enabled,
  min_order_amount, max_order_amount, price_amount, price_currency, change_24h_pct,
  market_cap_amount, volume_24h_amount, description, risk_disclosure, kyc_tier_required FROM assets`

func scanAsset(row pgx.Row) (domain.Asset, error) {
	var a domain.Asset
	var cur string
	if err := row.Scan(&a.ID, &a.Symbol, &a.Name, &a.Decimals, &a.IconColor, &a.RiskRating, &a.Status,
		&a.BuyEnabled, &a.SellEnabled, &a.DepositEnabled, &a.WithdrawalEnabled,
		&a.MinOrderAmount, &a.MaxOrderAmount, &a.Price.Amount, &cur, &a.Change24hPct,
		&a.MarketCap.Amount, &a.Volume24h.Amount, &a.Description, &a.RiskDisclosure, &a.KycTierRequired); err != nil {
		return a, err
	}
	a.Type = "crypto"
	a.Price.Currency, a.MarketCap.Currency, a.Volume24h.Currency = cur, cur, cur
	return a, nil
}

func (s *Store) networks(ids []string) map[string][]domain.Network {
	out := map[string][]domain.Network{}
	if len(ids) == 0 {
		return out
	}
	rows, err := s.pool.Query(s.ctx, `SELECT asset_id, network_id, name, confirmations FROM asset_networks WHERE asset_id = ANY($1)`, ids)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var aid string
		var n domain.Network
		if err := rows.Scan(&aid, &n.ID, &n.Name, &n.Confirmations); err == nil {
			out[aid] = append(out[aid], n)
		}
	}
	return out
}

func (s *Store) Assets() []domain.Asset {
	rows, err := s.pool.Query(s.ctx, assetSelect+` ORDER BY id`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var assets []domain.Asset
	var ids []string
	for rows.Next() {
		a, err := scanAsset(rows)
		if err != nil {
			continue
		}
		assets = append(assets, a)
		ids = append(ids, a.ID)
	}
	nets := s.networks(ids)
	for i := range assets {
		assets[i].SupportedNetworks = nets[assets[i].ID]
	}
	return assets
}

func (s *Store) Asset(key string) (domain.Asset, bool) {
	a, err := scanAsset(s.pool.QueryRow(s.ctx, assetSelect+` WHERE id=$1 OR symbol=$1`, key))
	if err != nil {
		return domain.Asset{}, false
	}
	a.SupportedNetworks = s.networks([]string{a.ID})[a.ID]
	return a, true
}

// ── Positions / portfolio ─────────────────────────────────────────────────────

func buildPosition(assetID, symbol, name, iconColor, risk string, decimals int, qty, costBasis, price int64, change float64) domain.Position {
	unit := math.Pow(10, float64(decimals))
	coins := float64(qty) / unit
	marketValue := int64(math.Round(coins * float64(price)))
	var avg int64
	if coins > 0 {
		avg = int64(math.Round(float64(costBasis) / coins))
	}
	unrl := marketValue - costBasis
	pct := 0.0
	if costBasis > 0 {
		pct = round2(float64(unrl) / float64(costBasis) * 100)
	}
	return domain.Position{
		AssetID: assetID, Symbol: symbol, Name: name, IconColor: iconColor, RiskRating: risk,
		Quantity:           domain.CryptoAmount{Amount: qty, Symbol: symbol},
		AverageCost:        domain.Money{Amount: avg, Currency: "NGN"},
		MarketValue:        domain.Money{Amount: marketValue, Currency: "NGN"},
		CostBasis:          domain.Money{Amount: costBasis, Currency: "NGN"},
		UnrealizedGainLoss: domain.Money{Amount: unrl, Currency: "NGN"},
		UnrealizedPct:      pct,
		Price:              domain.Money{Amount: price, Currency: "NGN"},
		Change24hPct:       change,
	}
}

const positionsSelect = `SELECT p.asset_id, p.qty_minor, p.cost_basis_minor, a.symbol, a.name, a.icon_color, a.risk_rating, a.decimals, a.price_amount, a.change_24h_pct
  FROM positions p JOIN assets a ON a.id = p.asset_id
  WHERE p.user_id = $1 AND p.qty_minor > 0`

func (s *Store) Positions() []domain.Position {
	rows, err := s.pool.Query(s.ctx, positionsSelect, demoUser)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []domain.Position
	for rows.Next() {
		var assetID, symbol, name, iconColor, risk string
		var decimals int
		var qty, costBasis, price int64
		var change float64
		if err := rows.Scan(&assetID, &qty, &costBasis, &symbol, &name, &iconColor, &risk, &decimals, &price, &change); err != nil {
			continue
		}
		out = append(out, buildPosition(assetID, symbol, name, iconColor, risk, decimals, qty, costBasis, price, change))
	}
	return out
}

func (s *Store) Portfolio() domain.Portfolio {
	positions := s.Positions()
	var tv, tc, day int64
	for _, p := range positions {
		tv += p.MarketValue.Amount
		tc += p.CostBasis.Amount
		day += int64(math.Round(float64(p.MarketValue.Amount) * p.Change24hPct / 100))
	}
	gain := tv - tc
	gainPct := 0.0
	if tc > 0 {
		gainPct = round2(float64(gain) / float64(tc) * 100)
	}
	prev := tv - day
	dayPct := 0.0
	if prev > 0 {
		dayPct = round2(float64(day) / float64(prev) * 100)
	}
	var investable int64
	_ = s.pool.QueryRow(s.ctx, `SELECT available_minor FROM wallet_balances WHERE user_id=$1 AND currency='NGN'`, demoUser).Scan(&investable)
	return domain.Portfolio{
		BaseCurrency:      "NGN",
		TotalValue:        domain.Money{Amount: tv, Currency: "NGN"},
		TotalCostBasis:    domain.Money{Amount: tc, Currency: "NGN"},
		TotalGainLoss:     domain.Money{Amount: gain, Currency: "NGN"},
		TotalGainLossPct:  gainPct,
		DayChange:         domain.Money{Amount: day, Currency: "NGN"},
		DayChangePct:      dayPct,
		InvestableBalance: domain.Money{Amount: investable, Currency: "NGN"},
		Positions:         positions,
	}
}

// ── Transactions ──────────────────────────────────────────────────────────────

func (s *Store) Transactions(side string) []domain.TxSummary {
	q := `SELECT id, reference, side, symbol, asset_name, icon_color, status, fiat_amount, fiat_currency, crypto_amount, created_at
	      FROM crypto_transactions WHERE user_id=$1`
	args := []any{demoUser}
	if side != "" {
		q += ` AND side=$2`
		args = append(args, side)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.pool.Query(s.ctx, q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []domain.TxSummary
	for rows.Next() {
		var t domain.TxSummary
		var created time.Time
		if err := rows.Scan(&t.ID, &t.Reference, &t.Side, &t.Symbol, &t.AssetName, &t.IconColor, &t.Status,
			&t.Fiat.Amount, &t.Fiat.Currency, &t.Crypto.Amount, &created); err != nil {
			continue
		}
		t.Crypto.Symbol = t.Symbol
		t.CreatedAt = iso(created)
		out = append(out, t)
	}
	return out
}

func (s *Store) Transaction(id string) (domain.TxDetail, bool) {
	var d domain.TxDetail
	var created time.Time
	var failure *string
	err := s.pool.QueryRow(s.ctx, `SELECT id, reference, side, symbol, asset_name, icon_color, status,
	    fiat_amount, fiat_currency, crypto_amount, all_in_rate_amount, total_fiat_amount,
	    provider, provider_reference, liquidity_provider, custody_provider, failure_reason, created_at
	  FROM crypto_transactions WHERE (id=$1 OR reference=$1) AND user_id=$2`, id, demoUser).Scan(
		&d.ID, &d.Reference, &d.Side, &d.Symbol, &d.AssetName, &d.IconColor, &d.Status,
		&d.Fiat.Amount, &d.Fiat.Currency, &d.Crypto.Amount, &d.AllInRate.Amount, &d.TotalFiat.Amount,
		&d.Provider, &d.ProviderReference, &d.LiquidityProvider, &d.CustodyProvider, &failure, &created)
	if err != nil {
		return domain.TxDetail{}, false
	}
	d.Crypto.Symbol = d.Symbol
	d.AllInRate.Currency, d.TotalFiat.Currency = "NGN", "NGN"
	d.CreatedAt = iso(created)
	if failure != nil {
		d.FailureReason = *failure
	}

	if frows, err := s.pool.Query(s.ctx, `SELECT type, amount_minor, currency FROM crypto_transaction_fees WHERE transaction_id=$1`, d.ID); err == nil {
		defer frows.Close()
		for frows.Next() {
			var f domain.Fee
			if err := frows.Scan(&f.Type, &f.Amount.Amount, &f.Amount.Currency); err == nil {
				d.Fees = append(d.Fees, f)
			}
		}
	}
	if erows, err := s.pool.Query(s.ctx, `SELECT status, at FROM crypto_transaction_status_events WHERE transaction_id=$1 ORDER BY at`, d.ID); err == nil {
		defer erows.Close()
		for erows.Next() {
			var ev domain.StatusEvent
			var at time.Time
			if err := erows.Scan(&ev.Status, &at); err == nil {
				ev.At = iso(at)
				d.StatusHistory = append(d.StatusHistory, ev)
			}
		}
	}
	return d, true
}

// UpdateTransactionStatus advances a transaction's status + records a status event.
func (s *Store) UpdateTransactionStatus(reference, status string) bool {
	tx, err := s.pool.Begin(s.ctx)
	if err != nil {
		return false
	}
	defer tx.Rollback(s.ctx)
	var id string
	if err := tx.QueryRow(s.ctx, `UPDATE crypto_transactions SET status=$1 WHERE reference=$2 AND user_id=$3 RETURNING id`,
		status, reference, demoUser).Scan(&id); err != nil {
		return false
	}
	if _, err := tx.Exec(s.ctx, `INSERT INTO crypto_transaction_status_events (transaction_id, status, at) VALUES ($1,$2,now())`, id, status); err != nil {
		return false
	}
	return tx.Commit(s.ctx) == nil
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

func (s *Store) Watchlist() []domain.Asset {
	rows, err := s.pool.Query(s.ctx, assetSelect+` WHERE id IN (SELECT asset_id FROM watchlist_entries WHERE user_id=$1) ORDER BY id`, demoUser)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var assets []domain.Asset
	var ids []string
	for rows.Next() {
		if a, err := scanAsset(rows); err == nil {
			assets = append(assets, a)
			ids = append(ids, a.ID)
		}
	}
	nets := s.networks(ids)
	for i := range assets {
		assets[i].SupportedNetworks = nets[assets[i].ID]
	}
	return assets
}

func (s *Store) AddWatch(assetID string) {
	_, _ = s.pool.Exec(s.ctx, `INSERT INTO watchlist_entries (user_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, demoUser, assetID)
}

func (s *Store) RemoveWatch(assetID string) {
	_, _ = s.pool.Exec(s.ctx, `DELETE FROM watchlist_entries WHERE user_id=$1 AND asset_id=$2`, demoUser, assetID)
}

// ── Alerts ────────────────────────────────────────────────────────────────────

func (s *Store) Alerts() []domain.PriceAlert {
	rows, err := s.pool.Query(s.ctx, `SELECT id, asset_id, symbol, icon_color, condition, target_amount_minor, currency, status, triggered_at, created_at
	  FROM price_alerts WHERE user_id=$1 ORDER BY created_at DESC`, demoUser)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []domain.PriceAlert
	for rows.Next() {
		var a domain.PriceAlert
		var triggered *time.Time
		var created time.Time
		if err := rows.Scan(&a.ID, &a.AssetID, &a.Symbol, &a.IconColor, &a.Condition, &a.TargetPrice.Amount, &a.TargetPrice.Currency, &a.Status, &triggered, &created); err != nil {
			continue
		}
		a.CreatedAt = iso(created)
		if triggered != nil {
			ts := iso(*triggered)
			a.TriggeredAt = &ts
		}
		out = append(out, a)
	}
	return out
}

func (s *Store) CreateAlert(assetID, condition string, target int64, currency string) (domain.PriceAlert, bool) {
	a, ok := s.Asset(assetID)
	if !ok {
		return domain.PriceAlert{}, false
	}
	al := domain.PriceAlert{
		ID: engine.NewID("al"), AssetID: a.ID, Symbol: a.Symbol, IconColor: a.IconColor,
		Condition: condition, TargetPrice: domain.Money{Amount: target, Currency: currency},
		Status: "active", TriggeredAt: nil, CreatedAt: engine.Now(),
	}
	_, err := s.pool.Exec(s.ctx, `INSERT INTO price_alerts (id, user_id, asset_id, symbol, icon_color, condition, target_amount_minor, currency, status)
	  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`, al.ID, demoUser, a.ID, a.Symbol, a.IconColor, condition, target, currency)
	if err != nil {
		return domain.PriceAlert{}, false
	}
	return al, true
}

func (s *Store) DeleteAlert(id string) {
	_, _ = s.pool.Exec(s.ctx, `DELETE FROM price_alerts WHERE id=$1 AND user_id=$2`, id, demoUser)
}

// ── Addresses ─────────────────────────────────────────────────────────────────

func scanAddress(row pgx.Row) (domain.Address, error) {
	var a domain.Address
	var added time.Time
	if err := row.Scan(&a.ID, &a.Label, &a.Symbol, &a.NetworkID, &a.NetworkName, &a.Address, &a.Whitelisted, &a.Screened, &added); err != nil {
		return a, err
	}
	a.AddedAt = iso(added)
	return a, nil
}

func (s *Store) Addresses(symbol string) []domain.Address {
	rows, err := s.pool.Query(s.ctx, `SELECT id, label, symbol, network_id, network_name, address, whitelisted, screened, added_at
	  FROM crypto_addresses WHERE user_id=$1 AND ($2='' OR symbol=$2) ORDER BY added_at DESC`, demoUser, symbol)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []domain.Address
	for rows.Next() {
		if a, err := scanAddress(rows); err == nil {
			out = append(out, a)
		}
	}
	return out
}

func (s *Store) AddAddress(label, symbol, networkID, address string) (domain.Address, bool) {
	a, ok := s.Asset(symbol)
	if !ok {
		return domain.Address{}, false
	}
	net := a.SupportedNetworks[0]
	for _, n := range a.SupportedNetworks {
		if n.ID == networkID {
			net = n
		}
	}
	if label == "" {
		label = "Saved address"
	}
	addr := domain.Address{
		ID: engine.NewID("addr"), Label: label, Symbol: symbol, NetworkID: net.ID, NetworkName: net.Name,
		Address: address, Whitelisted: true, Screened: true, AddedAt: engine.Now(),
	}
	_, err := s.pool.Exec(s.ctx, `INSERT INTO crypto_addresses (id, user_id, label, symbol, network_id, network_name, address, whitelisted, screened)
	  VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,TRUE)`, addr.ID, demoUser, label, symbol, net.ID, net.Name, address)
	if err != nil {
		return domain.Address{}, false
	}
	return addr, true
}

func (s *Store) DeleteAddress(id string) {
	_, _ = s.pool.Exec(s.ctx, `DELETE FROM crypto_addresses WHERE id=$1 AND user_id=$2`, id, demoUser)
}

func (s *Store) AddressByID(id string) (domain.Address, bool) {
	a, err := scanAddress(s.pool.QueryRow(s.ctx, `SELECT id, label, symbol, network_id, network_name, address, whitelisted, screened, added_at
	  FROM crypto_addresses WHERE id=$1 AND user_id=$2`, id, demoUser))
	if err != nil {
		return domain.Address{}, false
	}
	return a, true
}

// ── Quotes ────────────────────────────────────────────────────────────────────

func (s *Store) PutQuote(q domain.Quote) {
	payload, _ := json.Marshal(q)
	exp, _ := time.Parse(time.RFC3339, q.ExpiresAt)
	_, _ = s.pool.Exec(s.ctx, `INSERT INTO quotes (id, user_id, kind, payload, expires_at) VALUES ($1,$2,'trade',$3,$4)
	  ON CONFLICT (id) DO NOTHING`, q.ID, demoUser, string(payload), exp)
}

// GetQuote returns a persisted trade quote only if it is unconsumed and unexpired
// (quote integrity: execution runs strictly against a live, single-use quote_id).
func (s *Store) GetQuote(id string) (domain.Quote, bool) {
	var payload string
	if err := s.pool.QueryRow(s.ctx,
		`SELECT payload FROM quotes WHERE id=$1 AND kind='trade' AND consumed=FALSE AND expires_at > now()`, id,
	).Scan(&payload); err != nil {
		return domain.Quote{}, false
	}
	var q domain.Quote
	if json.Unmarshal([]byte(payload), &q) != nil {
		return domain.Quote{}, false
	}
	return q, true
}

func (s *Store) PutSwapQuote(q domain.SwapQuote) {
	payload, _ := json.Marshal(q)
	exp, _ := time.Parse(time.RFC3339, q.ExpiresAt)
	_, _ = s.pool.Exec(s.ctx, `INSERT INTO quotes (id, user_id, kind, payload, expires_at) VALUES ($1,$2,'swap',$3,$4)
	  ON CONFLICT (id) DO NOTHING`, q.ID, demoUser, string(payload), exp)
}

// GetSwapQuote returns a persisted swap quote only if it is unconsumed + unexpired.
func (s *Store) GetSwapQuote(id string) (domain.SwapQuote, bool) {
	var payload string
	if err := s.pool.QueryRow(s.ctx,
		`SELECT payload FROM quotes WHERE id=$1 AND kind='swap' AND consumed=FALSE AND expires_at > now()`, id,
	).Scan(&payload); err != nil {
		return domain.SwapQuote{}, false
	}
	var q domain.SwapQuote
	if json.Unmarshal([]byte(payload), &q) != nil {
		return domain.SwapQuote{}, false
	}
	return q, true
}

// consumeQuote marks a quote single-use inside an execution transaction.
func (s *Store) consumeQuote(tx pgx.Tx, id string) {
	if id == "" {
		return
	}
	_, _ = tx.Exec(s.ctx, `UPDATE quotes SET consumed=TRUE WHERE id=$1`, id)
}

// ── Idempotency ───────────────────────────────────────────────────────────────

func (s *Store) Idempotent(key string) (any, bool) {
	if key == "" {
		return nil, false
	}
	var resp []byte
	if err := s.pool.QueryRow(s.ctx, `SELECT response FROM idempotency_keys WHERE key=$1`, key).Scan(&resp); err != nil {
		return nil, false
	}
	return json.RawMessage(resp), true
}

func (s *Store) SaveIdempotent(key string, v any) {
	if key == "" {
		return
	}
	resp, _ := json.Marshal(v)
	_, _ = s.pool.Exec(s.ctx, `INSERT INTO idempotency_keys (key, user_id, response) VALUES ($1,$2,$3)
	  ON CONFLICT (key) DO NOTHING`, key, demoUser, resp)
}

// ── Execution (transactional: wallet + position + ledger + history) ───────────

const insertTxSQL = `INSERT INTO crypto_transactions
  (id, user_id, reference, side, asset_id, symbol, asset_name, icon_color, status,
   fiat_amount, fiat_currency, crypto_amount, all_in_rate_amount, total_fiat_amount,
   provider, provider_reference, liquidity_provider, custody_provider, created_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`

const insertLedgerSQL = `INSERT INTO ledger_entries
  (id, transaction_id, debit_account, credit_account, amount, currency, type, reference, provider_reference, created_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`

func execErr(typ, msg string) *store.ExecError { return &store.ExecError{Type: typ, Message: msg} }

func (s *Store) writeFeesAndEvents(tx pgx.Tx, txID string, fees []domain.Fee, statuses []string, at time.Time) error {
	for _, f := range fees {
		if _, err := tx.Exec(s.ctx, `INSERT INTO crypto_transaction_fees (transaction_id, type, amount_minor, currency) VALUES ($1,$2,$3,$4)`,
			txID, f.Type, f.Amount.Amount, f.Amount.Currency); err != nil {
			return err
		}
	}
	for _, st := range statuses {
		if _, err := tx.Exec(s.ctx, `INSERT INTO crypto_transaction_status_events (transaction_id, status, at) VALUES ($1,$2,$3)`,
			txID, st, at); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) ExecuteBuy(q domain.Quote) (domain.Order, *store.ExecError) {
	tx, err := s.pool.Begin(s.ctx)
	if err != nil {
		return domain.Order{}, execErr("internal", "Database error.")
	}
	defer tx.Rollback(s.ctx)

	var status, name, iconColor string
	var buyEnabled bool
	var minA, maxA int64
	if err := tx.QueryRow(s.ctx, `SELECT status, buy_enabled, min_order_amount, max_order_amount, name, icon_color FROM assets WHERE id=$1`, q.AssetID).
		Scan(&status, &buyEnabled, &minA, &maxA, &name, &iconColor); err != nil {
		return domain.Order{}, execErr("asset_unavailable", "Asset not found.")
	}
	if status != "active" || !buyEnabled {
		return domain.Order{}, execErr("asset_unavailable", "This asset is not available to buy.")
	}
	if q.TotalFiat.Amount < minA || q.TotalFiat.Amount > maxA {
		return domain.Order{}, execErr("limit_exceeded", "Order is outside the allowed limits.")
	}

	var available int64
	if err := tx.QueryRow(s.ctx, `SELECT available_minor FROM wallet_balances WHERE user_id=$1 AND currency='NGN' FOR UPDATE`, demoUser).Scan(&available); err != nil {
		return domain.Order{}, execErr("internal", "Wallet not found.")
	}
	if q.TotalFiat.Amount > available {
		return domain.Order{}, execErr("insufficient_balance", "Not enough investable cash.")
	}
	if _, err := tx.Exec(s.ctx, `UPDATE wallet_balances SET available_minor = available_minor - $1, updated_at=now() WHERE user_id=$2 AND currency='NGN'`, q.TotalFiat.Amount, demoUser); err != nil {
		return domain.Order{}, execErr("internal", "Wallet update failed.")
	}
	if _, err := tx.Exec(s.ctx, `INSERT INTO positions (user_id, asset_id, qty_minor, cost_basis_minor) VALUES ($1,$2,$3,$4)
	  ON CONFLICT (user_id, asset_id) DO UPDATE SET qty_minor = positions.qty_minor + EXCLUDED.qty_minor,
	    cost_basis_minor = positions.cost_basis_minor + EXCLUDED.cost_basis_minor, updated_at=now()`,
		demoUser, q.AssetID, q.Crypto.Amount, q.Fiat.Amount); err != nil {
		return domain.Order{}, execErr("internal", "Position update failed.")
	}

	txID, ref, provRef, now := engine.NewID("cx"), engine.NewRef("PMX-CR"), engine.NewRef("LP")+"-XY", time.Now()
	if _, err := tx.Exec(s.ctx, insertTxSQL, txID, demoUser, ref, "buy", q.AssetID, q.Symbol, name, iconColor, "Filled",
		q.Fiat.Amount, q.Fiat.Currency, q.Crypto.Amount, q.AllInRate.Amount, q.TotalFiat.Amount,
		q.LiquidityProvider, provRef, "mock-liquidity", "mock-custody", now); err != nil {
		return domain.Order{}, execErr("internal", "Order write failed.")
	}
	if err := s.writeFeesAndEvents(tx, txID, q.Fees, []string{"QuoteAccepted", "Processing", "Filled"}, now); err != nil {
		return domain.Order{}, execErr("internal", "History write failed.")
	}
	if _, err := tx.Exec(s.ctx, insertLedgerSQL, engine.NewID("le"), txID, "user_cash", "user_crypto:"+q.Symbol,
		q.TotalFiat.Amount, "NGN", "buy", ref, provRef, now); err != nil {
		return domain.Order{}, execErr("internal", "Ledger write failed.")
	}
	s.consumeQuote(tx, q.ID) // single-use: the quote_id cannot be replayed
	if err := tx.Commit(s.ctx); err != nil {
		return domain.Order{}, execErr("internal", "Commit failed.")
	}

	return domain.Order{
		ID: engine.NewID("co"), Reference: ref, AssetID: q.AssetID, Symbol: q.Symbol, Side: "buy", Status: "Filled",
		Fiat: q.Fiat, Crypto: q.Crypto, AllInRate: q.AllInRate, Fees: q.Fees, TotalFiat: q.TotalFiat,
		Provider: q.LiquidityProvider, ProviderReference: provRef, TransactionID: txID, CreatedAt: iso(now),
	}, nil
}

func (s *Store) ExecuteSell(q domain.Quote) (domain.Order, *store.ExecError) {
	tx, err := s.pool.Begin(s.ctx)
	if err != nil {
		return domain.Order{}, execErr("internal", "Database error.")
	}
	defer tx.Rollback(s.ctx)

	var status, name, iconColor string
	var sellEnabled bool
	if err := tx.QueryRow(s.ctx, `SELECT status, sell_enabled, name, icon_color FROM assets WHERE id=$1`, q.AssetID).
		Scan(&status, &sellEnabled, &name, &iconColor); err != nil {
		return domain.Order{}, execErr("asset_unavailable", "Asset not found.")
	}
	if status != "active" || !sellEnabled {
		return domain.Order{}, execErr("asset_unavailable", "This asset is not available to sell.")
	}

	var qty, costBasis int64
	if err := tx.QueryRow(s.ctx, `SELECT qty_minor, cost_basis_minor FROM positions WHERE user_id=$1 AND asset_id=$2 FOR UPDATE`, demoUser, q.AssetID).Scan(&qty, &costBasis); err != nil || qty < q.Crypto.Amount {
		return domain.Order{}, execErr("insufficient_balance", "You don't hold enough of this asset.")
	}
	movedCost := int64(math.Round(float64(costBasis) * (float64(q.Crypto.Amount) / float64(qty))))
	if _, err := tx.Exec(s.ctx, `UPDATE positions SET qty_minor = qty_minor - $1, cost_basis_minor = cost_basis_minor - $2, updated_at=now() WHERE user_id=$3 AND asset_id=$4`,
		q.Crypto.Amount, movedCost, demoUser, q.AssetID); err != nil {
		return domain.Order{}, execErr("internal", "Position update failed.")
	}
	if _, err := tx.Exec(s.ctx, `UPDATE wallet_balances SET available_minor = available_minor + $1, updated_at=now() WHERE user_id=$2 AND currency='NGN'`, q.TotalFiat.Amount, demoUser); err != nil {
		return domain.Order{}, execErr("internal", "Wallet update failed.")
	}

	txID, ref, provRef, now := engine.NewID("cx"), engine.NewRef("PMX-CR"), engine.NewRef("LP")+"-XY", time.Now()
	if _, err := tx.Exec(s.ctx, insertTxSQL, txID, demoUser, ref, "sell", q.AssetID, q.Symbol, name, iconColor, "Filled",
		q.Fiat.Amount, q.Fiat.Currency, q.Crypto.Amount, q.AllInRate.Amount, q.TotalFiat.Amount,
		q.LiquidityProvider, provRef, "mock-liquidity", "mock-custody", now); err != nil {
		return domain.Order{}, execErr("internal", "Order write failed.")
	}
	if err := s.writeFeesAndEvents(tx, txID, q.Fees, []string{"QuoteAccepted", "Processing", "Filled"}, now); err != nil {
		return domain.Order{}, execErr("internal", "History write failed.")
	}
	if _, err := tx.Exec(s.ctx, insertLedgerSQL, engine.NewID("le"), txID, "user_crypto:"+q.Symbol, "user_cash",
		q.TotalFiat.Amount, "NGN", "sell", ref, provRef, now); err != nil {
		return domain.Order{}, execErr("internal", "Ledger write failed.")
	}
	s.consumeQuote(tx, q.ID) // single-use: the quote_id cannot be replayed
	if err := tx.Commit(s.ctx); err != nil {
		return domain.Order{}, execErr("internal", "Commit failed.")
	}

	return domain.Order{
		ID: engine.NewID("co"), Reference: ref, AssetID: q.AssetID, Symbol: q.Symbol, Side: "sell", Status: "Filled",
		Fiat: q.Fiat, Crypto: q.Crypto, AllInRate: q.AllInRate, Fees: q.Fees, TotalFiat: q.TotalFiat,
		Provider: q.LiquidityProvider, ProviderReference: provRef, TransactionID: txID, CreatedAt: iso(now),
	}, nil
}

func (s *Store) ExecuteSwap(q domain.SwapQuote) (domain.SwapResult, *store.ExecError) {
	tx, err := s.pool.Begin(s.ctx)
	if err != nil {
		return domain.SwapResult{}, execErr("internal", "Database error.")
	}
	defer tx.Rollback(s.ctx)

	var fromSym, toSym, toName, toIcon string
	if err := tx.QueryRow(s.ctx, `SELECT symbol FROM assets WHERE id=$1`, q.FromAssetID).Scan(&fromSym); err != nil {
		return domain.SwapResult{}, execErr("asset_unavailable", "Asset not found.")
	}
	if err := tx.QueryRow(s.ctx, `SELECT symbol, name, icon_color FROM assets WHERE id=$1`, q.ToAssetID).Scan(&toSym, &toName, &toIcon); err != nil {
		return domain.SwapResult{}, execErr("asset_unavailable", "Asset not found.")
	}

	var qty, costBasis int64
	if err := tx.QueryRow(s.ctx, `SELECT qty_minor, cost_basis_minor FROM positions WHERE user_id=$1 AND asset_id=$2 FOR UPDATE`, demoUser, q.FromAssetID).Scan(&qty, &costBasis); err != nil || qty < q.From.Amount {
		return domain.SwapResult{}, execErr("insufficient_balance", "You don't hold enough to swap.")
	}
	movedCost := int64(math.Round(float64(costBasis) * (float64(q.From.Amount) / float64(qty))))
	if _, err := tx.Exec(s.ctx, `UPDATE positions SET qty_minor = qty_minor - $1, cost_basis_minor = cost_basis_minor - $2, updated_at=now() WHERE user_id=$3 AND asset_id=$4`,
		q.From.Amount, movedCost, demoUser, q.FromAssetID); err != nil {
		return domain.SwapResult{}, execErr("internal", "Position update failed.")
	}
	if _, err := tx.Exec(s.ctx, `INSERT INTO positions (user_id, asset_id, qty_minor, cost_basis_minor) VALUES ($1,$2,$3,$4)
	  ON CONFLICT (user_id, asset_id) DO UPDATE SET qty_minor = positions.qty_minor + EXCLUDED.qty_minor,
	    cost_basis_minor = positions.cost_basis_minor + EXCLUDED.cost_basis_minor, updated_at=now()`,
		demoUser, q.ToAssetID, q.To.Amount, q.FiatValue.Amount); err != nil {
		return domain.SwapResult{}, execErr("internal", "Position update failed.")
	}

	txID, ref, provRef, now := engine.NewID("cx"), engine.NewRef("PMX-SW"), engine.NewRef("LP")+"-SW", time.Now()
	if _, err := tx.Exec(s.ctx, insertTxSQL, txID, demoUser, ref, "buy", q.ToAssetID, toSym, toName, toIcon, "Filled",
		q.FiatValue.Amount, "NGN", q.To.Amount, 0, q.FiatValue.Amount,
		q.LiquidityProvider, provRef, "mock-liquidity", "mock-custody", now); err != nil {
		return domain.SwapResult{}, execErr("internal", "Order write failed.")
	}
	if err := s.writeFeesAndEvents(tx, txID, []domain.Fee{{Type: "spread", Amount: q.Fee}}, []string{"QuoteAccepted", "Filled"}, now); err != nil {
		return domain.SwapResult{}, execErr("internal", "History write failed.")
	}
	if _, err := tx.Exec(s.ctx, insertLedgerSQL, engine.NewID("le"), txID, "user_crypto:"+fromSym, "user_crypto:"+toSym,
		q.FiatValue.Amount, "NGN", "swap", ref, provRef, now); err != nil {
		return domain.SwapResult{}, execErr("internal", "Ledger write failed.")
	}
	s.consumeQuote(tx, q.ID) // single-use: the quote_id cannot be replayed
	if err := tx.Commit(s.ctx); err != nil {
		return domain.SwapResult{}, execErr("internal", "Commit failed.")
	}

	return domain.SwapResult{
		ID: engine.NewID("so"), Reference: ref, FromSymbol: fromSym, ToSymbol: toSym, Status: "Filled",
		From: q.From, To: q.To, Fee: q.Fee, Provider: q.LiquidityProvider, ProviderReference: provRef,
		TransactionID: txID, CreatedAt: iso(now),
	}, nil
}

// RecordWithdrawal debits the holding and persists a pending-review withdrawal.
func (s *Store) RecordWithdrawal(symbol, networkName, address string, cryptoAmount, networkFee, fiatValue int64) (domain.WithdrawalResult, *store.ExecError) {
	tx, err := s.pool.Begin(s.ctx)
	if err != nil {
		return domain.WithdrawalResult{}, execErr("internal", "Database error.")
	}
	defer tx.Rollback(s.ctx)

	var assetID, name, iconColor string
	var priceAmt int64
	if err := tx.QueryRow(s.ctx, `SELECT id, name, icon_color, price_amount FROM assets WHERE symbol=$1`, symbol).Scan(&assetID, &name, &iconColor, &priceAmt); err != nil {
		return domain.WithdrawalResult{}, execErr("asset_unavailable", "Asset not found.")
	}
	var qty, costBasis int64
	if err := tx.QueryRow(s.ctx, `SELECT qty_minor, cost_basis_minor FROM positions WHERE user_id=$1 AND asset_id=$2 FOR UPDATE`, demoUser, assetID).Scan(&qty, &costBasis); err != nil || qty < cryptoAmount {
		return domain.WithdrawalResult{}, execErr("insufficient_balance", "You don't hold enough to withdraw.")
	}
	movedCost := int64(math.Round(float64(costBasis) * (float64(cryptoAmount) / float64(qty))))
	if _, err := tx.Exec(s.ctx, `UPDATE positions SET qty_minor=qty_minor-$1, cost_basis_minor=cost_basis_minor-$2, updated_at=now() WHERE user_id=$3 AND asset_id=$4`,
		cryptoAmount, movedCost, demoUser, assetID); err != nil {
		return domain.WithdrawalResult{}, execErr("internal", "Position update failed.")
	}

	txID, ref, provRef, now := engine.NewID("cx"), engine.NewRef("PMX-WD"), engine.NewRef("CU")+"-WD", time.Now()
	if _, err := tx.Exec(s.ctx, insertTxSQL, txID, demoUser, ref, "withdraw", assetID, symbol, name, iconColor, "WithdrawalPendingReview",
		fiatValue, "NGN", cryptoAmount, priceAmt, fiatValue, "mock-custody", provRef, "mock-liquidity", "mock-custody", now); err != nil {
		return domain.WithdrawalResult{}, execErr("internal", "Order write failed.")
	}
	if err := s.writeFeesAndEvents(tx, txID, nil, []string{"WithdrawalPendingReview"}, now); err != nil {
		return domain.WithdrawalResult{}, execErr("internal", "History write failed.")
	}
	if _, err := tx.Exec(s.ctx, insertLedgerSQL, engine.NewID("le"), txID, "user_crypto:"+symbol, "external:"+address, fiatValue, "NGN", "withdraw", ref, provRef, now); err != nil {
		return domain.WithdrawalResult{}, execErr("internal", "Ledger write failed.")
	}
	if err := tx.Commit(s.ctx); err != nil {
		return domain.WithdrawalResult{}, execErr("internal", "Commit failed.")
	}

	return domain.WithdrawalResult{
		ID: engine.NewID("wd"), Reference: ref, Symbol: symbol, Status: "WithdrawalPendingReview",
		Amount: domain.CryptoAmount{Amount: cryptoAmount, Symbol: symbol}, NetworkFee: domain.CryptoAmount{Amount: networkFee, Symbol: symbol},
		Address: address, NetworkName: networkName, ProviderReference: provRef, EstimatedReviewMin: 30, CreatedAt: iso(now),
	}, nil
}

// ReverseWithdrawal re-credits a failed withdrawal's crypto and marks it failed.
func (s *Store) ReverseWithdrawal(reference string) bool {
	tx, err := s.pool.Begin(s.ctx)
	if err != nil {
		return false
	}
	defer tx.Rollback(s.ctx)

	var id, symbol, status string
	var cryptoAmount, fiatValue int64
	if err := tx.QueryRow(s.ctx, `SELECT id, symbol, status, crypto_amount, total_fiat_amount
	  FROM crypto_transactions WHERE reference=$1 AND side='withdraw' AND user_id=$2 FOR UPDATE`,
		reference, demoUser).Scan(&id, &symbol, &status, &cryptoAmount, &fiatValue); err != nil {
		return false
	}
	if status == "WithdrawalFailed" || status == "WithdrawalConfirmed" {
		return false // terminal already
	}
	var assetID string
	if err := tx.QueryRow(s.ctx, `SELECT id FROM assets WHERE symbol=$1`, symbol).Scan(&assetID); err != nil {
		return false
	}
	if _, err := tx.Exec(s.ctx, `INSERT INTO positions (user_id, asset_id, qty_minor, cost_basis_minor) VALUES ($1,$2,$3,$4)
	  ON CONFLICT (user_id, asset_id) DO UPDATE SET qty_minor=positions.qty_minor+EXCLUDED.qty_minor,
	    cost_basis_minor=positions.cost_basis_minor+EXCLUDED.cost_basis_minor, updated_at=now()`,
		demoUser, assetID, cryptoAmount, fiatValue); err != nil {
		return false
	}
	if _, err := tx.Exec(s.ctx, `UPDATE crypto_transactions SET status='WithdrawalFailed' WHERE id=$1`, id); err != nil {
		return false
	}
	if _, err := tx.Exec(s.ctx, `INSERT INTO crypto_transaction_status_events (transaction_id, status, at) VALUES ($1,'WithdrawalFailed',now())`, id); err != nil {
		return false
	}
	if _, err := tx.Exec(s.ctx, insertLedgerSQL, engine.NewID("le"), id, "external:reversal", "user_crypto:"+symbol, fiatValue, "NGN", "reversal", reference, "", time.Now()); err != nil {
		return false
	}
	return tx.Commit(s.ctx) == nil
}

// CreditDeposit credits the holding and persists a confirmed deposit.
func (s *Store) CreditDeposit(symbol string, cryptoAmount, fiatValue int64, providerRef string) (domain.TxDetail, *store.ExecError) {
	tx, err := s.pool.Begin(s.ctx)
	if err != nil {
		return domain.TxDetail{}, execErr("internal", "Database error.")
	}
	defer tx.Rollback(s.ctx)

	var assetID, name, iconColor string
	var priceAmt int64
	if err := tx.QueryRow(s.ctx, `SELECT id, name, icon_color, price_amount FROM assets WHERE symbol=$1`, symbol).Scan(&assetID, &name, &iconColor, &priceAmt); err != nil {
		return domain.TxDetail{}, execErr("asset_unavailable", "Asset not found.")
	}
	if _, err := tx.Exec(s.ctx, `INSERT INTO positions (user_id, asset_id, qty_minor, cost_basis_minor) VALUES ($1,$2,$3,$4)
	  ON CONFLICT (user_id, asset_id) DO UPDATE SET qty_minor=positions.qty_minor+EXCLUDED.qty_minor,
	    cost_basis_minor=positions.cost_basis_minor+EXCLUDED.cost_basis_minor, updated_at=now()`,
		demoUser, assetID, cryptoAmount, fiatValue); err != nil {
		return domain.TxDetail{}, execErr("internal", "Position update failed.")
	}
	if providerRef == "" {
		providerRef = engine.NewRef("CU") + "-DP"
	}
	txID, ref, now := engine.NewID("cx"), engine.NewRef("PMX-DP"), time.Now()
	if _, err := tx.Exec(s.ctx, insertTxSQL, txID, demoUser, ref, "deposit", assetID, symbol, name, iconColor, "DepositConfirmed",
		fiatValue, "NGN", cryptoAmount, priceAmt, fiatValue, "mock-custody", providerRef, "mock-liquidity", "mock-custody", now); err != nil {
		return domain.TxDetail{}, execErr("internal", "Order write failed.")
	}
	if err := s.writeFeesAndEvents(tx, txID, nil, []string{"DepositDetected", "DepositConfirmed"}, now); err != nil {
		return domain.TxDetail{}, execErr("internal", "History write failed.")
	}
	if _, err := tx.Exec(s.ctx, insertLedgerSQL, engine.NewID("le"), txID, "external", "user_crypto:"+symbol, fiatValue, "NGN", "deposit", ref, providerRef, now); err != nil {
		return domain.TxDetail{}, execErr("internal", "Ledger write failed.")
	}
	if err := tx.Commit(s.ctx); err != nil {
		return domain.TxDetail{}, execErr("internal", "Commit failed.")
	}

	return domain.TxDetail{
		TxSummary: domain.TxSummary{
			ID: txID, Reference: ref, Side: "deposit", Symbol: symbol, AssetName: name, IconColor: iconColor,
			Status: "DepositConfirmed", Fiat: domain.Money{Amount: fiatValue, Currency: "NGN"},
			Crypto: domain.CryptoAmount{Amount: cryptoAmount, Symbol: symbol}, CreatedAt: iso(now),
		},
		AllInRate: domain.Money{Amount: priceAmt, Currency: "NGN"}, Fees: []domain.Fee{}, TotalFiat: domain.Money{Amount: fiatValue, Currency: "NGN"},
		Provider: "mock-custody", ProviderReference: providerRef, LiquidityProvider: "mock-liquidity", CustodyProvider: "mock-custody",
		StatusHistory: []domain.StatusEvent{{Status: "DepositDetected", At: iso(now)}, {Status: "DepositConfirmed", At: iso(now)}},
	}, nil
}
