package pricing

import (
	"context"
	"errors"
	"math/big"
	"math/rand"
	"testing"
	"time"

	"spotlight/backend/internal/orchestration"
)

var t0 = time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC)

func rule(id string, lvl Level, mut func(*FeeRule)) FeeRule {
	r := FeeRule{
		ID: id, Level: lvl, PayerMode: PayerFeeOnTop, Status: StatusActive,
		Maker: "alice", Checker: "bob",
		Fee: FeeSpec{FlatMinor: 100, PctBPS: 50}, AmountMin: 100_000,
	}
	if mut != nil {
		mut(&r)
	}
	return r
}

func testCosts() RateCard {
	return RateCard{Entries: []CostEntry{{Service: "", FlatMinor: 10, PctBPS: 10}}}
}

func testGuard() Guardrails {
	return Guardrails{FloorMarginMinor: 5, HardCapBPS: 500}
}

func newResolver(t *testing.T, rules ...FeeRule) *Resolver {
	t.Helper()
	r, err := NewResolver(FeeSchedule{Rules: rules}, orchestration.NewSpreadEngine(20), testCosts(), testGuard(), 750)
	if err != nil {
		t.Fatalf("NewResolver: %v", err)
	}
	return r
}

func baseInput() PricingInput {
	return PricingInput{
		Service: "SEND", Direction: "OUT", Corridor: "NGN-USD", Rail: "SWIFT",
		Plan: "PRO", Tier: "tier2", Amount: NewMoney(1_000_000, "NGN"),
		FXApplies: true, At: t0,
	}
}

func TestResolve_MostSpecificWins(t *testing.T) {
	universal := rule("univ", LevelUniversal, nil)
	corridor := rule("corr", LevelCorridorService, func(r *FeeRule) { r.Service = "SEND"; r.Corridor = "NGN-USD" })
	planBand := rule("band", LevelPlanBand, func(r *FeeRule) {
		r.Service, r.Corridor, r.Plan = "SEND", "NGN-USD", "PRO"
		r.AmountMin, r.AmountMax = 100_000, 5_000_000
	})
	negotiated := rule("neg", LevelNegotiated, func(r *FeeRule) { r.SubjectID = "cust-1"; r.Service = "SEND" })
	promo := rule("promo", LevelPromo, func(r *FeeRule) { r.SubjectID = "cust-1" })
	override := rule("ovr", LevelOverride, func(r *FeeRule) { r.SubjectID = "tx-9" })

	cases := []struct {
		name  string
		rules []FeeRule
		mut   func(*PricingInput)
		want  string
	}{
		{"universal only", []FeeRule{universal}, nil, "univ"},
		{"corridor beats universal", []FeeRule{universal, corridor}, nil, "corr"},
		{"plan band beats corridor", []FeeRule{universal, corridor, planBand}, nil, "band"},
		{"band skipped when amount outside", []FeeRule{universal, corridor, planBand}, func(in *PricingInput) { in.Amount = NewMoney(9_000_000, "NGN") }, "corr"},
		{"negotiated beats band", []FeeRule{corridor, planBand, negotiated}, func(in *PricingInput) { in.SubjectID = "cust-1" }, "neg"},
		{"promo beats negotiated", []FeeRule{planBand, negotiated, promo}, func(in *PricingInput) { in.SubjectID = "cust-1" }, "promo"},
		{"override beats all", []FeeRule{universal, planBand, negotiated, promo, override}, func(in *PricingInput) { in.SubjectID = "tx-9" }, "ovr"},
		{"subject mismatch ignored", []FeeRule{universal, promo}, func(in *PricingInput) { in.SubjectID = "other" }, "univ"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := baseInput()
			if c.mut != nil {
				c.mut(&in)
			}
			d, err := newResolver(t, c.rules...).Resolve(context.Background(), in)
			if err != nil {
				t.Fatalf("Resolve: %v", err)
			}
			if d.Rule.ID != c.want {
				t.Fatalf("winner = %s, want %s", d.Rule.ID, c.want)
			}
		})
	}

	t.Run("more specific within a level wins", func(t *testing.T) {
		a := rule("a", LevelCorridorService, func(r *FeeRule) { r.Service = "SEND" })
		b := rule("b", LevelCorridorService, func(r *FeeRule) { r.Service = "SEND"; r.Corridor = "NGN-USD" })
		d, err := newResolver(t, a, b).Resolve(context.Background(), baseInput())
		if err != nil || d.Rule.ID != "b" {
			t.Fatalf("got %v %v", d.Rule.ID, err)
		}
	})
	t.Run("equal precedence is ambiguous, fail closed", func(t *testing.T) {
		a := rule("a", LevelCorridorService, func(r *FeeRule) { r.Service = "SEND" })
		b := rule("b", LevelCorridorService, func(r *FeeRule) { r.Service = "SEND" })
		if _, err := newResolver(t, a, b).Resolve(context.Background(), baseInput()); !errors.Is(err, ErrAmbiguousRule) {
			t.Fatalf("err = %v", err)
		}
	})
	t.Run("inactive and expired rules ignored", func(t *testing.T) {
		draft := rule("draft", LevelOverride, func(r *FeeRule) { r.SubjectID = "tx-9"; r.Status = StatusDraft })
		expired := rule("exp", LevelPromo, func(r *FeeRule) { r.SubjectID = "tx-9"; r.ValidTo = t0.Add(-time.Hour) })
		in := baseInput()
		in.SubjectID = "tx-9"
		d, err := newResolver(t, rule("univ", LevelUniversal, nil), draft, expired).Resolve(context.Background(), in)
		if err != nil || d.Rule.ID != "univ" {
			t.Fatalf("got %v %v", d.Rule.ID, err)
		}
	})
	t.Run("no rule", func(t *testing.T) {
		if _, err := newResolver(t).Resolve(context.Background(), baseInput()); !errors.Is(err, ErrNoRule) {
			t.Fatalf("err = %v", err)
		}
	})
}

