package fx

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

// ---------------------------------------------------------------------------
// Paymax FX markup.
//
// Maplerad's FX endpoints return NO fee: the provider prices its own margin into
// the rate (see maplerad.ConvertFXResponse). Before the real contract was known,
// this service read a `fee` field that never existed on the wire, so `fee_kobo`
// was structurally 0 — the user was debited principal only and
// recordCommissionSafe never fired (it early-returns on feeKobo <= 0).
//
// Paymax revenue on this path is therefore an EXPLICIT markup of our own. It is
// operator-tunable at runtime: the live rate lives in public.fx_markup_rates and
// is changed through PUT /api/finance/admin/fx/markup (ADR-030).
//
// UNITS. Operators think in PERCENT ("1%"); money code stores integer BASIS
// POINTS (1% = 100 bps), matching commission_config.commission_bps and every
// other rate in the schema. Conversion between the two is exact rational
// arithmetic — a percent is never held as a float, because a float percent makes
// the charged fee non-reproducible.
//
// The markup is charged ON TOP of the principal: Convert debits
// SourceAmountKobo + FeeKobo and the ledger credits the whole amount to the
// fx_spread_income standing account, so the double-entry stays balanced with no
// other change.
// ---------------------------------------------------------------------------

// DefaultCorridor is the rate row applied to any corridor without its own
// override. Mirrors the seeded 'DEFAULT' row in fx_markup_rates.
const DefaultCorridor = "DEFAULT"

// DefaultMarkupBPS is the fallback markup (1%) used when no rate store is wired.
// The live value is the 'DEFAULT' row in fx_markup_rates.
const DefaultMarkupBPS = 100

// MaxMarkupBPS is a fat-finger ceiling (10%), mirroring the CHECK constraint on
// fx_markup_rates.rate_bps. It is not a pricing decision — it exists so a
// mistyped "100" (meaning 1%) cannot charge 100% of the principal.
const MaxMarkupBPS = 1000

// ErrMarkupOutOfRange is returned when a submitted rate is negative or above
// MaxMarkupBPS.
var ErrMarkupOutOfRange = errors.New("fx: markup rate must be between 0% and 10%")

// ErrMarkupTooPrecise is returned when a submitted percentage is finer than
// 0.01% (one basis point), which the integer store cannot represent exactly.
var ErrMarkupTooPrecise = errors.New("fx: markup percentage cannot be finer than 0.01%")

// MarkupResolver returns the Paymax markup for a corridor, in the SOURCE
// currency's minor units. Implemented by the static Markup (tests, fallback) and
// by the DB-backed store (production).
//
// An error MUST fail the quote rather than default to some other rate: charging a
// fee we cannot confirm is worse than not quoting.
type MarkupResolver interface {
	FeeMinor(ctx context.Context, source, target string, amountMinor int64) (int64, error)
}

// MarkupRule overrides the default markup for one corridor ("USD-NGN").
type MarkupRule struct {
	Corridor string
	BPS      int
}

// Markup is a static, in-memory MarkupResolver. Production wires the DB-backed
// store instead; this is the fallback when none is configured, and what tests pin
// so they assert behaviour rather than production pricing.
type Markup struct {
	defaultBPS int
	rules      map[string]int
}

// NewMarkup builds a static markup with a flat default and optional per-corridor
// overrides. A negative default is clamped to zero and negative overrides are
// dropped: a markup may be zero (no Paymax margin) but never negative, which
// would pay the customer to convert.
func NewMarkup(defaultBPS int, rules ...MarkupRule) *Markup {
	if defaultBPS < 0 {
		defaultBPS = 0
	}
	m := &Markup{defaultBPS: defaultBPS, rules: make(map[string]int, len(rules))}
	for _, r := range rules {
		if r.BPS < 0 {
			continue
		}
		m.rules[NormalizeCorridor(r.Corridor)] = r.BPS
	}
	return m
}

