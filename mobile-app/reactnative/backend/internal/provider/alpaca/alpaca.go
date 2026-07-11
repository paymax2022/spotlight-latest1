// Package alpaca is the real (HTTP) equities execution venue behind the stocks
// Broker seam, targeting Alpaca's BROKER API (a broker managing many end-user
// sub-accounts — the correct model for a multi-user fintech). Where MockBroker
// computes fills locally, this adapter submits the order to the end-user's Alpaca
// account and reports it as accepted; the actual fill is delivered ASYNCHRONOUSLY
// by Alpaca (via webhook), so Place never synthesizes a synchronous fill.
//
// The BACKEND drives which venue powers the stocks module: credentials arrive only
// through config.ProviderCreds (never os.Getenv, never hardcoded here). If the
// creds are not enabled the adapter refuses to place orders.
//
// Endpoint contract (Broker API, relative to the configured base URL, e.g.
// https://broker-api.sandbox.alpaca.markets):
//
//	POST {base}/v1/trading/accounts/{accountId}/orders  -> Alpaca order object
//	     header  Authorization: Basic base64(<APIKey>:<APISecret>)
//	     body    {symbol, qty, side, type: market|limit, time_in_force: "day"}
//
// accountId is the end-user's Alpaca account: BrokerRequest.AccountID when set,
// else the configured default (ALPACA_ACCOUNT_ID) so the sandbox works end-to-end
// before per-user account provisioning lands.
//
// Every call passes through a circuit breaker so a persistently unhealthy venue
// fails fast instead of stacking 10s timeouts. Only transport errors and 5xx
// responses count against the breaker; a 4xx means Alpaca is healthy but rejected
// the request, so it does not trip the circuit.
package alpaca

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"paymax/crypto-backend/internal/circuitbreaker"
	"paymax/crypto-backend/internal/config"
	"paymax/crypto-backend/internal/engine"
	"paymax/crypto-backend/internal/stocks"
)

// Compile-time assertion: the Alpaca adapter satisfies the stocks Broker seam.
var _ stocks.Broker = (*Broker)(nil)

// Broker is an HTTP-backed Alpaca (Broker API) execution venue. Safe for concurrent use.
type Broker struct {
	creds     config.ProviderCreds
	authValue string // precomputed "Basic <base64(key:secret)>"
	hc        *http.Client
	cb        *circuitbreaker.Breaker
}

// New builds an Alpaca Broker from creds. The underlying http.Client uses a 10s
// timeout, and every call passes through a circuit breaker with default settings
// (trip after 5 consecutive transport/5xx failures, stay open 30s, one half-open
// trial). Credentials are held as passed — never read from the environment here.
// The Broker API authenticates with HTTP Basic (key:secret), computed once here.
func New(creds config.ProviderCreds) *Broker {
	auth := "Basic " + base64.StdEncoding.EncodeToString([]byte(creds.APIKey+":"+creds.APISecret))
	return &Broker{
		creds:     creds,
		authValue: auth,
		hc:        &http.Client{Timeout: 10 * time.Second},
		cb:        circuitbreaker.New(circuitbreaker.Config{}),
	}
}

// account resolves the Alpaca account the order belongs to: the per-request
// AccountID when present, else the configured default (ALPACA_ACCOUNT_ID).
func (b *Broker) account(req stocks.BrokerRequest) string {
	if req.AccountID != "" {
		return req.AccountID
	}
	return b.creds.AccountID
}

// CircuitState exposes the breaker state for observability ("closed"/"open"/"half-open").
func (b *Broker) CircuitState() string { return b.cb.State() }

// orderRequest is the POST /v2/orders body (Alpaca's documented order schema).
type orderRequest struct {
	Symbol      string `json:"symbol"`
	Qty         int64  `json:"qty"`
	Side        string `json:"side"` // buy | sell
	Type        string `json:"type"` // market | limit
	TimeInForce string `json:"time_in_force"`
}

// orderResponse captures the fields we read back from Alpaca's order object. The
// order is created in an "accepted"/"new" state; the fill arrives later via
// webhook, so we do not depend on filled quantity here.
type orderResponse struct {
	ID     string `json:"id"`
	Symbol string `json:"symbol"`
	Status string `json:"status"`
}

// Place implements stocks.Broker. It submits the order to Alpaca and reports it as
// AcceptedByProvider (fills follow asynchronously). It returns an error when the
// venue could not accept the order at all — the caller must not persist such an
// attempt.
func (b *Broker) Place(req stocks.BrokerRequest) (stocks.BrokerResult, error) {
	// Defence in depth: callers should not have selected an unconfigured venue, but
	// never attempt an unauthenticated request.
	if !b.creds.Enabled() {
		return stocks.BrokerResult{}, fmt.Errorf("alpaca: provider not configured")
	}
	acct := b.account(req)
	if acct == "" {
		return stocks.BrokerResult{}, fmt.Errorf("alpaca: no account for order (set ALPACA_ACCOUNT_ID or BrokerRequest.AccountID)")
	}

	body := orderRequest{
		Symbol:      req.Symbol,
		Qty:         req.Quantity,
		Side:        req.Side,
		Type:        mapOrderType(req.OrderType),
		TimeInForce: "day",
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return stocks.BrokerResult{}, fmt.Errorf("alpaca: marshal order: %w", err)
	}

	var out orderResponse
	if err := b.postOrder(acct, buf, &out); err != nil {
		return stocks.BrokerResult{}, err
	}

	now := engine.Now()
	return stocks.BrokerResult{
		Status:         "AcceptedByProvider",
		FilledQuantity: 0, // fills arrive asynchronously via webhook
		Provider:       "alpaca",
		History: []stocks.StatusEvent{
			{Status: "AcceptedByProvider", At: now},
		},
	}, nil
}

// mapOrderType maps a BrokerRequest order type to Alpaca's order type. Unknown
// types fall back to "market" (the venue will still validate server-side).
func mapOrderType(t string) string {
	if t == "limit" {
		return "limit"
	}
	return "market"
}

// postOrder POSTs the order body to the account's Broker API orders endpoint under
// the circuit breaker, enforces a 2xx status and decodes the Alpaca order object
// into out.
//
// Breaker accounting mirrors httpadapter: transport errors and 5xx responses are
// counted as failures (a venue-down signal); a 4xx means Alpaca is healthy but
// rejected the request, so it does not trip the breaker. When the breaker is open
// the call fails fast without hitting the network.
func (b *Broker) postOrder(accountID string, body []byte, out interface{}) error {
	endpoint := b.creds.BaseURL + "/v1/trading/accounts/" + url.PathEscape(accountID) + "/orders"
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", b.authValue) // Basic base64(key:secret)

	var resp *http.Response
	cbErr := b.cb.Do(func() error {
		r, err := b.hc.Do(req)
		if err != nil {
			return err // transport failure → counts against the breaker
		}
		if r.StatusCode >= 500 {
			r.Body.Close()
			return fmt.Errorf("alpaca: POST orders: unexpected status %d", r.StatusCode)
		}
		resp = r // 2xx-4xx: venue is up, don't trip the breaker
		return nil
	})
	if cbErr != nil {
		return cbErr
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("alpaca: POST orders: unexpected status %d", resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}
