// Package orchestration implements the Paymax FX orchestration layer: a
// provider-agnostic normalized API (quotes, conversions, transfers, collections)
// on top of a smart order router, spread engine, treasury and unified ledger.
// Design invariants (apply everywhere):
//   - Money is always {amount: integer minor units, currency: ISO-4217}. Never floats for storage.
//   - Every mutating request carries an Idempotency-Key.
//   - The caller is provider-agnostic; routing is internal.
//   - Quote -> (lock) -> execute against a quote_id; a price is never assumed stable.
//   - One ledger is the source of truth.

package orchestration

import (
	"context"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"math/big"
	"strings"
	"sync"
)

// Money is the canonical money object: an integer amount in minor units
// (kobo/cents/pence) plus an ISO-4217 currency code.
type Money struct {
	AmountMinor int64  `json:"amount"`
	Currency    string `json:"currency"`
}

// MinorExponent returns the number of minor-unit decimal places for a currency,
// read from the authoritative currency registry (CU-002). Unknown currencies
// default to 2 (the safe fiat default) so callers never divide by an unknown
// scale; SupportedCurrency gates real conversions before this matters.
func MinorExponent(currency string) int {
	if c, ok := currencyRegistry[strings.ToUpper(currency)]; ok {
		return c.Exponent
	}
	return 2
}

// NewMoney builds a Money, normalizing the currency to upper-case.
func NewMoney(amountMinor int64, currency string) Money {
	return Money{AmountMinor: amountMinor, Currency: strings.ToUpper(currency)}
}

// IsZero reports whether the amount is zero.
func (m Money) IsZero() bool { return m.AmountMinor == 0 }

// applyRate converts an integer minor amount to another currency at `rate` when
// both sides share the same minor-unit exponent (2dp fiat). Retained for the
// same-precision fast path and existing callers/tests; cross-precision callers
// must use convertMinor, which respects each currency's exponent.
func applyRate(sourceMinor int64, rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	return roundRatHalfEven(new(big.Rat).Mul(new(big.Rat).SetInt64(sourceMinor), ratFromFloat(rate)))
}

// inverseAmount computes the source minor amount required to yield a target minor
// amount at the given rate, same-exponent fast path (see applyRate).
func inverseAmount(destMinor int64, rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	q := new(big.Rat).Quo(new(big.Rat).SetInt64(destMinor), ratFromFloat(rate))
	return roundRatHalfEven(q)
}

// convertMinor converts an integer minor amount from `source` to `dest` currency
// at `rate` (dest-major units per 1 source-major unit), respecting each
// currency's minor-unit exponent and rounding half-even to the dest precision.
// Precision-safe across differing exponents (USD 2dp -> JPY 0dp, JPY 0dp -> BTC
// 8dp): amounts stay integer minor units and the multiply is carried out exactly
// in big.Rat with a single deterministic rounding at the end — no lossy binary
// float on the money path (PR-005). Formula:
func convertMinor(sourceMinor int64, source, dest string, rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	es, ed := MinorExponent(source), MinorExponent(dest)
	product := new(big.Rat).SetInt64(sourceMinor)
	product.Mul(product, ratFromFloat(rate))
	product.Mul(product, pow10Rat(ed-es))
	return roundRatHalfEven(product)
}

// inverseConvertMinor computes the source minor amount required to yield
// `destMinor` of `dest` at `rate`, respecting both currencies' exponents. Used
// for destination-pegged ("I want exactly X EUR") quotes (QT-009).
func inverseConvertMinor(destMinor int64, source, dest string, rate float64) int64 {
	if rate <= 0 {
		return 0
	}
	es, ed := MinorExponent(source), MinorExponent(dest)
	q := new(big.Rat).SetInt64(destMinor)
	q.Quo(q, ratFromFloat(rate))
	q.Mul(q, pow10Rat(es-ed))
	return roundRatHalfEven(q)
}

// bpsOf returns `bps` basis points of an integer minor amount, half-even rounded.
// The result is same-currency (spread on the source amount), so exponent-neutral.
func bpsOf(amountMinor int64, bps int) int64 {
	r := new(big.Rat).SetInt64(amountMinor)
	r.Mul(r, big.NewRat(int64(bps), 10_000))
	return roundRatHalfEven(r)
}

