package paystackcheckout

import (
	"context"
	"errors"
	"testing"
)

// TestOwnerCustomerID_ResolvesTheStartingCustomer: the Status HTTP handler
// relies on this to refuse a caller polling someone else's checkout — see
// handler.go's Status method. A reference is a bare Paystack transaction
// reference, not a per-caller secret, so without an ownership check any
// authenticated user could read another customer's order/amount by guessing
// or observing a reference.
func TestOwnerCustomerID_ResolvesTheStartingCustomer(t *testing.T) {
	svc := NewService(&fakeGateway{}, &fakeOrders{quoteAmount: 100_000}, newFakeIntents(), &fakeSettlementReverser{})
	intent, err := svc.InitiateCheckout(context.Background(), "rest-1", "cust-owner", sampleReq("idem-owner"), "a@b.com", "")
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	owner, err := svc.OwnerCustomerID(context.Background(), intent.Reference)
	if err != nil {
		t.Fatalf("OwnerCustomerID: %v", err)
	}
	if owner != "cust-owner" {
		t.Errorf("owner = %s, want cust-owner", owner)
	}
}

func TestOwnerCustomerID_UnknownReference(t *testing.T) {
	svc := NewService(&fakeGateway{}, &fakeOrders{}, newFakeIntents(), &fakeSettlementReverser{})
	if _, err := svc.OwnerCustomerID(context.Background(), "foodorder:nope"); !errors.Is(err, ErrUnknownReference) {
		t.Fatalf("err = %v, want ErrUnknownReference", err)
	}
}
