package mycover

import (
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// ════════════════════════════════════════════════════════════════════════════
// MONEY BOUNDARY — naira (provider) ⇄ kobo (Paymax)
// ════════════════════════════════════════════════════════════════════════════
//
// MyCover speaks NAIRA as decimal STRINGS ("6000.0000", "0.5", "10817.0000").
// Paymax's iron rule is INTEGER KOBO. This file is the ONLY place that crossing
// happens, and it happens exactly once per value, in EACH direction:
//
//	INBOUND   premiums and sums the provider quotes  → NairaToKobo
//	OUTBOUND  declared values the member submitted   → ConvertMoneyInputsToNaira
//
// The outbound half was missing for a long time. MyCover's FORM INPUTS are also
// naira, but every client submits kobo, and the adapter forwarded the answers
// verbatim — so a ₦200,000 phone was declared to the insurer as 20,000,000 and
// priced at ₦1,000,000 instead of ₦10,000 (verified live on the 5%-rated gadget
// product). Both halves now live here, side by side, so the asymmetry cannot
// recur unnoticed.
//
// Implementation rule: exact decimal arithmetic via math/big (big.Rat / big.Int).
// A float64 is NEVER used as an intermediate — float64(0.46)*100 is
// 45.99999999999999 and float64(1.04)*100 is 103.99999999999999, which is
// precisely the drift that turns a rate table into a money bug.
//
// ROUNDING RULE (single rule, applied everywhere in this file):
//
//	ROUND HALF-UP (ties away from zero) to the target integer unit.
//
// Inputs are non-negative, so "away from zero" == "up". Half-up is chosen over
// bankers' rounding because it is the rule a human reconciling a premium against
// MyCover's own displayed figure will apply, and over ceiling because ceiling
// would systematically over-collect from members. The maximum divergence from
// the provider on any single premium is 0.5 kobo.
//
// FAIL CLOSED: anything that is not a plain non-negative decimal literal is
// rejected with an error. We never fall back to a guessed amount.

// decimalRe matches a plain non-negative decimal literal, e.g. "0", "0.5",
// "6000.0000". It deliberately rejects the other forms big.Rat.SetString
// accepts — "1/3" (rational) and "1e5" (exponent) — because a money field
// arriving in either form means the provider contract changed and we must stop,
// not interpret.
var decimalRe = regexp.MustCompile(`^[0-9]+(\.[0-9]+)?$`)

// kobosPerNaira is the minor-unit scale.
var (
	kobosPerNaira = big.NewInt(100)
	bpsPerPercent = big.NewInt(100)
	bpsDivisor    = big.NewInt(10_000) // basis points → fraction
	bigTwo        = big.NewInt(2)
)

// parseDecimal converts a validated decimal string to an exact rational. No
// float64 is involved at any point.
func parseDecimal(s string) (*big.Rat, error) {
	if s == "" {
		return nil, fmt.Errorf("mycover: empty decimal amount")
	}
	if !decimalRe.MatchString(s) {
		return nil, fmt.Errorf("mycover: %q is not a plain non-negative decimal", s)
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return nil, fmt.Errorf("mycover: cannot parse decimal %q", s)
	}
	return r, nil
}

// ratRoundHalfUp rounds an exact non-negative rational to the nearest integer,
// ties away from zero. Pure big.Int arithmetic: floor((2n + d) / 2d).
func ratRoundHalfUp(r *big.Rat) *big.Int {
	num := new(big.Int).Set(r.Num())
	den := new(big.Int).Set(r.Denom())
	// 2n + d
	n2 := new(big.Int).Mul(num, bigTwo)
	n2.Add(n2, den)
	// 2d
	d2 := new(big.Int).Mul(den, bigTwo)
	q := new(big.Int)
	// Div is Euclidean (floor for positive divisor), which is what we want:
	// all inputs here are non-negative.
	q.Div(n2, d2)
	return q
}

// NairaToKobo converts a MyCover naira decimal string to integer kobo, rounding
// half-up at the kobo. This is the adapter boundary conversion — call it once,
// on the way in, and never convert again downstream.
func NairaToKobo(naira string) (int64, error) {
	r, err := parseDecimal(naira)
	if err != nil {
		return 0, err
	}
	r = new(big.Rat).Mul(r, new(big.Rat).SetInt(kobosPerNaira))
	k := ratRoundHalfUp(r)
	if !k.IsInt64() {
		return 0, fmt.Errorf("mycover: naira amount %q overflows int64 kobo", naira)
	}
	return k.Int64(), nil
}

// RateToBps converts a MyCover percentage rate string (base_price when
// is_percentage is true, e.g. "0.46" meaning 0.46% of the sum insured) to
// integer BASIS POINTS, rounding half-up at the basis point.
//
// Every rate in the live 68-product catalog is exact at bps precision
// (0.2500, 0.46, 0.5, 0.65, 0.9, 1, 1.04, 2.15, 2.5, 5, 7 → 25…700 bps), so
// rounding is a guard against a future rate, not a live lossy path.
func RateToBps(rate string) (int64, error) {
	r, err := parseDecimal(rate)
	if err != nil {
		return 0, err
	}
	r = new(big.Rat).Mul(r, new(big.Rat).SetInt(bpsPerPercent))
	b := ratRoundHalfUp(r)
	if !b.IsInt64() {
		return 0, fmt.Errorf("mycover: rate %q overflows int64 bps", rate)
	}
	return b.Int64(), nil
}

// PremiumFromRateBps computes the premium in kobo for a percentage-priced
// product: premium = sum_insured × rate, with rate expressed in basis points.
//
//	premium_kobo = round_half_up(sum_insured_kobo × rate_bps / 10_000)
//
// big.Int throughout: sum_insured_kobo × rate_bps can exceed int64 for large
// covers (₦100m at 700bps is 7×10^12 before the divide), so the multiply is done
// in arbitrary precision and only the result is narrowed.
func PremiumFromRateBps(sumInsuredKobo, rateBps int64) int64 {
	if sumInsuredKobo <= 0 || rateBps <= 0 {
		return 0
	}
	num := new(big.Int).Mul(big.NewInt(sumInsuredKobo), big.NewInt(rateBps))
	r := new(big.Rat).SetFrac(num, bpsDivisor)
	k := ratRoundHalfUp(r)
	if !k.IsInt64() {
		// Unreachable for any real cover amount; clamp rather than wrap silently.
		return 0
	}
	return k.Int64()
}

// CommissionFromPercent computes a commission slice in kobo from a WHOLE-PERCENT
// string as it appears in MyCover's sharing_formula (distributor_commission: 10
// means 10%), rounding half-up at the kobo.
//
// An empty or unparseable percent yields 0 — we never guess a revenue figure.
func CommissionFromPercent(baseKobo int64, percent string) int64 {
	if baseKobo <= 0 {
		return 0
	}
	p, err := parseDecimal(percent)
	if err != nil {
		return 0
	}
	// baseKobo × percent / 100
	r := new(big.Rat).Mul(new(big.Rat).SetInt64(baseKobo), p)
	r = new(big.Rat).Quo(r, new(big.Rat).SetInt(kobosPerNaira))
	k := ratRoundHalfUp(r)
	if !k.IsInt64() {
		return 0
	}
	return k.Int64()
}

// ════════════════════════════════════════════════════════════════════════════
// OUTBOUND: kobo (Paymax) → naira (MyCover form inputs)
// ════════════════════════════════════════════════════════════════════════════

// KoboToNaira converts an integer kobo amount to the exact naira value MyCover's
// form fields are denominated in, as a json.Number so it marshals as a BARE JSON
// number (the provider's `value` is numeric; a quoted string is rejected).
//
// Integer arithmetic only — the naira value is built from the quotient and the
// remainder, never from a division in floating point. 20_000_000 kobo becomes
// exactly 200000, and 1_250 kobo becomes exactly 12.5.
func KoboToNaira(kobo int64) json.Number {
	neg := kobo < 0
	abs := kobo
	if neg {
		abs = -abs
	}
	whole := abs / 100
	rem := abs % 100

	s := strconv.FormatInt(whole, 10)
	if rem != 0 {
		frac := strings.TrimRight(fmt.Sprintf("%02d", rem), "0")
		s += "." + frac
	}
	if neg {
		s = "-" + s
	}
	return json.Number(s)
}

// ConvertMoneyInputsToNaira returns a COPY of the member's schema-validated
// answers with exactly the given paths converted from kobo to the provider's
// naira. Everything else travels verbatim.
//
// `paths` comes from gateway.MoneyInputPaths over the very schema the client
// rendered, so the client's ×100 and this ÷100 always apply to the same fields.
// That symmetry is what makes the schema's name-based `money` heuristic safe: a
// misclassified field is scaled up and back down and lands on the value the
// member typed.
//
// A COPY is essential. Quote answers are persisted and REPLAYED verbatim at bind
// time; converting in place would store naira in a kobo column and the bind
// would divide an already-divided value again.
//
// It FAILS CLOSED. A money answer we cannot convert exactly stops the call —
// forwarding it raw is precisely the defect this function exists to remove.
func ConvertMoneyInputsToNaira(inputs map[string]any, paths []string) (map[string]any, error) {
	if inputs == nil {
		return nil, nil
	}
	money := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		if p != "" {
			money[p] = struct{}{}
		}
	}
	return convertMoneyMap(inputs, "", money)
}

