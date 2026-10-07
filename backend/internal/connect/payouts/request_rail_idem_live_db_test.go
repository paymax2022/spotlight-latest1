package connectpayouts

// LIVE-DB regression tests for the money-rail idempotency collision (S2):
// Service.Request used to hand the RAW client Idempotency-Key straight to
// wallet.Debit. ledger_entries.idempotency_key is a GLOBAL unique index, so
// the same key arriving from another rail (or another creator) collided there:
// the settlement debit silently no-opped while connect_payouts still recorded
// a 'requested' row — a payout with no money parked behind it.
//
// Fix under test: the key is scoped per (rail, caller) —
// "connect:payout:<creatorID>:<key>" — before it enters the ledger keyspace,
// and the same derived value is stored on connect_payouts.idempotency_key.
//
// Reuses the helpers in admin_live_db_test.go (newAdminTestPool,
// newTestCreator, creditWallet, buildAdminTestService) — same package, same
// live-DB gate:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/payouts/ -run TestLiveDB_RequestPayout -v

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

// TestLiveDB_RequestPayout_CrossRailKeyReuse_StillDebits is the phantom-payout
// regression: the raw client key was already claimed by ANOTHER rail's journal
// (a wallet credit posts K:debit/K:credit under the raw key). Before the fix
// the payout debit no-opped on the global index but the payout row still
// inserted — 'requested' with no money parked in settlement. Now the derived
// key lets the debit post for real: the creator's balance must actually drop.
func TestLiveDB_RequestPayout_CrossRailKeyReuse_StillDebits(t *testing.T) {
	pool := newAdminTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := buildAdminTestService(t, pool)

	creator := newTestCreator(t, pool)
	creditWallet(t, ledgerSvc, creator, 5_000_00)

	rawKey := "zzrail-xrail-" + uuid.NewString()
	// Another rail already claimed the RAW key for this user's journal.
	if err := ledgerSvc.Credit(ctx, creator, "other-rail:"+rawKey, rawKey,
		mustStanding(t, ledgerSvc, ledger.AccountProviderClearing), 1_000_00); err != nil {
		t.Fatalf("pre-claim raw key: %v", err)
	}

	bal0, err := ledgerSvc.GetBalance(ctx, creator)
	if err != nil {
		t.Fatalf("balance before: %v", err)
	}

	p, err := svc.Request(ctx, creator, rawKey, RequestPayoutRequest{
		AmountKobo:     1_000_00,
		DestinationRef: "test-bank-ref",
	})
	if err != nil {
		t.Fatalf("Request with a key already used on ANOTHER rail must still succeed: %v", err)
	}
	if p.Status != "requested" {
		t.Fatalf("payout status = %q, want requested", p.Status)
	}

	bal1, err := ledgerSvc.GetBalance(ctx, creator)
	if err != nil {
		t.Fatalf("balance after: %v", err)
	}
	if bal0-bal1 != 1_000_00 {
		t.Fatalf("wallet debited %d, want %d — a cross-rail key collision must never swallow the payout debit",
			bal0-bal1, 1_000_00)
	}

	derived := "connect:payout:" + creator + ":" + rawKey
	exists, err := ledgerSvc.Posted(ctx, derived)
	if err != nil {
		t.Fatalf("posted check: %v", err)
	}
	if !exists {
		t.Fatalf("no ledger entry under derived key %q — the payout debit did not post", derived)
	}
	var storedKey string
	if err := pool.QueryRow(ctx,
		`SELECT idempotency_key FROM connect_payouts WHERE id = $1`, p.ID).Scan(&storedKey); err != nil {
		t.Fatalf("read stored idem key: %v", err)
	}
	if storedKey != derived {
		t.Fatalf("connect_payouts.idempotency_key = %q, want derived %q", storedKey, derived)
	}
}

