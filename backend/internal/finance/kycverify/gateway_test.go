package kycverify

import (
	"context"
	"errors"
	"testing"
	"time"

	"spotlight/backend/internal/provider"
)

// fakeIDNumber is a test IdNumberPort. It fails a configurable number of times
// (to exercise the breaker/failover), then returns a terminal PASS.
type fakeIDNumber struct {
	name  string
	fail  bool
	calls int
}

func (f *fakeIDNumber) Name() string { return f.name }
func (f *fakeIDNumber) VerifyIDNumber(_ context.Context, _ provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	f.calls++
	if f.fail {
		return provider.KycCheckResult{}, errors.New("provider down")
	}
	return provider.KycCheckResult{Status: provider.KycPassed, Match: true, Confidence: 99, Terminal: true, ProviderRef: f.name + "-ref"}, nil
}

func idNumberTable(order ...string) RoutingTable {
	return RoutingTable{
		provider.KycIDNumber: {CheckType: provider.KycIDNumber, OrderedProviders: order, Threshold: 70, Enabled: true},
	}
}

// Failover advances to the next provider when the first errors, and the second
// provider's result wins. The first is recorded in FailedOver.
func TestGateway_FailoverAdvancesOnError(t *testing.T) {
	reg := NewRegistry()
	reg.register("dojah", &fakeIDNumber{name: "dojah", fail: true})
	good := &fakeIDNumber{name: "youverify"}
	reg.register("youverify", good)

	gw := NewGateway(reg, idNumberTable("dojah", "youverify"))
	res, err := gw.Run(context.Background(), provider.KycIDNumber, provider.KycVerifyRequest{ClientRef: "r1"})
	if err != nil {
		t.Fatalf("expected failover success, got %v", err)
	}
	if res.Provider != "youverify" {
		t.Errorf("winner = %q, want youverify", res.Provider)
	}
	if len(res.FailedOver) != 1 || res.FailedOver[0] != "dojah" {
		t.Errorf("FailedOver = %v, want [dojah]", res.FailedOver)
	}
	if good.calls != 1 {
		t.Errorf("second provider calls = %d, want 1", good.calls)
	}
}

// A provider missing the required port is skipped (failover), as if unconfigured.
func TestGateway_SkipsMissingPort(t *testing.T) {
	reg := NewRegistry()
	// "smileid" has NO IdNumberPort registered → chain must skip it.
	good := &fakeIDNumber{name: "youverify"}
	reg.register("youverify", good)

	gw := NewGateway(reg, idNumberTable("smileid", "youverify"))
	res, err := gw.Run(context.Background(), provider.KycIDNumber, provider.KycVerifyRequest{ClientRef: "r2"})
	if err != nil {
		t.Fatalf("expected skip-then-success, got %v", err)
	}
	if res.Provider != "youverify" {
		t.Errorf("winner = %q, want youverify", res.Provider)
	}
	if len(res.FailedOver) != 1 || res.FailedOver[0] != "smileid" {
		t.Errorf("FailedOver = %v, want [smileid]", res.FailedOver)
	}
}

// Every provider failing → ErrNoProvider (never a silent success).
func TestGateway_AllFailNoProvider(t *testing.T) {
	reg := NewRegistry()
	reg.register("dojah", &fakeIDNumber{name: "dojah", fail: true})
	reg.register("youverify", &fakeIDNumber{name: "youverify", fail: true})

	gw := NewGateway(reg, idNumberTable("dojah", "youverify"))
	_, err := gw.Run(context.Background(), provider.KycIDNumber, provider.KycVerifyRequest{ClientRef: "r3"})
	if !errors.Is(err, ErrNoProvider) {
		t.Errorf("want ErrNoProvider, got %v", err)
	}
}

// An empty routing chain yields ErrNoProvider.
func TestGateway_EmptyChain(t *testing.T) {
	reg := NewRegistry()
	gw := NewGateway(reg, RoutingTable{})
	_, err := gw.Run(context.Background(), provider.KycIDNumber, provider.KycVerifyRequest{ClientRef: "r4"})
	if !errors.Is(err, ErrNoProvider) {
		t.Errorf("want ErrNoProvider for empty chain, got %v", err)
	}
}

