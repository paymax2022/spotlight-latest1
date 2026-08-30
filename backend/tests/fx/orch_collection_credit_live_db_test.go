package fx_test

// ---------------------------------------------------------------------------
// LIVE-DB suite for INBOUND FX COLLECTIONS (deposits into a provisioned virtual
// account / IBAN) — the last link of the Maplerad/Eversend collections rail.
//
// Everything ahead of this link already existed: the live provider adapters, the
// credential-gated wiring, Service.CreateCollection provisioning a virtual
// account into orch_collections, the mobile Receive screen, and a signed
// webhook endpoint. What did NOT exist was the credit: HandleProviderEvent only
// mapped transfer/conversion STATUS, so a real deposit was signature-checked,
// acknowledged 200, and silently dropped. That is why orch_balances stayed empty
// on a live database even though the rail was provisioned.
//
// What these tests pin:
//   • a matched deposit credits the wallet through the SAME pot selector as
//     every other FX money path (NGN → main ledger, USD → orch_balances);
//   • a redelivered webhook credits exactly once;
//   • an unmatched reference credits NOTHING (no orphan credit — QA WH-INT-003);
//   • a currency that disagrees with the virtual account is refused, not guessed.
//
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/fx/... -run OrchCollection -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/orchestration/adapters"
)

// collectionOnlyService builds the Service over the deterministic adapters. The
// collection path never calls a provider — the deposit already happened at the
// bank; the webhook only tells us about it — so the adapters are irrelevant here
// and a stub keeps the test offline.
func collectionOnlyService(t *testing.T, store orchestration.Store) *orchestration.Service {
	t.Helper()
	return orchestration.NewService(
		[]orchestration.Provider{adapters.NewMapleradFX(false), adapters.NewEversend(false)},
		store,
		orchestration.Options{LockWindow: 90 * time.Second},
	)
}

// seedVirtualAccount provisions a virtual account row the way
// Service.CreateCollection does, and returns its id plus the provider handle a
// webhook would quote back.
func seedVirtualAccount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, store orchestration.Store, customer, currency string) (string, string) {
	t.Helper()
	providerRef := "99" + uuid.NewString()[:8]
	va := &orchestration.VirtualAccount{
		ID: "va_" + uuid.NewString(), CustomerID: customer, Currency: currency,
		Type: "virtual_account", Provider: "maplerad", Status: "active",
		ProviderRef: providerRef,
		Details: map[string]interface{}{
			"account_name": "Paymax Customer", "account_number": providerRef, "bank_name": "maplerad",
		},
		CreatedAt: time.Now(),
	}
	if err := store.SaveCollection(ctx, va); err != nil {
		t.Fatalf("seed virtual account: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM orch_collection_events WHERE virtual_account_id=$1`, va.ID)
		_, _ = pool.Exec(c, `DELETE FROM orch_collections WHERE id=$1`, va.ID)
	})
	return va.ID, providerRef
}

func collectionEventRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, customer string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM orch_collection_events WHERE customer_id=$1`, customer).Scan(&n); err != nil {
		t.Fatalf("count collection events: %v", err)
	}
	return n
}

// mapleradCollection is the webhook body Maplerad sends for a virtual-account
// credit. The event names are the ones the provider client already recognises
// (internal/provider/maplerad/maplerad.go ParseWebhook).
func mapleradCollection(eventID, providerRef, currency string, amountMinor int64) []byte {
	return []byte(`{
		"id": "` + eventID + `",
		"event": "collection.successful",
		"data": {
			"id": "` + eventID + `",
			"reference": "` + providerRef + `",
			"account_number": "` + providerRef + `",
			"currency": "` + currency + `",
			"amount": ` + itoa(amountMinor) + `,
			"status": "success",
			"sender_name": "ADA LOVELACE"
		}
	}`)
}

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	var b []byte
	for v > 0 {
		b = append([]byte{byte('0' + v%10)}, b...)
		v /= 10
	}
	return string(b)
}

// ── 1. A USD deposit credits the FX pot ─────────────────────────────────────

func TestLiveDB_OrchCollection_CreditsTheUSDWallet(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	store := orchestration.NewSQLStore(pool)
	_, providerRef := seedVirtualAccount(t, ctx, pool, store, user, "USD")

	svc := collectionOnlyService(t, store)
	if err := svc.HandleProviderEvent(ctx, "maplerad", mapleradCollection("evt_"+uuid.NewString(), providerRef, "USD", 250_00)); err != nil {
		t.Fatalf("handle collection webhook: %v", err)
	}

	if got := orchPotRow(t, ctx, pool, user, "USD"); got != 250_00 {
		t.Errorf("USD pot after deposit: got %d want %d", got, 250_00)
	}
	if got := collectionEventRows(t, ctx, pool, user); got != 1 {
		t.Errorf("collection event rows: got %d want 1", got)
	}
}

// ── 2. An NGN deposit lands in the MAIN wallet, not a private pot ────────────

func TestLiveDB_OrchCollection_NGNCreditsTheMainWallet(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	store := orchestration.NewSQLStore(pool)
	_, providerRef := seedVirtualAccount(t, ctx, pool, store, user, "NGN")

	svc := collectionOnlyService(t, store)
	if err := svc.HandleProviderEvent(ctx, "maplerad", mapleradCollection("evt_"+uuid.NewString(), providerRef, "NGN", 10_000_00)); err != nil {
		t.Fatalf("handle collection webhook: %v", err)
	}

	if got := mainWalletBalance(t, ctx, pool, user); got != 10_000_00 {
		t.Errorf("main wallet after NGN deposit: got %d want %d", got, 10_000_00)
	}
	if got := orchPotRow(t, ctx, pool, user, "NGN"); got != -1 {
		t.Errorf("NGN deposit created an orch_balances row (%d) — it must land in the main ledger", got)
	}
}

// ── 3. Redelivery credits exactly once ──────────────────────────────────────

func TestLiveDB_OrchCollection_ReplayCreditsOnce(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	store := orchestration.NewSQLStore(pool)
	_, providerRef := seedVirtualAccount(t, ctx, pool, store, user, "USD")

	svc := collectionOnlyService(t, store)
	body := mapleradCollection("evt_replay_"+uuid.NewString(), providerRef, "USD", 500_00)
	for i := 0; i < 3; i++ {
		if err := svc.HandleProviderEvent(ctx, "maplerad", body); err != nil {
			t.Fatalf("delivery %d: %v", i+1, err)
		}
	}

	if got := orchPotRow(t, ctx, pool, user, "USD"); got != 500_00 {
		t.Errorf("USD pot after 3 identical deliveries: got %d want %d (credited more than once)", got, 500_00)
	}
	if got := collectionEventRows(t, ctx, pool, user); got != 1 {
		t.Errorf("collection event rows after 3 deliveries: got %d want 1", got)
	}
}

// ── 4. Unmatched reference must not conjure a credit ────────────────────────

func TestLiveDB_OrchCollection_UnmatchedReferenceCreditsNothing(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	store := orchestration.NewSQLStore(pool)
	seedVirtualAccount(t, ctx, pool, store, user, "USD")

	svc := collectionOnlyService(t, store)
	// A deposit quoting an account we never provisioned. Acknowledged, never credited.
	if err := svc.HandleProviderEvent(ctx, "maplerad", mapleradCollection("evt_"+uuid.NewString(), "99999999-not-ours", "USD", 999_00)); err != nil {
		t.Fatalf("unmatched webhook should be acknowledged, got: %v", err)
	}

	if got := orchPotRow(t, ctx, pool, user, "USD"); got != -1 {
		t.Errorf("unmatched deposit credited a wallet (%d) — orphan credit", got)
	}
	if got := collectionEventRows(t, ctx, pool, user); got != 0 {
		t.Errorf("unmatched deposit recorded %d event rows, want 0", got)
	}
}

// ── 5. A currency that disagrees with the account is refused, not guessed ────

func TestLiveDB_OrchCollection_CurrencyMismatchIsRefused(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	store := orchestration.NewSQLStore(pool)
	_, providerRef := seedVirtualAccount(t, ctx, pool, store, user, "USD")

	svc := collectionOnlyService(t, store)
	// EUR arriving on a USD account: crediting either currency would be a guess.
	err := svc.HandleProviderEvent(ctx, "maplerad", mapleradCollection("evt_"+uuid.NewString(), providerRef, "EUR", 100_00))
	if err == nil {
		t.Fatal("currency mismatch was accepted — the deposit must be refused, not credited to a guessed wallet")
	}
	if got := orchPotRow(t, ctx, pool, user, "USD"); got != -1 {
		t.Errorf("mismatched deposit credited the USD wallet (%d)", got)
	}
	if got := orchPotRow(t, ctx, pool, user, "EUR"); got != -1 {
		t.Errorf("mismatched deposit opened an EUR wallet (%d)", got)
	}
	if got := collectionEventRows(t, ctx, pool, user); got != 0 {
		t.Errorf("mismatched deposit recorded %d event rows, want 0", got)
	}
}

// ── 6. The deposit shows up on the customer's collections feed ──────────────

func TestLiveDB_OrchCollection_AppearsOnTheCollectionsFeed(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	store := orchestration.NewSQLStore(pool)
	vaID, providerRef := seedVirtualAccount(t, ctx, pool, store, user, "USD")

	svc := collectionOnlyService(t, store)
	if err := svc.HandleProviderEvent(ctx, "maplerad", mapleradCollection("evt_"+uuid.NewString(), providerRef, "USD", 75_00)); err != nil {
		t.Fatalf("handle collection webhook: %v", err)
	}

	events, err := orchestration.NewCollectionStore(pool).ListCollectionEvents(ctx, user)
	if err != nil {
		t.Fatalf("list collection events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("collections feed: got %d events want 1", len(events))
	}
	got := events[0]
	if got.Amount.Amount != 75_00 || got.Amount.Currency != "USD" {
		t.Errorf("feed amount: got %d %s want 7500 USD", got.Amount.Amount, got.Amount.Currency)
	}
	if got.VirtualAccountID != vaID {
		t.Errorf("feed virtual account: got %q want %q", got.VirtualAccountID, vaID)
	}
	if got.SenderName == nil || *got.SenderName != "ADA LOVELACE" {
		t.Errorf("feed sender name not carried through: %v", got.SenderName)
	}
}

// ── 7. The deposit reaches Recent Activity with BOTH money legs populated ────
//
// Regression: the transactions feed used to emit one row per orch_collections
// row — i.e. per virtual ACCOUNT, which is not a transaction — with
// `destination.currency` left as "". The mobile TransactionRow formats that leg
// through CURRENCIES[currency], so an empty code was `undefined.decimals` and the
// crash blanked the WHOLE FX screen for any customer who had ever provisioned a
// collection account. The feed must carry real deposits, fully populated.
func TestLiveDB_OrchCollection_FeedRowIsAFullyFormedDeposit(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()

	user := seedUser(t, ctx, pool)
	cleanupOrch(t, pool, user)
	store := orchestration.NewSQLStore(pool)
	_, providerRef := seedVirtualAccount(t, ctx, pool, store, user, "USD")

	svc := collectionOnlyService(t, store)
	if err := svc.HandleProviderEvent(ctx, "maplerad", mapleradCollection("evt_"+uuid.NewString(), providerRef, "USD", 1_250_00)); err != nil {
		t.Fatalf("handle collection webhook: %v", err)
	}

	txs, err := store.Transactions(ctx, user)
	if err != nil {
		t.Fatalf("list transactions: %v", err)
	}

	var deposits int
	for _, tx := range txs {
		// No row may carry a blank currency on either leg — that is the crash.
		if tx.Source.Currency == "" || tx.Destination.Currency == "" {
			t.Fatalf("transaction %q (%s) has a blank currency: source=%+v destination=%+v",
				tx.ID, tx.Type, tx.Source, tx.Destination)
		}
		if tx.Type != "collection" {
			continue
		}
		deposits++
		if tx.Source.AmountMinor != 1_250_00 || tx.Destination.AmountMinor != 1_250_00 {
			t.Errorf("deposit amounts: source=%d destination=%d, want %d on both",
				tx.Source.AmountMinor, tx.Destination.AmountMinor, 1_250_00)
		}
		if tx.Direction != "in" {
			t.Errorf("deposit direction: got %q want \"in\"", tx.Direction)
		}
		// Must be a status the mobile TxStatus union actually admits; the old code
		// emitted the account's "active", which is not one of them.
		if tx.Status != "successful" {
			t.Errorf("deposit status: got %q want \"successful\"", tx.Status)
		}
	}
	if deposits != 1 {
		t.Errorf("collection rows in the feed: got %d want exactly 1 (the deposit, not the account)", deposits)
	}
}
