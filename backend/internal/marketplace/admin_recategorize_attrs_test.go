package marketplace

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestReconcileAttrs(t *testing.T) {
	closed := json.RawMessage(`{"required":["brand","model"],"additionalProperties":false,
		"properties":{"brand":{"type":"string","enum":["samsung","lg"]},"model":{"type":"string"},"size":{"type":"number"}}}`)
	open := json.RawMessage(`{"required":["brand"],"properties":{"brand":{"type":"string"}}}`)

	cases := []struct {
		name        string
		schema      json.RawMessage
		attrs       map[string]any
		wantKept    map[string]any
		wantDropped []string
		wantMissing []string
	}{
		{"empty schema keeps everything", json.RawMessage(`{}`), map[string]any{"a": 1}, map[string]any{"a": 1}, []string{}, []string{}},
		{"no schema keeps everything", nil, map[string]any{"a": 1}, map[string]any{"a": 1}, []string{}, []string{}},
		{"malformed schema is unconstrained", json.RawMessage(`{not json`), map[string]any{"a": 1}, map[string]any{"a": 1}, []string{}, []string{}},
		{"valid attrs survive, required met",
			closed, map[string]any{"brand": "samsung", "model": "QN90"}, map[string]any{"brand": "samsung", "model": "QN90"}, []string{}, []string{}},
		{"undeclared key dropped when schema is closed",
			closed, map[string]any{"brand": "lg", "model": "C3", "body_type": "suv"}, map[string]any{"brand": "lg", "model": "C3"}, []string{"body_type"}, []string{}},
		{"value outside the enum is dropped, then reported missing",
			closed, map[string]any{"brand": "toyota", "model": "Corolla"}, map[string]any{"model": "Corolla"}, []string{"brand"}, []string{"brand"}},
		{"wrong type dropped",
			closed, map[string]any{"brand": "lg", "model": "C3", "size": "big"}, map[string]any{"brand": "lg", "model": "C3"}, []string{"size"}, []string{}},
		{"nothing carried over -> every required key missing, sorted",
			closed, map[string]any{}, map[string]any{}, []string{}, []string{"brand", "model"}},
		{"null is not carried and does not satisfy required",
			open, map[string]any{"brand": nil}, map[string]any{}, []string{}, []string{"brand"}},
		{"open schema keeps undeclared keys",
			open, map[string]any{"brand": "x", "anything": true}, map[string]any{"brand": "x", "anything": true}, []string{}, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := map[string]any{}
			for k, v := range tc.attrs {
				in[k] = v
			}
			kept, dropped, missing := reconcileAttrs(tc.schema, tc.attrs)
			if !reflect.DeepEqual(kept, tc.wantKept) {
				t.Errorf("kept = %v, want %v", kept, tc.wantKept)
			}
			if !reflect.DeepEqual(dropped, tc.wantDropped) {
				t.Errorf("dropped = %v, want %v", dropped, tc.wantDropped)
			}
			if !reflect.DeepEqual(missing, tc.wantMissing) {
				t.Errorf("missing = %v, want %v", missing, tc.wantMissing)
			}
			if !reflect.DeepEqual(in, tc.attrs) {
				t.Errorf("reconcileAttrs mutated its input: %v -> %v", in, tc.attrs)
			}
		})
	}
}

func TestHumanizeKeys(t *testing.T) {
	if got := humanizeKeys([]string{"screen_size", "brand"}); got != "screen size, brand" {
		t.Fatalf("humanizeKeys = %q", got)
	}
}
