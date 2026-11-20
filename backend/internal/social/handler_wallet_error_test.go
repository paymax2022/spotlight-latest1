package social

// Production report: "Pay a cashtag — after entering the amount I get
// 'Could not send, please try again'." The mobile client could not say anything
// better because an unfunded wallet was answered with the SAME shape as a
// malformed request: Service.Send's ledger refusal fell through errMap to the
// 400 default, carrying the service's internal wrap
// ("social: send debit: ledger: insufficient funds"). A 400 with unparsable copy
// has exactly one honest client reply — retry.
//
// These tests pin the two things the client needs to branch on: the 402 status
// the rest of the money rails already use for a short wallet, and the
// machine-readable code that goes with it.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/cashtag"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
)

type memberEnvelope struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
	Code    string `json:"code"`
}

// writeFailure runs one error through the handler-side failure writer and
// returns what the client would see. No Service, no DB: the mapping under test
// is the envelope, not the money path.
func writeFailure(t *testing.T, err error) (int, memberEnvelope) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/finance/social/social/send", nil)

	writeMemberFailure(c, err)

	var body memberEnvelope
	if e := json.Unmarshal(w.Body.Bytes(), &body); e != nil {
		t.Fatalf("body %q is not the social member envelope: %v", w.Body.String(), e)
	}
	return w.Code, body
}

func TestWriteMemberFailure_UnfundedWalletAnswers402WithCode(t *testing.T) {
	// Exactly the wrap Service.Send puts on the ledger error, so the test breaks
	// if the debit path ever stops wrapping (errors.Is must still see through it).
	status, body := writeFailure(t, fmt.Errorf("social: send debit: %w", ledger.ErrInsufficientFunds))

	if status != http.StatusPaymentRequired {
		t.Fatalf("unfunded send = %d, want 402 — the client cannot tell a short wallet "+
			"from a malformed request without it", status)
	}
	if body.Success {
		t.Fatalf("refusal must carry success:false, got %+v", body)
	}
	if body.Code != insufficientWalletCode {
		t.Fatalf("body %+v lacks code %q — the client branches on it instead of string-matching the error",
			body, insufficientWalletCode)
	}
	if body.Error != insufficientWalletMessage {
		t.Fatalf("client copy = %q, want %q — the wrap is a log line, not user text",
			body.Error, insufficientWalletMessage)
	}
	if strings.Contains(body.Error, "social:") || strings.Contains(body.Error, "ledger:") {
		t.Fatalf("client copy %q leaks the service/ledger wrap", body.Error)
	}
}

// TestErrMap_LedgerShortfallIs402RailWide pins the other half: PayoutPool and
// the remaining social money routes still answer through errMap.WriteOK
// directly, so the 402 must live in the table itself — otherwise one refusal
// gets two different statuses depending on the handler that hit it.
func TestErrMap_LedgerShortfallIs402RailWide(t *testing.T) {
	wrapped := fmt.Errorf("social: payout: %w", ledger.ErrInsufficientFunds)
	if got := errMap.Code(wrapped); got != http.StatusPaymentRequired {
		t.Fatalf("errMap.Code(ledger.ErrInsufficientFunds) = %d, want 402", got)
	}
	status, body := writeFailure(t, wrapped)
	if status != http.StatusPaymentRequired || body.Code != insufficientWalletCode {
		t.Fatalf("writeMemberFailure and errMap disagree on a short wallet: %d %+v", status, body)
	}
}

func TestWriteMemberFailure_OtherRefusalsKeepErrMapStatuses(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"tier-0 wallet disabled", tiers.ErrWalletDisabled, http.StatusForbidden},
		{"daily limit exceeded", tiers.ErrDailyLimitExceeded, http.StatusForbidden},
		{"unknown cashtag", cashtag.ErrNotFound, http.StatusNotFound},
		{"aml daily amount limit", ErrAMLAmountLimit, http.StatusTooManyRequests},
		{"tier gate unwired", ErrTierGateUnwired, http.StatusServiceUnavailable},
		{"unmapped error", errors.New("boom"), http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status, body := writeFailure(t, tc.err)
			if status != tc.want {
				t.Fatalf("%v = %d, want %d", tc.err, status, tc.want)
			}
			if body.Success {
				t.Fatalf("refusal must carry success:false, got %q", body.Error)
			}
			// The branch code belongs to the wallet shortfall only; inventing it
			// elsewhere would make a client top up a wallet that was never the problem.
			if body.Code != "" {
				t.Fatalf("%v carried code %q, want none", tc.err, body.Code)
			}
		})
	}
}
