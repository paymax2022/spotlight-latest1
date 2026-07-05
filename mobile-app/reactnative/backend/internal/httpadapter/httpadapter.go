// Package httpadapter is a real (HTTP) implementation of the provider-adapter
// seam defined in package adapter. Where the mock adapters compute values
// locally, these call a configurable provider base URL over HTTP and decode the
// JSON response directly into the shared domain types.
//
// One *Client satisfies all three adapter interfaces (MarketData, Liquidity,
// Custody), so an orchestrator can construct it once and assign the same value
// to every adapter field.
//
// Endpoint contract (relative to the configured base URL):
//
//	GET  {base}/assets                              -> []domain.Asset
//	GET  {base}/assets/{symbol}                     -> domain.Asset      (404 => ok=false)
//	GET  {base}/assets/{symbol}/chart?range={rng}   -> []domain.CandlePoint
//	POST {base}/quote                               -> domain.Quote
//	     body {assetId, side, basis, amount, currency, lock}
//	POST {base}/swap-quote                          -> domain.SwapQuote
//	     body {fromAssetId, toAssetId, fromAmount}
//	GET  {base}/deposit-address?symbol=&network=    -> domain.DepositAddress
//	POST {base}/withdrawal-quote                    -> domain.WithdrawalQuote
//	     body {assetId, networkId, amount}
//	POST {base}/screen-address                      -> domain.AddressScreening
//	     body {address}
//
// Requests carry "Authorization: Bearer <apiKey>" when an API key is configured,
// and POSTs send "Content-Type: application/json". Any transport error or non-2xx
// status causes the (T, bool) methods to return (zero, false); ScreenAddress
// fails safe by returning a "flagged" result so an unreachable provider never
// silently clears a withdrawal address.
package httpadapter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"paymax/crypto-backend/internal/adapter"
	"paymax/crypto-backend/internal/domain"
)

// Compile-time assertions: a single *Client implements every adapter contract.
var (
	_ adapter.MarketData = (*Client)(nil)
	_ adapter.Liquidity  = (*Client)(nil)
	_ adapter.Custody    = (*Client)(nil)
)

// Client is an HTTP-backed provider adapter. It is safe for concurrent use; the
// embedded *http.Client is.
type Client struct {
	baseURL string
	apiKey  string
	hc      *http.Client
}

// New builds a Client pointed at baseURL. apiKey may be empty (no auth header).
// The underlying http.Client uses a 10s timeout.
func New(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		hc:      &http.Client{Timeout: 10 * time.Second},
	}
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

// getJSON issues a GET to {base}{path} and decodes a 2xx JSON body into out.
func (c *Client) getJSON(path string, out interface{}) error {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	return c.do(req, out)
}

// postJSON marshals body to JSON, POSTs it to {base}{path} and decodes a 2xx
// JSON body into out.
func (c *Client) postJSON(path string, body interface{}, out interface{}) error {
	buf, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, c.baseURL+path, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, out)
}