func TestResolve_ComposesQuote(t *testing.T) {
	// fee = 100 + 5000 = 5100 ; spread = ceil(1e6*20/1e4)=2000
	// cost = 10 + 1000 = 1010 ; tax = ceil(5100*750/1e4)=383
	d, err := newResolver(t, rule("univ", LevelUniversal, nil)).Resolve(context.Background(), baseInput())
	if err != nil {
		t.Fatal(err)
	}
	q := d.Quote
	if q.Revenue().AmountMinor != 7100 || q.Cost().AmountMinor != 1010 || q.EstProfit().AmountMinor != 6090 {
		t.Fatalf("rev=%v cost=%v profit=%v", q.Revenue(), q.Cost(), q.EstProfit())
	}
	if q.SenderPays().AmountMinor != 1_000_000+5100+383 || q.ReceiverGets().AmountMinor != 1_000_000 {
		t.Fatalf("pays=%v gets=%v", q.SenderPays(), q.ReceiverGets())
	}
	kinds := map[QuoteKind]int64{}
	for _, l := range q.Lines() {
		kinds[l.Kind] += l.Amount.AmountMinor
	}
	if kinds[KindPlatformFee] != 5100 || kinds[KindFXSpread] != 2000 || kinds[KindVertoCost] != 1010 || kinds[KindTax] != 383 {
		t.Fatalf("lines = %v", kinds)
	}
	// immutability: mutating the returned slice does not alter the quote
	ls := q.Lines()
	ls[0].Amount.AmountMinor = -1
	if q.Lines()[0].Amount.AmountMinor == -1 {
		t.Fatal("quote lines are mutable")
	}
}

