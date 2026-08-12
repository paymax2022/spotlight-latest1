package handlers

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

// These tests pin the money-path contract of the Connect wallet/gifting/payouts
// handlers without needing a database: the error mapping that decides whether a
// rejected transaction reads as a client error or a server fault, and the
// direction projection used to render ledger entries to users.

func TestWriteMoneyError_MapsLedgerAndTierFailures(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name     string
		err      error
		wantCode int
	}{
		{"duplicate idempotency key is a conflict", ledger.ErrDuplicate, http.StatusConflict},
		{"insufficient funds is a client error", ledger.ErrInsufficientFunds, http.StatusBadRequest},
		{"tier 0 wallet is forbidden", tiers.ErrWalletDisabled, http.StatusForbidden},
		{"daily limit is forbidden", tiers.ErrDailyLimitExceeded, http.StatusForbidden},
		{"wrapped sentinel still maps", errors_wrap(ledger.ErrInsufficientFunds), http.StatusBadRequest},
		{"unknown failure stays opaque", errors.New("connection reset"), http.StatusInternalServerError},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			writeMoneyError(c, tc.err)
			assert.Equal(t, tc.wantCode, w.Code)
			// Ledger internals must never reach the client.
			assert.NotContains(t, w.Body.String(), "ledger:")
		})
	}
}

func TestDirection_ReversalDebitReadsAsCredit(t *testing.T) {
	// A REVERSAL_DEBIT restores funds to the user, so it must render as a credit;
	// showing it as a debit would double-count the loss in the client's history.
	assert.Equal(t, "credit", direction("CREDIT"))
	assert.Equal(t, "credit", direction("REVERSAL_DEBIT"))
	assert.Equal(t, "debit", direction("DEBIT"))
	assert.Equal(t, "debit", direction("REVERSAL_CREDIT"))
}

func TestTierPayload_UnlimitedTierReportsNegativeRemaining(t *testing.T) {
	// Tier 3 is unlimited: RemainingKobo of -1 is the sentinel, not a balance.
	p := tierPayload(tiers.Usage{Tier: tiers.Tier3, DailyLimitKobo: 0, RemainingKobo: -1})
	assert.Equal(t, 3, p["tier"])
	assert.Equal(t, int64(-1), p["remainingKobo"])
	assert.Equal(t, true, p["canWithdraw"])

	// Tier 0 cannot send or withdraw.
	p0 := tierPayload(tiers.Usage{Tier: tiers.Tier0, WalletDisabled: true})
	assert.Equal(t, false, p0["canSend"])
	assert.Equal(t, false, p0["canWithdraw"])
	assert.Equal(t, true, p0["canReceive"])
}

func errors_wrap(err error) error {
	return errWrapper{err}
}

type errWrapper struct{ err error }

func (e errWrapper) Error() string { return "wallet: " + e.err.Error() }
func (e errWrapper) Unwrap() error { return e.err }
