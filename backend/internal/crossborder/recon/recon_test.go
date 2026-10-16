package recon

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/finance/ledger"
)

type fakeSrc struct {
	ourBal, provBal   []Item
	ourTx, provTx     []Item
	expMarkup, stmt   []Item
	commission, rev   []Item
	legs              []SpreadLeg
	entries           map[string]bool
	redriven          []string
	redriveErr        error
	redriveCreatesKey bool
}

func (f *fakeSrc) LedgerBalances(context.Context) ([]Item, error)    { return f.ourBal, nil }
func (f *fakeSrc) ProviderBalances(context.Context) ([]Item, error)  { return f.provBal, nil }
func (f *fakeSrc) OurTransfers(context.Context) ([]Item, error)      { return f.ourTx, nil }
func (f *fakeSrc) ProviderTransfers(context.Context) ([]Item, error) { return f.provTx, nil }
func (f *fakeSrc) ExpectedMarkup(context.Context) ([]Item, error)    { return f.expMarkup, nil }
func (f *fakeSrc) StatementMarkup(context.Context) ([]Item, error)   { return f.stmt, nil }
func (f *fakeSrc) CommissionEntries(context.Context) ([]Item, error) { return f.commission, nil }
func (f *fakeSrc) LedgerRevenue(context.Context) ([]Item, error)     { return f.rev, nil }
func (f *fakeSrc) SpreadLegs(context.Context) ([]SpreadLeg, error)   { return f.legs, nil }
func (f *fakeSrc) EntryByKey(_ context.Context, k string) (*ledger.Entry, bool, error) {
	if f.entries[k] {
		return &ledger.Entry{}, true, nil
	}
	return nil, false, nil
}
func (f *fakeSrc) Redrive(_ context.Context, l SpreadLeg) error {
	f.redriven = append(f.redriven, l.Reference)
	if f.redriveErr == nil && f.redriveCreatesKey {
		f.entries["cb:"+l.Reference+":fx_spread:"+l.Service+":accrue:debit"] = true
	}
	return f.redriveErr
}

func newJob(f *fakeSrc) (*Reconciler, *MemStore) {
	st := NewMemStore()
	return New(f, f, st), st
}

func types(bs []Break) map[BreakType]int {
	m := map[BreakType]int{}
	for _, b := range bs {
		m[b.Type]++
	}
	return m
}

func TestCleanStateNoBreaks(t *testing.T) {
	f := &fakeSrc{
		ourBal: []Item{{Ref: "m:NGN", Amount: 100}}, provBal: []Item{{Ref: "m:NGN", Amount: 100}},
		ourTx: []Item{{Ref: "t1", Amount: 5, Status: "COMPLETED"}}, provTx: []Item{{Ref: "t1", Amount: 5, Status: "COMPLETED"}},
		expMarkup: []Item{{Ref: "t1", Amount: 2}}, stmt: []Item{{Ref: "t1", Amount: 2}},
		commission: []Item{{Ref: "t1", Amount: 2}}, rev: []Item{{Ref: "t1", Amount: 2}},
		legs:    []SpreadLeg{{Reference: "t1", Currency: "NGN", AmountMinor: 2}},
		entries: map[string]bool{"cb:t1:fx_spread:send:accrue:debit": true},
	}
	r, st := newJob(f)
	ctx := context.Background()
	for name, fn := range map[string]func(context.Context) (*Report, error){
		"ledger": r.ReconLedgerVsProvider, "transfers": r.ReconTransfersVsProvider,
		"markup": r.ReconMarkupVsStatement, "commission": r.ReconCommissionVsLedger, "gap": r.ReconRecognitionGap,
	} {
		rep, err := fn(ctx)
		if err != nil || len(rep.Breaks) != 0 {
			t.Fatalf("%s: err=%v breaks=%v", name, err, rep.Breaks)
		}
	}
	if len(st.Breaks()) != 0 {
		t.Fatalf("stored breaks on clean state: %v", st.Breaks())
	}
}

