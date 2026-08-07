package labref

import "testing"

// TS-11 LR-002 (reference ranges → flag abnormal), LR-003 (critical/panic value),
// LR-008 / TS-18 EC-002 (unit integrity). Deterministic, executed assertions on
// the pure interpretation engine — no DB, no analyzer feed.

func TestInterpretNormal(t *testing.T) {
	got := Interpret("potassium", "4.2", "mmol/L", "3.5-5.1")
	if got.Status != StatusNormal || got.Escalate {
		t.Fatalf("in-range value should be NORMAL, no escalation: %+v", got)
	}
}

// LR-002: out-of-range (but not panic) is ABNORMAL and escalates.
func TestInterpretAbnormalHigh(t *testing.T) {
	got := Interpret("potassium", "5.8", "mmol/L", "3.5-5.1")
	if got.Status != StatusAbnormal || !got.Escalate {
		t.Fatalf("5.8 (>5.1, <6.0 crit) should be ABNORMAL + escalate: %+v", got)
	}
}

// LR-003: a panic value is CRITICAL regardless of the descriptor range.
func TestInterpretCriticalHigh(t *testing.T) {
	got := Interpret("potassium", "7.5", "mmol/L", "3.5-5.1")
	if got.Status != StatusCritical || !got.Escalate {
		t.Fatalf("7.5 mmol/L potassium is a panic value → CRITICAL: %+v", got)
	}
}

func TestInterpretCriticalLow(t *testing.T) {
	got := Interpret("glucose", "1.8", "mmol/L", "4.0-6.0")
	if got.Status != StatusCritical || !got.Escalate {
		t.Fatalf("1.8 mmol/L glucose is a panic low → CRITICAL: %+v", got)
	}
}

// Open-ended reference ranges ("<" / ">").
func TestInterpretOpenEndedRanges(t *testing.T) {
	if got := Interpret("cholesterol", "250", "mg/dL", "<200"); got.Status != StatusAbnormal {
		t.Fatalf("250 with ref <200 should be ABNORMAL: %+v", got)
	}
	if got := Interpret("cholesterol", "150", "mg/dL", "<200"); got.Status != StatusNormal {
		t.Fatalf("150 with ref <200 should be NORMAL: %+v", got)
	}
	if got := Interpret("hdl", "30", "mg/dL", ">40"); got.Status != StatusAbnormal {
		t.Fatalf("30 with ref >40 should be ABNORMAL (below): %+v", got)
	}
}

// A non-numeric / qualitative value can't be interpreted → UNKNOWN, no forced
// escalation (the caller keeps the entered status).
func TestInterpretNonNumeric(t *testing.T) {
	got := Interpret("culture", "positive", "", "negative")
	if got.Status != StatusUnknown || got.Escalate {
		t.Fatalf("qualitative result should be UNKNOWN, no escalation: %+v", got)
	}
}

// LR-008 / EC-002: a unit that disagrees with the reference-range/expected unit is
// flagged (mg/dL vs mmol/L transposition), never silently interpreted.
func TestInterpretUnitMismatch(t *testing.T) {
	got := Interpret("potassium", "4.2", "mg/dL", "3.5-5.1 mmol/L")
	if !got.UnitMismatch {
		t.Fatalf("mg/dL vs mmol/L must be flagged as a unit mismatch: %+v", got)
	}
	// Matching units do not flag.
	if got := Interpret("potassium", "4.2", "mmol/L", "3.5-5.1 mmol/L"); got.UnitMismatch {
		t.Fatalf("matching units must not be flagged: %+v", got)
	}
}

// Range parsing handles en-dash and whitespace.
func TestParseRangeVariants(t *testing.T) {
	lo, hi, ok := parseRange("3.5 – 5.1 mmol/L") // en-dash + unit suffix
	if !ok || lo != 3.5 || hi != 5.1 {
		t.Fatalf("parseRange en-dash failed: lo=%v hi=%v ok=%v", lo, hi, ok)
	}
}
