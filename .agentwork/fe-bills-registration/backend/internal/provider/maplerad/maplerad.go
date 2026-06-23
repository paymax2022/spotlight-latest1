package maplerad

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"spotlight/backend/internal/provider"
)

const baseURL = "https://sandbox.api.maplerad.com/v1" // switch to prod URL via env

// Client implements provider.FXProvider, provider.PaymentProvider (for FX payouts),
// and provider.VirtualAccountProvider (Maplerad customer + issuing account).
type Client struct {
	secretKey  string
	baseURL    string
	httpClient *http.Client
}

// New creates a Maplerad client. Set prodURL=true for live environment.
func New(secretKey string, prod bool) *Client {
	url := baseURL
	if prod {
		url = "https://api.maplerad.com/v1"
	}
	return &Client{
		secretKey:  secretKey,
		baseURL:    url,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) Name() string { return "maplerad" }

// --- FX operations ---

// FXQuoteRequest parameters.
type FXQuoteRequest struct {
	SourceCurrency string  // e.g. "NGN"
	TargetCurrency string  // e.g. "USD"
	AmountKobo     int64   // amount in source currency minor units
}

// FXQuoteResponse holds the indicative rate and amounts.
type FXQuoteResponse struct {
	QuoteID         string  `json:"quote_id"`
	Rate            float64 `json:"rate"`
	SourceAmountKobo int64  `json:"source_amount"`
	TargetAmountMinor int64 `json:"target_amount"`
	Fee             int64   `json:"fee"`
	ExpiresAt       string  `json:"expires_at"`
}

// GetFXQuote retrieves an indicative FX rate from Maplerad.
func (c *Client) GetFXQuote(ctx context.Context, req FXQuoteRequest) (*FXQuoteResponse, error) {
	path := fmt.Sprintf("/fx/rates?source=%s&target=%s&amount=%d",
		req.SourceCurrency, req.TargetCurrency, req.AmountKobo)
	var resp struct {
		Status bool            `json:"status"`
		Data   FXQuoteResponse `json:"data"`
		Message string         `json:"message"`
	}
	if err := c.get(ctx, path, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: get fx quote: %s", resp.Message)
	}
	return &resp.Data, nil
}

// ConvertFXRequest parameters.
type ConvertFXRequest struct {
	QuoteID        string
	SourceCurrency string
	TargetCurrency string
	AmountKobo     int64
	Reference      string
}

// ConvertFXResponse is the result of an executed FX conversion.
type ConvertFXResponse struct {
	TransactionID string  `json:"transaction_id"`
	Rate          float64 `json:"rate"`
	SourceAmountKobo int64 `json:"source_amount"`
	TargetAmountMinor int64 `json:"target_amount"`
	FeeKobo       int64   `json:"fee"`
	Status        string  `json:"status"`
}

// ConvertFX executes a currency conversion using a previously obtained quote.
func (c *Client) ConvertFX(ctx context.Context, req ConvertFXRequest) (*ConvertFXResponse, error) {
	body := map[string]any{
		"quote_id":        req.QuoteID,
		"source_currency": req.SourceCurrency,
		"target_currency": req.TargetCurrency,
		"amount":          req.AmountKobo,
		"reference":       req.Reference,
	}
	var resp struct {
		Status bool              `json:"status"`
		Data   ConvertFXResponse `json:"data"`
		Message string           `json:"message"`
	}
	if err := c.post(ctx, "/fx/convert", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: convert fx: %s", resp.Message)
	}
	return &resp.Data, nil
}

// --- PaymentProvider implementation (reuses for FX payouts) ---

func (c *Client) InitializePayment(ctx context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error) {
	body := map[string]any{
		"email":     req.Email,
		"amount":    req.AmountKobo,
		"reference": req.Reference,
		"currency":  "NGN",
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			Reference string `json:"reference"`
			URL       string `json:"authorization_url"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/collections/initialize", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: initialize: %s", resp.Message)
	}
	return &provider.InitializePaymentResponse{
		Reference:        resp.Data.Reference,
		AuthorizationURL: resp.Data.URL,
	}, nil
}

func (c *Client) VerifyPayment(ctx context.Context, reference string) (*provider.PaymentStatus, error) {
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			Status    string `json:"status"`
			Reference string `json:"reference"`
			Amount    int64  `json:"amount"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/collections/"+reference, &resp); err != nil {
		return nil, err
	}
	return &provider.PaymentStatus{
		Reference:  resp.Data.Reference,
		Status:     resp.Data.Status,
		AmountKobo: resp.Data.Amount,
	}, nil
}

func (c *Client) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	body := map[string]any{
		"recipient": req.RecipientCode,
		"amount":    req.AmountKobo,
		"reference": req.Reference,
		"reason":    req.Narration,
		"currency":  "NGN",
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID       string `json:"id"`
			Status   string `json:"status"`
			Reference string `json:"reference"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/transfers", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: payout: %s", resp.Message)
	}
	return &provider.PayoutResponse{
		TransferCode: resp.Data.ID,
		Status:       resp.Data.Status,
		Reference:    resp.Data.Reference,
	}, nil
}

func (c *Client) VerifyWebhookSignature(payload []byte, signature string) bool {
	// Maplerad uses HMAC-SHA256; implement once webhook spec is confirmed.
	// Placeholder returns true in sandbox for testing.
	return true
}

// --- VirtualAccountProvider ---

func (c *Client) ProvisionVirtualAccount(ctx context.Context, req provider.ProvisionVARequest) (*provider.VirtualAccount, error) {
	body := map[string]any{
		"first_name":  req.FirstName,
		"last_name":   req.LastName,
		"email":       req.Email,
		"phone":       req.PhoneNumber,
		"bvn":         req.BVN,
		"currency":    "NGN",
		"bank_code":   "035", // Wema Bank
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			AccountNumber string `json:"account_number"`
			AccountName   string `json:"account_name"`
			BankName      string `json:"bank_name"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/issuing/virtual-accounts", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: provision VA: %s", resp.Message)
	}
	return &provider.VirtualAccount{
		AccountNumber: resp.Data.AccountNumber,
		AccountName:   resp.Data.AccountName,
		BankName:      resp.Data.BankName,
	}, nil
}

func (c *Client) GetVirtualAccount(ctx context.Context, userID string) (*provider.VirtualAccount, error) {
	return nil, fmt.Errorf("maplerad: GetVirtualAccount not implemented — use VA service repo")
}

// --- HTTP helpers ---

func (c *Client) post(ctx context.Context, path string, body, dst any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("maplerad: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, dst)
}

func (c *Client) get(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	return c.do(req, dst)
}

func (c *Client) do(req *http.Request, dst any) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("maplerad: http request: %w", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("maplerad: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("maplerad: server error %d: %s", resp.StatusCode, string(b))
	}
	return json.Unmarshal(b, dst)
}