// ratFromFloat converts a float64 rate to an exact big.Rat. SetFloat64 captures
// the float's exact binary value (the same value the legacy float path used), so
// results are deterministic; Inf/NaN degrade to zero (guarded by callers).
func ratFromFloat(f float64) *big.Rat {
	if r := new(big.Rat).SetFloat64(f); r != nil {
		return r
	}
	return new(big.Rat)
}

// pow10Rat returns 10^exp as a big.Rat, handling negative exponents (1/10^|exp|).
func pow10Rat(exp int) *big.Rat {
	n := exp
	if n < 0 {
		n = -n
	}
	p := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(n)), nil)
	if exp >= 0 {
		return new(big.Rat).SetInt(p)
	}
	return new(big.Rat).SetFrac(big.NewInt(1), p)
}

// roundRatHalfEven rounds a big.Rat to the nearest integer using banker's
// rounding (round-half-to-even), the deterministic policy for all money
// conversions (PR-004). Half-even avoids the systematic upward bias of
// round-half-up so cumulative rounding residue reconciles (PR-006) and the
// platform never silently gains from rounding.
func roundRatHalfEven(r *big.Rat) int64 {
	n := r.Num()
	d := r.Denom() // normalized: always > 0
	q := new(big.Int)
	m := new(big.Int)
	q.DivMod(n, d, m)
	twoM := new(big.Int).Lsh(m, 1)
	switch twoM.Cmp(d) {
	case -1: // fraction < 0.5 -> round down (toward floor)
		return q.Int64()
	case 1: // fraction > 0.5 -> round up
		return new(big.Int).Add(q, big.NewInt(1)).Int64()
	default: // exactly 0.5 -> round to even
		if q.Bit(0) == 0 {
			return q.Int64()
		}
		return new(big.Int).Add(q, big.NewInt(1)).Int64()
	}
}

// CurrencyInfo is one row of the currency master (spec TS-1): ISO-4217 identity
// plus the minor-unit precision the platform must respect on every amount.
type CurrencyInfo struct {
	Code     string `json:"code"`
	Name     string `json:"name"`
	Symbol   string `json:"symbol"`
	Exponent int    `json:"exponent"` // minor-unit decimal places (USD=2, JPY=0, KWD=3, BTC=8)
	Kind     string `json:"kind"`     // fiat | stablecoin | crypto
}

// currencyRegistry is the authoritative currency master. Exponents follow
// ISO-4217 for fiat; stablecoins/crypto use their native precision. This is the
// single source of truth for per-currency precision (CU-002) — money math reads
// its exponent here rather than assuming 2dp everywhere.
var currencyRegistry = map[string]CurrencyInfo{
	"USD":  {"USD", "US Dollar", "$", 2, "fiat"},
	"EUR":  {"EUR", "Euro", "€", 2, "fiat"},
	"GBP":  {"GBP", "Pound Sterling", "£", 2, "fiat"},
	"NGN":  {"NGN", "Nigerian Naira", "₦", 2, "fiat"},
	"GHS":  {"GHS", "Ghanaian Cedi", "₵", 2, "fiat"},
	"KES":  {"KES", "Kenyan Shilling", "KSh", 2, "fiat"},
	"ZAR":  {"ZAR", "South African Rand", "R", 2, "fiat"},
	"XAF":  {"XAF", "Central African CFA Franc", "FCFA", 0, "fiat"}, // ISO-4217: 0 minor units
	"JPY":  {"JPY", "Japanese Yen", "¥", 0, "fiat"},
	"KWD":  {"KWD", "Kuwaiti Dinar", "KD", 3, "fiat"},
	"BHD":  {"BHD", "Bahraini Dinar", "BD", 3, "fiat"},
	"USDC": {"USDC", "USD Coin", "USDC", 2, "stablecoin"}, // display-normalized to 2
	"USDT": {"USDT", "Tether", "USDT", 2, "stablecoin"},
	"BTC":  {"BTC", "Bitcoin", "₿", 8, "crypto"},
	"ETH":  {"ETH", "Ether", "Ξ", 8, "crypto"},
}

// CurrencyMeta returns the registry entry for a currency (and whether it exists).
func CurrencyMeta(code string) (CurrencyInfo, bool) {
	c, ok := currencyRegistry[strings.ToUpper(code)]
	return c, ok
}

