package cryptoprov

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/shopspring/decimal"
)

func dec(s string) decimal.Decimal { return decimal.RequireFromString(s) }

// ---- error taxonomy -------------------------------------------------------

func TestClassification(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		definitive bool
		rateLimit  bool
		ambiguous  bool
	}{
		{"nil", nil, false, false, false},
		{"400 is definitive", &APIError{Status: 400}, true, false, false},
		{"404 is definitive", &APIError{Status: 404}, true, false, false},
		{"429 is definitive and rate limited", &APIError{Status: 429}, true, true, false},
		{"444 is definitive and rate limited", &APIError{Status: 444}, true, true, false},
		{"500 is ambiguous", &APIError{Status: 500}, false, false, true},
		{"503 is ambiguous", &APIError{Status: 503}, false, false, true},
		{"timeout is ambiguous", context.DeadlineExceeded, false, false, true},
		{"wrapped 422 is definitive", fmt.Errorf("wrap: %w", &APIError{Status: 422}), true, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsDefinitive(c.err); got != c.definitive {
				t.Errorf("IsDefinitive = %v, want %v", got, c.definitive)
			}
			if got := IsRateLimited(c.err); got != c.rateLimit {
				t.Errorf("IsRateLimited = %v, want %v", got, c.rateLimit)
			}
			if got := IsAmbiguous(c.err); got != c.ambiguous {
				t.Errorf("IsAmbiguous = %v, want %v", got, c.ambiguous)
			}
		})
	}
}

// ---- registry and capability lookup ---------------------------------------

func TestRegistryRejectsDuplicateAndReturnsActive(t *testing.T) {
	r := NewRegistry("mock")
	m := NewMock("mock", nil)
	if err := r.Register(m); err != nil {
		t.Fatal(err)
	}
	if err := r.Register(NewMock("mock", nil)); err == nil {
		t.Fatal("duplicate registration accepted")
	}
	p, err := r.Active()
	if err != nil || p.Name() != "mock" {
		t.Fatalf("Active = %v, %v", p, err)
	}
	if _, err := NewRegistry("quidax").Active(); !errors.Is(err, ErrProviderNotFound) {
		t.Fatalf("missing active err = %v", err)
	}
}

func TestAsReturnsUnsupportedForMissingCapability(t *testing.T) {
	var p Provider = bareProvider{}
	if _, err := As[SwapProvider](p); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("err = %v, want ErrUnsupported", err)
	}
	if _, err := As[SwapProvider](NewMock("m", nil)); err != nil {
		t.Fatalf("mock should support swaps: %v", err)
	}
}

type bareProvider struct{}

func (bareProvider) Name() string           { return "bare" }
func (bareProvider) AssetClass() AssetClass { return AssetClassCrypto }

// ---- mock provider: idempotency, expiry, fault injection ------------------

func TestMockConfirmSwapIsIdempotentPerQuote(t *testing.T) {
	m := NewMock("m", nil)
	m.SetPrice("BTCNGN", dec("90000000"))
	ctx := context.Background()
	q, err := m.QuoteSwap(ctx, SwapQuoteRequest{From: "BTC", To: "NGN", FromAmount: dec("0.001")})
	if err != nil {
		t.Fatal(err)
	}
	s1, err := m.ConfirmSwap(ctx, q.QuoteID)
	if err != nil {
		t.Fatal(err)
	}
	s2, err := m.ConfirmSwap(ctx, q.QuoteID)
	if err != nil {
		t.Fatal(err)
	}
	if s1.ID != s2.ID {
		t.Fatalf("double confirm created two swaps: %s vs %s", s1.ID, s2.ID)
	}
}

func TestMockQuoteExpiresAndConfirmFailsClosed(t *testing.T) {
	clock := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	m := NewMock("m", func() time.Time { return clock })
	m.SetPrice("USDTNGN", dec("1500"))
	ctx := context.Background()
	q, _ := m.QuoteSwap(ctx, SwapQuoteRequest{From: "USDT", To: "NGN", FromAmount: dec("10")})
	clock = clock.Add(16 * time.Second)
	_, err := m.ConfirmSwap(ctx, q.QuoteID)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Code != "quote_expired" || !IsDefinitive(err) {
		t.Fatalf("expired confirm err = %v", err)
	}
}

func TestMockQuoteRequiresExactlyOneSide(t *testing.T) {
	m := NewMock("m", nil)
	m.SetPrice("BTCNGN", dec("1"))
	_, err := m.QuoteSwap(context.Background(), SwapQuoteRequest{From: "BTC", To: "NGN"})
	if err == nil {
		t.Fatal("quote with neither side accepted")
	}
	_, err = m.QuoteSwap(context.Background(), SwapQuoteRequest{From: "BTC", To: "NGN", FromAmount: dec("1"), ToAmount: dec("1")})
	if err == nil {
		t.Fatal("quote with both sides accepted")
	}
}

func TestMockWithdrawReferenceIsIdempotent(t *testing.T) {
	m := NewMock("m", nil)
	ctx := context.Background()
	req := WithdrawRequest{Currency: "USDT", Amount: dec("5"), Reference: "wd:42"}
	a, _ := m.Withdraw(ctx, req)
	b, _ := m.Withdraw(ctx, req)
	if a.ID != b.ID {
		t.Fatalf("same reference produced two transfers: %s vs %s", a.ID, b.ID)
	}
	if _, err := m.Withdraw(ctx, WithdrawRequest{Amount: dec("5")}); err == nil {
		t.Fatal("withdraw without reference accepted")
	}
}

