package restaurant

// Pure unit tests for the money-path HTTP status mapping on the order-escrow paths.
//
// These exist to pin the errors.Is chain, not just the switch. PlaceOrder wraps the tier
// gate's error with fmt.Errorf("...: %w", err) and settlement.Escrow wraps the ledger's
// the same way, so a future refactor that swaps a single %w for %v would silently turn a
// 403 "you are over your daily limit" into an opaque 500 — with every live-DB test still
// green, because they match sentinels on the service return rather than on the status.

import (
	"fmt"
	"net/http"
	"testing"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

func TestEscrowErrStatus(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		wantCode int
		wantOK   bool
	}{
		{
			// Exactly how PlaceOrder returns a tier refusal.
			name:     "daily limit exceeded, wrapped as PlaceOrder returns it",
			err:      fmt.Errorf("restaurant: order escrow tier gate: %w", tiers.ErrDailyLimitExceeded),
			wantCode: http.StatusForbidden, wantOK: true,
		},
		{
			name:     "wallet disabled, wrapped as PlaceOrder returns it",
			err:      fmt.Errorf("restaurant: order escrow tier gate: %w", tiers.ErrWalletDisabled),
			wantCode: http.StatusForbidden, wantOK: true,
		},
		{
			// Doubly wrapped: settlement wraps the ledger error, PlaceOrder wraps that.
			name:     "insufficient funds through both escrow wraps",
			err:      fmt.Errorf("restaurant: escrow payment: %w", fmt.Errorf("settlement: escrow debit: %w", ledger.ErrInsufficientFunds)),
			wantCode: http.StatusPaymentRequired, wantOK: true,
		},
		{
			name:     "unwired tier gate",
			err:      ErrTierGateUnwired,
			wantCode: http.StatusServiceUnavailable, wantOK: true,
		},
		{
			name:     "missing idempotency key",
			err:      ErrOrderMissingIdem,
			wantCode: http.StatusBadRequest, wantOK: true,
		},
		{
			// Not a money-path refusal — the caller keeps its own default.
			name:   "unrelated validation error is not claimed",
			err:    fmt.Errorf("restaurant: menu item x not found in restaurant y"),
			wantOK: false,
		},
		{
			// The fail-closed tier LOOKUP failure (no profile row / DB error) is not a
			// caller fault and deliberately falls through to the 500 default.
			name:   "undeterminable tier is not claimed as a 403",
			err:    fmt.Errorf("restaurant: order escrow tier gate: tiers: enforce limit (fail closed): no rows in result set"),
			wantOK: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, ok := escrowErrStatus(tc.err)
			if ok != tc.wantOK {
				t.Fatalf("escrowErrStatus ok = %v, want %v (err: %v)", ok, tc.wantOK, tc.err)
			}
			if ok && code != tc.wantCode {
				t.Errorf("escrowErrStatus code = %d, want %d", code, tc.wantCode)
			}
		})
	}
}

// The two money paths in this module must answer an unwired gate identically, so a
// misconfigured deployment looks the same whichever one the client hits.
func TestUnwiredTierGateIsServiceUnavailableOnBothMoneyPaths(t *testing.T) {
	if code, ok := escrowErrStatus(ErrTierGateUnwired); !ok || code != http.StatusServiceUnavailable {
		t.Errorf("order escrow: code=%d ok=%v, want 503", code, ok)
	}
	if code := withdrawalErrStatus(ErrTierGateUnwired); code != http.StatusServiceUnavailable {
		t.Errorf("withdrawal: code=%d, want 503", code)
	}
}
