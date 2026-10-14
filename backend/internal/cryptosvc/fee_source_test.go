package cryptosvc

import (
	"context"
	"errors"
	"testing"
)

func feeRig(t *testing.T) (*svcRig, *memFees) {
	t.Helper()
	r := newSvcRig(t)
	f := newMemFees()
	r.svc.cfg.FeeSource = f
	r.led.fund(user, 50_000_000)
	return r, f
}

func appendFees(t *testing.T, f *memFees, expected int64, key string, major, other int) VersionedFees {
	t.Helper()
	in := okInput()
	in.ExpectedVersion, in.IdempotencyKey, in.MajorBps, in.OtherBps = expected, key, major, other
	in.Overrides = nil
	v, _, err := f.Append(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestQuoteUsesTheLiveScheduleAndFallsBackToTheDefaultBeforeAnyEdit(t *testing.T) {
	r, f := feeRig(t)
	if q := r.quote(t, "k0", 1_000_000); q.FeeBps != 75 {
		t.Fatalf("with no stored schedule the code default applies, got %d bps", q.FeeBps)
	}
	appendFees(t, f, 0, "e1", 90, 120)
	q := r.quote(t, "k1", 1_000_000)
	if q.FeeBps != 90 || q.FeeKobo != 9_000 {
		t.Fatalf("quote must price at the edited schedule: %+v", q)
	}
}

// The safety property of the whole slice: a new schedule never reprices a swap that is already
// quoted, because the bps and fee are stored on the swap and every later step reads them back.
func TestAnOpenQuoteKeepsItsPriceWhenTheScheduleChanges(t *testing.T) {
	r, f := feeRig(t)
	appendFees(t, f, 0, "e1", 90, 120)
	open := r.quote(t, "k1", 1_000_000)

	appendFees(t, f, 1, "e2", 150, 150)
	got, err := r.svc.Confirm(context.Background(), user, open.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.FeeBps != 90 || got.FeeKobo != 9_000 {
		t.Fatalf("a schedule change repriced an open swap: %+v", got)
	}
	if next := r.quote(t, "k2", 1_000_000); next.FeeBps != 150 {
		t.Fatalf("new quotes must use the new schedule, got %d", next.FeeBps)
	}
}

func TestQuoteFailsClosedWhenTheScheduleCannotBeRead(t *testing.T) {
	r, f := feeRig(t)
	f.failRead = errors.New("db down")
	_, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k1", Asset: "USDT", NGNKobo: 1_000_000})
	if err == nil {
		t.Fatal("a quote without a readable fee schedule must be refused, not priced at a guess")
	}
	if got, _ := r.store.ListByState(context.Background(), "quoted", 10, 0); len(got) != 0 {
		t.Fatalf("no swap may be created: %v", got)
	}
}

func TestQuoteFailsClosedOnAnOverCeilingSchedule(t *testing.T) {
	r, f := feeRig(t)
	f.rows = append(f.rows, VersionedFees{Version: 1, Schedule: FeeSchedule{MajorBps: HardMaxBps + 50, OtherBps: 100, MaxBps: HardMaxBps, Majors: map[string]struct{}{"USDT": {}}}})
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k1", Asset: "USDT", NGNKobo: 1_000_000}); err == nil {
		t.Fatal("a stored schedule above the hard ceiling must never price a quote")
	}
}
