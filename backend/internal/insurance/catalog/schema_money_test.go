package catalog

import (
	"encoding/json"
	"testing"

	"spotlight/backend/internal/insurance/gateway"
)

// legacyStoredSchema is a form_schema exactly as rows synced BEFORE the money
// unit was settled still hold it: the provider's naira minimum, published raw,
// with nothing saying which unit it is in.
const legacyStoredSchema = `{"fields":[
	{"name":"value","label":"Device Value","type":"money","required":true,"min":100000},
	{"name":"payment_plan","label":"Payment Plan","type":"number","min":1,"max":12},
	{"name":"product_id","label":"Product ID","type":"hidden","system":true}
]}`

// TestDecodeStoredSchema_FixesLegacyMoneyBoundsOnRead — the sync now stores kobo
// bounds, but ~69 rows were synced before it did. Those rows are read on every
// member request, so the READ path has to correct them: an unscaled ₦100,000
// minimum is enforced by a client as ₦1,000, which lets a ₦1,000 phone through
// a ₦100,000 floor and gets it rejected at the insurer instead.
func TestDecodeStoredSchema_FixesLegacyMoneyBoundsOnRead(t *testing.T) {
	schema := decodeStoredSchema([]byte(legacyStoredSchema))
	if schema == nil {
		t.Fatal("stored schema did not decode")
	}
	gateway.NormalizeMoneyBounds(schema)

	fields, _ := schema["fields"].([]any)
	value, _ := fields[0].(map[string]any)
	if got := value["min"]; got.(json.Number).String() != "10000000" {
		t.Fatalf("published min = %v, want 10000000 kobo (₦100,000)", got)
	}
	if value["unit"] != gateway.MoneyUnitKobo {
		t.Fatalf("published unit = %v, want %q", value["unit"], gateway.MoneyUnitKobo)
	}

	plan, _ := fields[1].(map[string]any)
	if got := plan["min"].(json.Number).String(); got != "1" {
		t.Fatalf("payment_plan min = %s, want 1 — an instalment count is not money", got)
	}
	if _, tagged := plan["unit"]; tagged {
		t.Fatal("a non-money field must not be given a money unit")
	}
}

// TestDecodeStoredSchema_UsesNumberNotFloat — a bound decoded as float64 cannot
// be scaled exactly, and float64 is banned from every money path. The decoder
// must hand back exact decimals or the normaliser drops the bound rather than
// publishing it at the wrong magnitude.
func TestDecodeStoredSchema_UsesNumberNotFloat(t *testing.T) {
	schema := decodeStoredSchema([]byte(legacyStoredSchema))
	fields, _ := schema["fields"].([]any)
	value, _ := fields[0].(map[string]any)
	if _, isFloat := value["min"].(float64); isFloat {
		t.Fatal("bounds decoded as float64 — decodeStoredSchema must use UseNumber")
	}
	if _, isNumber := value["min"].(json.Number); !isNumber {
		t.Fatalf("bound is %T, want json.Number", value["min"])
	}
}

// TestResolveProductMoneySpec_MatchesThePublishedSchema — the paths the adapter
// converts come from the same decode the member's form is published from, so
// the client's ×100 and the adapter's ÷100 apply to the same fields.
func TestResolveProductMoneySpec_MatchesThePublishedSchema(t *testing.T) {
	schema := decodeStoredSchema([]byte(legacyStoredSchema))
	gateway.NormalizeMoneyBounds(schema)

	if !hasSchemaFields(schema) {
		t.Fatal("a schema with fields must be reported as known")
	}
	paths := gateway.MoneyInputPaths(schema)
	if len(paths) != 1 || paths[0] != "value" {
		t.Fatalf("money paths = %v, want [value]", paths)
	}
}

// TestDecodeStoredSchema_EmptyIsUnknown — a row with no schema must report
// UNKNOWN, not "no money fields". The adapter fails closed on unknown, because
// forwarding answers whose unit we cannot establish is the original bug.
func TestDecodeStoredSchema_EmptyIsUnknown(t *testing.T) {
	for name, raw := range map[string]string{
		"null bytes": "",
		"json null":  "null",
		"not an obj": "[]",
	} {
		if got := decodeStoredSchema([]byte(raw)); got != nil {
			t.Fatalf("%s: decoded to %v, want nil", name, got)
		}
	}
	if hasSchemaFields(decodeStoredSchema([]byte(`{"fields":[]}`))) {
		t.Fatal("a schema with no fields must not count as known")
	}
}
