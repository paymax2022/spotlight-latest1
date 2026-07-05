package crypto

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// Service is the crypto money-path orchestrator. It REUSES the finance ledger:
// a BUY debits the user's main wallet into the shared escrow standing account and
// credits the user's crypto holding (asset-unit projection); a SELL reverses.
// Every fill requires an Idempotency-Key, posts a balanced double-entry ledger
// pair, moves the holding atomically, snapshots the quote, and emits an audit
// event. All amounts are integer minor units (kobo for cash; asset minor units
// for holdings) — no float math anywhere.
type Service struct {
	db       *pgxpool.Pool
	repo     *Repository
	led      *ledger.Service
	price    PriceProvider
	audit    *auditLogger
	withdraw WithdrawalProvider // pluggable on-chain broadcast seam (mock default)
}

// NewService builds the crypto service. If price is nil the deterministic
// MockPriceProvider is used (mock-first, no network).
func NewService(db *pgxpool.Pool, led *ledger.Service, price PriceProvider) *Service {
	if price == nil {
		price = NewMockPriceProvider()
	}
	return &Service{
		db:       db,
		repo:     NewRepository(db),
		led:      led,
		price:    price,
		audit:    newAuditLogger(db),
		withdraw: NewMockWithdrawalProvider(),
	}
}

// ── Read paths ────────────────────────────────────────────────────────────────

// ListAssets returns the tradable catalogue (active only for members).
func (s *Service) ListAssets(ctx context.Context, activeOnly bool) ([]Asset, error) {
	return s.repo.ListAssets(ctx, activeOnly)
}

// Quote returns the current price for an asset (member read).
func (s *Service) Quote(ctx context.Context, assetID string) (*Quote, error) {
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	priceKobo, ok := s.price.PriceKobo(ctx, a.Symbol)
	if !ok || priceKobo <= 0 {
		return nil, ErrNotFound
	}
	return &Quote{
		AssetID: a.ID, Symbol: a.Symbol, PriceKobo: priceKobo,
		Source: s.price.Name(), AsOf: time.Now(),
	}, nil
}

