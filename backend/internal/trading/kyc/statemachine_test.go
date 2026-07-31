package kyc

import (
	"testing"
	"time"
)

func TestFSM_LegalHappyPath(t *testing.T) {
	legal := [][2]Status{
		{StatusNotStarted, StatusSubmitted},
		{StatusSubmitted, StatusUnderReview},
		{StatusUnderReview, StatusApproved},
		{StatusApproved, StatusExpired},
		{StatusExpired, StatusSubmitted},
		{StatusUnderReview, StatusRejected},
		{StatusRejected, StatusSubmitted},
	}
	for _, e := range legal {
		if !CanTransition(e[0], e[1]) {
			t.Errorf("expected legal transition %s → %s", e[0], e[1])
		}
	}
}

func TestFSM_IllegalTransitionsRejected(t *testing.T) {
	illegal := [][2]Status{
		{StatusNotStarted, StatusApproved},   // cannot approve without review
		{StatusNotStarted, StatusUnderReview}, // must submit first
		{StatusSubmitted, StatusApproved},     // must go through review
		{StatusApproved, StatusRejected},      // approved is terminal-good (only expires)
		{StatusApproved, StatusBypassed},      // never bypass an already-approved user
		{StatusRejected, StatusApproved},      // must resubmit + review
		{StatusExpired, StatusApproved},       // must re-verify
	}
	for _, e := range illegal {
		if CanTransition(e[0], e[1]) {
			t.Errorf("expected ILLEGAL transition %s → %s to be blocked", e[0], e[1])
		}
	}
}

func TestFSM_BypassReachableOnlyPreApproval(t *testing.T) {
	for _, from := range []Status{StatusNotStarted, StatusSubmitted, StatusUnderReview, StatusRejected, StatusExpired} {
		if !CanTransition(from, StatusBypassed) {
			t.Errorf("bypass should be reachable from %s", from)
		}
	}
	if CanTransition(StatusApproved, StatusBypassed) {
		t.Error("bypass must NOT be reachable from APPROVED")
	}
}

func TestFSM_IdempotentSameStatus(t *testing.T) {
	if !CanTransition(StatusApproved, StatusApproved) {
		t.Error("re-writing the same status must be idempotent-allowed")
	}
}

func TestFSM_UnknownStatusRejected(t *testing.T) {
	if IsValidStatus("GARBAGE") {
		t.Error("unknown status must be invalid")
	}
	if CanTransition("GARBAGE", StatusApproved) {
		t.Error("transition from unknown status must be blocked")
	}
}

func TestBypass_TwoPersonEnforced(t *testing.T) {
	if err := ValidateBypass("adm1", "adm1", "reason", time.Hour); err != ErrBypassSameApprover {
		t.Fatalf("same maker/checker must be rejected, got %v", err)
	}
	if err := ValidateBypass("", "adm2", "reason", time.Hour); err != ErrBypassNoMaker {
		t.Fatalf("missing maker must be rejected, got %v", err)
	}
	if err := ValidateBypass("adm1", "", "reason", time.Hour); err != ErrBypassNoChecker {
		t.Fatalf("missing checker must be rejected, got %v", err)
	}
}

func TestBypass_ReasonAndTTLRequired(t *testing.T) {
	if err := ValidateBypass("adm1", "adm2", "", time.Hour); err != ErrBypassNoReason {
		t.Fatalf("missing reason must be rejected, got %v", err)
	}
	if err := ValidateBypass("adm1", "adm2", "reason", 0); err != ErrBypassBadTTL {
		t.Fatalf("non-positive ttl must be rejected, got %v", err)
	}
	if err := ValidateBypass("adm1", "adm2", "reason", MaxBypassTTL+time.Hour); err != ErrBypassTTLTooLong {
		t.Fatalf("over-long ttl must be rejected, got %v", err)
	}
	if err := ValidateBypass("adm1", "adm2", "reason", MaxBypassTTL); err != nil {
		t.Fatalf("valid bypass at max ttl must pass, got %v", err)
	}
}

func TestAccess_ApprovedGranted(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	if !HasTradingAccess(StatusApproved, nil, now) {
		t.Error("APPROVED must have trading access")
	}
	for _, s := range []Status{StatusNotStarted, StatusSubmitted, StatusUnderReview, StatusRejected, StatusExpired} {
		if HasTradingAccess(s, nil, now) {
			t.Errorf("%s must NOT have trading access", s)
		}
	}
}

func TestAccess_BypassTimeBoxed(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	future := now.Add(time.Hour)
	past := now.Add(-time.Hour)

	if !HasTradingAccess(StatusBypassed, &future, now) {
		t.Error("un-expired bypass must have access")
	}
	if HasTradingAccess(StatusBypassed, &past, now) {
		t.Error("expired bypass must NOT have access")
	}
	if HasTradingAccess(StatusBypassed, nil, now) {
		t.Error("bypass with no expiry must fail closed (no access)")
	}
}

func TestBypassExpired_SweepCondition(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	past := now.Add(-time.Second)
	future := now.Add(time.Hour)

	if !BypassExpired(StatusBypassed, &past, now) {
		t.Error("past-expiry bypass should be sweepable to EXPIRED")
	}
	if BypassExpired(StatusBypassed, &future, now) {
		t.Error("future-expiry bypass should not be swept")
	}
	if !BypassExpired(StatusBypassed, nil, now) {
		t.Error("bypass with nil expiry must be treated as expired")
	}
	if BypassExpired(StatusApproved, &past, now) {
		t.Error("non-bypass status is never a bypass-expiry sweep target")
	}
}
