package content

import "testing"

// TestCanPublish covers the publish lifecycle guard (draft→review→approved→live→
// archived) as a pure decision (no DB). Allowed forward + legal regressions pass;
// skips, self-loops, and moves out of the terminal archived state are rejected.
func TestCanPublish(t *testing.T) {
	allowed := []struct{ from, to PublishStatus }{
		{StatusDraft, StatusReview},
		{StatusReview, StatusApproved},
		{StatusApproved, StatusLive},
		{StatusLive, StatusArchived},
		// Legal regressions / archival shortcuts.
		{StatusReview, StatusDraft},
		{StatusApproved, StatusReview},
		{StatusDraft, StatusArchived},
		{StatusReview, StatusArchived},
		{StatusApproved, StatusArchived},
	}
	for _, c := range allowed {
		if !canPublish(c.from, c.to) {
			t.Errorf("canPublish(%q,%q) = false; want true", c.from, c.to)
		}
	}

	illegal := []struct{ from, to PublishStatus }{
		{StatusDraft, StatusApproved}, // skip review
		{StatusDraft, StatusLive},     // skip review+approved
		{StatusReview, StatusLive},    // skip approved
		{StatusLive, StatusDraft},     // live cannot un-publish to draft
		{StatusLive, StatusReview},    // live cannot regress to review
		{StatusArchived, StatusLive},  // archived is terminal
		{StatusArchived, StatusDraft}, // archived is terminal
		{StatusDraft, StatusDraft},    // self-loop is not a real move
		{StatusLive, StatusLive},      // self-loop
		{"bogus", StatusLive},         // unknown from
		{StatusDraft, "bogus"},        // unknown to
	}
	for _, c := range illegal {
		if canPublish(c.from, c.to) {
			t.Errorf("canPublish(%q,%q) = true; want false", c.from, c.to)
		}
	}
}

// TestRepackagesManifest confirms the manifest is (re)packaged ONLY on approved→live.
func TestRepackagesManifest(t *testing.T) {
	if !repackagesManifest(StatusApproved, StatusLive) {
		t.Errorf("approved→live should repackage the manifest")
	}
	noRepack := []struct{ from, to PublishStatus }{
		{StatusDraft, StatusReview},
		{StatusReview, StatusApproved},
		{StatusLive, StatusArchived},
		{StatusApproved, StatusReview},
	}
	for _, c := range noRepack {
		if repackagesManifest(c.from, c.to) {
			t.Errorf("repackagesManifest(%q,%q) = true; want false", c.from, c.to)
		}
	}
}

// TestCanStage covers the production pipeline guard (script→storyboard→shoot→edit→
// qa→publish): exactly one step forward or one step back; skips/self-loops rejected.
func TestCanStage(t *testing.T) {
	allowed := []struct{ from, to ProductionStage }{
		// Forward.
		{StageScript, StageStoryboard},
		{StageStoryboard, StageShoot},
		{StageShoot, StageEdit},
		{StageEdit, StageQA},
		{StageQA, StagePublish},
		// One step back (rework).
		{StageStoryboard, StageScript},
		{StagePublish, StageQA},
		{StageEdit, StageShoot},
	}
	for _, c := range allowed {
		if !canStage(c.from, c.to) {
			t.Errorf("canStage(%q,%q) = false; want true", c.from, c.to)
		}
	}

	illegal := []struct{ from, to ProductionStage }{
		{StageScript, StageShoot},    // skip storyboard
		{StageScript, StagePublish},  // big jump
		{StageQA, StageScript},       // big jump back
		{StageScript, StageScript},   // self-loop
		{StagePublish, StagePublish}, // self-loop
		{"bogus", StageScript},       // unknown from
		{StageScript, "bogus"},       // unknown to
	}
	for _, c := range illegal {
		if canStage(c.from, c.to) {
			t.Errorf("canStage(%q,%q) = true; want false", c.from, c.to)
		}
	}
}
