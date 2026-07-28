package rewards

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// These tests exercise the money-path invariants with FAKES — no database. The
// Service depends on the `store` seam and the WalletCredit / FraudCheck interfaces,
// all of which are faked here so we can assert exactly-once value movement, the
// ordered eligibility gate, idempotent replay, and derived balances.

// ── fakes ────────────────────────────────────────────────────────────────────────

// stubTx is a no-op pgx.Tx. The fake store ignores the tx; the service only calls
// Commit / Rollback on it, which are no-ops here.
type stubTx struct{}

func (stubTx) Begin(context.Context) (pgx.Tx, error)            { return stubTx{}, nil }
func (stubTx) Commit(context.Context) error                     { return nil }
func (stubTx) Rollback(context.Context) error                   { return nil }
func (stubTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	return 0, nil
}
func (stubTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults { return nil }
func (stubTx) LargeObjects() pgx.LargeObjects                         { return pgx.LargeObjects{} }
func (stubTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	return nil, nil
}
func (stubTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (stubTx) Query(context.Context, string, ...any) (pgx.Rows, error) { return nil, nil }
func (stubTx) QueryRow(context.Context, string, ...any) pgx.Row        { return nil }
func (stubTx) Conn() *pgx.Conn                                         { return nil }

// fakeStore is an in-memory store. It tracks pool spend, the ledger keyed by
// idempotency_key, and per-user/per-campaign credit sums so the gate logic runs for
// real against deterministic data.
type fakeStore struct {
	pool          *RewardPool
	ledgerByKey   map[string]*LedgerEntry
	userPrior     int64
	campaignPrior int64
	catalog       map[string]*CatalogItem
	redemptions   map[string]*Redemption

	inserts       int // ledger inserts attempted that succeeded
	spentApplied  int64
	insertWalletRefs int
}

func newFakeStore(pool *RewardPool) *fakeStore {
	return &fakeStore{
		pool:        pool,
		ledgerByKey: map[string]*LedgerEntry{},
		catalog:     map[string]*CatalogItem{},
		redemptions: map[string]*Redemption{},
	}
}

func (f *fakeStore) Begin(context.Context) (pgx.Tx, error) { return stubTx{}, nil }

func (f *fakeStore) GetByIdempotencyKey(_ context.Context, key string) (*LedgerEntry, error) {
	if e, ok := f.ledgerByKey[key]; ok {
		return e, nil
	}
	return nil, ErrNotFound
}

func (f *fakeStore) GetPoolForUpdate(_ context.Context, _ pgx.Tx, poolID string) (*RewardPool, error) {
	if f.pool == nil || f.pool.ID != poolID {
		return nil, ErrNotFound
	}
	cp := *f.pool
	return &cp, nil
}

func (f *fakeStore) SumUserCreditsFromPool(context.Context, pgx.Tx, string, string) (int64, error) {
	return f.userPrior, nil
}
func (f *fakeStore) SumCampaignCredits(context.Context, pgx.Tx, string) (int64, error) {
	return f.campaignPrior, nil
}

func (f *fakeStore) InsertLedgerEntry(_ context.Context, _ pgx.Tx, e LedgerEntry) (*LedgerEntry, error) {
	if _, ok := f.ledgerByKey[e.IdempotencyKey]; ok {
		return nil, ErrDuplicate
	}
	stored := e
	stored.ID = "entry-" + e.IdempotencyKey
	f.ledgerByKey[e.IdempotencyKey] = &stored
	f.inserts++
	return &stored, nil
}

func (f *fakeStore) IncrementPoolSpent(_ context.Context, _ pgx.Tx, _ string, amountMinor int64) error {
	f.pool.SpentMinor += amountMinor
	f.spentApplied += amountMinor
	return nil
}

func (f *fakeStore) SetEntryWalletRef(_ context.Context, entryID, walletRef string) error {
	f.insertWalletRefs++
	for _, e := range f.ledgerByKey {
		if e.ID == entryID {
			ref := walletRef
			e.WalletRef = &ref
		}
	}
	return nil
}

func (f *fakeStore) SumUserBalance(_ context.Context, userID string) (int64, error) {
	var bal int64
	for _, e := range f.ledgerByKey {
		if e.UserID != userID {
			continue
		}
		if e.Type == EntryCredit {
			bal += e.AmountMinor
		} else {
			bal -= e.AmountMinor
		}
	}
	return bal, nil
}

func (f *fakeStore) ListUserEntries(context.Context, string, int) ([]LedgerEntry, error) {
	out := []LedgerEntry{}
	for _, e := range f.ledgerByKey {
		out = append(out, *e)
	}
	return out, nil
}
func (f *fakeStore) ListPoolEntries(context.Context, string, int) ([]LedgerEntry, error) {
	return nil, nil
}

func (f *fakeStore) GetCatalogBySKU(_ context.Context, sku string) (*CatalogItem, error) {
	if c, ok := f.catalog[sku]; ok {
		return c, nil
	}
	return nil, ErrNotFound
}
func (f *fakeStore) ListCatalog(context.Context, bool) ([]CatalogItem, error) { return nil, nil }
func (f *fakeStore) UpsertCatalog(context.Context, UpsertCatalogRequest) (*CatalogItem, error) {
	return nil, nil
}

func (f *fakeStore) GetRedemptionByIdempotencyKey(_ context.Context, key string) (*Redemption, error) {
	if r, ok := f.redemptions[key]; ok {
		return r, nil
	}
	return nil, ErrNotFound
}
func (f *fakeStore) InsertRedemption(_ context.Context, rd Redemption) (*Redemption, error) {
	if _, ok := f.redemptions[rd.IdempotencyKey]; ok {
		return nil, ErrDuplicate
	}
	stored := rd
	stored.ID = "redemption-" + rd.IdempotencyKey
	f.redemptions[rd.IdempotencyKey] = &stored
	return &stored, nil
}
func (f *fakeStore) SetRedemptionState(_ context.Context, id, state string) error {
	for _, r := range f.redemptions {
		if r.ID == id {
			r.State = state
		}
	}
	return nil
}

func (f *fakeStore) ListPools(context.Context) ([]RewardPool, error) { return nil, nil }
func (f *fakeStore) CreatePool(context.Context, CreatePoolRequest) (*RewardPool, error) {
	return nil, nil
}
func (f *fakeStore) IncrementPoolFunded(context.Context, string, int64) (*RewardPool, error) {
	return nil, nil
}
func (f *fakeStore) InsertAudit(context.Context, string, string, string, string, map[string]any, string) error {
	return nil
}

// fakeWallet records every Credit call so we can assert exactly-once value movement.
type fakeWallet struct {
	calls   int
	lastKey string
	lastAmt int64
	keys    map[string]bool
	failErr error
}

func newFakeWallet() *fakeWallet { return &fakeWallet{keys: map[string]bool{}} }

func (w *fakeWallet) Credit(_ context.Context, _ string, _ string, idemKey, _ string, amountMinor int64) error {
	if w.failErr != nil {
		return w.failErr
	}
	if w.keys[idemKey] {
		// Simulate the ledger's idempotent duplicate response.
		return errors.New("ledger: duplicate idempotency key")
	}
	w.keys[idemKey] = true
	w.calls++
	w.lastKey = idemKey
	w.lastAmt = amountMinor
	return nil
}

// rejectFraud always rejects.
type rejectFraud struct{}

func (rejectFraud) OK(context.Context, string, string) (bool, string) { return false, "velocity" }

// helpers
func activePool(id string, funded, spent int64) *RewardPool {
	return &RewardPool{ID: id, Currency: "NGN", FundedMinor: funded, SpentMinor: spent, Status: PoolActive, ConversionRate: 1}
}

// ── eligibility gate (pure, ordered) ─────────────────────────────────────────────

func TestEvaluateEligibility_Order(t *testing.T) {
	cases := []struct {
		name string
		in   eligibilityInput
		want string
	}{
		{"invalid amount", eligibilityInput{AmountMinor: 0, PoolStatus: PoolActive, PoolAvailable: 100, FraudOK: true}, ReasonInvalidAmount},
		{"pool inactive", eligibilityInput{AmountMinor: 10, PoolStatus: PoolDraft, PoolAvailable: 100, FraudOK: true}, ReasonPoolInactive},
		{"pool exhausted", eligibilityInput{AmountMinor: 200, PoolStatus: PoolActive, PoolAvailable: 100, FraudOK: true}, ReasonPoolExhausted},
		{"per-user cap", eligibilityInput{AmountMinor: 60, PoolStatus: PoolActive, PoolAvailable: 1000, PerUserCapMinor: 100, UserPriorMinor: 50, FraudOK: true}, ReasonPerUserCap},
		{"per-campaign cap", eligibilityInput{AmountMinor: 60, PoolStatus: PoolActive, PoolAvailable: 1000, PerCampaignCap: 100, CampaignHasCap: true, CampaignPriorMin: 50, FraudOK: true}, ReasonPerCampaignCap},
		{"fraud block", eligibilityInput{AmountMinor: 10, PoolStatus: PoolActive, PoolAvailable: 1000, FraudOK: false}, ReasonFraud},
		{"approved", eligibilityInput{AmountMinor: 10, PoolStatus: PoolActive, PoolAvailable: 1000, FraudOK: true}, ""},
	}
	for _, tc := range cases {
		if got := evaluateEligibility(tc.in); got != tc.want {
			t.Errorf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}

	// Order check: amount is checked BEFORE pool status, status BEFORE balance, etc.
	in := eligibilityInput{AmountMinor: 0, PoolStatus: PoolDraft, PoolAvailable: 0, FraudOK: false}
	if got := evaluateEligibility(in); got != ReasonInvalidAmount {
		t.Errorf("amount must be the first gate, got %q", got)
	}
}

// ── IssueReward flows ────────────────────────────────────────────────────────────

func TestIssueReward_Happy(t *testing.T) {
	fs := newFakeStore(activePool("pool1", 1000, 0))
	w := newFakeWallet()
	svc := NewService(fs, w, nil, "reward-expense-acct")

	res, err := svc.IssueReward(context.Background(), IssueInput{
		UserID: "u1", PoolID: "pool1", AmountMinor: 250, IdempotencyKey: "k1", SourceEvent: "mastery:obj1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.State != StateCredited {
		t.Fatalf("state = %q want credited", res.State)
	}
	if fs.inserts != 1 {
		t.Errorf("ledger inserts = %d want 1", fs.inserts)
	}
	if w.calls != 1 {
		t.Errorf("wallet credits = %d want 1", w.calls)
	}
	if w.lastAmt != 250 {
		t.Errorf("wallet credit amount = %d want 250", w.lastAmt)
	}
	if fs.pool.SpentMinor != 250 {
		t.Errorf("pool.spent_minor = %d want 250", fs.pool.SpentMinor)
	}
	if res.Entry == nil || res.Entry.WalletRef == nil {
		t.Errorf("expected entry with wallet ref stamped")
	}
}

func TestIssueReward_PoolExhausted(t *testing.T) {
	fs := newFakeStore(activePool("pool1", 100, 100)) // available = 0
	w := newFakeWallet()
	svc := NewService(fs, w, nil, "acct")

	res, err := svc.IssueReward(context.Background(), IssueInput{
		UserID: "u1", PoolID: "pool1", AmountMinor: 50, IdempotencyKey: "k1",
	})
	if reason, ok := AsRejection(err); !ok || reason != ReasonPoolExhausted {
		t.Fatalf("want pool_exhausted rejection, got err=%v", err)
	}
	if res.State != StateRejected || res.Reason != ReasonPoolExhausted {
		t.Errorf("result = %+v want rejected/pool_exhausted", res)
	}
	if fs.inserts != 0 || w.calls != 0 || fs.spentApplied != 0 {
		t.Errorf("no value should move on rejection: inserts=%d credits=%d spent=%d", fs.inserts, w.calls, fs.spentApplied)
	}
}

func TestIssueReward_PerUserCap(t *testing.T) {
	pool := activePool("pool1", 10000, 0)
	pool.PerUserCapMinor = 100
	fs := newFakeStore(pool)
	fs.userPrior = 80 // already credited 80; +50 would exceed 100
	w := newFakeWallet()
	svc := NewService(fs, w, nil, "acct")

	_, err := svc.IssueReward(context.Background(), IssueInput{
		UserID: "u1", PoolID: "pool1", AmountMinor: 50, IdempotencyKey: "k1",
	})
	if reason, ok := AsRejection(err); !ok || reason != ReasonPerUserCap {
		t.Fatalf("want per_user_cap_exceeded, got err=%v", err)
	}
	if fs.inserts != 0 || w.calls != 0 {
		t.Errorf("no value should move: inserts=%d credits=%d", fs.inserts, w.calls)
	}
}

func TestIssueReward_FraudFail(t *testing.T) {
	fs := newFakeStore(activePool("pool1", 1000, 0))
	w := newFakeWallet()
	svc := NewService(fs, w, rejectFraud{}, "acct")

	_, err := svc.IssueReward(context.Background(), IssueInput{
		UserID: "u1", PoolID: "pool1", AmountMinor: 50, IdempotencyKey: "k1",
	})
	if reason, ok := AsRejection(err); !ok || reason != ReasonFraud {
		t.Fatalf("want anti_fraud_block, got err=%v", err)
	}
	if fs.inserts != 0 || w.calls != 0 {
		t.Errorf("fraud reject must move no value: inserts=%d credits=%d", fs.inserts, w.calls)
	}
}

func TestIssueReward_DoubleIdempotencyKey_SingleEffect(t *testing.T) {
	fs := newFakeStore(activePool("pool1", 1000, 0))
	w := newFakeWallet()
	svc := NewService(fs, w, nil, "acct")

	in := IssueInput{UserID: "u1", PoolID: "pool1", AmountMinor: 200, IdempotencyKey: "dup"}
	r1, err := svc.IssueReward(context.Background(), in)
	if err != nil {
		t.Fatalf("first issue: %v", err)
	}
	r2, err := svc.IssueReward(context.Background(), in)
	if err != nil {
		t.Fatalf("second issue: %v", err)
	}
	if !r2.Duplicate {
		t.Errorf("second call should be flagged Duplicate")
	}
	if r1.Entry.ID != r2.Entry.ID {
		t.Errorf("replay must return the original entry")
	}
	if fs.inserts != 1 {
		t.Errorf("ledger inserts = %d want 1 (single effect)", fs.inserts)
	}
	if w.calls != 1 {
		t.Errorf("wallet credits = %d want 1 (single effect)", w.calls)
	}
	if fs.pool.SpentMinor != 200 {
		t.Errorf("pool.spent_minor = %d want 200 (incremented once)", fs.pool.SpentMinor)
	}
}

func TestBalance_DerivedBySummation(t *testing.T) {
	fs := newFakeStore(activePool("pool1", 10000, 0))
	w := newFakeWallet()
	svc := NewService(fs, w, nil, "acct")
	ctx := context.Background()

	_, _ = svc.IssueReward(ctx, IssueInput{UserID: "u1", PoolID: "pool1", AmountMinor: 300, IdempotencyKey: "a"})
	_, _ = svc.IssueReward(ctx, IssueInput{UserID: "u1", PoolID: "pool1", AmountMinor: 150, IdempotencyKey: "b"})
	_, _ = svc.IssueReward(ctx, IssueInput{UserID: "u2", PoolID: "pool1", AmountMinor: 999, IdempotencyKey: "c"})

	bal, err := svc.Balance(ctx, "u1")
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if bal != 450 {
		t.Errorf("u1 balance = %d want 450 (300+150, derived by summation)", bal)
	}
}

func TestRedeemPoints_WalletKind_Idempotent(t *testing.T) {
	fs := newFakeStore(activePool("pool1", 0, 0))
	fs.catalog["AIR100"] = &CatalogItem{ID: "c1", SKU: "AIR100", Name: "Wallet 100", Kind: "wallet", CostPoints: 100, ValueMinor: 100, Status: "active"}
	w := newFakeWallet()
	svc := NewService(fs, w, nil, "acct")
	ctx := context.Background()

	r1, err := svc.RedeemPoints(ctx, "u1", "AIR100", "rk1")
	if err != nil {
		t.Fatalf("redeem: %v", err)
	}
	if r1.State != "fulfilled" {
		t.Errorf("state = %q want fulfilled", r1.State)
	}
	if w.calls != 1 {
		t.Errorf("wallet credits = %d want 1", w.calls)
	}
	// Replay returns the same redemption with no second credit.
	r2, err := svc.RedeemPoints(ctx, "u1", "AIR100", "rk1")
	if err != nil {
		t.Fatalf("redeem replay: %v", err)
	}
	if r2.ID != r1.ID {
		t.Errorf("replay must return original redemption")
	}
	if w.calls != 1 {
		t.Errorf("wallet credits = %d want 1 after replay (single effect)", w.calls)
	}
}
