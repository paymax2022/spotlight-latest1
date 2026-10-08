package transport

// LIVE-DB (TEST_DATABASE_URL) tests for the ledger-audit findings that live in
// bookParcel itself:
//   H2  a replayed external escrow that is NOT a live escrow of THIS sender's
//       charge (refunded / other payer / wallet-funded) must never back a parcel
//   H5  an insert failure reverses the escrow only when it is PROVEN that no
//       parcel owns it, and the reversal leaves balanced books
//   L2  the external parcel id is the deterministic function of the key

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_BookParcelPaystackFunded_ReplayOverRefundedSettlement_BooksNothing(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 0)
	req := parcelReq()
	quoted, err := svc.QuoteParcelBooking(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	key := "parcelorder:h2-" + uuid.New().String()
	id, err := svc.BookParcelPaystackFunded(ctx, sender, req, key, quoted)
	if err != nil {
		t.Fatal(err)
	}
	if id != externalParcelID(key) {
		t.Errorf("parcel id %s is not the deterministic id %s for the key", id, externalParcelID(key))
	}
	// The booking is unwound: parcel gone, escrow reversed ledger-side → refunded settlement.
	sid, _, _, _ := settlementRow(t, ctx, pool, id)
	if _, err := pool.Exec(ctx, `DELETE FROM parcels WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if err := svc.settlement.RefundExternal(ctx, sid, "test_unwind"); err != nil {
		t.Fatal(err)
	}

	// A late retry of the same charge now replays EscrowExternal onto the REFUNDED row.
	got, err := svc.BookParcelPaystackFunded(ctx, sender, req, key, quoted)
	if err == nil {
		t.Fatalf("booked parcel %s on a refunded escrow: the sender would get a delivery for money that already went back to their card", got)
	}
	if n := countParcelsByKey(t, ctx, pool, key); n != 0 {
		t.Errorf("%d parcels created", n)
	}
	var st string
	_ = pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, sid).Scan(&st)
	if st != "refunded" {
		t.Errorf("settlement was revived to %q", st)
	}
}

func TestLiveDB_BookParcelPaystackFunded_ReplayOverForeignOrWalletSettlement_Refused(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 0)
	_, _, other := paystackRideFixture(t, ctx, pool, 0)
	req := parcelReq()
	quoted, _ := svc.QuoteParcelBooking(ctx, req)

	for name, tc := range map[string]struct{ payer, funding string }{
		"another payer's escrow": {other, "external"},
		"wallet-funded escrow":   {sender, "wallet"},
	} {
		key := "parcelorder:h2x-" + uuid.New().String()
		if _, err := pool.Exec(ctx, `
			INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
			VALUES ($1,$2,'transport',$3,$4,'escrowed',now(),$5,$6)`,
			uuid.New().String(), "parcel:seed", tc.payer, quoted, key, tc.funding); err != nil {
			t.Fatalf("%s seed: %v", name, err)
		}
		if _, err := svc.BookParcelPaystackFunded(ctx, sender, req, key, quoted); err == nil {
			t.Errorf("%s: a parcel was booked on a settlement that is not this sender's external escrow", name)
		}
		if n := countParcelsByKey(t, ctx, pool, key); n != 0 {
			t.Errorf("%s: %d parcels created", name, n)
		}
	}
}

func TestLiveDB_BookParcelPaystackFunded_InsertFailure_ReversesEscrowWhenNoParcelOwnsIt(t *testing.T) {
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, _, sender := paystackRideFixture(t, ctx, pool, 0)
	req := parcelReq()
	quoted, _ := svc.QuoteParcelBooking(ctx, req)

	// Occupy the id the NEXT booking will use (deterministic per key) with an
	// unrelated parcel so its INSERT hits the primary key: a real insert failure
	// with no parcel under (sender, key).
	k1 := "parcelorder:h5a-" + uuid.New().String()
	k2 := "parcelorder:h5b-" + uuid.New().String()
	first, err := svc.BookParcelPaystackFunded(ctx, sender, req, k1, quoted)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE parcels SET id=$1 WHERE id=$2`, externalParcelID(k2), first); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.BookParcelPaystackFunded(ctx, sender, req, k2, quoted); err == nil {
		t.Fatal("insert collision must surface as an error")
	}
	var st string
	var total int64
	if err := pool.QueryRow(ctx, `SELECT status, total_kobo FROM settlements WHERE idempotency_key=$1`, k2).Scan(&st, &total); err != nil {
		t.Fatal(err)
	}
	if st != "refunded" {
		t.Fatalf("orphan escrow status %q, want refunded (no parcel owns it, so the engine's gateway refund must leave balanced books)", st)
	}
	var debit, credit int64
	_ = pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference IN ($1,$2)`, "escrow:parcel:"+externalParcelID(k2), "refund:parcel:"+externalParcelID(k2)).Scan(&debit, &credit)
	if debit != credit || debit != 2*quoted {
		t.Errorf("ledger debit=%d credit=%d, want balanced at %d", debit, credit, 2*quoted)
	}
}
