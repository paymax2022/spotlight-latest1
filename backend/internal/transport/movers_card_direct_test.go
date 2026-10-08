package transport

// Pure (DB-free) tests for the mover card-direct seam. The DB-backed halves
// live in movers_card_direct_live_db_test.go and
// paystackcheckout/movers_live_db_test.go.

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

// The wallet accept-bid handler must refuse keys in the card-direct namespaces
// (a card-funded settlement is keyed by the FULL Paystack reference, so a wallet
// key squatting "moversorder:" could collide with someone's card charge).
func TestAcceptMoverBid_WalletPathRejectsReservedCardDirectPrefixes(t *testing.T) {
	s := &Service{} // must be refused before any DB / settlement use
	for _, key := range []string{
		"moversorder:abc12345", "MOVERSORDER:abc12345", "parcelorder:abc12345", "rideorder:abc12345",
		"foodorder:abc12345", "duespay:abc12345", "feespay:abc12345", "towingorder:abc12345",
		"carhireorder:abc12345", "busorder:abc12345", "eventorder:abc12345",
	} {
		_, err := s.AcceptMoverBid(context.Background(), "job", "u1", "bid", key)
		ce, ok := errors.AsType[*CodedError](err)
		if !ok || ce.Status != http.StatusBadRequest || ce.Code != "INVALID_IDEMPOTENCY_KEY" {
			t.Errorf("key %q: want 400 INVALID_IDEMPOTENCY_KEY, got %v", key, err)
		}
	}
}

func TestAcceptMoverBidPaystackFunded_RefusesBlankKeyOrIdsBeforeAnyIO(t *testing.T) {
	s := &Service{}
	if _, err := s.AcceptMoverBidPaystackFunded(context.Background(), "u1", MoverAcceptRequest{JobID: "j", BidID: "b"}, "", 1, nil); err == nil {
		t.Error("empty idempotency key must be refused")
	}
	if _, err := s.AcceptMoverBidPaystackFunded(context.Background(), "u1", MoverAcceptRequest{JobID: "", BidID: "b"}, "moversorder:k", 1, nil); err == nil {
		t.Error("missing job id must be refused")
	}
	if _, err := s.AcceptMoverBidPaystackFunded(context.Background(), "u1", MoverAcceptRequest{JobID: "j", BidID: ""}, "moversorder:k", 1, nil); err == nil {
		t.Error("missing bid id must be refused")
	}
	if _, err := s.AcceptMoverBidPaystackFunded(context.Background(), "u1", MoverAcceptRequest{JobID: "j", BidID: "b"}, "moversorder:k", 0, nil); err == nil {
		t.Error("a non-positive verified amount must be refused")
	}
}
