package connectmonetization

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// ── Test doubles ──────────────────────────────────────────────────────────────

// fakeWallet records the debit it was asked to perform and returns a preset error
// so the test never proceeds to the (DB-backed) projection step. This lets us
// assert the MONEY PATH contract — server-resolved amount, idempotency key, and
// that a debit is attempted at all — without a live database.
type fakeWallet struct {
	called    bool
	gotUser   string
	gotKey    string
	gotCredit string
	gotAmount int64
	returnErr error
}

func (f *fakeWallet) Debit(_ context.Context, userID, _, idemKey, creditAccountID string, amountKobo int64) error {
	f.called = true
	f.gotUser = userID
	f.gotKey = idemKey
	f.gotCredit = creditAccountID
	f.gotAmount = amountKobo
	return f.returnErr
}

type fakeRevenue struct{ id string }

func (f *fakeRevenue) RevenueAccountID(context.Context) (string, error) { return f.id, nil }

type fakeAudit struct{ calls int }

func (f *fakeAudit) WriteAudit(context.Context, string, string, string, string, map[string]any) error {
	f.calls++
	return nil
}

// newServiceWithFakes builds a Service whose getPlan is overridden by a stub plan
// resolver, so Purchase logic can be exercised with no DB. We stop the flow at the
// wallet debit (which returns a sentinel) so recordPurchase is never reached.
func newServiceWithFakes(w *fakeWallet) (*Service, *fakeAudit) {
	au := &fakeAudit{}
	return &Service{
		db:      nil, // unused: debit fake returns before any DB call
		wallet:  w,
		revenue: &fakeRevenue{id: "rev-acc-1"},
		audit:   au,
	}, au
}

// stubPlan injects a deterministic plan, bypassing the DB lookup. We test the
// post-resolution money path; getPlan's SQL is covered by integration testing.
func withStubPlan(s *Service, p *Plan) {
	s.planLookup = func(context.Context, string) (*Plan, error) { return p, nil }
}

// ── Tests (written before wiring the real wallet) ─────────────────────────────

func boostPlan() *Plan {
	return &Plan{ID: "p1", Code: "boost_30min", Kind: KindBoost, Name: "Boost",
		PriceKobo: 80000, Entitlements: json.RawMessage(`{"boost_minutes":30}`), Active: true}
}

func TestPurchase_RequiresIdempotencyKey(t *testing.T) {
	w := &fakeWallet{}
	s, _ := newServiceWithFakes(w)
	withStubPlan(s, boostPlan())

	_, _, err := s.Purchase(context.Background(), "user-1", "", KindBoost, PurchaseRequest{PlanCode: "boost_30min"})
	if !errors.Is(err, ErrMissingIdem) {
		t.Fatalf("want ErrMissingIdem, got %v", err)
	}
	if w.called {
		t.Fatal("wallet must NOT be debited without an idempotency key")
	}
}

func TestPurchase_UsesServerPriceNotClient(t *testing.T) {
	w := &fakeWallet{returnErr: errors.New("stop-after-debit")}
	s, _ := newServiceWithFakes(w)
	withStubPlan(s, boostPlan())

	_, _, _ = s.Purchase(context.Background(), "user-1", "idem-abc", KindBoost,
		PurchaseRequest{PlanCode: "boost_30min"})

	if !w.called {
		t.Fatal("wallet should have been debited")
	}
	if w.gotAmount != 80000 {
		t.Fatalf("debit amount must come from the plan (80000 kobo), got %d", w.gotAmount)
	}
	if w.gotKey != "idem-abc" {
		t.Fatalf("idempotency key must flow to the ledger, got %q", w.gotKey)
	}
	if w.gotCredit != "rev-acc-1" {
		t.Fatalf("credit side must be the revenue account, got %q", w.gotCredit)
	}
	if w.gotUser != "user-1" {
		t.Fatalf("debit must hit the buyer's wallet, got %q", w.gotUser)
	}
}

func TestPurchase_KindGuard(t *testing.T) {
	w := &fakeWallet{}
	s, _ := newServiceWithFakes(w)
	withStubPlan(s, boostPlan()) // a boost plan...

	// ...bought via the subscriptions endpoint must be rejected before any debit.
	_, _, err := s.Purchase(context.Background(), "user-1", "idem-x", KindSubscription,
		PurchaseRequest{PlanCode: "boost_30min"})
	if !errors.Is(err, ErrKindMismatch) {
		t.Fatalf("want ErrKindMismatch, got %v", err)
	}
	if w.called {
		t.Fatal("no debit on kind mismatch (fail before money moves)")
	}
}

func TestPurchase_InsufficientFundsBubbles(t *testing.T) {
	sentinel := errors.New("ledger: insufficient funds")
	w := &fakeWallet{returnErr: sentinel}
	s, _ := newServiceWithFakes(w)
	withStubPlan(s, boostPlan())

	_, _, err := s.Purchase(context.Background(), "user-1", "idem-y", KindBoost,
		PurchaseRequest{PlanCode: "boost_30min"})
	if err == nil {
		t.Fatal("a failed debit must abort the purchase")
	}
}

func TestPurchase_RejectsZeroPricePlan(t *testing.T) {
	w := &fakeWallet{}
	s, _ := newServiceWithFakes(w)
	p := boostPlan()
	p.PriceKobo = 0
	withStubPlan(s, p)

	_, _, err := s.Purchase(context.Background(), "user-1", "idem-z", KindBoost,
		PurchaseRequest{PlanCode: "boost_30min"})
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("want ErrInvalidAmount, got %v", err)
	}
	if w.called {
		t.Fatal("no debit for a zero-price plan")
	}
}

// ── Pure entitlement-enforcement logic ────────────────────────────────────────

func TestFeatureEnabled(t *testing.T) {
	future := time.Now().UTC().Add(24 * time.Hour)
	past := time.Now().UTC().Add(-1 * time.Hour)
	ents := []Entitlement{
		{Active: true, ExpiresAt: &future, Features: json.RawMessage(`{"see_likers":true,"super_likes_per_day":5,"priority_discovery":false}`)},
		{Active: true, ExpiresAt: &past, Features: json.RawMessage(`{"expired_feature":true}`)},
		{Active: false, Features: json.RawMessage(`{"inactive_feature":true}`)},
	}
	cases := []struct {
		feature string
		want    bool
	}{
		{"see_likers", true},          // bool true
		{"super_likes_per_day", true}, // positive quota
		{"priority_discovery", false}, // bool false
		{"expired_feature", false},    // expired entitlement ignored
		{"inactive_feature", false},   // inactive entitlement ignored
		{"unknown", false},            // absent
	}
	for _, c := range cases {
		if got := featureEnabled(ents, c.feature); got != c.want {
			t.Errorf("featureEnabled(%q) = %v, want %v", c.feature, got, c.want)
		}
	}
}

func TestExpiresFor(t *testing.T) {
	now := time.Date(2026, 6, 23, 0, 0, 0, 0, time.UTC)
	d := 30
	sub := &Plan{Kind: KindSubscription, IntervalDays: &d}
	if got := sub.expiresFor(now); got == nil || !got.Equal(now.AddDate(0, 0, 30)) {
		t.Fatalf("subscription expiry wrong: %v", got)
	}
	boost := &Plan{Kind: KindBoost}
	if got := boost.expiresFor(now); got != nil {
		t.Fatalf("one-off boost should have no fixed expiry, got %v", got)
	}
}
