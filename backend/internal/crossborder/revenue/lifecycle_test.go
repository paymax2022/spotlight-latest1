package revenue_test

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/crossborder/fees"
	"spotlight/backend/internal/crossborder/revenue"
	"spotlight/backend/internal/finance/ledger"
)

const wantSpreadNGN = int64(2600 * 1500) // (2500 spread + 100 fixed) USD cents * 1500 kobo

func TestRecognizeFXSpread_AccrualOnly_NoCommissionYet(t *testing.T) {
	ctx := context.Background()
	r, l, c := setup()
	for i := 0; i < 3; i++ { // redelivery
		if err := r.RecognizeFXSpread(ctx, spreadTrade()); err != nil {
			t.Fatal(err)
		}
	}
	if c.calls != 0 {
		t.Fatalf("accrual must not touch commission (immutable row + referral hook), got %d calls", c.calls)
	}
	// Receivable accrual mirrors revenue once (no double count across redeliveries).
	if got := l.balances[l.id(ledger.AccountRevenueFxMarkup)]; got != wantSpreadNGN {
		t.Fatalf("revenue:fx_markup = %d, want %d", got, wantSpreadNGN)
	}
	if got := l.balances[l.id(ledger.AccountReceivableVertoMarkup)]; got != -wantSpreadNGN {
		t.Fatalf("receivable:verto_markup = %d, want %d", got, -wantSpreadNGN)
	}
	rec, ok, _ := r.Record(ctx, "t1", revenue.ComponentFXSpread)
	if !ok || rec.Currency != "USD" || rec.NativeMinor != 2600 || rec.Rate != usdNGN || rec.State != revenue.StateAccrued || rec.NGNMinor != wantSpreadNGN {
		t.Fatalf("bad native record %+v ok=%v", rec, ok)
	}
}

func TestRecognizeFXSpread_NonNGNWithoutRateFailsClosed_NGNIsOneToOne(t *testing.T) {
	ctx := context.Background()
	r, l, c := setup()
	tr := spreadTrade()
	tr.Rate = revenue.Rate{}
	if err := r.RecognizeFXSpread(ctx, tr); !errors.Is(err, revenue.ErrNoNGNRate) {
		t.Fatalf("want ErrNoNGNRate, got %v", err)
	}
	if c.calls != 0 || len(l.entries) != 0 {
		t.Fatal("nothing may post without a rate")
	}
	ngn := revenue.FXSpreadTrade{TransferID: "t2", Service: "send", Currency: "NGN", SpreadMinor: 700, GrossMinor: 10_000}
	if err := r.RecognizeFXSpread(ctx, ngn); err != nil {
		t.Fatal(err)
	}
	if err := r.MarkSettled(ctx, "t2", revenue.ComponentFXSpread, revenue.Settlement{}); err != nil {
		t.Fatal(err)
	}
	if c.rows["cb:t2:fx_spread:send"].SpotlightRevenueKobo != 700 {
		t.Fatal("NGN spread should roll up 1:1")
	}
}

func TestRecognizeFXSpread_ZeroIsNoop(t *testing.T) {
	r, l, c := setup()
	tr := spreadTrade()
	tr.SpreadMinor, tr.FixedMinor = 0, 0
	if err := r.RecognizeFXSpread(context.Background(), tr); err != nil {
		t.Fatal(err)
	}
	if c.calls != 0 || len(l.entries) != 0 {
		t.Fatal("zero spread must not post")
	}
}

func chargedFee() fees.Result {
	return fees.Result{Strategy: fees.StrategyLedgerCharge, Charged: true, AmountMinor: 5000,
		FeeKey: "cb:t1:platform_fee:send", UnsweptKey: "cb:t1:platform_fee:send:unswept",
		WalletAccountID: "wallet-1", RevenueAccountID: "rev-send", UnsweptAccountID: "unswept-1"}
}

func feeCharge() revenue.PlatformFeeCharge {
	return revenue.PlatformFeeCharge{TransferID: "t1", Service: "send", UserID: "u1", Currency: "NGN", AmountMinor: 5000, Result: chargedFee()}
}

func TestRecognizePlatformFee_StrategyCNotRecognised_ChargedAccruesWithoutCommission(t *testing.T) {
	ctx := context.Background()
	r, _, c := setup()
	for i := 0; i < 2; i++ {
		if err := r.RecognizePlatformFee(ctx, feeCharge()); err != nil {
			t.Fatal(err)
		}
	}
	if c.calls != 0 {
		t.Fatal("fee accrual must not touch commission")
	}
	cc := feeCharge()
	cc.TransferID = "t9"
	cc.Result = fees.Result{Strategy: fees.StrategySpreadBaked, IntentRecorded: true, AmountMinor: 5000}
	if err := r.RecognizePlatformFee(ctx, cc); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := r.Record(ctx, "t9", revenue.ComponentPlatformFee); ok {
		t.Fatal("strategy C (Charged==false) must not be recognised")
	}
}

