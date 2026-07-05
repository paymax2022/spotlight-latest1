package estate

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestParseAINoteResultValid(t *testing.T) {
	raw := json.RawMessage(`{
	  "summary": "Quarterly dues reviewed; pool repair approved.",
	  "action_items": [ {"task":"Get plumber quotes","assignee":"Ada","due_date":"2026-07-01"} ],
	  "decisions": [ "Approve pool repair budget" ],
	  "unresolved": [ "Gate motor replacement timing" ]
	}`)
	summary, ai, dec, err := parseAINoteResult(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(summary, "pool repair") {
		t.Errorf("summary not parsed: %q", summary)
	}
	var items []map[string]any
	if json.Unmarshal(ai, &items) != nil || len(items) != 1 {
		t.Errorf("action_items not parsed: %s", ai)
	}
	// decisions + unresolved are merged so nothing is dropped.
	var decs []any
	if json.Unmarshal(dec, &decs) != nil || len(decs) != 2 {
		t.Errorf("decisions should merge unresolved (want 2): %s", dec)
	}
}

func TestParseAINoteResultMissingSummary(t *testing.T) {
	if _, _, _, err := parseAINoteResult(json.RawMessage(`{"action_items":[]}`)); err == nil {
		t.Error("expected error when summary is missing")
	}
}

func TestParseAINoteResultBadJSON(t *testing.T) {
	if _, _, _, err := parseAINoteResult(json.RawMessage(`not json`)); err == nil {
		t.Error("expected error on malformed JSON")
	}
}

func TestParseAINoteResultEmptyArraysDefault(t *testing.T) {
	summary, ai, dec, err := parseAINoteResult(json.RawMessage(`{"summary":"x"}`))
	if err != nil || summary != "x" {
		t.Fatalf("err=%v summary=%q", err, summary)
	}
	if string(ai) != "[]" || string(dec) != "[]" {
		t.Errorf("empty arrays expected, got ai=%s dec=%s", ai, dec)
	}
}

// stubLLM lets us exercise the disabled-client fail-closed path without network.
type stubLLM struct{ enabled bool }

func (s stubLLM) Enabled() bool { return s.enabled }
func (s stubLLM) Model() string { return "claude-sonnet-4-6" }
func (s stubLLM) GenerateJSON(ctx context.Context, sys, usr string) (json.RawMessage, error) {
	return json.RawMessage(`{"summary":"ok"}`), nil
}

func TestLLMGeneratorInterfaceSatisfied(t *testing.T) {
	var g LLMGenerator = stubLLM{enabled: true}
	if g.Model() != "claude-sonnet-4-6" {
		t.Errorf("model = %q, want claude-sonnet-4-6", g.Model())
	}
}
