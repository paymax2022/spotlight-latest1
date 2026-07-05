package orchestration

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Service is the orchestration engine: quote aggregation, smart order routing,
// rate-lock, execution, failover, and ledger postings (spec §2, §3, §5, §6).
type Service struct {
	providers map[string]Provider
	order     []Provider
	spread    *SpreadEngine
	router    *Router
	treasury  *Treasury
	book      QuoteStore
	store     Store
	emitter   *WebhookEmitter
	screener  ComplianceScreener
	now       func() time.Time
}

// Options configures the Service.
type Options struct {
	Spread     *SpreadEngine
	Router     *Router
	Treasury   *Treasury
	QuoteStore QuoteStore         // optional; defaults to in-memory QuoteBook
	Screener   ComplianceScreener // optional; defaults to AllowAllScreener (no-op)
	LockWindow time.Duration
	Now        func() time.Time
}

// NewService builds the orchestrator from a provider set, a store, and options.
func NewService(providers []Provider, store Store, opts Options) *Service {
	if opts.Spread == nil {
		opts.Spread = NewSpreadEngine(105) // 1.05% default
	}
	if opts.Router == nil {
		opts.Router = NewRouter(DefaultWeights)
	}
	if opts.Treasury == nil {
		opts.Treasury = NewTreasury(nil)
	}
	if opts.LockWindow == 0 {
		opts.LockWindow = 90 * time.Second
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.QuoteStore == nil {
		opts.QuoteStore = NewQuoteBook(opts.LockWindow)
	}
	if opts.Screener == nil {
		opts.Screener = AllowAllScreener{} // fail-open default until a vendor is injected
	}
	m := map[string]Provider{}
	for _, p := range providers {
		m[p.Name()] = p
	}
	return &Service{
		providers: m, order: providers,
		spread: opts.Spread, router: opts.Router, treasury: opts.Treasury,
		book: opts.QuoteStore, store: store, screener: opts.Screener, now: opts.Now,
	}
}

func newID(prefix string) string { return prefix + "_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12] }

func defaultRail(intent Intent) Rail {
	switch intent {
	case IntentConversion:
		return RailWallet
	case IntentCollection:
		return RailIBAN
	default:
		return RailBankTransfer
	}
}

func feeAmount(fees []Fee, t FeeType) int64 {
	for _, f := range fees {
		if f.Type == t {
			return f.Amount.AmountMinor
		}
	}
	return 0
}

// CreateQuote aggregates provider quotes, scores routes, and returns the best
// route plus alternatives with an itemized fee breakdown (spec §5.2, §6, §9).
func (s *Service) CreateQuote(ctx context.Context, customerID, tier string, req QuoteRequest) (*Quote, *APIError) {
	source, dest := strings.ToUpper(req.Source), strings.ToUpper(req.Destination)
	if !SupportedCurrency(source) || !SupportedCurrency(dest) {
		return nil, NewError(ErrInvalidRequest, "unsupported_currency", "One or both currencies are not supported.")
	}
	if source == dest {
		return nil, NewError(ErrInvalidRequest, "same_currency", "Source and destination must differ for a quote.")
	}
	amountType := req.AmountType
	if amountType == "" {
		amountType = AmountSource
	}
	rail := req.DestinationRail
	if rail == "" {
		rail = defaultRail(req.Intent)
	}
	corridor := Corridor(source, dest)

	// 0. Compliance screening (KYC/AML/sanctions) is a first-class, server-side
	//    gate: a blocked or errored screen returns compliance_block and we do NOT
	//    price the request. Fail-closed on screener error.
	if apiErr := s.screen(ctx, customerID, corridor, req.Amount); apiErr != nil {
		return nil, apiErr
	}

	// 1. Fan out to provider adapters (parallel in production; sequential is fine
	//    for deterministic adapters).
	type scored struct {
		pq   *ProviderQuote
		rate float64 // customer all-in rate post spread
	}
	pqs := map[string]scored{}
	maxRate := 0.0
	for _, p := range s.order {
		pq, err := p.Quote(ctx, source, dest, req.Amount, amountType, rail)
		if err != nil || pq == nil || !pq.Viable || pq.Rate == 0 {
			continue
		}
		rate := s.spread.CustomerRate(pq.Rate, corridor, tier)
		pqs[p.Name()] = scored{pq: pq, rate: rate}
		if rate > maxRate {
			maxRate = rate
		}
	}
	if len(pqs) == 0 {
		return nil, NewError(ErrRoutingUnavailable, "routing_unavailable", "No provider can route "+corridor+" right now.")
	}

	// 2. Build candidates with scoring inputs.
	estDestOf := func(rate float64) int64 {
		if amountType == AmountSource {
			return applyRate(req.Amount, rate)
		}
		return req.Amount // destination-pegged
	}
	var candidates []Candidate
	for name, sc := range pqs {
		destEst := estDestOf(sc.rate)
		coverable, liq := s.settleConfidence(name, dest, destEst)
		var exposurePenalty float64
		if !coverable {
			exposurePenalty = 1 // hard-penalise breaching exposure
		}
		candidates = append(candidates, Candidate{
			Provider:    name,
			Corridor:    corridor,
			Rail:        rail,
			AllInRate:   sc.rate,
			Destination: NewMoney(destEst, dest),
			Cost:        costCompetitiveness(sc.rate, maxRate),
			CoverageFit: 1,
			Liquidity:   liq,
			Reliability: sc.pq.Reliability,
			FloatCost:   0.02,
			ExposurePenalty: exposurePenalty,
			Viable:      coverable,
		})
	}

	rank := s.router.Rank(candidates)
	if rank.Best == nil {
		return nil, NewError(ErrRoutingUnavailable, "routing_unavailable", "No viable route within float/exposure limits for "+corridor+".")
	}
	best := rank.Best
	bestPQ := pqs[best.Provider].pq

	// 3. Resolve final amounts from amount_type using the chosen all-in rate.
	var srcAmt, destAmt int64
	if amountType == AmountSource {
		srcAmt = req.Amount
		destAmt = applyRate(srcAmt, best.AllInRate)
	} else {
		destAmt = req.Amount
		srcAmt = inverseAmount(destAmt, best.AllInRate)
	}

	// 4. Itemized fees (transparency, spec §9). Spread is the retained markup.
	spreadBPS := s.spread.EffectiveBPS(corridor, tier)
	fees := []Fee{
		{Type: FeeProvider, Amount: bestPQ.ProviderFee},
		{Type: FeeRail, Amount: bestPQ.RailFee},
		{Type: FeeSpread, Amount: NewMoney(bpsOf(srcAmt, spreadBPS), source)},
	}

	now := s.now()
	q := &Quote{
		ID:          newID("q"),
		CustomerID:  customerID,
		Status:      QuoteQuoted,
		AmountType:  amountType,
		Source:      NewMoney(srcAmt, source),
		Destination: NewMoney(destAmt, dest),
		Rate:        round4(MidRate(source, dest)),
		AllInRate:   round4(best.AllInRate),
		Fees:        fees,
		Route:       Route{Provider: best.Provider, Corridor: corridor, Rail: rail},
		Alternatives: buildAlternatives(rank.Alternatives),
		Locked:      req.Lock,
		Intent:      req.Intent,
		ExpiresAt:   now.Add(s.book.LockWindow()),
		CreatedAt:   now,
	}
	if req.Lock {
		q.Status = QuoteLocked
	}
	s.book.Put(q)
	_ = s.store.SaveQuote(ctx, q)
	return q, nil
}

// settleConfidence reports whether a provider can settle the dest amount and a
// liquidity-confidence score. Missing buckets are treated as rebalanceable.
func (s *Service) settleConfidence(provider, currency string, amountMinor int64) (bool, float64) {
	if !s.treasury.hasBucket(provider, currency) {
		return true, 0.6 // rebalanceable within window; moderate confidence
	}
	return s.treasury.CanCover(provider, currency, amountMinor), s.treasury.liquidityConfidence(provider, currency, amountMinor)
}

func buildAlternatives(cs []Candidate) []Alternative {
	out := make([]Alternative, 0, len(cs))
	for _, c := range cs {
		out = append(out, Alternative{
			Provider: c.Provider, Corridor: c.Corridor, Rail: c.Rail,
			AllInRate: round4(c.AllInRate), Destination: c.Destination,
		})
	}
	return out
}

// LockQuote holds a quote's rate for the lock window (spec §5.8).
func (s *Service) LockQuote(ctx context.Context, customerID, quoteID string) (*Quote, *APIError) {
	q := s.book.Lock(quoteID, customerID, s.now())
	if q == nil {
		return nil, NewError(ErrInvalidRequest, "quote_not_found", "Quote not found.").WithParam("quote_id")
	}
	_ = s.store.SaveQuote(ctx, q)
	return q, nil
}

// ExecuteConversion executes a conversion against a quote (spec §5.3).
func (s *Service) ExecuteConversion(ctx context.Context, customerID, idemKey string, req ConversionRequest) (*Conversion, *APIError) {
	if idemKey == "" {
		return nil, NewError(ErrInvalidRequest, "missing_idempotency_key", "Idempotency-Key header is required.")
	}
	if existing, ok, _ := s.store.ConversionByIdem(ctx, idemKey); ok {
		return existing, nil // idempotent replay
	}
	q, apiErr := s.book.Consume(req.QuoteID, customerID, s.now())
	if apiErr != nil {
		return nil, apiErr
	}

	// Compliance gate (fail-closed) before any debit/execution. Defense-in-depth:
	// the quote was screened at creation, but we re-screen at execution so a
	// blocked/errored screen halts a held quote and nothing moves.
	if apiErr := s.screen(ctx, customerID, q.Route.Corridor, q.Source.AmountMinor); apiErr != nil {
		return nil, apiErr
	}

	sourceTotal := q.Source.AmountMinor + feeAmount(q.Fees, FeeProvider) + feeAmount(q.Fees, FeeRail)
	if bal, _ := s.store.Balance(ctx, customerID, q.Source.Currency); bal < sourceTotal {
		return nil, NewError(ErrInsufficientBalance, "insufficient_balance", "Insufficient "+q.Source.Currency+" balance.")
	}

	res, prov, apiErr := s.executeWithFailover(ctx, q, nil, idemKey)
	if apiErr != nil {
		return nil, apiErr
	}

	conv := &Conversion{
		ID: newID("cv"), Reference: "PMX-CV-" + shortRef(), CustomerID: customerID,
		Status: ConvSettled, Source: q.Source, Destination: q.Destination,
		Rate: q.Rate, AllInRate: q.AllInRate, Fees: q.Fees,
		Route: Route{Provider: prov, Corridor: q.Route.Corridor, Rail: q.Route.Rail},
		ProviderRef: res.ProviderRef, TransactionID: newID("tx"),
		IdempotencyKey: idemKey, CreatedAt: s.now(),
	}
	if err := s.store.ApplyConversion(ctx, conv, sourceTotal); err != nil {
		return nil, asAPIError(err)
	}
	s.treasury.Reserve(prov, q.Destination.Currency, q.Destination.AmountMinor)
	s.emit(ctx, "conversion.settled", conv)
	return conv, nil
}

// ExecuteTransfer executes a payout against a quote, optionally with embedded FX
// (spec §5.4). Same-currency transfers may omit the quote.
func (s *Service) ExecuteTransfer(ctx context.Context, customerID, idemKey string, req TransferRequest) (*Transfer, *APIError) {
	if idemKey == "" {
		return nil, NewError(ErrInvalidRequest, "missing_idempotency_key", "Idempotency-Key header is required.")
	}
	if existing, ok, _ := s.store.TransferByIdem(ctx, idemKey); ok {
		return existing, nil
	}
	if req.Destination == nil {
		return nil, NewError(ErrInvalidRequest, "missing_destination", "An inline destination is required.").WithParam("destination")
	}

	var q *Quote
	if req.QuoteID != "" {
		var apiErr *APIError
		q, apiErr = s.book.Consume(req.QuoteID, customerID, s.now())
		if apiErr != nil {
			return nil, apiErr
		}
	} else {
		// Same-currency payout: synthesize a 1:1 quote.
		if req.Amount == nil {
			return nil, NewError(ErrInvalidRequest, "missing_amount", "amount is required for a same-currency transfer.").WithParam("amount")
		}
		cur := strings.ToUpper(req.Amount.Currency)
		if !strings.EqualFold(cur, req.Destination.Currency) {
			return nil, NewError(ErrInvalidRequest, "quote_required", "A quote_id is required for cross-currency transfers.").WithParam("quote_id")
		}
		q = &Quote{
			Source: NewMoney(req.Amount.AmountMinor, cur), Destination: NewMoney(req.Amount.AmountMinor, cur),
			Rate: 1, AllInRate: 1, Route: Route{Provider: s.order[0].Name(), Corridor: Corridor(cur, cur), Rail: req.Destination.Rail},
			Fees: []Fee{{Type: FeeProvider, Amount: NewMoney(0, cur)}, {Type: FeeRail, Amount: NewMoney(0, cur)}},
			ExpiresAt: s.now().Add(s.book.LockWindow()),
		}
	}

	// Compliance gate (fail-closed) on the execution path. Cross-currency
	// transfers were screened at quote time, but same-currency transfers
	// synthesize their quote here and would otherwise bypass screening — so we
	// screen unconditionally before any balance debit or provider execution. A
	// blocked/errored screen returns compliance_block and nothing moves.
	if apiErr := s.screen(ctx, customerID, q.Route.Corridor, q.Source.AmountMinor); apiErr != nil {
		return nil, apiErr
	}

	sourceTotal := q.Source.AmountMinor + feeAmount(q.Fees, FeeProvider) + feeAmount(q.Fees, FeeRail)
	if bal, _ := s.store.Balance(ctx, customerID, q.Source.Currency); bal < sourceTotal {
		return nil, NewError(ErrInsufficientBalance, "insufficient_balance", "Insufficient "+q.Source.Currency+" balance.")
	}

	res, prov, apiErr := s.executeWithFailover(ctx, q, req.Destination, idemKey)
	if apiErr != nil {
		return nil, apiErr
	}

	now := s.now()
	status := TransferProcessing
	if res.Status == "paid" {
		status = TransferPaid
	}
	tr := &Transfer{
		ID: newID("tr"), Reference: "PMX-TR-" + shortRef(), CustomerID: customerID,
		Status: status, Source: q.Source, Destination: q.Destination,
		QuotedRate: q.Rate, ExecutedRate: res.ExecutedRate, Fees: q.Fees,
		Route: Route{Provider: prov, Corridor: q.Route.Corridor, Rail: q.Route.Rail},
		Narration: req.Narration, ProviderRef: res.ProviderRef, TransactionID: newID("tx"),
		StatusHistory: []StatusEvent{{Status: "queued", At: now}, {Status: string(status), At: now}},
		IdempotencyKey: idemKey, CreatedAt: now,
	}
	if err := s.store.ApplyTransfer(ctx, tr, sourceTotal); err != nil {
		return nil, asAPIError(err)
	}
	s.treasury.Reserve(prov, q.Destination.Currency, q.Destination.AmountMinor)
	s.emit(ctx, "transfer."+string(status), tr)
	return tr, nil
}

// executeWithFailover runs the chosen provider, retrying the next-best alternative
// on provider error within the locked tolerance (spec §5.8). Never double-spends:
// the ledger debit happens once, after a provider success, in the caller.
func (s *Service) executeWithFailover(ctx context.Context, q *Quote, dest *Destination, idemKey string) (*ExecuteResult, string, *APIError) {
	order := []string{q.Route.Provider}
	for _, a := range q.Alternatives {
		order = append(order, a.Provider)
	}
	var lastErr error
	for _, name := range order {
		p, ok := s.providers[name]
		if !ok {
			continue
		}
		var res *ExecuteResult
		var err error
		if dest == nil {
			res, err = p.ExecuteConversion(ctx, q, idemKey)
		} else {
			res, err = p.ExecuteTransfer(ctx, q, *dest, idemKey)
		}
		if err == nil && res != nil {
			return res, name, nil
		}
		lastErr = err
	}
	msg := "Provider execution failed."
	if lastErr != nil {
		msg = lastErr.Error()
	}
	return nil, "", NewError(ErrProviderError, "provider_error", msg)
}

// CreateCollection provisions an inbound virtual account / IBAN (spec §5.5).
func (s *Service) CreateCollection(ctx context.Context, customerID string, req CollectionRequest) (*VirtualAccount, *APIError) {
	currency := strings.ToUpper(req.Currency)
	if !SupportedCurrency(currency) {
		return nil, NewError(ErrInvalidRequest, "unsupported_currency", "Currency not supported for collections.").WithParam("currency")
	}
	prov := s.pickCollectionProvider(req.Type)
	if prov == nil {
		return nil, NewError(ErrRoutingUnavailable, "routing_unavailable", "No provider can issue this account type.")
	}
	res, err := prov.CreateCollection(ctx, currency, req.Type, customerID)
	if err != nil {
		return nil, NewError(ErrProviderError, "provider_error", err.Error())
	}
	va := &VirtualAccount{
		ID: newID("va"), CustomerID: customerID, Currency: currency, Type: req.Type,
		Provider: prov.Name(), Status: "active", Details: res.Details, CreatedAt: s.now(),
	}
	if err := s.store.SaveCollection(ctx, va); err != nil {
		return nil, asAPIError(err)
	}
	return va, nil
}

func (s *Service) pickCollectionProvider(accountType string) Provider {
	preferred := "maplerad"
	if accountType == "iban" {
		preferred = "eversend"
	}
	if p, ok := s.providers[preferred]; ok {
		return p
	}
	for _, p := range s.order {
		return p
	}
	return nil
}

// Balances returns the customer's held balances (spec §5.6).
func (s *Service) Balances(ctx context.Context, customerID string) ([]Money, error) {
	return s.store.Balances(ctx, customerID)
}

// Transactions returns the unified ledger view (spec §5.6).
func (s *Service) Transactions(ctx context.Context, customerID string) ([]TxView, error) {
	return s.store.Transactions(ctx, customerID)
}

// Transaction returns a single unified transaction by id/reference.
func (s *Service) Transaction(ctx context.Context, customerID, id string) (*TxView, bool, error) {
	return s.store.Transaction(ctx, customerID, id)
}

// IndicativeRate is a display/alert rate (not executable, spec §5.6).
type IndicativeRate struct {
	Pair string  `json:"pair"`
	From string  `json:"from"`
	To   string  `json:"to"`
	Mid  float64 `json:"mid"`
	Sell float64 `json:"sell"`
}

// Rates returns indicative mid + Paymax sell rates for the common pairs.
func (s *Service) Rates(ctx context.Context, tier string) []IndicativeRate {
	pairs := [][2]string{{"USD", "NGN"}, {"EUR", "NGN"}, {"GBP", "NGN"}, {"USD", "GHS"}, {"USD", "KES"}, {"USD", "XAF"}}
	out := make([]IndicativeRate, 0, len(pairs))
	for _, p := range pairs {
		mid := MidRate(p[0], p[1])
		out = append(out, IndicativeRate{
			Pair: Corridor(p[0], p[1]), From: p[0], To: p[1],
			Mid: round4(mid), Sell: round4(s.spread.CustomerRate(mid, Corridor(p[0], p[1]), tier)),
		})
	}
	return out
}

// TreasurySnapshot returns all float buckets (ops/treasury dashboards, spec §7).
func (s *Service) TreasurySnapshot() []FloatBucket { return s.treasury.Snapshot() }

// AutoRebalance tops up every bucket at/below its low-water mark and emits a
// balance.low event for each (the rebalancing engine + alerts, spec §7).
func (s *Service) AutoRebalance(ctx context.Context) []FloatBucket {
	low := s.treasury.LowBuckets()
	for _, b := range low {
		s.treasury.Rebalance(b.Provider, b.Currency)
		s.emit(ctx, "balance.low", b)
	}
	return low
}

// SeedBalance is a dev/onboarding helper to credit an opening balance.
func (s *Service) SeedBalance(ctx context.Context, customerID, currency string, amountMinor int64) error {
	return s.store.SeedBalance(ctx, customerID, strings.ToUpper(currency), amountMinor)
}

func round4(f float64) float64 { return float64(int64(f*10000+0.5)) / 10000 }

func shortRef() string { return strings.ToUpper(strings.ReplaceAll(uuid.New().String(), "-", ""))[:8] }