// Holdings returns the user's positions marked at the latest quote (kobo).
func (s *Service) Holdings(ctx context.Context, userID string) ([]Holding, error) {
	hs, err := s.repo.Holdings(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Mark to market with integer arithmetic; missing price → ValueKobo 0.
	assets, err := s.repo.ListAssets(ctx, false)
	if err != nil {
		return nil, err
	}
	scaleBySymbol := map[string]int64{}
	for _, a := range assets {
		scaleBySymbol[a.Symbol] = a.MinorUnitScale
	}
	for i := range hs {
		if p, ok := s.price.PriceKobo(ctx, hs[i].Symbol); ok {
			hs[i].ValueKobo = cashForUnits(hs[i].Units, p, scaleBySymbol[hs[i].Symbol])
		}
	}
	return hs, nil
}

// Portfolio returns holdings plus a total marked value (kobo).
func (s *Service) Portfolio(ctx context.Context, userID string) (map[string]any, error) {
	hs, err := s.Holdings(ctx, userID)
	if err != nil {
		return nil, err
	}
	var total int64
	for _, h := range hs {
		total += h.ValueKobo
	}
	return map[string]any{"holdings": hs, "total_value_kobo": total}, nil
}

// Orders returns the user's order history.
func (s *Service) Orders(ctx context.Context, userID string, limit, offset int) ([]Order, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.OrdersForUser(ctx, userID, limit, offset)
}

// PriceHistory returns an asset's recorded price snapshots (chart series), newest
// first. The current live quote is prepended so an active asset always yields at
// least one point even before its first fill snapshot exists.
func (s *Service) PriceHistory(ctx context.Context, assetID string, limit int) ([]PricePoint, error) {
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	hist, err := s.repo.PriceHistory(ctx, assetID, limit)
	if err != nil {
		return nil, err
	}
	if p, ok := s.price.PriceKobo(ctx, a.Symbol); ok && p > 0 {
		now := PricePoint{PriceKobo: p, Source: s.price.Name(), AsOf: time.Now().UTC().Format(time.RFC3339)}
		hist = append([]PricePoint{now}, hist...)
	}
	return hist, nil
}

// GetOrder returns a single order owned by the caller (transaction detail).
func (s *Service) GetOrder(ctx context.Context, userID, orderID string) (*Order, error) {
	return s.repo.GetOrder(ctx, userID, orderID)
}

// ── Money paths ───────────────────────────────────────────────────────────────

// Buy spends cashKobo of the user's main wallet to acquire asset minor units at
// the current quote. Money flow: wallet DEBIT → escrow standing account (cash
// leg, finance ledger) + holding CREDIT (asset-unit leg). idemKey makes the whole
// flow replay-safe; a duplicate is a no-op (no second ledger post). Fail-closed:
// any error rolls back before the holding moves.
func (s *Service) Buy(ctx context.Context, userID, assetID string, cashKobo int64, idemKey string) (*Order, error) {
	if cashKobo <= 0 || idemKey == "" {
		return nil, ErrBadRequest
	}
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	if !a.IsActive {
		return nil, ErrAssetInactive
	}
	priceKobo, ok := s.price.PriceKobo(ctx, a.Symbol)
	if !ok || priceKobo <= 0 {
		return nil, ErrNotFound
	}
	units := unitsForCash(cashKobo, priceKobo, a.MinorUnitScale)
	if units <= 0 {
		return nil, ErrAmountTooSmall
	}

	o := Order{
		UserID: userID, AssetID: a.ID, Symbol: a.Symbol, Side: "buy",
		CashKobo: cashKobo, Units: units, PriceKobo: priceKobo,
		Reference: "crypto:buy:" + a.Symbol, idem: idemKey,
	}
	// 1) Cash leg FIRST (fail-closed): debit the main wallet into the shared escrow
	//    standing account. Insufficient funds / tier limits reject here before any
	//    holding moves. The ledger leg is idempotent on idemKey+":wallet" — a replay
	//    returns ErrDuplicate, which we treat as already-done.
	escrow, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	if err := s.led.Debit(ctx, userID, o.Reference, idemKey+":wallet", escrow.ID, cashKobo); err != nil && err != ledger.ErrDuplicate {
		return nil, err
	}
	// 2) Record the order + credit the holding projection atomically. ON CONFLICT
	//    on the idempotency key makes a replay a no-op (dup=true → holding untouched).
	orderID, _, err := s.repo.RecordFill(ctx, o, units)
	if err != nil {
		return nil, err
	}
	o.ID = orderID
	// 3) Snapshot the quote used + emit audit event (audit failure is fatal).
	_ = s.repo.InsertSnapshot(ctx, a.ID, priceKobo, s.price.Name())
	if err := s.audit.log(ctx, userID, "crypto.buy", "crypto_order", orderID, "",
		nil, map[string]any{"asset": a.Symbol, "cash_kobo": cashKobo, "units": units, "price_kobo": priceKobo}); err != nil {
		return nil, err
	}
	o.Status = "filled"
	return &o, nil
}

// Sell liquidates `units` asset minor units to the user's main wallet at the
// current quote. Money flow: holding DEBIT (asset-unit leg) + escrow standing
// account → wallet CREDIT (cash leg, finance ledger). Fail-closed on insufficient
// holdings (CHECK units >= 0 also guards the DB).
func (s *Service) Sell(ctx context.Context, userID, assetID string, units int64, idemKey string) (*Order, error) {
	if units <= 0 || idemKey == "" {
		return nil, ErrBadRequest
	}
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	priceKobo, ok := s.price.PriceKobo(ctx, a.Symbol)
	if !ok || priceKobo <= 0 {
		return nil, ErrNotFound
	}
	// Fail-closed holdings check before any movement.
	held, err := s.repo.HoldingUnits(ctx, userID, a.ID)
	if err != nil {
		return nil, err
	}
	if held < units {
		return nil, ErrInsufficient
	}
	cashKobo := cashForUnits(units, priceKobo, a.MinorUnitScale)
	if cashKobo <= 0 {
		return nil, ErrAmountTooSmall
	}

	o := Order{
		UserID: userID, AssetID: a.ID, Symbol: a.Symbol, Side: "sell",
		CashKobo: cashKobo, Units: units, PriceKobo: priceKobo,
		Reference: "crypto:sell:" + a.Symbol, idem: idemKey,
	}
	// 1) Asset leg FIRST: record the order + decrement the holding projection
	//    atomically. CHECK (units >= 0) fail-closes an oversell at the DB. A replay
	//    is a no-op (dup=true → holding untouched).
	orderID, dup, err := s.repo.RecordFill(ctx, o, -units)
	if err != nil {
		return nil, err
	}
	o.ID = orderID
	// 2) Cash leg: credit the main wallet from the shared escrow standing account.
	//    Idempotent on idemKey+":wallet"; on a replay both legs are already done.
	escrow, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	if err := s.led.Credit(ctx, userID, o.Reference, idemKey+":wallet", escrow.ID, cashKobo); err != nil && err != ledger.ErrDuplicate {
		return nil, err
	}
	if dup {
		o.Status = "filled"
		return &o, nil
	}
	// 3) Snapshot + audit.
	_ = s.repo.InsertSnapshot(ctx, a.ID, priceKobo, s.price.Name())
	if err := s.audit.log(ctx, userID, "crypto.sell", "crypto_order", orderID, "",
		nil, map[string]any{"asset": a.Symbol, "cash_kobo": cashKobo, "units": units, "price_kobo": priceKobo}); err != nil {
		return nil, err
	}
	o.Status = "filled"
	return &o, nil
}

// ── Admin paths ──────────────────────────────────────────────────────────────

// AdminListOrders returns all orders (oversight).
func (s *Service) AdminListOrders(ctx context.Context, limit, offset int) ([]Order, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.AllOrders(ctx, limit, offset)
}

// AdminConfigAsset creates/updates a catalogue asset and audits the change.
func (s *Service) AdminConfigAsset(ctx context.Context, actorID, symbol, name string, minorUnitScale int64, isActive bool) (*Asset, error) {
	if symbol == "" || name == "" || minorUnitScale <= 0 {
		return nil, ErrBadRequest
	}
	a, err := s.repo.UpsertAsset(ctx, symbol, name, minorUnitScale, isActive)
	if err != nil {
		return nil, err
	}
	_ = s.audit.log(ctx, actorID, "crypto.asset.config", "crypto_asset", a.ID, "",
		nil, map[string]any{"symbol": symbol, "minor_unit_scale": minorUnitScale, "is_active": isActive})
	return a, nil
}
