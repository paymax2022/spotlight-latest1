package trade

import (
	"context"
	"errors"
	"testing"
)

// These tests are PURE — no DB, no pgx. They exercise the guarded state machines,
// the grade() threshold math, and the credential-issuance idempotency contract via a
// counting fake issuer driven through a simulation of the unique-idempotency-key dedup
// (which the repo enforces with academy_skill_attempts.idempotency_key UNIQUE). The
// DB-bound service/repo methods are validated end-to-end by the integration suite.

// ── Project-submission state machine: allowed + illegal ───────────────────────

func TestCanSubmission_Allowed(t *testing.T) {
	allowed := [][2]SubmissionState{
		{SubmissionSubmitted, SubmissionReviewed},
		{SubmissionReviewed, SubmissionPassed},
		{SubmissionReviewed, SubmissionFailed},
	}
	for _, tr := range allowed {
		if !canSubmission(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be allowed", tr[0], tr[1])
		}
	}
}

func TestCanSubmission_Illegal(t *testing.T) {
	illegal := [][2]SubmissionState{
		{SubmissionSubmitted, SubmissionPassed},  // skip review
		{SubmissionSubmitted, SubmissionFailed},  // skip review
		{SubmissionPassed, SubmissionReviewed},   // terminal, backwards
		{SubmissionFailed, SubmissionReviewed},   // terminal, backwards
		{SubmissionPassed, SubmissionFailed},     // terminal
		{SubmissionReviewed, SubmissionSubmitted}, // backwards
		{"bogus", SubmissionReviewed},            // unknown source
	}
	for _, tr := range illegal {
		if canSubmission(tr[0], tr[1]) {
			t.Errorf("expected %s→%s to be ILLEGAL", tr[0], tr[1])
		}
	}
}

func TestValidSubmissionState(t *testing.T) {
	if !validSubmissionState(SubmissionPassed) {
		t.Error("passed should be a valid submission state")
	}
	if validSubmissionState("nope") {
		t.Error("unknown state must be invalid")
	}
}

// ── Mentor-match state machine ────────────────────────────────────────────────

func TestCanMatch_Transitions(t *testing.T) {
	if !canMatch(MatchRequested, MatchActive) {
		t.Error("requested→active should be allowed (mentor accepts)")
	}
	if !canMatch(MatchRequested, MatchClosed) {
		t.Error("requested→closed should be allowed (mentor declines)")
	}
	if !canMatch(MatchActive, MatchClosed) {
		t.Error("active→closed should be allowed")
	}
	if canMatch(MatchClosed, MatchActive) {
		t.Error("closed→active must be illegal (terminal)")
	}
	if canMatch(MatchActive, MatchRequested) {
		t.Error("active→requested must be illegal (backwards)")
	}
	if canMatch(MatchClosed, MatchClosed) {
		t.Error("closed→closed must be illegal (terminal self-loop)")
	}
	if canMatch("bogus", MatchActive) {
		t.Error("unknown source must be illegal")
	}
}

// ── grade() threshold math ────────────────────────────────────────────────────

func TestGrade(t *testing.T) {
	cases := []struct {
		score, threshold float64
		want             bool
	}{
		{0.70, 0.70, true},  // exactly at threshold passes
		{0.71, 0.70, true},  // above passes
		{0.69, 0.70, false}, // below fails
		{1.0, 0.70, true},
		{0.0, 0.70, false},
		{0.5, 0.0, true}, // zero threshold always passes
	}
	for _, c := range cases {
		if got := grade(c.score, c.threshold); got != c.want {
			t.Errorf("grade(%v, %v) = %v; want %v", c.score, c.threshold, got, c.want)
		}
	}
}

// ── Credential issuance: pass→issue, idempotent on key ────────────────────────

// fakeIssuer counts invocations and returns deterministic ids.
type fakeIssuer struct {
	calls int
}

