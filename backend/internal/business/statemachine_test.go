package business

import "testing"

// Covers the CAC business-registry state machine (register_new and verify_existing
// paths) — legal transitions, illegal transitions, terminal states, and the
// verified-or-registered gate helper. Pure logic, no DB.

func TestCanTransition_RegisterNewHappyPath(t *testing.T) {
	// draft → name_check → name_reserved → registration_submitted → under_review → registered
	legal := [][2]Status{
		{StatusDraft, StatusNameCheck},
		{StatusNameCheck, StatusNameReserved},
		{StatusNameReserved, StatusRegistrationSubmitted},
		{StatusRegistrationSubmitted, StatusUnderReview},
		{StatusUnderReview, StatusRegistered},
		// provider may register directly from submit
		{StatusRegistrationSubmitted, StatusRegistered},
		// re-checking a different name is a self-loop
		{StatusNameCheck, StatusNameCheck},
		// reserve directly from draft (reserve implies availability)
		{StatusDraft, StatusNameReserved},
	}
	for _, tr := range legal {
		if !CanTransition(tr[0], tr[1]) {
			t.Errorf("register_new: %s → %s should be LEGAL", tr[0], tr[1])
		}
	}
}

func TestCanTransition_VerifyExistingHappyPath(t *testing.T) {
	legal := [][2]Status{
		{StatusDraft, StatusSubmitted},
		{StatusSubmitted, StatusVerified},
	}
	for _, tr := range legal {
		if !CanTransition(tr[0], tr[1]) {
			t.Errorf("verify_existing: %s → %s should be LEGAL", tr[0], tr[1])
		}
	}
}

func TestCanTransition_IllegalMovesRejected(t *testing.T) {
	illegal := [][2]Status{
		{StatusDraft, StatusRegistered},               // can't skip to terminal
		{StatusDraft, StatusVerified},                 // can't skip to terminal
		{StatusDraft, StatusUnderReview},              // must reserve first
		{StatusNameCheck, StatusRegistered},           // must reserve + submit first
		{StatusNameReserved, StatusVerified},          // wrong path (verify is for existing)
		{StatusSubmitted, StatusRegistered},           // verify path can't reach registered
		{StatusRegistrationSubmitted, StatusVerified}, // register path can't reach verified
	}
	for _, tr := range illegal {
		if CanTransition(tr[0], tr[1]) {
			t.Errorf("%s → %s should be ILLEGAL", tr[0], tr[1])
		}
	}
}

func TestTerminalStatesHaveNoExit(t *testing.T) {
	terminals := []Status{StatusRegistered, StatusVerified, StatusRejected, StatusFailed}
	for _, s := range terminals {
		if !IsTerminal(s) {
			t.Errorf("%s should be terminal", s)
		}
		// A terminal state cannot transition anywhere (including to itself).
		for _, to := range []Status{StatusDraft, StatusNameCheck, StatusUnderReview, StatusRegistered, StatusVerified} {
			if CanTransition(s, to) {
				t.Errorf("terminal %s → %s must be rejected", s, to)
			}
		}
	}
	for _, s := range []Status{StatusDraft, StatusNameCheck, StatusNameReserved, StatusRegistrationSubmitted, StatusUnderReview, StatusSubmitted} {
		if IsTerminal(s) {
			t.Errorf("%s should NOT be terminal", s)
		}
	}
}

func TestIsVerifiedOrRegistered(t *testing.T) {
	if !IsVerifiedOrRegistered(StatusVerified) || !IsVerifiedOrRegistered(StatusRegistered) {
		t.Error("verified/registered must count as a confirmed CAC identity")
	}
	for _, s := range []Status{StatusDraft, StatusNameCheck, StatusNameReserved, StatusRegistrationSubmitted, StatusUnderReview, StatusSubmitted, StatusRejected, StatusFailed} {
		if IsVerifiedOrRegistered(s) {
			t.Errorf("%s must NOT count as verified-or-registered (merchant-upgrade gate)", s)
		}
	}
}
