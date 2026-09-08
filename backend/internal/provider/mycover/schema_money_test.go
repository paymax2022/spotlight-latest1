package mycover

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"spotlight/backend/internal/insurance/gateway"
)

// liveGadgetSchema is the VERBATIM shape of
// GET /public-product-details/ffb0711c-1e4a-453b-a26c-2726e0a1a7bb, trimmed to
// the fields under test. `value` carries validation.minimum 100000, which the
// provider means as ₦100,000.
const liveGadgetSchema = `{
  "id":"ffb0711c-1e4a-453b-a26c-2726e0a1a7bb",
  "name":"Gadget Cover",
  "base_price":"5.0000",
  "product_table_data":[
    {"name":"device_make","label":"Device Make","type":"string","required":true,
     "data_source":"User input","validation":{"type":"string","min_length":2}},
    {"name":"value","label":"Device Value","type":"number","required":true,
     "description":"Enter device value","data_source":"User input",
     "validation":{"type":"number","minimum":100000}},
    {"name":"payment_plan","label":"Payment Plan","type":"number","required":false,
     "data_source":"User input","validation":{"type":"number","minimum":1,"maximum":12}},
    {"name":"product_id","label":"Product ID","type":"string","required":true,
     "data_source":"https://v2.api.mycover.ai/v2/products/all",
     "validation":{"type":"string","format":"uuid"}}
  ]
}`

func schemaFromFixture(t *testing.T, body string) *ProductSchema {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()
	s, err := New("k", "", "", srv.URL).ProductSchemaFor(context.Background(), "p")
	if err != nil {
		t.Fatalf("ProductSchemaFor: %v", err)
	}
	return s
}

func fieldNamed(t *testing.T, s *ProductSchema, name string) Field {
	t.Helper()
	for _, f := range s.Fields {
		if f.Name == name {
			return f
		}
	}
	t.Fatalf("schema has no field %q", name)
	return Field{}
}

// TestSchema_MoneyBoundsArePublishedInKoboWithAnExplicitUnit — the provider
// states its minimums in NAIRA. Published unscaled and unlabelled, a client
// reading the contract's kobo default validates ₦100,000 as ₦1,000 and lets a
// ₦1,000 phone through a ₦100,000 minimum.
func TestSchema_MoneyBoundsArePublishedInKoboWithAnExplicitUnit(t *testing.T) {
	s := schemaFromFixture(t, liveGadgetSchema)

	value := fieldNamed(t, s, "value")
	if value.Type != gateway.FieldTypeMoney {
		t.Fatalf("value type = %q, want money", value.Type)
	}
	if value.Unit != gateway.MoneyUnitKobo {
		t.Fatalf("value unit = %q, want %q — an unlabelled money bound defaults to kobo and would be read 100x too lenient",
			value.Unit, gateway.MoneyUnitKobo)
	}
	if value.Min == nil || value.Min.String() != "10000000" {
		t.Fatalf("value min = %v, want 10000000 kobo (₦100,000)", value.Min)
	}

	plan := fieldNamed(t, s, "payment_plan")
	if plan.Type != "number" {
		t.Fatalf("payment_plan type = %q, want number", plan.Type)
	}
	if plan.Unit != "" {
		t.Fatalf("payment_plan carries unit %q — an instalment count is not money", plan.Unit)
	}
	if plan.Min == nil || plan.Min.String() != "1" || plan.Max == nil || plan.Max.String() != "12" {
		t.Fatalf("payment_plan bounds = %v..%v, want 1..12 unscaled", plan.Min, plan.Max)
	}
}

// TestSchema_BoundsMarshalAsBareNumbers — the published contract's `min`/`max`
// are JSON numbers. A quoted string would break every client's parse.
func TestSchema_BoundsMarshalAsBareNumbers(t *testing.T) {
	s := schemaFromFixture(t, liveGadgetSchema)
	b, err := json.Marshal(s.AsMap())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(b)
	if !containsAll(got, `"name":"value"`, `"type":"money"`, `"min":10000000`, `"unit":"kobo"`) {
		t.Fatalf("published money field is wrong:\n%s", got)
	}
	if containsAll(got, `"min":"10000000"`) {
		t.Fatal("bounds must be bare numbers, not strings")
	}
}

// TestSchema_MoneyPathsMatchWhatTheAdapterConverts — the SYMMETRY property.
// The set of paths the adapter divides by 100 is derived from the very schema
// published to the client, so the client's ×100 and the adapter's ÷100 always
// apply to the same fields.
func TestSchema_MoneyPathsMatchWhatTheAdapterConverts(t *testing.T) {
	s := schemaFromFixture(t, liveGadgetSchema)
	published := s.AsMap()

	// Round-trip through JSON exactly as the catalog stores and re-reads it.
	raw, err := json.Marshal(published)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	stored := decodeStoredSchema(t, raw)

	paths := gateway.MoneyInputPaths(stored)
	if len(paths) != 1 || paths[0] != "value" {
		t.Fatalf("money paths = %v, want [value]", paths)
	}
}

func decodeStoredSchema(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var m map[string]any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return m
}

func containsAll(s string, subs ...string) bool {
	for _, sub := range subs {
		if !strings.Contains(s, sub) {
			return false
		}
	}
	return true
}