func TestMockFaultInjectionIsConsumedOnce(t *testing.T) {
	m := NewMock("m", nil)
	m.SetPrice("BTCNGN", dec("1"))
	boom := &APIError{Status: 503}
	m.FailNext("ticker", boom)
	if _, err := m.Ticker(context.Background(), "BTCNGN"); !errors.Is(err, boom) {
		t.Fatalf("first call err = %v", err)
	}
	if _, err := m.Ticker(context.Background(), "BTCNGN"); err != nil {
		t.Fatalf("fault should be consumed, second call err = %v", err)
	}
}

// ---- webhook signature ----------------------------------------------------

func sign(secret string, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "."))
	mac.Write(body)
	return fmt.Sprintf("t=%s,s=%s", ts, hex.EncodeToString(mac.Sum(nil)))
}

func TestVerifySignatureAcceptsValidRawBody(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	body := []byte(`{"event":"swap_transaction.completed","data":{"id":"sw_1"}}`)
	h := sign("whsec", "1800000000", body)
	if err := VerifyHMACSignature("whsec", h, body, now, DefaultReplayWindow); err != nil {
		t.Fatalf("valid signature rejected: %v", err)
	}
}

func TestVerifySignatureAcceptsCompactedBody(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	pretty := []byte("{\n  \"event\": \"order.done\"\n}")
	compact := []byte(`{"event":"order.done"}`)
	h := sign("whsec", "1800000000", compact)
	if err := VerifyHMACSignature("whsec", h, pretty, now, DefaultReplayWindow); err != nil {
		t.Fatalf("compacted-body signature rejected: %v", err)
	}
}

func TestVerifySignatureFailsClosed(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	body := []byte(`{"event":"withdraw.successful"}`)
	good := sign("whsec", "1800000000", body)
	cases := map[string]struct {
		secret, header string
		body           []byte
		now            time.Time
	}{
		"empty secret":          {"", good, body, now},
		"wrong secret":          {"other", good, body, now},
		"tampered body":         {"whsec", good, []byte(`{"event":"withdraw.rejected"}`), now},
		"stale timestamp":       {"whsec", good, body, now.Add(6 * time.Minute)},
		"future timestamp":      {"whsec", good, body, now.Add(-6 * time.Minute)},
		"missing s":             {"whsec", "t=1800000000", body, now},
		"missing t":             {"whsec", "s=abcd", body, now},
		"non-hex signature":     {"whsec", "t=1800000000,s=zz", body, now},
		"non-numeric timestamp": {"whsec", "t=abc,s=00", body, now},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if err := VerifyHMACSignature(c.secret, c.header, c.body, c.now, DefaultReplayWindow); !errors.Is(err, ErrBadSignature) {
				t.Fatalf("err = %v, want ErrBadSignature", err)
			}
		})
	}
}

func TestVerifySignatureAcceptsMillisecondTimestamp(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000)
	body := []byte(`{"event":"deposit.successful"}`)
	h := sign("whsec", "1800000000000", body)
	if err := VerifyHMACSignature("whsec", h, body, now, DefaultReplayWindow); err != nil {
		t.Fatalf("ms timestamp rejected: %v", err)
	}
}

// ---- swap state machine ---------------------------------------------------

func TestSwapHappyPathAndNeedsReviewResolution(t *testing.T) {
	steps := [][2]SwapState{
		{SwapStateQuoted, SwapStateConfirming},
		{SwapStateConfirming, SwapStateNeedsReview}, // network cut mid-confirm
		{SwapStateNeedsReview, SwapStateCompleted},  // reconciler found it executed
	}
	for _, s := range steps {
		if _, err := Transition(s[0], s[1]); err != nil {
			t.Fatalf("%s -> %s rejected: %v", s[0], s[1], err)
		}
	}
}

func TestTerminalSwapStatesNeverRegress(t *testing.T) {
	terminal := []SwapState{SwapStateCompleted, SwapStateFailed, SwapStateExpired}
	all := []SwapState{SwapStateQuoted, SwapStateConfirming, SwapStateProcessing,
		SwapStateCompleted, SwapStateFailed, SwapStateExpired, SwapStateNeedsReview}
	for _, from := range terminal {
		if !from.IsTerminal() {
			t.Errorf("%s should be terminal", from)
		}
		for _, to := range all {
			if CanTransition(from, to) {
				t.Errorf("terminal %s -> %s allowed", from, to)
			}
		}
	}
}

func TestDoubleConfirmCannotReenterConfirming(t *testing.T) {
	if CanTransition(SwapStateProcessing, SwapStateConfirming) {
		t.Fatal("processing -> confirming allowed (would allow a second execution)")
	}
	if _, err := Transition(SwapStateCompleted, SwapStateProcessing); !errors.Is(err, ErrInvalidTransition) {
		t.Fatalf("err = %v, want ErrInvalidTransition", err)
	}
}

func TestExpiredOnlyFromQuoted(t *testing.T) {
	if !CanTransition(SwapStateQuoted, SwapStateExpired) {
		t.Fatal("quoted -> expired should be allowed")
	}
	if CanTransition(SwapStateConfirming, SwapStateExpired) {
		t.Fatal("confirming -> expired should not be allowed (confirm already sent)")
	}
}
