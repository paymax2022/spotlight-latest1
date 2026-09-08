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

// featuresSchema is representative of a multiselect field (e.g. Cars → Features):
// an array of enum-constrained strings, with a minItems/maxItems bound.
const featuresSchema = `{
	"properties": {
		"features": {
			"type": "array",
			"minItems": 1,
			"maxItems": 3,
			"items": {"type": "string", "enum": ["ac", "sunroof", "reverse_camera"]}
		}
	}
}`

func TestValidateAttrs_ArrayType(t *testing.T) {
	cases := []struct {
		name    string
		attrs   map[string]any
		wantErr bool
	}{
		{"valid subset", map[string]any{"features": []interface{}{"ac", "sunroof"}}, false},
		{"empty array below minItems", map[string]any{"features": []interface{}{}}, true},
		{"too many items above maxItems", map[string]any{"features": []interface{}{"ac", "sunroof", "reverse_camera", "ac"}}, true},
		{"element not in enum", map[string]any{"features": []interface{}{"ac", "turbo"}}, true},
		{"wrong type (not an array)", map[string]any{"features": "ac"}, true},
		{"absent key is fine (not required)", map[string]any{}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateAttrs(json.RawMessage(featuresSchema), c.attrs)
			if (err != nil) != c.wantErr {
				t.Fatalf("validateAttrs() err=%v, wantErr=%v", err, c.wantErr)
			}
		})
	}
}

// realCarsSchema is the ACTUAL backend half of the "cars" attribute_schema as
// generated for the marketplace listing-system PRD enrichment (verified against
// a live local Postgres: supabase/migrations/20270151000000_marketplace_attribute_schemas.sql
// applied cleanly and this is the exact stored JSON's required/properties/
// additionalProperties, minus the client-only "fields" key this validator ignores).
const realCarsSchema = `{"required": ["body_type", "brand", "model", "year", "price_type", "transmission", "fuel_type", "colour", "accident_history"], "properties": {"body_type": {"type": "string", "enum": ["sedan", "suv", "hatchback", "coupe", "convertible", "pickup", "minivan", "station_wagon"]}, "brand": {"type": "string"}, "model": {"type": "string"}, "year": {"type": "number", "minimum": 1980, "maximum": 2026}, "salvage_title": {"type": "boolean"}, "price_type": {"type": "string", "enum": ["fixed", "negotiable", "swap", "poa"]}, "transmission": {"type": "string", "enum": ["automatic", "manual", "cvt", "semi_automatic"]}, "fuel_type": {"type": "string", "enum": ["petrol", "diesel", "electric", "hybrid", "cng"]}, "mileage": {"type": "number"}, "colour": {"type": "string", "enum": ["black", "white", "silver", "gray", "red", "blue", "green", "yellow", "brown", "gold", "other"]}, "vin": {"type": "string"}, "seats": {"type": "integer", "minimum": 2, "maximum": 9}, "doors": {"type": "string", "enum": ["2", "3", "4", "5"]}, "drive_type": {"type": "string", "enum": ["fwd", "rwd", "awd", "4wd"]}, "engine_size": {"type": "number"}, "horsepower": {"type": "number"}, "features": {"type": "array", "items": {"type": "string", "enum": ["ac", "navigation", "sunroof", "leather_seats", "reverse_camera", "bluetooth", "alloy_wheels", "keyless_entry", "cruise_control", "heated_seats"]}}, "accident_history": {"type": "string", "enum": ["no_accident", "minor", "major", "unknown"]}, "previous_owners": {"type": "integer", "minimum": 1, "maximum": 5}}, "additionalProperties": false}`

func TestValidateAttrs_RealSeededCarsSchema(t *testing.T) {
	validSubmission := map[string]any{
		"body_type":        "suv",
		"brand":            "Toyota",
		"model":            "Land Cruiser",
		"year":             2019,
		"price_type":       "negotiable",
		"transmission":     "automatic",
		"fuel_type":        "petrol",
		"colour":           "black",
		"accident_history": "no_accident",
		"mileage":          45000,
		"seats":            7,
		"features":         []interface{}{"ac", "reverse_camera", "bluetooth"},
		"salvage_title":    false,
	}
	if err := validateAttrs(json.RawMessage(realCarsSchema), validSubmission); err != nil {
		t.Fatalf("realistic valid Cars submission was rejected: %v", err)
	}

	cases := []struct {
		name    string
		mutate  func(map[string]any)
		wantErr bool
	}{
		{"missing required brand", func(m map[string]any) { delete(m, "brand") }, true},
		{"invalid body_type enum", func(m map[string]any) { m["body_type"] = "spaceship" }, true},
		{"year below floor", func(m map[string]any) { m["year"] = 1975 }, true},
		{"seats above stepper max", func(m map[string]any) { m["seats"] = 20 }, true},
		{"unknown attribute rejected (strict schema)", func(m map[string]any) { m["turbo_boost"] = true }, true},
		{"feature not in enum", func(m map[string]any) { m["features"] = []interface{}{"nitro"} }, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			attrs := map[string]any{}
			for k, v := range validSubmission {
				attrs[k] = v
			}
			c.mutate(attrs)
			err := validateAttrs(json.RawMessage(realCarsSchema), attrs)
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
