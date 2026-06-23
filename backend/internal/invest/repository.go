package invest

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is all non-ledger pgx data access for the invest module.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

var ErrNotFound = errors.New("invest: not found")

// ── Profile ──────────────────────────────────────────────────────────────────

func (r *Repository) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	const q = `SELECT id, user_id, kyc_tier, suitability_profile_id, risk_category, country,
		residency_country, investment_enabled, stock_trading_enabled, public_offer_enabled,
		rights_issue_enabled, status, created_at, updated_at
		FROM invest_profiles WHERE user_id=$1`
	var p Profile
	err := r.db.QueryRow(ctx, q, userID).Scan(&p.ID, &p.UserID, &p.KYCTier, &p.SuitabilityProfileID,
		&p.RiskCategory, &p.Country, &p.ResidencyCountry, &p.InvestmentEnabled, &p.StockTradingEnabled,
		&p.PublicOfferEnabled, &p.RightsIssueEnabled, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// UpsertProfileStart creates the profile (status=started) if absent; idempotent.
func (r *Repository) UpsertProfileStart(ctx context.Context, userID, country, residency string) (*Profile, error) {
	const q = `INSERT INTO invest_profiles (user_id, country, residency_country, status)
		VALUES ($1,$2,$3,'started')
		ON CONFLICT (user_id) DO UPDATE SET updated_at=now()
		RETURNING id, user_id, kyc_tier, suitability_profile_id, risk_category, country,
		residency_country, investment_enabled, stock_trading_enabled, public_offer_enabled,
		rights_issue_enabled, status, created_at, updated_at`
	var p Profile
	err := r.db.QueryRow(ctx, q, userID, country, residency).Scan(&p.ID, &p.UserID, &p.KYCTier,
		&p.SuitabilityProfileID, &p.RiskCategory, &p.Country, &p.ResidencyCountry, &p.InvestmentEnabled,
		&p.StockTradingEnabled, &p.PublicOfferEnabled, &p.RightsIssueEnabled, &p.Status, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// UpdateProfileFields applies a partial update via a column→value map.
func (r *Repository) UpdateProfileFields(ctx context.Context, userID string, fields map[string]any) error {
	if len(fields) == 0 {
		return nil
	}
	sets := make([]string, 0, len(fields)+1)
	args := make([]any, 0, len(fields)+1)
	i := 1
	for col, val := range fields {
		sets = append(sets, fmt.Sprintf("%s=$%d", col, i))
		args = append(args, val)
		i++
	}
	sets = append(sets, "updated_at=now()")
	args = append(args, userID)
	q := fmt.Sprintf("UPDATE invest_profiles SET %s WHERE user_id=$%d", strings.Join(sets, ","), i)
	_, err := r.db.Exec(ctx, q, args...)
	return err
}

// ── Investment account ───────────────────────────────────────────────────────

func (r *Repository) GetOrCreateAccount(ctx context.Context, userID string) (*Account, error) {
	const sel = `SELECT id, user_id, account_number, broker_provider_id, broker_account_id,
		cscs_number, clearing_house_number, base_currency, status, created_at
		FROM invest_accounts WHERE user_id=$1 LIMIT 1`
	var a Account
	err := r.db.QueryRow(ctx, sel, userID).Scan(&a.ID, &a.UserID, &a.AccountNumber, &a.BrokerProviderID,
		&a.BrokerAccountID, &a.CSCSNumber, &a.ClearingHouseNumber, &a.BaseCurrency, &a.Status, &a.CreatedAt)
	if err == nil {
		return &a, nil
	}
	if err != pgx.ErrNoRows {
		return nil, err
	}
	acctNo := "INV" + fmt.Sprintf("%d", time.Now().UnixNano())[3:13]
	const ins = `INSERT INTO invest_accounts (user_id, account_number, status) VALUES ($1,$2,'active')
		RETURNING id, user_id, account_number, broker_provider_id, broker_account_id,
		cscs_number, clearing_house_number, base_currency, status, created_at`
	err = r.db.QueryRow(ctx, ins, userID, acctNo).Scan(&a.ID, &a.UserID, &a.AccountNumber, &a.BrokerProviderID,
		&a.BrokerAccountID, &a.CSCSNumber, &a.ClearingHouseNumber, &a.BaseCurrency, &a.Status, &a.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// ── Suitability ──────────────────────────────────────────────────────────────

func (r *Repository) InsertSuitability(ctx context.Context, userID string, answersJSON []byte, score int, cat RiskCategory) (string, error) {
	const q = `INSERT INTO invest_suitability_profiles (user_id, answers, score, risk_category, status, expires_at)
		VALUES ($1,$2,$3,$4,'active', now() + interval '365 days') RETURNING id`
	var id string
	err := r.db.QueryRow(ctx, q, userID, answersJSON, score, string(cat)).Scan(&id)
	return id, err
}

func (r *Repository) LatestSuitability(ctx context.Context, userID string) (id string, score int, cat string, found bool, err error) {
	const q = `SELECT id, score, risk_category FROM invest_suitability_profiles
		WHERE user_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`
	err = r.db.QueryRow(ctx, q, userID).Scan(&id, &score, &cat)
	if err == pgx.ErrNoRows {
		return "", 0, "", false, nil
	}
	if err != nil {
		return "", 0, "", false, err
	}
	return id, score, cat, true, nil
}

// ── Agreements ───────────────────────────────────────────────────────────────

func (r *Repository) ActiveAgreements(ctx context.Context, userID string) ([]Agreement, error) {
	const q = `SELECT a.key, a.title, a.version, COALESCE(a.body_url,''),
		(acc.id IS NOT NULL) AS accepted
		FROM invest_agreements a
		LEFT JOIN invest_agreement_acceptances acc
			ON acc.agreement_key=a.key AND acc.version=a.version AND acc.user_id=$1
		WHERE a.is_active=true ORDER BY a.key`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Agreement
	for rows.Next() {
		var a Agreement
		a.IsActive = true
		if err := rows.Scan(&a.Key, &a.Title, &a.Version, &a.BodyURL, &a.Accepted); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) AcceptAllActiveAgreements(ctx context.Context, userID string) error {
	const q = `INSERT INTO invest_agreement_acceptances (user_id, agreement_key, version)
		SELECT $1, key, version FROM invest_agreements WHERE is_active=true
		ON CONFLICT (user_id, agreement_key, version) DO NOTHING`
	_, err := r.db.Exec(ctx, q, userID)
	return err
}

func (r *Repository) AllActiveAgreementsAccepted(ctx context.Context, userID string) (bool, error) {
	const q = `SELECT COUNT(*) FROM invest_agreements a
		WHERE a.is_active=true AND NOT EXISTS (
			SELECT 1 FROM invest_agreement_acceptances acc
			WHERE acc.agreement_key=a.key AND acc.version=a.version AND acc.user_id=$1)`
	var missing int
	if err := r.db.QueryRow(ctx, q, userID).Scan(&missing); err != nil {
		return false, err
	}
	return missing == 0, nil
}

// ── Stocks ───────────────────────────────────────────────────────────────────

const stockCols = `id, symbol, name, exchange, COALESCE(sector,''), COALESCE(board,''),
	COALESCE(isin,''), asset_class, status, buy_enabled, sell_enabled, risk_rating,
	minimum_order_amount, maximum_order_amount, kyc_tier_required, country_availability,
	COALESCE(provider_symbol,''), COALESCE(logo_url,''), COALESCE(description,''), settlement_days`

func scanStock(row pgx.Row, s *StockAsset) error {
	return row.Scan(&s.ID, &s.Symbol, &s.Name, &s.Exchange, &s.Sector, &s.Board, &s.ISIN,
		&s.AssetClass, &s.Status, &s.BuyEnabled, &s.SellEnabled, &s.RiskRating, &s.MinimumOrderAmount,
		&s.MaximumOrderAmount, &s.KYCTierRequired, &s.CountryAvailability, &s.ProviderSymbol,
		&s.LogoURL, &s.Description, &s.SettlementDays)
}

func (r *Repository) ListStocks(ctx context.Context, query, sector string, limit, offset int) ([]StockAsset, error) {
	sb := strings.Builder{}
	sb.WriteString("SELECT " + stockCols + " FROM invest_stock_assets WHERE status<>'delisted'")
	args := []any{}
	i := 1
	if query != "" {
		sb.WriteString(fmt.Sprintf(" AND (symbol ILIKE $%d OR name ILIKE $%d)", i, i))
		args = append(args, "%"+query+"%")
		i++
	}
	if sector != "" {
		sb.WriteString(fmt.Sprintf(" AND sector=$%d", i))
		args = append(args, sector)
		i++
	}
	sb.WriteString(fmt.Sprintf(" ORDER BY symbol LIMIT $%d OFFSET $%d", i, i+1))
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []StockAsset
	for rows.Next() {
		var s StockAsset
		if err := scanStock(rows, &s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *Repository) GetStockBySymbol(ctx context.Context, symbol string) (*StockAsset, error) {
	const q = "SELECT " + stockCols + " FROM invest_stock_assets WHERE symbol=$1"
	var s StockAsset
	if err := scanStock(r.db.QueryRow(ctx, q, strings.ToUpper(symbol)), &s); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &s, nil
}

func (r *Repository) GetStockByID(ctx context.Context, id string) (*StockAsset, error) {
	const q = "SELECT " + stockCols + " FROM invest_stock_assets WHERE id=$1"
	var s StockAsset
	if err := scanStock(r.db.QueryRow(ctx, q, id), &s); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &s, nil
}

// ── Watchlists ───────────────────────────────────────────────────────────────

func (r *Repository) EnsureDefaultWatchlist(ctx context.Context, userID string) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, `SELECT id FROM invest_watchlists WHERE user_id=$1 AND is_default=true LIMIT 1`, userID).Scan(&id)
	if err == nil {
		return id, nil
	}
	if err != pgx.ErrNoRows {
		return "", err
	}
	err = r.db.QueryRow(ctx, `INSERT INTO invest_watchlists (user_id, name, is_default) VALUES ($1,'My Watchlist',true) RETURNING id`, userID).Scan(&id)
	return id, err
}

func (r *Repository) ListWatchlists(ctx context.Context, userID string) ([]Watchlist, error) {
	rows, err := r.db.Query(ctx, `SELECT id, user_id, name, is_default, created_at FROM invest_watchlists WHERE user_id=$1 ORDER BY is_default DESC, created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var lists []Watchlist
	for rows.Next() {
		var w Watchlist
		if err := rows.Scan(&w.ID, &w.UserID, &w.Name, &w.IsDefault, &w.CreatedAt); err != nil {
			return nil, err
		}
		lists = append(lists, w)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range lists {
		items, err := r.WatchlistItems(ctx, lists[i].ID)
		if err != nil {
			return nil, err
		}
		lists[i].Items = items
	}
	return lists, nil
}

func (r *Repository) WatchlistItems(ctx context.Context, watchlistID string) ([]WatchlistItem, error) {
	rows, err := r.db.Query(ctx, `SELECT i.id, i.stock_asset_id, s.symbol, i.created_at
		FROM invest_watchlist_items i JOIN invest_stock_assets s ON s.id=i.stock_asset_id
		WHERE i.watchlist_id=$1 ORDER BY i.created_at`, watchlistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WatchlistItem{}
	for rows.Next() {
		var it WatchlistItem
		if err := rows.Scan(&it.ID, &it.StockAssetID, &it.Symbol, &it.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func (r *Repository) CreateWatchlist(ctx context.Context, userID, name string) (*Watchlist, error) {
	var w Watchlist
	err := r.db.QueryRow(ctx, `INSERT INTO invest_watchlists (user_id, name) VALUES ($1,$2)
		RETURNING id, user_id, name, is_default, created_at`, userID, name).
		Scan(&w.ID, &w.UserID, &w.Name, &w.IsDefault, &w.CreatedAt)
	return &w, err
}

func (r *Repository) RenameWatchlist(ctx context.Context, userID, id, name string) error {
	ct, err := r.db.Exec(ctx, `UPDATE invest_watchlists SET name=$1, updated_at=now() WHERE id=$2 AND user_id=$3`, name, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) DeleteWatchlist(ctx context.Context, userID, id string) error {
	ct, err := r.db.Exec(ctx, `DELETE FROM invest_watchlists WHERE id=$1 AND user_id=$2 AND is_default=false`, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) AddWatchlistItem(ctx context.Context, userID, watchlistID, assetID string) error {
	// ownership check
	var owner string
	if err := r.db.QueryRow(ctx, `SELECT user_id FROM invest_watchlists WHERE id=$1`, watchlistID).Scan(&owner); err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	if owner != userID {
		return ErrNotFound
	}
	_, err := r.db.Exec(ctx, `INSERT INTO invest_watchlist_items (watchlist_id, stock_asset_id)
		VALUES ($1,$2) ON CONFLICT DO NOTHING`, watchlistID, assetID)
	return err
}

func (r *Repository) RemoveWatchlistItem(ctx context.Context, userID, watchlistID, assetID string) error {
	const q = `DELETE FROM invest_watchlist_items i USING invest_watchlists w
		WHERE i.watchlist_id=w.id AND w.user_id=$1 AND i.watchlist_id=$2 AND i.stock_asset_id=$3`
	_, err := r.db.Exec(ctx, q, userID, watchlistID, assetID)
	return err
}

// ── Price alerts ─────────────────────────────────────────────────────────────

func (r *Repository) ListAlerts(ctx context.Context, userID string) ([]PriceAlert, error) {
	rows, err := r.db.Query(ctx, `SELECT id, user_id, stock_asset_id, symbol, condition, target_price_kobo, status, triggered_at, created_at
		FROM invest_price_alerts WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PriceAlert{}
	for rows.Next() {
		var a PriceAlert
		if err := rows.Scan(&a.ID, &a.UserID, &a.StockAssetID, &a.Symbol, &a.Condition, &a.TargetPriceKobo, &a.Status, &a.TriggeredAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *Repository) CreateAlert(ctx context.Context, userID, assetID, symbol, condition string, target int64) (*PriceAlert, error) {
	var a PriceAlert
	err := r.db.QueryRow(ctx, `INSERT INTO invest_price_alerts (user_id, stock_asset_id, symbol, condition, target_price_kobo)
		VALUES ($1,$2,$3,$4,$5) RETURNING id, user_id, stock_asset_id, symbol, condition, target_price_kobo, status, triggered_at, created_at`,
		userID, assetID, symbol, condition, target).
		Scan(&a.ID, &a.UserID, &a.StockAssetID, &a.Symbol, &a.Condition, &a.TargetPriceKobo, &a.Status, &a.TriggeredAt, &a.CreatedAt)
	return &a, err
}

func (r *Repository) UpdateAlertStatus(ctx context.Context, userID, id, status string) error {
	ct, err := r.db.Exec(ctx, `UPDATE invest_price_alerts SET status=$1 WHERE id=$2 AND user_id=$3`, status, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *Repository) DeleteAlert(ctx context.Context, userID, id string) error {
	ct, err := r.db.Exec(ctx, `DELETE FROM invest_price_alerts WHERE id=$1 AND user_id=$2`, id, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ── Orders ───────────────────────────────────────────────────────────────────

const orderCols = `id, user_id, stock_asset_id, symbol, side, order_type, amount_kobo, quantity,
	limit_price_kobo, estimated_price_kobo, executed_price_kobo, filled_quantity, fees_kobo,
	total_amount_kobo, locked_cash_kobo, locked_quantity, status, COALESCE(provider,''),
	COALESCE(provider_reference,''), idempotency_key, COALESCE(failure_reason,''),
	settlement_due_at, submitted_at, filled_at, settled_at, created_at, updated_at`

func scanOrder(row pgx.Row, o *Order) error {
	return row.Scan(&o.ID, &o.UserID, &o.StockAssetID, &o.Symbol, &o.Side, &o.OrderType, &o.AmountKobo,
		&o.Quantity, &o.LimitPriceKobo, &o.EstimatedPriceKobo, &o.ExecutedPriceKobo, &o.FilledQuantity,
		&o.FeesKobo, &o.TotalAmountKobo, &o.LockedCashKobo, &o.LockedQuantity, &o.Status, &o.Provider,
		&o.ProviderReference, &o.IdempotencyKey, &o.FailureReason, &o.SettlementDueAt, &o.SubmittedAt,
		&o.FilledAt, &o.SettledAt, &o.CreatedAt, &o.UpdatedAt)
}

// FindOrderByIdem returns an existing order for the idempotency key, if any.
func (r *Repository) FindOrderByIdem(ctx context.Context, idem string) (*Order, error) {
	var o Order
	err := scanOrder(r.db.QueryRow(ctx, "SELECT "+orderCols+" FROM invest_orders WHERE idempotency_key=$1", idem), &o)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (r *Repository) InsertOrder(ctx context.Context, o *Order) error {
	const q = `INSERT INTO invest_orders
		(user_id, investment_account_id, stock_asset_id, symbol, side, order_type, amount_kobo, quantity,
		 limit_price_kobo, estimated_price_kobo, fees_kobo, total_amount_kobo, status, provider, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		RETURNING id, created_at, updated_at`
	var acctID any
	if o.investmentAccountID != "" {
		acctID = o.investmentAccountID
	}
	return r.db.QueryRow(ctx, q, o.UserID, acctID, o.StockAssetID, o.Symbol, o.Side, o.OrderType,
		o.AmountKobo, o.Quantity, o.LimitPriceKobo, o.EstimatedPriceKobo, o.FeesKobo, o.TotalAmountKobo,
		o.Status, o.Provider, o.IdempotencyKey).Scan(&o.ID, &o.CreatedAt, &o.UpdatedAt)
}

// UpdateOrder persists mutable order fields and appends a status event when the
// status changed. Callers must have validated the transition already.
func (r *Repository) UpdateOrder(ctx context.Context, o *Order, fromStatus OrderStatus, note string) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	const q = `UPDATE invest_orders SET status=$1, executed_price_kobo=$2, filled_quantity=$3,
		fees_kobo=$4, total_amount_kobo=$5, locked_cash_kobo=$6, locked_quantity=$7,
		provider_reference=$8, failure_reason=$9, settlement_due_at=$10, submitted_at=$11,
		filled_at=$12, settled_at=$13, updated_at=now() WHERE id=$14`
	_, err = tx.Exec(ctx, q, o.Status, o.ExecutedPriceKobo, o.FilledQuantity, o.FeesKobo, o.TotalAmountKobo,
		o.LockedCashKobo, o.LockedQuantity, nullStr(o.ProviderReference), nullStr(o.FailureReason),
		o.SettlementDueAt, o.SubmittedAt, o.FilledAt, o.SettledAt, o.ID)
	if err != nil {
		return err
	}
	if fromStatus != o.Status {
		if _, err := tx.Exec(ctx, `INSERT INTO invest_order_events (order_id, from_status, to_status, note)
			VALUES ($1,$2,$3,$4)`, o.ID, string(fromStatus), string(o.Status), note); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) ListOrders(ctx context.Context, userID, status string, limit, offset int) ([]Order, error) {
	sb := strings.Builder{}
	sb.WriteString("SELECT " + orderCols + " FROM invest_orders WHERE user_id=$1")
	args := []any{userID}
	i := 2
	if status != "" {
		sb.WriteString(fmt.Sprintf(" AND status=$%d", i))
		args = append(args, status)
		i++
	}
	sb.WriteString(fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", i, i+1))
	args = append(args, limit, offset)
	rows, err := r.db.Query(ctx, sb.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		var o Order
		if err := scanOrder(rows, &o); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *Repository) GetOrder(ctx context.Context, userID, id string) (*Order, error) {
	var o Order
	err := scanOrder(r.db.QueryRow(ctx, "SELECT "+orderCols+" FROM invest_orders WHERE id=$1 AND user_id=$2", id, userID), &o)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// DueSettlements returns orders whose settlement window has elapsed.
func (r *Repository) DueSettlements(ctx context.Context, limit int) ([]Order, error) {
	const q = "SELECT " + orderCols + ` FROM invest_orders
		WHERE status='PendingSettlement' AND settlement_due_at IS NOT NULL AND settlement_due_at <= now()
		ORDER BY settlement_due_at LIMIT $1`
	rows, err := r.db.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Order{}
	for rows.Next() {
		var o Order
		if err := scanOrder(rows, &o); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// ── Positions ────────────────────────────────────────────────────────────────

func (r *Repository) ListPositions(ctx context.Context, userID string) ([]Position, error) {
	rows, err := r.db.Query(ctx, `SELECT id, user_id, stock_asset_id, symbol, quantity, locked_quantity,
		average_cost_kobo, realized_gain_kobo, updated_at FROM invest_positions
		WHERE user_id=$1 AND quantity > 0 ORDER BY symbol`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Position{}
	for rows.Next() {
		var p Position
		if err := rows.Scan(&p.ID, &p.UserID, &p.StockAssetID, &p.Symbol, &p.Quantity, &p.LockedQuantity,
			&p.AverageCostKobo, &p.RealizedGainKobo, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.AvailableQty = p.Quantity - p.LockedQuantity
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) GetPosition(ctx context.Context, userID, assetID string) (*Position, error) {
	var p Position
	err := r.db.QueryRow(ctx, `SELECT id, user_id, stock_asset_id, symbol, quantity, locked_quantity,
		average_cost_kobo, realized_gain_kobo, updated_at FROM invest_positions
		WHERE user_id=$1 AND stock_asset_id=$2`, userID, assetID).
		Scan(&p.ID, &p.UserID, &p.StockAssetID, &p.Symbol, &p.Quantity, &p.LockedQuantity,
			&p.AverageCostKobo, &p.RealizedGainKobo, &p.UpdatedAt)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	p.AvailableQty = p.Quantity - p.LockedQuantity
	return &p, nil
}

// AddToPosition credits shares on a settled buy and recomputes weighted avg cost.
func (r *Repository) AddToPosition(ctx context.Context, userID, assetID, symbol string, qty float64, costKobo int64) error {
	const q = `INSERT INTO invest_positions (user_id, stock_asset_id, symbol, quantity, average_cost_kobo)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (user_id, stock_asset_id) DO UPDATE SET
			average_cost_kobo = CASE WHEN (invest_positions.quantity + EXCLUDED.quantity) > 0 THEN
				((invest_positions.quantity * invest_positions.average_cost_kobo) + (EXCLUDED.quantity * EXCLUDED.average_cost_kobo))
				/ (invest_positions.quantity + EXCLUDED.quantity)
				ELSE invest_positions.average_cost_kobo END,
			quantity = invest_positions.quantity + EXCLUDED.quantity,
			updated_at = now()`
	_, err := r.db.Exec(ctx, q, userID, assetID, symbol, qty, costKobo)
	return err
}

// LockShares increases locked_quantity for a pending sell (fail-closed).
func (r *Repository) LockShares(ctx context.Context, userID, assetID string, qty float64) error {
	const q = `UPDATE invest_positions SET locked_quantity = locked_quantity + $3, updated_at=now()
		WHERE user_id=$1 AND stock_asset_id=$2 AND (quantity - locked_quantity) >= $3`
	ct, err := r.db.Exec(ctx, q, userID, assetID, qty)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrInsufficientShares
	}
	return nil
}

// UnlockShares releases a share lock (failed/cancelled sell).
func (r *Repository) UnlockShares(ctx context.Context, userID, assetID string, qty float64) error {
	_, err := r.db.Exec(ctx, `UPDATE invest_positions SET locked_quantity = GREATEST(locked_quantity - $3,0), updated_at=now()
		WHERE user_id=$1 AND stock_asset_id=$2`, userID, assetID, qty)
	return err
}

// ReducePosition removes settled-out shares on a sell and books realized P/L.
func (r *Repository) ReducePosition(ctx context.Context, userID, assetID string, qty float64, proceedsKobo int64) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var quantity float64
	var avg int64
	if err := tx.QueryRow(ctx, `SELECT quantity, average_cost_kobo FROM invest_positions
		WHERE user_id=$1 AND stock_asset_id=$2 FOR UPDATE`, userID, assetID).Scan(&quantity, &avg); err != nil {
		return err
	}
	realized := proceedsKobo - int64(qty*float64(avg))
	const q = `UPDATE invest_positions SET quantity = GREATEST(quantity - $3,0),
		locked_quantity = GREATEST(locked_quantity - $3,0),
		realized_gain_kobo = realized_gain_kobo + $4, updated_at=now()
		WHERE user_id=$1 AND stock_asset_id=$2`
	if _, err := tx.Exec(ctx, q, userID, assetID, qty, realized); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── Dividends & corporate actions (read) ─────────────────────────────────────

func (r *Repository) DividendsForSymbol(ctx context.Context, symbol string) ([]Dividend, error) {
	rows, err := r.db.Query(ctx, `SELECT id, stock_asset_id, symbol, amount_per_share_kobo, currency,
		ex_date::text, record_date::text, payment_date::text, status, COALESCE(source,'')
		FROM invest_dividends WHERE symbol=$1 ORDER BY payment_date DESC NULLS LAST`, strings.ToUpper(symbol))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Dividend{}
	for rows.Next() {
		var d Dividend
		if err := rows.Scan(&d.ID, &d.StockAssetID, &d.Symbol, &d.AmountPerShareKobo, &d.Currency,
			&d.ExDate, &d.RecordDate, &d.PaymentDate, &d.Status, &d.Source); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (r *Repository) CorporateActionsForSymbol(ctx context.Context, symbol string) ([]CorporateAction, error) {
	rows, err := r.db.Query(ctx, `SELECT id, stock_asset_id, symbol, type, title, COALESCE(description,''),
		effective_date::text, record_date::text, payment_date::text, status, COALESCE(source,'')
		FROM invest_corporate_actions WHERE symbol=$1 ORDER BY effective_date DESC NULLS LAST`, strings.ToUpper(symbol))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CorporateAction{}
	for rows.Next() {
		var c CorporateAction
		if err := rows.Scan(&c.ID, &c.StockAssetID, &c.Symbol, &c.Type, &c.Title, &c.Description,
			&c.EffectiveDate, &c.RecordDate, &c.PaymentDate, &c.Status, &c.Source); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ── Public offers ────────────────────────────────────────────────────────────

func (r *Repository) ListPublicOffers(ctx context.Context) ([]PublicOffer, error) {
	rows, err := r.db.Query(ctx, `SELECT id, issuer_name, COALESCE(symbol,''), offer_price_kobo,
		minimum_subscription_kobo, opening_date::text, closing_date::text, COALESCE(prospectus_url,''), status
		FROM invest_public_offers WHERE status<>'cancelled' ORDER BY opening_date DESC NULLS LAST`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PublicOffer{}
	for rows.Next() {
		var o PublicOffer
		if err := rows.Scan(&o.ID, &o.IssuerName, &o.Symbol, &o.OfferPriceKobo, &o.MinimumSubKobo,
			&o.OpeningDate, &o.ClosingDate, &o.ProspectusURL, &o.Status); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *Repository) GetPublicOffer(ctx context.Context, id string) (*PublicOffer, error) {
	var o PublicOffer
	err := r.db.QueryRow(ctx, `SELECT id, issuer_name, COALESCE(symbol,''), offer_price_kobo,
		minimum_subscription_kobo, opening_date::text, closing_date::text, COALESCE(prospectus_url,''), status
		FROM invest_public_offers WHERE id=$1`, id).Scan(&o.ID, &o.IssuerName, &o.Symbol, &o.OfferPriceKobo,
		&o.MinimumSubKobo, &o.OpeningDate, &o.ClosingDate, &o.ProspectusURL, &o.Status)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

func (r *Repository) InsertPublicOfferApplication(ctx context.Context, offerID, userID, idem, providerRef string, amount int64) (*PublicOfferApplication, error) {
	var a PublicOfferApplication
	err := r.db.QueryRow(ctx, `INSERT INTO invest_public_offer_applications
		(public_offer_id, user_id, amount_kobo, status, idempotency_key) VALUES ($1,$2,$3,'submitted',$4)
		RETURNING id, public_offer_id, user_id, amount_kobo, status, allotted_kobo, refund_kobo, created_at`,
		offerID, userID, amount, idem).Scan(&a.ID, &a.PublicOfferID, &a.UserID, &a.AmountKobo, &a.Status,
		&a.AllottedKobo, &a.RefundKobo, &a.CreatedAt)
	return &a, err
}

func (r *Repository) ListPublicOfferApplications(ctx context.Context, userID string) ([]PublicOfferApplication, error) {
	rows, err := r.db.Query(ctx, `SELECT id, public_offer_id, user_id, amount_kobo, status, allotted_kobo, refund_kobo, created_at
		FROM invest_public_offer_applications WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PublicOfferApplication{}
	for rows.Next() {
		var a PublicOfferApplication
		if err := rows.Scan(&a.ID, &a.PublicOfferID, &a.UserID, &a.AmountKobo, &a.Status, &a.AllottedKobo, &a.RefundKobo, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ── Rights issues ────────────────────────────────────────────────────────────

func (r *Repository) ListRightsIssues(ctx context.Context) ([]RightsIssue, error) {
	rows, err := r.db.Query(ctx, `SELECT id, issuer_name, COALESCE(symbol,''), COALESCE(ratio,''), offer_price_kobo,
		qualification_date::text, opening_date::text, closing_date::text, status
		FROM invest_rights_issues ORDER BY opening_date DESC NULLS LAST`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RightsIssue{}
	for rows.Next() {
		var ri RightsIssue
		if err := rows.Scan(&ri.ID, &ri.IssuerName, &ri.Symbol, &ri.Ratio, &ri.OfferPriceKobo,
			&ri.QualificationDate, &ri.OpeningDate, &ri.ClosingDate, &ri.Status); err != nil {
			return nil, err
		}
		out = append(out, ri)
	}
	return out, rows.Err()
}

func (r *Repository) GetRightsIssue(ctx context.Context, id string) (*RightsIssue, error) {
	var ri RightsIssue
	err := r.db.QueryRow(ctx, `SELECT id, issuer_name, COALESCE(symbol,''), COALESCE(ratio,''), offer_price_kobo,
		qualification_date::text, opening_date::text, closing_date::text, status
		FROM invest_rights_issues WHERE id=$1`, id).Scan(&ri.ID, &ri.IssuerName, &ri.Symbol, &ri.Ratio,
		&ri.OfferPriceKobo, &ri.QualificationDate, &ri.OpeningDate, &ri.ClosingDate, &ri.Status)
	if err == pgx.ErrNoRows {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ri, nil
}

func (r *Repository) InsertRightsApplication(ctx context.Context, riID, userID, idem string, units float64, amount int64) (*RightsIssueApplication, error) {
	var a RightsIssueApplication
	err := r.db.QueryRow(ctx, `INSERT INTO invest_rights_issue_applications
		(rights_issue_id, user_id, accepted_units, amount_kobo, status, idempotency_key)
		VALUES ($1,$2,$3,$4,'accepted',$5)
		RETURNING id, rights_issue_id, user_id, accepted_units, amount_kobo, status, created_at`,
		riID, userID, units, amount, idem).Scan(&a.ID, &a.RightsIssueID, &a.UserID, &a.AcceptedUnits, &a.AmountKobo, &a.Status, &a.CreatedAt)
	return &a, err
}

func (r *Repository) ListRightsApplications(ctx context.Context, userID string) ([]RightsIssueApplication, error) {
	rows, err := r.db.Query(ctx, `SELECT id, rights_issue_id, user_id, accepted_units, amount_kobo, status, created_at
		FROM invest_rights_issue_applications WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RightsIssueApplication{}
	for rows.Next() {
		var a RightsIssueApplication
		if err := rows.Scan(&a.ID, &a.RightsIssueID, &a.UserID, &a.AcceptedUnits, &a.AmountKobo, &a.Status, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ── helpers ──────────────────────────────────────────────────────────────────

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

var ErrInsufficientShares = errors.New("invest: insufficient available shares")
