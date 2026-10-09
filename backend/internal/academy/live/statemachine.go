package live

import "spotlight/backend/go-common/fsm"

// statemachine.go holds the PURE guard logic for the live-session lifecycle and the
// pure community/child-safety helpers (no DB, no ctx) so they are trivially
// unit-testable and reusable from both the service and the tests.
// Pattern (conventions.md "State-machine guard pattern"): a transition is legal only
// if it appears in the table; the service then checks business guards, applies the
// change, emits events and audits. Illegal transitions are rejected + audited.

// sessionTransitions is the legal adjacency for the live-session lifecycle.
var sessionTransitions = fsm.Table[SessionState]{
	SessionScheduled: fsm.Set(SessionLive, SessionCancelled),
	SessionLive:      fsm.Set(SessionEnded),
	SessionEnded:     {}, // terminal
	SessionCancelled: {}, // terminal
}

// canSession reports whether the live-session machine permits from→to.
func canSession(from, to SessionState) bool {
	return sessionTransitions.Can(from, to)
}

// validSessionState reports whether s is a known session state.
func validSessionState(s SessionState) bool {
	switch s {
	case SessionScheduled, SessionLive, SessionEnded, SessionCancelled:
		return true
	default:
		return false
	}
}

// ── Community scope guards (child-safety) ──────────────────────────────────────

// isAllowedScope reports whether scope is one of the permitted community scopes.
// There is intentionally NO 1:1 / DM scope: community is group / subject / session
// Q&A only (nfr.md child-safety — no open DMs).
func isAllowedScope(scope string) bool {
	switch scope {
	case ScopeSubject, ScopeGroup, ScopeSession:
		return true
	default:
		return false
	}
}

// isDMScope reports whether scope denotes a 1:1 / direct-message channel. Any such
// scope is forbidden outright in this package; the helper exists so the guard reads
// intent-first and so a future accidental "dm" scope is caught by the minor guard.
func isDMScope(scope string) bool {
	switch scope {
	case "dm", "direct", "1:1", "private", "pm":
		return true
	default:
		return false
	}
}

// canPostDiscussion is the PURE child-safety decision for posting a discussion.
// It is fail-closed:
//   - the scope MUST be an allowed community scope (group/subject/session); and
//   - a minor author may NEVER post into a DM/1:1 scope (there is no such scope, so
//     this is belt-and-braces — a minor's only path is the allowed group Q&A scopes).
//
// reason is a stable snake_case code when the post is denied.
func canPostDiscussion(isMinor bool, scope string) (ok bool, reason string) {
	if isDMScope(scope) {
		// Open DMs are forbidden for everyone in academy community, and explicitly
		// for minors (child-safety). Fail closed.
		if isMinor {
			return false, "minor_dm_forbidden"
		}
		return false, "dm_scope_forbidden"
	}
	if !isAllowedScope(scope) {
		return false, "invalid_scope"
	}
	return true, ""
}

// validModerationAction reports whether a is a known moderation action.
func validModerationAction(a string) bool {
	switch a {
	case ActionHide, ActionWarn, ActionBan, ActionNone:
		return true
	default:
		return false
	}
}

// reportStateForAction maps a moderation action to the resulting report state:
// "none" dismisses the report; every other (valid) action resolves it as actioned.
func reportStateForAction(action string) ReportState {
	if action == ActionNone {
		return ReportDismissed
	}
	return ReportActioned
}

// reportTransitions is the legal adjacency for the moderation-report workflow. decide
// keeps its own pending-only guard (unchanged); these transitions add the intermediate
// triage / escalate steps ahead of a final decide:
//
//	pending   → triaged | escalated | actioned | dismissed
//	triaged   → escalated | actioned | dismissed
//	escalated → actioned | dismissed
var reportTransitions = fsm.Table[ReportState]{
	ReportPending:   fsm.Set(ReportTriaged, ReportEscalated, ReportActioned, ReportDismissed),
	ReportTriaged:   fsm.Set(ReportEscalated, ReportActioned, ReportDismissed),
	ReportEscalated: fsm.Set(ReportActioned, ReportDismissed),
	ReportActioned:  {}, // terminal
	ReportDismissed: {}, // terminal
}

// canReport reports whether the moderation-report workflow permits from→to.
func canReport(from, to ReportState) bool {
	return reportTransitions.Can(from, to)
}
