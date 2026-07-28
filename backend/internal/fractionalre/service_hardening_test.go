package fractionalre

// Production-hardening unit tests (audit work order 8). Style follows
// service_compliance_test.go: pure functions tested directly; effectful flows
// tested through injected fakes (no DB, no ledger, no network).

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

// ── Idempotent replay (Subscribe / ListFraction / BuyFraction) ────────────────

// TestFetchReplay verifies the shared replay gate every keyed path uses:
// a key that already produced a row replays it; a fresh key proceeds; a lookup
// failure propagates (fail-closed — money never moves on an indeterminate check).
func TestFetchReplay(t *testing.T) {
	t.Run("existing row → replayed, no new write", func(t *testing.T) {
		want := &Subscription{ID: "sub-1", IdempotencyKey: "k1"}
		got, replay, err := fetchReplay(func() (*Subscription, error) { return want, nil })
		if err != nil || !replay || got != want {
			t.Fatalf("expected replay of existing row, got (%v,%v,%v)", got, replay, err)
		}
	})
	t.Run("fresh key → proceed", func(t *testing.T) {
		got, replay, err := fetchReplay(func() (*SecondaryListing, error) { return nil, ErrNotFound })
		if err != nil || replay || got != nil {
			t.Fatalf("expected fresh-key passthrough, got (%v,%v,%v)", got, replay, err)
		}
	})
	t.Run("lookup error → fail closed", func(t *testing.T) {
		boom := errors.New("db down")
		_, _, err := fetchReplay(func() (*SecondaryOrder, error) { return nil, boom })
		if !errors.Is(err, boom) {
			t.Fatalf("expected lookup error to propagate, got %v", err)
		}
	})
}

// TestListFractionRequiresIdempotencyKey mirrors the Subscribe/BuyFraction
// guard: the key check runs before any collaborator is touched.
func TestListFractionRequiresIdempotencyKey(t *testing.T) {
	s := &Service{}
	for _, key := range []string{"", "   "} {
		if _, err := s.ListFraction(context.Background(), "seller-1", key, ListFractionRequest{AssetID: "a", Units: 1}); err != ErrIdempotencyKey {
			t.Errorf("key %q: expected ErrIdempotencyKey, got %v", key, err)
		}
	}
}

// TestBuyFractionRequiresIdempotencyKey documents the same guard on the buy path.
func TestBuyFractionRequiresIdempotencyKey(t *testing.T) {
	s := &Service{}
	if _, err := s.BuyFraction(context.Background(), "buyer-1", " ", "listing-1", BuyFractionRequest{Units: 1}); err != ErrIdempotencyKey {
		t.Errorf("expected ErrIdempotencyKey, got %v", err)
	}
}

// ── Beneficiaries (share cap + input validation) ──────────────────────────────

func TestValidateBeneficiaryInput(t *testing.T) {
	cases := []struct {
		name, benName, rel string
		pct                int
		wantErr            bool
	}{
		{"valid", "Ada Obi", "spouse", 50, false},
		{"name too short", "A", "spouse", 50, true},
		{"name too long", string(make([]rune, 81)), "spouse", 50, true},
		{"relationship too short", "Ada Obi", "x", 50, true},
		{"share zero", "Ada Obi", "spouse", 0, true},
		{"share negative", "Ada Obi", "spouse", -5, true},
		{"share over 100", "Ada Obi", "spouse", 101, true},
		{"whitespace-only name", "        ", "spouse", 10, true},
		{"boundary 1 pct", "Ada Obi", "spouse", 1, false},
		{"boundary 100 pct", "Ada Obi", "spouse", 100, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateBeneficiaryInput(tc.benName, tc.rel, tc.pct)
			if (err != nil) != tc.wantErr {
				t.Errorf("got err=%v wantErr=%v", err, tc.wantErr)
			}
			if err != nil && !errors.Is(err, ErrBeneficiaryInput) {
				t.Errorf("validation failures must wrap ErrBeneficiaryInput, got %v", err)
			}
		})
	}
}

