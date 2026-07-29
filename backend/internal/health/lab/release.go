package healthlab

// canReleaseFrom reports whether an order in `state` may be signed off and released
// (LR-004). Only a validated RESULT_READY order, or one already ESCALATED (critical
// values surfaced for human review), can proceed — so a result is never released
// before an authorized scientist has entered and validated it, and a released order
// is never re-released. This mirrors the guarded order state machine
// (allowedOrderTransitions); Release also requires a verified scientist (HL-2) and
// stamps released_by for attribution.
func canReleaseFrom(state OrderState) bool {
	return state == StateResultReady || state == StateEscalated
}
