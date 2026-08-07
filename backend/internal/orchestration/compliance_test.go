package orchestration

import (
	"context"
	"errors"
	"testing"
	"time"
)

// --- default screener ---

func TestAllowAllScreenerAllows(t *testing.T) {
	allowed, reason, err := (AllowAllScreener{}).Screen(context.Background(), "cus_1", "USD-NGN", 100_00)
	if err != nil {
		t.Fatalf("AllowAllScreener must not error: %v", err)
	}
	if !allowed {
		t.Fatalf("AllowAllScreener must allow, got allowed=%v reason=%q", allowed, reason)
	}
}

// --- enforcement on the quote path (allowed / blocked / fail-closed) ---

func TestCreateQuoteComplianceEnforcement(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	req := QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true}

	cases := []struct {
		name      string
		screener  ComplianceScreener
		wantErr   bool
		wantType  ErrorType
		wantCode  string
		wantQuote bool
	}{
		{
			name:      "allowed passes",
			screener:  ScreenerFunc(func(_ context.Context, _, _ string, _ int64) (bool, string, error) { return true, "", nil }),
			wantQuote: true,
		},
		{
			name: "blocked returns compliance_block with reason code",
			screener: ScreenerFunc(func(_ context.Context, _, _ string, _ int64) (bool, string, error) {
				return false, "sanctions_hit", nil
			}),
			wantErr:  true,
			wantType: ErrComplianceBlock,
			wantCode: "sanctions_hit",
		},
		{
			name:     "blocked with empty reason normalizes to compliance_block",
			screener: ScreenerFunc(func(_ context.Context, _, _ string, _ int64) (bool, string, error) { return false, "", nil }),
			wantErr:  true,
			wantType: ErrComplianceBlock,
			wantCode: "compliance_block",
		},
		{
			name: "screener error fails closed",
			screener: ScreenerFunc(func(_ context.Context, _, _ string, _ int64) (bool, string, error) {
				return false, "", errors.New("vendor timeout")
			}),
			wantErr:  true,
			wantType: ErrComplianceBlock,
			wantCode: "compliance_block",
		},
		{
			name: "screener error overrides an allowed=true (fail-closed)",
			screener: ScreenerFunc(func(_ context.Context, _, _ string, _ int64) (bool, string, error) {
				return true, "", errors.New("vendor down")
			}),
			wantErr:  true,
			wantType: ErrComplianceBlock,
			wantCode: "compliance_block",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, _ := newTestService(&clock, false)
			svc.SetScreener(tc.screener)
			q, e := svc.CreateQuote(ctx, "cus_1", "retail", req)
			if tc.wantErr {
				if e == nil {
					t.Fatalf("expected error, got quote %+v", q)
				}
				if e.Type != tc.wantType {
					t.Fatalf("error type = %s, want %s", e.Type, tc.wantType)
				}
				if e.Code != tc.wantCode {
					t.Fatalf("error code = %q, want %q", e.Code, tc.wantCode)
				}
				if q != nil {
					t.Fatalf("blocked quote must not be priced, got %+v", q)
				}
				if e.HTTPStatus() != 422 {
					t.Fatalf("compliance_block must map to 422, got %d", e.HTTPStatus())
				}
				return
			}
			if e != nil {
				t.Fatalf("expected success, got error %v", e)
			}
			if tc.wantQuote && q == nil {
				t.Fatalf("expected a priced quote")
			}
		})
	}
}

// --- enforcement on the transfer execution path ---

func TestExecuteTransferComplianceBlockHaltsBeforeDebit(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := newTestService(&clock, false)
	cust := "cus_block"
	_ = svc.SeedBalance(ctx, cust, "USD", 1_000_00)

	// Allow the quote to be priced, then block at execution. This proves the
	// execution-path gate is independent and fail-closed even with a valid quote.
	var blockNow bool
	svc.SetScreener(ScreenerFunc(func(_ context.Context, _, _ string, _ int64) (bool, string, error) {
		if blockNow {
			return false, "aml_review", nil
		}
		return true, "", nil
	}))

	q, e := svc.CreateQuote(ctx, cust, "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentTransfer, Lock: true})
	if e != nil {
		t.Fatalf("quote should price while allowed: %v", e)
	}

	blockNow = true
	dest := &Destination{Rail: RailBankTransfer, Currency: "NGN", AccountNumber: "0123456789", Counterparty: Counterparty{Name: "Test"}}
	tr, e := svc.ExecuteTransfer(ctx, cust, "idem-block", TransferRequest{QuoteID: q.ID, Destination: dest})
	if e == nil {
		t.Fatalf("expected compliance_block, got transfer %+v", tr)
	}
	if e.Type != ErrComplianceBlock || e.Code != "aml_review" {
		t.Fatalf("expected compliance_block/aml_review, got %s/%s", e.Type, e.Code)
	}
	// Balance must be untouched — nothing moved.
	if bal, _ := store.Balance(ctx, cust, "USD"); bal != 1_000_00 {
		t.Fatalf("balance must be untouched on compliance_block, got %d", bal)
	}
}

func TestExecuteTransferScreenerErrorFailsClosed(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, store := newTestService(&clock, false)
	cust := "cus_failclosed"
	_ = svc.SeedBalance(ctx, cust, "NGN", 1_000_00)

	// Same-currency transfer: no quote_id, so screening only happens on the
	// execution path. A screener error must fail closed.
	svc.SetScreener(ScreenerFunc(func(_ context.Context, _, _ string, _ int64) (bool, string, error) {
		return true, "", errors.New("screening outage")
	}))

	dest := &Destination{Rail: RailBankTransfer, Currency: "NGN", AccountNumber: "0123456789", Counterparty: Counterparty{Name: "Test"}}
	amt := NewMoney(50_00, "NGN")
	tr, e := svc.ExecuteTransfer(ctx, cust, "idem-fc", TransferRequest{Destination: dest, Amount: &amt})
	if e == nil {
		t.Fatalf("expected fail-closed compliance_block, got transfer %+v", tr)
	}
	if e.Type != ErrComplianceBlock {
		t.Fatalf("expected compliance_block on screener error, got %s", e.Type)
	}
	if bal, _ := store.Balance(ctx, cust, "NGN"); bal != 1_000_00 {
		t.Fatalf("balance must be untouched, got %d", bal)
	}
}

// --- default service screens-open (no vendor configured) ---

func TestDefaultServiceAllowsWithoutVendor(t *testing.T) {
	ctx := context.Background()
	clock := time.Now()
	svc, _ := newTestService(&clock, false) // no SetScreener -> AllowAllScreener default
	q, e := svc.CreateQuote(ctx, "cus_default", "retail", QuoteRequest{Source: "USD", Destination: "NGN", Amount: 100_00, Intent: IntentConversion, Lock: true})
	if e != nil {
		t.Fatalf("default (no vendor) must allow, got %v", e)
	}
	if q == nil {
		t.Fatalf("expected a priced quote under default screener")
	}
}