func TestLedgerVsProviderBreaks(t *testing.T) {
	f := &fakeSrc{
		ourBal:  []Item{{Ref: "a", Amount: 100}, {Ref: "b", Amount: 50}, {Ref: "d", Amount: 1}},
		provBal: []Item{{Ref: "a", Amount: 90}, {Ref: "c", Amount: 7}, {Ref: "d", Amount: 1}},
	}
	r, _ := newJob(f)
	rep, err := r.ReconLedgerVsProvider(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	m := types(rep.Breaks)
	if m[AmountMismatch] != 1 || m[MissingInProvider] != 1 || m[MissingInLedger] != 1 || len(rep.Breaks) != 3 {
		t.Fatalf("got %v", rep.Breaks)
	}
	for _, b := range rep.Breaks {
		if b.Type == AmountMismatch && b.Delta != -10 {
			t.Fatalf("delta (provider-ours) = %d", b.Delta)
		}
	}
}

func TestTransfersVsProviderBreaks(t *testing.T) {
	f := &fakeSrc{
		ourTx: []Item{{Ref: "ok", Amount: 5, Status: "COMPLETED"}, {Ref: "amt", Amount: 5, Status: "COMPLETED"},
			{Ref: "st", Amount: 5, Status: "COMPLETED"}, {Ref: "gone", Amount: 5, Status: "COMPLETED"},
			{Ref: "dup", Amount: 1, Status: "COMPLETED"}},
		provTx: []Item{{Ref: "ok", Amount: 5, Status: "COMPLETED"}, {Ref: "amt", Amount: 6, Status: "COMPLETED"},
			{Ref: "st", Amount: 5, Status: "FAILED"}, {Ref: "orphan", Amount: 1, Status: "COMPLETED"},
			{Ref: "dup", Amount: 1, Status: "COMPLETED"}, {Ref: "dup", Amount: 1, Status: "COMPLETED"}},
	}
	r, _ := newJob(f)
	rep, err := r.ReconTransfersVsProvider(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	m := types(rep.Breaks)
	if m[AmountMismatch] != 1 || m[StatusMismatch] != 1 || m[MissingInProvider] != 1 || m[MissingInLedger] != 1 || m[Duplicate] != 1 || len(rep.Breaks) != 5 {
		t.Fatalf("got %+v", rep.Breaks)
	}
}

func TestMarkupVsStatementBreaks(t *testing.T) {
	f := &fakeSrc{
		expMarkup: []Item{{Ref: "a", Amount: 10}, {Ref: "b", Amount: 4}},
		stmt:      []Item{{Ref: "a", Amount: 9}, {Ref: "c", Amount: 3}},
	}
	r, _ := newJob(f)
	rep, _ := r.ReconMarkupVsStatement(context.Background())
	m := types(rep.Breaks)
	if m[AmountMismatch] != 1 || m[MissingInProvider] != 1 || m[MissingInLedger] != 1 || len(rep.Breaks) != 3 {
		t.Fatalf("got %+v", rep.Breaks)
	}
}

func TestCommissionVsLedgerBreaks(t *testing.T) {
	f := &fakeSrc{
		commission: []Item{{Ref: "a", Amount: 10}, {Ref: "b", Amount: 4}, {Ref: "d", Amount: 1}, {Ref: "d", Amount: 1}},
		rev:        []Item{{Ref: "a", Amount: 11}, {Ref: "c", Amount: 3}, {Ref: "d", Amount: 1}},
	}
	r, _ := newJob(f)
	rep, _ := r.ReconCommissionVsLedger(context.Background())
	m := types(rep.Breaks)
	if m[AmountMismatch] != 1 || m[MissingInLedger] != 1 || m[MissingInCommission] != 1 || m[Duplicate] != 1 || len(rep.Breaks) != 4 {
		t.Fatalf("got %+v", rep.Breaks)
	}
}

func TestRerunDoesNotDuplicateBreaks(t *testing.T) {
	f := &fakeSrc{ourTx: []Item{{Ref: "x", Amount: 5, Status: "COMPLETED"}}}
	r, st := newJob(f)
	ctx := context.Background()
	r1, _ := r.ReconTransfersVsProvider(ctx)
	r2, _ := r.ReconTransfersVsProvider(ctx)
	if len(r1.Breaks) != 1 || len(r2.Breaks) != 1 || r1.NewBreaks != 1 || r2.NewBreaks != 0 {
		t.Fatalf("r1=%+v r2=%+v", r1, r2)
	}
	if len(st.Breaks()) != 1 {
		t.Fatalf("stored %d", len(st.Breaks()))
	}
	// once resolved, a recurrence opens a new break
	st.Resolve(st.Breaks()[0].DedupeKey(), "fixed")
	r3, _ := r.ReconTransfersVsProvider(ctx)
	if r3.NewBreaks != 1 || len(st.Breaks()) != 2 {
		t.Fatalf("after resolve: %+v %d", r3, len(st.Breaks()))
	}
}

func TestRecognitionGap(t *testing.T) {
	f := &fakeSrc{
		legs: []SpreadLeg{
			{Reference: "ok", Service: "send", Currency: "NGN", AmountMinor: 2},
			{Reference: "gap", Service: "send", Currency: "USD", AmountMinor: 3},
			{Reference: "norate", Service: "send", Currency: "USD", AmountMinor: 3, NoNGNLeg: true},
			{Reference: "unk", Currency: "NGN", AmountMinor: 4},
		},
		entries: map[string]bool{"cb:ok:fx_spread:send:accrue:debit": true, "cb:unk:fx_spread:convert:accrue:debit": true},
	}
	r, _ := newJob(f)
	rep, err := r.ReconRecognitionGap(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Breaks) != 1 || rep.Breaks[0].Type != RecognitionGap || rep.Breaks[0].RefA != "gap" || rep.Breaks[0].Delta != 3 {
		t.Fatalf("got %+v", rep.Breaks)
	}
}

func TestRecognitionGapRedrive(t *testing.T) {
	legs := []SpreadLeg{{Reference: "gap", Service: "send", Currency: "NGN", AmountMinor: 3}}
	f := &fakeSrc{legs: legs, entries: map[string]bool{}, redriveCreatesKey: true}
	r, _ := newJob(f)
	r.EnableRedrive(f)
	rep, _ := r.ReconRecognitionGap(context.Background())
	if len(rep.Breaks) != 0 || rep.Redriven != 1 || len(f.redriven) != 1 {
		t.Fatalf("redrive ok: %+v", rep)
	}
	// redrive fails -> break recorded
	f2 := &fakeSrc{legs: legs, entries: map[string]bool{}, redriveErr: errors.New("boom")}
	r2, _ := newJob(f2)
	r2.EnableRedrive(f2)
	rep2, _ := r2.ReconRecognitionGap(context.Background())
	if len(rep2.Breaks) != 1 || rep2.Breaks[0].Type != RecognitionGap {
		t.Fatalf("redrive fail: %+v", rep2)
	}
	// redrive "succeeds" but entry still absent -> break
	f3 := &fakeSrc{legs: legs, entries: map[string]bool{}}
	r3, _ := newJob(f3)
	r3.EnableRedrive(f3)
	rep3, _ := r3.ReconRecognitionGap(context.Background())
	if len(rep3.Breaks) != 1 {
		t.Fatalf("unverified redrive must break: %+v", rep3)
	}
}
