package gateway

import (
	"encoding/json"
	"math/big"
	"regexp"
	"sort"
	"strings"
)

// ════════════════════════════════════════════════════════════════════════════
// THE MONEY UNIT SEAM — the contract between the form schema and the adapter
// ════════════════════════════════════════════════════════════════════════════
//
// A product's form schema classifies each input. One of those labels, `money`,
// is LOAD-BEARING: it is the only thing that says a value is denominated, and
// therefore the only thing that says a scale must be applied when the value
// crosses into a provider that speaks a different unit.
//
// MyCover's form inputs are denominated in NAIRA. Paymax's iron rule is INTEGER
// KOBO, and every client submits kobo. For a long time nothing converted between
// them — the client scaled up because the schema said `money`, and the adapter
// forwarded the answers verbatim — so every declared value reached the insurer
// 100x too large. Proven live on a 5%-rated gadget product: a ₦200,000 phone was
// quoted ₦1,000,000 instead of ₦10,000.
//
// The fix is one rule, stated here so both sides read it from the same place:
//
//	A money input crosses EVERY internal boundary in kobo (MoneyInputWireUnit).
//	The PROVIDER ADAPTER converts to the provider's unit exactly once, for
//	exactly the field paths this file derives from the SAME schema the client
//	rendered.
//
// Deriving the field set from the published schema is what makes a name-based
// `money` heuristic safe. A misclassified field is multiplied by 100 by the
// client and divided by 100 by the adapter, and round-trips to identity. A
// design where either side decided independently which fields are money would
// not have that property, and a wrong guess would become a money bug.

// FieldTypeMoney is the schema field-type label that marks an input as a
// monetary amount. It is not presentational: see the note above.
const FieldTypeMoney = "money"

// MoneyUnitKobo is the value of a money field's `unit` in the published schema.
const MoneyUnitKobo = "kobo"

// MoneyInputWireUnit is the unit EVERY money-typed form input is carried in
// across the internal API — client → backend → adapter. The adapter converts out
// of it; nothing else may.
//
// Clients declare the same constant on their side and a regression test in each
// lane compares the two, so the two halves of this seam cannot drift apart
// silently again. It is spelled out as a LITERAL rather than aliasing
// MoneyUnitKobo so those tests can read it out of this file without evaluating
// Go; a unit test asserts the two stay equal.
const MoneyInputWireUnit = "kobo"

// schemaFieldsKey / schemaChildrenKey are the published contract's own keys.
const (
	schemaFieldsKey   = "fields"
	schemaChildrenKey = "children"
	schemaNameKey     = "name"
	schemaTypeKey     = "type"
	schemaUnitKey     = "unit"
	schemaMinKey      = "min"
	schemaMaxKey      = "max"
)

// MoneyInputPaths returns the dot-separated path of every input a stored form
// schema classified as `money`, sorted so the result is stable.
//
// Nested shapes are included: an object's child is `policy_holder.annual_income`
// and a repeating row's child is `office_items.item_value`. Array rows add no
// index segment — every row of one array shares one shape and therefore one path.
//
// The schema passed in MUST be the one published to clients. That identity is
// the whole safety argument.
func MoneyInputPaths(schema map[string]any) []string {
	if schema == nil {
		return nil
	}
	var out []string
	collectMoneyPaths(schema[schemaFieldsKey], "", &out)
	sort.Strings(out)
	return out
}

func collectMoneyPaths(fields any, prefix string, out *[]string) {
	list, ok := fields.([]any)
	if !ok {
		return
	}
	for _, raw := range list {
		f, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name, _ := f[schemaNameKey].(string)
		if name == "" {
			continue
		}
		path := name
		if prefix != "" {
			path = prefix + "." + name
		}
		if t, _ := f[schemaTypeKey].(string); t == FieldTypeMoney {
			*out = append(*out, path)
		}
		collectMoneyPaths(f[schemaChildrenKey], path, out)
	}
}

// NormalizeMoneyBounds rewrites a stored form schema so every `money` field's
// bounds are published in KOBO and SAY so.
//
// The provider states its own minimums in naira (`value >= 100000` means
// ₦100,000). Published unscaled and unlabelled, a client applying the contract's
// kobo default validates that as ₦1,000 — a minimum 100x too lenient, which lets
// a ₦1,000 phone through a ₦100,000 floor and gets it rejected at the insurer.
//
// Publishing kobo bounds (rather than naira ones plus a `unit: naira` tag) is
// deliberate: a client that ignores `unit` entirely still enforces the right
// magnitude, because kobo is what the contract defaults to.
//
// It is IDEMPOTENT — a field that already carries a `unit` is left alone — so it
// is safe to run on both freshly synced schemas and rows stored before this
// existed. It mutates in place and never introduces a float64.
func NormalizeMoneyBounds(schema map[string]any) {
	if schema == nil {
		return
	}
	normalizeMoneyFields(schema[schemaFieldsKey])
}

func normalizeMoneyFields(fields any) {
	list, ok := fields.([]any)
	if !ok {
		return
	}
	for _, raw := range list {
		f, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if t, _ := f[schemaTypeKey].(string); t == FieldTypeMoney {
			if _, already := f[schemaUnitKey]; !already {
				scaleBoundToKobo(f, schemaMinKey)
				scaleBoundToKobo(f, schemaMaxKey)
				f[schemaUnitKey] = MoneyUnitKobo
			}
		}
		normalizeMoneyFields(f[schemaChildrenKey])
	}
}

func scaleBoundToKobo(field map[string]any, key string) {
	v, present := field[key]
	if !present || v == nil {
		return
	}
	kobo, ok := nairaBoundToKobo(v)
	if !ok {
		// A bound we cannot scale exactly is deleted rather than published at
		// the wrong magnitude: no minimum at all is honest, a 100x-lenient one
		// is a money bug wearing a validation rule's clothes.
		delete(field, key)
		return
	}
	field[key] = kobo
}

// boundDecimalRe matches a plain decimal literal. It deliberately rejects the
// exponent and rational forms big.Rat.SetString would otherwise accept: a bound
// arriving in either shape means the schema contract changed and we must stop
// interpreting it, not guess.
var boundDecimalRe = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?$`)

// nairaBoundToKobo multiplies an exact decimal bound by 100, rounding half-up to
// the kobo. Exact rational arithmetic throughout — float64 is never an
// intermediate, because float64(100000.5)*100 is the kind of drift that turns a
// validation rule into a money bug.
func nairaBoundToKobo(v any) (json.Number, bool) {
	var lit string
	switch n := v.(type) {
	case json.Number:
		lit = n.String()
	case string:
		lit = n
	default:
		// A float64 here means the schema was decoded without UseNumber. Refuse
		// rather than launder an inexact value into a published bound.
		return "", false
	}
	lit = strings.TrimSpace(lit)
	if !boundDecimalRe.MatchString(lit) {
		return "", false
	}
	r, ok := new(big.Rat).SetString(lit)
	if !ok {
		return "", false
	}
	r.Mul(r, new(big.Rat).SetInt64(100))

	// floor((2n + d) / 2d) — half-up for non-negative values, and bounds are
	// non-negative in every schema the provider publishes.
	num := new(big.Int).Mul(r.Num(), big.NewInt(2))
	num.Add(num, r.Denom())
	den := new(big.Int).Mul(r.Denom(), big.NewInt(2))
	q := new(big.Int).Div(num, den)
	return json.Number(q.String()), true
}