func convertMoneyMap(in map[string]any, prefix string, money map[string]struct{}) (map[string]any, error) {
	out := make(map[string]any, len(in))
	for k, v := range in {
		path := k
		if prefix != "" {
			path = prefix + "." + k
		}
		if _, isMoney := money[path]; isMoney {
			kobo, err := koboFromInput(v)
			if err != nil {
				return nil, fmt.Errorf("mycover: money field %q: %w", path, err)
			}
			out[k] = KoboToNaira(kobo)
			continue
		}
		converted, err := convertMoneyValue(v, path, money)
		if err != nil {
			return nil, err
		}
		out[k] = converted
	}
	return out, nil
}

// convertMoneyValue recurses into the nested shapes MyCover schemas actually
// use: a `policy_holder` object (~65 products) and repeating rows such as
// office_items[] (17 products). Every row of one array shares one shape, so a
// row's children carry the array's own path with no index segment.
func convertMoneyValue(v any, path string, money map[string]struct{}) (any, error) {
	switch t := v.(type) {
	case map[string]any:
		return convertMoneyMap(t, path, money)
	case []any:
		rows := make([]any, len(t))
		for i, row := range t {
			converted, err := convertMoneyValue(row, path, money)
			if err != nil {
				return nil, err
			}
			rows[i] = converted
		}
		return rows, nil
	default:
		return v, nil
	}
}

