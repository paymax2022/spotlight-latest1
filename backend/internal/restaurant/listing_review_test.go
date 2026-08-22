package restaurant

import "testing"

// The listing-review state machine (foodhub A6 / §6.3).
//
// Exhaustive over the transition table, because the failure mode is silent:
// nothing crashes when a rejected listing quietly becomes publishable.

func TestListingSubmissionPath(t *testing.T) {
	// The ordinary life of a new restaurant.
	if !CanTransitionListing(ListingDraft, ListingPending) {
		t.Error("a draft cannot be submitted for review")
	}
	if !CanTransitionListing(ListingPending, ListingApproved) {
		t.Error("a pending listing cannot be approved")
	}
}

func TestOwnerCanAlwaysGetBackIntoReview(t *testing.T) {
	// Rejection and "changes requested" must not be dead ends — the owner fixes
	// the problem and resubmits.
	for _, from := range []ListingReviewStatus{ListingRejected, ListingChangesRequested} {
		if !CanTransitionListing(from, ListingPending) {
			t.Errorf("%s is a dead end — the owner can never resubmit", from)
		}
	}
}

func TestApprovedListingsCanBePulled(t *testing.T) {
	// A listing that has gone bad must be pullable WITHOUT deleting the
	// restaurant, which would take its order history and payouts with it.
	for _, to := range []ListingReviewStatus{ListingChangesRequested, ListingRejected, ListingPending} {
		if !CanTransitionListing(ListingApproved, to) {
			t.Errorf("an approved listing cannot be moved to %s", to)
		}
	}
}

func TestIllegalTransitionsAreRejected(t *testing.T) {
	illegal := []struct{ from, to ListingReviewStatus }{
		// Skipping review entirely is the transition this whole feature exists to
		// prevent.
		{ListingDraft, ListingApproved},
		{ListingRejected, ListingApproved},
		{ListingChangesRequested, ListingApproved},
		// Sideways moves that would mean nothing.
		{ListingDraft, ListingRejected},
		{ListingApproved, ListingApproved},
		{ListingPending, ListingPending},
	}
	for _, c := range illegal {
		if CanTransitionListing(c.from, c.to) {
			t.Errorf("illegal transition allowed: %s -> %s", c.from, c.to)
		}
	}
}

func TestOnlyApprovedIsPublic(t *testing.T) {
	if !IsPubliclyListable(ListingApproved) {
		t.Error("an approved listing is not public")
	}
	for _, s := range []ListingReviewStatus{ListingDraft, ListingPending, ListingRejected, ListingChangesRequested, ""} {
		if IsPubliclyListable(s) {
			t.Errorf("%q is treated as publicly listable", s)
		}
	}
}

func TestUnknownStatusesNeverPublish(t *testing.T) {
	// A row written by a newer build, or a corrupt value, must fail closed.
	if IsPubliclyListable(ListingReviewStatus("APPROVED_MAYBE")) {
		t.Error("an unrecognised status was treated as publishable")
	}
	if CanTransitionListing(ListingReviewStatus("WHATEVER"), ListingApproved) {
		t.Error("an unrecognised status could transition to approved")
	}
}

func TestNegativeDecisionsRequireAReason(t *testing.T) {
	// An owner told "rejected" with no reason has nothing to act on.
	for _, s := range []ListingReviewStatus{ListingRejected, ListingChangesRequested} {
		if !ListingDecisionNeedsReason(s) {
			t.Errorf("%s should require a reviewer reason", s)
		}
	}
	if ListingDecisionNeedsReason(ListingApproved) {
		t.Error("approval should not require a reason")
	}
}