func TestResolve_PayerModes(t *testing.T) {
	// fee = 101 + 5000 = 5101 ; tax = ceil(5101*750/1e4) = 383 (sender-borne)
	for _, tc := range []struct {
		mode        PayerMode
		pays, gets  int64
		senderFee   int64
		receiverFee int64
	}{
		{PayerFeeOnTop, 1_000_000 + 5101 + 383, 1_000_000, 5101, 0},
		{PayerFeeIncluded, 1_000_000 + 383, 1_000_000 - 5101, 0, 5101},
		{PayerSplit, 1_000_000 + 2551 + 383, 1_000_000 - 2550, 2551, 2550},
	} {
		r := rule("r", LevelUniversal, func(r *FeeRule) { r.PayerMode = tc.mode; r.Fee = FeeSpec{FlatMinor: 101, PctBPS: 50} })
		d, err := newResolver(t, r).Resolve(context.Background(), baseInput())
		if err != nil {
			t.Fatal(err)
		}
		q := d.Quote
		var sf, rf int64
		for _, l := range q.Lines() {
			if l.Kind == KindPlatformFee && l.Payer == PayerSender {
				sf += l.Amount.AmountMinor
			}
			if l.Kind == KindPlatformFee && l.Payer == PayerReceiver {
				rf += l.Amount.AmountMinor
			}
		}
		if sf != tc.senderFee || rf != tc.receiverFee {
			t.Fatalf("%s: sender fee %d receiver fee %d", tc.mode, sf, rf)
		}
		if q.SenderPays().AmountMinor != tc.pays || q.ReceiverGets().AmountMinor != tc.gets {
			t.Fatalf("%s: pays %v gets %v", tc.mode, q.SenderPays(), q.ReceiverGets())
		}
	}
}

