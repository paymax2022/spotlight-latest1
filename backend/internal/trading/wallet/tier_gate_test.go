package wallet

// DB-free tests for the fail-closed KYC-tier / daily-debit gate on the trading
// Subscribe money path (E2E-FIN-046). ensureSubscribeDebit called
// ledger.Service.Debit with only the Module-KYC AccessGate — which answers "may
// this account trade", NOT "how much cash may leave the wallet today" — so a
// kyc_tier=0 or over-daily-cap member could fund positions the transfer rail
// itself refused. These tests pin the seam:
//   - the guard delegates the exact (userID, amountKobo) to the SAME
//     EnforceWalletDebitLimit finance/transfers uses;
//   - tier refusals propagate unwrapped so the handler errMap maps them to 403;
//   - a service constructed without a pool leaves the gate unwired and refuses
//     (fail closed) rather than debiting ungated.
// The gate runs inside ensureSubscribeDebit AFTER the durable-Posted replay
// short-circuit and BEFORE the ledger call, so a refused attempt posts zero
// ledger legs and mints no units.

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/finance/tiers"
)

// recordingDebitLimiter is the fake walletDebitLimiter injected via WithTiers:
// err==nil allows, non-nil refuses.
type recordingDebitLimiter struct {
	err       error
	calls     int
	gotUserID string
	gotAmount int64
}

func (f *recordingDebitLimiter) EnforceWalletDebitLimit(_ context.Context, userID string, amountKobo int64) error {
	f.calls++
	f.gotUserID = userID
	f.gotAmount = amountKobo
	return f.err
}

func TestEnforceDebitLimit_DelegatesUserAndAmount(t *testing.T) {
	fake := &recordingDebitLimiter{}
	s := &Service{tiers: fake}
	if err := s.enforceDebitLimit(context.Background(), "user-9", 500_000); err != nil {
		t.Fatalf("allow case must pass through, got %v", err)
	}
	if fake.calls != 1 || fake.gotUserID != "user-9" || fake.gotAmount != 500_000 {
		t.Fatalf("tier gate must delegate the exact user+amount: %+v", fake)
	}
}

func TestEnforceDebitLimit_PropagatesTierSentinelsUnwrapped(t *testing.T) {
	for _, sentinel := range []error{tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded} {
		fake := &recordingDebitLimiter{err: sentinel}
		s := &Service{tiers: fake}
		if err := s.enforceDebitLimit(context.Background(), "u", 1_000); !errors.Is(err, sentinel) {
			t.Errorf("refusal %v must propagate unwrapped, got %v", sentinel, err)
		}
	}
}

func TestEnforceDebitLimit_FailsClosedOnDepError(t *testing.T) {
	fake := &recordingDebitLimiter{err: errors.New("tiers: get tier (fail closed): connection refused")}
	s := &Service{tiers: fake}
	if err := s.enforceDebitLimit(context.Background(), "u", 1_000); err == nil {
		t.Fatal("a tier-dep error MUST fail closed (deny the debit)")
	}
}

func TestEnforceDebitLimit_NilGateFailsClosed(t *testing.T) {
	s := &Service{} // tiers nil
	if err := s.enforceDebitLimit(context.Background(), "u", 1_000); !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("nil gate must refuse with ErrTierGateUnwired, got %v", err)
	}
}

func TestNewService_NilPoolLeavesGateUnwired(t *testing.T) {
	// A nil pool cannot build tiers.NewService — the field stays nil and the
	// subscribe debit then fails closed via ErrTierGateUnwired.
	if NewService(nil, nil, nil, 0, 0).tiers != nil {
		t.Error("NewService(nil pool) must leave the tier gate unwired")
	}
}

func TestWithTiers_InjectsGateAndIgnoresNil(t *testing.T) {
	fake := &recordingDebitLimiter{}
	s := &Service{}
	s.WithTiers(fake)
	if s.tiers != fake {
		t.Error("WithTiers must install the injected gate")
	}
	s.WithTiers(nil)
	if s.tiers != fake {
		t.Error("WithTiers(nil) must not clear the wired gate")
	}
}

// Compile-time guard: the service must satisfy the real limiter interface with
// *tiers.Service so app wiring (trading.Register → wallet.NewService) is covered.
var _ walletDebitLimiter = (*tiers.Service)(nil)