// do sets auth, executes the request, enforces a 2xx status and decodes the
// body. It always closes the response body.
func (c *Client) do(req *http.Request, out interface{}) error {
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("httpadapter: %s %s: unexpected status %d", req.Method, req.URL.Path, resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// ── MarketData ───────────────────────────────────────────────────────────────

// Assets returns the provider's tradable asset catalogue. On error it returns
// nil (the caller sees an empty catalogue rather than a panic).
func (c *Client) Assets() []domain.Asset {
	var out []domain.Asset
	if err := c.getJSON("/assets", &out); err != nil {
		return nil
	}
	return out
}

// Asset fetches a single asset by symbol/key. A non-2xx status (e.g. 404)
// yields (zero, false).
func (c *Client) Asset(key string) (domain.Asset, bool) {
	var out domain.Asset
	if err := c.getJSON("/assets/"+url.PathEscape(key), &out); err != nil {
		return domain.Asset{}, false
	}
	return out, true
}

// Chart fetches price history for symbol over the given range.
func (c *Client) Chart(symbol, rng string) ([]domain.CandlePoint, bool) {
	q := url.Values{}
	q.Set("range", rng)
	var out []domain.CandlePoint
	if err := c.getJSON("/assets/"+url.PathEscape(symbol)+"/chart?"+q.Encode(), &out); err != nil {
		return nil, false
	}
	return out, true
}

// ── Liquidity ────────────────────────────────────────────────────────────────

// quoteRequest is the POST /quote body.
type quoteRequest struct {
	AssetID  string `json:"assetId"`
	Side     string `json:"side"`
	Basis    string `json:"basis"`
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
	Lock     bool   `json:"lock"`
}

// Quote requests an executable buy/sell quote.
func (c *Client) Quote(assetKey, side, basis string, amount int64, currency string, lock bool) (domain.Quote, bool) {
	body := quoteRequest{
		AssetID:  assetKey,
		Side:     side,
		Basis:    basis,
		Amount:   amount,
		Currency: currency,
		Lock:     lock,
	}
	var out domain.Quote
	if err := c.postJSON("/quote", body, &out); err != nil {
		return domain.Quote{}, false
	}
	return out, true
}

// swapQuoteRequest is the POST /swap-quote body.
type swapQuoteRequest struct {
	FromAssetID string `json:"fromAssetId"`
	ToAssetID   string `json:"toAssetId"`
	FromAmount  int64  `json:"fromAmount"`
}

// SwapQuote requests an executable crypto-to-crypto quote.
func (c *Client) SwapQuote(fromKey, toKey string, fromAmount int64) (domain.SwapQuote, bool) {
	body := swapQuoteRequest{
		FromAssetID: fromKey,
		ToAssetID:   toKey,
		FromAmount:  fromAmount,
	}
	var out domain.SwapQuote
	if err := c.postJSON("/swap-quote", body, &out); err != nil {
		return domain.SwapQuote{}, false
	}
	return out, true
}

// ── Custody ──────────────────────────────────────────────────────────────────

// DepositAddress fetches a custody deposit address for symbol on networkID.
func (c *Client) DepositAddress(symbol, networkID string) (domain.DepositAddress, bool) {
	q := url.Values{}
	q.Set("symbol", symbol)
	q.Set("network", networkID)
	var out domain.DepositAddress
	if err := c.getJSON("/deposit-address?"+q.Encode(), &out); err != nil {
		return domain.DepositAddress{}, false
	}
	return out, true
}

// withdrawalQuoteRequest is the POST /withdrawal-quote body.
type withdrawalQuoteRequest struct {
	AssetID   string `json:"assetId"`
	NetworkID string `json:"networkId"`
	Amount    int64  `json:"amount"`
}

// WithdrawalQuote previews a withdrawal (network fee + receive amount).
func (c *Client) WithdrawalQuote(assetKey, networkID string, amount int64) (domain.WithdrawalQuote, bool) {
	body := withdrawalQuoteRequest{
		AssetID:   assetKey,
		NetworkID: networkID,
		Amount:    amount,
	}
	var out domain.WithdrawalQuote
	if err := c.postJSON("/withdrawal-quote", body, &out); err != nil {
		return domain.WithdrawalQuote{}, false
	}
	return out, true
}

// screenAddressRequest is the POST /screen-address body.
type screenAddressRequest struct {
	Address string `json:"address"`
}

// ScreenAddress runs an AML/sanctions screen against address. It fails safe: if
// the provider is unreachable or returns a non-2xx status, the address is
// reported as flagged rather than clear.
func (c *Client) ScreenAddress(address string) domain.AddressScreening {
	body := screenAddressRequest{Address: address}
	var out domain.AddressScreening
	if err := c.postJSON("/screen-address", body, &out); err != nil {
		return domain.AddressScreening{Risk: "flagged", Reason: "screening unavailable"}
	}
	return out
}
