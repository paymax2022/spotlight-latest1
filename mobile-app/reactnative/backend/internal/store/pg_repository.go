package store

// PgRepository implements Repository against the Postgres schema in
// migrations/000001_init.up.sql using pgx/v5.
//
// Design contract
//   - Every method scopes reads/writes to p.userID (set via ForUser).
//   - Execution methods (ExecuteBuy/Sell/Swap) run inside a single serializable
//     transaction: pre-trade checks, position upsert, ledger entries, and status
//     events commit atomically. A returned *ExecError means the transaction was
//     rolled back cleanly — no partial state.
//   - Quotes and idempotency keys are stored as JSONB so their shape can evolve
//     without a schema migration.
//   - Assets are global (admin catalogue): they are not scoped by userID.
//
// Wiring in main.go
//   Replace store.New() with store.NewPgRepository(pool) and add per-request
//   scoping via middleware.  Example pattern:
//
//     base := store.NewPgRepository(pool)
//     // In auth middleware, after verifying JWT:
//     repo := base.ForUser(claims.Sub)
//     // Pass repo to handlers instead of the global store.

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"paymax/crypto-backend/internal/domain"
	"paymax/crypto-backend/internal/engine"
)

// PgRepository is the Postgres-backed implementation of Repository.
// It is safe for concurrent use from multiple goroutines; each method acquires
// its own connection from the pool. ForUser returns a cheap shallow copy — no
// allocation of a new pool.
type PgRepository struct {
	db     *pgxpool.Pool
	userID string
}

// NewPgRepository creates a repository bound to the given pool.
// Call ForUser to scope it to an authenticated user before handing it to
// handlers or adapters.
func NewPgRepository(db *pgxpool.Pool) *PgRepository {
	return &PgRepository{db: db}
}

// ForUser returns a copy of the repository scoped to one authenticated user.
// This is the per-request constructor: call it once per HTTP request after
// extracting the subject claim from the verified JWT.
func (p *PgRepository) ForUser(userID string) *PgRepository {
	c := *p
	c.userID = userID
	return &c
}

// Compile-time assertion that PgRepository satisfies the Repository interface.
var _ Repository = (*PgRepository)(nil)

// ── Eligibility ───────────────────────────────────────────────────────────────

// Eligibility returns the user's compliance facts for the trading gate.
// KYC tier + crypto flag come from the users row; suitability and agreement
// acceptance come from the eligibility tables added in 000004_eligibility.up.sql.
// Missing rows yield zero-value (false) facts — the gate fails closed.
func (p *PgRepository) Eligibility() domain.EligibilityFacts {
	ctx := context.Background()
	var f domain.EligibilityFacts

	// users: tier + per-user crypto product flag + active status.
	var status string
	err := p.db.QueryRow(ctx,
		`SELECT kyc_tier, crypto_enabled, COALESCE(status,'active') FROM users WHERE id=$1`,
		p.userID,
	).Scan(&f.KycTier, &f.CryptoEnabled, &status)
	if err != nil {
		return domain.EligibilityFacts{} // unknown user → blocked
	}
	f.UserActive = status == "active"

	// suitability: a non-expired profile whose eligible_products include 'crypto'.
	var expiresAt *time.Time
	var includesCrypto bool
	serr := p.db.QueryRow(ctx,
		`SELECT (eligible_products ? 'crypto'), expires_at
		   FROM suitability_profiles
		  WHERE user_id=$1
		  ORDER BY created_at DESC
		  LIMIT 1`,
		p.userID,
	).Scan(&includesCrypto, &expiresAt)
	if serr == nil {
		f.SuitabilityComplete = includesCrypto
		f.SuitabilityExpired = expiresAt != nil && !time.Now().Before(*expiresAt)
	}

	// agreements: every currently-required agreement has an acceptance for this user.
	var required, accepted int
	aerr := p.db.QueryRow(ctx, `
		WITH req AS (
		  SELECT code, version FROM required_agreements WHERE active=TRUE
		)
		SELECT
		  (SELECT count(*) FROM req),
		  (SELECT count(*) FROM req r
		     WHERE EXISTS (
		       SELECT 1 FROM agreement_acceptances aa
		        WHERE aa.user_id=$1 AND aa.code=r.code AND aa.version=r.version))`,
		p.userID,
	).Scan(&required, &accepted)
	if aerr == nil {
		f.AgreementsAccepted = required > 0 && accepted == required
	}
	return f
}

// ── Market data ───────────────────────────────────────────────────────────────

// Assets returns the full admin-whitelisted asset catalogue (global, not per-user).
func (p *PgRepository) Assets() []domain.Asset {
	ctx := context.Background()
	const q = `
		SELECT a.id, a.symbol, a.name, a.decimals, a.icon_color, a.risk_rating,
		       a.status, a.buy_enabled, a.sell_enabled, a.deposit_enabled,
		       a.withdrawal_enabled, a.min_order_amount, a.max_order_amount,
		       a.price_amount, a.price_currency, a.change_24h_pct,
		       a.market_cap_amount, a.volume_24h_amount,
		       a.description, a.risk_disclosure, a.kyc_tier_required
		FROM assets a
		ORDER BY a.symbol`
	rows, err := p.db.Query(ctx, q)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []domain.Asset
	for rows.Next() {
		a := p.scanAsset(rows)
		a.SupportedNetworks = p.networksFor(ctx, a.ID)
		a.Type = "crypto"
		out = append(out, a)
	}
	return out
}

// Asset returns the asset identified by id or symbol (case-insensitive symbol match).
func (p *PgRepository) Asset(key string) (domain.Asset, bool) {
	ctx := context.Background()
	const q = `
		SELECT a.id, a.symbol, a.name, a.decimals, a.icon_color, a.risk_rating,
		       a.status, a.buy_enabled, a.sell_enabled, a.deposit_enabled,
		       a.withdrawal_enabled, a.min_order_amount, a.max_order_amount,
		       a.price_amount, a.price_currency, a.change_24h_pct,
		       a.market_cap_amount, a.volume_24h_amount,
		       a.description, a.risk_disclosure, a.kyc_tier_required
		FROM assets a
		WHERE a.id = $1 OR UPPER(a.symbol) = UPPER($1)`
	row := p.db.QueryRow(ctx, q, key)
	a, err := p.scanAssetRow(row)
	if err != nil {
		return domain.Asset{}, false
	}
	a.SupportedNetworks = p.networksFor(ctx, a.ID)
	a.Type = "crypto"
	return a, true
}