// TestBeneficiaryCapCheck verifies the server-side aggregate rules: total
// share across a user's beneficiaries never exceeds 100%, max 10 rows.
func TestBeneficiaryCapCheck(t *testing.T) {
	cases := []struct {
		name                 string
		existingTotal, count int
		newPct               int
		wantErr              error
	}{
		{"first beneficiary", 0, 0, 100, nil},
		{"fills to exactly 100", 60, 2, 40, nil},
		{"one point over → share error", 60, 2, 41, ErrBeneficiaryShare},
		{"already full → any add blocked", 100, 3, 1, ErrBeneficiaryShare},
		{"at max count → blocked even with headroom", 50, MaxBeneficiaries, 10, ErrBeneficiaryLimit},
		{"under max count ok", 50, MaxBeneficiaries - 1, 10, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := beneficiaryCapCheck(tc.existingTotal, tc.count, tc.newPct); !errors.Is(err, tc.wantErr) {
				t.Errorf("got %v want %v", err, tc.wantErr)
			}
		})
	}
}

// ── Reconciliation math ───────────────────────────────────────────────────────

func TestReconcileDelta(t *testing.T) {
	cases := []struct {
		name               string
		raised, subscribed int64
		wantDelta          int64
		wantMismatch       bool
	}{
		{"balanced", 50_000_000, 50_000_000, 0, false},
		{"projection ahead of source", 50_000_001, 50_000_000, 1, true},
		{"projection behind source", 49_999_999, 50_000_000, -1, true},
		{"both zero", 0, 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			delta, mismatch := reconcileDelta(tc.raised, tc.subscribed)
			if delta != tc.wantDelta || mismatch != tc.wantMismatch {
				t.Errorf("got (%d,%v) want (%d,%v)", delta, mismatch, tc.wantDelta, tc.wantMismatch)
			}
		})
	}
}

// ── Auto-invest runner ────────────────────────────────────────────────────────

// fakeAutoInvestStore is an in-memory autoInvestStore (no DB).
type fakeAutoInvestStore struct {
	plans     []AutoInvest
	completed map[string]time.Time // plan id → next_run_at after advance
	failures  map[string]string    // plan id → last_error
}

func newFakeStore(plans ...AutoInvest) *fakeAutoInvestStore {
	return &fakeAutoInvestStore{plans: plans, completed: map[string]time.Time{}, failures: map[string]string{}}
}

func (f *fakeAutoInvestStore) ListDueAutoInvest(_ context.Context, now time.Time, _ int) ([]AutoInvest, error) {
	var due []AutoInvest
	for _, p := range f.plans {
		if p.Status == "active" && p.NextRunAt != nil && !p.NextRunAt.After(now) {
			due = append(due, p)
		}
	}
	return due, nil
}

func (f *fakeAutoInvestStore) CompleteAutoInvestRun(_ context.Context, id string, _, nextRun time.Time) error {
	f.completed[id] = nextRun
	for i := range f.plans {
		if f.plans[i].ID == id {
			nr := nextRun
			f.plans[i].NextRunAt = &nr
		}
	}
	return nil
}

func (f *fakeAutoInvestStore) FailAutoInvest(_ context.Context, id, reason string) error {
	f.failures[id] = reason
	for i := range f.plans {
		if f.plans[i].ID == id {
			f.plans[i].Status = "failed"
		}
	}
	return nil
}

// fakeSubscribeLedger mimics the Subscribe money path's idempotency contract:
// the first call for a key creates; every later call with the same key replays.
type fakeSubscribeLedger struct {
	byKey map[string]*Subscription
	calls []string // every idempotency key seen, in order
	fail  error    // when set, subscribe fails (limit/kyc/funds)
}

func (f *fakeSubscribeLedger) subscribe(_ context.Context, userID, key, offeringID string, req SubscribeRequest) (*Subscription, error) {
	f.calls = append(f.calls, key)
	if f.fail != nil {
		return nil, f.fail
	}
	if existing, ok := f.byKey[key]; ok {
		return existing, nil // idempotent replay — no second escrow
	}
	sub := &Subscription{ID: "sub-" + key, OfferingID: offeringID, UserID: userID,
		Units: req.Units, AmountKobo: req.Units * 1_000_00, IdempotencyKey: key, Status: SubEscrowed}
	f.byKey[key] = sub
	return sub, nil
}

func runnerDeps(store *fakeAutoInvestStore, ledger *fakeSubscribeLedger, now time.Time, offering *Offering) autoInvestRunnerDeps {
	return autoInvestRunnerDeps{
		store: store,
		pickOffering: func(context.Context, *string) (*Offering, error) {
			if offering == nil {
				return nil, ErrNotFound
			}
			return offering, nil
		},
		subscribe: ledger.subscribe,
		audit:     func(context.Context, string, string, string, string, map[string]any) {},
		now:       func() time.Time { return now },
	}
}

