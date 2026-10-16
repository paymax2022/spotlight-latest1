package onboarding

import "testing"

func TestCanTransition_LegalPaths(t *testing.T) {
	legal := [][2]Status{
		{StatusNotStarted, StatusSubmitted},
		{StatusSubmitted, StatusInReview},
		{StatusInReview, StatusAwaitingTnC},
		{StatusAwaitingTnC, StatusActive},
		{StatusInReview, StatusActive},
		{StatusInReview, StatusRejected},
		{StatusRejected, StatusSubmitted},
		{StatusActive, StatusSuspended},
		{StatusInReview, StatusSuspended},
		{StatusSuspended, StatusActive},
		{StatusSuspended, StatusAwaitingTnC},
		{StatusSuspended, StatusInReview},
	}
	for _, p := range legal {
		if !CanTransition(p[0], p[1]) {
			t.Errorf("%s -> %s should be legal", p[0], p[1])
		}
	}
}

func TestCanTransition_RejectsRegression(t *testing.T) {
	illegal := [][2]Status{
		{StatusActive, StatusInReview},
		{StatusActive, StatusSubmitted},
		{StatusActive, StatusAwaitingTnC},
		{StatusAwaitingTnC, StatusInReview},
		{StatusInReview, StatusSubmitted},
		{StatusSubmitted, StatusNotStarted},
		{StatusNotStarted, StatusActive},
		{StatusSubmitted, StatusActive},
		{StatusRejected, StatusActive},
		{StatusRejected, StatusInReview},
		{StatusSuspended, StatusNotStarted},
		{StatusSuspended, StatusSubmitted},
		{StatusSuspended, StatusRejected},
		{StatusSuspended, StatusSuspended},
		{StatusActive, StatusActive},
		{StatusActive, StatusRejected},
		{StatusNotStarted, StatusSuspended},
		{Status("bogus"), StatusActive},
	}
	for _, p := range illegal {
		if CanTransition(p[0], p[1]) {
			t.Errorf("%s -> %s should be rejected", p[0], p[1])
		}
	}
}

func TestMapProviderStatus_BothVocabularies(t *testing.T) {
	cases := map[string]Status{
		"Pending":   StatusInReview,
		"Active":    StatusActive,
		"Suspended": StatusSuspended,
		"CREATED":   StatusSubmitted,
		"APPROVED":  StatusActive,
		"REJECTED":  StatusRejected,
		"active":    StatusActive,
		"":          StatusNotStarted,
		"weird":     StatusNotStarted,
	}
	for in, want := range cases {
		if got := MapProviderStatus(in); got != want {
			t.Errorf("MapProviderStatus(%q) = %s, want %s", in, got, want)
		}
	}
}