// networksFor fetches the supported networks for an asset id.
func (p *PgRepository) networksFor(ctx context.Context, assetID string) []domain.Network {
	const q = `SELECT network_id, name, confirmations FROM asset_networks WHERE asset_id=$1 ORDER BY network_id`
	rows, err := p.db.Query(ctx, q, assetID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var nets []domain.Network
	for rows.Next() {
		var n domain.Network
		if err := rows.Scan(&n.ID, &n.Name, &n.Confirmations); err == nil {
			nets = append(nets, n)
		}
	}
	return nets
}

// scanAsset scans one row from a Rows cursor into a domain.Asset (sans networks).
func (p *PgRepository) scanAsset(rows pgx.Rows) domain.Asset {
	var a domain.Asset
	var priceAmt int64
	var priceCur string
	var mcAmt, v24Amt int64
	_ = rows.Scan(
		&a.ID, &a.Symbol, &a.Name, &a.Decimals, &a.IconColor, &a.RiskRating,
		&a.Status, &a.BuyEnabled, &a.SellEnabled, &a.DepositEnabled,
		&a.WithdrawalEnabled, &a.MinOrderAmount, &a.MaxOrderAmount,
		&priceAmt, &priceCur, &a.Change24hPct,
		&mcAmt, &v24Amt,
		&a.Description, &a.RiskDisclosure, &a.KycTierRequired,
	)
	a.Price = domain.Money{Amount: priceAmt, Currency: priceCur}
	a.MarketCap = domain.Money{Amount: mcAmt, Currency: priceCur}
	a.Volume24h = domain.Money{Amount: v24Amt, Currency: priceCur}
	return a
}

// scanAssetRow scans one QueryRow result into a domain.Asset (sans networks).
func (p *PgRepository) scanAssetRow(row pgx.Row) (domain.Asset, error) {
	var a domain.Asset
	var priceAmt int64
	var priceCur string
	var mcAmt, v24Amt int64
	err := row.Scan(
		&a.ID, &a.Symbol, &a.Name, &a.Decimals, &a.IconColor, &a.RiskRating,
		&a.Status, &a.BuyEnabled, &a.SellEnabled, &a.DepositEnabled,
		&a.WithdrawalEnabled, &a.MinOrderAmount, &a.MaxOrderAmount,
		&priceAmt, &priceCur, &a.Change24hPct,
		&mcAmt, &v24Amt,
		&a.Description, &a.RiskDisclosure, &a.KycTierRequired,
	)
	if err != nil {
		return domain.Asset{}, err
	}
	a.Price = domain.Money{Amount: priceAmt, Currency: priceCur}
	a.MarketCap = domain.Money{Amount: mcAmt, Currency: priceCur}
	a.Volume24h = domain.Money{Amount: v24Amt, Currency: priceCur}
	return a, nil
}

// ── Quotes ───────────────────────────────────────────────────────────────────

// PutQuote persists a trade quote as JSONB. Quotes expire via the expires_at
// column; the background sweeper (or execution path) checks consumed.
func (p *PgRepository) PutQuote(q domain.Quote) {
	payload, _ := json.Marshal(q)
	exp, _ := time.Parse(time.RFC3339, q.ExpiresAt)
	ctx := context.Background()
	_, _ = p.db.Exec(ctx,
		`INSERT INTO quotes (id, user_id, kind, payload, expires_at)
		 VALUES ($1,$2,'trade',$3,$4)
		 ON CONFLICT (id) DO NOTHING`,
		q.ID, p.userID, payload, exp,
	)
}

// GetQuote retrieves a non-consumed, non-expired trade quote.
func (p *PgRepository) GetQuote(id string) (domain.Quote, bool) {
	ctx := context.Background()
	var raw []byte
	err := p.db.QueryRow(ctx,
		`SELECT payload FROM quotes
		 WHERE id=$1 AND user_id=$2 AND kind='trade'
		   AND consumed=FALSE AND expires_at > now()`,
		id, p.userID,
	).Scan(&raw)
	if err != nil {
		return domain.Quote{}, false
	}
	var q domain.Quote
	if err := json.Unmarshal(raw, &q); err != nil {
		return domain.Quote{}, false
	}
	return q, true
}

// PutSwapQuote persists a swap quote as JSONB.
func (p *PgRepository) PutSwapQuote(q domain.SwapQuote) {
	payload, _ := json.Marshal(q)
	exp, _ := time.Parse(time.RFC3339, q.ExpiresAt)
	ctx := context.Background()
	_, _ = p.db.Exec(ctx,
		`INSERT INTO quotes (id, user_id, kind, payload, expires_at)
		 VALUES ($1,$2,'swap',$3,$4)
		 ON CONFLICT (id) DO NOTHING`,
		q.ID, p.userID, payload, exp,
	)
}

// GetSwapQuote retrieves a non-consumed, non-expired swap quote.
func (p *PgRepository) GetSwapQuote(id string) (domain.SwapQuote, bool) {
	ctx := context.Background()
	var raw []byte
	err := p.db.QueryRow(ctx,
		`SELECT payload FROM quotes
		 WHERE id=$1 AND user_id=$2 AND kind='swap'
		   AND consumed=FALSE AND expires_at > now()`,
		id, p.userID,
	).Scan(&raw)
	if err != nil {
		return domain.SwapQuote{}, false
	}
	var q domain.SwapQuote
	if err := json.Unmarshal(raw, &q); err != nil {
		return domain.SwapQuote{}, false
	}
	return q, true
}

// markQuoteConsumed marks a quote consumed inside tx (called from Execute*).
func (p *PgRepository) markQuoteConsumed(ctx context.Context, tx pgx.Tx, id string) {
	_, _ = tx.Exec(ctx, `UPDATE quotes SET consumed=TRUE WHERE id=$1 AND user_id=$2`, id, p.userID)
}

// ── Idempotency ──────────────────────────────────────────────────────────────

// Idempotent returns the stored response for a key, if present.
// Keys are stored as "<userID>:<key>" so the same header value from different
// users never collides.
func (p *PgRepository) Idempotent(key string) (any, bool) {
	ctx := context.Background()
	var raw []byte
	err := p.db.QueryRow(ctx,
		`SELECT response FROM idempotency_keys WHERE key=$1`,
		p.scopedKey(key),
	).Scan(&raw)
	if err != nil {
		return nil, false
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, false
	}
	return v, true
}

// SaveIdempotent persists a response. Duplicate keys are silently ignored
// (the existing row is authoritative — retries get the same response).
func (p *PgRepository) SaveIdempotent(key string, v any) {
	raw, _ := json.Marshal(v)
	ctx := context.Background()
	_, _ = p.db.Exec(ctx,
		`INSERT INTO idempotency_keys (key, user_id, response)
		 VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING`,
		p.scopedKey(key), p.userID, raw,
	)
}

// scopedKey namespaces a caller-supplied idempotency key with the userID so the
// same header value from different users cannot collide.
func (p *PgRepository) scopedKey(key string) string {
	if p.userID == "" {
		return key
	}
	return p.userID + ":" + key
}

// ── Portfolio / positions ─────────────────────────────────────────────────────

// Portfolio returns the aggregate portfolio for p.userID. Current prices are
// read from the assets table (updated by the market-data sync job).
func (p *PgRepository) Portfolio() domain.Portfolio {
	positions := p.Positions()
	inv := p.investableBalance(context.Background())

	var totalValue, totalCost, totalGain, dayChange int64
	for _, pos := range positions {
		totalValue += pos.MarketValue.Amount
		totalCost += pos.CostBasis.Amount
		totalGain += pos.UnrealizedGainLoss.Amount
		dayChange += int64(math.Round(float64(pos.MarketValue.Amount) * pos.Change24hPct / 100))
	}

	var gainPct, dayPct float64
	if totalCost > 0 {
		gainPct = float64(totalGain) / float64(totalCost) * 100
	}
	if totalValue-totalGain > 0 {
		dayPct = float64(dayChange) / float64(totalValue-dayChange) * 100
	}

	return domain.Portfolio{
		BaseCurrency:      "NGN",
		TotalValue:        domain.Money{Amount: totalValue, Currency: "NGN"},
		TotalCostBasis:    domain.Money{Amount: totalCost, Currency: "NGN"},
		TotalGainLoss:     domain.Money{Amount: totalGain, Currency: "NGN"},
		TotalGainLossPct:  gainPct,
		DayChange:         domain.Money{Amount: dayChange, Currency: "NGN"},
		DayChangePct:      dayPct,
		InvestableBalance: domain.Money{Amount: inv, Currency: "NGN"},
		Positions:         positions,
	}
}

// Positions returns the user's current non-zero holdings enriched with live prices.
func (p *PgRepository) Positions() []domain.Position {
	ctx := context.Background()
	const q = `
		SELECT pos.asset_id, pos.qty_minor, pos.cost_basis_minor,
		       a.symbol, a.name, a.icon_color, a.risk_rating, a.decimals,
		       a.price_amount, a.price_currency, a.change_24h_pct
		FROM positions pos
		JOIN assets a ON a.id = pos.asset_id
		WHERE pos.user_id = $1 AND pos.qty_minor > 0
		ORDER BY a.symbol`
	rows, err := p.db.Query(ctx, q, p.userID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []domain.Position
	for rows.Next() {
		var assetID, symbol, name, iconColor, riskRating, priceCur string
		var qtyMinor, costBasisMinor, priceAmt int64
		var decimals int
		var change24h float64
		if err := rows.Scan(
			&assetID, &qtyMinor, &costBasisMinor,
			&symbol, &name, &iconColor, &riskRating, &decimals,
			&priceAmt, &priceCur, &change24h,
		); err != nil {
			continue
		}
		marketValue := int64(math.Round(float64(qtyMinor) / math.Pow10(decimals) * float64(priceAmt)))
		avgCost := int64(0)
		if qtyMinor > 0 {
			avgCost = int64(math.Round(float64(costBasisMinor) / (float64(qtyMinor) / math.Pow10(decimals))))
		}
		unrealized := marketValue - costBasisMinor
		var unrealizedPct float64
		if costBasisMinor > 0 {
			unrealizedPct = float64(unrealized) / float64(costBasisMinor) * 100
		}
		out = append(out, domain.Position{
			AssetID:            assetID,
			Symbol:             symbol,
			Name:               name,
			IconColor:          iconColor,
			RiskRating:         riskRating,
			Quantity:           domain.CryptoAmount{Amount: qtyMinor, Symbol: symbol},
			AverageCost:        domain.Money{Amount: avgCost, Currency: priceCur},
			MarketValue:        domain.Money{Amount: marketValue, Currency: priceCur},
			CostBasis:          domain.Money{Amount: costBasisMinor, Currency: priceCur},
			UnrealizedGainLoss: domain.Money{Amount: unrealized, Currency: priceCur},
			UnrealizedPct:      unrealizedPct,
			Price:              domain.Money{Amount: priceAmt, Currency: priceCur},
			Change24hPct:       change24h,
		})
	}
	return out
}

// investableBalance computes available fiat cash from the double-entry ledger.
// Credits to user_cash (sell proceeds, funding) minus debits from user_cash
// (buy spending, withdrawals) joined via crypto_transactions for user scoping.
func (p *PgRepository) investableBalance(ctx context.Context) int64 {
	const q = `
		SELECT
		  COALESCE(SUM(le.amount) FILTER (WHERE le.credit_account = 'user_cash'), 0) -
		  COALESCE(SUM(le.amount) FILTER (WHERE le.debit_account  = 'user_cash'), 0)
		FROM ledger_entries le
		JOIN crypto_transactions ct ON ct.id = le.transaction_id
		WHERE ct.user_id = $1
		  AND (le.credit_account = 'user_cash' OR le.debit_account = 'user_cash')`
	var bal int64
	_ = p.db.QueryRow(ctx, q, p.userID).Scan(&bal)
	return bal
}

// ── Transaction history ───────────────────────────────────────────────────────

// Transactions returns the user's transaction history, optionally filtered by
// side ("buy" or "sell"; "" returns all).
func (p *PgRepository) Transactions(side string) []domain.TxSummary {
	ctx := context.Background()
	q := `
		SELECT ct.id, ct.reference, ct.side, ct.symbol, ct.asset_name, ct.icon_color,
		       ct.status, ct.fiat_amount, ct.fiat_currency, ct.crypto_amount, ct.created_at
		FROM crypto_transactions ct
		WHERE ct.user_id = $1`
	args := []any{p.userID}
	if side != "" {
		args = append(args, side)
		q += fmt.Sprintf(" AND ct.side = $%d", len(args))
	}
	q += " ORDER BY ct.created_at DESC"

	rows, err := p.db.Query(ctx, q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []domain.TxSummary
	for rows.Next() {
		var t domain.TxSummary
		var fiatAmt, cryptoAmt int64
		var fiatCur, createdAt string
		if err := rows.Scan(
			&t.ID, &t.Reference, &t.Side, &t.Symbol, &t.AssetName, &t.IconColor,
			&t.Status, &fiatAmt, &fiatCur, &cryptoAmt, &createdAt,
		); err != nil {
			continue
		}
		t.Fiat = domain.Money{Amount: fiatAmt, Currency: fiatCur}
		t.Crypto = domain.CryptoAmount{Amount: cryptoAmt, Symbol: t.Symbol}
		t.CreatedAt = createdAt
		out = append(out, t)
	}
	return out
}

// Transaction returns the full receipt for one transaction id.
func (p *PgRepository) Transaction(id string) (domain.TxDetail, bool) {
	ctx := context.Background()
	var d domain.TxDetail
	var fiatAmt, cryptoAmt, allInAmt, totalFiatAmt int64
	var fiatCur, createdAt string
	err := p.db.QueryRow(ctx, `
		SELECT ct.id, ct.reference, ct.side, ct.symbol, ct.asset_name, ct.icon_color,
		       ct.status, ct.fiat_amount, ct.fiat_currency, ct.crypto_amount,
		       ct.all_in_rate_amount, ct.total_fiat_amount,
		       ct.provider, ct.provider_reference,
		       ct.liquidity_provider, ct.custody_provider,
		       ct.failure_reason, ct.created_at
		FROM crypto_transactions ct
		WHERE ct.id=$1 AND ct.user_id=$2`,
		id, p.userID,
	).Scan(
		&d.ID, &d.Reference, &d.Side, &d.Symbol, &d.AssetName, &d.IconColor,
		&d.Status, &fiatAmt, &fiatCur, &cryptoAmt,
		&allInAmt, &totalFiatAmt,
		&d.Provider, &d.ProviderReference,
		&d.LiquidityProvider, &d.CustodyProvider,
		&d.FailureReason, &createdAt,
	)
	if err != nil {
		return domain.TxDetail{}, false
	}
	d.Fiat = domain.Money{Amount: fiatAmt, Currency: fiatCur}
	d.Crypto = domain.CryptoAmount{Amount: cryptoAmt, Symbol: d.Symbol}
	d.AllInRate = domain.Money{Amount: allInAmt, Currency: fiatCur}
	d.TotalFiat = domain.Money{Amount: totalFiatAmt, Currency: fiatCur}
	d.CreatedAt = createdAt

	// Fee rows.
	feeRows, _ := p.db.Query(ctx,
		`SELECT type, amount_minor, currency FROM crypto_transaction_fees WHERE transaction_id=$1 ORDER BY type`,
		id,
	)
	if feeRows != nil {
		defer feeRows.Close()
		for feeRows.Next() {
			var f domain.Fee
			var amt int64
			var cur string
			if err := feeRows.Scan(&f.Type, &amt, &cur); err == nil {
				f.Amount = domain.Money{Amount: amt, Currency: cur}
				d.Fees = append(d.Fees, f)
			}
		}
	}

	// Status events.
	evRows, _ := p.db.Query(ctx,
		`SELECT status, at FROM crypto_transaction_status_events WHERE transaction_id=$1 ORDER BY at`,
		id,
	)
	if evRows != nil {
		defer evRows.Close()
		for evRows.Next() {
			var ev domain.StatusEvent
			if err := evRows.Scan(&ev.Status, &ev.At); err == nil {
				d.StatusHistory = append(d.StatusHistory, ev)
			}
		}
	}
	return d, true
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

// Watchlist returns the assets the user has added to their watchlist.
func (p *PgRepository) Watchlist() []domain.Asset {
	ctx := context.Background()
	const q = `
		SELECT a.id, a.symbol, a.name, a.decimals, a.icon_color, a.risk_rating,
		       a.status, a.buy_enabled, a.sell_enabled, a.deposit_enabled,
		       a.withdrawal_enabled, a.min_order_amount, a.max_order_amount,
		       a.price_amount, a.price_currency, a.change_24h_pct,
		       a.market_cap_amount, a.volume_24h_amount,
		       a.description, a.risk_disclosure, a.kyc_tier_required
		FROM assets a
		JOIN watchlist_entries we ON we.asset_id = a.id
		WHERE we.user_id = $1
		ORDER BY we.added_at`
	rows, err := p.db.Query(ctx, q, p.userID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []domain.Asset
	for rows.Next() {
		a := p.scanAsset(rows)
		a.SupportedNetworks = p.networksFor(ctx, a.ID)
		a.Type = "crypto"
		out = append(out, a)
	}
	return out
}

// AddWatch adds an asset to the user's watchlist. Idempotent.
func (p *PgRepository) AddWatch(assetID string) {
	ctx := context.Background()
	_, _ = p.db.Exec(ctx,
		`INSERT INTO watchlist_entries (user_id, asset_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		p.userID, assetID,
	)
}

// RemoveWatch removes an asset from the user's watchlist.
func (p *PgRepository) RemoveWatch(assetID string) {
	ctx := context.Background()
	_, _ = p.db.Exec(ctx,
		`DELETE FROM watchlist_entries WHERE user_id=$1 AND asset_id=$2`,
		p.userID, assetID,
	)
}

// ── Price alerts ──────────────────────────────────────────────────────────────

// Alerts returns all price alerts for the user.
func (p *PgRepository) Alerts() []domain.PriceAlert {
	ctx := context.Background()
	rows, err := p.db.Query(ctx, `
		SELECT id, asset_id, symbol, icon_color, condition,
		       target_amount_minor, currency, status, triggered_at, created_at
		FROM price_alerts WHERE user_id=$1 ORDER BY created_at DESC`,
		p.userID,
	)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []domain.PriceAlert
	for rows.Next() {
		var a domain.PriceAlert
		var amt int64
		var cur string
		var triggeredAt *string
		if err := rows.Scan(
			&a.ID, &a.AssetID, &a.Symbol, &a.IconColor, &a.Condition,
			&amt, &cur, &a.Status, &triggeredAt, &a.CreatedAt,
		); err != nil {
			continue
		}
		a.TargetPrice = domain.Money{Amount: amt, Currency: cur}
		a.TriggeredAt = triggeredAt
		out = append(out, a)
	}
	return out
}

// CreateAlert inserts a new price alert. Returns (alert, true) on success.
// Returns (zero, false) if the asset does not exist.
func (p *PgRepository) CreateAlert(assetID, condition string, targetMinor int64, currency string) (domain.PriceAlert, bool) {
	ctx := context.Background()

	// Resolve icon_color and symbol from the asset catalogue.
	var symbol, iconColor string
	err := p.db.QueryRow(ctx,
		`SELECT symbol, icon_color FROM assets WHERE id=$1`, assetID,
	).Scan(&symbol, &iconColor)
	if err != nil {
		return domain.PriceAlert{}, false
	}

	id := engine.NewID("pa")
	now := engine.Now()
	_, err = p.db.Exec(ctx, `
		INSERT INTO price_alerts
		  (id, user_id, asset_id, symbol, icon_color, condition,
		   target_amount_minor, currency, status, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9)`,
		id, p.userID, assetID, symbol, iconColor, condition, targetMinor, currency, now,
	)
	if err != nil {
		return domain.PriceAlert{}, false
	}
	return domain.PriceAlert{
		ID:          id,
		AssetID:     assetID,
		Symbol:      symbol,
		IconColor:   iconColor,
		Condition:   condition,
		TargetPrice: domain.Money{Amount: targetMinor, Currency: currency},
		Status:      "active",
		TriggeredAt: nil,
		CreatedAt:   now,
	}, true
}

// DeleteAlert removes a price alert (no-op if not found or not owned by this user).
func (p *PgRepository) DeleteAlert(id string) {
	ctx := context.Background()
	_, _ = p.db.Exec(ctx,
		`DELETE FROM price_alerts WHERE id=$1 AND user_id=$2`, id, p.userID,
	)
}

// ── Withdrawal address book ───────────────────────────────────────────────────

// Addresses returns the user's whitelisted withdrawal addresses for a symbol.
// Pass "" for symbol to return all addresses.
func (p *PgRepository) Addresses(symbol string) []domain.Address {
	ctx := context.Background()
	q := `SELECT id, label, symbol, network_id, network_name, address, whitelisted, screened, added_at
	      FROM crypto_addresses WHERE user_id=$1`
	args := []any{p.userID}
	if symbol != "" {
		args = append(args, symbol)
		q += fmt.Sprintf(" AND UPPER(symbol)=UPPER($%d)", len(args))
	}
	q += " ORDER BY added_at DESC"

	rows, err := p.db.Query(ctx, q, args...)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []domain.Address
	for rows.Next() {
		var a domain.Address
		if err := rows.Scan(
			&a.ID, &a.Label, &a.Symbol, &a.NetworkID, &a.NetworkName,
			&a.Address, &a.Whitelisted, &a.Screened, &a.AddedAt,
		); err != nil {
			continue
		}
		out = append(out, a)
	}
	return out
}

// AddAddress inserts a new withdrawal address (pre-whitelist / pre-screen state).
func (p *PgRepository) AddAddress(label, symbol, networkID, address string) (domain.Address, bool) {
	ctx := context.Background()

	// Resolve network name from the asset catalogue.
	var networkName string
	err := p.db.QueryRow(ctx,
		`SELECT an.name FROM asset_networks an
		 JOIN assets a ON a.id = an.asset_id
		 WHERE UPPER(a.symbol)=UPPER($1) AND an.network_id=$2`,
		symbol, networkID,
	).Scan(&networkName)
	if err != nil {
		networkName = networkID // fall back to raw id if not catalogued yet
	}

	id := engine.NewID("ad")
	now := engine.Now()
	_, err = p.db.Exec(ctx, `
		INSERT INTO crypto_addresses
		  (id, user_id, label, symbol, network_id, network_name, address,
		   whitelisted, screened, added_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,FALSE,$8)`,
		id, p.userID, label, symbol, networkID, networkName, address, now,
	)
	if err != nil {
		return domain.Address{}, false
	}
	return domain.Address{
		ID: id, Label: label, Symbol: symbol,
		NetworkID: networkID, NetworkName: networkName,
		Address: address, Whitelisted: false, Screened: false, AddedAt: now,
	}, true
}

// DeleteAddress removes an address from the user's address book.
func (p *PgRepository) DeleteAddress(id string) {
	ctx := context.Background()
	_, _ = p.db.Exec(ctx,
		`DELETE FROM crypto_addresses WHERE id=$1 AND user_id=$2`, id, p.userID,
	)
}

// AddressByID returns a single address by id.
func (p *PgRepository) AddressByID(id string) (domain.Address, bool) {
	ctx := context.Background()
	var a domain.Address
	err := p.db.QueryRow(ctx, `
		SELECT id, label, symbol, network_id, network_name, address,
		       whitelisted, screened, added_at
		FROM crypto_addresses WHERE id=$1 AND user_id=$2`,
		id, p.userID,
	).Scan(
		&a.ID, &a.Label, &a.Symbol, &a.NetworkID, &a.NetworkName,
		&a.Address, &a.Whitelisted, &a.Screened, &a.AddedAt,
	)
	if err != nil {
		return domain.Address{}, false
	}
	return a, true
}

// ── Execution ─────────────────────────────────────────────────────────────────

// ExecuteBuy executes a buy order inside a serializable transaction.
// Pre-trade checks: asset active + buy-enabled, order within limits, sufficient
// investable cash. On success: positions upserted, double-entry ledger written,
// quote consumed.
func (p *PgRepository) ExecuteBuy(q domain.Quote) (domain.Order, *ExecError) {
	ctx := context.Background()
	tx, err := p.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to start transaction."}
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// 1. Verify asset is tradable.
	a, ok := p.assetForTradeTx(ctx, tx, q.AssetID)
	if !ok {
		return domain.Order{}, &ExecError{Type: "asset_unavailable", Message: "Asset not found."}
	}
	if a.Status != "active" || !a.BuyEnabled {
		return domain.Order{}, &ExecError{Type: "asset_unavailable", Message: "This asset is not available to buy."}
	}

	// 2. Validate order limits (server-authoritative; client estimates are advisory).
	if q.TotalFiat.Amount < a.MinOrderAmount {
		return domain.Order{}, &ExecError{Type: "limit_exceeded", Message: "Order is below the minimum."}
	}
	if a.MaxOrderAmount > 0 && q.TotalFiat.Amount > a.MaxOrderAmount {
		return domain.Order{}, &ExecError{Type: "limit_exceeded", Message: "Order exceeds the maximum."}
	}

	// 3. Check investable balance (inside tx for serializable read).
	inv := p.investableBalanceTx(ctx, tx)
	if q.TotalFiat.Amount > inv {
		return domain.Order{}, &ExecError{Type: "insufficient_balance", Message: "Not enough investable cash."}
	}

	// 4. Write: transaction record, position upsert, ledger, fees, status events.
	txID := engine.NewID("cx")
	ref := engine.NewRef("PMX-CR")
	provRef := engine.NewRef("LP") + "-XY"
	now := engine.Now()

	if err := p.insertCryptoTx(ctx, tx, txID, ref, "buy", q.AssetID, a, q, provRef, now); err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to record transaction."}
	}
	if err := p.upsertPositionBuy(ctx, tx, q.AssetID, q.Crypto.Amount, q.Fiat.Amount); err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to update position."}
	}
	if err := p.insertLedger(ctx, tx, txID, "user_cash", "user_crypto:"+a.Symbol, q.TotalFiat.Amount, q.TotalFiat.Currency, "buy", ref, provRef); err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to write ledger."}
	}
	p.insertFees(ctx, tx, txID, q.Fees)
	p.insertStatusEvents(ctx, tx, txID, []string{"QuoteAccepted", "Processing", "Filled"}, now)
	p.markQuoteConsumed(ctx, tx, q.ID)

	if err := tx.Commit(ctx); err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to commit transaction."}
	}

	return domain.Order{
		ID: engine.NewID("co"), Reference: ref, AssetID: q.AssetID, Symbol: q.Symbol, Side: "buy",
		Status: "Filled", Fiat: q.Fiat, Crypto: q.Crypto, AllInRate: q.AllInRate, Fees: q.Fees,
		TotalFiat: q.TotalFiat, Provider: q.LiquidityProvider, ProviderReference: provRef,
		TransactionID: txID, CreatedAt: now,
	}, nil
}

// ExecuteSell executes a sell order inside a serializable transaction.
// Pre-trade checks: asset active + sell-enabled, sufficient position quantity.
func (p *PgRepository) ExecuteSell(q domain.Quote) (domain.Order, *ExecError) {
	ctx := context.Background()
	tx, err := p.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to start transaction."}
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	a, ok := p.assetForTradeTx(ctx, tx, q.AssetID)
	if !ok {
		return domain.Order{}, &ExecError{Type: "asset_unavailable", Message: "Asset not found."}
	}
	if a.Status != "active" || !a.SellEnabled {
		return domain.Order{}, &ExecError{Type: "asset_unavailable", Message: "This asset is not available to sell."}
	}

	// Check the user holds enough — lock the position row.
	qtyMinor, costBasis, posExists := p.positionTx(ctx, tx, q.AssetID)
	if !posExists || qtyMinor < q.Crypto.Amount {
		return domain.Order{}, &ExecError{Type: "insufficient_balance", Message: "You don't hold enough of this asset."}
	}

	txID := engine.NewID("cx")
	ref := engine.NewRef("PMX-CR")
	provRef := engine.NewRef("LP") + "-XY"
	now := engine.Now()

	// Proportionally reduce cost basis.
	var movedCost int64
	if qtyMinor > 0 {
		movedCost = int64(math.Round(float64(costBasis) * float64(q.Crypto.Amount) / float64(qtyMinor)))
	}
	if err := p.updatePositionSell(ctx, tx, q.AssetID, q.Crypto.Amount, movedCost); err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to update position."}
	}
	if err := p.insertCryptoTx(ctx, tx, txID, ref, "sell", q.AssetID, a, q, provRef, now); err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to record transaction."}
	}
	if err := p.insertLedger(ctx, tx, txID, "user_crypto:"+a.Symbol, "user_cash", q.TotalFiat.Amount, q.TotalFiat.Currency, "sell", ref, provRef); err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to write ledger."}
	}
	p.insertFees(ctx, tx, txID, q.Fees)
	p.insertStatusEvents(ctx, tx, txID, []string{"QuoteAccepted", "Processing", "Filled"}, now)
	p.markQuoteConsumed(ctx, tx, q.ID)

	if err := tx.Commit(ctx); err != nil {
		return domain.Order{}, &ExecError{Type: "internal", Message: "Failed to commit transaction."}
	}

	return domain.Order{
		ID: engine.NewID("co"), Reference: ref, AssetID: q.AssetID, Symbol: q.Symbol, Side: "sell",
		Status: "Filled", Fiat: q.Fiat, Crypto: q.Crypto, AllInRate: q.AllInRate, Fees: q.Fees,
		TotalFiat: q.TotalFiat, Provider: q.LiquidityProvider, ProviderReference: provRef,
		TransactionID: txID, CreatedAt: now,
	}, nil
}

// ExecuteSwap atomically swaps from-asset into to-asset inside a serializable
// transaction: sells the from-position, buys the to-position, writes one ledger
// entry spanning both legs.
func (p *PgRepository) ExecuteSwap(q domain.SwapQuote) (domain.SwapResult, *ExecError) {
	ctx := context.Background()
	tx, err := p.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return domain.SwapResult{}, &ExecError{Type: "internal", Message: "Failed to start transaction."}
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	fromAsset, okFrom := p.assetForTradeTx(ctx, tx, q.FromAssetID)
	toAsset, okTo := p.assetForTradeTx(ctx, tx, q.ToAssetID)
	if !okFrom || !okTo {
		return domain.SwapResult{}, &ExecError{Type: "asset_unavailable", Message: "Asset not found."}
	}

	qtyFrom, costFrom, posExists := p.positionTx(ctx, tx, q.FromAssetID)
	if !posExists || qtyFrom < q.From.Amount {
		return domain.SwapResult{}, &ExecError{Type: "insufficient_balance", Message: "You don't hold enough to swap."}
	}

	var movedCost int64
	if qtyFrom > 0 {
		movedCost = int64(math.Round(float64(costFrom) * float64(q.From.Amount) / float64(qtyFrom)))
	}
	if err := p.updatePositionSell(ctx, tx, q.FromAssetID, q.From.Amount, movedCost); err != nil {
		return domain.SwapResult{}, &ExecError{Type: "internal", Message: "Failed to update from-position."}
	}
	if err := p.upsertPositionBuy(ctx, tx, q.ToAssetID, q.To.Amount, q.FiatValue.Amount); err != nil {
		return domain.SwapResult{}, &ExecError{Type: "internal", Message: "Failed to update to-position."}
	}

	txID := engine.NewID("cx")
	ref := engine.NewRef("PMX-SW")
	provRef := engine.NewRef("LP") + "-SW"
	now := engine.Now()

	// Record a synthetic buy-side row in crypto_transactions for the to-asset.
	syntheticQ := domain.Quote{
		AssetID: q.ToAssetID, Symbol: toAsset.Symbol, Side: "buy",
		Fiat: q.FiatValue, Crypto: q.To, AllInRate: toAsset.Price,
		Fees:              []domain.Fee{{Type: "spread", Amount: q.Fee}},
		TotalFiat:         q.FiatValue,
		LiquidityProvider: q.LiquidityProvider,
	}
	if err := p.insertCryptoTx(ctx, tx, txID, ref, "buy", q.ToAssetID, toAsset, syntheticQ, provRef, now); err != nil {
		return domain.SwapResult{}, &ExecError{Type: "internal", Message: "Failed to record swap transaction."}
	}
	if err := p.insertLedger(ctx, tx, txID,
		"user_crypto:"+fromAsset.Symbol, "user_crypto:"+toAsset.Symbol,
		q.FiatValue.Amount, q.FiatValue.Currency, "swap", ref, provRef,
	); err != nil {
		return domain.SwapResult{}, &ExecError{Type: "internal", Message: "Failed to write ledger."}
	}
	p.insertFees(ctx, tx, txID, []domain.Fee{{Type: "spread", Amount: q.Fee}})
	p.insertStatusEvents(ctx, tx, txID, []string{"QuoteAccepted", "Processing", "Filled"}, now)
	p.markQuoteConsumed(ctx, tx, q.ID)

	if err := tx.Commit(ctx); err != nil {
		return domain.SwapResult{}, &ExecError{Type: "internal", Message: "Failed to commit swap."}
	}

	return domain.SwapResult{
		ID: engine.NewID("so"), Reference: ref,
		FromSymbol: fromAsset.Symbol, ToSymbol: toAsset.Symbol,
		Status: "Filled", From: q.From, To: q.To, Fee: q.Fee,
		Provider: q.LiquidityProvider, ProviderReference: provRef,
		TransactionID: txID, CreatedAt: now,
	}, nil
}

// ── Transaction helpers (all require an open pgx.Tx) ─────────────────────────

// assetForTradeTx reads the asset inside a transaction (no FOR UPDATE — assets
// are admin-managed and only mutated by the admin service, not by user trades).
func (p *PgRepository) assetForTradeTx(ctx context.Context, tx pgx.Tx, assetID string) (domain.Asset, bool) {
	var a domain.Asset
	var priceAmt, minAmt, maxAmt int64
	var priceCur string
	err := tx.QueryRow(ctx, `
		SELECT id, symbol, status, buy_enabled, sell_enabled,
		       min_order_amount, max_order_amount,
		       price_amount, price_currency, icon_color
		FROM assets WHERE id=$1`, assetID,
	).Scan(
		&a.ID, &a.Symbol, &a.Status, &a.BuyEnabled, &a.SellEnabled,
		&minAmt, &maxAmt, &priceAmt, &priceCur, &a.IconColor,
	)
	if err != nil {
		return domain.Asset{}, false
	}
	a.MinOrderAmount = minAmt
	a.MaxOrderAmount = maxAmt
	a.Price = domain.Money{Amount: priceAmt, Currency: priceCur}
	return a, true
}

// positionTx returns (qty, costBasis, exists) for a user+asset, locking the
// row FOR UPDATE to prevent concurrent sell/swap races.
func (p *PgRepository) positionTx(ctx context.Context, tx pgx.Tx, assetID string) (int64, int64, bool) {
	var qty, cost int64
	err := tx.QueryRow(ctx,
		`SELECT qty_minor, cost_basis_minor FROM positions
		 WHERE user_id=$1 AND asset_id=$2 FOR UPDATE`,
		p.userID, assetID,
	).Scan(&qty, &cost)
	if err != nil {
		return 0, 0, false
	}
	return qty, cost, true
}

// investableBalanceTx computes the user's cash balance inside a transaction.
func (p *PgRepository) investableBalanceTx(ctx context.Context, tx pgx.Tx) int64 {
	const q = `
		SELECT
		  COALESCE(SUM(le.amount) FILTER (WHERE le.credit_account='user_cash'),0) -
		  COALESCE(SUM(le.amount) FILTER (WHERE le.debit_account='user_cash'),0)
		FROM ledger_entries le
		JOIN crypto_transactions ct ON ct.id = le.transaction_id
		WHERE ct.user_id=$1
		  AND (le.credit_account='user_cash' OR le.debit_account='user_cash')`
	var bal int64
	_ = tx.QueryRow(ctx, q, p.userID).Scan(&bal)
	return bal
}

// insertCryptoTx writes the main transaction row.
func (p *PgRepository) insertCryptoTx(
	ctx context.Context, tx pgx.Tx,
	txID, ref, side, assetID string,
	a domain.Asset,
	q domain.Quote,
	provRef, now string,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO crypto_transactions
		  (id, user_id, reference, side, asset_id, symbol, asset_name, icon_color,
		   status, fiat_amount, fiat_currency, crypto_amount,
		   all_in_rate_amount, total_fiat_amount,
		   provider, provider_reference,
		   liquidity_provider, custody_provider, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
		        'Filled',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
		txID, p.userID, ref, side, assetID, q.Symbol, a.Name, a.IconColor,
		q.Fiat.Amount, q.Fiat.Currency, q.Crypto.Amount,
		q.AllInRate.Amount, q.TotalFiat.Amount,
		q.LiquidityProvider, provRef,
		q.LiquidityProvider, "paymax-custody", now,
	)
	return err
}

// upsertPositionBuy adds qty+cost to an existing position (or creates one).
func (p *PgRepository) upsertPositionBuy(ctx context.Context, tx pgx.Tx, assetID string, qty, cost int64) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO positions (user_id, asset_id, qty_minor, cost_basis_minor)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (user_id, asset_id) DO UPDATE
		  SET qty_minor        = positions.qty_minor        + EXCLUDED.qty_minor,
		      cost_basis_minor = positions.cost_basis_minor + EXCLUDED.cost_basis_minor,
		      updated_at       = now()`,
		p.userID, assetID, qty, cost,
	)
	return err
}

// updatePositionSell reduces a position by qty and cost.
func (p *PgRepository) updatePositionSell(ctx context.Context, tx pgx.Tx, assetID string, qty, cost int64) error {
	_, err := tx.Exec(ctx, `
		UPDATE positions
		SET qty_minor        = qty_minor        - $3,
		    cost_basis_minor = cost_basis_minor - $4,
		    updated_at       = now()
		WHERE user_id=$1 AND asset_id=$2`,
		p.userID, assetID, qty, cost,
	)
	return err
}

// insertLedger writes one double-entry ledger row.
func (p *PgRepository) insertLedger(
	ctx context.Context, tx pgx.Tx,
	txID, debit, credit string, amount int64, currency, typ, ref, provRef string,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO ledger_entries
		  (id, transaction_id, debit_account, credit_account,
		   amount, currency, type, reference, provider_reference)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		engine.NewID("le"), txID, debit, credit, amount, currency, typ, ref, provRef,
	)
	return err
}

// insertFees writes fee rows for a transaction.
func (p *PgRepository) insertFees(ctx context.Context, tx pgx.Tx, txID string, fees []domain.Fee) {
	for _, f := range fees {
		_, _ = tx.Exec(ctx, `
			INSERT INTO crypto_transaction_fees (transaction_id, type, amount_minor, currency)
			VALUES ($1,$2,$3,$4)`,
			txID, f.Type, f.Amount.Amount, f.Amount.Currency,
		)
	}
}

// insertStatusEvents writes the state machine transition history for a transaction.
func (p *PgRepository) insertStatusEvents(ctx context.Context, tx pgx.Tx, txID string, statuses []string, at string) {
	t, _ := time.Parse(time.RFC3339, at)
	if t.IsZero() {
		t = time.Now().UTC()
	}
	for _, s := range statuses {
		_, _ = tx.Exec(ctx,
			`INSERT INTO crypto_transaction_status_events (transaction_id, status, at) VALUES ($1,$2,$3)`,
			txID, s, t,
		)
	}
}

// insertMovementTx writes a deposit/withdraw transaction row with an explicit
// status (deposits/withdrawals don't fit the 'Filled'-only insertCryptoTx path).
func (p *PgRepository) insertMovementTx(
	ctx context.Context, tx pgx.Tx,
	txID, ref, side, assetID, symbol, name, iconColor, status string,
	fiatValue, cryptoAmount, allInRate int64,
	provRef, now string,
) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO crypto_transactions
		  (id, user_id, reference, side, asset_id, symbol, asset_name, icon_color,
		   status, fiat_amount, fiat_currency, crypto_amount,
		   all_in_rate_amount, total_fiat_amount,
		   provider, provider_reference, liquidity_provider, custody_provider, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'NGN',$11,$12,$13,
		        'paymax-custody',$14,'paymax-liquidity','paymax-custody',$15)`,
		txID, p.userID, ref, side, assetID, symbol, name, iconColor,
		status, fiatValue, cryptoAmount, allInRate, fiatValue, provRef, now,
	)
	return err
}

// ── On-chain movements + status mutation (Repository additions) ───────────────

// UpdateTransactionStatus advances a transaction's status (e.g. from a webhook).
func (p *PgRepository) UpdateTransactionStatus(reference, status string) bool {
	ctx := context.Background()
	tx, err := p.db.Begin(ctx)
	if err != nil {
		return false
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	var id string
	if err := tx.QueryRow(ctx,
		`UPDATE crypto_transactions SET status=$1 WHERE reference=$2 AND user_id=$3 RETURNING id`,
		status, reference, p.userID,
	).Scan(&id); err != nil {
		return false
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO crypto_transaction_status_events (transaction_id, status, at) VALUES ($1,$2,now())`,
		id, status,
	); err != nil {
		return false
	}
	return tx.Commit(ctx) == nil
}

// RecordWithdrawal debits the holding and persists a pending-review withdrawal.
func (p *PgRepository) RecordWithdrawal(symbol, networkName, address string, cryptoAmount, networkFee, fiatValue int64) (domain.WithdrawalResult, *ExecError) {
	ctx := context.Background()
	tx, err := p.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return domain.WithdrawalResult{}, &ExecError{Type: "internal", Message: "Failed to start transaction."}
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var assetID, name, iconColor string
	var priceAmt int64
	if err := tx.QueryRow(ctx, `SELECT id, name, icon_color, price_amount FROM assets WHERE UPPER(symbol)=UPPER($1)`, symbol).
		Scan(&assetID, &name, &iconColor, &priceAmt); err != nil {
		return domain.WithdrawalResult{}, &ExecError{Type: "asset_unavailable", Message: "Asset not found."}
	}
	qty, cost, ok := p.positionTx(ctx, tx, assetID)
	if !ok || qty < cryptoAmount {
		return domain.WithdrawalResult{}, &ExecError{Type: "insufficient_balance", Message: "You don't hold enough to withdraw."}
	}
	var movedCost int64
	if qty > 0 {
		movedCost = int64(math.Round(float64(cost) * float64(cryptoAmount) / float64(qty)))
	}
	if err := p.updatePositionSell(ctx, tx, assetID, cryptoAmount, movedCost); err != nil {
		return domain.WithdrawalResult{}, &ExecError{Type: "internal", Message: "Failed to update position."}
	}

	txID := engine.NewID("cx")
	ref := engine.NewRef("PMX-WD")
	provRef := engine.NewRef("CU") + "-WD"
	now := engine.Now()
	if err := p.insertMovementTx(ctx, tx, txID, ref, "withdraw", assetID, symbol, name, iconColor, "WithdrawalPendingReview", fiatValue, cryptoAmount, priceAmt, provRef, now); err != nil {
		return domain.WithdrawalResult{}, &ExecError{Type: "internal", Message: "Failed to record withdrawal."}
	}
	if err := p.insertLedger(ctx, tx, txID, "user_crypto:"+symbol, "external:"+address, fiatValue, "NGN", "withdraw", ref, provRef); err != nil {
		return domain.WithdrawalResult{}, &ExecError{Type: "internal", Message: "Failed to write ledger."}
	}
	p.insertStatusEvents(ctx, tx, txID, []string{"WithdrawalPendingReview"}, now)
	if err := tx.Commit(ctx); err != nil {
		return domain.WithdrawalResult{}, &ExecError{Type: "internal", Message: "Failed to commit."}
	}

	return domain.WithdrawalResult{
		ID: engine.NewID("wd"), Reference: ref, Symbol: symbol, Status: "WithdrawalPendingReview",
		Amount: domain.CryptoAmount{Amount: cryptoAmount, Symbol: symbol}, NetworkFee: domain.CryptoAmount{Amount: networkFee, Symbol: symbol},
		Address: address, NetworkName: networkName, ProviderReference: provRef, EstimatedReviewMin: 30, CreatedAt: now,
	}, nil
}

// CreditDeposit credits the holding and persists a confirmed deposit.
func (p *PgRepository) CreditDeposit(symbol string, cryptoAmount, fiatValue int64, providerRef string) (domain.TxDetail, *ExecError) {
	ctx := context.Background()
	tx, err := p.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return domain.TxDetail{}, &ExecError{Type: "internal", Message: "Failed to start transaction."}
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var assetID, name, iconColor string
	var priceAmt int64
	if err := tx.QueryRow(ctx, `SELECT id, name, icon_color, price_amount FROM assets WHERE UPPER(symbol)=UPPER($1)`, symbol).
		Scan(&assetID, &name, &iconColor, &priceAmt); err != nil {
		return domain.TxDetail{}, &ExecError{Type: "asset_unavailable", Message: "Asset not found."}
	}
	if err := p.upsertPositionBuy(ctx, tx, assetID, cryptoAmount, fiatValue); err != nil {
		return domain.TxDetail{}, &ExecError{Type: "internal", Message: "Failed to update position."}
	}
	if providerRef == "" {
		providerRef = engine.NewRef("CU") + "-DP"
	}
	txID := engine.NewID("cx")
	ref := engine.NewRef("PMX-DP")
	now := engine.Now()
	if err := p.insertMovementTx(ctx, tx, txID, ref, "deposit", assetID, symbol, name, iconColor, "DepositConfirmed", fiatValue, cryptoAmount, priceAmt, providerRef, now); err != nil {
		return domain.TxDetail{}, &ExecError{Type: "internal", Message: "Failed to record deposit."}
	}
	if err := p.insertLedger(ctx, tx, txID, "external", "user_crypto:"+symbol, fiatValue, "NGN", "deposit", ref, providerRef); err != nil {
		return domain.TxDetail{}, &ExecError{Type: "internal", Message: "Failed to write ledger."}
	}
	p.insertStatusEvents(ctx, tx, txID, []string{"DepositDetected", "DepositConfirmed"}, now)
	if err := tx.Commit(ctx); err != nil {
		return domain.TxDetail{}, &ExecError{Type: "internal", Message: "Failed to commit."}
	}

	return domain.TxDetail{
		TxSummary: domain.TxSummary{
			ID: txID, Reference: ref, Side: "deposit", Symbol: symbol, AssetName: name, IconColor: iconColor,
			Status: "DepositConfirmed", Fiat: domain.Money{Amount: fiatValue, Currency: "NGN"},
			Crypto: domain.CryptoAmount{Amount: cryptoAmount, Symbol: symbol}, CreatedAt: now,
		},
		AllInRate: domain.Money{Amount: priceAmt, Currency: "NGN"}, Fees: []domain.Fee{}, TotalFiat: domain.Money{Amount: fiatValue, Currency: "NGN"},
		Provider: "paymax-custody", ProviderReference: providerRef, LiquidityProvider: "paymax-liquidity", CustodyProvider: "paymax-custody",
		StatusHistory: []domain.StatusEvent{{Status: "DepositDetected", At: now}, {Status: "DepositConfirmed", At: now}},
	}, nil
}

// ReverseWithdrawal re-credits a failed withdrawal's crypto and marks it failed.
func (p *PgRepository) ReverseWithdrawal(reference string) bool {
	ctx := context.Background()
	tx, err := p.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return false
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var id, symbol, status, assetID string
	var cryptoAmount, fiatValue int64
	if err := tx.QueryRow(ctx,
		`SELECT id, symbol, status, asset_id, crypto_amount, total_fiat_amount
		 FROM crypto_transactions
		 WHERE reference=$1 AND side='withdraw' AND user_id=$2 FOR UPDATE`,
		reference, p.userID,
	).Scan(&id, &symbol, &status, &assetID, &cryptoAmount, &fiatValue); err != nil {
		return false
	}
	if status == "WithdrawalFailed" || status == "WithdrawalConfirmed" {
		return false // terminal already
	}
	if err := p.upsertPositionBuy(ctx, tx, assetID, cryptoAmount, fiatValue); err != nil {
		return false
	}
	if _, err := tx.Exec(ctx, `UPDATE crypto_transactions SET status='WithdrawalFailed' WHERE id=$1`, id); err != nil {
		return false
	}
	if err := p.insertLedger(ctx, tx, id, "external:reversal", "user_crypto:"+symbol, fiatValue, "NGN", "reversal", reference, ""); err != nil {
		return false
	}
	p.insertStatusEvents(ctx, tx, id, []string{"WithdrawalFailed"}, engine.Now())
	return tx.Commit(ctx) == nil
}