// The breaker opens on error and stays open within the cooldown window, then the
// hop is skipped on the next Run (pure decideHop + breaker state).
func TestBreaker_OpensAndSkipsWithinCooldown(t *testing.T) {
	b := newBreaker(60 * time.Second)
	now := time.Now()
	if b.open("dojah", provider.KycIDNumber, now) {
		t.Fatal("breaker should start closed")
	}
	b.trip("dojah", provider.KycIDNumber, now)
	if !b.open("dojah", provider.KycIDNumber, now.Add(30*time.Second)) {
		t.Error("breaker must be open within cooldown")
	}
	if b.open("dojah", provider.KycIDNumber, now.Add(61*time.Second)) {
		t.Error("breaker must close after cooldown elapses")
	}
	// A tripped breaker for one (provider,checktype) does not affect another type.
	if b.open("dojah", provider.KycAML, now.Add(1*time.Second)) {
		t.Error("breaker must be per (provider,checktype)")
	}
	b.reset("dojah", provider.KycIDNumber)
	if b.open("dojah", provider.KycIDNumber, now.Add(1*time.Second)) {
		t.Error("reset must close the breaker")
	}
}

// decideHop is the pure gate: try only when the port exists and the breaker is
// closed.
func TestDecideHop(t *testing.T) {
	if !decideHop(true, false).Try {
		t.Error("port present + breaker closed → try")
	}
	if decideHop(false, false).Try {
		t.Error("missing port → skip")
	}
	if decideHop(true, true).Try {
		t.Error("breaker open → skip")
	}
}

// gateResult routes facial/document/liveness confidence through GateFacial; a
// non-terminal result becomes PENDING regardless of type.
func TestGateResult(t *testing.T) {
	// Facial, high confidence match → PASSED.
	if got := gateResult(provider.KycIDFacial, provider.KycCheckResult{Match: true, Confidence: 90, Terminal: true}, 70); got != provider.KycPassed {
		t.Errorf("facial pass = %q, want PASSED", got)
	}
	// ADR-PR808: no REVIEW middle ground — a low-positive facial is a hard FAIL.
	if got := gateResult(provider.KycIDFacial, provider.KycCheckResult{Match: true, Confidence: 40, Terminal: true}, 70); got != provider.KycFailed {
		t.Errorf("facial low = %q, want FAILED (user retries)", got)
	}
	// ID number data-match trusts the adapter status.
	if got := gateResult(provider.KycIDNumber, provider.KycCheckResult{Status: provider.KycPassed, Terminal: true}, 70); got != provider.KycPassed {
		t.Errorf("idnumber = %q, want PASSED", got)
	}
	// Non-terminal → PENDING (webhook decides later).
	if got := gateResult(provider.KycIDFacial, provider.KycCheckResult{Terminal: false}, 70); got != provider.KycPending {
		t.Errorf("non-terminal = %q, want PENDING", got)
	}
}

// slowIDNumber blocks until the caller's context is cut off — a provider that is
// up but never answers in time.
type slowIDNumber struct {
	name  string
	delay time.Duration
	calls int
}

func (f *slowIDNumber) Name() string { return f.name }
func (f *slowIDNumber) VerifyIDNumber(ctx context.Context, _ provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	f.calls++
	select {
	case <-time.After(f.delay):
		return provider.KycCheckResult{Status: provider.KycPassed, Terminal: true}, nil
	case <-ctx.Done():
		return provider.KycCheckResult{}, ctx.Err()
	}
}

func withTestBudgets(t *testing.T, budget, hop time.Duration) {
	t.Helper()
	oldBudget, oldHop := kycGatewayBudget, kycHopTimeout
	kycGatewayBudget, kycHopTimeout = budget, hop
	t.Cleanup(func() { kycGatewayBudget, kycHopTimeout = oldBudget, oldHop })
}

