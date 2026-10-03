package social

// DB-free tests for the fail-closed KYC-tier / daily-debit gate on the Social
// Pay money path (E2E-FIN-041). Before the gate, Send / PayRequest / PayShare /
// ContributePool called ledger.Service.Debit DIRECTLY — a kyc_tier=0 user could
// cashtag-send and pool-contribute while /transfers/paymax refused the same
// wallet. These tests pin the seam's behaviour without Postgres:
//   - the guard delegates the exact (userID, amountKobo) to the SAME
//     EnforceWalletDebitLimit the canonical transfer rail uses;
//   - refusals propagate the tiers sentinels UNWRAPPED (handlers map them via
//     errors.Is) and any dependency error refuses too (fail closed);
//   - a Service with no gate wired refuses rather than debiting ungated
//     (struct-literal construction in tests / forgotten wiring);
//   - the handler errMap maps tier refusals to 403 (matching the transfer
//     rail's HTTPStatusForError) and the unwired gate to 503.
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

// recordingDebitLimiter is the fake walletDebitLimiter the tests inject via
// WithTiers (or a struct literal): err==nil allows, non-nil refuses.
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
	if err := s.enforceDebitLimit(context.Background(), "user-7", 250_000); err != nil {
		t.Fatalf("allow case must pass through, got %v", err)
	}
	if fake.calls != 1 || fake.gotUserID != "user-7" || fake.gotAmount != 250_000 {
		t.Fatalf("tier gate must delegate the exact user+amount: %+v", fake)
	}
}

func TestEnforceDebitLimit_PropagatesTierSentinelsUnwrapped(t *testing.T) {
	// The sentinel must reach the handler intact: errMap resolves it with
	// errors.Is, and the caller-facing status is decided by THAT mapping.
	for _, sentinel := range []error{tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded} {
		fake := &recordingDebitLimiter{err: sentinel}
		s := &Service{tiers: fake}
		if err := s.enforceDebitLimit(context.Background(), "u", 1_000); !errors.Is(err, sentinel) {
			t.Errorf("refusal %v must propagate unwrapped, got %v", sentinel, err)
		}
	}
}

func TestEnforceDebitLimit_FailsClosedOnDepError(t *testing.T) {
	// A DB / infra error inside the gate must deny the debit — never let money
	// move when the limit cannot be evaluated.
	fake := &recordingDebitLimiter{err: errors.New("tiers: get tier (fail closed): connection refused")}
	s := &Service{tiers: fake}
	if err := s.enforceDebitLimit(context.Background(), "u", 1_000); err == nil {
		t.Fatal("a tier-dep error MUST fail closed (deny the debit)")
	}
}

func TestEnforceDebitLimit_NilGateFailsClosed(t *testing.T) {
	// Defensive: a Service with no tier gate wired must never permit a debit.
	s := &Service{}
	if err := s.enforceDebitLimit(context.Background(), "u", 1_000); !errors.Is(err, ErrTierGateUnwired) {
		t.Fatalf("nil gate must refuse with ErrTierGateUnwired, got %v", err)
	}
}

func TestNewService_SelfBuildsGateFromPool(t *testing.T) {
	// NewService must wire tiers.NewService(db) itself (transport's convention)
	// so the gate cannot be forgotten at a call site. A nil pool leaves it nil —
	// and nil fails closed via ErrTierGateUnwired.
	s := NewService(nil, nil, nil, nil, nil)
	if s.tiers != nil {
		t.Fatal("nil pool must leave the gate unwired (fail closed), got non-nil")
	}
}

func TestWithTiers_InjectsGateAndIgnoresNil(t *testing.T) {
	s := &Service{}
	fake := &recordingDebitLimiter{}
	s.WithTiers(fake)
	if s.tiers != fake {
		t.Fatal("WithTiers must install the injected gate")
	}
	// A nil injection must not strip an already-wired gate.
	s.WithTiers(nil)
	if s.tiers != fake {
		t.Fatal("WithTiers(nil) must not clear the wired gate")
	}
}

func TestErrMap_TierRefusalsAre403(t *testing.T) {
	// Same mapping the canonical transfer rail uses (transfers/decision.go):
	// wallet-disabled and over-daily-cap are both 403 Forbidden.
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"wallet disabled", fmt.Errorf("social: send debit: %w", tiers.ErrWalletDisabled), http.StatusForbidden},
		{"daily limit", fmt.Errorf("social: pool debit: %w", tiers.ErrDailyLimitExceeded), http.StatusForbidden},
		{"gate unwired", ErrTierGateUnwired, http.StatusServiceUnavailable},
	}
	for _, c := range cases {
		if got := errMap.Code(c.err); got != c.want {
			t.Errorf("%s: errMap.Code = %d, want %d", c.name, got, c.want)
		}
	}
}
