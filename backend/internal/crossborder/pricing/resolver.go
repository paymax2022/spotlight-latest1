package pricing

import (
	"context"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// SpreadSource yields the L2 FX spread in bps for a corridor/tier. It is
// satisfied by *orchestration.SpreadEngine (public.fx_markup_rates), so the
// spread shown is the spread passed to Verto.
type SpreadSource interface {
	EffectiveBPS(corridor, tier string) int
}

// CostEntry is one L0 (Verto) rate-card row: flat + pct_bps of the amount.
// Empty selector fields are wildcards.
type CostEntry struct {
	Service   string
	Corridor  string
	Rail      string
	Currency  string
	FlatMinor int64
	PctBPS    int64
}

// RateCard is the L0 Verto cost card. Never shown to users.
type RateCard struct {
	Entries []CostEntry
}

// lookup picks the entry matching the most selector fields (ties: first wins,
// since cost entries are config-reviewed; a missing entry is an error).
func (rc RateCard) lookup(service, corridor, rail, currency string) (CostEntry, bool) {
	best, bestScore, found := CostEntry{}, -1, false
	for _, e := range rc.Entries {
		score, ok := 0, true
		for _, p := range [][2]string{
			{e.Service, service}, {e.Corridor, corridor}, {e.Rail, rail}, {e.Currency, currency},
		} {
			if p[0] == "" {
				continue
			}
			if !strings.EqualFold(p[0], p[1]) {
				ok = false
				break
			}
			score++
		}
		if ok && score > bestScore {
			best, bestScore, found = e, score, true
		}
	}
	return best, found
}

func (e CostEntry) compute(amount int64) (int64, error) {
	pct, err := BPSOf(amount, e.PctBPS, RoundPayUp) // cost we incur: conservative, round up
	if err != nil {
		return 0, err
	}
	c := e.FlatMinor + pct
	if c < pct {
		return 0, ErrOverflow
	}
	return c, nil
}

// Guardrails are the fail-closed price limits. fee+spread must be at least
// L0 cost + floor margin and at most the hard cap, for EVERY amount in the
// rule's band. At least one hard cap (bps of amount and/or absolute minor
// units per transaction) must be configured; if both are set, both apply.
type Guardrails struct {
	FloorMarginMinor int64 // absolute margin above cost
	FloorMarginBPS   int64 // additional margin as bps of amount
	HardCapBPS       int64 // max (fee+spread) as bps of amount; 0 = unset
	HardCapMinor     int64 // max (fee+spread) absolute; 0 = unset
}

// PricingInput describes one thing to price.
type PricingInput struct {
	Service   string
	Direction string
	Corridor  string
	Rail      string
	Plan      string
	Tier      string
	SubjectID string // per-transfer / customer / promo identifier, if any
	Amount    Money  // the target amount the beneficiary is to receive (fee-on-top basis)
	// FXApplies is true when the service converts currency (spread is charged).
	FXApplies bool
	// PassthroughMinor is a Verto/government pass-through (held-rate premium...)
	// in Amount's currency; carried as a net-zero line, excluded from profit.
	PassthroughMinor int64
	At               time.Time // pricing instant; required for deterministic validity checks
}

// Decision is the resolver output: the winning rule and the frozen quote.
type Decision struct {
	Rule  FeeRule
	Quote Quote
}

// Resolver prices requests against a validated schedule.
type Resolver struct {
	schedule FeeSchedule
	spread   SpreadSource
	costs    RateCard
	guard    Guardrails
	taxBPS   int64 // VAT on the platform fee
}

// NewResolver validates the schedule and guardrail config (fail-closed).
func NewResolver(s FeeSchedule, spread SpreadSource, costs RateCard, g Guardrails, taxBPS int64) (*Resolver, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	if g.HardCapBPS <= 0 && g.HardCapMinor <= 0 {
		return nil, ErrNoHardCap
	}
	if g.FloorMarginMinor < 0 || g.FloorMarginBPS < 0 || g.HardCapBPS < 0 || g.HardCapMinor < 0 || taxBPS < 0 {
		return nil, fmt.Errorf("%w: negative guardrail or tax parameter", ErrInvalidInput)
	}
	if spread == nil {
		return nil, fmt.Errorf("%w: spread source required", ErrInvalidInput)
	}
	return &Resolver{schedule: s, spread: spread, costs: costs, guard: g, taxBPS: taxBPS}, nil
}

// matches reports whether the rule applies and returns its specificity score.
func matches(r FeeRule, in PricingInput) (int, bool) {
	if r.Status != StatusActive {
		return 0, false
	}
	if !r.ValidFrom.IsZero() && in.At.Before(r.ValidFrom) {
		return 0, false
	}
	if !r.ValidTo.IsZero() && !in.At.Before(r.ValidTo) {
		return 0, false
	}
	if r.Level >= LevelNegotiated && r.SubjectID != in.SubjectID {
		return 0, false
	}
	a := in.Amount.AmountMinor
	if a < r.AmountMin || (r.AmountMax != 0 && a > r.AmountMax) {
		return 0, false
	}
	score := 0
	for _, p := range [][2]string{
		{r.Service, in.Service}, {r.Direction, in.Direction}, {r.Corridor, in.Corridor}, {r.Rail, in.Rail},
		{r.Currency, in.Amount.Currency}, {r.Plan, in.Plan}, {r.Tier, in.Tier},
	} {
		if p[0] == "" {
			continue
		}
		if !strings.EqualFold(p[0], p[1]) {
			return 0, false
		}
		score++
	}
	if r.AmountMin > 0 || r.AmountMax > 0 {
		score++
	}
	return score, true
}

// selectRule applies most-specific-wins: level first, then specificity score.
// An exact tie fails closed.
func (rs *Resolver) selectRule(in PricingInput) (FeeRule, error) {
	var best FeeRule
	bestScore, found, tie := -1, false, false
	for _, r := range rs.schedule.Rules {
		score, ok := matches(r, in)
		if !ok {
			continue
		}
		switch {
		case !found || r.Level > best.Level || (r.Level == best.Level && score > bestScore):
			best, bestScore, found, tie = r, score, true, false
		case r.Level == best.Level && score == bestScore:
			tie = true
		}
	}
	if !found {
		return FeeRule{}, ErrNoRule
	}
	if tie {
		return FeeRule{}, fmt.Errorf("%w: rule %s", ErrAmbiguousRule, best.ID)
	}
	return best, nil
}

// econ computes (fee, spread, cost) for a hypothetical amount under rule r.
func (rs *Resolver) econ(r FeeRule, in PricingInput, cost CostEntry, amount int64) (fee, spread, c int64, err error) {
	if fee, err = r.Fee.Compute(amount); err != nil {
		return
	}
	if in.FXApplies {
		if spread, err = BPSOf(amount, int64(rs.spread.EffectiveBPS(in.Corridor, in.Tier)), RoundPayUp); err != nil {
			return
		}
	}
	c, err = cost.compute(amount)
	return
}

// unboundedProbe is the amount used to test the asymptotic slope of a band
// with no upper limit.
const unboundedProbe = int64(1) << 50

// checkpoints are the amounts where revenue-minus-cost can be extremal over the
// rule's band: the band edges, the requested amount, and the fee clamp kinks
// (revenue is piecewise linear; +-1 covers per-step rounding).
func checkpoints(r FeeRule, requested int64) []int64 {
	lo, hi := r.AmountMin, r.AmountMax
	if hi == 0 {
		hi = unboundedProbe
	}
	if lo < 1 {
		lo = 1
	}
	pts := []int64{lo, hi, requested}
	if f := r.Fee; f.PctBPS > 0 {
		for _, target := range []int64{f.MinMinor, f.MaxMinor} {
			if target <= 0 {
				continue
			}
			// amount where flat + pct*amount == target
			num := new(big.Int).Mul(big.NewInt(target-f.FlatMinor), big.NewInt(bpsDenom))
			if num.Sign() <= 0 {
				continue
			}
			k := new(big.Int).Quo(num, big.NewInt(f.PctBPS))
			if k.IsInt64() {
				for d := int64(-1); d <= 1; d++ {
					pts = append(pts, k.Int64()+d)
				}
			}
		}
	}
	out := pts[:0]
	for _, p := range pts {
		if p >= lo && p <= hi {
			out = append(out, p)
		}
	}
	return out
}

// guardrails enforces floor margin and hard cap over the whole band.
func (rs *Resolver) guardrails(r FeeRule, in PricingInput, cost CostEntry) error {
	for _, a := range checkpoints(r, in.Amount.AmountMinor) {
		fee, spread, c, err := rs.econ(r, in, cost, a)
		if err != nil {
			return err
		}
		rev := fee + spread
		if rev < fee {
			return ErrOverflow
		}
		bpsMargin, err := BPSOf(a, rs.guard.FloorMarginBPS, RoundPayUp)
		if err != nil {
			return err
		}
		floor := c + rs.guard.FloorMarginMinor + bpsMargin
		if rev < floor {
			return &GuardrailError{Sentinel: ErrBelowCostFloor, RuleID: r.ID, AmountMinor: a, RevenueMinor: rev, LimitMinor: floor}
		}
		if rs.guard.HardCapMinor > 0 && rev > rs.guard.HardCapMinor {
			return &GuardrailError{Sentinel: ErrAboveHardCap, RuleID: r.ID, AmountMinor: a, RevenueMinor: rev, LimitMinor: rs.guard.HardCapMinor}
		}
		if rs.guard.HardCapBPS > 0 {
			capMinor, err := BPSOf(a, rs.guard.HardCapBPS, RoundReceiveDown)
			if err != nil {
				return err
			}
			if rev > capMinor {
				return &GuardrailError{Sentinel: ErrAboveHardCap, RuleID: r.ID, AmountMinor: a, RevenueMinor: rev, LimitMinor: capMinor}
			}
		}
	}
	return nil
}

// Resolve selects the winning fee rule, composes platform fee + FX spread + L0
// cost + tax, enforces guardrails (fail-closed) and returns a frozen Quote.
func (rs *Resolver) Resolve(ctx context.Context, in PricingInput) (Decision, error) {
	if err := ctx.Err(); err != nil {
		return Decision{}, err
	}
	if in.Amount.AmountMinor <= 0 || in.Amount.Currency == "" || in.At.IsZero() || in.Service == "" || in.PassthroughMinor < 0 {
		return Decision{}, fmt.Errorf("%w: need positive amount, currency, service and pricing time", ErrInvalidInput)
	}
	in.Amount = NewMoney(in.Amount.AmountMinor, in.Amount.Currency)
	rule, err := rs.selectRule(in)
	if err != nil {
		return Decision{}, err
	}
	cost, ok := rs.costs.lookup(in.Service, in.Corridor, in.Rail, in.Amount.Currency)
	if !ok {
		return Decision{}, fmt.Errorf("%w: %s %s %s", ErrNoCost, in.Service, in.Corridor, in.Rail)
	}
	if err := rs.guardrails(rule, in, cost); err != nil {
		return Decision{}, err
	}
	amount := in.Amount.AmountMinor
	fee, spread, costMinor, err := rs.econ(rule, in, cost, amount)
	if err != nil {
		return Decision{}, err
	}
	tax, err := BPSOf(fee, rs.taxBPS, RoundPayUp)
	if err != nil {
		return Decision{}, err
	}

	// Split the platform fee between payers. Sender share rounds UP (pay side),
	// receiver share is the remainder (receive side, effectively rounded down).
	var senderFee, receiverFee int64
	switch rule.PayerMode {
	case PayerFeeOnTop:
		senderFee = fee
	case PayerFeeIncluded:
		receiverFee = fee
	case PayerSplit:
		senderFee = fee - fee/2
		receiverFee = fee / 2
	}
	if receiverFee > amount {
		return Decision{}, fmt.Errorf("%w: fee exceeds amount", ErrInvalidInput)
	}

	cur := in.Amount.Currency
	line := func(k QuoteKind, v int64, p Payer, visible bool) QuoteLine {
		return QuoteLine{Kind: k, Service: in.Service, Amount: NewMoney(v, cur), Payer: p, RuleID: rule.ID, Visible: visible}
	}
	var lines []QuoteLine
	lines = append(lines, line(KindVertoCost, costMinor, PayerPlatform, false))
	if senderFee > 0 {
		lines = append(lines, line(KindPlatformFee, senderFee, PayerSender, true))
	}
	if receiverFee > 0 {
		lines = append(lines, line(KindPlatformFee, receiverFee, PayerReceiver, true))
	}
	if in.FXApplies {
		lines = append(lines, line(KindFXSpread, spread, PayerSender, false)) // baked into the Verto rate
	}
	if in.PassthroughMinor > 0 {
		lines = append(lines, line(KindPassthrough, in.PassthroughMinor, PayerSender, true))
	}
	if tax > 0 {
		lines = append(lines, line(KindTax, tax, PayerSender, true))
	}

	revenue := fee + spread
	return Decision{
		Rule: rule,
		Quote: Quote{
			lines:        lines,
			revenue:      NewMoney(revenue, cur),
			cost:         NewMoney(costMinor, cur),
			estProfit:    NewMoney(revenue-costMinor, cur),
			senderPays:   NewMoney(amount+senderFee+in.PassthroughMinor+tax, cur),
			receiverGets: NewMoney(amount-receiverFee, cur),
			ruleID:       rule.ID,
			pricedAt:     in.At,
		},
	}, nil
}