// TestLiveDB_RequestPayout_CrossUserSameKey_BothDebit: two creators presenting
// the same client-generated key must each get a real debit and their own row —
// caller-scoped derivation means the second request is NOT a replay.
func TestLiveDB_RequestPayout_CrossUserSameKey_BothDebit(t *testing.T) {
	pool := newAdminTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := buildAdminTestService(t, pool)

	creatorA := newTestCreator(t, pool)
	creatorB := newTestCreator(t, pool)
	creditWallet(t, ledgerSvc, creatorA, 5_000_00)
	creditWallet(t, ledgerSvc, creatorB, 5_000_00)

	rawKey := "zzrail-xuser-" + uuid.NewString()
	balA0, _ := ledgerSvc.GetBalance(ctx, creatorA)
	balB0, _ := ledgerSvc.GetBalance(ctx, creatorB)

	if _, err := svc.Request(ctx, creatorA, rawKey, RequestPayoutRequest{AmountKobo: 1_000_00}); err != nil {
		t.Fatalf("creator A Request: %v", err)
	}
	if _, err := svc.Request(ctx, creatorB, rawKey, RequestPayoutRequest{AmountKobo: 1_000_00}); err != nil {
		t.Fatalf("creator B Request with the same client key must not collide: %v", err)
	}

	balA1, _ := ledgerSvc.GetBalance(ctx, creatorA)
	balB1, _ := ledgerSvc.GetBalance(ctx, creatorB)
	if balA0-balA1 != 1_000_00 || balB0-balB1 != 1_000_00 {
		t.Fatalf("each creator must be debited exactly once: A debited %d, B debited %d",
			balA0-balA1, balB0-balB1)
	}
}

// TestLiveDB_RequestPayout_TrueReplay_Rejected: re-running the SAME request
// (same creator, key, amount) must not park a second debit — the derived-key
// insert conflicts and the call is rejected as a duplicate.
func TestLiveDB_RequestPayout_TrueReplay_Rejected(t *testing.T) {
	pool := newAdminTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := buildAdminTestService(t, pool)

	creator := newTestCreator(t, pool)
	creditWallet(t, ledgerSvc, creator, 5_000_00)

	rawKey := "zzrail-replay-" + uuid.NewString()
	bal0, _ := ledgerSvc.GetBalance(ctx, creator)

	if _, err := svc.Request(ctx, creator, rawKey, RequestPayoutRequest{AmountKobo: 1_000_00}); err != nil {
		t.Fatalf("first Request: %v", err)
	}
	if _, err := svc.Request(ctx, creator, rawKey, RequestPayoutRequest{AmountKobo: 1_000_00}); err == nil {
		t.Fatal("replayed Request must be rejected, not double-park the payout")
	}
	bal1, _ := ledgerSvc.GetBalance(ctx, creator)
	if bal0-bal1 != 1_000_00 {
		t.Fatalf("debited %d across a replay, want exactly %d", bal0-bal1, 1_000_00)
	}
}

// TestLiveDB_RequestPayout_KeyReuseDifferentAmount_Rejected: same creator
// reusing one key for a different amount is a foreign claim under the derived
// key — the ledger's replay check must fail it closed with ErrDuplicate.
func TestLiveDB_RequestPayout_KeyReuseDifferentAmount_Rejected(t *testing.T) {
	pool := newAdminTestPool(t)
	ctx := context.Background()
	svc, ledgerSvc := buildAdminTestService(t, pool)

	creator := newTestCreator(t, pool)
	creditWallet(t, ledgerSvc, creator, 5_000_00)

	rawKey := "zzrail-reuse-" + uuid.NewString()
	if _, err := svc.Request(ctx, creator, rawKey, RequestPayoutRequest{AmountKobo: 1_000_00}); err != nil {
		t.Fatalf("first Request: %v", err)
	}
	err := func() error {
		_, err := svc.Request(ctx, creator, rawKey, RequestPayoutRequest{AmountKobo: 2_000_00})
		return err
	}()
	if !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("expected ledger.ErrDuplicate for a foreign key claim, got %v", err)
	}
}

func mustStanding(t *testing.T, ledgerSvc *ledger.Service, accountType ledger.AccountType) string {
	t.Helper()
	acc, err := ledgerSvc.GetOrCreateStandingAccount(context.Background(), accountType)
	if err != nil {
		t.Fatalf("standing account %s: %v", accountType, err)
	}
	return acc.ID
}
