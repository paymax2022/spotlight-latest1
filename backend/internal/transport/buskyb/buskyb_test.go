package buskyb

// Pure-logic unit tests for the bus-operator KYB gate (PRD §5). DB-free and
// correct-by-construction: they exercise the extracted decision seams —
// the fsm transition table, decideReview (maker-checker), kycDecision (tier
// gate), cacDecision (provider-outage vs not-found mapping) and publishable
// (the CanPublish predicate) — so `go test ./internal/transport/buskyb/...`
// proves the gate without Postgres. The live end-to-end run is in
// live_db_test.go, gated on TEST_DATABASE_URL.

import (
	"context"
	"errors"
	"testing"
)

// ─── transitions table ──────────────────────────────────────────────────────

func TestTransitions_HappyPath(t *testing.T) {
	for _, mv := range [][2]State{
		{StateDraft, StateSubmitted},
		{StateSubmitted, StateCACPending},
		{StateCACPending, StateKYCPending},
		{StateKYCPending, StateUnderReview},
		{StateUnderReview, StateApproved},
		{StateApproved, StateSuspended},
		{StateSuspended, StateApproved}, // reinstate
		{StateApproved, StateExpired},
		{StateSuspended, StateExpired},
	} {
		if !transitions.Can(mv[0], mv[1]) {
			t.Fatalf("%s -> %s must be legal", mv[0], mv[1])
		}
	}
}

func TestTransitions_ResubmitEdges(t *testing.T) {
	for _, from := range []State{StateDraft, StateNeedsInfo, StateRejected, StateExpired} {
		if !transitions.Can(from, StateSubmitted) {
			t.Fatalf("%s -> submitted must be legal (resubmission)", from)
		}
	}
}

func TestTransitions_IllegalMovesRejected(t *testing.T) {
	for _, mv := range [][2]State{
		{StateDraft, StateApproved},        // never skip the pipeline
		{StateDraft, StateUnderReview},     // no straight-to-review
		{StateSubmitted, StateApproved},    // no submit→approve shortcut
		{StateCACPending, StateApproved},   // CAC pass can never approve directly
		{StateCACPending, StateSubmitted},  // no backwards hop
		{StateUnderReview, StateSubmitted}, // reviewer can't bounce to submit
		{StateApproved, StateUnderReview},  // approved never goes back to review
		{StateApproved, StateSubmitted},    // approved operator can't resubmit
		{StateSuspended, StateSubmitted},   // suspended is reviewer-only reinstate
		{StateRejected, StateApproved},     // rejected needs a fresh submission
		{StateApproved, StateApproved},     // self-loops are never legal
		{StateUnderReview, StateUnderReview},
	} {
		if transitions.Can(mv[0], mv[1]) {
			t.Fatalf("%s -> %s must be ILLEGAL", mv[0], mv[1])
		}
	}
}

// ─── cacDecision: provider outage vs content outcomes ────────────────────────

func TestCACDecision_MatchAdvancesToKYCOnly(t *testing.T) {
	st, next, err := cacDecision(CACMatch)
	if err != nil || st != CheckPassed || next != StateKYCPending {
		t.Fatalf("match must record passed + advance to kyc_verification_pending, got (%s,%s,%v)", st, next, err)
	}
	// The whole point of the gate: a registry match is NEVER an approval.
	if next == StateApproved {
		t.Fatal("cac match must not auto-approve")
	}
}

func TestCACDecision_ProviderUnavailableStaysPending(t *testing.T) {
	st, next, err := cacDecision(CACProviderUnavailable)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if st != CheckError {
		t.Fatalf("provider outage must record an 'error' check, got %s", st)
	}
	if next != "" {
		t.Fatalf("provider outage must NOT move the application (retryable), got %s", next)
	}
}

