package governance

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/health/makercheck"
)

// TS-15 SC-011: four-eyes on safety-critical clinical content / red-flag rules —
// the approver/publisher must be a different clinician than the author. Driven
// through the service against the in-memory fake store (no DB).

func TestFourEyes_ContentApproveAndPublishRejectAuthor(t *testing.T) {
	gov := NewGovernanceService(newFakeStore())
	ctx := context.Background()

	ci, err := gov.CreateContentDraft(ctx, "author", ContentItem{Code: "c1", Kind: "self_care", Body: "rest + fluids"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := gov.SubmitContentForReview(ctx, "author", ci.ID); err != nil {
		t.Fatal(err)
	}
	// Self-approval by the author is rejected (SC-011).
	if _, err := gov.ApproveContent(ctx, "author", ci.ID); !errors.Is(err, makercheck.ErrSelfApproval) {
		t.Fatalf("author self-approval must be rejected, got %v", err)
	}
	// A different clinician approves.
	if _, err := gov.ApproveContent(ctx, "reviewer", ci.ID); err != nil {
		t.Fatalf("distinct approver should succeed, got %v", err)
	}
	// The author also cannot publish their own content (second four-eyes gate).
	if _, err := gov.PublishContent(ctx, "author", ci.ID); !errors.Is(err, makercheck.ErrSelfApproval) {
		t.Fatalf("author self-publish must be rejected, got %v", err)
	}
	if _, err := gov.PublishContent(ctx, "reviewer", ci.ID); err != nil {
		t.Fatalf("distinct publisher should succeed, got %v", err)
	}
}

func TestFourEyes_RuleApproveRejectsAuthor(t *testing.T) {
	gov := NewGovernanceService(newFakeStore())
	ctx := context.Background()

	rr, err := gov.CreateRuleDraft(ctx, "author", RedFlagRule{
		Code: "rf1", Name: "chest pain", UrgencyLevel: 1, Severity: "emergency",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := gov.SubmitRuleForReview(ctx, "author", rr.ID); err != nil {
		t.Fatal(err)
	}
	// A red-flag rule (routes emergencies) cannot be approved by its own author.
	if _, err := gov.ApproveRule(ctx, "author", rr.ID); !errors.Is(err, makercheck.ErrSelfApproval) {
		t.Fatalf("author self-approval of a red-flag rule must be rejected, got %v", err)
	}
	if _, err := gov.ApproveRule(ctx, "reviewer", rr.ID); err != nil {
		t.Fatalf("distinct approver should succeed, got %v", err)
	}
}