func TestGuardrail_RejectsBelowCostFloor(t *testing.T) {
	// Rule revenue at the low end of the band is below cost+floor:
	// amount 1_000 -> fee 100+5=105 (+spread 2) vs cost 10+1 + floor 5 => fine.
	// A zero-fee rule with zero spread engine cannot cover cost.
	cheap := rule("cheap", LevelUniversal, func(r *FeeRule) { r.Fee = FeeSpec{FlatMinor: 0, PctBPS: 1} })
	zeroSpread, err := NewResolver(FeeSchedule{Rules: []FeeRule{cheap}}, orchestration.NewSpreadEngine(0), testCosts(), testGuard(), 0)
	if err != nil {
		t.Fatal(err)
	}
	_, err = zeroSpread.Resolve(context.Background(), baseInput())
	var ge *GuardrailError
	if !errors.Is(err, ErrBelowCostFloor) || !errors.As(err, &ge) {
		t.Fatalf("err = %v", err)
	}

	// Floor can fail at the band's lower edge even though the requested amount passes:
	// 0.5% + flat 0 on band [1, 10_000_000]: at amount 1, fee=ceil(.0001)=1, spread ceil(.002)=1 => 2 < cost(10+1)+5.
	edge := rule("edge", LevelUniversal, func(r *FeeRule) { r.Fee = FeeSpec{PctBPS: 100}; r.AmountMin, r.AmountMax = 1, 10_000_000 })
	if _, err := newResolver(t, edge).Resolve(context.Background(), baseInput()); !errors.Is(err, ErrBelowCostFloor) {
		t.Fatalf("band edge: err = %v", err)
	}

	// exactly at the floor passes: revenue == cost + floor.
	ok := rule("ok", LevelUniversal, func(r *FeeRule) { r.Fee = FeeSpec{FlatMinor: 100, PctBPS: 50} })
	if _, err := newResolver(t, ok).Resolve(context.Background(), baseInput()); err != nil {
		t.Fatalf("healthy rule rejected: %v", err)
	}

	// Unbounded band: percentage below cost percentage is caught asymptotically.
	slope := rule("slope", LevelUniversal, func(r *FeeRule) { r.Fee = FeeSpec{FlatMinor: 3_000, PctBPS: 0} })
	res, err := NewResolver(FeeSchedule{Rules: []FeeRule{slope}}, orchestration.NewSpreadEngine(0), testCosts(), testGuard(), 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := res.Resolve(context.Background(), baseInput()); !errors.Is(err, ErrBelowCostFloor) {
		t.Fatalf("unbounded band slope: err = %v", err)
	}
}

func TestGuardrail_RejectsAboveHardCap(t *testing.T) {
	// cap 500 bps of amount. 6% fee on 1_000_000 = 60_000 + spread > cap 50_000.
	greedy := rule("greedy", LevelUniversal, func(r *FeeRule) { r.Fee = FeeSpec{PctBPS: 600} })
	_, err := newResolver(t, greedy).Resolve(context.Background(), baseInput())
	if !errors.Is(err, ErrAboveHardCap) {
		t.Fatalf("err = %v", err)
	}
	// absolute cap
	g := Guardrails{FloorMarginMinor: 5, HardCapMinor: 1000}
	r, _ := NewResolver(FeeSchedule{Rules: []FeeRule{rule("u", LevelUniversal, nil)}}, orchestration.NewSpreadEngine(20), testCosts(), g, 0)
	if _, err := r.Resolve(context.Background(), baseInput()); !errors.Is(err, ErrAboveHardCap) {
		t.Fatalf("abs cap: err = %v", err)
	}
	// a small amount whose flat fee dominates breaches the bps cap at the band edge
	flat := rule("flat", LevelUniversal, func(r *FeeRule) { r.Fee = FeeSpec{FlatMinor: 5_000}; r.AmountMin, r.AmountMax = 1_000, 10_000_000 })
	if _, err := newResolver(t, flat).Resolve(context.Background(), baseInput()); !errors.Is(err, ErrAboveHardCap) {
		t.Fatalf("band edge cap: err = %v", err)
	}
	// no cap configured is a config error, fail closed
	if _, err := NewResolver(FeeSchedule{}, orchestration.NewSpreadEngine(20), testCosts(), Guardrails{}, 0); !errors.Is(err, ErrNoHardCap) {
		t.Fatalf("no cap: err = %v", err)
	}
}

func TestResolve_FailsClosedOnMissingCost(t *testing.T) {
	res, _ := NewResolver(FeeSchedule{Rules: []FeeRule{rule("u", LevelUniversal, nil)}}, orchestration.NewSpreadEngine(20), RateCard{}, testGuard(), 0)
	if _, err := res.Resolve(context.Background(), baseInput()); !errors.Is(err, ErrNoCost) {
		t.Fatalf("err = %v", err)
	}
}

func TestRounding_ReceiveDownPayUp(t *testing.T) {
	rng := rand.New(rand.NewSource(1))
	for i := 0; i < 5000; i++ {
		amt := rng.Int63n(1_000_000_000)
		bps := rng.Int63n(2000)
		down, err1 := BPSOf(amt, bps, RoundReceiveDown)
		up, err2 := BPSOf(amt, bps, RoundPayUp)
		if err1 != nil || err2 != nil {
			t.Fatal(err1, err2)
		}
		exact := amt * bps // fits: < 2e12
		if down*10_000 > exact || (down+1)*10_000 <= exact {
			t.Fatalf("down wrong amt=%d bps=%d got=%d", amt, bps, down)
		}
		if up*10_000 < exact || (up-1)*10_000 >= exact && up > 0 {
			t.Fatalf("up wrong amt=%d bps=%d got=%d", amt, bps, up)
		}
		if exact%10_000 == 0 && down != up {
			t.Fatalf("exact division must not differ: %d %d", down, up)
		}
	}

	// currency minor units: USD (2dp) -> JPY (0dp), JPY -> USD, KWD (3dp)
	rate := big.NewRat(15099, 100)                                                 // 150.99 JPY per USD
	got, err := ConvertMinor(NewMoney(1000, "USD"), "JPY", rate, RoundReceiveDown) // $10.00
	if err != nil || got.AmountMinor != 1509 || got.Currency != "JPY" {            // 1509.9 -> 1509
		t.Fatalf("recv down: %v %v", got, err)
	}
	got, _ = ConvertMinor(NewMoney(1000, "USD"), "JPY", rate, RoundPayUp)
	if got.AmountMinor != 1510 {
		t.Fatalf("pay up: %v", got)
	}
	got, _ = ConvertMinor(NewMoney(1000, "JPY"), "USD", big.NewRat(1, 150), RoundReceiveDown) // 6.666.. USD -> 666 cents
	if got.AmountMinor != 666 {
		t.Fatalf("jpy->usd down: %v", got)
	}
	got, _ = ConvertMinor(NewMoney(1000, "JPY"), "USD", big.NewRat(1, 150), RoundPayUp)
	if got.AmountMinor != 667 {
		t.Fatalf("jpy->usd up: %v", got)
	}
	got, _ = ConvertMinor(NewMoney(100, "USD"), "KWD", big.NewRat(3, 10), RoundReceiveDown) // $1 -> 0.300 KWD
	if got.AmountMinor != 300 {
		t.Fatalf("kwd: %v", got)
	}
	if _, err := BPSOf(1<<62, 20_000, RoundPayUp); !errors.Is(err, ErrOverflow) {
		t.Fatalf("overflow not detected: %v", err)
	}
}

func TestGrossUp_TargetAmount(t *testing.T) {
	rng := rand.New(rand.NewSource(2))
	for i := 0; i < 5000; i++ {
		f := FeeSpec{FlatMinor: rng.Int63n(5000), PctBPS: rng.Int63n(1500)}
		if i%3 == 0 { // clamped variants
			f.MinMinor = rng.Int63n(8000)
			f.MaxMinor = f.MinMinor + rng.Int63n(50_000) + 1
		}
		target := rng.Int63n(50_000_000)

		// Direction 1: receiver must get exactly T => S = T + fee(T); forward check exact.
		s, err := SenderTotalForTarget(target, f)
		if err != nil {
			t.Fatal(err)
		}
		fee, _ := f.Compute(target)
		if s != target+fee || s-fee != target {
			t.Fatalf("gross-up not exact: %+v T=%d S=%d", f, target, s)
		}
		// Unclamped: S = T + flat + ceil(p*T) literally.
		if f.MinMinor == 0 && f.MaxMinor == 0 {
			pt, _ := BPSOf(target, f.PctBPS, RoundPayUp)
			if s != target+f.FlatMinor+pt {
				t.Fatalf("formula mismatch")
			}
		}

		// Direction 2: sender fixed total S => largest T with T+fee(T) <= S.
		tt, err := TargetFromSenderTotal(s, f)
		if err != nil {
			t.Fatal(err)
		}
		if tt != target {
			// fee non-strictly-monotone plateaus can admit a larger T for the same S; verify maximality instead
			if tt < target {
				t.Fatalf("lost value: %+v S=%d T=%d got=%d", f, s, target, tt)
			}
		}
		ft, _ := f.Compute(tt)
		fn, _ := f.Compute(tt + 1)
		if tt+ft > s || (tt+1)+fn <= s {
			t.Fatalf("not maximal/valid: %+v S=%d T=%d", f, s, tt)
		}
		// arbitrary sender totals too
		s2 := rng.Int63n(60_000_000)
		t2, err := TargetFromSenderTotal(s2, f)
		if err != nil {
			t.Fatal(err)
		}
		f2, _ := f.Compute(t2)
		f3, _ := f.Compute(t2 + 1)
		if s2 >= func() int64 { v, _ := f.Compute(0); return v }() {
			if t2+f2 > s2 || (t2+1)+f3 <= s2 {
				t.Fatalf("arbitrary S not maximal: %+v S=%d T=%d", f, s2, t2)
			}
		} else if t2 != 0 {
			t.Fatalf("S below min fee should yield 0, got %d", t2)
		}
	}
	// Unclamped closed form: T = floor((S-flat)/(1+p)).
	f := FeeSpec{FlatMinor: 100, PctBPS: 100}  // 1%
	got, _ := TargetFromSenderTotal(10_100, f) // (10_100-100)/1.01 = 9900.99 -> 9900
	if got != 9900 {
		t.Fatalf("closed form: %d", got)
	}
}
