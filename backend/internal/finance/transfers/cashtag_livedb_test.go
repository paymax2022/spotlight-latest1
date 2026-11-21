package transfers

// Live-DB proof that a cashtag-addressed recipient is a REAL wallet-to-wallet
// transfer, not a second rail: addressing someone by @handle resolves through
// the cashtag directory and then runs the same PIN + tier + atomic ledger path,
// producing one wallet_transfers row and two balanced journal legs.
//
// The unit tests in cashtag_recipient_test.go pin the recognition rules and the
// pre-flight ORDER; this one pins the parts only a database can prove — that
// uq_cashtag_handle really means one account per handle, that the directory and
// this rail agree on the same owner, and that the transfer lands on the handle
// owner's user_id rather than on whoever else shares a phone.
//
// ── Bring-up note ─────────────────────────────────────────────────────────
//  1. Local Supabase with all migrations applied, INCLUDING the cashtag spine
//     (supabase/migrations/20260716000000_top5_spine.sql → cashtag_handles).
//  2. Point at a disposable database — NEVER production:
//       export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//  3. Run:
//       cd backend && go test ./internal/finance/transfers/ -run LiveDB_Cashtag -v

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/finance/tiers"
)

// uniqueHandle returns a directory-legal handle that no earlier run left behind
// — uq_cashtag_handle is global, so a reused handle would resolve to the stale
// row instead of the account seeded here.
func uniqueHandle(t *testing.T) string {
	t.Helper()
	hex := strings.ReplaceAll(uuid.New().String(), "-", "")
	handle := "wt" + hex[:26]
	if !cashtag.IsValidShape(handle) {
		t.Fatalf("generated handle %q is not shape-valid", handle)
	}
	return handle
}

