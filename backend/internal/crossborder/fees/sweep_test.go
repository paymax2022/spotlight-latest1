package fees_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"spotlight/backend/internal/crossborder/fees"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider/vertofx"
)

const (
	coA = "11111111-1111-4111-8111-111111111111"
	coB = "22222222-2222-4222-8222-222222222222"
)

type sweepLedger struct {
	accts   []ledger.AccountBalance
	entries map[string][]ledger.Entry
	keys    map[string]bool // EntryByKey hits (settle legs)
	listed  int
}

func (l *sweepLedger) ListPositiveBalancesByTypePrefix(_ context.Context, prefix string) ([]ledger.AccountBalance, error) {
	l.listed++
	if prefix != "fees_unswept:" {
		return nil, fmt.Errorf("unexpected prefix %q", prefix)
	}
	return l.accts, nil
}
func (l *sweepLedger) ListAccountEntries(_ context.Context, id string, limit, offset int) ([]ledger.Entry, error) {
	all := l.entries[id]
	if offset >= len(all) {
		return nil, nil
	}
	end := offset + limit
	if end > len(all) {
		end = len(all)
	}
	return all[offset:end], nil
}
func (l *sweepLedger) EntryByKey(_ context.Context, k string) (*ledger.Entry, bool, error) {
	if l.keys[k] {
		return &ledger.Entry{}, true, nil
	}
	return nil, false, nil
}

func acct(co, ccy string) ledger.AccountBalance {
	return ledger.AccountBalance{AccountID: "acct-" + co, Type: ledger.AccountType("fees_unswept:" + co + ":" + ccy), BalanceKobo: 1}
}

func accrual(acctID, tid, svc string, amt int64) ledger.Entry {
	return ledger.Entry{AccountID: acctID, Type: ledger.EntryCredit, AmountKobo: amt,
		Reference:      "cb:fees_unswept:" + tid + ":" + svc,
		IdempotencyKey: "cb:" + tid + ":platform_fee:" + svc + ":unswept:credit"}
}

type fakeSettler struct {
	fees    map[string]*feeState // transferID
	settled []string
	failFor map[string]bool
	asked   int
}
type feeState struct {
	amount  int64
	pending bool
}

func (s *fakeSettler) PendingFee(_ context.Context, tid, _ string) (int64, bool, error) {
	s.asked++
	f, ok := s.fees[tid]
	if !ok {
		return 0, false, errors.New("not recognised")
	}
	return f.amount, f.pending, nil
}
func (s *fakeSettler) SettleFee(_ context.Context, tid, _, _ string) error {
	if s.failFor[tid] {
		return errors.New("settle boom")
	}
	s.fees[tid].pending = false
	s.settled = append(s.settled, tid)
	return nil
}

type fakeXfer struct {
	byPayment map[string]vertofx.WalletTransfer
	calls     int
	amounts   map[string]int64
	failFrom  map[string]bool
}

func newXfer() *fakeXfer {
	return &fakeXfer{byPayment: map[string]vertofx.WalletTransfer{}, amounts: map[string]int64{}, failFrom: map[string]bool{}}
}
func (x *fakeXfer) WalletToWallet(_ context.Context, from, to, ccy string, amt int64, pid string) (vertofx.WalletTransfer, error) {
	x.calls++
	if x.failFrom[from] {
		return vertofx.WalletTransfer{}, errors.New("verto down")
	}
	if to != "w-master" || ccy != "NGN" {
		return vertofx.WalletTransfer{}, fmt.Errorf("bad to/ccy %s %s", to, ccy)
	}
	if t, ok := x.byPayment[pid]; ok { // Verto idempotency by paymentID
		return t, nil
	}
	t := vertofx.WalletTransfer{ID: "tr-" + pid, PaymentID: pid}
	x.byPayment[pid] = t
	x.amounts[pid] = amt
	return t, nil
}

func wallets(_ context.Context, company, ccy string) (string, error) {
	if company == "master-co" {
		return "w-master", nil
	}
	return "w-" + company, nil
}

