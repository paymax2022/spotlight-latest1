package social

// The payer-side read for cashtag money requests.
//
// A request is only useful to the receiver if they can tell WHO is asking.
// Before this read carried the counterparty, GET /requests handed the client
// requester_id/payer_id UUIDs and no way to label them: the cashtag module
// resolves handle→id (GET /handle/:handle) and id→handle only for the caller
// (GET /handle/me), so a payer inbox built on it could only render a UUID.
// These tests pin the direction split and the counterparty label on both
// sides of the same request — the @doctor → @staging11 ₦200 case.
//
// ⚠️ GATED ON TEST_DATABASE_URL. Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/social/ -run 'TestLiveDB_SocialListRequests' -v

import (
	"context"
	"testing"

	"spotlight/backend/internal/finance/ledger"
)

func TestLiveDB_SocialListRequests_CarriesCounterpartyOnBothSides(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	// requestHandle/oweHandle are the two parties; the names mirror the real
	// scenario (one requestor, one receiver who must pay).
	requester := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)

	reqHandle := "rq" + shortTag() // stored normalized: no leading "@"
	payHandle := "py" + shortTag()
	if _, err := svc.tags.Claim(ctx, requester, reqHandle); err != nil {
		t.Fatalf("claim requester handle: %v", err)
	}
	if _, err := svc.tags.Claim(ctx, payer, payHandle); err != nil {
		t.Fatalf("claim payer handle: %v", err)
	}

	// "@doctor requests ₦200 from @staging11" — 200_00 kobo.
	req, err := svc.CreateRequest(ctx, requester, payHandle, "lunch", 200_00)
	if err != nil {
		t.Fatalf("CreateRequest: %v", err)
	}

	// The RECEIVER's view: this is incoming (they owe), and it is labelled
	// with the person who asked them.
	incoming, err := svc.ListRequests(ctx, payer, 50)
	if err != nil {
		t.Fatalf("payer ListRequests: %v", err)
	}
	got := findRequest(t, incoming, req.ID)
	if got.Direction != "incoming" {
		t.Errorf("payer direction = %q, want incoming (I owe)", got.Direction)
	}
	if got.CounterpartID != requester || got.CounterpartHandle != reqHandle {
		t.Errorf("payer counterparty = (%q, %q), want the requester (%s, %q)",
			got.CounterpartID, got.CounterpartHandle, requester, reqHandle)
	}
	// No user_profiles row was seeded, so the name falls back to the handle —
	// the same COALESCE the pool contributor roster uses. Never an empty label.
	if got.CounterpartName != reqHandle {
		t.Errorf("payer counterparty name = %q, want fallback to handle %q", got.CounterpartName, reqHandle)
	}
	if got.AmountKobo != 200_00 || got.State != RequestPending {
		t.Errorf("payer row = amount %d state %q, want 20000 PENDING", got.AmountKobo, got.State)
	}

	// The REQUESTOR's view of the same row: outgoing (owed to me), labelled
	// with the person who must pay.
	outgoing, err := svc.ListRequests(ctx, requester, 50)
	if err != nil {
		t.Fatalf("requester ListRequests: %v", err)
	}
	back := findRequest(t, outgoing, req.ID)
	if back.Direction != "outgoing" {
		t.Errorf("requester direction = %q, want outgoing (owed to me)", back.Direction)
	}
	if back.CounterpartID != payer || back.CounterpartHandle != payHandle {
		t.Errorf("requester counterparty = (%q, %q), want the payer (%s, %q)",
			back.CounterpartID, back.CounterpartHandle, payer, payHandle)
	}

	// A stranger is not party to it, so the row must not surface at all — the
	// scoping is the WHERE clause, and a leaked label here would be an oracle.
	stranger := socialTestUser(t, pool)
	theirs, err := svc.ListRequests(ctx, stranger, 50)
	if err != nil {
		t.Fatalf("stranger ListRequests: %v", err)
	}
	for _, r := range theirs {
		if r.ID == req.ID {
			t.Fatalf("stranger ListRequests leaked request %s", req.ID)
		}
	}
}

// TestLiveDB_SocialListRequests_PaidRequestStaysVisible pins that the read the
// payer acts on is the SAME read that reflects the action: after PayRequest the
// row must still appear (direction incoming) and carry PAID, so the inbox can
// flip "Pay ₦200" to a settled state without a second endpoint.
func TestLiveDB_SocialListRequests_PaidRequestStaysVisible(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	requester := socialTestUser(t, pool)
	// The payer must be able to actually fund the request: a KYC tier and a
	// wallet balance, because PayRequest runs the same fail-closed debit gate
	// every other social money path does.
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	fundWallet(t, ctx, led, payer, 300_00)

	reqHandle := "rp" + shortTag()
	payHandle := "pp" + shortTag()
	if _, err := svc.tags.Claim(ctx, requester, reqHandle); err != nil {
		t.Fatalf("claim requester handle: %v", err)
	}
	if _, err := svc.tags.Claim(ctx, payer, payHandle); err != nil {
		t.Fatalf("claim payer handle: %v", err)
	}
	req, err := svc.CreateRequest(ctx, requester, payHandle, "vet", 200_00)
	if err != nil {
		t.Fatalf("CreateRequest: %v", err)
	}
	if err := svc.PayRequest(ctx, payer, req.ID); err != nil {
		t.Fatalf("PayRequest: %v", err)
	}

	rows, err := svc.ListRequests(ctx, payer, 50)
	if err != nil {
		t.Fatalf("payer ListRequests: %v", err)
	}
	got := findRequest(t, rows, req.ID)
	if got.State != RequestPaid {
		t.Errorf("state after pay = %q, want PAID", got.State)
	}
	if got.CounterpartHandle != reqHandle {
		t.Errorf("counterparty handle = %q, want the requester %q", got.CounterpartHandle, reqHandle)
	}
	// The money must have landed: the payer is debited and the requester
	// credited, so the inbox row that flips to PAID is backed by legs (NL-8).
	if bal, _ := led.GetBalance(ctx, requester); bal != 200_00 {
		t.Errorf("requester wallet = %d, want 20000 (the ₦200 request fulfilled)", bal)
	}
	if bal, _ := led.GetBalance(ctx, payer); bal != 100_00 {
		t.Errorf("payer wallet = %d, want 10000 (30000 funded - 20000 paid)", bal)
	}
}

func findRequest(t *testing.T, rows []RequestRow, id string) RequestRow {
	t.Helper()
	for _, r := range rows {
		if r.ID == id {
			return r
		}
	}
	t.Fatalf("request %s absent from ListRequests result (%d rows)", id, len(rows))
	return RequestRow{}
}
