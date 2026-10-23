package deposit

import (
	"context"
	"sync"
	"testing"
)

// fakeResolver resolves a fixed set of provider sub-accounts to owners. It models the
// provider-account→user mapping (crypto_accounts) and per-network confirmation policy.
type fakeResolver struct {
	owners map[string]Owner // keyed by ProviderAccountID
	err    error
}

func (f fakeResolver) Resolve(_ context.Context, c Credit) (Owner, bool, error) {
	if f.err != nil {
		return Owner{}, false, f.err
	}
	o, ok := f.owners[c.ProviderAccountID]
	return o, ok, nil
}

// memStore is the in-memory stand-in for the pgx Store: once-only on ProviderOpID,
// crediting a user/asset balance and a matching custody leg atomically under a mutex.
type memStore struct {
	mu       sync.Mutex
	applied  map[string]bool
	user     map[[2]string]int64 // {userID, assetID} -> units
	custody  map[string]int64    // assetID -> units held in custody
	applyErr error
}

func newMemStore() *memStore {
	return &memStore{
		applied: map[string]bool{},
		user:    map[[2]string]int64{},
		custody: map[string]int64{},
	}
}

func (m *memStore) ApplyCredit(_ context.Context, a Apply) (Outcome, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.applyErr != nil {
		return OutcomeRejected, m.applyErr
	}
	if m.applied[a.ProviderOpID] {
		return OutcomeDuplicate, nil // already settled: no balance movement
	}
	m.applied[a.ProviderOpID] = true
	m.user[[2]string{a.UserID, a.AssetID}] += a.Units
	m.custody[a.AssetID] += a.Units
	return OutcomeSettled, nil
}

func (m *memStore) balance(userID, assetID string) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.user[[2]string{userID, assetID}]
}

func (m *memStore) custodyOf(assetID string) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.custody[assetID]
}

func resolverWith(owners map[string]Owner) fakeResolver { return fakeResolver{owners: owners} }

func baseCredit() Credit {
	return Credit{
		Provider: "quidax", ProviderAccountID: "acct-1", ProviderOpID: "op-1",
		Symbol: "BTC", Network: "bitcoin", Address: "bc1q…", Units: 100_000,
		Confirmations: 3, Status: StatusConfirmed, TxHash: "0xabc",
	}
}

func owner1() Owner {
	return Owner{UserID: "user-A", AssetID: "asset-btc", MinorUnitScale: 1e8, RequiredConfs: 2}
}

func settle(t *testing.T, st Store, r OwnerResolver, c Credit) Result {
	t.Helper()
	res, err := NewSettler(r, st).Settle(context.Background(), c)
	if err != nil {
		t.Fatalf("Settle returned error: %v", err)
	}
	return res
}

func TestConfirmedCreditAtThresholdSettlesOnce(t *testing.T) {
	ms := newMemStore()
	res := settle(t, ms, resolverWith(map[string]Owner{"acct-1": owner1()}), baseCredit())
	if res.Outcome != OutcomeSettled {
		t.Fatalf("outcome=%s want settled", res.Outcome)
	}
	if got := ms.balance("user-A", "asset-btc"); got != 100_000 {
		t.Fatalf("balance=%d want 100000", got)
	}
}

func TestBelowConfirmationThresholdAwaitsAndCreditsNothing(t *testing.T) {
	ms := newMemStore()
	c := baseCredit()
	c.Confirmations = 1 // owner requires 2
	res := settle(t, ms, resolverWith(map[string]Owner{"acct-1": owner1()}), c)
	if res.Outcome != OutcomeAwaiting {
		t.Fatalf("outcome=%s want awaiting", res.Outcome)
	}
	if ms.balance("user-A", "asset-btc") != 0 {
		t.Fatal("awaiting transfer must not credit")
	}
}

func TestReplayedOpIdIsOnceOnlyEvenUnderADuplicateStorm(t *testing.T) {
	ms := newMemStore()
	r := resolverWith(map[string]Owner{"acct-1": owner1()})
	// 50 replays of the same provider operation id (E2E-10 webhook storm).
	for i := 0; i < 50; i++ {
		res := settle(t, ms, r, baseCredit())
		if i == 0 && res.Outcome != OutcomeSettled {
			t.Fatalf("first should settle, got %s", res.Outcome)
		}
		if i > 0 && res.Outcome != OutcomeDuplicate {
			t.Fatalf("replay %d should be duplicate, got %s", i, res.Outcome)
		}
	}
	if got := ms.balance("user-A", "asset-btc"); got != 100_000 {
		t.Fatalf("balance=%d want 100000 (must be credited exactly once)", got)
	}
	if got := ms.custodyOf("asset-btc"); got != 100_000 {
		t.Fatalf("custody=%d want 100000 (conservation: user leg == custody leg)", got)
	}
}

