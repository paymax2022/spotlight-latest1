package fx

import (
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
// Paymax revenue on this path therefore has to be an EXPLICIT markup of our own,
// which is what this file computes. The rule table mirrors the already-reviewed
// orchestration SpreadEngine (backend/internal/orchestration/spread.go) so the
// legacy /api/finance/fx path and the orchestration path price a corridor the
// same way; it is duplicated rather than imported because pulling the whole
// orchestration package (providers, treasury, redis) into finance/fx for one
// pure-arithmetic type is the wrong coupling for a service being superseded.
//
// The markup is charged ON TOP of the principal: Convert debits
// SourceAmountKobo + FeeKobo and the ledger credits the whole amount to the
// fx_spread_income standing account, so the double-entry stays balanced with no
// other change.
// ---------------------------------------------------------------------------

// Default markup in basis points, matching orchestration's flat default.
const defaultMarkupBPS = 105

// MarkupRule overrides the default markup for one corridor ("USD-NGN").
type MarkupRule struct {
	Corridor string
	BPS      int
}

// Markup resolves the Paymax markup in basis points for a corridor.
type Markup struct {
	defaultBPS int
	rules      map[string]int
}

// NewMarkup builds a markup engine with a flat default and optional per-corridor
// overrides. A negative default is clamped to zero — a markup may be zero (no
// Paymax margin) but never negative, which would pay the customer to convert.
func NewMarkup(defaultBPS int, rules ...MarkupRule) *Markup {
	if defaultBPS < 0 {
		defaultBPS = 0
	}
	m := &Markup{defaultBPS: defaultBPS, rules: make(map[string]int, len(rules))}
	for _, r := range rules {
		if r.BPS < 0 {
			continue
		}
		m.rules[normalizeCorridor(r.Corridor)] = r.BPS
	}
	return m
}

// DefaultMarkup is the production rule table, mirroring the orchestration
// SpreadEngine's corridor rules.
func DefaultMarkup() *Markup {
	return NewMarkup(defaultMarkupBPS,
		MarkupRule{Corridor: "USD-NGN", BPS: 120},
		MarkupRule{Corridor: "USD-XAF", BPS: 150},
	)
}

// normalizeCorridor canonicalises a "usd-ngn" style corridor label.
func normalizeCorridor(corridor string) string {
	return strings.ToUpper(strings.TrimSpace(corridor))
}

// corridorKey builds the canonical corridor label for a currency pair.
func corridorKey(source, target string) string {
	return normalizeCorridor(source) + "-" + normalizeCorridor(target)
}

// BPS returns the effective markup in basis points for a corridor.
func (m *Markup) BPS(source, target string) int {
	if m == nil {
		return 0
	}
	if bps, ok := m.rules[corridorKey(source, target)]; ok {
		return bps
	}
	return m.defaultBPS
}

// FeeMinor returns the Paymax markup on amountMinor for a corridor, in the SOURCE
// currency's minor units. Computed with exact rational arithmetic and half-even
// rounding (never float multiplication) so the charged fee is deterministic and
// reproducible — this value is debited from the user and recorded as realized
// revenue. A non-positive amount yields no fee.
func (m *Markup) FeeMinor(source, target string, amountMinor int64) int64 {
	if m == nil || amountMinor <= 0 {
		return 0
	}
	bps := m.BPS(source, target)
	if bps <= 0 {
		return 0
	}
	r := new(big.Rat).SetInt64(amountMinor)
	r.Mul(r, big.NewRat(int64(bps), 10_000))
	return roundRatHalfEven(r)
}

// roundRatHalfEven rounds an exact rational to the nearest integer, ties to even
// (banker's rounding), so a long run of conversions does not drift upward against
// the customer.
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
