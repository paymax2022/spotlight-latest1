package connectdiscovery

import (
	"context"
	"errors"
	"testing"
	"time"
)

// ── Money-path test doubles ───────────────────────────────────────────────────

// fakeWallet records every debit and returns a preset error. Crucially it also
// enforces idempotency the way the real ledger does: a repeated idempotency key is
// a no-op (does NOT double-charge). This lets us prove the boost charge is
// idempotent per Idempotency-Key without a live ledger.
type fakeWallet struct {
	calls     int
	seenKeys  map[string]bool
	gotUser   string
	gotKey    string
	gotCredit string
	gotAmount int64
	returnErr error
}

func newFakeWallet() *fakeWallet { return &fakeWallet{seenKeys: map[string]bool{}} }

func (f *fakeWallet) Debit(_ context.Context, userID, _, idemKey, creditAccountID string, amountKobo int64) error {
	f.gotUser = userID
	f.gotKey = idemKey
	f.gotCredit = creditAccountID
	f.gotAmount = amountKobo
	if f.returnErr != nil {
		return f.returnErr
	}
	// Idempotency: a replayed key does not post a second charge (mirrors the ledger
	// unique idempotency_key → ErrDuplicate fast-path being treated as a no-op here).
	if f.seenKeys[idemKey] {
		return nil
	}
	f.seenKeys[idemKey] = true
	f.calls++ // count only the charges that actually moved money
	return nil
}

type fakeRevenue struct{ id string }

func (f *fakeRevenue) RevenueAccountID(context.Context) (string, error) { return f.id, nil }

// fakeTiers fails closed when limitErr is set (tier-limit exceeded), else passes.
type fakeTiers struct {
	limitErr error
	called   bool
}

func (f *fakeTiers) EnforceWalletDebitLimit(context.Context, string, int64) error {
	f.called = true
	return f.limitErr
}

type fakeAudit struct{ calls int }

func (f *fakeAudit) WriteAudit(context.Context, string, string, string, string, map[string]any) error {
	f.calls++
	return nil
}

// fakeBoostStore is an in-memory connect_boosts, idempotent on the idempotency key
// so a replayed Insert yields the SAME boost (one charge → one boost row).
type fakeBoostStore struct {
	byKey     map[string]*Boost
	inserts   int
	insertErr error
}

func newFakeBoostStore() *fakeBoostStore { return &fakeBoostStore{byKey: map[string]*Boost{}} }

func (f *fakeBoostStore) ActiveBoost(_ context.Context, userID string, now time.Time) (*Boost, error) {
	for _, b := range f.byKey {
		if b.UserID == userID && b.Status == BoostActive && b.ExpiresAt.After(now) {
			return b, nil
		}
	}
	return nil, nil
}

func (f *fakeBoostStore) Insert(_ context.Context, in *Boost) (*Boost, error) {
	if f.insertErr != nil {
		return nil, f.insertErr
	}
	if existing, ok := f.byKey[in.IdempotencyKey]; ok {
		return existing, nil // idempotent replay → same row
	}
	f.inserts++
	cp := *in
	cp.ID = "boost-" + in.IdempotencyKey
	f.byKey[in.IdempotencyKey] = &cp
	return &cp, nil
}

// newBoostServiceWithFakes builds a BoostService with a nil DB config reader; a
// nil-DB configReader returns the built-in defaults (price 50000, duration 30) so
// price/duration resolution is deterministic in tests.
func newBoostServiceWithFakes(w *fakeWallet, tg *fakeTiers) (*BoostService, *fakeBoostStore, *fakeAudit) {
	store := newFakeBoostStore()
	au := &fakeAudit{}
	svc := NewBoostService(store, w, &fakeRevenue{id: "paymax-revenue-1"}, tg, au, nil, &configReader{db: nil})
	return svc, store, au
}

// ── Tests ──────────────────────────────────────────────────────────────────────

func TestBoost_RequiresIdempotencyKey(t *testing.T) {
	w := newFakeWallet()
	svc, store, _ := newBoostServiceWithFakes(w, &fakeTiers{})
	if _, err := svc.Purchase(context.Background(), "user-1", "", 0); !errors.Is(err, ErrBoostMissingIdem) {
		t.Fatalf("want ErrBoostMissingIdem, got %v", err)
	}
	if w.calls != 0 {
		t.Fatal("wallet must NOT be charged without an idempotency key")
	}
	if store.inserts != 0 {
		t.Fatal("no boost row without an idempotency key")
	}
}