// DefaultMarkup is the fallback rate table (a flat 1%) used when no rate store is
// wired. The operator-visible source of truth is fx_markup_rates.
func DefaultMarkup() *Markup { return NewMarkup(DefaultMarkupBPS) }

// NormalizeCorridor canonicalises a "usd-ngn" style corridor label.
func NormalizeCorridor(corridor string) string {
	return strings.ToUpper(strings.TrimSpace(corridor))
}

// CorridorKey builds the canonical corridor label for a currency pair.
func CorridorKey(source, target string) string {
	return NormalizeCorridor(source) + "-" + NormalizeCorridor(target)
}

// BPS returns the effective markup in basis points for a corridor.
func (m *Markup) BPS(source, target string) int {
	if m == nil {
		return 0
	}
	if bps, ok := m.rules[CorridorKey(source, target)]; ok {
		return bps
	}
	return m.defaultBPS
}

// FeeMinor implements MarkupResolver. Never errors.
func (m *Markup) FeeMinor(_ context.Context, source, target string, amountMinor int64) (int64, error) {
	if m == nil {
		return 0, nil
	}
	return FeeFromBPS(m.BPS(source, target), amountMinor), nil
}

// FeeFromBPS applies a basis-point rate to a minor-unit amount using exact
// rational arithmetic with half-even (banker's) rounding — never float
// multiplication — so the charged fee is deterministic, reproducible, and does
// not drift in Paymax's favour over a long run of conversions.
func FeeFromBPS(bps int, amountMinor int64) int64 {
	if bps <= 0 || amountMinor <= 0 {
		return 0
	}
	r := new(big.Rat).SetInt64(amountMinor)
	r.Mul(r, big.NewRat(int64(bps), 10_000))
	return roundRatHalfEven(r)
}

// PercentToBPS converts an operator-entered percentage ("1", "1.5", "0.25") to
// integer basis points. The input is taken as a STRING (json.Number preserves the
// literal) and parsed exactly, so 1.15% becomes 115 bps rather than the 114.999…
// a float64 round-trip produces.
//
// Rejects: unparseable input, anything finer than one basis point (0.01%), and
// anything outside [0, MaxMarkupBPS].
func PercentToBPS(percent string) (int, error) {
	p := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(percent), "%"))
	if p == "" {
		return 0, fmt.Errorf("fx: markup percentage is required")
	}
	r, ok := new(big.Rat).SetString(p)
	if !ok {
		return 0, fmt.Errorf("fx: %q is not a valid percentage", percent)
	}
	r.Mul(r, big.NewRat(100, 1)) // 1% -> 100 bps
	if !r.IsInt() {
		return 0, ErrMarkupTooPrecise
	}
	bps := r.Num().Int64()
	if bps < 0 || bps > MaxMarkupBPS {
		return 0, ErrMarkupOutOfRange
	}
	return int(bps), nil
}

// BPSToPercent renders basis points as an operator-facing percentage string,
// trimmed of trailing zeros ("100" -> "1", "150" -> "1.5", "25" -> "0.25").
func BPSToPercent(bps int) string {
	whole, frac := bps/100, bps%100
	if frac == 0 {
		return fmt.Sprintf("%d", whole)
	}
	s := fmt.Sprintf("%d.%02d", whole, frac)
	return strings.TrimRight(s, "0")
}

// roundRatHalfEven rounds an exact rational to the nearest integer, ties to even.
func roundRatHalfEven(r *big.Rat) int64 {
	num, den := r.Num(), r.Denom()
	q, rem := new(big.Int).QuoRem(num, den, new(big.Int))

	twice := new(big.Int).Abs(rem)
	twice.Mul(twice, big.NewInt(2))
	cmp := twice.Cmp(new(big.Int).Abs(den))

	roundAway := cmp > 0 || (cmp == 0 && q.Bit(0) == 1)
	if roundAway && rem.Sign() != 0 {
		if r.Sign() < 0 {
			q.Sub(q, big.NewInt(1))
		} else {
			q.Add(q, big.NewInt(1))
		}
	}
	return q.Int64()
}
