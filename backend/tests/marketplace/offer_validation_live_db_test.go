package marketplace_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// A missing or malformed offer input must name the field, not surface Postgres.
//
// CreateOffer bound its body and passed straight through, so a request that
// omitted listingId — or spelled it listing_id, an easy mistake when the RESPONSE
// is camelCase — reached the repository with an empty string and came back as
// 500 "invalid input syntax for type uuid". ListOffers had always validated it;
// only the create path had not.
func TestCreateOffer_RejectsEmptyListingID(t *testing.T) {
	svc, _ := liveConnectService(t)

	_, err := svc.CreateOffer(context.Background(), uuid.NewString(), "", 250000, "hello")
	if err == nil {
		t.Fatal("an empty listingId was accepted")
	}
	// The point is the shape of the failure: a caller error, not a database one.
	if strings.Contains(err.Error(), "invalid input syntax") {
		t.Errorf("empty listingId produced a raw Postgres error: %v", err)
	}
}

// A real listing with a nonsense price is equally the caller's error.
func TestCreateOffer_RejectsNonPositivePrice(t *testing.T) {
	ctx := context.Background()
	svc, seller, id := seedActiveOwnedListing(t, ctx)
	_ = seller

	for _, price := range []int64{0, -1} {
		if _, err := svc.CreateOffer(ctx, uuid.NewString(), id, price, "hello"); err == nil {
			t.Errorf("price %d was accepted", price)
		}
	}
}
