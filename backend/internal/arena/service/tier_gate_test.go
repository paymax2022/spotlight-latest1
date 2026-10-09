package service

// DB-free tests for the fail-closed KYC-tier / daily-debit gate on the Arena
// SUPPORT rail (E2E-FIN-046). Contribute / ContributeWithState debited the
// backer's wallet through LedgerPort.Debit with only the NDC-3 minimum-KYC gate
// — no daily-limit / Tier-0-disabled check — so a member the transfer rail
// refuses could still fund the pot. These tests pin the seam:
//   - the guard delegates the exact (userID, amountKobo) to the SAME
//     EnforceWalletDebitLimit finance/transfers uses;
//   - tier refusals propagate unwrapped so the handler mapErr maps them to 403;
//   - a rail built without a limiter fails CLOSED via ErrTierGateUnwired
//     (never debits ungated);
//   - a refused attempt posts ZERO money movements (the fake ledger proves it).

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/finance/tiers"
)

// recordingDebitLimit is the DebitLimitPort fake injected via WithDebitLimiter:
// err==nil allows, non-nil refuses, and it captures the delegated args.
type recordingDebitLimit struct {
	err       error
	calls     int
	gotUserID string
	gotAmount int64
}

func (f *recordingDebitLimit) EnforceWalletDebitLimit(_ context.Context, userID string, amountKobo int64) error {
	f.calls++
	f.gotUserID = userID
	f.gotAmount = amountKobo
	return f.err
}

func TestDebitGate_DelegatesUserAndAmount(t *testing.T) {
	fake := &recordingDebitLimit{}
	svc := NewSupportService(&fakeSupportRepo{}, newFakeLedger(), fakeTier{3},
		fakeCfg{Config{RequiredKYCTier: 1}}, &fakeAudit{}).WithDebitLimiter(fake)
	if err := svc.Contribute(context.Background(), "user-9", "idem-1", "c1", "k1", 500_000); err != nil {
		t.Fatalf("allow case must pass through, got %v", err)
	}
	if fake.calls != 1 || fake.gotUserID != "user-9" || fake.gotAmount != 500_000 {
		t.Fatalf("tier gate must delegate the exact user+amount: %+v", fake)
	}
}

func TestDebitGate_TierRefusalsPostZeroLegs(t *testing.T) {
	for _, sentinel := range []error{tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded} {
		led := newFakeLedger()
		repo := &fakeSupportRepo{}
		svc := NewSupportService(repo, led, fakeTier{3},
			fakeCfg{Config{RequiredKYCTier: 1}}, &fakeAudit{}).
			WithDebitLimiter(&recordingDebitLimit{err: sentinel})
		if err := svc.Contribute(context.Background(), "u1", "idem-ref", "c1", "k1", 1_000); !errors.Is(err, sentinel) {
			t.Errorf("refusal %v must propagate unwrapped, got %v", sentinel, err)
		}
		if led.debits != 0 {
			t.Errorf("refusal %v posted %d debits — the gate must run BEFORE money moves", sentinel, led.debits)
		}
		if len(repo.rows) != 0 {
			t.Errorf("refusal %v tagged %d support rows", sentinel, len(repo.rows))
		}
	}
}

func TestDebitGate_ContributeWithStateRefusedPostsZeroLegs(t *testing.T) {
	led := newFakeLedger()
	svc := NewSupportService(&fakeSupportRepo{}, led, fakeTier{3},
		fakeCfg{Config{RequiredKYCTier: 1}}, &fakeAudit{}).
		WithDebitLimiter(&recordingDebitLimit{err: tiers.ErrDailyLimitExceeded})
	if err := svc.ContributeWithState(context.Background(), "u1", "idem-s", "c1", "k1", "LA", 1_000); !errors.Is(err, tiers.ErrDailyLimitExceeded) {
		t.Fatalf("ContributeWithState refusal must propagate, got %v", err)
	}
	if led.debits != 0 {
		t.Fatalf("refused ContributeWithState posted %d debits", led.debits)
	}
}

func TestDebitGate_FailsClosedOnDepError(t *testing.T) {
	svc := NewSupportService(&fakeSupportRepo{}, newFakeLedger(), fakeTier{3},
		fakeCfg{Config{RequiredKYCTier: 1}}, &fakeAudit{}).
		WithDebitLimiter(&recordingDebitLimit{err: errors.New("tiers: get tier (fail closed): connection refused")})
	if err := svc.Contribute(context.Background(), "u1", "idem-dep", "c1", "k1", 1_000); err == nil {
		t.Fatal("a tier-dep error MUST fail closed (deny the debit)")
	}
}

func TestDebitGate_NilGateFailsClosed(t *testing.T) {
	led := newFakeLedger()
	svc := NewSupportService(&fakeSupportRepo{}, led, fakeTier{3},
		fakeCfg{Config{RequiredKYCTier: 1}}, &fakeAudit{}) // no limiter
	if err := svc.Contribute(context.Background(), "u1", "idem-nil", "c1", "k1", 1_000); !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("unwired rail must refuse with ErrTierGateUnwired, got %v", err)
	}
	if led.debits != 0 {
		t.Fatalf("unwired rail posted %d debits — must never debit ungated", led.debits)
	}
}

func TestWithDebitLimiter_IgnoresNil(t *testing.T) {
	svc := NewSupportService(nil, nil, nil, nil, nil).WithDebitLimiter(allowAllDebitLimit{})
	svc.WithDebitLimiter(nil)
	if svc.debitLimit == nil {
		t.Fatal("WithDebitLimiter(nil) must not clear the wired gate")
	}
}
