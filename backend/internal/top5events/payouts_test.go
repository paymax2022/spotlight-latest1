package top5events

// Pure (no-DB) tests for the organiser payout rail (EVTC-D003): the eligibility
// gate, the cumulative net-of-refunds/fees/reserve formula and the payout state
// machine. The live-DB suite (payouts_live_db_test.go) covers the money legs.

import (
	"errors"
	"testing"
	"time"
)

func TestComputePayout_FirstPayoutNetOfFeeAndReserve(t *testing.T) {
	// 200 000 eligible gross, 10% fee, 5% reserve on the post-fee amount.
	got, err := computePayout(200000, 1000, 500, true, payoutTotals{})
	if err != nil {
		t.Fatalf("computePayout: %v", err)
	}
	want := PayoutAmounts{GrossKobo: 200000, FeeKobo: 20000, NetKobo: 171000, ReserveHeldKobo: 9000}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	if got.FeeKobo+got.NetKobo+got.ReserveHeldKobo != got.GrossKobo {
		t.Fatalf("first payout must conserve gross: %+v", got)
	}
}

func TestComputePayout_TruncatesTowardOrganiserAndConserves(t *testing.T) {
	// 333 kobo at 10% fee: fee truncates to 33, reserve 3% of 300 = 9.
	got, err := computePayout(333, 1000, 300, true, payoutTotals{})
	if err != nil {
		t.Fatalf("computePayout: %v", err)
	}
	if got.FeeKobo != 33 || got.ReserveHeldKobo != 9 || got.NetKobo != 291 {
		t.Fatalf("got %+v", got)
	}
	if got.FeeKobo+got.NetKobo+got.ReserveHeldKobo != 333 {
		t.Fatalf("rounding leaked kobo: %+v", got)
	}
}

func TestComputePayout_SecondPayoutPaysOnlyTheIncrement(t *testing.T) {
	prior := payoutTotals{GrossKobo: 200000, FeeKobo: 20000, NetKobo: 171000}
	// Nothing new and the reserve still held → nothing due.
	if _, err := computePayout(200000, 1000, 500, true, prior); !errors.Is(err, ErrPayoutNothingDue) {
		t.Fatalf("re-run with no new sales: err=%v, want ErrPayoutNothingDue", err)
	}
	// Reserve window elapsed → the held 9 000 is released, no new fee.
	got, err := computePayout(200000, 1000, 500, false, prior)
	if err != nil {
		t.Fatalf("reserve release: %v", err)
	}
	if got != (PayoutAmounts{GrossKobo: 0, FeeKobo: 0, NetKobo: 9000, ReserveHeldKobo: 0}) {
		t.Fatalf("reserve release got %+v", got)
	}
}

func TestComputePayout_ShrunkEligibleAfterPayoutIsNotPaid(t *testing.T) {
	// A dispute opened after a payout shrinks eligible gross below what was
	// already paid: never pay, never post a negative leg (the statement shows
	// the shortfall as a negative balance owed by the organiser).
	prior := payoutTotals{GrossKobo: 200000, FeeKobo: 20000, NetKobo: 180000}
	if _, err := computePayout(100000, 1000, 0, false, prior); !errors.Is(err, ErrPayoutNothingDue) {
		t.Fatalf("err=%v, want ErrPayoutNothingDue", err)
	}
}

func TestComputePayout_ZeroAndInvalid(t *testing.T) {
	if _, err := computePayout(0, 1000, 500, true, payoutTotals{}); !errors.Is(err, ErrPayoutNothingDue) {
		t.Fatalf("zero gross err=%v", err)
	}
	if _, err := computePayout(100, 10001, 0, true, payoutTotals{}); err == nil {
		t.Fatal("fee_bps > 10000 must be refused")
	}
	if _, err := computePayout(100, 0, -1, true, payoutTotals{}); err == nil {
		t.Fatal("negative reserve_bps must be refused")
	}
}

func TestPayoutEligibility(t *testing.T) {
	pol := PayoutPolicy{HoldWindow: 72 * time.Hour, ReserveBps: 500, ReserveRelease: 30 * 24 * time.Hour, MinKYCTier: 1}
	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)

	if e := payoutEligibility(EventLive, now.Add(-100*time.Hour), now, pol); e.Eligible || e.Reason != "event_not_closed" {
		t.Fatalf("LIVE event: %+v", e)
	}
	if e := payoutEligibility(EventCancelled, now.Add(-100*time.Hour), now, pol); e.Eligible {
		t.Fatalf("CANCELLED event must never pay out: %+v", e)
	}
	e := payoutEligibility(EventClosed, now.Add(-1*time.Hour), now, pol)
	if e.Eligible || e.Reason != "hold_window" || !e.EligibleAt.Equal(now.Add(71*time.Hour)) {
		t.Fatalf("inside hold window: %+v", e)
	}
	e = payoutEligibility(EventClosed, now.Add(-73*time.Hour), now, pol)
	if !e.Eligible || !e.ReserveActive {
		t.Fatalf("after hold, inside reserve window: %+v", e)
	}
	e = payoutEligibility(EventClosed, now.Add(-31*24*time.Hour), now, pol)
	if !e.Eligible || e.ReserveActive {
		t.Fatalf("after reserve release: %+v", e)
	}
}

func TestPayoutStateMachine(t *testing.T) {
	legal := [][2]PayoutStatus{
		{PayoutPending, PayoutProcessing},
		{PayoutPending, PayoutFailed},
		{PayoutProcessing, PayoutPaid},
		{PayoutProcessing, PayoutFailed},
	}
	for _, m := range legal {
		if !payoutMoves.Can(m[0], m[1]) {
			t.Errorf("%s -> %s must be legal", m[0], m[1])
		}
	}
	illegal := [][2]PayoutStatus{
		{PayoutPaid, PayoutFailed},
		{PayoutPaid, PayoutProcessing},
		{PayoutFailed, PayoutProcessing},
		{PayoutFailed, PayoutPaid},
		{PayoutPending, PayoutPaid},
	}
	for _, m := range illegal {
		if payoutMoves.Can(m[0], m[1]) {
			t.Errorf("%s -> %s must be illegal", m[0], m[1])
		}
	}
	if !payoutMoves.IsTerminal(PayoutPaid) || !payoutMoves.IsTerminal(PayoutFailed) {
		t.Error("paid and failed are terminal")
	}
}