// koboFromInput reads an integer kobo amount out of whatever shape the value
// arrived in. A money answer reaches this adapter as json.Number (a decoder
// configured with UseNumber), float64 (a map round-tripped through
// encoding/json), int/int64 (in process) or a decimal string.
//
// Every branch resolves through exact decimal arithmetic and every branch
// requires a WHOLE number of kobo: a fractional kobo is not an amount this
// system can hold, so it is refused rather than rounded silently.
func koboFromInput(v any) (int64, error) {
	var lit string
	switch t := v.(type) {
	case json.Number:
		lit = t.String()
	case string:
		lit = strings.TrimSpace(t)
	case int:
		return int64(t), nil
	case int32:
		return int64(t), nil
	case int64:
		return t, nil
	case float64:
		// FormatFloat with precision -1 yields the shortest decimal that round
		// trips, which for an integral float64 is the exact integer. The value is
		// then re-validated as a decimal literal below — no float arithmetic.
		lit = strconv.FormatFloat(t, 'f', -1, 64)
	case float32:
		lit = strconv.FormatFloat(float64(t), 'f', -1, 64)
	default:
		return 0, fmt.Errorf("%T is not a monetary amount", v)
	}

	r, err := parseDecimal(lit)
	if err != nil {
		return 0, err
	}
	if !r.IsInt() {
		return 0, fmt.Errorf("%q is not a whole number of kobo", lit)
	}
	n := r.Num()
	if !n.IsInt64() {
		return 0, fmt.Errorf("%q overflows int64 kobo", lit)
	}
	return n.Int64(), nil
}
