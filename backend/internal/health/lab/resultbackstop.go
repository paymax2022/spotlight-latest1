package healthlab

import "spotlight/backend/internal/health/labref"

// statusRank orders result severity for the never-downgrade backstop.
func statusRank(s ResultStatus) int {
	switch s {
	case ResultCritical:
		return 2
	case ResultAbnormal:
		return 1
	default:
		return 0
	}
}

func labrefToStatus(s labref.Status) (ResultStatus, bool) {
	switch s {
	case labref.StatusCritical:
		return ResultCritical, true
	case labref.StatusAbnormal:
		return ResultAbnormal, true
	case labref.StatusNormal:
		return ResultNormal, true
	default: // UNKNOWN — cannot machine-interpret; keep the entered status
		return "", false
	}
}

// deriveEffectiveStatus is the fail-safe result backstop (LR-002/003, §4.4/§4.12).
// It runs the pure labref interpreter over the entered value/unit/reference range
// and:
//   - NEVER downgrades the scientist's manual status, and
//   - UPGRADES it when the engine derives a more severe interpretation (e.g. a
//     panic potassium entered as NORMAL becomes CRITICAL) — so a critical value
//     can never be silently released without the HL-7 escalation path.
//
// It also reports a unit mismatch (mg/dL vs mmol/L transposition) so EnterResults
// can reject the line (LR-008/EC-002) rather than interpret a wrong-unit value.
func deriveEffectiveStatus(entered ResultStatus, analyte, value, unit, refRange string) (effective ResultStatus, unitMismatch bool) {
	interp := labref.Interpret(analyte, value, unit, refRange)
	effective = entered
	if derived, ok := labrefToStatus(interp.Status); ok && statusRank(derived) > statusRank(entered) {
		effective = derived
	}
	return effective, interp.UnitMismatch
}