func TestLiveDB_CashtagRecipient_TransfersLikeAPhoneSend(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	svc.SetCashtagDirectory(cashtag.NewService(pool))

	sender := seedUser(t, ctx, pool)
	recipient := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, sender, 200_00)

	handle := uniqueHandle(t)
	if _, err := pool.Exec(ctx,
		`INSERT INTO cashtag_handles (user_id, handle) VALUES ($1,$2)`, recipient, handle); err != nil {
		t.Fatalf("seed cashtag: %v", err)
	}
	if err := svc.pins.Set(ctx, sender, "1234"); err != nil {
		t.Fatalf("set pin: %v", err)
	}

	// Resolution accepts either sigil and any case, and answers the handle owner.
	// The phone leg's masking is still what comes back, so the confirmation
	// screen shows a number the sender can recognise, plus the handle itself.
	got, err := svc.ResolvePaymaxUser(ctx, "$"+strings.ToUpper(handle))
	if err != nil {
		t.Fatalf("resolve by $CASHTAG: %v", err)
	}
	if got.UserID != recipient {
		t.Fatalf("handle resolved to %s, want %s", got.UserID, recipient)
	}
	if got.Handle != "@"+handle {
		t.Errorf("resolve echoed %q, want %q", got.Handle, "@"+handle)
	}

	// The send: same mutation a phone send performs.
	key := "cashtag-" + uuid.New().String()
	wt, err := svc.InitiateWalletToWallet(ctx, sender, WalletTransferRequest{
		RecipientIdentifier: "@" + handle,
		AmountKobo:          150_00,
		PIN:                 "1234",
		IdempotencyKey:      key,
	})
	if err != nil {
		t.Fatalf("wallet-to-wallet by cashtag: %v", err)
	}
	if wt.RecipientID != recipient {
		t.Fatalf("transfer paid %s, want the handle owner %s", wt.RecipientID, recipient)
	}

	// Exactly one row for the key — a handle send must not mint a second kind of
	// transfer record alongside the wallet_transfers row.
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM wallet_transfers WHERE idempotency_key=$1`, key).Scan(&rows); err != nil {
		t.Fatalf("count transfers: %v", err)
	}
	if rows != 1 {
		t.Errorf("wallet_transfers rows for the key = %d, want 1", rows)
	}

	// Both balances moved, and only the transfer amount moved.
	senderBal, err := led.GetBalance(ctx, sender)
	if err != nil {
		t.Fatalf("sender balance: %v", err)
	}
	if senderBal != 50_00 {
		t.Errorf("sender balance = %d kobo, want 5000 after a 15000 debit from 20000", senderBal)
	}
	recipientBal, err := led.GetBalance(ctx, recipient)
	if err != nil {
		t.Fatalf("recipient balance: %v", err)
	}
	if recipientBal != 150_00 {
		t.Errorf("recipient balance = %d kobo, want 15000", recipientBal)
	}

	// An unclaimed handle is a 404, the same answer a number no account carries
	// gives — and never a fall-through to phone matching.
	if _, err := svc.ResolvePaymaxUser(ctx, "@"+uniqueHandle(t)); !errors.Is(err, ErrRecipientNotFound) {
		t.Errorf("unclaimed handle: got %v, want ErrRecipientNotFound (404)", err)
	}
}

// TestLiveDB_CashtagSelfSendIsRefused: paying your own handle must hit the same
// 422 as paying your own number. Without the shared resolution step, a sender
// could mint a wallet_transfers row that moves nothing.
func TestLiveDB_CashtagSelfSendIsRefused(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	svc.SetCashtagDirectory(cashtag.NewService(pool))

	sender := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, sender, 200_00)
	handle := uniqueHandle(t)
	if _, err := pool.Exec(ctx,
		`INSERT INTO cashtag_handles (user_id, handle) VALUES ($1,$2)`, sender, handle); err != nil {
		t.Fatalf("seed sender cashtag: %v", err)
	}
	if err := svc.pins.Set(ctx, sender, "1234"); err != nil {
		t.Fatalf("set pin: %v", err)
	}

	_, err := svc.InitiateWalletToWallet(ctx, sender, WalletTransferRequest{
		RecipientIdentifier: "@" + handle,
		AmountKobo:          100_00,
		PIN:                 "1234",
		IdempotencyKey:      "self-" + uuid.New().String(),
	})
	if !errors.Is(err, ErrSelfTransfer) {
		t.Fatalf("self-send by cashtag: got %v, want ErrSelfTransfer (422)", err)
	}

	bal, err := led.GetBalance(ctx, sender)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 200_00 {
		t.Errorf("sender balance = %d kobo after a refused self-send, want 2000 untouched", bal)
	}
}

// A handle owner with phone IS NULL is real data, not a hypothetical: the phone
// leg filters `phone IS NOT NULL` and its partial index
// user_profiles_phone_nsn_idx exists on exactly that predicate, which is proof
// the column carries NULLs. The cashtag leg has no such filter — it looks the
// owner up by user_id — so it reads the row as it is.
//
// Two entry points, one handle: the app resolves through the BFF, which treats a
// null phone as empty; the web hits this Go rail. If the scan of a NULL phone
// errors out and the branch answers "no such recipient", the same $handle is
// payable from one client and unpayable from the other — on a money path, that
// divergence is the bug, whichever side is "right".
func TestLiveDB_CashtagRecipient_PhonelessProfileIsStillPayable(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()
	led := newLiveLedgerService(pool)
	svc := NewService(pool, led, tiers.NewService(pool), nil, nil)
	svc.SetCashtagDirectory(cashtag.NewService(pool))

	sender := seedUser(t, ctx, pool)
	owner := seedUser(t, ctx, pool)
	seedWallet(t, ctx, led, sender, 200_00)

	handle := uniqueHandle(t)
	if _, err := pool.Exec(ctx,
		`INSERT INTO cashtag_handles (user_id, handle) VALUES ($1,$2)`, owner, handle); err != nil {
		t.Fatalf("seed owner cashtag: %v", err)
	}
	tag, err := pool.Exec(ctx, `UPDATE user_profiles SET phone = NULL WHERE id = $1`, owner)
	if err != nil {
		t.Fatalf("null the owner's phone: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("seedUser did not create a profile row for %s (rows=%d)", owner, tag.RowsAffected())
	}

	got, err := svc.ResolvePaymaxUser(ctx, "@"+handle)
	if err != nil {
		t.Fatalf("resolve @%s for a phone-less owner: %v — a NULL phone must not become \"recipient not found\"", handle, err)
	}
	if got.UserID != owner {
		t.Fatalf("resolved user_id = %q, want the handle owner %q", got.UserID, owner)
	}
	if got.Handle != "@"+handle {
		t.Errorf("Handle = %q, want %q", got.Handle, "@"+handle)
	}
	// What the sender confirms on is the handle they typed, with a name. The masked
	// phone reads "****" because MaskPhone has no digits to mask for an empty
	// stored value; the BFF answers "" for the same row. Two maskers that have
	// never agreed on format (they disagree for real numbers too) — cosmetic, and
	// not a payment difference: this asserts both rails resolve AND pay this owner.
	t.Logf("phone-less owner resolved as name=%q maskedPhone=%q handle=%q", got.FullName, got.MaskedPhone, got.Handle)

	// And the resolution is worth the money: the send that follows it lands. The
	// owner needs no seeded wallet — crediting a first-time recipient is what a
	// phone send does too, and the ledger refuses a zero-amount seed.
	if err := svc.pins.Set(ctx, sender, "1234"); err != nil {
		t.Fatalf("set pin: %v", err)
	}
	wt, err := svc.InitiateWalletToWallet(ctx, sender, WalletTransferRequest{
		RecipientIdentifier: "@" + handle,
		AmountKobo:          100_00,
		PIN:                 "1234",
		IdempotencyKey:      "phoneless-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("send to a phone-less handle owner: %v", err)
	}
	if wt.RecipientID != owner {
		t.Fatalf("transfer paid %s, want the phone-less handle owner %s", wt.RecipientID, owner)
	}
	ownerBal, err := led.GetBalance(ctx, owner)
	if err != nil {
		t.Fatalf("owner balance: %v", err)
	}
	if ownerBal != 100_00 {
		t.Errorf("owner balance = %d kobo, want 10000 credited", ownerBal)
	}
}