func TestBoost_TierLimitFailsClosedBeforeCharge(t *testing.T) {
	w := newFakeWallet()
	tg := &fakeTiers{limitErr: errors.New("tiers: daily debit limit exceeded")}
	svc, store, au := newBoostServiceWithFakes(w, tg)

	_, err := svc.Purchase(context.Background(), "user-1", "idem-1", 0)
	if err == nil {
		t.Fatal("a tier-limit breach must abort the purchase")
	}
	if !tg.called {
		t.Fatal("tier limit must be checked")
	}
	if w.calls != 0 {
		t.Fatal("FAIL-CLOSED: wallet must NOT be charged after a tier-limit breach")
	}
	if store.inserts != 0 {
		t.Fatal("no boost row when the tier gate blocks")
	}
	if au.calls != 0 {
		t.Fatal("no audit event for a blocked (never-charged) purchase")
	}
}

func TestBoost_IdempotentPerKey_DoublePOSTOneCharge(t *testing.T) {
	w := newFakeWallet()
	svc, store, _ := newBoostServiceWithFakes(w, &fakeTiers{})

	b1, err := svc.Purchase(context.Background(), "user-1", "idem-dup", 0)
	if err != nil {
		t.Fatalf("first purchase failed: %v", err)
	}
	b2, err := svc.Purchase(context.Background(), "user-1", "idem-dup", 0)
	if err != nil {
		t.Fatalf("replayed purchase must succeed as a no-op, got %v", err)
	}
	if w.calls != 1 {
		t.Fatalf("double POST with the same key must charge ONCE, charged %d times", w.calls)
	}
	if store.inserts != 1 {
		t.Fatalf("double POST must yield ONE boost row, got %d", store.inserts)
	}
	if b1.ID != b2.ID {
		t.Fatalf("replay must return the SAME boost, got %q vs %q", b1.ID, b2.ID)
	}
}

func TestBoost_ChargesServerPriceToRevenueAccount(t *testing.T) {
	w := newFakeWallet()
	svc, _, au := newBoostServiceWithFakes(w, &fakeTiers{})

	b, err := svc.Purchase(context.Background(), "user-42", "idem-x", 0)
	if err != nil {
		t.Fatalf("purchase failed: %v", err)
	}
	if w.gotAmount != 50000 {
		t.Fatalf("price must come from backend config (50000 kobo), got %d", w.gotAmount)
	}
	if w.gotUser != "user-42" {
		t.Fatalf("debit must hit the buyer's wallet, got %q", w.gotUser)
	}
	if w.gotCredit != "paymax-revenue-1" {
		t.Fatalf("credit side must be the paymax_revenue account, got %q", w.gotCredit)
	}
	if w.gotKey != "idem-x" {
		t.Fatalf("idempotency key must flow to the ledger, got %q", w.gotKey)
	}
	if b.PriceKobo != 50000 || b.DurationMinutes != 30 {
		t.Fatalf("boost row must record server price/duration, got %d/%d", b.PriceKobo, b.DurationMinutes)
	}
	// The recorded ledger charge and the boost projection must agree on the amount:
	// this is the balance invariant at the service seam (DR wallet == CR revenue ==
	// boost.priceKobo). A live ledger enforces the double-entry balance itself.
	if b.PriceKobo != w.gotAmount {
		t.Fatalf("ledger charge (%d) and boost row (%d) must be the SAME kobo", w.gotAmount, b.PriceKobo)
	}
	if au.calls != 1 {
		t.Fatalf("exactly one immutable audit event per charged boost, got %d", au.calls)
	}
}

func TestBoost_InsufficientFundsAbortsAndSkipsProjection(t *testing.T) {
	w := newFakeWallet()
	w.returnErr = errors.New("ledger: insufficient funds")
	svc, store, au := newBoostServiceWithFakes(w, &fakeTiers{})

	if _, err := svc.Purchase(context.Background(), "user-1", "idem-broke", 0); err == nil {
		t.Fatal("a failed debit must abort the purchase")
	}
	if store.inserts != 0 {
		t.Fatal("no boost row when the charge fails")
	}
	if au.calls != 0 {
		t.Fatal("no audit event when the charge fails")
	}
}

func TestBoost_ExpiryDerivedFromDuration(t *testing.T) {
	w := newFakeWallet()
	svc, _, _ := newBoostServiceWithFakes(w, &fakeTiers{})
	b, err := svc.Purchase(context.Background(), "user-1", "idem-exp", 0)
	if err != nil {
		t.Fatalf("purchase failed: %v", err)
	}
	gotWindow := b.ExpiresAt.Sub(b.StartedAt)
	if gotWindow != 30*time.Minute {
		t.Fatalf("expiry must be startedAt + durationMinutes, got %v", gotWindow)
	}
}
