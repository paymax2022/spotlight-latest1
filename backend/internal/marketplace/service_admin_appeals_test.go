package marketplace

// DB-free unit tests for FileAppeal's input validation + standing-action gate
// (the POST /appeals forgery fix — probe wave w9 found the endpoint accepted
// appeals against nonexistent/foreign targets with fabricated original_action
// strings). Every case below must be rejected BEFORE the service touches the
// repository, so a nil pool is safe and the test needs no Postgres.
//
// The DB-backed legs (nonexistent target → 404, foreign target → 403, no
// standing moderation action → 422, real action → 201) run in
// appeal_validation_live_db_test.go under TEST_DATABASE_URL.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestFileAppeal_ValidationErrors(t *testing.T) {
	svc := NewService(nil, nil, nil)
	appellant := uuid.New().String()
	target := uuid.New().String()

	valid := CreateAppealInput{
		TargetType:         "listing",
		TargetID:           target,
		OriginalAction:     "removed_policy",
		OriginalReasonCode: "POLICY_X",
		AppellantNote:      "please review",
	}

	cases := []struct {
		name      string
		mutate    func(*CreateAppealInput)
		appellant string
		wantCode  string
		wantField string
	}{
		{"bad target_type", func(in *CreateAppealInput) { in.TargetType = "category" }, appellant, CodeValidation, colTargetType},
		{"missing target_id", func(in *CreateAppealInput) { in.TargetID = "" }, appellant, CodeValidation, colTargetId},
		{"non-uuid target_id", func(in *CreateAppealInput) { in.TargetID = "not-a-uuid" }, appellant, CodeValidation, colTargetId},
		{"missing original_action", func(in *CreateAppealInput) { in.OriginalAction = "" }, appellant, CodeValidation, "original_action"},
		// A fabricated action string — no moderation path produces 'deleted_forever'.
		{"fabricated original_action", func(in *CreateAppealInput) { in.OriginalAction = "deleted_forever" }, appellant, CodeValidation, "original_action"},
		// A real action name, but one that can never apply to this target_type
		// ('suspended' is a user moderation status, not a listing one).
		{"cross-type original_action", func(in *CreateAppealInput) { in.OriginalAction = "suspended" }, appellant, CodeValidation, "original_action"},
		{"missing original_reason_code", func(in *CreateAppealInput) { in.OriginalReasonCode = "" }, appellant, CodeValidation, "original_reason_code"},
		{"missing appellant_note", func(in *CreateAppealInput) { in.AppellantNote = "" }, appellant, CodeValidation, "appellant_note"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := valid
			tc.mutate(&in)
			_, err := svc.FileAppeal(context.Background(), tc.appellant, in)
			if err == nil {
				t.Fatalf("expected error, got nil")
			}
			ce := asCoded(err)
			if ce.Status != 400 || ce.Code != tc.wantCode || ce.Field != tc.wantField {
				t.Fatalf("got status=%d code=%q field=%q, want 400/%q field=%q", ce.Status, ce.Code, ce.Field, tc.wantCode, tc.wantField)
			}
		})
	}
}

// TestFileAppeal_ForeignUserTarget proves a 'user' appeal can only ever be
// filed against the caller's own account — the self-check runs before the
// platform_users read, so a foreign id is 403 whether or not that user exists.
func TestFileAppeal_ForeignUserTarget(t *testing.T) {
	svc := NewService(nil, nil, nil)
	appellant := uuid.New().String()

	_, err := svc.FileAppeal(context.Background(), appellant, CreateAppealInput{
		TargetType:         "user",
		TargetID:           uuid.New().String(), // someone else / nonexistent — must not matter
		OriginalAction:     "suspended",
		OriginalReasonCode: "POLICY_X",
		AppellantNote:      "appealing someone else's account",
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden for foreign user target, got %v", err)
	}
}
