package content

import "spotlight/backend/go-common/fsm"

// statemachine.go holds the PURE guard logic for the two content lifecycles:
// the publish lifecycle (lessons + bundles) and the content-production pipeline.
// Keeping the transition tables here (no DB, no ctx) makes them trivially
// unit-testable and reusable from both the service and the tests.
// Pattern (conventions.md "State-machine guard pattern"): a transition is legal
// only if it appears in the table; the service then checks staff capability,
// applies the change, emits audits, and (for approved→live) re-packages the
// bundle manifest. Illegal transitions are rejected AND audited.

// docs/prd/edtech state-machines.md §7: live → archived retains immutable history;
// offline bundles re-package on approved→live. We allow review→draft (bounce back)
// and approved→review (kick back for fixes) as legal regressions; archived is
// terminal.

var publishTransitions = fsm.Table[PublishStatus]{
	StatusDraft:    fsm.Set(StatusReview, StatusArchived),
	StatusReview:   fsm.Set(StatusApproved, StatusDraft, StatusArchived), // review can bounce to draft
	StatusApproved: fsm.Set(StatusLive, StatusReview, StatusArchived),    // approved can kick back to review
	StatusLive:     fsm.Set(StatusArchived),                              // live only archives
	StatusArchived: {},                                                   // terminal
}

// canPublish reports whether the publish lifecycle permits from→to. Idempotent
// no-op (from==to) is rejected so every committed transition is a real move.
func canPublish(from, to PublishStatus) bool {
	return publishTransitions.Can(from, to)
}

// validPublishStatus reports whether s is a known publish status.
func validPublishStatus(s PublishStatus) bool {
	switch s {
	case StatusDraft, StatusReview, StatusApproved, StatusLive, StatusArchived:
		return true
	default:
		return false
	}
}

// repackagesManifest reports whether a transition triggers bundle manifest
// (re)packaging — true only for approved→live (offline bundles re-package then).
func repackagesManifest(from, to PublishStatus) bool {
	return from == StatusApproved && to == StatusLive
}

// The board advances ONE forward step at a time. Bouncing back a single stage
// (rework) is allowed; jumping or skipping is not. publish is terminal-forward.

var stageOrder = []ProductionStage{
	StageScript, StageStoryboard, StageShoot, StageEdit, StageQA, StagePublish,
}

// stageIndex returns the ordinal of a stage, or -1 if unknown.
func stageIndex(s ProductionStage) int {
	for i, v := range stageOrder {
		if v == s {
			return i
		}
	}
	return -1
}

// canStage reports whether the production pipeline permits from→to: exactly one
// step forward, or exactly one step back (rework). No skips, no self-loops.
func canStage(from, to ProductionStage) bool {
	fi, ti := stageIndex(from), stageIndex(to)
	if fi < 0 || ti < 0 {
		return false
	}
	diff := ti - fi
	return diff == 1 || diff == -1
}