func TestCACDecision_NonMatchOutcomesRouteToReview(t *testing.T) {
	// company_not_found/mismatch/invalid/policy are all "needs a human" —
	// failed check, application lands in under_review (NOT auto-rejected, NOT
	// auto-approved).
	for _, code := range []CACResultCode{
		CACCompanyNotFound, CACMismatch, CACInvalidRegistration, CACPolicyRejected,
	} {
		st, next, err := cacDecision(code)
		if err != nil || st != CheckFailed || next != StateUnderReview {
			t.Fatalf("%s must map (failed, under_review), got (%s,%s,%v)", code, st, next, err)
		}
	}
}

func TestCACDecision_UnknownCodeRejected(t *testing.T) {
	if _, _, err := cacDecision("bogus"); !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("unknown result code must fail, got %v", err)
	}
}

// ─── kycDecision: the Tier-2 gate ────────────────────────────────────────────

func TestKYCDecision_TierGate(t *testing.T) {
	for _, tc := range []struct {
		tier int
		want CheckStatus
		next State
	}{
		{0, CheckFailed, StateNeedsInfo},
		{1, CheckFailed, StateNeedsInfo}, // Tier-1 (BVN only) is not enough
		{2, CheckPassed, StateUnderReview},
		{3, CheckPassed, StateUnderReview},
	} {
		st, next := kycDecision(tc.tier)
		if st != tc.want || next != tc.next {
			t.Fatalf("tier %d: got (%s,%s), want (%s,%s)", tc.tier, st, next, tc.want, tc.next)
		}
	}
}

// ─── decideReview: maker-checker + guards ────────────────────────────────────

func TestDecideReview_MakerCheckerBlocksSelfApproval(t *testing.T) {
	// The submitter can NEVER review their own application — even on a legal move.
	_, err := decideReview("user-A", "user-A", StateUnderReview, ReviewApprove, "")
	if !errors.Is(err, ErrMakerChecker) {
		t.Fatalf("self-review must be ErrMakerChecker, got %v", err)
	}
}

func TestDecideReview_DifferentReviewerAllowed(t *testing.T) {
	to, err := decideReview("user-A", "user-B", StateUnderReview, ReviewApprove, "")
	if err != nil || to != StateApproved {
		t.Fatalf("different reviewer must approve, got (%s,%v)", to, err)
	}
}

func TestDecideReview_ReasonRequired(t *testing.T) {
	for _, action := range []ReviewAction{ReviewReject, ReviewRequestInfo, ReviewSuspend, ReviewExpire} {
		from := StateUnderReview
		if action == ReviewSuspend || action == ReviewExpire {
			from = StateApproved
		}
		if _, err := decideReview("a", "b", from, action, "  "); !errors.Is(err, ErrInvalidAction) {
			t.Fatalf("%s without a reason must fail, got %v", action, err)
		}
	}
	// approve / reinstate may proceed silently.
	if _, err := decideReview("a", "b", StateUnderReview, ReviewApprove, ""); err != nil {
		t.Fatalf("approve must not require a reason, got %v", err)
	}
	if _, err := decideReview("a", "b", StateSuspended, ReviewReinstate, ""); err != nil {
		t.Fatalf("reinstate must not require a reason, got %v", err)
	}
}

func TestDecideReview_IllegalMoveBlocked(t *testing.T) {
	if _, err := decideReview("a", "b", StateDraft, ReviewApprove, ""); !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("approve from draft must be ErrIllegalTransition, got %v", err)
	}
	if _, err := decideReview("a", "b", StateCACPending, ReviewSuspend, "x"); !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("suspend from cac_verification_pending must be illegal, got %v", err)
	}
}

func TestDecideReview_UnknownActionRejected(t *testing.T) {
	if _, err := decideReview("a", "b", StateUnderReview, "nuke", ""); !errors.Is(err, ErrInvalidAction) {
		t.Fatalf("unknown action must be ErrInvalidAction, got %v", err)
	}
}

// ─── publishable: the CanPublish predicate ───────────────────────────────────

