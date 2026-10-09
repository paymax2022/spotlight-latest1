package crypto

import (
	"context"
	"encoding/json"
	"errors"
	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// walletDebitLimiter is the minimal seam the crypto money path depends on for
// the fail-closed KYC-tier / daily-debit gate. *tiers.Service satisfies it in
// production; unit tests inject a fake via WithTiers. Modeled as a local
// interface — mirrors social's walletDebitLimiter — so the package never
// depends on more of tiers than this one method. Every gated crypto debit is a
// wallet DEBIT (buy cash leg, swap buy+spread legs, withdrawal fee), so the
// STRICT gate is used: these move cash out of the wallet, not a checkout
// purchase, so the Tier-0 checkout allowance (ADR-043) does NOT apply here.
type walletDebitLimiter interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// ErrTierGateUnwired is returned when a Service has no tier gate — a nil gate
// must fail CLOSED, never debit ungated (mirrors social.ErrTierGateUnwired).
var ErrTierGateUnwired = errors.New("crypto: money path requires a tier gate (not wired)")

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
	tiers    walletDebitLimiter
}

// NewService builds the crypto service. If price is nil the deterministic
// MockPriceProvider is used (mock-first, no network). The tier-limit gate is
// constructed from the same pool (tiers.NewService needs only the DB), so no
// extra wiring is required at the call site — same convention as
// social.NewService. A nil pool leaves the gate nil, and enforceDebitLimit
// then fails closed via ErrTierGateUnwired.
func NewService(db *pgxpool.Pool, led *ledger.Service, price PriceProvider) *Service {
	if price == nil {
		price = NewMockPriceProvider()
	}
	s := &Service{
		db:       db,
		repo:     NewRepository(db),
		led:      led,
		price:    price,
		audit:    newAuditLogger(db),
		withdraw: NewMockWithdrawalProvider(),
	}
	if db != nil {
		s.tiers = tiers.NewService(db)
	}
	return s
}

// WithTiers injects a pre-configured tier gate (app-wiring / tests). A nil
// argument is ignored so an unwired injection can never strip the gate.
func (s *Service) WithTiers(t walletDebitLimiter) *Service {
	if t != nil {
		s.tiers = t
	}
	return s
}

// enforceDebitLimit is the fail-closed guard applied before EVERY crypto wallet
// debit (E2E-FIN-046): the same EnforceWalletDebitLimit the canonical transfer
// rail (finance/transfers) runs. Tier 0 → ErrWalletDisabled, over daily cap →
// ErrDailyLimitExceeded, gate/db errors refuse, and a missing gate refuses via
// ErrTierGateUnwired. The error is propagated UNWRAPPED so handlers map the
// tier sentinels to 403 via errors.Is.
func (s *Service) enforceDebitLimit(ctx context.Context, userID string, amountKobo int64) error {
	if s.tiers == nil {
		return ErrTierGateUnwired
	}
	return s.tiers.EnforceWalletDebitLimit(ctx, userID, amountKobo)
}

// WithWithdrawalProvider overrides the default mock on-chain broadcast seam with a real
// adapter (wiring-only, after construction). A nil provider is ignored so callers can
// pass a possibly-nil real adapter and safely keep the mock. Returns the service for
// chaining. Follows the module's mock-first, real-last convention.
func (s *Service) WithWithdrawalProvider(w WithdrawalProvider) *Service {
	if w != nil {
		s.withdraw = w
	}
	return s
}

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
	walletKey := idemKey + ":wallet"
	// Tier gate (fail-closed, E2E-FIN-046): a buy is a wallet debit, so it runs
	// the same EnforceWalletDebitLimit the transfer rail applies — Tier 0 and
	// over-daily-cap buyers are refused BEFORE money moves (zero ledger legs).
	// The gate is skipped only when this leg is already durably posted
	// (led.Posted): a replay of a completed buy must return the filled order,
	// not a fresh refusal — the ledger leg's own idempotency covers the debit
	// either way, and RecordFill below is ON CONFLICT-safe.
	if posted, err := s.led.Posted(ctx, walletKey); err != nil {
		return nil, err
	} else if !posted {
		if err := s.enforceDebitLimit(ctx, userID, cashKobo); err != nil {
			return nil, err
		}
	}
	escrow, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, err
	}
	if err := s.led.Debit(ctx, userID, o.Reference, walletKey, escrow.ID, cashKobo); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
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
	if err := s.led.Credit(ctx, userID, o.Reference, idemKey+":wallet", escrow.ID, cashKobo); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
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

// auditLogger writes immutable, append-only rows to crypto_audit_log. Every money
// mutation emits one (iron rule: emit an audit event on every money mutation).
type auditLogger struct {
	db *pgxpool.Pool
}

func newAuditLogger(db *pgxpool.Pool) *auditLogger { return &auditLogger{db: db} }

// log appends an audit row. oldVal/newVal may be nil. Returns the insert error so
// money paths can treat audit failure as fatal for critical mutations.
func (a *auditLogger) log(ctx context.Context, actorID, action, entityType, entityID, reason string, oldVal, newVal any) error {
	var oldJSON, newJSON []byte
	if oldVal != nil {
		oldJSON, _ = json.Marshal(oldVal)
	}
	if newVal != nil {
		newJSON, _ = json.Marshal(newVal)
	}
	const q = `
		INSERT INTO crypto_audit_log (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	_, err := a.db.Exec(ctx, q, actorID, action, entityType, dbutil.NullStr(entityID), oldJSON, newJSON, dbutil.NullStr(reason))
	return err
}
