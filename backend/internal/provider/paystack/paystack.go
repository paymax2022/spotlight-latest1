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
		ProviderRef:  resp.Data.TransferCode, // Paystack routes webhooks by transfer_code
	}, nil
}

// --- DisbursementProvider ---

// ListBanks fetches Paystack's supported NGN banks (GET /bank).
func (c *Client) ListBanks(ctx context.Context) ([]provider.Bank, error) {
	var resp struct {
		Status bool `json:"status"`
		Data   []struct {
			Code string `json:"code"`
			Name string `json:"name"`
			Slug string `json:"slug"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/bank?currency=NGN", &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("paystack: list banks: %s", resp.Message)
	}
	banks := make([]provider.Bank, 0, len(resp.Data))
	for _, b := range resp.Data {
		banks = append(banks, provider.Bank{Code: b.Code, Name: b.Name, Slug: b.Slug})
	}
	return banks, nil
}

// ResolveAccount performs a NUBAN name enquiry (GET /bank/resolve).
func (c *Client) ResolveAccount(ctx context.Context, bankCode, accountNumber string) (*provider.AccountResolution, error) {
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			AccountNumber string `json:"account_number"`
			AccountName   string `json:"account_name"`
		} `json:"data"`
		Message string `json:"message"`
	}
	path := fmt.Sprintf("/bank/resolve?account_number=%s&bank_code=%s", accountNumber, bankCode)
	if err := c.get(ctx, path, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("paystack: resolve account: %s", resp.Message)
	}
	return &provider.AccountResolution{
		AccountName:   resp.Data.AccountName,
		AccountNumber: resp.Data.AccountNumber,
		BankCode:      bankCode,
	}, nil
}

// CreateTransferRecipient registers a payout recipient (POST /transferrecipient).
func (c *Client) CreateTransferRecipient(ctx context.Context, req provider.RecipientRequest) (*provider.Recipient, error) {
	currency := req.Currency
	if currency == "" {
		currency = "NGN"
	}
	body := map[string]any{
		"type":           "nuban",
		"name":           req.AccountName,
		"account_number": req.AccountNumber,
		"bank_code":      req.BankCode,
		"currency":       currency,
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			RecipientCode string `json:"recipient_code"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/transferrecipient", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("paystack: create recipient: %s", resp.Message)
	}
	return &provider.Recipient{Code: resp.Data.RecipientCode}, nil
}

// GetTransferStatus polls a transfer by its code (GET /transfer/:id).
func (c *Client) GetTransferStatus(ctx context.Context, providerRef string) (*provider.PayoutStatus, error) {
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			Status string `json:"status"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/transfer/"+providerRef, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("paystack: get transfer status: %s", resp.Message)
	}
	return &provider.PayoutStatus{Status: resp.Data.Status}, nil
}

// ParseWebhook normalizes a Paystack transfer/charge webhook envelope.
func (c *Client) ParseWebhook(payload []byte) (*provider.WebhookEvent, error) {
	var env struct {
		Event string `json:"event"`
		Data  struct {
			Reference    string `json:"reference"`
			TransferCode string `json:"transfer_code"`
			Amount       int64  `json:"amount"`
			Status       string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &env); err != nil {
		return nil, fmt.Errorf("paystack: parse webhook: %w", err)
	}
	ev := &provider.WebhookEvent{
		ProviderRef: env.Data.TransferCode,
		Reference:   env.Data.Reference,
		AmountKobo:  env.Data.Amount,
	}
	switch env.Event {
	case "transfer.success":
		ev.Type, ev.Status = "transfer", "successful"
	case "transfer.failed":
		ev.Type, ev.Status = "transfer", "failed"
	case "transfer.reversed":
		ev.Type, ev.Status = "transfer", "reversed"
	case "charge.success":
		ev.Type, ev.Status = "collection", "successful"
	default:
		ev.Type, ev.Status = "", "pending"
	}
	return ev, nil
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
		BankCode:      resp.Data.Bank.Slug, // Paystack returns a bank slug, not a numeric code
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