func newSweeper(enabled bool, l *sweepLedger, s *fakeSettler, x *fakeXfer) *fees.Sweeper {
	return fees.NewSweeper(fees.SweeperConfig{Enabled: enabled, MasterCompanyID: "master-co"}, l, s, x, wallets)
}

func twoItemLedger() (*sweepLedger, *fakeSettler) {
	l := &sweepLedger{
		accts: []ledger.AccountBalance{acct(coA, "NGN")},
		entries: map[string][]ledger.Entry{"acct-" + coA: {
			accrual("acct-"+coA, "t1", "send", 5000),
			accrual("acct-"+coA, "t2", "fx", 700),
		}},
		keys: map[string]bool{},
	}
	s := &fakeSettler{fees: map[string]*feeState{"t1": {5000, true}, "t2": {700, true}}, failFor: map[string]bool{}}
	return l, s
}

func TestSweepFees_SweepsOnceAndSettles_IdempotentOnRerun(t *testing.T) {
	ctx := context.Background()
	l, s := twoItemLedger()
	x := newXfer()
	sw := newSweeper(true, l, s, x)

	res, err := sw.SweepFees(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if res.Swept != 2 || res.SweptMinor != 5700 || x.calls != 2 || len(s.settled) != 2 {
		t.Fatalf("res=%+v calls=%d settled=%v", res, x.calls, s.settled)
	}
	if x.amounts["cb:t1:platform_fee:send:unswept:sweep"] != 5000 {
		t.Fatalf("amounts=%v", x.amounts)
	}
	res2, err := sw.SweepFees(ctx) // ledger fake still shows the entries
	if err != nil {
		t.Fatal(err)
	}
	if res2.Swept != 0 || x.calls != 2 || len(s.settled) != 2 {
		t.Fatalf("re-run double swept: res=%+v calls=%d settled=%v", res2, x.calls, s.settled)
	}
}

func TestSweepFees_FlagOffIsNoop(t *testing.T) {
	l, s := twoItemLedger()
	x := newXfer()
	res, err := newSweeper(false, l, s, x).SweepFees(context.Background())
	if err != nil || res != (fees.SweepResult{}) || l.listed != 0 || x.calls != 0 || s.asked != 0 {
		t.Fatalf("flag off must touch nothing: res=%+v err=%v listed=%d", res, err, l.listed)
	}
}

func TestSweepFees_NothingUnsweptIsNoop(t *testing.T) {
	l := &sweepLedger{entries: map[string][]ledger.Entry{}, keys: map[string]bool{}}
	s := &fakeSettler{fees: map[string]*feeState{}}
	x := newXfer()
	res, err := newSweeper(true, l, s, x).SweepFees(context.Background())
	if err != nil || res.Swept != 0 || x.calls != 0 {
		t.Fatalf("res=%+v err=%v calls=%d", res, err, x.calls)
	}
}

func TestSweepFees_PartialFailureContinuesAndAggregates(t *testing.T) {
	ctx := context.Background()
	l := &sweepLedger{
		accts: []ledger.AccountBalance{acct(coA, "NGN"), acct(coB, "NGN")},
		entries: map[string][]ledger.Entry{
			"acct-" + coA: {accrual("acct-"+coA, "tA", "send", 1000)},
			"acct-" + coB: {accrual("acct-"+coB, "tB", "send", 2000)},
		},
		keys: map[string]bool{},
	}
	s := &fakeSettler{fees: map[string]*feeState{"tA": {1000, true}, "tB": {2000, true}}, failFor: map[string]bool{}}
	x := newXfer()
	x.failFrom["w-"+coA] = true
	sw := newSweeper(true, l, s, x)

	res, err := sw.SweepFees(ctx)
	if err == nil {
		t.Fatal("want aggregated error")
	}
	if res.Swept != 1 || res.Failed != 1 || len(s.settled) != 1 || s.settled[0] != "tB" {
		t.Fatalf("failed transfer must not be settled; res=%+v settled=%v", res, s.settled)
	}
	if !s.fees["tA"].pending {
		t.Fatal("tA must stay pending")
	}
	x.failFrom["w-"+coA] = false // recovery on the next run
	res, err = sw.SweepFees(ctx)
	if err != nil || res.Swept != 1 || len(s.settled) != 2 {
		t.Fatalf("recovery run: res=%+v err=%v settled=%v", res, err, s.settled)
	}
}

func TestSweepFees_SettleFailureRetriesWithSamePaymentID(t *testing.T) {
	ctx := context.Background()
	l, s := twoItemLedger()
	s.failFor["t1"] = true
	x := newXfer()
	sw := newSweeper(true, l, s, x)

	res, err := sw.SweepFees(ctx)
	if err == nil || res.Failed != 1 || res.Swept != 1 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	s.failFor["t1"] = false
	if _, err := sw.SweepFees(ctx); err != nil {
		t.Fatal(err)
	}
	if len(x.byPayment) != 2 {
		t.Fatalf("retry must reuse the same paymentID (no second transfer): %v", x.byPayment)
	}
	if len(s.settled) != 2 {
		t.Fatalf("settled=%v", s.settled)
	}
}

func TestSweepFees_SkipsReversedSettledAndLedgerSettledItems(t *testing.T) {
	ctx := context.Background()
	l, s := twoItemLedger()
	l.entries["acct-"+coA] = append(l.entries["acct-"+coA],
		accrual("acct-"+coA, "t3", "send", 900), // already has a settle leg in the ledger
		ledger.Entry{AccountID: "acct-" + coA, Type: ledger.EntryDebit, AmountKobo: 900, Reference: "cb:fees_unswept:settle:t3:send", IdempotencyKey: "x:debit"},
		ledger.Entry{AccountID: "acct-" + coA, Type: ledger.EntryReversalDebit, AmountKobo: 700, Reference: "rev", IdempotencyKey: "r:1"},
	)
	l.keys["cb:t3:platform_fee:send:unswept:settle:debit"] = true
	s.fees["t2"].pending = false // reversed/settled per the recogniser
	x := newXfer()
	res, err := newSweeper(true, l, s, x).SweepFees(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if res.Swept != 1 || x.calls != 1 || res.Skipped != 1 {
		t.Fatalf("res=%+v calls=%d", res, x.calls)
	}
	if s.asked != 2 { // t1, t2 only: ledger-settled t3 is prefiltered
		t.Fatalf("ledger-settled t3 must be prefiltered, asked=%d", s.asked)
	}
}

func TestSweepFees_NonNGNAccountFailsClosed(t *testing.T) {
	l := &sweepLedger{
		accts:   []ledger.AccountBalance{acct(coA, "USD")},
		entries: map[string][]ledger.Entry{"acct-" + coA: {accrual("acct-"+coA, "t1", "send", 100)}},
		keys:    map[string]bool{},
	}
	s := &fakeSettler{fees: map[string]*feeState{"t1": {100, true}}}
	x := newXfer()
	res, err := newSweeper(true, l, s, x).SweepFees(context.Background())
	if err == nil || x.calls != 0 || res.Failed != 1 {
		t.Fatalf("res=%+v err=%v calls=%d", res, err, x.calls)
	}
}

func TestSweepFees_PagesThroughLargeAccounts(t *testing.T) {
	l := &sweepLedger{accts: []ledger.AccountBalance{acct(coA, "NGN")}, entries: map[string][]ledger.Entry{}, keys: map[string]bool{}}
	s := &fakeSettler{fees: map[string]*feeState{}, failFor: map[string]bool{}}
	for i := 0; i < 1203; i++ {
		tid := fmt.Sprintf("t%d", i)
		l.entries["acct-"+coA] = append(l.entries["acct-"+coA], accrual("acct-"+coA, tid, "send", 10))
		s.fees[tid] = &feeState{10, true}
	}
	x := newXfer()
	res, err := newSweeper(true, l, s, x).SweepFees(context.Background())
	if err != nil || res.Swept != 1203 {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}
