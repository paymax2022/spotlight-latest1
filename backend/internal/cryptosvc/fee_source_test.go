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
	ch, err := f.Append(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	return ch.New
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

// A stored schedule carrying a looser ceiling than the code's must not price anything, even
// when every individual rate happens to be small.
func TestQuoteRefusesAScheduleWithALooserCeilingThanTheCode(t *testing.T) {
	r, f := feeRig(t)
	f.rows = append(f.rows, VersionedFees{Version: 1, Schedule: FeeSchedule{MajorBps: 75, OtherBps: 100, MaxBps: 500, Majors: map[string]struct{}{"USDT": {}}}})
	if _, err := r.svc.Quote(context.Background(), QuoteRequest{UserID: user, IdempotencyKey: "k1", Asset: "USDT", NGNKobo: 1_000_000}); err == nil {
		t.Fatal("a schedule that does not carry the code ceiling must be refused")
	}
}

func TestStoredScheduleValidationCatchesSilentMispricing(t *testing.T) {
	good := VersionedFees{Schedule: FeeSchedule{MajorBps: 75, OtherBps: 100, MaxBps: HardMaxBps, Majors: map[string]struct{}{"USDT": {}}, Overrides: map[string]int{"DOGE": 140}}}
	if err := validateStored(good); err != nil {
		t.Fatalf("a canonical schedule must pass: %v", err)
	}
	for name, mutate := range map[string]func(*VersionedFees){
		"lower-case major (would never match)":    func(v *VersionedFees) { v.Schedule.Majors = map[string]struct{}{"usdt": {}} },
		"lower-case override (would never match)": func(v *VersionedFees) { v.Schedule.Overrides = map[string]int{"doge": 140} },
		"padded asset code":                       func(v *VersionedFees) { v.Schedule.Majors = map[string]struct{}{" USDT": {}} },
		"wrong ceiling":                           func(v *VersionedFees) { v.Schedule.MaxBps = 500 },
		"rate above the ceiling":                  func(v *VersionedFees) { v.Schedule.MajorBps = HardMaxBps + 1 },
	} {
		v := good
		v.Schedule.Majors = map[string]struct{}{"USDT": {}}
		v.Schedule.Overrides = map[string]int{"DOGE": 140}
		mutate(&v)
		if validateStored(v) == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestTheBaseScheduleCanNeverCarryALooserCeiling(t *testing.T) {
	base := DefaultFeeSchedule()
	base.MaxBps = 500
	if got := NewPGFeeStore(nil, base).base.MaxBps; got != HardMaxBps {
		t.Fatalf("base ceiling = %d, want the code ceiling %d", got, HardMaxBps)
	}
}
