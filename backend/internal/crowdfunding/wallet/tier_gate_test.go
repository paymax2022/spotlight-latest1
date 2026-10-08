package wallet

// DB-free tests for the fail-closed KYC-tier / daily-debit gate on the creator
// withdrawal payout debit (E2E-FIN-046). SubmitWithdrawal called
// ledger.Service.Debit DIRECTLY, so a kyc_tier=0 creator could cash out a
// campaign wallet the transfer rail itself refused. These tests pin the seam:
//   - the guard delegates the exact (userID, amountKobo) to the SAME
//     EnforceWalletDebitLimit finance/transfers uses;
//   - tier refusals propagate unwrapped so the handler maps them via errors.Is;
//   - a service constructed without a pool leaves the gate unwired and refuses
//     (fail closed) rather than debiting ungated.
// The gate runs AFTER ownership/balance checks but BEFORE the ledger call
// inside SubmitWithdrawal, so a refused attempt posts zero ledger legs and no
// cf_withdrawals row.

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
	// money path then fails closed via ErrTierGateUnwired (never debits ungated).
	if NewService(nil).tiers != nil {
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
// *tiers.Service so app wiring (Register → NewService) is covered.
var _ walletDebitLimiter = (*tiers.Service)(nil)