// A provider that never answers is abandoned inside the hop slice, and the
// failure is reported as a timeout rather than "no provider configured".
func TestGateway_HopTimeoutBoundsSingleProvider(t *testing.T) {
	withTestBudgets(t, 5*time.Second, 40*time.Millisecond)

	reg := NewRegistry()
	reg.register("dojah", &slowIDNumber{name: "dojah", delay: time.Hour})

	gw := NewGateway(reg, idNumberTable("dojah"))
	start := time.Now()
	_, err := gw.Run(context.Background(), provider.KycIDNumber, provider.KycVerifyRequest{ClientRef: "t1"})
	elapsed := time.Since(start)

	if !errors.Is(err, ErrProviderTimeout) {
		t.Errorf("want ErrProviderTimeout, got %v", err)
	}
	if elapsed > time.Second {
		t.Errorf("walk took %s; the hop slice must cut it off at ~40ms", elapsed)
	}
}

// One hanging provider must not strand the chain: the next hop still gets its
// slice and its result wins.
func TestGateway_FailsOverPastHangingProvider(t *testing.T) {
	withTestBudgets(t, 5*time.Second, 40*time.Millisecond)

	reg := NewRegistry()
	reg.register("dojah", &slowIDNumber{name: "dojah", delay: time.Hour})
	good := &fakeIDNumber{name: "youverify"}
	reg.register("youverify", good)

	gw := NewGateway(reg, idNumberTable("dojah", "youverify"))
	res, err := gw.Run(context.Background(), provider.KycIDNumber, provider.KycVerifyRequest{ClientRef: "t2"})
	if err != nil {
		t.Fatalf("expected the second hop to answer, got %v", err)
	}
	if res.Provider != "youverify" {
		t.Errorf("winner = %q, want youverify", res.Provider)
	}
	if good.calls != 1 {
		t.Errorf("second provider calls = %d, want 1", good.calls)
	}
	if len(res.FailedOver) != 1 || res.FailedOver[0] != "dojah" {
		t.Errorf("FailedOver = %v, want [dojah]", res.FailedOver)
	}
}

// The whole walk is capped by the budget: a hop slice is truncated to whatever
// time is left, and once the budget is gone the walk stops rather than calling
// providers it can no longer give any time to.
func TestGateway_TotalBudgetStopsTheWalk(t *testing.T) {
	withTestBudgets(t, 30*time.Millisecond, 200*time.Millisecond)

	reg := NewRegistry()
	first := &slowIDNumber{name: "dojah", delay: time.Hour}
	second := &slowIDNumber{name: "smileid", delay: time.Hour}
	third := &slowIDNumber{name: "youverify", delay: time.Hour}
	reg.register("dojah", first)
	reg.register("smileid", second)
	reg.register("youverify", third)

	gw := NewGateway(reg, idNumberTable("dojah", "smileid", "youverify"))
	start := time.Now()
	_, err := gw.Run(context.Background(), provider.KycIDNumber, provider.KycVerifyRequest{ClientRef: "t3"})
	elapsed := time.Since(start)

	if !errors.Is(err, ErrProviderTimeout) {
		t.Errorf("want ErrProviderTimeout, got %v", err)
	}
	if elapsed > 500*time.Millisecond {
		t.Errorf("walk took %s, want under the 30ms budget", elapsed)
	}
	if first.calls != 1 {
		t.Errorf("first hop calls = %d, want 1", first.calls)
	}
	if second.calls != 0 || third.calls != 0 {
		t.Errorf("providers after the exhausted budget must not be called, got (%d,%d)", second.calls, third.calls)
	}
}

// Plain adapter errors stay ErrNoProvider — only a deadline reads as a timeout.
func TestGateway_ErrorFailoverIsNotATimeout(t *testing.T) {
	withTestBudgets(t, 5*time.Second, 50*time.Millisecond)

	reg := NewRegistry()
	reg.register("dojah", &fakeIDNumber{name: "dojah", fail: true})
	reg.register("youverify", &fakeIDNumber{name: "youverify", fail: true})

	gw := NewGateway(reg, idNumberTable("dojah", "youverify"))
	_, err := gw.Run(context.Background(), provider.KycIDNumber, provider.KycVerifyRequest{ClientRef: "t4"})
	if !errors.Is(err, ErrNoProvider) {
		t.Errorf("want ErrNoProvider, got %v", err)
	}
	if errors.Is(err, ErrProviderTimeout) {
		t.Errorf("error failover must not be reported as a timeout: %v", err)
	}
}