func TestMarkSettled_PostsCommissionExactlyOnce(t *testing.T) {
	ctx := context.Background()
	r, l, c := setup()
	l.postCollector()
	_ = r.RecognizeFXSpread(ctx, spreadTrade())
	_ = r.RecognizePlatformFee(ctx, feeCharge())

	for i := 0; i < 3; i++ { // idempotent
		if err := r.MarkSettled(ctx, "t1", revenue.ComponentFXSpread, revenue.Settlement{Reference: "verto-stmt-1"}); err != nil {
			t.Fatal(err)
		}
	}
	e := c.rows["cb:t1:fx_spread:fx"]
	if e == nil || len(c.rows) != 1 {
		t.Fatalf("want exactly one commission row cb:t1:fx_spread:fx, got %v", c.rows)
	}
	if e.SpotlightRevenueKobo != wantSpreadNGN || e.GrossAmountKobo != 100_00*1500 || e.SourceRef != "t1" || e.SourceModule != "crossborder" || e.ServiceSubtype != "fx_spread" {
		t.Fatalf("bad commission row %+v", e)
	}
	if got := l.balances[l.id(ledger.AccountReceivableVertoMarkup)]; got != 0 {
		t.Fatalf("receivable after settle = %d, want 0", got)
	}
	if rec, _, _ := r.Record(ctx, "t1", revenue.ComponentFXSpread); rec.State != revenue.StateSettled {
		t.Fatalf("state %s", rec.State)
	}

	if err := r.MarkSettled(ctx, "t1", revenue.ComponentPlatformFee, revenue.Settlement{Reference: "sweep-1"}); err != nil {
		t.Fatal(err)
	}
	fe := c.rows["cb:t1:platform_fee:send"]
	if fe == nil || len(c.rows) != 2 || fe.SpotlightRevenueKobo != 5000 {
		t.Fatalf("want fee row of 5000, got %v", c.rows)
	}
	if l.balances["unswept-1"] != 0 {
		t.Fatalf("fees_unswept not drained on settle: %d", l.balances["unswept-1"])
	}
	if err := r.MarkSettled(ctx, "nope", revenue.ComponentFXSpread, revenue.Settlement{}); !errors.Is(err, revenue.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestReverseBeforeSettlement_NoCommissionRowEver(t *testing.T) {
	ctx := context.Background()
	r, l, c := setup()
	l.postCollector()
	_ = r.RecognizeFXSpread(ctx, spreadTrade())
	_ = r.RecognizePlatformFee(ctx, feeCharge())

	for i := 0; i < 2; i++ {
		if err := r.Reverse(ctx, "t1", "refund"); err != nil {
			t.Fatal(err)
		}
	}
	if c.calls != 0 || len(c.rows) != 0 {
		t.Fatalf("reversed-before-settlement must leave NO commission row (and no referral hook), got %d calls", c.calls)
	}
	if l.balances[l.id(ledger.AccountRevenueFxMarkup)] != 0 || l.balances[l.id(ledger.AccountReceivableVertoMarkup)] != 0 {
		t.Fatal("spread accrual not reversed")
	}
	if l.balances["wallet-1"] != 0 || l.balances["rev-send"] != 0 || l.balances["unswept-1"] != 0 {
		t.Fatalf("platform fee not fully reversed: wallet=%d rev=%d unswept=%d", l.balances["wallet-1"], l.balances["rev-send"], l.balances["unswept-1"])
	}
	for _, comp := range []revenue.Component{revenue.ComponentFXSpread, revenue.ComponentPlatformFee} {
		if rec, _, _ := r.Record(ctx, "t1", comp); rec.State != revenue.StateReversed {
			t.Fatalf("%s state %s", comp, rec.State)
		}
	}
	// A reversed component can no longer settle (and so can never reach commission).
	if err := r.MarkSettled(ctx, "t1", revenue.ComponentFXSpread, revenue.Settlement{}); !errors.Is(err, revenue.ErrInvalidState) {
		t.Fatalf("want ErrInvalidState, got %v", err)
	}
	if c.calls != 0 {
		t.Fatal("commission touched after reversal")
	}
}

func TestReverse_SettledComponentFailsClosed_NothingPartial(t *testing.T) {
	ctx := context.Background()
	r, l, _ := setup()
	l.postCollector()
	_ = r.RecognizeFXSpread(ctx, spreadTrade())
	_ = r.RecognizePlatformFee(ctx, feeCharge())
	_ = r.MarkSettled(ctx, "t1", revenue.ComponentFXSpread, revenue.Settlement{Reference: "s"})

	if err := r.Reverse(ctx, "t1", "refund"); !errors.Is(err, revenue.ErrSettledNotUndone) {
		t.Fatalf("want ErrSettledNotUndone, got %v", err)
	}
	if l.balances["wallet-1"] != -5000 {
		t.Fatal("partial reversal: fee was reversed although spread could not be")
	}
}

func TestReverse_NothingRecognised(t *testing.T) {
	r, _, _ := setup()
	if err := r.Reverse(context.Background(), "ghost", "x"); err != nil {
		t.Fatalf("nothing to reverse should be a no-op, got %v", err)
	}
}

// --- restart survival: Store.Get miss => rebuilt from the durable ledger ---

func accruedBoth(t *testing.T) (*fakeLedger, *fakeCommission) {
	t.Helper()
	r, l, c := setup()
	l.postCollector()
	if err := r.RecognizeFXSpread(context.Background(), spreadTrade()); err != nil {
		t.Fatal(err)
	}
	if err := r.RecognizePlatformFee(context.Background(), feeCharge()); err != nil {
		t.Fatal(err)
	}
	return l, c
}

func TestRestart_MarkSettledRebuildsFromLedger(t *testing.T) {
	ctx := context.Background()
	l, c := accruedBoth(t)
	r2 := revenue.NewRecognizer(l, c, revenue.NewMemStore()) // restarted process: empty store

	if err := r2.MarkSettled(ctx, "t1", revenue.ComponentFXSpread, revenue.Settlement{Reference: "stmt"}); err != nil {
		t.Fatalf("settle after restart: %v", err)
	}
	e := c.rows["cb:t1:fx_spread:fx"]
	if e == nil || e.SpotlightRevenueKobo != wantSpreadNGN || e.GrossAmountKobo != 100_00*1500 {
		t.Fatalf("rebuilt record rolled up wrongly: %+v", e)
	}
	if err := r2.MarkSettled(ctx, "t1", revenue.ComponentPlatformFee, revenue.Settlement{Reference: "sweep"}); err != nil {
		t.Fatalf("fee settle after restart: %v", err)
	}
	if c.rows["cb:t1:platform_fee:send"].SpotlightRevenueKobo != 5000 || l.balances["unswept-1"] != 0 {
		t.Fatal("fee not settled correctly after rebuild")
	}
}

func TestRestart_ReverseRebuildsBothComponents(t *testing.T) {
	ctx := context.Background()
	l, c := accruedBoth(t)
	r2 := revenue.NewRecognizer(l, c, revenue.NewMemStore())

	if err := r2.Reverse(ctx, "t1", "refund"); err != nil {
		t.Fatalf("reverse after restart: %v", err)
	}
	if l.balances[l.id(ledger.AccountRevenueFxMarkup)] != 0 || l.balances[l.id(ledger.AccountReceivableVertoMarkup)] != 0 ||
		l.balances["wallet-1"] != 0 || l.balances["rev-send"] != 0 || l.balances["unswept-1"] != 0 {
		t.Fatal("both components must be reversed after a restart")
	}
	if c.calls != 0 {
		t.Fatal("no commission on a pre-settlement reversal")
	}
	// another restart: state derived as REVERSED from the reverse journals, repeat is a no-op
	r3 := revenue.NewRecognizer(l, c, revenue.NewMemStore())
	if err := r3.Reverse(ctx, "t1", "refund"); err != nil {
		t.Fatal(err)
	}
	if err := r3.MarkSettled(ctx, "t1", revenue.ComponentFXSpread, revenue.Settlement{}); !errors.Is(err, revenue.ErrInvalidState) {
		t.Fatalf("want ErrInvalidState after rebuild of reversed, got %v", err)
	}
}

func TestRestart_SettledStateDerivedFromLedger_ReverseRefuses(t *testing.T) {
	ctx := context.Background()
	l, c := accruedBoth(t)
	r2 := revenue.NewRecognizer(l, c, revenue.NewMemStore())
	if err := r2.MarkSettled(ctx, "t1", revenue.ComponentFXSpread, revenue.Settlement{}); err != nil {
		t.Fatal(err)
	}
	r3 := revenue.NewRecognizer(l, c, revenue.NewMemStore())
	if err := r3.Reverse(ctx, "t1", "late refund"); !errors.Is(err, revenue.ErrSettledNotUndone) {
		t.Fatalf("settled spread must stay settled across restarts, got %v", err)
	}
}

func TestRestart_UnknownTransferStillNotFound(t *testing.T) {
	l, c := accruedBoth(t)
	r2 := revenue.NewRecognizer(l, c, revenue.NewMemStore())
	if err := r2.MarkSettled(context.Background(), "ghost", revenue.ComponentFXSpread, revenue.Settlement{}); !errors.Is(err, revenue.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}

func TestNewRecognizer_RejectsLedgerBackedCommission(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("a commission service with a ledger would double-count revenue; must panic at construction")
		}
	}()
	revenue.NewRecognizer(newFake(), &ledgerBackedCommission{}, revenue.NewMemStore())
}