// TestAutoInvestRunnerExecutesDuePlanOnce verifies: a due plan executes exactly
// one subscription with the deterministic key, its schedule advances one
// cadence period, and a second sweep does not re-invest.
func TestAutoInvestRunnerExecutesDuePlanOnce(t *testing.T) {
	now := time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)
	scheduled := now.Add(-2 * time.Hour)
	store := newFakeStore(AutoInvest{
		ID: "plan-1", UserID: "user-1", AmountKobo: 5_000_00, Cadence: "monthly",
		Status: "active", NextRunAt: &scheduled,
	})
	ledger := &fakeSubscribeLedger{byKey: map[string]*Subscription{}}
	offering := &Offering{ID: "off-1", UnitPriceKobo: 1_000_00, Status: OfferingOpen}

	executed, failed := runAutoInvestOnce(context.Background(), runnerDeps(store, ledger, now, offering))
	if executed != 1 || failed != 0 {
		t.Fatalf("first sweep: executed=%d failed=%d, want 1/0", executed, failed)
	}
	wantKey := autoInvestIdemKey("plan-1", scheduled)
	if len(ledger.calls) != 1 || ledger.calls[0] != wantKey {
		t.Fatalf("subscribe keys = %v, want exactly [%s]", ledger.calls, wantKey)
	}
	next, ok := store.completed["plan-1"]
	if !ok {
		t.Fatal("plan schedule was not advanced after a successful run")
	}
	if !next.After(now) {
		t.Fatalf("next_run_at %s must be in the future (now %s)", next, now)
	}

	// Second sweep: the plan is no longer due → zero executions, zero new escrows.
	executed, failed = runAutoInvestOnce(context.Background(), runnerDeps(store, ledger, now, offering))
	if executed != 0 || failed != 0 {
		t.Fatalf("second sweep: executed=%d failed=%d, want 0/0", executed, failed)
	}
	if len(ledger.byKey) != 1 {
		t.Fatalf("expected exactly one subscription ever created, got %d", len(ledger.byKey))
	}
}

// TestAutoInvestRunnerCrashRerunReplaysSameKey simulates a crash AFTER the
// subscription succeeded but BEFORE next_run_at advanced: the re-run reuses
// the identical deterministic key, so the money path replays the existing
// subscription and never double-invests.
func TestAutoInvestRunnerCrashRerunReplaysSameKey(t *testing.T) {
	now := time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)
	scheduled := now.Add(-time.Hour)
	plan := AutoInvest{ID: "plan-9", UserID: "user-9", AmountKobo: 3_000_00, Cadence: "weekly",
		Status: "active", NextRunAt: &scheduled}
	ledger := &fakeSubscribeLedger{byKey: map[string]*Subscription{}}
	offering := &Offering{ID: "off-9", UnitPriceKobo: 1_000_00, Status: OfferingOpen}

	// Sweep 1 on a store whose schedule advance is "lost" (fresh store each time
	// with the same still-due plan = crashed before persisting the advance).
	runAutoInvestOnce(context.Background(), runnerDeps(newFakeStore(plan), ledger, now, offering))
	runAutoInvestOnce(context.Background(), runnerDeps(newFakeStore(plan), ledger, now, offering))

	if len(ledger.calls) != 2 {
		t.Fatalf("expected 2 subscribe attempts, got %d", len(ledger.calls))
	}
	if ledger.calls[0] != ledger.calls[1] {
		t.Fatalf("crash re-run must reuse the deterministic key: %q vs %q", ledger.calls[0], ledger.calls[1])
	}
	if len(ledger.byKey) != 1 {
		t.Fatalf("double-invest detected: %d subscriptions for one scheduled run", len(ledger.byKey))
	}
}

