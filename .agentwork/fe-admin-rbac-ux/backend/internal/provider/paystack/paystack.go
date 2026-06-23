package paystack

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"spotlight/backend/internal/provider"
)

const baseURL = "https://api.paystack.co"

// Client implements provider.PaymentProvider and provider.VirtualAccountProvider.
type Client struct {
	secretKey  string
	httpClient *http.Client
}

// New creates a Paystack client.
func New(secretKey string) *Client {
	return &Client{
		secretKey: secretKey,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) Name() string { return "paystack" }

// --- PaymentProvider ---

func (c *Client) InitializePayment(ctx context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error) {
	body := map[string]any{
		"email":        req.Email,
		"amount":       req.AmountKobo,
		"reference":    req.Reference,
		"callback_url": req.CallbackURL,
	}
	var resp struct {
		Status bool   `json:"status"`
		Data   struct {
			AuthorizationURL string `json:"authorization_url"`
			AccessCode       string `json:"access_code"`
			Reference        string `json:"reference"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/transaction/initialize", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("paystack: initialize payment: %s", resp.Message)
	}
	return &provider.InitializePaymentResponse{
		Reference:        resp.Data.Reference,
		AuthorizationURL: resp.Data.AuthorizationURL,
		AccessCode:       resp.Data.AccessCode,
	}, nil
}

func (c *Client) VerifyPayment(ctx context.Context, reference string) (*provider.PaymentStatus, error) {
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			Status     string `json:"status"`
			Reference  string `json:"reference"`
			Amount     int64  `json:"amount"`
			Channel    string `json:"channel"`
			PaidAt     string `json:"paid_at"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/transaction/verify/"+reference, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("paystack: verify payment %s: %s", reference, resp.Message)
	}
	paidAt := &resp.Data.PaidAt
	if resp.Data.PaidAt == "" {
		paidAt = nil
	}
	return &provider.PaymentStatus{
		Reference:  resp.Data.Reference,
		Status:     resp.Data.Status,
		AmountKobo: resp.Data.Amount,
		Channel:    resp.Data.Channel,
		PaidAt:     paidAt,
	}, nil
}

func (c *Client) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	body := map[string]any{
		"source":        "balance",
		"recipient":     req.RecipientCode,
		"amount":        req.AmountKobo,
		"reference":     req.Reference,
		"reason":        req.Narration,
	}
	var resp struct {
		Status bool   `json:"status"`
		Data   struct {
			TransferCode string `json:"transfer_code"`
			Status       string `json:"status"`
			Reference    string `json:"reference"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/transfer", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("paystack: initiate payout: %s", resp.Message)
	}
	return &provider.PayoutResponse{
		TransferCode: resp.Data.TransferCode,
		Status:       resp.Data.Status,
		Reference:    resp.Data.Reference,
	}, nil
}

// VerifyWebhookSignature validates HMAC-SHA512 signatures from Paystack.
func (c *Client) VerifyWebhookSignature(payload []byte, signature string) bool {
	mac := hmac.New(sha512.New, []byte(c.secretKey))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// --- VirtualAccountProvider ---

func (c *Client) ProvisionVirtualAccount(ctx context.Context, req provider.ProvisionVARequest) (*provider.VirtualAccount, error) {
	body := map[string]any{
		"email":        req.Email,
		"first_name":   req.FirstName,
		"last_name":    req.LastName,
		"phone":        req.PhoneNumber,
		"preferred_bank": "wema-bank",
		"bvn":          req.BVN,
	}
	var resp struct {
		Status bool   `json:"status"`
		Data   struct {
			AccountNumber string `json:"account_number"`
			AccountName   string `json:"account_name"`
			Bank          struct {
				Name string `json:"name"`
				Slug string `json:"slug"`
				ID   int    `json:"id"`
			} `json:"bank"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/dedicated_account", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("paystack: provision VA: %s", resp.Message)
	}
	return &provider.VirtualAccount{
		AccountNumber: resp.Data.AccountNumber,
		AccountName:   resp.Data.AccountName,
		BankName:      resp.Data.Bank.Name,
	}, nil
}

func (c *Client) GetVirtualAccount(ctx context.Context, userID string) (*provider.VirtualAccount, error) {
	// Paystack DVAs are looked up by customer code. This adapter looks up by
	// account number stored in our virtual_accounts table (called via the service layer).
	return nil, fmt.Errorf("paystack: GetVirtualAccount not implemented — use VA service repo")
}

// --- HTTP helpers ---

func (c *Client) post(ctx context.Context, path string, body, dst any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("paystack: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, dst)
}

func (c *Client) get(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.secretKey)
	return c.do(req, dst)
}

func (c *Client) do(req *http.Request, dst any) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("paystack: http request: %w", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("paystack: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("paystack: server error %d: %s", resp.StatusCode, string(b))
	}
	return json.Unmarshal(b, dst)
}
