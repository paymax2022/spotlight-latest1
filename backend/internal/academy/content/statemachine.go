package content

// statemachine.go holds the PURE guard logic for the two content lifecycles:
// the publish lifecycle (lessons + bundles) and the content-production pipeline.
// Keeping the transition tables here (no DB, no ctx) makes them trivially
// unit-testable and reusable from both the service and the tests.
//
// Pattern (conventions.md "State-machine guard pattern"): a transition is legal
// only if it appears in the table; the service then checks staff capability,
// applies the change, emits audits, and (for approved→live) re-packages the
// bundle manifest. Illegal transitions are rejected AND audited.

// ── Publish lifecycle: draft → review → approved → live → archived ─────────────
//
// docs/prd/edtech state-machines.md §7: live → archived retains immutable history;
// offline bundles re-package on approved→live. We allow review→draft (bounce back)
// and approved→review (kick back for fixes) as legal regressions; archived is
// terminal.

var publishTransitions = map[PublishStatus]map[PublishStatus]bool{
	StatusDraft:    {StatusReview: true, StatusArchived: true},
	StatusReview:   {StatusApproved: true, StatusDraft: true, StatusArchived: true}, // review can bounce to draft
	StatusApproved: {StatusLive: true, StatusReview: true, StatusArchived: true},    // approved can kick back to review
	StatusLive:     {StatusArchived: true},                                          // live only archives
	StatusArchived: {},                                                              // terminal
}

// canPublish reports whether the publish lifecycle permits from→to. Idempotent
// no-op (from==to) is rejected so every committed transition is a real move.
func canPublish(from, to PublishStatus) bool {
	targets, ok := publishTransitions[from]
	if !ok {
		return false
	}
	return targets[to]
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

// ── Production pipeline: script → storyboard → shoot → edit → qa → publish ──────
//
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

// validStage reports whether s is a known pipeline stage.
func validStage(s ProductionStage) bool {
	return stageIndex(s) >= 0
}

// canBlock reports whether a production may be moved to the blocked status: only an
// ACTIVE card can be blocked. done is terminal and an already-blocked card is a
// no-op (rejected), so every committed block is a real state change.
func canBlock(from ProductionStatus) bool {
	return from == ProdActive
}
