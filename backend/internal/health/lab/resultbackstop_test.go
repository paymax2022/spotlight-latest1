package healthlab

import "testing"

// Pure, DB-free tests of the fail-safe result backstop wired into EnterResults.
// LR-002/003 (§4.4/§4.12 fail-safe), LR-008/EC-002.

// LR-003 fail-safe: a panic value mis-entered as NORMAL is upgraded to CRITICAL so
// it cannot be released without escalation.
func TestBackstopUpgradesCriticalMisEnteredAsNormal(t *testing.T) {
	eff, mismatch := deriveEffectiveStatus(ResultNormal, "Serum Potassium", "7.5", "mmol/L", "3.5-5.1")
	if eff != ResultCritical {
		t.Fatalf("panic potassium entered NORMAL must be upgraded to CRITICAL, got %s", eff)
	}
	if mismatch {
		t.Fatalf("units match; no mismatch expected")
	}
	if !needsEscalation(eff) {
		t.Fatalf("effective status must trigger escalation")
	}
}

// LR-002: an out-of-range value entered as NORMAL is upgraded to ABNORMAL.
func TestBackstopUpgradesAbnormal(t *testing.T) {
	eff, _ := deriveEffectiveStatus(ResultNormal, "potassium", "5.8", "mmol/L", "3.5-5.1")
	if eff != ResultAbnormal {
		t.Fatalf("out-of-range value should upgrade to ABNORMAL, got %s", eff)
	}
}

// Never downgrades: a scientist's CRITICAL flag stays CRITICAL even if the value
// parses in-range (clinical judgment is preserved; the backstop only escalates).
func TestBackstopNeverDowngrades(t *testing.T) {
	if eff, _ := deriveEffectiveStatus(ResultCritical, "potassium", "4.2", "mmol/L", "3.5-5.1"); eff != ResultCritical {
		t.Fatalf("CRITICAL must never be downgraded, got %s", eff)
	}
	if eff, _ := deriveEffectiveStatus(ResultAbnormal, "glucose", "5.0", "mmol/L", "4.0-6.0"); eff != ResultAbnormal {
		t.Fatalf("ABNORMAL must never be downgraded, got %s", eff)
	}
}

// A clean in-range NORMAL stays NORMAL.
func TestBackstopNormalStaysNormal(t *testing.T) {
	if eff, _ := deriveEffectiveStatus(ResultNormal, "potassium", "4.2", "mmol/L", "3.5-5.1"); eff != ResultNormal {
		t.Fatalf("in-range NORMAL should stay NORMAL, got %s", eff)
	}
}

// EC-002: a unit mismatch is reported so EnterResults can reject the line.
func TestBackstopFlagsUnitMismatch(t *testing.T) {
	_, mismatch := deriveEffectiveStatus(ResultNormal, "potassium", "4.2", "mg/dL", "3.5-5.1 mmol/L")
	if !mismatch {
		t.Fatalf("mg/dL vs mmol/L must be flagged as a unit mismatch")
	}
}

// A qualitative (non-numeric) result keeps the entered status (can't interpret).
func TestBackstopQualitativeKeepsEntered(t *testing.T) {
	if eff, _ := deriveEffectiveStatus(ResultAbnormal, "culture", "positive", "", "negative"); eff != ResultAbnormal {
		t.Fatalf("qualitative result should keep entered status, got %s", eff)
	}
}
