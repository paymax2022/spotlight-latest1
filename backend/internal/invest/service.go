package invest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// PINVerifier validates the user's confirmation factor before an order. The
// real implementation hooks into the platform security service; the mock
// accepts any 4–6 digit numeric PIN so the flow is exercisable end-to-end.
type PINVerifier interface {
	Verify(ctx context.Context, userID, pin string) error
}

// MockPINVerifier accepts any 4–6 digit numeric PIN. Replace in production.
type MockPINVerifier struct{}

func (MockPINVerifier) Verify(ctx context.Context, userID, pin string) error {
	pin = strings.TrimSpace(pin)
	if len(pin) < 4 || len(pin) > 6 {
		return ErrInvalidPIN
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return ErrInvalidPIN
		}
	}
	return nil
}

// Service is the invest module's business logic.
type Service struct {
	db         *pgxpool.Pool
	repo       *Repository
	il         *InvestLedger
	mainLedger *ledger.Service // main Paymax wallet (funding source/destination)
	broker     BrokerAdapter
	market     MarketDataAdapter
	offers     PublicOfferAdapter
	pin        PINVerifier
	notifier   Notifier
	fees       FeeSchedule
	now        func() time.Time
}

// NewService builds the invest service. mainLedger funds/defunds the invest
// wallet from the user's main Paymax wallet (double-entry on both sides).
func NewService(db *pgxpool.Pool, mainLedger *ledger.Service, broker BrokerAdapter, market MarketDataAdapter, offers PublicOfferAdapter) *Service {
	return &Service{
		db:         db,
		repo:       NewRepository(db),
		il:         NewInvestLedger(db),
		mainLedger: mainLedger,
		broker:     broker,
		market:     market,
		offers:     offers,
		pin:        MockPINVerifier{},
		notifier:   LogNotifier{},
		fees:       DefaultFeeSchedule(),
		now:        time.Now,
	}
}

// Errors surfaced to handlers (mapped to HTTP codes there).
var (
	ErrInvalidPIN          = errors.New("invest: invalid PIN")
	ErrTradingDisabled     = errors.New("invest: stock trading not enabled for this account")
	ErrAssetUnavailable    = errors.New("invest: asset not available for trading")
	ErrKYCInsufficient     = errors.New("invest: KYC tier insufficient for this asset")
	ErrSuitabilityRequired = errors.New("invest: suitability assessment required")
	ErrTermsRequired       = errors.New("invest: active agreements must be accepted")
	ErrMarketClosed        = errors.New("invest: market is closed")
	ErrBelowMinimum        = errors.New("invest: order below minimum amount")
	ErrAboveMaximum        = errors.New("invest: order above maximum amount")
	ErrInvalidOrder        = errors.New("invest: invalid order parameters")
	ErrNotEligible         = errors.New("invest: account not eligible to trade")
)

// ── Onboarding / profile ─────────────────────────────────────────────────────

func (s *Service) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	p, err := s.repo.GetProfile(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		// Return a synthetic not-started profile (UX expects one).
		return &Profile{UserID: userID, Status: ProfileNotStarted, RiskCategory: RiskRestricted,
			Country: "NG", ResidencyCountry: "NG"}, nil
	}
	return p, err
}

// Start creates/advances the investor profile and ensures the broker account +
// default watchlist exist. Idempotent.
func (s *Service) Start(ctx context.Context, userID, country, residency string) (*Profile, error) {
	if country == "" {
		country = "NG"
	}
	if residency == "" {
		residency = country
	}
	p, err := s.repo.UpsertProfileStart(ctx, userID, country, residency)
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetOrCreateAccount(ctx, userID); err != nil {
		return nil, err
	}
	if _, err := s.repo.EnsureDefaultWatchlist(ctx, userID); err != nil {
		return nil, err
	}
	return p, nil
}

// Eligibility reports what the user still needs before they can trade.
func (s *Service) Eligibility(ctx context.Context, userID string) (map[string]any, error) {
	p, err := s.GetProfile(ctx, userID)
	if err != nil {
		return nil, err
	}
	termsOK, err := s.repo.AllActiveAgreementsAccepted(ctx, userID)
	if err != nil {
		return nil, err
	}
	_, _, _, suitabilityDone, err := s.repo.LatestSuitability(ctx, userID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"kyc_tier":              p.KYCTier,
		"kyc_ok":                p.KYCTier >= 2,
		"terms_accepted":        termsOK,
		"suitability_complete":  suitabilityDone,
		"investment_enabled":    p.InvestmentEnabled,
		"stock_trading_enabled": p.StockTradingEnabled,
		"status":                p.Status,
		"can_trade":             p.StockTradingEnabled && p.KYCTier >= 2 && termsOK && suitabilityDone && p.Status == ProfileApproved,
	}, nil
}

func (s *Service) Agreements(ctx context.Context, userID string) ([]Agreement, error) {
	return s.repo.ActiveAgreements(ctx, userID)
}

func (s *Service) AcceptAgreements(ctx context.Context, userID string) error {
	if err := s.repo.AcceptAllActiveAgreements(ctx, userID); err != nil {
		return err
	}
	return s.refreshProfileGates(ctx, userID)
}

// ── Suitability ──────────────────────────────────────────────────────────────

