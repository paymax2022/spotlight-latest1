package cryptosvc

// Regression tests for the independent audit of PR #710.

import (
	"context"
	"errors"
	"testing"

	"github.com/shopspring/decimal"

	"spotlight/backend/internal/cryptoprov"
)

func (r *svcRig) state(t *testing.T, id string) cryptoprov.SwapState {
	t.Helper()
	s, ok, _ := r.store.SwapByID(context.Background(), user, id)
	if !ok {
		t.Fatal("swap missing")
	}
	return s.State
}

// Blocker 1: a released hold must never be resumed into a provider execution.
func TestResumeAfterTheHoldWasReleasedNeverExecutes(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	ctx := context.Background()

	// The provider refuses (4xx), the hold is released, but the write that marks the swap
	// failed is lost (client disconnect / DB blip).
	r.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: 422, Code: "quote_expired"}
	r.store.failTo = map[cryptoprov.SwapState]error{cryptoprov.SwapStateFailed: errors.New("db blip")}
	_, _ = r.svc.Confirm(ctx, user, q.ID)
	if r.led.bal(walletK) != 2_000_000 {
		t.Fatalf("setup: hold not released, wallet=%d", r.led.bal(walletK))
	}

	// The user retries (the DB is back) and the provider would now accept.
	r.store.failTo = nil
	r.prov.confirmErr = nil
	before := r.prov.confirms
	_, err := r.svc.Confirm(ctx, user, q.ID)
	if err == nil && r.state(t, q.ID) == cryptoprov.SwapStateProcessing {
		t.Fatal("a swap whose hold was released was executed")
	}
	if r.prov.confirms != before {
		t.Fatal("the provider was asked to execute with the NGN already refunded")
	}
	if r.led.bal(walletK) != 2_000_000 || r.led.bal(clearK) != 0 {
		t.Fatalf("wallet=%d clearing=%d: user must stay whole", r.led.bal(walletK), r.led.bal(clearK))
	}
	if st := r.state(t, q.ID); st != cryptoprov.SwapStateFailed {
		t.Fatalf("state = %s, want failed", st)
	}
}

func TestHoldBuyRefusesOnceTheHoldWasReleased(t *testing.T) {
	s, l := newSettler(t)
	l.fund(user, 2_000_000)
	ctx := context.Background()
	_ = s.HoldBuy(ctx, buy(1_000_000, 7_500))
	_ = s.FailBuy(ctx, buy(1_000_000, 7_500))
	if err := s.HoldBuy(ctx, buy(1_000_000, 7_500)); !errors.Is(err, ErrSettlementConflict) {
		t.Fatalf("err = %v, want ErrSettlementConflict", err)
	}
	if l.bal(walletK) != 2_000_000 {
		t.Fatalf("wallet = %d", l.bal(walletK))
	}
}

// Blocker 2: a possibly-executed provider call is never repeated and never refunded blindly.
func TestResumeAfterAPossiblyExecutedProviderCallParksInsteadOfRecalling(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	ctx := context.Background()
	// Crash simulation: claimed, held, provider call attempted, no swap id recorded.
	_, _ = r.store.TransitionSwap(ctx, q.ID, cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming, decimal.Zero, "")
	_ = r.svc.cfg.Settler.HoldBuy(ctx, SwapLedgerInput{SwapID: q.ID, UserID: user, Side: SideBuy, NGNKobo: 1_000_000, FeeKobo: 7_500})
	_, _ = r.store.MarkExecuteAttempt(ctx, q.ID)

	_, err := r.svc.Confirm(ctx, user, q.ID)
	if err == nil {
		t.Fatal("an unknown-outcome swap resumed as if nothing happened")
	}
	if r.prov.confirms != 0 {
		t.Fatal("the provider was called again after an attempt of unknown outcome")
	}
	if r.led.bal(clearK) != 1_007_500 {
		t.Fatalf("hold released on an unknown outcome: clearing=%d", r.led.bal(clearK))
	}
	if st := r.state(t, q.ID); st != cryptoprov.SwapStateNeedsReview {
		t.Fatalf("state = %s, want needs_review", st)
	}
}

func TestExecutedButSwapIDNotRecordedKeepsTheHoldAndNeverRecalls(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	ctx := context.Background()
	r.store.failSetPSID = errors.New("db down")
	if _, err := r.svc.Confirm(ctx, user, q.ID); err == nil {
		t.Fatal("expected the unrecorded id to surface")
	}
	r.store.failSetPSID = nil
	_, _ = r.svc.Confirm(ctx, user, q.ID) // a client retry
	if r.prov.confirms != 1 {
		t.Fatalf("provider confirms = %d: the swap was executed twice", r.prov.confirms)
	}
	if r.led.bal(clearK) != 1_007_500 {
		t.Fatalf("hold released although the provider executed: clearing=%d", r.led.bal(clearK))
	}
	if st := r.state(t, q.ID); st != cryptoprov.SwapStateNeedsReview {
		t.Fatalf("state = %s", st)
	}
}

// High 3: only explicit refusals prove "not executed".
func TestOnlyExplicitRefusalsReleaseTheHold(t *testing.T) {
	for status, wantReleased := range map[int]bool{
		400: true, 404: true, 422: true, 429: true,
		401: false, 403: false, 408: false, 409: false, 425: false, 500: false, 503: false,
	} {
		r := newSvcRig(t)
		r.led.fund(user, 2_000_000)
		q := r.quote(t, "k", 1_000_000)
		r.prov.confirmErr = &cryptoprov.APIError{Provider: "mock", Status: status}
		_, _ = r.svc.Confirm(context.Background(), user, q.ID)
		released := r.led.bal(walletK) == 2_000_000
		if released != wantReleased {
			t.Errorf("HTTP %d: released=%v, want %v", status, released, wantReleased)
		}
		if !wantReleased && r.state(t, q.ID) != cryptoprov.SwapStateNeedsReview {
			t.Errorf("HTTP %d: state %s, want needs_review", status, r.state(t, q.ID))
		}
	}
}

// High 4: the locker is mandatory.
func TestServiceFailsClosedWithoutALocker(t *testing.T) {
	r := newSvcRig(t)
	r.svc.cfg.Locker = nil
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k", Asset: "USDT", NGNKobo: 1_000_000}); err == nil {
		t.Fatal("quote ran without a locker")
	}
}

// Medium 5: the gate runs on resume too.
func TestGateIsRecheckedWhenResumingAClaimedSwap(t *testing.T) {
	r := newSvcRig(t)
	r.led.fund(user, 2_000_000)
	q := r.quote(t, "k", 1_000_000)
	ctx := context.Background()
	_, _ = r.store.TransitionSwap(ctx, q.ID, cryptoprov.SwapStateQuoted, cryptoprov.SwapStateConfirming, decimal.Zero, "")
	r.svc.cfg.Gate = okGate{err: errors.New("frozen")}
	if _, err := r.svc.Confirm(ctx, user, q.ID); err == nil {
		t.Fatal("a frozen user resumed a confirm")
	}
	if r.led.bal(walletK) != 2_000_000 || r.prov.confirms != 0 {
		t.Fatalf("wallet=%d confirms=%d", r.led.bal(walletK), r.prov.confirms)
	}
}