// SupportedCurrencies returns the currency master as a stable-order-free slice for
// the currency-list endpoint (CU-001). Callers that need order should sort.
func SupportedCurrencies() []CurrencyInfo {
	out := make([]CurrencyInfo, 0, len(currencyRegistry))
	for _, c := range currencyRegistry {
		out = append(out, c)
	}
	return out
}

// SpreadRule is a configurable markup for a corridor × customer-tier (spec §9).
// Spread is expressed in basis points over the provider all-in rate, with an
// optional fixed component and min/max guards.
type SpreadRule struct {
	Corridor   string // "" matches any corridor (default rule)
	Tier       string // "" matches any tier
	BPS        int
	FixedMinor int64
	MinBPS     int
	MaxBPS     int
}

// SpreadSource loads the spread rule card from durable storage. Implemented by
// the pgx-backed source over public.fx_markup_rates — the SAME table the legacy
// wallet FX service prices from, so one admin change moves both surfaces
// (ADR-032). A nil source leaves the engine on its in-code rules, which is what
// unit tests and any non-DB wiring use.
type SpreadSource interface {
	LoadRules(ctx context.Context) (defaultBPS int, rules []SpreadRule, err error)
}

// SpreadEngine resolves the effective spread for a corridor/tier and applies it.
// The rule card is swappable at runtime (Refresh), so it is guarded by a mutex:
// Refresh runs on the request path while resolve is being read by the candidate
// loop of a concurrent quote.
type SpreadEngine struct {
	mu         sync.RWMutex
	rules      []SpreadRule
	defaultBPS int
	source     SpreadSource
}

// NewSpreadEngine builds an engine with a flat default and optional overrides.
func NewSpreadEngine(defaultBPS int, rules ...SpreadRule) *SpreadEngine {
	return &SpreadEngine{rules: rules, defaultBPS: defaultBPS}
}

// WithSource attaches a durable rule card. The in-code rules stay as the value
// used until the first successful Refresh.
func (e *SpreadEngine) WithSource(src SpreadSource) *SpreadEngine {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.source = src
	return e
}

// HasSource reports whether a durable rule card is attached.
func (e *SpreadEngine) HasSource() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.source != nil
}

// Refresh reloads the rule card from the source, so an admin rate change is live
// on the next quote with no restart. A nil source is a no-op (in-code rules).
// Callers MUST treat an error as fatal to the operation: pricing from a rule card
// we could not confirm would charge a spread nobody configured. Refresh is called
// once per user-facing operation, not once per candidate, so this is one query
// per quote.
func (e *SpreadEngine) Refresh(ctx context.Context) error {
	e.mu.RLock()
	src := e.source
	e.mu.RUnlock()
	if src == nil {
		return nil
	}
	defaultBPS, rules, err := src.LoadRules(ctx)
	if err != nil {
		return err
	}
	e.mu.Lock()
	e.defaultBPS, e.rules = defaultBPS, rules
	e.mu.Unlock()
	return nil
}

// resolve picks the most specific matching rule (corridor+tier > corridor > tier > default).
func (e *SpreadEngine) resolve(corridor, tier string) SpreadRule {
	e.mu.RLock()
	defer e.mu.RUnlock()
	corridor, tier = strings.ToUpper(corridor), strings.ToLower(tier)
	var best *SpreadRule
	bestScore := -1
	for i := range e.rules {
		r := e.rules[i]
		score := 0
		if r.Corridor != "" {
			if strings.ToUpper(r.Corridor) != corridor {
				continue
			}
			score += 2
		}
		if r.Tier != "" {
			if strings.ToLower(r.Tier) != tier {
				continue
			}
			score++
		}
		if score > bestScore {
			bestScore = score
			rr := r
			best = &rr
		}
	}
	if best == nil {
		return SpreadRule{BPS: e.defaultBPS, MinBPS: 0, MaxBPS: e.defaultBPS * 4}
	}
	return *best
}

// EffectiveBPS returns the guarded spread in basis points for a corridor/tier.
func (e *SpreadEngine) EffectiveBPS(corridor, tier string) int {
	r := e.resolve(corridor, tier)
	bps := r.BPS
	if r.MaxBPS > 0 && bps > r.MaxBPS {
		bps = r.MaxBPS
	}
	if bps < r.MinBPS {
		bps = r.MinBPS
	}
	return bps
}

