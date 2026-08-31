package marketplace

import (
	"encoding/json"
	"fmt"
	"math"
)

// Attribute-schema validation (§1: "attrs validated against category.attribute_schema
// at write time"). The migration calls the schema "draft-07 JSON-schema", but the
// marketplace only ever uses a small, well-defined subset — required, per-property
// type (string/boolean/number/integer/array), enum, numeric minimum/maximum, array
// items/minItems/maxItems, and additionalProperties:false. We validate exactly that
// subset with no external dependency. An empty schema ({}) accepts any attrs, so
// every currently-seeded category stays backward-compatible.
//
// A category's attribute_schema JSONB may also carry a sibling top-level "fields"
// array consumed only by the mobile client (form rendering: widget type, label,
// group, options, unit, placeholder — see mobile-app/reactnative/src/features/
// marketplace/api/sell.mock.ts AttributeField). This validator ignores "fields"
// entirely; it only reads required/properties/additionalProperties.

// attrSchema is the supported subset of a category's attribute_schema.
type attrSchema struct {
	Required             []string                  `json:"required"`
	Properties           map[string]attrPropSchema `json:"properties"`
	AdditionalProperties *bool                     `json:"additionalProperties"`
}

type attrPropSchema struct {
	Type     string          `json:"type"` // string | number | integer | boolean | array
	Enum     []interface{}   `json:"enum"`
	Minimum  *float64        `json:"minimum"`
	Maximum  *float64        `json:"maximum"`
	Items    *attrPropSchema `json:"items"`    // element schema, only consulted when Type == "array"
	MinItems *int            `json:"minItems"` // only consulted when Type == "array"
	MaxItems *int            `json:"maxItems"` // only consulted when Type == "array"
}

// validateAttrs checks attrs against a category's attribute_schema. A nil/empty
// schema or nil attrs is permitted (accepts anything). It returns a typed
// CodeValidation error naming the offending attribute so callers get a 422.
func validateAttrs(schemaJSON json.RawMessage, attrs map[string]any) error {
	if len(schemaJSON) == 0 {
		return nil
	}
	var sc attrSchema
	if err := json.Unmarshal(schemaJSON, &sc); err != nil {
		// A malformed category schema must never hard-fail seller writes; treat as
		// "no constraints" (categories are admin-authored and validated on write).
		return nil
	}
	if len(sc.Required) == 0 && len(sc.Properties) == 0 {
		return nil // empty {} schema: unconstrained
	}
	if attrs == nil {
		attrs = map[string]any{}
	}

	// Required keys must be present and non-null.
	for _, key := range sc.Required {
		v, ok := attrs[key]
		if !ok || v == nil {
			return fieldErr(CodeValidation, "missing required attribute: "+key, "attrs."+key)
		}
	}

	// additionalProperties:false rejects any attr not named in properties.
	if sc.AdditionalProperties != nil && !*sc.AdditionalProperties {
		for key := range attrs {
			if _, declared := sc.Properties[key]; !declared {
				return fieldErr(CodeValidation, "unknown attribute not allowed: "+key, "attrs."+key)
			}
		}
	}

	// Per-property type / enum / range checks (only for keys actually supplied).
	for key, prop := range sc.Properties {
		v, ok := attrs[key]
		if !ok || v == nil {
			continue // presence is governed by Required, not here
		}
		if err := checkProp(key, prop, v); err != nil {
			return err
		}
	}
	return nil
}

func checkProp(key string, prop attrPropSchema, v any) error {
	switch prop.Type {
	case "string":
		if _, ok := v.(string); !ok {
			return typeErr(key, "string")
		}
	case "boolean":
		if _, ok := v.(bool); !ok {
			return typeErr(key, "boolean")
		}
	case "number", "integer":
		f, ok := toFloat(v)
		if !ok {
			return typeErr(key, prop.Type)
		}
		if prop.Type == "integer" && f != math.Trunc(f) {
			return typeErr(key, "integer")
		}
		if prop.Minimum != nil && f < *prop.Minimum {
			return fieldErr(CodeValidation, fmt.Sprintf("attribute %s must be ≥ %v", key, *prop.Minimum), "attrs."+key)
		}
		if prop.Maximum != nil && f > *prop.Maximum {
			return fieldErr(CodeValidation, fmt.Sprintf("attribute %s must be ≤ %v", key, *prop.Maximum), "attrs."+key)
		}
	case "array":
		arr, ok := v.([]interface{})
		if !ok {
			return typeErr(key, "array")
		}
		if prop.MinItems != nil && len(arr) < *prop.MinItems {
			return fieldErr(CodeValidation, fmt.Sprintf("attribute %s must have at least %d item(s)", key, *prop.MinItems), "attrs."+key)
		}
		if prop.MaxItems != nil && len(arr) > *prop.MaxItems {
			return fieldErr(CodeValidation, fmt.Sprintf("attribute %s must have at most %d item(s)", key, *prop.MaxItems), "attrs."+key)
		}
		if prop.Items != nil {
			for _, elem := range arr {
				if err := checkProp(key, *prop.Items, elem); err != nil {
					return err
				}
			}
		}
	case "":
		// no declared type: only enum (if any) constrains it
	default:
		// unsupported type keyword: don't constrain (forward-compatible)
	}

	if len(prop.Enum) > 0 && !enumContains(prop.Enum, v) {
		return fieldErr(CodeValidation, "attribute "+key+" is not an allowed value", "attrs."+key)
	}
	return nil
}

func typeErr(key, want string) error {
	return fieldErr(CodeValidation, "attribute "+key+" must be a "+want, "attrs."+key)
}

// toFloat normalizes the JSON number forms that can reach attrs (json.Number,
// float64 from a decoded body, or native ints from Go callers).
func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case float32:
		return float64(n), true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// enumContains compares scalars by value, coercing numbers so 2015 (int) matches
// 2015 (float64 from a decoded schema).
func enumContains(enum []interface{}, v any) bool {
	if vf, ok := toFloat(v); ok {
		for _, e := range enum {
			if ef, ok := toFloat(e); ok && ef == vf {
				return true
			}
		}
	}
	for _, e := range enum {
		if e == v {
			return true
		}
	}
	return false
}
