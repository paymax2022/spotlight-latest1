// http.go is the real (HTTP) implementation of the Client port. Where MockLedger
// keeps balances in memory, HTTPLedger posts balanced cash legs to the money-core
// internal ledger API and reads derived balances back over HTTP. It is selected by
// LEDGER_BACKEND=http and is behaviour-compatible with MockLedger by construction:
//
//   - the same validity rules gate a post (idem key required; debit, credit and a
//     positive amount required) BEFORE any network call;
//   - a 200 response is success for both a fresh post and an idempotent replay;
//   - a 409 maps to ErrInsufficientFunds (a balance-checked overdraw), matching the
//     mock's fail-closed behaviour.
//
// Endpoint contract (relative to the configured base URL):
//
//	POST {base}/internal/finance/ledger/journal
//	     headers: Authorization: Bearer <serviceToken>
//	              Content-Type: application/json
//	              Idempotency-Key: <j.IdempotencyKey>
//	     body: {userId, debitAccount, creditAccount, amountKobo, reference,
//	            idempotencyKey, balanceChecked}   (camelCase)
//	     200 -> posted or replay (success)
//	     409 -> insufficient funds (ErrInsufficientFunds)
//	GET  {base}/internal/finance/ledger/balance?userId=&account=
//	     headers: Authorization: Bearer <serviceToken>
//	     200 -> {balanceKobo: <int64>}
//
// Breaker accounting mirrors httpadapter: only transport errors and 5xx responses
// count as failures (a money-core-down signal). Any 4xx — including a 409
// insufficient-funds, which is a HEALTHY provider decision — leaves the breaker
// closed. When the breaker is open, calls fail fast with a wrapped
// circuitbreaker.ErrOpen without hitting the network.

package ledger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"paymax/crypto-backend/internal/circuitbreaker"
)

// Compile-time assertion: *HTTPLedger satisfies the Client port.
var _ Client = (*HTTPLedger)(nil)

// HTTPLedger posts money legs to the authoritative money-core ledger over HTTP.
// It is safe for concurrent use; the embedded *http.Client and *circuitbreaker.Breaker
// are.
type HTTPLedger struct {
	baseURL      string
	serviceToken string
	hc           *http.Client
	cb           *circuitbreaker.Breaker
}

// NewHTTP builds an HTTPLedger pointed at baseURL, authenticating to the money-core
// internal API with serviceToken. The underlying http.Client uses a 10s timeout,
// and every call passes through a circuit breaker (default config: trip after 5
// consecutive transport/5xx failures, stay open 30s, one half-open trial) so a
// persistently unhealthy ledger fails fast instead of stacking up 10s timeouts.
func NewHTTP(baseURL, serviceToken string) *HTTPLedger {
	return &HTTPLedger{
		baseURL:      baseURL,
		serviceToken: serviceToken,
		hc:           &http.Client{Timeout: 10 * time.Second},
		cb:           circuitbreaker.New(circuitbreaker.Config{}),
	}
}

// CircuitState exposes the breaker state for observability ("closed"/"open"/"half-open").
func (l *HTTPLedger) CircuitState() string { return l.cb.State() }

// journalRequest is the POST body for a ledger journal (camelCase, matching the
// money-core internal contract).
type journalRequest struct {
	UserID         string `json:"userId"`
	DebitAccount   string `json:"debitAccount"`
	CreditAccount  string `json:"creditAccount"`
	AmountKobo     int64  `json:"amountKobo"`
	Reference      string `json:"reference"`
	IdempotencyKey string `json:"idempotencyKey"`
	BalanceChecked bool   `json:"balanceChecked"`
}

// PostJournal posts one balanced pair to the money-core ledger, idempotently.
//
// Validity is checked BEFORE any network call (mirroring MockLedger): a missing
// idempotency key returns ErrMissingIdem; a missing account or non-positive amount
// returns ErrUnbalanced. On the wire, a 200 is success (fresh post or replay), a
// 409 is ErrInsufficientFunds, and any other non-2xx / transport error is wrapped.
func (l *HTTPLedger) PostJournal(ctx context.Context, j Journal) error {
	if err := j.valid(); err != nil {
		return err
	}

	buf, err := json.Marshal(journalRequest{
		UserID:         j.UserID,
		DebitAccount:   j.DebitAccount,
		CreditAccount:  j.CreditAccount,
		AmountKobo:     j.AmountKobo,
		Reference:      j.Reference,
		IdempotencyKey: j.IdempotencyKey,
		BalanceChecked: j.BalanceChecked,
	})
	if err != nil {
		return fmt.Errorf("ledger: marshal journal: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		l.baseURL+"/internal/finance/ledger/journal", bytes.NewReader(buf))
	if err != nil {
		return fmt.Errorf("ledger: build journal request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+l.serviceToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", j.IdempotencyKey)

	// The breaker closure returns nil for any non-5xx response (2xx or 4xx) so a
	// 409/4xx never counts as a failure; status is then interpreted outside the
	// breaker. Only transport errors and 5xx are counted against the breaker.
	var status int
	cbErr := l.cb.Do(func() error {
		resp, err := l.hc.Do(req)
		if err != nil {
			return err // transport failure → counts against the breaker
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 500 {
			return fmt.Errorf("ledger: POST journal: unexpected status %d", resp.StatusCode)
		}
		status = resp.StatusCode // 2xx-4xx: provider is up, don't trip the breaker
		return nil
	})
	if cbErr != nil {
		return fmt.Errorf("ledger: post journal: %w", cbErr)
	}

	switch {
	case status >= 200 && status < 300:
		return nil // posted or replay — both success
	case status == http.StatusConflict:
		return ErrInsufficientFunds
	default:
		return fmt.Errorf("ledger: POST journal: unexpected status %d", status)
	}
}

// balanceResponse is the GET balance body.
type balanceResponse struct {
	BalanceKobo int64 `json:"balanceKobo"`
}

// Balance returns the derived balance (minor units) of a user's account from the
// money-core ledger.
func (l *HTTPLedger) Balance(ctx context.Context, userID, account string) (int64, error) {
	q := url.Values{}
	q.Set("userId", userID)
	q.Set("account", account)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		l.baseURL+"/internal/finance/ledger/balance?"+q.Encode(), nil)
	if err != nil {
		return 0, fmt.Errorf("ledger: build balance request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+l.serviceToken)

	var out balanceResponse
	var status int
	cbErr := l.cb.Do(func() error {
		resp, err := l.hc.Do(req)
		if err != nil {
			return err // transport failure → counts against the breaker
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 500 {
			return fmt.Errorf("ledger: GET balance: unexpected status %d", resp.StatusCode)
		}
		status = resp.StatusCode
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return json.NewDecoder(resp.Body).Decode(&out)
		}
		return nil // non-5xx non-2xx: provider up, interpret status outside
	})
	if cbErr != nil {
		return 0, fmt.Errorf("ledger: balance: %w", cbErr)
	}
	if status < 200 || status >= 300 {
		return 0, fmt.Errorf("ledger: GET balance: unexpected status %d", status)
	}
	return out.BalanceKobo, nil
}
