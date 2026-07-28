package marketplace

import (
	"encoding/json"
	"testing"
)

// carSchema is a representative category attribute_schema (Cars): required make+year,
// enum make, integer year with a floor, boolean negotiable, no extra keys.
const carSchema = `{
	"required": ["make", "year"],
	"additionalProperties": false,
	"properties": {
		"make":       {"type": "string", "enum": ["toyota", "honda", "lexus"]},
		"year":       {"type": "integer", "minimum": 1990, "maximum": 2026},
		"negotiable": {"type": "boolean"}
	}
}`

func TestValidateAttrs(t *testing.T) {
	cases := []struct {
		name    string
		schema  string
		attrs   map[string]any
		wantErr bool
	}{
		{"empty schema accepts anything", `{}`, map[string]any{"whatever": 1}, false},
		{"nil schema accepts anything", ``, map[string]any{"whatever": 1}, false},
		{"valid full", carSchema, map[string]any{"make": "toyota", "year": 2015, "negotiable": true}, false},
		{"valid minimal (only required)", carSchema, map[string]any{"make": "honda", "year": 2000}, false},
		{"missing required year", carSchema, map[string]any{"make": "toyota"}, true},
		{"missing required make", carSchema, map[string]any{"year": 2015}, true},
		{"required present but null", carSchema, map[string]any{"make": nil, "year": 2015}, true},
		{"enum violation", carSchema, map[string]any{"make": "ferrari", "year": 2015}, true},
		{"year below minimum", carSchema, map[string]any{"make": "toyota", "year": 1980}, true},
		{"year above maximum", carSchema, map[string]any{"make": "toyota", "year": 3000}, true},
		{"year wrong type (string)", carSchema, map[string]any{"make": "toyota", "year": "2015"}, true},
		{"year not integer", carSchema, map[string]any{"make": "toyota", "year": 2015.5}, true},
		{"negotiable wrong type", carSchema, map[string]any{"make": "toyota", "year": 2015, "negotiable": "yes"}, true},
		{"additionalProperties false rejects extra", carSchema, map[string]any{"make": "toyota", "year": 2015, "color": "red"}, true},
		{"float year that is whole is ok", carSchema, map[string]any{"make": "toyota", "year": 2015.0}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var schema json.RawMessage
			if c.schema != "" {
				schema = json.RawMessage(c.schema)
			}
			err := validateAttrs(schema, c.attrs)
			if (err != nil) != c.wantErr {
				t.Fatalf("validateAttrs() err=%v, wantErr=%v", err, c.wantErr)
			}
		})
	}
}

// A category schema WITHOUT additionalProperties:false must allow undeclared keys.
func TestValidateAttrs_AdditionalPropsDefaultAllowed(t *testing.T) {
	schema := json.RawMessage(`{"properties":{"make":{"type":"string"}}}`)
	if err := validateAttrs(schema, map[string]any{"make": "toyota", "extra": "ok"}); err != nil {
		t.Fatalf("undeclared key should be allowed when additionalProperties is unset: %v", err)
	}
}

// A malformed category schema must never hard-fail a seller write (fail-open: the
// category is admin-authored; a broken schema is an admin problem, not the seller's).
func TestValidateAttrs_MalformedSchemaFailsOpen(t *testing.T) {
	if err := validateAttrs(json.RawMessage(`{not valid json`), map[string]any{"x": 1}); err != nil {
		t.Fatalf("malformed schema must fail open, got %v", err)
	}
}
