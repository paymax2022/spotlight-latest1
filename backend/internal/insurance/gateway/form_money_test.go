package gateway

import (
	"bytes"
	"encoding/json"
	"reflect"
	"testing"
)

// decodeSchema mirrors how the catalog reads a stored form_schema: numbers stay
// json.Number so no float64 ever touches a bound.
func decodeSchema(t *testing.T, raw string) map[string]any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader([]byte(raw)))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		t.Fatalf("decode schema: %v", err)
	}
	return m
}

// TestMoneyInputPaths_FindsEveryMoneyField — the adapter converts EXACTLY the
// fields the published schema labelled `money`. That set is what makes the
// conversion symmetric with what the client scaled, so it must come from the
// same schema and nothing else.
func TestMoneyInputPaths_FindsEveryMoneyField(t *testing.T) {
	schema := decodeSchema(t, `{"fields":[
		{"name":"value","type":"money","min":100000},
		{"name":"device_make","type":"text"},
		{"name":"payment_plan","type":"number","min":1,"max":12},
		{"name":"policy_holder","type":"object","children":[
			{"name":"first_name","type":"text"},
			{"name":"annual_income","type":"money"}
		]},
		{"name":"office_items","type":"array","children":[
			{"name":"description","type":"text"},
			{"name":"item_value","type":"money"}
		]},
		{"name":"product_id","type":"hidden"}
	]}`)

	got := MoneyInputPaths(schema)
	want := []string{"office_items.item_value", "policy_holder.annual_income", "value"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("money paths = %v, want %v", got, want)
	}
}

func TestMoneyInputPaths_EmptyAndMalformedSchemasAreSafe(t *testing.T) {
	for name, raw := range map[string]string{
		"no fields":    `{}`,
		"empty fields": `{"fields":[]}`,
		"junk fields":  `{"fields":["nope",42,null,{"type":"money"}]}`,
	} {
		if got := MoneyInputPaths(decodeSchema(t, raw)); len(got) != 0 {
			t.Fatalf("%s: got %v, want none", name, got)
		}
	}
	if got := MoneyInputPaths(nil); len(got) != 0 {
		t.Fatalf("nil schema: got %v", got)
	}
}

// TestNormalizeMoneyBounds_PublishesKoboBoundsWithAnExplicitUnit — the provider
// states `value >= 100000` meaning ₦100,000. Published unscaled with no unit, a
// client that (correctly) reads the contract's default of kobo validates it as
// ₦1,000 — a minimum 100x too lenient. The published bound must be kobo and must
// SAY it is kobo, so a client that ignores `unit` still gets it right.
func TestNormalizeMoneyBounds_PublishesKoboBoundsWithAnExplicitUnit(t *testing.T) {
	schema := decodeSchema(t, `{"fields":[
		{"name":"value","type":"money","min":100000,"max":5000000},
		{"name":"payment_plan","type":"number","min":1,"max":12}
	]}`)

	NormalizeMoneyBounds(schema)

	fields, _ := schema["fields"].([]any)
	money, _ := fields[0].(map[string]any)
	if got := money["unit"]; got != MoneyUnitKobo {
		t.Fatalf("money unit = %v, want %q", got, MoneyUnitKobo)
	}
	if got := jsonNum(t, money["min"]); got != "10000000" {
		t.Fatalf("min = %s kobo, want 10000000 (₦100,000)", got)
	}
	if got := jsonNum(t, money["max"]); got != "500000000" {
		t.Fatalf("max = %s kobo, want 500000000 (₦5,000,000)", got)
	}

	plain, _ := fields[1].(map[string]any)
	if _, tagged := plain["unit"]; tagged {
		t.Fatal("a non-money field must not be given a money unit")
	}
	if got := jsonNum(t, plain["min"]); got != "1" {
		t.Fatalf("payment_plan min = %s, want 1 — a plan count is not money", got)
	}
}

// TestNormalizeMoneyBounds_IsIdempotent — the normaliser runs on every read AND
// the sync now stores already-normalised schemas. Running it twice must not
// scale a bound to 100x, which would be the same class of bug in the other
// direction.
func TestNormalizeMoneyBounds_IsIdempotent(t *testing.T) {
	schema := decodeSchema(t, `{"fields":[{"name":"value","type":"money","min":100000}]}`)
	NormalizeMoneyBounds(schema)
	first := jsonNum(t, firstField(t, schema)["min"])
	NormalizeMoneyBounds(schema)
	NormalizeMoneyBounds(schema)
	if got := jsonNum(t, firstField(t, schema)["min"]); got != first {
		t.Fatalf("re-normalising moved the bound: %s then %s", first, got)
	}
	if first != "10000000" {
		t.Fatalf("min = %s, want 10000000", first)
	}
}

// TestNormalizeMoneyBounds_RecursesIntoNestedShapes — ~65 products nest a
// policy_holder object and 17 carry repeating rows; a money bound inside one is
// as load-bearing as a top-level one.
func TestNormalizeMoneyBounds_RecursesIntoNestedShapes(t *testing.T) {
	schema := decodeSchema(t, `{"fields":[
		{"name":"office_items","type":"array","children":[
			{"name":"item_value","type":"money","min":5000}
		]}
	]}`)
	NormalizeMoneyBounds(schema)
	rows, _ := firstField(t, schema)["children"].([]any)
	child, _ := rows[0].(map[string]any)
	if got := jsonNum(t, child["min"]); got != "500000" {
		t.Fatalf("nested min = %s kobo, want 500000 (₦5,000)", got)
	}
	if child["unit"] != MoneyUnitKobo {
		t.Fatalf("nested unit = %v", child["unit"])
	}
}

// TestNormalizeMoneyBounds_NeverUsesFloat64 — a bound must survive as an exact
// decimal. float64 is banned from every money path, and a float64 bound is how
// 100000 becomes 9999999.999999998.
func TestNormalizeMoneyBounds_NeverUsesFloat64(t *testing.T) {
	schema := decodeSchema(t, `{"fields":[{"name":"value","type":"money","min":100000.5}]}`)
	NormalizeMoneyBounds(schema)
	min := firstField(t, schema)["min"]
	if _, isFloat := min.(float64); isFloat {
		t.Fatalf("bound came back as float64 (%v) — money bounds are exact decimals", min)
	}
	if got := jsonNum(t, min); got != "10000050" {
		t.Fatalf("min = %s kobo, want 10000050", got)
	}
}

func firstField(t *testing.T, schema map[string]any) map[string]any {
	t.Helper()
	fields, _ := schema["fields"].([]any)
	if len(fields) == 0 {
		t.Fatal("schema has no fields")
	}
	f, _ := fields[0].(map[string]any)
	return f
}

func jsonNum(t *testing.T, v any) string {
	t.Helper()
	n, ok := v.(json.Number)
	if !ok {
		t.Fatalf("value %v (%T) is not a json.Number", v, v)
	}
	return n.String()
}
