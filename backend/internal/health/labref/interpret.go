// Package labref is a pure, deterministic laboratory result-interpretation engine:
// it derives a result's clinical status (normal / abnormal / critical) from its
// numeric value, a reference-range descriptor, and a curated critical-threshold
// table, plus a unit-consistency check (test plan §4.4/§4.12; LR-002/003/008,
// EC-002). It is the fail-safe backstop against a mis-entered manual status so a
// panic value can never be silently released as NORMAL.
//
// No I/O. The critical-threshold table is a curated golden ruleset — NOT a
// substitute for a validated LIS/reference-range configuration; `thresholds.go`
// is the seam a lab's accredited reference data replaces.
package labref

import (
	"math"
	"strconv"
	"strings"
)

// Status is the derived clinical interpretation.
type Status string

const (
	StatusNormal   Status = "NORMAL"
	StatusAbnormal Status = "ABNORMAL" // outside the reference range, not a panic value
	StatusCritical Status = "CRITICAL" // panic/critical value → mandatory escalation
	StatusUnknown  Status = "UNKNOWN"  // non-numeric / un-parseable → cannot interpret
)

// Interpretation is the engine's structured verdict for one result line.
type Interpretation struct {
	Status       Status  `json:"status"`
	Escalate     bool    `json:"escalate"`     // true for ABNORMAL or CRITICAL
	UnitMismatch bool    `json:"unitMismatch"` // entered unit disagrees with the expected/range unit
	Value        float64 `json:"value"`
	Detail       string  `json:"detail"`
}

// Interpret derives the clinical status of a result. `analyte` is the test
// name/code (matched case-insensitively against the critical-threshold table),
// `valueStr` the measured value, `unit` its unit, and `refRange` the reference
// range descriptor (e.g. "3.5-5.1", "<200", ">40", "3.5-5.1 mmol/L").
func Interpret(analyte, valueStr, unit, refRange string) Interpretation {
	v, ok := parseNumber(valueStr)
	if !ok {
		return Interpretation{Status: StatusUnknown, Detail: "non-numeric value; not machine-interpretable"}
	}
	res := Interpretation{Value: v}

	// Unit consistency (LR-008/EC-002): compare the entered unit against the unit
	// embedded in the range descriptor and/or the analyte's canonical unit.
	res.UnitMismatch = unitMismatch(analyte, unit, refRange)

	// 1. Critical/panic thresholds first (LR-003) — these override the range.
	if th, ok := criticalFor(analyte); ok {
		if v <= th.Low || v >= th.High {
			res.Status, res.Escalate = StatusCritical, true
			res.Detail = "value at/beyond the critical threshold"
			return res
		}
	}
	// 2. Reference-range comparison (LR-002).
	if lo, hi, ok := parseRange(refRange); ok {
		if v < lo || v > hi {
			res.Status, res.Escalate = StatusAbnormal, true
			res.Detail = "value outside the reference range"
			return res
		}
		res.Status = StatusNormal
		return res
	}
	// No usable range and not critical → can't classify as abnormal; treat as
	// normal-but-unverified only when we at least have a numeric value.
	res.Status = StatusNormal
	res.Detail = "no reference range available"
	return res
}

// parseNumber extracts a leading float from a value string (tolerates a trailing
// unit or comparison marker, e.g. "4.2", "4.2 mmol/L"). Qualitative values fail.
func parseNumber(s string) (float64, bool) {
	s = strings.TrimSpace(strings.ToLower(s))
	s = strings.TrimLeft(s, "<>=~ ")
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return 0, false
	}
	f, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0, false
	}
	return f, true
}

// parseRange parses a reference-range descriptor into inclusive [lo, hi] bounds.
// Supports "lo-hi", "lo – hi" (en-dash), "<hi", "≤hi", ">lo", "≥lo", with an
// optional trailing unit. Open ends use ±Inf.
func parseRange(desc string) (lo, hi float64, ok bool) {
	d := strings.TrimSpace(strings.ToLower(desc))
	d = strings.ReplaceAll(d, "–", "-") // en-dash → hyphen
	d = strings.ReplaceAll(d, "—", "-") // em-dash → hyphen
	if d == "" {
		return 0, 0, false
	}
	switch {
	case strings.HasPrefix(d, "<") || strings.HasPrefix(d, "≤"):
		if h, ok := parseNumber(strings.TrimLeft(d, "<≤ ")); ok {
			return math.Inf(-1), h, true
		}
	case strings.HasPrefix(d, ">") || strings.HasPrefix(d, "≥"):
		if l, ok := parseNumber(strings.TrimLeft(d, ">≥ ")); ok {
			return l, math.Inf(1), true
		}
	default:
		// "lo-hi" (allow a leading negative low by splitting on the inner hyphen).
		if i := strings.Index(d, "-"); i > 0 {
			l, okL := parseNumber(d[:i])
			h, okH := parseNumber(d[i+1:])
			if okL && okH {
				return l, h, true
			}
		}
	}
	return 0, 0, false
}

// unitMismatch reports whether the entered unit disagrees with the unit implied by
// the range descriptor or the analyte's canonical critical-threshold unit.
func unitMismatch(analyte, unit, refRange string) bool {
	u := normUnit(unit)
	if u == "" {
		return false // no unit entered → nothing to contradict
	}
	if ru := unitInDescriptor(refRange); ru != "" && ru != u {
		return true
	}
	if th, ok := criticalFor(analyte); ok && th.Unit != "" && normUnit(th.Unit) != u {
		return true
	}
	return false
}

// unitInDescriptor extracts a unit token from a range descriptor, if present.
func unitInDescriptor(desc string) string {
	fields := strings.Fields(strings.ToLower(desc))
	for _, f := range fields {
		if u := normUnit(f); u != "" && !isRangeToken(f) {
			return u
		}
	}
	return ""
}

func isRangeToken(f string) bool {
	f = strings.TrimLeft(f, "<>=≤≥ ")
	if f == "" {
		return true
	}
	// a token that parses as a number (possibly a "lo-hi" pair) is a range token.
	if _, ok := parseNumber(f); ok {
		return true
	}
	if i := strings.Index(f, "-"); i > 0 {
		if _, okL := parseNumber(f[:i]); okL {
			return true
		}
	}
	return false
}

// normUnit canonicalizes a unit string for comparison (case/space/punctuation).
func normUnit(u string) string {
	u = strings.ToLower(strings.TrimSpace(u))
	u = strings.NewReplacer(" ", "", "µ", "u", "μ", "u").Replace(u)
	switch u {
	case "mmol/l", "mmoll", "mmol":
		return "mmol/l"
	case "mg/dl", "mgdl":
		return "mg/dl"
	case "g/dl", "gdl":
		return "g/dl"
	case "":
		return ""
	default:
		return u
	}
}