// SuitabilityQuestions returns the static questionnaire (config-driven; the
// client must never hard-code scoring).
func (s *Service) SuitabilityQuestions() []map[string]any {
	return suitabilityQuestions
}

func (s *Service) SubmitSuitability(ctx context.Context, userID string, answers map[string]int) (map[string]any, error) {
	score := 0
	for _, q := range suitabilityQuestions {
		id := q["id"].(string)
		if v, ok := answers[id]; ok {
			score += v
		}
	}
	cat := scoreToCategory(score)
	raw, _ := json.Marshal(answers)
	id, err := s.repo.InsertSuitability(ctx, userID, raw, score, cat)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateProfileFields(ctx, userID, map[string]any{
		"suitability_profile_id": id,
		"risk_category":          string(cat),
	}); err != nil {
		return nil, err
	}
	if err := s.refreshProfileGates(ctx, userID); err != nil {
		return nil, err
	}
	return map[string]any{"suitability_profile_id": id, "score": score, "risk_category": cat,
		"eligibility": categoryEligibility(cat)}, nil
}

func (s *Service) SuitabilityResult(ctx context.Context, userID string) (map[string]any, error) {
	id, score, cat, ok, err := s.repo.LatestSuitability(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	return map[string]any{"suitability_profile_id": id, "score": score, "risk_category": cat,
		"eligibility": categoryEligibility(RiskCategory(cat))}, nil
}

// refreshProfileGates recomputes whether the profile can be marked approved and
// trading-enabled, based on KYC + terms + suitability. Fail-closed.
func (s *Service) refreshProfileGates(ctx context.Context, userID string) error {
	p, err := s.repo.GetProfile(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	termsOK, err := s.repo.AllActiveAgreementsAccepted(ctx, userID)
	if err != nil {
		return err
	}
	_, _, _, suitabilityDone, err := s.repo.LatestSuitability(ctx, userID)
	if err != nil {
		return err
	}
	fields := map[string]any{}
	approved := termsOK && suitabilityDone && p.KYCTier >= 1
	tradingOK := termsOK && suitabilityDone && p.KYCTier >= 2
	fields["investment_enabled"] = approved
	fields["stock_trading_enabled"] = tradingOK
	switch {
	case tradingOK || approved:
		fields["status"] = string(ProfileApproved)
	case !suitabilityDone:
		fields["status"] = string(ProfileSuitabilityReq)
	case !termsOK:
		fields["status"] = string(ProfileTermsRequired)
	default:
		fields["status"] = string(ProfileKYCRequired)
	}
	return s.repo.UpdateProfileFields(ctx, userID, fields)
}

// SetKYCTier is used by admin/KYC integration to lift a user's tier and re-gate.
func (s *Service) SetKYCTier(ctx context.Context, userID string, tier int) error {
	if _, err := s.repo.UpsertProfileStart(ctx, userID, "NG", "NG"); err != nil {
		return err
	}
	if err := s.repo.UpdateProfileFields(ctx, userID, map[string]any{"kyc_tier": tier}); err != nil {
		return err
	}
	return s.refreshProfileGates(ctx, userID)
}

// ── Stocks / discovery ───────────────────────────────────────────────────────

func (s *Service) ListStocks(ctx context.Context, query, sector string, limit, offset int) ([]StockWithQuote, error) {
	stocks, err := s.repo.ListStocks(ctx, query, sector, limit, offset)
	if err != nil {
		return nil, err
	}
	out := make([]StockWithQuote, 0, len(stocks))
	for _, st := range stocks {
		q, _ := s.market.GetQuote(ctx, st.providerSym())
		out = append(out, StockWithQuote{StockAsset: st, Quote: q})
	}
	return out, nil
}

func (s *Service) GetStock(ctx context.Context, symbol string) (*StockWithQuote, error) {
	st, err := s.repo.GetStockBySymbol(ctx, symbol)
	if err != nil {
		return nil, err
	}
	q, _ := s.market.GetQuote(ctx, st.providerSym())
	return &StockWithQuote{StockAsset: *st, Quote: q}, nil
}

func (s *Service) StockChart(ctx context.Context, symbol, rng string) ([]Candle, error) {
	st, err := s.repo.GetStockBySymbol(ctx, symbol)
	if err != nil {
		return nil, err
	}
	return s.market.GetHistorical(ctx, st.providerSym(), rng)
}

func (s *Service) Dividends(ctx context.Context, symbol string) ([]Dividend, error) {
	return s.repo.DividendsForSymbol(ctx, symbol)
}

func (s *Service) CorporateActions(ctx context.Context, symbol string) ([]CorporateAction, error) {
	return s.repo.CorporateActionsForSymbol(ctx, symbol)
}

func (s *Service) MarketStatus(ctx context.Context) (string, error) {
	return s.market.GetMarketStatus(ctx)
}

// ── Watchlists / alerts ──────────────────────────────────────────────────────

func (s *Service) Watchlists(ctx context.Context, userID string) ([]Watchlist, error) {
	if _, err := s.repo.EnsureDefaultWatchlist(ctx, userID); err != nil {
		return nil, err
	}
	return s.repo.ListWatchlists(ctx, userID)
}

func (s *Service) CreateWatchlist(ctx context.Context, userID, name string) (*Watchlist, error) {
	if name == "" {
		name = "Watchlist"
	}
	return s.repo.CreateWatchlist(ctx, userID, name)
}

func (s *Service) RenameWatchlist(ctx context.Context, userID, id, name string) error {
	return s.repo.RenameWatchlist(ctx, userID, id, name)
}

func (s *Service) DeleteWatchlist(ctx context.Context, userID, id string) error {
	return s.repo.DeleteWatchlist(ctx, userID, id)
}

func (s *Service) AddToWatchlist(ctx context.Context, userID, watchlistID, symbol string) error {
	st, err := s.repo.GetStockBySymbol(ctx, symbol)
	if err != nil {
		return err
	}
	return s.repo.AddWatchlistItem(ctx, userID, watchlistID, st.ID)
}

func (s *Service) RemoveFromWatchlist(ctx context.Context, userID, watchlistID, assetID string) error {
	return s.repo.RemoveWatchlistItem(ctx, userID, watchlistID, assetID)
}

func (s *Service) Alerts(ctx context.Context, userID string) ([]PriceAlert, error) {
	return s.repo.ListAlerts(ctx, userID)
}

func (s *Service) CreateAlert(ctx context.Context, userID, symbol, condition string, target int64) (*PriceAlert, error) {
	st, err := s.repo.GetStockBySymbol(ctx, symbol)
	if err != nil {
		return nil, err
	}
	switch condition {
	case "above", "below", "pct_gain", "pct_loss":
	default:
		return nil, ErrInvalidOrder
	}
	return s.repo.CreateAlert(ctx, userID, st.ID, st.Symbol, condition, target)
}

func (s *Service) UpdateAlert(ctx context.Context, userID, id, status string) error {
	return s.repo.UpdateAlertStatus(ctx, userID, id, status)
}

func (s *Service) DeleteAlert(ctx context.Context, userID, id string) error {
	return s.repo.DeleteAlert(ctx, userID, id)
}

// ── Wallet ───────────────────────────────────────────────────────────────────

func (s *Service) Wallet(ctx context.Context, userID string) (*WalletView, error) {
	cash, locked, settlement, err := s.il.Balances(ctx, userID)
	if err != nil {
		return nil, err
	}
	invested, _, err := s.investedAndGain(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &WalletView{
		Currency:              "NGN",
		AvailableCashKobo:     cash,
		LockedCashKobo:        locked,
		PendingSettlementKobo: settlement,
		InvestedValueKobo:     invested,
		TotalPortfolioKobo:    cash + locked + settlement + invested,
		WithdrawableCashKobo:  cash,
	}, nil
}

// Deposit funds the invest wallet from the main Paymax wallet (double-entry on
// both ledgers). Requires an idempotency key.
func (s *Service) Deposit(ctx context.Context, userID, idem string, amountKobo int64, source string) (*WalletView, error) {
	if amountKobo <= 0 {
		return nil, ErrInvalidOrder
	}
	if idem == "" {
		idem = fmt.Sprintf("invdep:%s:%d", userID, s.now().UnixNano())
	}
	// 1) Debit the main Paymax wallet → bridge standing account.
	bridge, err := s.mainLedger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, err
	}
	if err := s.mainLedger.Debit(ctx, userID, "invest:deposit", idem+":main", bridge.ID, amountKobo); err != nil {
		return nil, err // includes ErrInsufficientFunds / ErrDuplicate
	}
	// 2) Credit the invest cash wallet.
	if err := s.il.Deposit(ctx, userID, "invest:deposit", idem+":inv", amountKobo); err != nil {
		return nil, err
	}
	return s.Wallet(ctx, userID)
}

func (s *Service) Withdraw(ctx context.Context, userID, idem string, amountKobo int64, dest string) (*WalletView, error) {
	if amountKobo <= 0 {
		return nil, ErrInvalidOrder
	}
	if idem == "" {
		idem = fmt.Sprintf("invwd:%s:%d", userID, s.now().UnixNano())
	}
	// 1) Debit invest cash (re-checks balance inside tx).
	if err := s.il.Withdraw(ctx, userID, "invest:withdraw", idem+":inv", amountKobo); err != nil {
		return nil, err
	}
	// 2) Credit the main Paymax wallet from the bridge standing account.
	bridge, err := s.mainLedger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, err
	}
	if err := s.mainLedger.Credit(ctx, userID, "invest:withdraw", idem+":main", bridge.ID, amountKobo); err != nil {
		return nil, err
	}
	return s.Wallet(ctx, userID)
}

func (s *Service) WalletTransactions(ctx context.Context, userID string, limit, offset int) ([]map[string]any, error) {
	return s.il.Transactions(ctx, userID, limit, offset)
}

// ── Orders ───────────────────────────────────────────────────────────────────

// preTradeChecks runs the server-side gate that must pass before EVERY order.
func (s *Service) preTradeChecks(ctx context.Context, userID string, st *StockAsset, side OrderSide, orderType OrderType) error {
	p, err := s.repo.GetProfile(ctx, userID)
	if errors.Is(err, ErrNotFound) {
		return ErrNotEligible
	}
	if err != nil {
		return err
	}
	if p.Status == ProfileSuspended || p.Status == ProfileRestricted {
		return ErrNotEligible
	}
	if !p.StockTradingEnabled {
		return ErrTradingDisabled
	}
	if p.KYCTier < st.KYCTierRequired {
		return ErrKYCInsufficient
	}
	termsOK, err := s.repo.AllActiveAgreementsAccepted(ctx, userID)
	if err != nil {
		return err
	}
	if !termsOK {
		return ErrTermsRequired
	}
	if _, _, _, ok, err := s.repo.LatestSuitability(ctx, userID); err != nil {
		return err
	} else if !ok {
		return ErrSuitabilityRequired
	}
	if st.Status != "active" {
		return ErrAssetUnavailable
	}
	if side == SideBuy && !st.BuyEnabled {
		return ErrAssetUnavailable
	}
	if side == SideSell && !st.SellEnabled {
		return ErrAssetUnavailable
	}
	// Market orders require an open market; limit orders may rest.
	if orderType == TypeMarket {
		status, _ := s.market.GetMarketStatus(ctx)
		if status != "open" {
			return ErrMarketClosed
		}
	}
	return nil
}

// Buy executes the full buy pipeline: pre-check → lock cash → submit → ledger →
// portfolio → settlement queue. Idempotent on idem.
func (s *Service) Buy(ctx context.Context, userID, idem string, req BuyOrderRequest) (*Receipt, error) {
	if idem == "" {
		return nil, fmt.Errorf("%w: idempotency key required", ErrInvalidOrder)
	}
	if existing, err := s.repo.FindOrderByIdem(ctx, idem); err == nil {
		return &Receipt{Order: *existing, RiskDisclosure: riskDisclosure, SettlementNote: settlementNote(existing)}, nil
	}
	if req.OrderType == "" {
		req.OrderType = TypeMarket
	}
	if req.OrderType == TypeLimit && req.LimitPriceKobo <= 0 {
		return nil, fmt.Errorf("%w: limit price required", ErrInvalidOrder)
	}
	if req.AmountKobo <= 0 && req.Quantity <= 0 {
		return nil, fmt.Errorf("%w: amount or quantity required", ErrInvalidOrder)
	}
	st, err := s.repo.GetStockBySymbol(ctx, req.Symbol)
	if err != nil {
		return nil, err
	}
	if err := s.preTradeChecks(ctx, userID, st, SideBuy, req.OrderType); err != nil {
		return nil, err
	}
	if err := s.pin.Verify(ctx, userID, req.PIN); err != nil {
		return nil, err
	}

	quote, err := s.market.GetQuote(ctx, st.providerSym())
	if err != nil {
		return nil, err
	}
	priceForCalc := quote.PriceKobo
	if req.OrderType == TypeLimit {
		priceForCalc = req.LimitPriceKobo
	}
	if priceForCalc <= 0 {
		return nil, ErrInvalidOrder
	}
	// Resolve quantity & notional.
	var qty float64
	var notional int64
	if req.AmountKobo > 0 {
		notional = req.AmountKobo
		qty = float64(req.AmountKobo) / float64(priceForCalc)
	} else {
		qty = req.Quantity
		notional = int64(qty * float64(priceForCalc))
	}
	if notional < st.MinimumOrderAmount {
		return nil, ErrBelowMinimum
	}
	if st.MaximumOrderAmount > 0 && notional > st.MaximumOrderAmount {
		return nil, ErrAboveMaximum
	}
	fees := s.feeSchedule(ctx)
	fee := fees.FeeFor(notional)
	totalDebit := notional + fee

	acct, err := s.repo.GetOrCreateAccount(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Insert the order in PendingReview.
	o := &Order{
		UserID: userID, StockAssetID: st.ID, Symbol: st.Symbol, Side: SideBuy, OrderType: req.OrderType,
		AmountKobo: notional, Quantity: qty, LimitPriceKobo: req.LimitPriceKobo, EstimatedPriceKobo: priceForCalc,
		FeesKobo: fee, TotalAmountKobo: totalDebit, Status: StatusPendingReview, Provider: s.broker.Name(),
		IdempotencyKey: idem, investmentAccountID: acct.ID,
	}
	if err := s.repo.InsertOrder(ctx, o); err != nil {
		return nil, err
	}

	// PendingReview → AwaitingConfirmation (pre-checks already passed + PIN ok).
	if err := s.transition(ctx, o, StatusAwaitingConfirm, "pre-trade checks passed"); err != nil {
		return nil, err
	}

	// Lock cash = total debit. Fail-closed on insufficient funds.
	if err := s.il.LockCash(ctx, userID, "order:"+o.ID, "lock:"+idem, totalDebit); err != nil {
		s.fail(ctx, o, "cash lock failed: "+err.Error())
		return s.receipt(o), err
	}
	o.LockedCashKobo = totalDebit
	if err := s.transition(ctx, o, StatusCashLocked, "cash locked"); err != nil {
		return nil, err
	}

	// Submit to broker.
	if err := s.transition(ctx, o, StatusSubmitted, "submitted to broker"); err != nil {
		return nil, err
	}
	o.SubmittedAt = ptime(s.now())
	res, err := s.broker.SubmitBuyOrder(ctx, *o, quote)
	if err != nil || !res.Accepted {
		// Release locked cash, mark failed.
		_ = s.il.UnlockCash(ctx, userID, "order:"+o.ID, "unlock:"+idem, totalDebit)
		o.LockedCashKobo = 0
		reason := "broker rejected"
		if err != nil {
			reason = err.Error()
		} else if res.Reason != "" {
			reason = res.Reason
		}
		s.fail(ctx, o, reason)
		return s.receipt(o), ErrInvalidOrder
	}
	o.ProviderReference = res.ProviderReference
	if err := s.transition(ctx, o, StatusAccepted, "accepted by broker"); err != nil {
		return nil, err
	}

	if res.Status != "filled" {
		// Resting (limit) order — cash stays locked; no fill yet.
		s.repo.UpdateOrder(ctx, o, StatusAccepted, "resting limit order")
		return s.receipt(o), nil
	}

	// Filled: settle the buy ledger (locked → broker + fee, residual → cash).
	execPrice := res.ExecutedPriceKobo
	filledQty := res.FilledQuantity
	cost := int64(filledQty * float64(execPrice))
	feeFinal := fees.FeeFor(cost)
	// Conserve the locked amount exactly: principal + fee must never exceed the
	// cash we locked (float rounding could otherwise drive locked cash negative).
	if cost+feeFinal > totalDebit {
		cost = totalDebit - feeFinal
		if cost < 0 {
			cost = 0
			feeFinal = totalDebit
		}
	}
	o.ExecutedPriceKobo = execPrice
	o.FilledQuantity = filledQty
	o.FeesKobo = feeFinal
	o.FilledAt = ptime(s.now())
	if err := s.il.SettleBuy(ctx, userID, "order:"+o.ID, res.ProviderReference, "settlebuy:"+idem, cost, feeFinal, totalDebit); err != nil {
		return nil, err
	}
	o.LockedCashKobo = 0
	if err := s.transition(ctx, o, StatusFilled, "filled"); err != nil {
		return nil, err
	}

	// Filled → PendingSettlement (shares credited at T+N).
	due := s.now().Add(time.Duration(st.SettlementDays) * 24 * time.Hour)
	o.SettlementDueAt = &due
	if err := s.transition(ctx, o, StatusPendingSettlement, "awaiting T+"+itoa(st.SettlementDays)+" settlement"); err != nil {
		return nil, err
	}
	return s.receipt(o), nil
}

// Sell executes the full sell pipeline: pre-check → lock shares → submit →
// proceeds to pending settlement → settle. Idempotent on idem.
func (s *Service) Sell(ctx context.Context, userID, idem string, req SellOrderRequest) (*Receipt, error) {
	if idem == "" {
		return nil, fmt.Errorf("%w: idempotency key required", ErrInvalidOrder)
	}
	if existing, err := s.repo.FindOrderByIdem(ctx, idem); err == nil {
		return s.receipt(existing), nil
	}
	if req.Quantity <= 0 {
		return nil, fmt.Errorf("%w: quantity required", ErrInvalidOrder)
	}
	if req.OrderType == "" {
		req.OrderType = TypeMarket
	}
	st, err := s.repo.GetStockBySymbol(ctx, req.Symbol)
	if err != nil {
		return nil, err
	}
	if err := s.preTradeChecks(ctx, userID, st, SideSell, req.OrderType); err != nil {
		return nil, err
	}
	if err := s.pin.Verify(ctx, userID, req.PIN); err != nil {
		return nil, err
	}
	pos, err := s.repo.GetPosition(ctx, userID, st.ID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, ErrInsufficientShares
		}
		return nil, err
	}
	if pos.Quantity-pos.LockedQuantity < req.Quantity {
		return nil, ErrInsufficientShares
	}

	quote, err := s.market.GetQuote(ctx, st.providerSym())
	if err != nil {
		return nil, err
	}
	priceForCalc := quote.PriceKobo
	if req.OrderType == TypeLimit && req.LimitPriceKobo > 0 {
		priceForCalc = req.LimitPriceKobo
	}
	fees := s.feeSchedule(ctx)
	gross := int64(req.Quantity * float64(priceForCalc))
	fee := fees.FeeFor(gross)

	acct, err := s.repo.GetOrCreateAccount(ctx, userID)
	if err != nil {
		return nil, err
	}
	o := &Order{
		UserID: userID, StockAssetID: st.ID, Symbol: st.Symbol, Side: SideSell, OrderType: req.OrderType,
		Quantity: req.Quantity, LimitPriceKobo: req.LimitPriceKobo, EstimatedPriceKobo: priceForCalc,
		FeesKobo: fee, TotalAmountKobo: gross - fee, Status: StatusPendingReview, Provider: s.broker.Name(),
		IdempotencyKey: idem, investmentAccountID: acct.ID,
	}
	if err := s.repo.InsertOrder(ctx, o); err != nil {
		return nil, err
	}
	if err := s.transition(ctx, o, StatusAwaitingConfirm, "pre-trade checks passed"); err != nil {
		return nil, err
	}

	// Lock shares (fail-closed).
	if err := s.repo.LockShares(ctx, userID, st.ID, req.Quantity); err != nil {
		s.fail(ctx, o, "share lock failed: "+err.Error())
		return s.receipt(o), err
	}
	o.LockedQuantity = req.Quantity
	if err := s.transition(ctx, o, StatusCashLocked, "shares locked"); err != nil {
		return nil, err
	}
	if err := s.transition(ctx, o, StatusSubmitted, "submitted to broker"); err != nil {
		return nil, err
	}
	o.SubmittedAt = ptime(s.now())
	res, err := s.broker.SubmitSellOrder(ctx, *o, quote)
	if err != nil || !res.Accepted {
		_ = s.repo.UnlockShares(ctx, userID, st.ID, req.Quantity)
		o.LockedQuantity = 0
		reason := "broker rejected"
		if err != nil {
			reason = err.Error()
		}
		s.fail(ctx, o, reason)
		return s.receipt(o), ErrInvalidOrder
	}
	o.ProviderReference = res.ProviderReference
	if err := s.transition(ctx, o, StatusAccepted, "accepted by broker"); err != nil {
		return nil, err
	}
	if res.Status != "filled" {
		s.repo.UpdateOrder(ctx, o, StatusAccepted, "resting limit order")
		return s.receipt(o), nil
	}

	execPrice := res.ExecutedPriceKobo
	grossFinal := int64(res.FilledQuantity * float64(execPrice))
	feeFinal := fees.FeeFor(grossFinal)
	o.ExecutedPriceKobo = execPrice
	o.FilledQuantity = res.FilledQuantity
	o.FeesKobo = feeFinal
	o.TotalAmountKobo = grossFinal - feeFinal
	o.FilledAt = ptime(s.now())
	// Proceeds (net) → pending settlement; fee → fee income.
	if err := s.il.SellProceedsToPending(ctx, userID, "order:"+o.ID, res.ProviderReference, "sellpx:"+idem, grossFinal, feeFinal); err != nil {
		return nil, err
	}
	if err := s.transition(ctx, o, StatusFilled, "filled"); err != nil {
		return nil, err
	}
	due := s.now().Add(time.Duration(st.SettlementDays) * 24 * time.Hour)
	o.SettlementDueAt = &due
	if err := s.transition(ctx, o, StatusPendingSettlement, "cash pending settlement"); err != nil {
		return nil, err
	}
	return s.receipt(o), nil
}

func (s *Service) ListOrders(ctx context.Context, userID, status string, limit, offset int) ([]Order, error) {
	return s.repo.ListOrders(ctx, userID, status, limit, offset)
}

func (s *Service) GetOrder(ctx context.Context, userID, id string) (*Order, error) {
	return s.repo.GetOrder(ctx, userID, id)
}

// CancelOrder cancels a still-cancellable order and releases any locks.
func (s *Service) CancelOrder(ctx context.Context, userID, id string) (*Order, error) {
	o, err := s.repo.GetOrder(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	switch o.Status {
	case StatusAccepted, StatusSubmitted, StatusAwaitingConfirm, StatusCashLocked:
		// cancellable
	default:
		return nil, fmt.Errorf("%w: order not cancellable in status %s", ErrInvalidOrder, o.Status)
	}
	_ = s.broker.CancelOrder(ctx, o.ProviderReference)
	if o.Side == SideBuy && o.LockedCashKobo > 0 {
		_ = s.il.UnlockCash(ctx, userID, "order:"+o.ID, "cancel:"+o.IdempotencyKey, o.LockedCashKobo)
		o.LockedCashKobo = 0
	}
	if o.Side == SideSell && o.LockedQuantity > 0 {
		_ = s.repo.UnlockShares(ctx, userID, o.StockAssetID, o.LockedQuantity)
		o.LockedQuantity = 0
	}
	from := o.Status
	if !CanTransition(from, StatusCancelRequested) && !CanTransition(from, StatusCancelled) {
		return nil, fmt.Errorf("%w: cannot cancel", ErrInvalidOrder)
	}
	o.Status = StatusCancelled
	if err := s.repo.UpdateOrder(ctx, o, from, "cancelled by user"); err != nil {
		return nil, err
	}
	return o, nil
}

// ProcessDueSettlements advances PendingSettlement orders whose T+N has elapsed.
// Buy → credit shares to the position. Sell → release cash to available.
// Intended to be called by a scheduled job. Returns count processed.
func (s *Service) ProcessDueSettlements(ctx context.Context, batch int) (int, error) {
	if batch <= 0 {
		batch = 100
	}
	due, err := s.repo.DueSettlements(ctx, batch)
	if err != nil {
		return 0, err
	}
	count := 0
	for i := range due {
		o := &due[i]
		if o.Side == SideBuy {
			cost := int64(o.FilledQuantity * float64(o.ExecutedPriceKobo))
			if err := s.repo.AddToPosition(ctx, o.UserID, o.StockAssetID, o.Symbol, o.FilledQuantity, o.ExecutedPriceKobo); err != nil {
				continue
			}
			_ = cost
		} else {
			net := o.TotalAmountKobo
			if err := s.il.ReleaseSettlement(ctx, o.UserID, "settle:"+o.ID, "release:"+o.IdempotencyKey, net); err != nil {
				continue
			}
			if err := s.repo.ReducePosition(ctx, o.UserID, o.StockAssetID, o.FilledQuantity, net); err != nil {
				continue
			}
		}
		o.SettledAt = ptime(s.now())
		from := o.Status
		o.Status = StatusSettled
		if err := s.repo.UpdateOrder(ctx, o, from, "settled (T+N reached)"); err != nil {
			continue
		}
		count++
	}
	return count, nil
}

// ── Portfolio ────────────────────────────────────────────────────────────────

func (s *Service) Portfolio(ctx context.Context, userID string) (*PortfolioView, error) {
	positions, err := s.positionsWithMarks(ctx, userID)
	if err != nil {
		return nil, err
	}
	cash, locked, settlement, err := s.il.Balances(ctx, userID)
	if err != nil {
		return nil, err
	}
	var invested, gain int64
	for _, p := range positions {
		invested += p.MarketValueKobo
		gain += p.UnrealizedGainKobo
	}
	return &PortfolioView{
		TotalValueKobo:        cash + locked + settlement + invested,
		CashBalanceKobo:       cash,
		InvestedValueKobo:     invested,
		PendingSettlementKobo: settlement,
		TotalGainKobo:         gain,
		Positions:             positions,
	}, nil
}

func (s *Service) Positions(ctx context.Context, userID string) ([]Position, error) {
	return s.positionsWithMarks(ctx, userID)
}

func (s *Service) positionsWithMarks(ctx context.Context, userID string) ([]Position, error) {
	positions, err := s.repo.ListPositions(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range positions {
		st, err := s.repo.GetStockByID(ctx, positions[i].StockAssetID)
		if err != nil {
			continue
		}
		q, _ := s.market.GetQuote(ctx, st.providerSym())
		positions[i].CurrentPriceKobo = q.PriceKobo
		positions[i].MarketValueKobo = int64(positions[i].Quantity * float64(q.PriceKobo))
		positions[i].UnrealizedGainKobo = positions[i].MarketValueKobo - int64(positions[i].Quantity*float64(positions[i].AverageCostKobo))
	}
	return positions, nil
}

func (s *Service) investedAndGain(ctx context.Context, userID string) (invested, gain int64, err error) {
	positions, err := s.positionsWithMarks(ctx, userID)
	if err != nil {
		return 0, 0, err
	}
	for _, p := range positions {
		invested += p.MarketValueKobo
		gain += p.UnrealizedGainKobo
	}
	return invested, gain, nil
}

// ── Public offers / rights issues ────────────────────────────────────────────

func (s *Service) PublicOffers(ctx context.Context) ([]PublicOffer, error) {
	return s.repo.ListPublicOffers(ctx)
}

func (s *Service) PublicOffer(ctx context.Context, id string) (*PublicOffer, error) {
	return s.repo.GetPublicOffer(ctx, id)
}

func (s *Service) ApplyPublicOffer(ctx context.Context, userID, idem, offerID string, amountKobo int64) (*PublicOfferApplication, error) {
	if idem == "" {
		return nil, fmt.Errorf("%w: idempotency key required", ErrInvalidOrder)
	}
	offer, err := s.repo.GetPublicOffer(ctx, offerID)
	if err != nil {
		return nil, err
	}
	if offer.Status != "open" && offer.Status != "closing_soon" {
		return nil, fmt.Errorf("%w: offer not open", ErrInvalidOrder)
	}
	if amountKobo < offer.MinimumSubKobo {
		return nil, ErrBelowMinimum
	}
	p, err := s.repo.GetProfile(ctx, userID)
	if err != nil || !p.PublicOfferEnabled {
		return nil, ErrNotEligible
	}
	// Debit invest cash for the subscription (held until allotment/refund).
	if err := s.il.Withdraw(ctx, userID, "public_offer:"+offerID, "po:"+idem, amountKobo); err != nil {
		return nil, err
	}
	providerRef, _ := s.offers.SubmitApplication(ctx, *offer, userID, amountKobo, idem)
	app, err := s.repo.InsertPublicOfferApplication(ctx, offerID, userID, idem, providerRef, amountKobo)
	if err != nil {
		return nil, err
	}
	return app, nil
}

func (s *Service) PublicOfferApplications(ctx context.Context, userID string) ([]PublicOfferApplication, error) {
	return s.repo.ListPublicOfferApplications(ctx, userID)
}

func (s *Service) RightsIssues(ctx context.Context) ([]RightsIssue, error) {
	return s.repo.ListRightsIssues(ctx)
}

func (s *Service) RightsIssue(ctx context.Context, id string) (*RightsIssue, error) {
	return s.repo.GetRightsIssue(ctx, id)
}

func (s *Service) AcceptRightsIssue(ctx context.Context, userID, idem, riID string, units float64) (*RightsIssueApplication, error) {
	if idem == "" {
		return nil, fmt.Errorf("%w: idempotency key required", ErrInvalidOrder)
	}
	ri, err := s.repo.GetRightsIssue(ctx, riID)
	if err != nil {
		return nil, err
	}
	if ri.Status != "open" && ri.Status != "closing_soon" {
		return nil, fmt.Errorf("%w: rights issue not open", ErrInvalidOrder)
	}
	p, err := s.repo.GetProfile(ctx, userID)
	if err != nil || !p.RightsIssueEnabled {
		return nil, ErrNotEligible
	}
	amount := int64(units * float64(ri.OfferPriceKobo))
	if err := s.il.Withdraw(ctx, userID, "rights_issue:"+riID, "ri:"+idem, amount); err != nil {
		return nil, err
	}
	return s.repo.InsertRightsApplication(ctx, riID, userID, idem, units, amount)
}

func (s *Service) RightsApplications(ctx context.Context, userID string) ([]RightsIssueApplication, error) {
	return s.repo.ListRightsApplications(ctx, userID)
}

// ── internal helpers ─────────────────────────────────────────────────────────

// transition validates and persists an order status change (records an event).
func (s *Service) transition(ctx context.Context, o *Order, to OrderStatus, note string) error {
	from := o.Status
	if !CanTransition(from, to) {
		return fmt.Errorf("invest: illegal transition %s→%s", from, to)
	}
	o.Status = to
	return s.repo.UpdateOrder(ctx, o, from, note)
}

// fail marks an order failed (best-effort; locks already released by caller).
func (s *Service) fail(ctx context.Context, o *Order, reason string) {
	from := o.Status
	o.FailureReason = reason
	if CanTransition(from, StatusFailed) {
		o.Status = StatusFailed
	} else {
		o.Status = StatusRejected
	}
	_ = s.repo.UpdateOrder(ctx, o, from, reason)
}

func (s *Service) receipt(o *Order) *Receipt {
	return &Receipt{Order: *o, RiskDisclosure: riskDisclosure, SettlementNote: settlementNote(o)}
}

// feeSchedule loads the admin-configurable fee schedule, falling back to the
// built-in default when no config row exists (fees are never hard-coded client-side).
func (s *Service) feeSchedule(ctx context.Context) FeeSchedule {
	fc, err := s.repo.GetFeeConfig(ctx)
	if err != nil {
		return s.fees
	}
	return FeeSchedule{CommissionBPS: fc.CommissionBPS, MinFeeKobo: fc.MinFeeKobo}
}

func (st StockAsset) providerSym() string {
	if st.ProviderSymbol != "" {
		return st.ProviderSymbol
	}
	return st.Symbol
}

func ptime(t time.Time) *time.Time { return &t }

func itoa(n int) string { return fmt.Sprintf("%d", n) }

func settlementNote(o *Order) string {
	if o.Side == SideBuy {
		return "Shares are credited to your portfolio after settlement (T+N). Cash is locked until then."
	}
	return "Sale proceeds become available cash after settlement (T+N)."
}

const riskDisclosure = "Stock prices can rise or fall. Past performance is not a guarantee of future results. " +
	"You may get back less than you invested. This is not financial advice."

// suitabilityQuestions is the static questionnaire (compliance.md). Each option
// carries a weight; the sum maps to a risk category.
var suitabilityQuestions = []map[string]any{
	{"id": "experience", "text": "How much experience do you have investing in stocks?",
		"options": []map[string]any{{"label": "None", "value": 0}, {"label": "Some", "value": 2}, {"label": "Experienced", "value": 4}}},
	{"id": "prices_fall", "text": "Do you understand that stock prices can fall and you may lose money?",
		"options": []map[string]any{{"label": "No", "value": 0}, {"label": "Yes", "value": 3}}},
	{"id": "objective", "text": "What is your main investment objective?",
		"options": []map[string]any{{"label": "Preserve capital", "value": 1}, {"label": "Balanced growth", "value": 2}, {"label": "Maximise growth", "value": 4}}},
	{"id": "horizon", "text": "How long do you plan to stay invested?",
		"options": []map[string]any{{"label": "< 1 year", "value": 1}, {"label": "1–5 years", "value": 2}, {"label": "5+ years", "value": 4}}},
	{"id": "drop_reaction", "text": "If your portfolio dropped 20%, what would you do?",
		"options": []map[string]any{{"label": "Sell everything", "value": 0}, {"label": "Hold", "value": 3}, {"label": "Buy more", "value": 4}}},
	{"id": "income_pct", "text": "What share of your income can you afford to invest?",
		"options": []map[string]any{{"label": "< 10%", "value": 1}, {"label": "10–30%", "value": 2}, {"label": "> 30%", "value": 3}}},
	{"id": "dividends", "text": "Do you understand dividends are not guaranteed?",
		"options": []map[string]any{{"label": "No", "value": 0}, {"label": "Yes", "value": 2}}},
	{"id": "no_guarantee", "text": "Do you acknowledge there are no guaranteed returns?",
		"options": []map[string]any{{"label": "No", "value": 0}, {"label": "Yes", "value": 2}}},
}

func scoreToCategory(score int) RiskCategory {
	switch {
	case score <= 4:
		return RiskRestricted
	case score <= 9:
		return RiskConservative
	case score <= 15:
		return RiskBalanced
	case score <= 20:
		return RiskGrowth
	default:
		return RiskAggressive
	}
}

func categoryEligibility(cat RiskCategory) []string {
	switch cat {
	case RiskConservative:
		return []string{"blue_chip_equities", "etfs", "education"}
	case RiskBalanced:
		return []string{"standard_equities", "etfs", "public_offers"}
	case RiskGrowth:
		return []string{"wider_equities", "etfs", "public_offers", "rights_issues"}
	case RiskAggressive:
		return []string{"all_equities", "etfs", "public_offers", "rights_issues"}
	default:
		return []string{"education_only"}
	}
}