func (f *fakeIssuer) IssueTradeCredential(ctx context.Context, userID, tradeTrack, title string) (string, string, error) {
	f.calls++
	return "cred-" + userID, "verify-" + userID, nil
}

// simulateGrade models the repo's idempotent GradeAttempt contract without a DB: the
// issuer is called at most once per distinct idempotency key, and only on a PASS. A
// replayed key returns the stored attempt with NO second issuance. This mirrors the
// ON CONFLICT (idempotency_key) DO NOTHING + issue-inside-tx logic in repository.go.
func simulateGrade(store map[string]*SkillAttempt, issuer CredentialIssuer, userID, assessmentID string, score, threshold float64, idemKey string) (*SkillAttempt, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if prior, ok := store[idemKey]; ok {
		return prior, nil // replay: no re-issue
	}
	passed := grade(score, threshold)
	att := &SkillAttempt{ID: "att-" + idemKey, UserID: userID, AssessmentID: assessmentID, Passed: passed, State: AttemptGraded}
	if passed {
		credID, _, err := issuer.IssueTradeCredential(context.Background(), userID, "plumbing", "Certified Plumber")
		if err != nil {
			return nil, err
		}
		att.CredentialID = &credID
	}
	store[idemKey] = att
	return att, nil
}

func TestTakeAssessment_PassIssuesCredentialOnce(t *testing.T) {
	issuer := &fakeIssuer{}
	store := map[string]*SkillAttempt{}

	// First PASS issues exactly one credential.
	att, err := simulateGrade(store, issuer, "user-1", "asm-1", 0.9, 0.7, "idem-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !att.Passed {
		t.Fatal("0.9 ≥ 0.7 should pass")
	}
	if att.CredentialID == nil || *att.CredentialID == "" {
		t.Fatal("a pass must store an issued credential_id")
	}
	if issuer.calls != 1 {
		t.Fatalf("issuer should be called exactly once, got %d", issuer.calls)
	}

	// Replay with the SAME idempotency key: no second issuance.
	att2, err := simulateGrade(store, issuer, "user-1", "asm-1", 0.9, 0.7, "idem-1")
	if err != nil {
		t.Fatalf("unexpected error on replay: %v", err)
	}
	if issuer.calls != 1 {
		t.Fatalf("replay must NOT re-issue; issuer calls = %d, want 1", issuer.calls)
	}
	if att2.ID != att.ID {
		t.Errorf("replay must return the original attempt: got %s want %s", att2.ID, att.ID)
	}
}

func TestTakeAssessment_FailDoesNotIssue(t *testing.T) {
	issuer := &fakeIssuer{}
	store := map[string]*SkillAttempt{}

	att, err := simulateGrade(store, issuer, "user-2", "asm-1", 0.5, 0.7, "idem-2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if att.Passed {
		t.Fatal("0.5 < 0.7 should fail")
	}
	if att.CredentialID != nil {
		t.Error("a failed attempt must not carry a credential_id")
	}
	if issuer.calls != 0 {
		t.Fatalf("issuer must NOT be called on a fail, got %d", issuer.calls)
	}
}

func TestTakeAssessment_RequiresIdempotencyKey(t *testing.T) {
	issuer := &fakeIssuer{}
	store := map[string]*SkillAttempt{}
	if _, err := simulateGrade(store, issuer, "user-3", "asm-1", 0.9, 0.7, ""); !errors.Is(err, ErrIdempotencyRequired) {
		t.Errorf("missing idempotency key must error with ErrIdempotencyRequired, got %v", err)
	}
}

// noopIssuer (the nil-safe default) must satisfy the interface and never error.
func TestNoopIssuer(t *testing.T) {
	var i CredentialIssuer = noopIssuer{}
	cred, verify, err := i.IssueTradeCredential(context.Background(), "u", "t", "title")
	if err != nil || cred != "" || verify != "" {
		t.Errorf("noopIssuer should return empty ids and nil error, got %q %q %v", cred, verify, err)
	}
}