func TestPublishable_RequiresApprovedPlusBothChecks(t *testing.T) {
	for _, tc := range []struct {
		name     string
		state    State
		cac, kyc bool
		want     bool
	}{
		{"approved + both passed", StateApproved, true, true, true},
		{"approved, kyc missing", StateApproved, true, false, false},
		{"approved, cac missing", StateApproved, false, true, false},
		{"under_review with checks", StateUnderReview, true, true, false},
		{"suspended", StateSuspended, true, true, false},
		{"submitted", StateSubmitted, false, false, false},
		{"rejected", StateRejected, true, true, false},
	} {
		if got := publishable(tc.state, tc.cac, tc.kyc); got != tc.want {
			t.Fatalf("%s: publishable=%v, want %v", tc.name, got, tc.want)
		}
	}
}

// ─── registry mapping helpers ────────────────────────────────────────────────

func TestClassifyRegistryResult(t *testing.T) {
	for _, tc := range []struct {
		name string
		m    RegistryMatch
		want CACResultCode
	}{
		{"not found", RegistryMatch{Found: false}, CACCompanyNotFound},
		{"found inactive", RegistryMatch{Found: true, Name: "ACME TRANSPORT LTD", Status: "inactive"}, CACInvalidRegistration},
		{"found delisted", RegistryMatch{Found: true, Name: "ACME TRANSPORT LTD", Status: "delisted"}, CACInvalidRegistration},
		{"name mismatch", RegistryMatch{Found: true, Name: "TOTALLY DIFFERENT LTD", Status: "active"}, CACMismatch},
		{"match", RegistryMatch{Found: true, Name: "ACME TRANSPORT LTD", Status: "active"}, CACMatch},
	} {
		if got := classifyRegistryResult(tc.m, "Acme Transport Ltd"); got != tc.want {
			t.Fatalf("%s: got %s, want %s", tc.name, got, tc.want)
		}
	}
}

func TestNamesMatch(t *testing.T) {
	if !namesMatch("ACME Transport Ltd.", "acme transport ltd") {
		t.Fatal("case/punctuation-insensitive equality must match")
	}
	if !namesMatch("ACME Transport Limited", "ACME Transport") {
		t.Fatal("containment must match")
	}
	if namesMatch("ACME Transport", "") || namesMatch("", "ACME Transport") {
		t.Fatal("blank name must never match")
	}
	if namesMatch("ACME Transport", "Globex Motors") {
		t.Fatal("unrelated names must not match")
	}
}

func TestSandboxRegistryVerifier_CannedOutcomes(t *testing.T) {
	v := SandboxRegistryVerifier{}
	ctx := context.Background()

	m, err := v.VerifyCompany(ctx, "RC-NOTFOUND-1", "Acme")
	if err != nil || m.Found {
		t.Fatalf("NOTFOUND rc must return not-found, got %+v err=%v", m, err)
	}
	m, err = v.VerifyCompany(ctx, "RC-INACTIVE-9", "Acme")
	if err != nil || !m.Found || !isInactiveRegistryStatus(m.Status) {
		t.Fatalf("INACTIVE rc must return found+inactive, got %+v err=%v", m, err)
	}
	m, err = v.VerifyCompany(ctx, "RC-MISMATCH-2", "Acme")
	if err != nil || !m.Found || namesMatch(m.Name, "Acme") {
		t.Fatalf("MISMATCH rc must return a different name, got %+v err=%v", m, err)
	}
	m, err = v.VerifyCompany(ctx, "RC-123456", "Acme Transport Ltd")
	if err != nil || !m.Found || m.Status != "active" || m.Name != "Acme Transport Ltd" {
		t.Fatalf("default rc must return a match, got %+v err=%v", m, err)
	}
}

func TestMinimizeSnapshot_Whitelists(t *testing.T) {
	out := minimizeSnapshot(map[string]any{
		"found": true, "name": "Acme", "bvn": "1234", "director_phone": "080", "secret": "x",
	})
	if !out["found"].(bool) || out["name"] != "Acme" {
		t.Fatalf("whitelisted keys must survive: %v", out)
	}
	for _, k := range []string{"bvn", "director_phone", "secret"} {
		if _, ok := out[k]; ok {
			t.Fatalf("non-whitelisted key %q must be stripped: %v", k, out)
		}
	}
}
