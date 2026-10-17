package transport

// LIVE-DB tests for the wallet parcel fare-drift guard. Gated on
// TEST_DATABASE_URL (paystackRidePool skips without it). They pin:
//  1. A stale expected_fare_kobo is refused with 409 FARE_CHANGED and NOTHING
//     moves: wallet balance unchanged, no settlement, no parcel row.
//  2. The matching fare books and escrows exactly that fare.
//  3. Omitting expected_fare_kobo books as before (old app builds, scheduled
//     dispatch).

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_BookParcel_FareDrift_RefusedBeforeAnyMoneyMoves(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, sender, testsupport.KycTierUnlimited)

	fare, err := svc.QuoteParcelBooking(ctx, parcelReq())
	if err != nil {
		t.Fatalf("quote: %v", err)
	}
	before := riderWalletBalance(t, ctx, pool, sender)

	// 1. The customer saw an older, lower price.
	stale := fare - 50_000
	req := parcelReq()
	req.ExpectedFareKobo = &stale
	key := "fare-drift-" + uuid.NewString()
	_, err = svc.BookParcel(ctx, sender, req, key)
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusConflict || ce.Code != CodeFareChanged {
		t.Fatalf("want 409 %s, got %v", CodeFareChanged, err)
	}
	if got := ce.Body()["fare_kobo"]; got != fare {
		t.Fatalf("409 must carry the live fare %d, got %v", fare, got)
	}
	if got := riderWalletBalance(t, ctx, pool, sender); got != before {
		t.Fatalf("wallet moved on a refused booking: %d → %d", before, got)
	}
	if n := countParcelsByKey(t, ctx, pool, key); n != 0 {
		t.Fatalf("refused booking created %d parcel rows", n)
	}
	var settlements int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM settlements WHERE idempotency_key=$1`, key).Scan(&settlements); err != nil {
		t.Fatal(err)
	}
	if settlements != 0 {
		t.Fatalf("refused booking created %d settlements", settlements)
	}

	// 2. Re-confirmed at the live price: books and escrows exactly that fare.
	req.ExpectedFareKobo = &fare
	p, err := svc.BookParcel(ctx, sender, req, "fare-ok-"+uuid.NewString())
	if err != nil {
		t.Fatalf("matching expected fare must book: %v", err)
	}
	if got, _ := p["fareKobo"].(int64); got != fare {
		t.Fatalf("booked fare %d, want %d", got, fare)
	}
	if got := riderWalletBalance(t, ctx, pool, sender); got != before-fare {
		t.Fatalf("wallet after booking %d, want %d", got, before-fare)
	}

	// 3. Omitted (legacy clients, scheduled dispatch): unchanged behaviour.
	if _, err := svc.BookParcel(ctx, sender, parcelReq(), "fare-omit-"+uuid.NewString()); err != nil {
		t.Fatalf("booking without expected_fare_kobo must still work: %v", err)
	}
}

// A transport-level retry of a booking that already succeeded (same
// Idempotency-Key, response lost) must get that booking back, not a 409 that
// tells the customer "nothing was charged" while their first booking is
// escrowed. And it must not charge again.
func TestLiveDB_BookParcel_FareDrift_ReplayOfBookedKeyReturnsTheBooking(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, sender, testsupport.KycTierUnlimited)

	fare, err := svc.QuoteParcelBooking(ctx, parcelReq())
	if err != nil {
		t.Fatalf("quote: %v", err)
	}
	key := "fare-replay-" + uuid.NewString()
	req := parcelReq()
	req.ExpectedFareKobo = &fare
	first, err := svc.BookParcel(ctx, sender, req, key)
	if err != nil {
		t.Fatalf("first booking: %v", err)
	}
	afterFirst := riderWalletBalance(t, ctx, pool, sender)

	// Same key, but the fare the retry carries no longer matches the live one
	// (as if pricing moved after the first booking committed).
	stale := fare + 10_000
	req.ExpectedFareKobo = &stale
	again, err := svc.BookParcel(ctx, sender, req, key)
	if err != nil {
		t.Fatalf("replay of a booked key must return the booking, got %v", err)
	}
	if again["id"] != first["id"] {
		t.Fatalf("replay returned parcel %v, want the original %v", again["id"], first["id"])
	}
	if got := riderWalletBalance(t, ctx, pool, sender); got != afterFirst {
		t.Fatalf("replay moved the wallet: %d → %d", afterFirst, got)
	}
	if n := countParcelsByKey(t, ctx, pool, key); n != 1 {
		t.Fatalf("%d parcels under the key, want 1", n)
	}
}
