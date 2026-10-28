package healthlab

import (
	"context"
	"errors"
	"testing"
	"time"
)

// fakeRail models the crypto holding + NGN wallet + escrow as a balanced ledger
// so the tests can assert conservation, not just call counts.
type fakeRail struct {
	priceKobo, scale int64
	holdingUnits     int64
	walletKobo       int64
	escrowKobo       int64
	sellErr          error
	priceErr         error
	sellFill         int64 // when >0, overrides the proceeds (adverse fill)
	sells            map[string]int64
	sellCalls        int
}

func newRail() *fakeRail {
	// 1 USDT = 1_500_00 kobo (N1,500), 6dp minor units.
	return &fakeRail{priceKobo: 150_000, scale: 1_000_000, holdingUnits: 100_000_000, sells: map[string]int64{}}
}

func (r *fakeRail) AssetPrice(_ context.Context, id string) (*CryptoAssetPrice, error) {
	if r.priceErr != nil {
		return nil, r.priceErr
	}
	return &CryptoAssetPrice{AssetID: id, Symbol: "USDT", PriceKobo: r.priceKobo, MinorUnitScale: r.scale}, nil
}

func (r *fakeRail) SellToWallet(_ context.Context, _ string, _ string, units int64, key string) (int64, error) {
	r.sellCalls++
	if r.sellErr != nil {
		return 0, r.sellErr
	}
	if cash, dup := r.sells[key]; dup {
		return cash, nil
	}
	if units > r.holdingUnits {
		return 0, errors.New("crypto: insufficient holdings")
	}
	cash := units * r.priceKobo / r.scale
	if r.sellFill > 0 {
		cash = r.sellFill
	}
	r.holdingUnits -= units
	r.walletKobo += cash
	r.sells[key] = cash
	return cash, nil
}

type harness struct {
	rail    *fakeRail
	orders  map[string]*Order // by idem key
	total   int64
	creates int
	audits  []string
	holdErr error
}

func (h *harness) deps() cryptoPayDeps {
	return cryptoPayDeps{
		payer: h.rail,
		quote: func(context.Context, CreateOrderInput) (*OrderQuote, error) {
			return &OrderQuote{TotalKobo: h.total}, nil
		},
		existing: func(_ context.Context, _, key string) (*Order, error) { return h.orders[key], nil },
		create: func(_ context.Context, pid string, in CreateOrderInput) (*Order, error) {
			h.creates++
			if h.holdErr != nil {
				return nil, h.holdErr
			}
			if h.rail.walletKobo < h.total { // escrow.Hold fails closed
				return nil, errors.New("insufficient funds")
			}
			h.rail.walletKobo -= h.total
			h.rail.escrowKobo += h.total
			esc := "esc-1"
			o := &Order{ID: "order-1", PatientID: pid, State: StateCreated, TotalKobo: h.total, EscrowID: &esc, IdempotencyKey: in.IdempotencyKey}
			h.orders[in.IdempotencyKey] = o
			return o, nil
		},
		now:   func() time.Time { return time.Unix(1_800_000_000, 0) },
		audit: func(_, action, _ string, _ map[string]any) { h.audits = append(h.audits, action) },
	}
}

func newHarness() *harness {
	return &harness{rail: newRail(), orders: map[string]*Order{}, total: 45_000_00} // N45,000
}

func baseInput(key string) CreateOrderInput {
	return CreateOrderInput{LabProviderID: "lab", CollectionMethod: CollectWalkIn, IdempotencyKey: key, TestIDs: []string{"t"}}
}

func TestCryptoQuote_UnitsRoundUpWithBuffer(t *testing.T) {
	h := newHarness()
	q, err := h.deps().priceQuote(context.Background(), baseInput(""), "usdt")
	if err != nil {
		t.Fatal(err)
	}
	// 4_500_000 kobo / 150_000 per USDT = 30 USDT = 30_000_000 units; +0.5% = 30_150_000.
	if q.UnitsRequired != 30_150_000 {
		t.Fatalf("units = %d, want 30150000", q.UnitsRequired)
	}
	if q.TotalKobo != h.total || q.PriceKobo != h.rail.priceKobo {
		t.Fatalf("quote figures wrong: %+v", q)
	}
	if got := q.ExpiresAt.Sub(q.QuotedAt); got != CryptoQuoteTTL {
		t.Fatalf("ttl = %v", got)
	}
}

func TestCryptoQuote_CeilNeverUnderfunds(t *testing.T) {
	u, err := unitsForKoboCeil(1, 3, 10) // 3.33 -> 4
	if err != nil || u != 4 {
		t.Fatalf("got %d,%v want 4", u, err)
	}
	if _, err := unitsForKoboCeil(0, 3, 10); !errors.Is(err, ErrCryptoAsset) {
		t.Fatalf("zero kobo must be refused, got %v", err)
	}
}

func TestCryptoQuote_NoPayerIsUnavailable(t *testing.T) {
	d := newHarness().deps()
	d.payer = nil
	if _, err := d.priceQuote(context.Background(), baseInput(""), "usdt"); !errors.Is(err, ErrCryptoUnavailable) {
		t.Fatalf("got %v", err)
	}
}

func TestCryptoQuote_UnknownAssetRefused(t *testing.T) {
	h := newHarness()
	h.rail.priceErr = errors.New("not found")
	if _, err := h.deps().priceQuote(context.Background(), baseInput(""), "nope"); !errors.Is(err, ErrCryptoAsset) {
		t.Fatalf("got %v", err)
	}
}

