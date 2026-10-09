package savings

// DB-free tests for the fail-closed KYC-tier / daily-debit gate on the savings
// money paths (E2E-FIN-041). Vault Deposit — and the other member-funded debits
// (target contribute, Ajo prepay/make-good, Ajo cycle auto-debit) — used to call
// ledger.Service.Debit DIRECTLY, so a kyc_tier=0 member could move money out of
// a wallet the transfer rail itself refused. These tests pin the seam:
//   - the guard delegates the exact (userID, amountKobo) to the SAME
//     EnforceWalletDebitLimit finance/transfers uses;
//   - tier refusals propagate unwrapped so errMap maps them via errors.Is;
//   - a service constructed without a pool leaves the gate unwired and refuses
//     (fail closed) rather than debiting ungated;
//   - the handler errMap maps tier refusals to 403 and an unwired gate to 503.
// The end-to-end proof (tier-0 refused, tier-1 succeeds, zero ledger legs on
// refusal) lives in tier_gate_live_db_test.go, gated on TEST_DATABASE_URL.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
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
	if err := enforceDebitLimit(fake, context.Background(), "user-9", 500_000); err != nil {
		t.Fatalf("allow case must pass through, got %v", err)
	}
	if fake.calls != 1 || fake.gotUserID != "user-9" || fake.gotAmount != 500_000 {
		t.Fatalf("tier gate must delegate the exact user+amount: %+v", fake)
	}
}

func TestEnforceDebitLimit_PropagatesTierSentinelsUnwrapped(t *testing.T) {
	for _, sentinel := range []error{tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded} {
		fake := &recordingDebitLimiter{err: sentinel}
		if err := enforceDebitLimit(fake, context.Background(), "u", 1_000); !errors.Is(err, sentinel) {
			t.Errorf("refusal %v must propagate unwrapped, got %v", sentinel, err)
		}
	}
}

func TestEnforceDebitLimit_FailsClosedOnDepError(t *testing.T) {
	fake := &recordingDebitLimiter{err: errors.New("tiers: get tier (fail closed): connection refused")}
	if err := enforceDebitLimit(fake, context.Background(), "u", 1_000); err == nil {
		t.Fatal("a tier-dep error MUST fail closed (deny the debit)")
	}
}

func TestEnforceDebitLimit_NilGateFailsClosed(t *testing.T) {
	if err := enforceDebitLimit(nil, context.Background(), "u", 1_000); !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("nil gate must refuse with ErrTierGateUnwired, got %v", err)
	}
}

func TestConstructors_NilPoolLeavesGateUnwired(t *testing.T) {
	// A nil pool cannot build tiers.NewService — the field stays nil and the
	// money path then fails closed via ErrTierGateUnwired (never debits ungated).
	if NewVaultService(nil, nil, nil, nil).tiers != nil {
		t.Error("NewVaultService(nil pool) must leave the tier gate unwired")
	}
	if NewAjoService(nil, nil, nil, nil).tiers != nil {
		t.Error("NewAjoService(nil pool) must leave the tier gate unwired")
	}
	if NewTargetService(nil, nil, nil).tiers != nil {
		t.Error("NewTargetService(nil pool) must leave the tier gate unwired")
	}
}

func TestWithTiers_InjectsGateAndIgnoresNil(t *testing.T) {
	fake := &recordingDebitLimiter{}
	for name, set := range map[string]func(l walletDebitLimiter) walletDebitLimiter{
		"vault":  func(l walletDebitLimiter) walletDebitLimiter { s := &VaultService{}; s.WithTiers(l); return s.tiers },
		"ajo":    func(l walletDebitLimiter) walletDebitLimiter { s := &AjoService{}; s.WithTiers(l); return s.tiers },
		"target": func(l walletDebitLimiter) walletDebitLimiter { s := &TargetService{}; s.WithTiers(l); return s.tiers },
	} {
		if got := set(fake); got != fake {
			t.Errorf("%s: WithTiers must install the injected gate", name)
		}
		if got := set(nil); got != nil {
			t.Errorf("%s: WithTiers(nil) must not clear the wired gate", name)
		}
	}
}

func TestErrMap_TierRefusalsAre403(t *testing.T) {
	// Same mapping the canonical transfer rail uses (transfers/decision.go).
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"wallet disabled", fmt.Errorf("savings: wallet debit: %w", tiers.ErrWalletDisabled), http.StatusForbidden},
		{"daily limit", fmt.Errorf("savings: contribute debit: %w", tiers.ErrDailyLimitExceeded), http.StatusForbidden},
		{"gate unwired", ErrTierGateUnwired, http.StatusServiceUnavailable},
	}
	for _, c := range cases {
		if got := errMap.Code(c.err); got != c.want {
			t.Errorf("%s: errMap.Code = %d, want %d", c.name, got, c.want)
		}
	}
}