// TestAutoInvestRunnerFailedPlanSkipsAndRecords verifies fail-closed handling:
// a failing execution (limit exceeded / kyc / insufficient funds) records
// status=failed + last_error, does NOT advance the schedule, does NOT retry in
// the same loop, and is skipped by subsequent sweeps.
func TestAutoInvestRunnerFailedPlanSkipsAndRecords(t *testing.T) {
	now := time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)
	scheduled := now.Add(-time.Minute)
	store := newFakeStore(AutoInvest{
		ID: "plan-2", UserID: "user-2", AmountKobo: 50_000_00, Cadence: "monthly",
		Status: "active", NextRunAt: &scheduled,
	})
	ledger := &fakeSubscribeLedger{byKey: map[string]*Subscription{}, fail: ErrLimitExceeded}
	offering := &Offering{ID: "off-2", UnitPriceKobo: 1_000_00, Status: OfferingOpen}
	deps := runnerDeps(store, ledger, now, offering)

	executed, failed := runAutoInvestOnce(context.Background(), deps)
	if executed != 0 || failed != 1 {
		t.Fatalf("executed=%d failed=%d, want 0/1", executed, failed)
	}
	if reason := store.failures["plan-2"]; reason == "" {
		t.Fatal("failure reason (last_error) was not recorded")
	}
	if _, advanced := store.completed["plan-2"]; advanced {
		t.Fatal("a failed plan must not have its schedule advanced")
	}
	if len(ledger.calls) != 1 {
		t.Fatalf("failed plan must not be retried in-loop: %d subscribe calls", len(ledger.calls))
	}

	// Next sweep: plan is status=failed → skipped entirely.
	executed, failed = runAutoInvestOnce(context.Background(), deps)
	if executed != 0 || failed != 0 || len(ledger.calls) != 1 {
		t.Fatalf("failed plan must be skipped on later sweeps (executed=%d failed=%d calls=%d)",
			executed, failed, len(ledger.calls))
	}
}

// TestAutoInvestRunnerNoOpenOffering: no matching open offering → fail-closed
// (recorded, skipped), never a partial execution.
func TestAutoInvestRunnerNoOpenOffering(t *testing.T) {
	now := time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)
	scheduled := now.Add(-time.Minute)
	store := newFakeStore(AutoInvest{
		ID: "plan-3", UserID: "user-3", AmountKobo: 5_000_00, Cadence: "monthly",
		Status: "active", NextRunAt: &scheduled,
	})
	ledger := &fakeSubscribeLedger{byKey: map[string]*Subscription{}}

	executed, failed := runAutoInvestOnce(context.Background(), runnerDeps(store, ledger, now, nil))
	if executed != 0 || failed != 1 {
		t.Fatalf("executed=%d failed=%d, want 0/1", executed, failed)
	}
	if len(ledger.calls) != 0 {
		t.Fatal("subscribe must never be attempted without an offering")
	}
}

// TestAutoInvestIdemKeyDeterminism pins the key format the money path relies on.
func TestAutoInvestIdemKeyDeterminism(t *testing.T) {
	at := time.Date(2026, 8, 1, 6, 0, 0, 0, time.UTC)
	k1 := autoInvestIdemKey("plan-x", at)
	k2 := autoInvestIdemKey("plan-x", at.In(time.FixedZone("WAT", 3600)))
	if k1 != k2 {
		t.Fatalf("key must be timezone-invariant: %q vs %q", k1, k2)
	}
	if want := fmt.Sprintf("autoinvest:plan-x:%s", "2026-08-01T06:00:00Z"); k1 != want {
		t.Fatalf("key format changed: got %q want %q (breaks crash-replay)", k1, want)
	}
	if k1 == autoInvestIdemKey("plan-y", at) || k1 == autoInvestIdemKey("plan-x", at.Add(time.Hour)) {
		t.Fatal("distinct plan/run must produce distinct keys")
	}
}

// TestNextAutoInvestRun verifies cadence arithmetic.
func TestNextAutoInvestRun(t *testing.T) {
	base := time.Date(2026, 7, 3, 6, 0, 0, 0, time.UTC)
	if got := nextAutoInvestRun(base, "weekly"); !got.Equal(base.AddDate(0, 0, 7)) {
		t.Errorf("weekly: got %s", got)
	}
	if got := nextAutoInvestRun(base, "monthly"); !got.Equal(base.AddDate(0, 1, 0)) {
		t.Errorf("monthly: got %s", got)
	}
	if got := nextAutoInvestRun(base, "unknown"); !got.Equal(base.AddDate(0, 1, 0)) {
		t.Errorf("unknown cadence must default to monthly: got %s", got)
	}
}

// TestLimitOverrideReasonCodes pins the closed vocabulary against the DB CHECK.
func TestLimitOverrideReasonCodes(t *testing.T) {
	for _, ok := range []string{"hni_upgrade", "vip_waiver", "error_correction", "compliance_review", "other"} {
		if !LimitOverrideReasonCodes[ok] {
			t.Errorf("%s must be a valid reason code", ok)
		}
	}
	if LimitOverrideReasonCodes["promo"] {
		t.Error("unknown reason codes must be rejected")
	}
}