func TestCryptoPay_HappyPathConservesValueAndHoldsEscrow(t *testing.T) {
	h := newHarness()
	res, err := h.deps().pay(context.Background(), "p1", baseInput("k1"), "usdt", 31_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if res.Order.State != StateCreated || res.Order.EscrowID == nil {
		t.Fatalf("order must be born paid (CREATED + escrow bound): %+v", res.Order)
	}
	if h.rail.escrowKobo != h.total {
		t.Fatalf("escrow holds %d, want order total %d", h.rail.escrowKobo, h.total)
	}
	// NGN conservation: proceeds = escrow + wallet remainder (buffer excess stays with the patient).
	if res.ProceedsKb != h.rail.escrowKobo+h.rail.walletKobo {
		t.Fatalf("proceeds %d != escrow %d + wallet %d", res.ProceedsKb, h.rail.escrowKobo, h.rail.walletKobo)
	}
	if h.rail.holdingUnits != 100_000_000-res.UnitsSold {
		t.Fatalf("holding not debited by units sold")
	}
	if len(h.audits) != 1 || h.audits[0] != "health.lab.crypto.pay" {
		t.Fatalf("audit = %v", h.audits)
	}
}

func TestCryptoPay_ReplayDoesNotSellTwice(t *testing.T) {
	h := newHarness()
	d := h.deps()
	if _, err := d.pay(context.Background(), "p1", baseInput("k1"), "usdt", 31_000_000); err != nil {
		t.Fatal(err)
	}
	res, err := d.pay(context.Background(), "p1", baseInput("k1"), "usdt", 31_000_000)
	if err != nil || !res.Replayed {
		t.Fatalf("want replay, got %+v %v", res, err)
	}
	if h.rail.sellCalls != 1 || h.creates != 1 {
		t.Fatalf("sells=%d creates=%d, want 1/1", h.rail.sellCalls, h.creates)
	}
}

func TestCryptoPay_RetryAfterFailedHoldReusesSellKey(t *testing.T) {
	h := newHarness()
	d := h.deps()
	h.holdErr = errors.New("tier limit")
	if _, err := d.pay(context.Background(), "p1", baseInput("k1"), "usdt", 31_000_000); err == nil {
		t.Fatal("want error")
	}
	h.holdErr = nil
	if _, err := d.pay(context.Background(), "p1", baseInput("k1"), "usdt", 31_000_000); err != nil {
		t.Fatal(err)
	}
	if len(h.rail.sells) != 1 {
		t.Fatalf("same Idempotency-Key must map to ONE sell, got %d", len(h.rail.sells))
	}
}

func TestCryptoPay_QuoteMovedRefusedBeforeAnyMoney(t *testing.T) {
	h := newHarness()
	// patient agreed to spend 30.0M units; the price now needs 30.15M.
	_, err := h.deps().pay(context.Background(), "p1", baseInput("k1"), "usdt", 30_000_000)
	if !errors.Is(err, ErrCryptoQuoteMoved) {
		t.Fatalf("got %v", err)
	}
	if h.rail.sellCalls != 0 || h.creates != 0 {
		t.Fatal("no money may move on an expired/moved quote")
	}
}

func TestCryptoPay_InsufficientHoldingsNoOrder(t *testing.T) {
	h := newHarness()
	h.rail.holdingUnits = 1_000_000
	_, err := h.deps().pay(context.Background(), "p1", baseInput("k1"), "usdt", 31_000_000)
	if err == nil || h.creates != 0 || h.rail.escrowKobo != 0 {
		t.Fatalf("want sell failure and no order, err=%v creates=%d", err, h.creates)
	}
}

func TestCryptoPay_SwapFailureNoOrder(t *testing.T) {
	h := newHarness()
	h.rail.sellErr = errors.New("provider down")
	_, err := h.deps().pay(context.Background(), "p1", baseInput("k1"), "usdt", 31_000_000)
	if err == nil || h.creates != 0 || h.rail.walletKobo != 0 {
		t.Fatalf("err=%v creates=%d wallet=%d", err, h.creates, h.rail.walletKobo)
	}
}

func TestCryptoPay_ShortfallLeavesFundsInWalletAndNoOrder(t *testing.T) {
	h := newHarness()
	h.rail.sellFill = h.total - 1
	_, err := h.deps().pay(context.Background(), "p1", baseInput("k1"), "usdt", 31_000_000)
	if !errors.Is(err, ErrCryptoShortfall) {
		t.Fatalf("got %v", err)
	}
	if h.creates != 0 || h.rail.walletKobo != h.total-1 || h.rail.escrowKobo != 0 {
		t.Fatalf("proceeds must sit in the wallet: creates=%d wallet=%d", h.creates, h.rail.walletKobo)
	}
	if len(h.audits) != 1 || h.audits[0] != "health.lab.crypto.shortfall" {
		t.Fatalf("audit = %v", h.audits)
	}
}

func TestCryptoPay_ExpectedTotalMismatchRefusedBeforeSell(t *testing.T) {
	h := newHarness()
	in := baseInput("k1")
	stale := h.total - 100
	in.ExpectedTotalKobo = &stale
	_, err := h.deps().pay(context.Background(), "p1", in, "usdt", 31_000_000)
	if !errors.Is(err, ErrQuoteChanged) || h.rail.sellCalls != 0 {
		t.Fatalf("err=%v sells=%d", err, h.rail.sellCalls)
	}
}

func TestCryptoPay_RequiresIdempotencyKeyAndMaxUnits(t *testing.T) {
	h := newHarness()
	if _, err := h.deps().pay(context.Background(), "p1", baseInput(""), "usdt", 31_000_000); err == nil {
		t.Fatal("missing idempotency key must be refused")
	}
	if _, err := h.deps().pay(context.Background(), "p1", baseInput("k1"), "usdt", 0); err == nil {
		t.Fatal("missing max_units must be refused")
	}
	if h.rail.sellCalls != 0 {
		t.Fatal("no sell on invalid input")
	}
}
