package governance

import (
	"context"
	"testing"

	"spotlight/backend/internal/health/triage"
)

// TS-12 HR-003 / TS-16 AD-006 / §4.8: clinical content amendments are versioned,
// never destructive. Pure decision + an executed never-destructive property.

func TestAmendModeFor(t *testing.T) {
	cases := map[triage.ContentState]amendMode{
		triage.ContentDraft:      amendInPlace,    // not yet live → edit in place
		triage.ContentReview:     amendNewVersion, // sign-off track → new version
		triage.ContentApproved:   amendNewVersion,
		triage.ContentPublished:  amendNewVersion, // live → immutable, branch v+1
		triage.ContentDeprecated: amendRejected,   // retired → cannot edit; create fresh
	}
	for st, want := range cases {
		if got := amendModeFor(st); got != want {
			t.Errorf("amendModeFor(%s) = %d, want %d", st, got, want)
		}
	}
}

// HR-003 / §4.8: editing a PUBLISHED (signed-off) content item branches a NEW draft
// at version+1 and leaves the published version untouched (never destructive).
func TestEditPublishedContentIsNonDestructive(t *testing.T) {
	st := newFakeStore()
	gov := NewGovernanceService(st)
	ctx := context.Background()

	ci, err := gov.CreateContentDraft(ctx, "author", ContentItem{Code: "c1", Kind: "self_care", Body: "v1 body"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := gov.SubmitContentForReview(ctx, "author", ci.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := gov.ApproveContent(ctx, "reviewer", ci.ID); err != nil { // four-eyes: distinct approver
		t.Fatal(err)
	}
	if _, err := gov.PublishContent(ctx, "reviewer", ci.ID); err != nil {
		t.Fatal(err)
	}

	// Edit the published item → a NEW draft at version+1.
	next, err := gov.EditContent(ctx, "author", ci.ID, "v2 body", nil)
	if err != nil {
		t.Fatalf("edit of published content should branch a new version: %v", err)
	}
	if next.ID == ci.ID {
		t.Fatal("amendment must be a NEW record, not the same id")
	}
	if next.Version != ci.Version+1 {
		t.Fatalf("branched version = %d, want %d", next.Version, ci.Version+1)
	}
	if next.State != triage.ContentDraft {
		t.Fatalf("branched item must be a fresh DRAFT, got %s", next.State)
	}

	// The original published version is UNCHANGED (retained, immutable).
	orig, err := st.GetContent(ctx, ci.ID)
	if err != nil {
		t.Fatal(err)
	}
	if orig.Body != "v1 body" || orig.State != triage.ContentPublished || orig.Version != ci.Version {
		t.Fatalf("published version must be retained unchanged, got %+v", orig)
	}
}

// A retired (deprecated) rule cannot be edited in place — it must be recreated.
func TestEditDeprecatedRuleRejected(t *testing.T) {
	st := newFakeStore()
	gov := NewGovernanceService(st)
	ctx := context.Background()
	rr, _ := gov.CreateRuleDraft(ctx, "author", RedFlagRule{Code: "rf1", Name: "x", UrgencyLevel: 1, Severity: "emergency"})
	// Force to a deprecated/terminal state directly in the store.
	st.rules[rr.ID].State = triage.ContentDeprecated
	if _, err := gov.EditRule(ctx, "author", rr.ID, "y", RuleCondition{}, 1, "emergency"); err == nil {
		t.Fatal("editing a deprecated rule must be rejected (create a new one)")
	}
}
