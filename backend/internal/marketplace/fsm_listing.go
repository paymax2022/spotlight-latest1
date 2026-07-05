package marketplace

import "net/http"

// Listing FSM (§2.1). Every transition is explicit; anything not listed is illegal
// and returns a typed CodedError. NO implicit transitions.
//
//	draft            → pending_review | active (auto-approve) | removed_user
//	pending_review   → active (approve) | removed_policy (reject) | removed_user
//	active           → paused | expired | sold | removed_policy | removed_user
//	paused           → active (resume) | removed_user
//	expired          → active (renew) | removed_user
//	(terminal: sold, removed_policy, removed_user)

// listingTransitions is the allowed-edge set for the listing lifecycle.
var listingTransitions = map[ListingStatus]map[ListingStatus]bool{
	ListingDraft: {
		ListingPendingReview: true,
		ListingActive:        true, // auto-approve path
		ListingRemovedUser:   true,
	},
	ListingPendingReview: {
		ListingActive:        true, // approve
		ListingRemovedPolicy: true, // reject
		ListingRemovedUser:   true,
	},
	ListingActive: {
		ListingPaused:        true,
		ListingExpired:       true,
		ListingSold:          true,
		ListingRemovedPolicy: true,
		ListingRemovedUser:   true,
	},
	ListingPaused: {
		ListingActive:      true, // resume
		ListingExpired:     true,
		ListingRemovedUser: true,
	},
	ListingExpired: {
		ListingActive:      true, // renew
		ListingRemovedUser: true,
	},
	// terminal states have no outgoing edges
	ListingSold:          {},
	ListingRemovedPolicy: {},
	ListingRemovedUser:   {},
}

// canListingTransition reports whether from → to is a legal listing edge.
func canListingTransition(from, to ListingStatus) bool {
	return listingTransitions[from][to]
}

// guardListingTransition returns a typed error when from → to is illegal.
func guardListingTransition(from, to ListingStatus) error {
	if !canListingTransition(from, to) {
		return &CodedError{
			Status:  http.StatusConflict,
			Code:    CodeInvalidListingTransition,
			Message: "illegal listing transition " + string(from) + " → " + string(to),
		}
	}
	return nil
}

// listingAffectsSearch reports whether a listing status implies an outbox op, and
// which one. active ⇒ upsert; anything that removes it from discovery ⇒ delete.
func listingOutboxOp(to ListingStatus) (op string, emit bool) {
	switch to {
	case ListingActive:
		return OutboxUpsert, true
	case ListingPaused, ListingExpired, ListingSold, ListingRemovedPolicy, ListingRemovedUser:
		return OutboxDelete, true
	default:
		return "", false
	}
}
