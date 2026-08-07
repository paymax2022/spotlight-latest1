package governance

import "spotlight/backend/internal/health/triage"

// amendMode is the decision for how an edit is applied so clinical content is
// versioned, never destructively overwritten (test plan §4.8; HR-003/AD-006/LR-006
// pattern). A DRAFT (not yet live) is edited in place; any REVIEW/APPROVED/PUBLISHED
// (live or sign-off-track) content is branched to a NEW draft at version+1 so the
// signed-off version is immutable and retained; a DEPRECATED/unknown item cannot be
// edited (create a fresh item instead — a retired safety rule is never revived by an
// in-place edit).
type amendMode int

const (
	amendInPlace    amendMode = iota // draft: edit in place
	amendNewVersion                  // live/sign-off-track: branch a new version, never mutate
	amendRejected                    // terminal/unknown: edit not permitted
)

// amendModeFor is the pure amendment decision, shared by EditContent and EditRule
// so the never-destructive rule has one tested source of truth.
func amendModeFor(state triage.ContentState) amendMode {
	switch state {
	case triage.ContentDraft:
		return amendInPlace
	case triage.ContentReview, triage.ContentApproved, triage.ContentPublished:
		return amendNewVersion
	default:
		return amendRejected
	}
}
