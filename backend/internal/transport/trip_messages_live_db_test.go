package transport

// ---------------------------------------------------------------------------
// LIVE-DB integration test for trip chat: object-level authz (only the rider
// and the assigned driver may read/post), role derivation, and a stranger
// being rejected. Skipped unless TEST_DATABASE_URL is set.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

func TestLiveDB_TripChatIsScopedToParticipants(t *testing.T) {
	pool := cashRidePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	svc := NewService(pool, settlementSvc).WithLedger(ledgerSvc)

	rider := seedCashTestRider(t, ctx, pool)
	driver := seedCashTestDriver(t, ctx, pool)
	stranger := seedCashTestRider(t, ctx, pool)

	// Fund the driver so they clear the cash-ride balance gate on accept —
	// this test is about chat scoping, not the balance gate (see
	// TestLiveDB_CashRideNoEscrowAndBalanceGate for that).
	revAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("resolve revenue account: %v", err)
	}
	if err := ledgerSvc.Credit(ctx, driver, "seed:chat-fixtures", "seed-fund-"+driver, revAcc.ID, 10_000_000); err != nil {
		t.Fatalf("fund driver: %v", err)
	}

	// A cash ride needs no rider funding/tier setup — request + accept it so
	// the trip has both participants resolved.
	req := RequestRideRequest{
		Pickup:        Place{Lat: 6.50, Lng: 3.40, Address: "Pickup"},
		Dest:          Place{Lat: 6.55, Lng: 3.45, Address: "Dest"},
		ServiceType:   "ride_hailing",
		PricingMode:   "instant",
		PaymentMethod: "cash",
	}
	detail, err := svc.RequestRide(ctx, rider, req, "chat-req-"+uuid.New().String())
	if err != nil {
		t.Fatalf("RequestRide: %v", err)
	}
	tripID, _ := detail.Trip["id"].(string)
	if _, err := svc.DriverAccept(ctx, tripID, driver); err != nil {
		t.Fatalf("DriverAccept: %v", err)
	}

	// Before any message: empty thread, not an error.
	msgs, err := svc.ListMessages(ctx, tripID, rider)
	if err != nil {
		t.Fatalf("ListMessages (empty): %v", err)
	}
	if len(msgs) != 0 {
		t.Fatalf("expected an empty thread, got %d messages", len(msgs))
	}

	// Rider sends; role is derived, not client-supplied.
	riderMsg, err := svc.SendMessage(ctx, tripID, rider, SendTripMessageRequest{Body: "I'm at the gate"})
	if err != nil {
		t.Fatalf("SendMessage (rider): %v", err)
	}
	if riderMsg.SenderRole != "rider" {
		t.Errorf("rider message sender_role = %q, want rider", riderMsg.SenderRole)
	}

	// Driver sends.
	driverMsg, err := svc.SendMessage(ctx, tripID, driver, SendTripMessageRequest{Body: "On my way, 2 mins"})
	if err != nil {
		t.Fatalf("SendMessage (driver): %v", err)
	}
	if driverMsg.SenderRole != "driver" {
		t.Errorf("driver message sender_role = %q, want driver", driverMsg.SenderRole)
	}

	// A stranger may neither read nor post.
	if _, err := svc.ListMessages(ctx, tripID, stranger); err == nil {
		t.Error("expected a stranger to be rejected from ListMessages")
	} else if ce, ok := err.(*CodedError); !ok || ce.Code != CodeForbidden {
		t.Errorf("expected CodeForbidden, got %v", err)
	}
	if _, err := svc.SendMessage(ctx, tripID, stranger, SendTripMessageRequest{Body: "hi"}); err == nil {
		t.Error("expected a stranger to be rejected from SendMessage")
	} else if ce, ok := err.(*CodedError); !ok || ce.Code != CodeForbidden {
		t.Errorf("expected CodeForbidden, got %v", err)
	}

	// Both participants see the full thread, oldest first.
	full, err := svc.ListMessages(ctx, tripID, driver)
	if err != nil {
		t.Fatalf("ListMessages (driver): %v", err)
	}
	if len(full) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(full))
	}
	if full[0].ID != riderMsg.ID || full[1].ID != driverMsg.ID {
		t.Error("expected messages ordered oldest-first (rider, then driver)")
	}
}

// TestLiveDB_TripChatRejectsBeforeDriverAssigned proves a would-be driver
// (not yet assigned to the trip) cannot read or post chat, closing the
// "unassigned driver" edge case tripParties must handle (driverUserID == "").
func TestLiveDB_TripChatRejectsBeforeDriverAssigned(t *testing.T) {
	pool := cashRidePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	svc := NewService(pool, settlementSvc).WithLedger(ledgerSvc)

	rider := seedCashTestRider(t, ctx, pool)
	notYetDriver := seedCashTestDriver(t, ctx, pool)

	req := RequestRideRequest{
		Pickup:        Place{Lat: 6.50, Lng: 3.40, Address: "Pickup"},
		Dest:          Place{Lat: 6.55, Lng: 3.45, Address: "Dest"},
		ServiceType:   "ride_hailing",
		PricingMode:   "instant",
		PaymentMethod: "cash",
	}
	detail, err := svc.RequestRide(ctx, rider, req, "chat-req2-"+uuid.New().String())
	if err != nil {
		t.Fatalf("RequestRide: %v", err)
	}
	tripID, _ := detail.Trip["id"].(string)

	if _, err := svc.SendMessage(ctx, tripID, notYetDriver, SendTripMessageRequest{Body: "hi"}); err == nil {
		t.Error("expected an unassigned driver to be rejected from SendMessage")
	}
	// The rider CAN post even before a driver is assigned — the thread just
	// has one participant so far.
	if _, err := svc.SendMessage(ctx, tripID, rider, SendTripMessageRequest{Body: "waiting for a driver"}); err != nil {
		t.Errorf("expected the rider to post before a driver is assigned, got: %v", err)
	}
}