// FixedMinor returns the fixed-fee component for a corridor/tier.
func (e *SpreadEngine) FixedMinor(corridor, tier string) int64 {
	return e.resolve(corridor, tier).FixedMinor
}

// CustomerRate applies the spread to a provider all-in mid rate. The customer
// receives slightly less than mid (markup retained as Paymax spread revenue).
func (e *SpreadEngine) CustomerRate(providerRate float64, corridor, tier string) float64 {
	bps := e.EffectiveBPS(corridor, tier)
	return providerRate * (1 - float64(bps)/10_000.0)
}

// Durable spread rule card, shared with the legacy wallet FX service (ADR-032).
// public.fx_markup_rates is the SINGLE source of truth for Paymax FX markup
// across both FX surfaces: the legacy /api/finance/fx service and this
// orchestration module. Before ADR-032 the two priced independently — this
// module from an in-code rule table in finance_routes.go, the legacy service
// from the DB — so the same corridor could be charged two different markups and
// only one of them was operator-changeable.
// The table is read directly rather than through finance/fx to keep the
// dependency direction clean: it is a shared platform config table, and having
// orchestration import the legacy service purely to read a rate would couple the
// new module to the one it supersedes.
// The DEFAULT corridor row and the '' tier are wildcards, matching
// SpreadEngine.resolve's "empty means any" semantics.

// sqlSpreadSource loads the rule card from public.fx_markup_rates.
type sqlSpreadSource struct {
	db *pgxpool.Pool
}

// NewSQLSpreadSource returns a SpreadSource over the shared markup table
// (requires the 20261204000000_fx_markup_rates migration).
func NewSQLSpreadSource(db *pgxpool.Pool) SpreadSource { return &sqlSpreadSource{db: db} }

// LoadRules reads every active row and shapes it into the engine's rule form.
// The 'DEFAULT' corridor row becomes the engine's flat default (Corridor ""),
// and every other row becomes a SpreadRule keyed on corridor and, where set,
// tier — which is exactly how resolve() scores specificity (corridor+tier >
// corridor > tier > default).
// A missing DEFAULT row is an ERROR, not a zero or a silent fallback: the seed
// migration guarantees one, so its absence means the table is not what this code
// expects, and guessing a spread would mean charging a rate nobody configured.
func (s *sqlSpreadSource) LoadRules(ctx context.Context) (int, []SpreadRule, error) {
	const q = `
		SELECT corridor, tier, rate_bps, COALESCE(min_bps, 0), COALESCE(max_bps, 0)
		FROM public.fx_markup_rates
		WHERE active
		ORDER BY corridor, tier`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return 0, nil, fmt.Errorf("orchestration: load spread rules: %w", err)
	}
	defer rows.Close()

	defaultBPS := -1
	out := make([]SpreadRule, 0, 8)
	for rows.Next() {
		var corridor, tier string
		var bps, minBPS, maxBPS int
		if err := rows.Scan(&corridor, &tier, &bps, &minBPS, &maxBPS); err != nil {
			return 0, nil, fmt.Errorf("orchestration: scan spread rule: %w", err)
		}
		if corridor == markupDefaultCorridor && tier == "" {
			defaultBPS = bps
			continue
		}
		rule := SpreadRule{BPS: bps, MinBPS: minBPS, MaxBPS: maxBPS}
		if corridor != markupDefaultCorridor {
			rule.Corridor = corridor
		}
		rule.Tier = tier
		out = append(out, rule)
	}
	if err := rows.Err(); err != nil {
		return 0, nil, fmt.Errorf("orchestration: read spread rules: %w", err)
	}
	if defaultBPS < 0 {
		return 0, nil, fmt.Errorf("orchestration: no active '%s' row in fx_markup_rates — refusing to price without a configured default spread", markupDefaultCorridor)
	}
	return defaultBPS, out, nil
}

// markupDefaultCorridor is the wildcard corridor label in fx_markup_rates. It
// mirrors fx.DefaultCorridor; the constant is repeated rather than imported so
// orchestration does not depend on the legacy FX package (see file header).
const markupDefaultCorridor = "DEFAULT"