func TestConcurrentSameOpIdCreditsOnce(t *testing.T) {
	ms := newMemStore()
	r := resolverWith(map[string]Owner{"acct-1": owner1()})
	s := NewSettler(r, ms)
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = s.Settle(context.Background(), baseCredit())
		}()
	}
	wg.Wait()
	if got := ms.balance("user-A", "asset-btc"); got != 100_000 {
		t.Fatalf("balance=%d want 100000 (no double-spend under concurrency)", got)
	}
}

func TestUnmappedSubAccountCreditsNobody(t *testing.T) {
	ms := newMemStore()
	c := baseCredit()
	c.ProviderAccountID = "orphan-acct" // not in the mapping
	c.ProviderOpID = "op-orphan"
	res := settle(t, ms, resolverWith(map[string]Owner{"acct-1": owner1()}), c)
	if res.Outcome != OutcomeUnmapped {
		t.Fatalf("outcome=%s want unmapped", res.Outcome)
	}
	if ms.balance("user-A", "asset-btc") != 0 {
		t.Fatal("orphan deposit must not credit any known user")
	}
}

func TestNonFinalAndBadAmountAreRejected(t *testing.T) {
	r := resolverWith(map[string]Owner{"acct-1": owner1()})
	cases := []struct {
		name string
		c    Credit
	}{
		{"reorged", func() Credit { c := baseCredit(); c.Status = StatusReorged; return c }()},
		{"failed", func() Credit { c := baseCredit(); c.Status = StatusFailed; return c }()},
		{"pending", func() Credit { c := baseCredit(); c.Status = StatusPending; return c }()},
		{"zero", func() Credit { c := baseCredit(); c.Units = 0; return c }()},
		{"negative", func() Credit { c := baseCredit(); c.Units = -5; return c }()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ms := newMemStore()
			res := settle(t, ms, r, tc.c)
			if res.Outcome != OutcomeRejected && res.Outcome != OutcomeAwaiting {
				t.Fatalf("outcome=%s want rejected/awaiting", res.Outcome)
			}
			if ms.balance("user-A", "asset-btc") != 0 {
				t.Fatalf("%s must not credit", tc.name)
			}
		})
	}
}

// Cross-tenant isolation is structural: the recipient comes from the resolved owner,
// never from the event. A deposit to user-A's sub-account can only ever credit user-A,
// and one to user-B's sub-account only ever credits user-B.
func TestCrossTenantIsolationByResolvedOwner(t *testing.T) {
	ms := newMemStore()
	r := resolverWith(map[string]Owner{
		"acct-A": {UserID: "user-A", AssetID: "asset-btc", RequiredConfs: 1},
		"acct-B": {UserID: "user-B", AssetID: "asset-btc", RequiredConfs: 1},
	})
	a := baseCredit()
	a.ProviderAccountID, a.ProviderOpID = "acct-A", "opA"
	b := baseCredit()
	b.ProviderAccountID, b.ProviderOpID = "acct-B", "opB"
	b.Units = 7

	settle(t, ms, r, a)
	settle(t, ms, r, b)
	if ms.balance("user-A", "asset-btc") != 100_000 {
		t.Fatal("user-A must hold only its own deposit")
	}
	if ms.balance("user-B", "asset-btc") != 7 {
		t.Fatal("user-B must hold only its own deposit, never user-A's")
	}
}

func TestResolverFailurePropagatesForRetryNotSilentReject(t *testing.T) {
	ms := newMemStore()
	s := NewSettler(fakeResolver{err: context.DeadlineExceeded}, ms)
	_, err := s.Settle(context.Background(), baseCredit())
	if err == nil {
		t.Fatal("resolver outage must return an error so the provider redelivers, not drop the deposit")
	}
	if ms.balance("user-A", "asset-btc") != 0 {
		t.Fatal("a failed resolution must not credit")
	}
}
