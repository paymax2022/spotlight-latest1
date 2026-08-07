// Package eversend is a thin client for the Eversend API (FX provider 2).
// Auth is a two-step flow: exchange clientId/clientSecret for a short-lived
// bearer token (cached), then call the resource endpoints with it.
//
// NOTE: Endpoint shapes follow Eversend's documented API; verify against the
// live sandbox before production (this client was authored without network
// access). The orchestration adapter degrades to deterministic pricing on any
// error, so a shape mismatch never takes the corridor down.
package eversend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// Client is a token-caching Eversend API client.
type Client struct {
	clientID     string
	clientSecret string
	baseURL      string
	httpClient   *http.Client

	mu       sync.Mutex
	token    string
	tokenExp time.Time
}

// New builds an Eversend client. baseURL is the same for sandbox/prod; the
// environment is selected by the credentials issued in the dashboard.
func New(clientID, clientSecret string, prod bool) *Client {
	return &Client{
		clientID:     clientID,
		clientSecret: clientSecret,
		baseURL:      "https://api.eversend.co/v1",
		httpClient:   &http.Client{Timeout: 30 * time.Second},
	}
}

// token returns a cached bearer token, refreshing it when expired.
func (c *Client) ensureToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.tokenExp) {
		return c.token, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/auth/token", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("clientId", c.clientID)
	req.Header.Set("clientSecret", c.clientSecret)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("eversend: auth token %d: %s", resp.StatusCode, string(body))
	}
	var out struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.Token == "" {
		return "", fmt.Errorf("eversend: auth token: invalid response")
	}
	c.token = out.Token
	c.tokenExp = time.Now().Add(50 * time.Minute)
	return c.token, nil
}

// maxRetries on transient (network / 5xx) failures, with linear backoff.
const maxRetries = 3

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	tok, err := c.ensureToken(ctx)
	if err != nil {
		return err
	}
	var payload []byte
	if in != nil {
		payload, _ = json.Marshal(in)
	}

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * 200 * time.Millisecond):
			}
		}
		var rdr io.Reader
		if payload != nil {
			rdr = bytes.NewReader(payload)
		}
		req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, rdr)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		req.Header.Set("Content-Type", "application/json")
		resp, err := c.httpClient.Do(req)
		if err != nil {
			lastErr = err // transport error — retry
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("eversend: %s %s -> %d: %s", method, path, resp.StatusCode, string(body))
			continue // server error — retry
		}
		if resp.StatusCode >= 300 {
			return fmt.Errorf("eversend: %s %s -> %d: %s", method, path, resp.StatusCode, string(body))
		}
		if out != nil {
			return json.Unmarshal(body, out)
		}
		return nil
	}
	return lastErr
}

// --- FX ---

// Quotation is an Eversend exchange quotation (amounts in major units).
type Quotation struct {
	Token      string  `json:"token"`
	Rate       float64 `json:"rate"`
	FromAmount float64 `json:"sourceAmount"`
	ToAmount   float64 `json:"destinationAmount"`
	Fee        float64 `json:"fee"`
}

// CreateQuotation requests an exchange quotation (POST /exchanges/quotation).
func (c *Client) CreateQuotation(ctx context.Context, from, to string, amountMajor float64) (*Quotation, error) {
	body := map[string]any{"from": from, "to": to, "amount": amountMajor}
	var resp struct {
		Data struct {
			Token     string    `json:"token"`
			Quotation Quotation `json:"quotation"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/exchanges/quotation", body, &resp); err != nil {
		return nil, err
	}
	q := resp.Data.Quotation
	if q.Token == "" {
		q.Token = resp.Data.Token
	}
	return &q, nil
}

// ExchangeResult is the outcome of executing an exchange.
type ExchangeResult struct {
	TransactionID string  `json:"transactionId"`
	Status        string  `json:"status"`
	Rate          float64 `json:"rate"`
	ToAmount      float64 `json:"destinationAmount"`
}

// Exchange executes a quoted exchange (POST /exchanges).
func (c *Client) Exchange(ctx context.Context, quotationToken string) (*ExchangeResult, error) {
	body := map[string]any{"token": quotationToken}
	var resp struct {
		Data ExchangeResult `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/exchanges", body, &resp); err != nil {
		return nil, err
	}
	return &resp.Data, nil
}

// PayoutResult is the outcome of a payout.
type PayoutResult struct {
	TransactionID string `json:"transactionId"`
	Status        string `json:"status"`
}

// Payout sends a payout to a beneficiary (POST /payouts). amountMajor in dest currency.
func (c *Client) Payout(ctx context.Context, currency, accountNumber, name string, amountMajor float64, reference string) (*PayoutResult, error) {
	body := map[string]any{
		"currency":      currency,
		"amount":        amountMajor,
		"accountNumber": accountNumber,
		"name":          name,
		"reference":     reference,
	}
	var resp struct {
		Data PayoutResult `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/payouts", body, &resp); err != nil {
		return nil, err
	}
	return &resp.Data, nil
}

// IBAN holds collection-account details.
type IBAN struct {
	AccountName string   `json:"accountName"`
	IBAN        string   `json:"iban"`
	BIC         string   `json:"bic"`
	Rails       []string `json:"rails"`
}

// CreateIBAN provisions a USD/EUR IBAN collection account (POST /wallets/iban).
func (c *Client) CreateIBAN(ctx context.Context, currency string) (*IBAN, error) {
	body := map[string]any{"currency": currency}
	var resp struct {
		Data IBAN `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/wallets/iban", body, &resp); err != nil {
		return nil, err
	}
	return &resp.Data, nil
}
