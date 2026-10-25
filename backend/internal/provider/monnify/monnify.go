// Package monnify implements provider.DisbursementProvider and provider.IdNumberPort for Monnify
// (https://docs.monnify.com). Auth is a two-step OAuth: base64(apiKey:secretKey)
// is exchanged for a short-lived bearer token used on all subsequent calls.
// Money is integer kobo internally; Monnify's API is naira-major, so amounts are
// converted kobo↔naira only at the HTTP boundary (no float math on the money path
// — division by 100 of an integer kobo amount that is always a whole-naira value
// for our fee schedule). All credentials are server-side only.
package monnify

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/strutil"
	"spotlight/backend/internal/provider"
)

const sandboxURL = "https://sandbox.monnify.com"
const prodURL = "https://api.monnify.com"

// Client implements provider.DisbursementProvider and provider.IdNumberPort for Monnify.
type Client struct {
	apiKey        string
	secretKey     string
	contractCode  string
	webhookSecret string
	baseURL       string
	httpClient    *http.Client

	mu       sync.Mutex
	token    string
	tokenExp time.Time
}

// New builds a Monnify client. prod selects the live base URL.
func New(apiKey, secretKey, contractCode, webhookSecret string, prod bool) *Client {
	base := sandboxURL
	if prod {
		base = prodURL
	}
	return &Client{
		apiKey:        apiKey,
		secretKey:     secretKey,
		contractCode:  contractCode,
		webhookSecret: webhookSecret,
		baseURL:       base,
		httpClient:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) Name() string { return "monnify" }

func (c *Client) authToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.tokenExp) {
		return c.token, nil
	}
	basic := base64.StdEncoding.EncodeToString([]byte(c.apiKey + ":" + c.secretKey))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v1/auth/login", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Basic "+basic)
	var resp struct {
		RequestSuccessful bool `json:"requestSuccessful"`
		ResponseBody      struct {
			AccessToken string `json:"accessToken"`
			ExpiresIn   int64  `json:"expiresIn"`
		} `json:"responseBody"`
		ResponseMessage string `json:"responseMessage"`
	}
	if err := c.do(req, &resp); err != nil {
		return "", err
	}
	if !resp.RequestSuccessful || resp.ResponseBody.AccessToken == "" {
		return "", fmt.Errorf("monnify: auth: %s", resp.ResponseMessage)
	}
	c.token = resp.ResponseBody.AccessToken
	ttl := resp.ResponseBody.ExpiresIn
	if ttl <= 0 {
		ttl = 3000
	}
	c.tokenExp = time.Now().Add(time.Duration(ttl-60) * time.Second)
	return c.token, nil
}

// VerifyIDNumber performs a Monnify KYC data-match (BVN/NIN).
func (c *Client) VerifyIDNumber(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	var path string
	var body map[string]any

	switch strings.ToUpper(req.IDType) {
	case "BVN":
		path = "/api/v1/vas/bvn-details-match"
		body = map[string]any{
			"bvn":  req.IDNumber,
			"name": fmt.Sprintf("%s %s", req.FirstName, req.LastName),
		}
		if req.DOB != "" {
			if t, err := time.Parse("2006-01-02", req.DOB); err == nil {
				body["dateOfBirth"] = t.Format("02-Jan-2006")
			}
		}
	case "NIN":
		path = "/api/v1/vas/nin-details-match"
		body = map[string]any{
			"nin":  req.IDNumber,
			"name": fmt.Sprintf("%s %s", req.FirstName, req.LastName),
		}
		if req.DOB != "" {
			if t, err := time.Parse("2006-01-02", req.DOB); err == nil {
				body["dateOfBirth"] = t.Format("02-Jan-2006")
			}
		}
	default:
		return provider.KycCheckResult{
			Status: provider.KycFailed,
			Reason: "monnify: unsupported id_type " + req.IDType,
		}, nil
	}

	var resp struct {
		RequestSuccessful bool `json:"requestSuccessful"`
		ResponseBody      struct {
			BvnMatch bool `json:"bvnInformationMatch"`
			NinMatch bool `json:"ninInformationMatch"`
			Name     struct {
				MatchStatus     string  `json:"matchStatus"`
				MatchPercentage float64 `json:"matchPercentage"`
			} `json:"name"`
		} `json:"responseBody"`
		ResponseMessage string `json:"responseMessage"`
	}

	if err := c.post(ctx, path, body, &resp); err != nil {
		return provider.KycCheckResult{}, err
	}
	if !resp.RequestSuccessful {
		return provider.KycCheckResult{
			Status: provider.KycFailed,
			Reason: "monnify: verification failed: " + resp.ResponseMessage,
		}, nil
	}

	match := false
	confidence := 0.0
	if strings.ToUpper(req.IDType) == "BVN" {
		match = resp.ResponseBody.BvnMatch || resp.ResponseBody.Name.MatchStatus == "FULL_MATCH"
		confidence = resp.ResponseBody.Name.MatchPercentage
	} else {
		match = resp.ResponseBody.NinMatch
		confidence = 100.0
	}

	status := provider.KycFailed
	if match {
		status = provider.KycPassed
	}

	return provider.KycCheckResult{
		Status:     status,
		Match:      match,
		Confidence: confidence,
		Reason:     resp.ResponseMessage,
	}, nil
}

func (c *Client) ListBanks(ctx context.Context) ([]provider.Bank, error) {
	var resp struct {
		RequestSuccessful bool `json:"requestSuccessful"`
		ResponseBody      []struct {
			Code string `json:"code"`
			Name string `json:"name"`
		} `json:"responseBody"`
		ResponseMessage string `json:"responseMessage"`
	}
	if err := c.get(ctx, "/api/v1/banks", &resp); err != nil {
		return nil, err
	}
	if !resp.RequestSuccessful {
		return nil, fmt.Errorf("monnify: list banks: %s", resp.ResponseMessage)
	}
	banks := make([]provider.Bank, 0, len(resp.ResponseBody))
	for _, b := range resp.ResponseBody {
		banks = append(banks, provider.Bank{Code: b.Code, Name: b.Name})
	}
	return banks, nil
}

func (c *Client) ResolveAccount(ctx context.Context, bankCode, accountNumber string) (*provider.AccountResolution, error) {
	var resp struct {
		RequestSuccessful bool `json:"requestSuccessful"`
		ResponseBody      struct {
			AccountNumber string `json:"accountNumber"`
			AccountName   string `json:"accountName"`
		} `json:"responseBody"`
		ResponseMessage string `json:"responseMessage"`
	}
	// v1 validate is deprecated by Monnify; v2 is the same GET contract.
	path := fmt.Sprintf("/api/v2/disbursements/account/validate?accountNumber=%s&bankCode=%s", accountNumber, bankCode)
	if err := c.get(ctx, path, &resp); err != nil {
		return nil, err
	}
	if !resp.RequestSuccessful {
		return nil, fmt.Errorf("monnify: resolve account: %s", resp.ResponseMessage)
	}
	return &provider.AccountResolution{
		AccountName:   resp.ResponseBody.AccountName,
		AccountNumber: resp.ResponseBody.AccountNumber,
		BankCode:      bankCode,
	}, nil
}

func (c *Client) CreateTransferRecipient(ctx context.Context, req provider.RecipientRequest) (*provider.Recipient, error) {
	return &provider.Recipient{Code: "monnify:" + req.BankCode + ":" + req.AccountNumber}, nil
}

func (c *Client) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	bankCode, accountNumber := parseRecipientCode(req.RecipientCode)
	body := map[string]any{
		"amount":                   nairaFromKobo(req.AmountKobo),
		"reference":                req.Reference,
		"narration":                req.Narration,
		"destinationBankCode":      bankCode,
		"destinationAccountNumber": accountNumber,
		"currency":                 "NGN",
		"sourceAccountNumber":      c.contractCode,
	}
	var resp struct {
		RequestSuccessful bool `json:"requestSuccessful"`
		ResponseBody      struct {
			Reference string `json:"reference"`
			Status    string `json:"status"`
		} `json:"responseBody"`
		ResponseMessage string `json:"responseMessage"`
	}
	if err := c.post(ctx, "/api/v2/disbursements/single", body, &resp); err != nil {
		return nil, err
	}
	if !resp.RequestSuccessful {
		return nil, fmt.Errorf("monnify: initiate payout: %s", resp.ResponseMessage)
	}
	return &provider.PayoutResponse{
		TransferCode: resp.ResponseBody.Reference,
		Status:       normalizeStatus(resp.ResponseBody.Status),
		Reference:    resp.ResponseBody.Reference,
		ProviderRef:  resp.ResponseBody.Reference,
	}, nil
}

func (c *Client) GetTransferStatus(ctx context.Context, providerRef string) (*provider.PayoutStatus, error) {
	var resp struct {
		RequestSuccessful bool `json:"requestSuccessful"`
		ResponseBody      struct {
			Status string `json:"status"`
		} `json:"responseBody"`
		ResponseMessage string `json:"responseMessage"`
	}
	path := "/api/v2/disbursements/single/summary?reference=" + providerRef
	if err := c.get(ctx, path, &resp); err != nil {
		return nil, err
	}
	if !resp.RequestSuccessful {
		return nil, fmt.Errorf("monnify: get transfer status: %s", resp.ResponseMessage)
	}
	return &provider.PayoutStatus{Status: normalizeStatus(resp.ResponseBody.Status)}, nil
}

func (c *Client) VerifyWebhookSignature(payload []byte, signature string) bool {
	if c.webhookSecret == "" || signature == "" {
		return false
	}
	return cryptox.VerifyHMACSHA512(c.webhookSecret, payload, signature)
}

func (c *Client) ParseWebhook(payload []byte) (*provider.WebhookEvent, error) {
	var env struct {
		EventType string `json:"eventType"`
		EventData struct {
			Reference            string  `json:"reference"`
			TransactionReference string  `json:"transactionReference"`
			Status               string  `json:"status"`
			Amount               float64 `json:"amount"`
			AmountPaid           float64 `json:"amountPaid"`
		} `json:"eventData"`
	}
	if err := json.Unmarshal(payload, &env); err != nil {
		return nil, fmt.Errorf("monnify: parse webhook: %w", err)
	}
	ev := &provider.WebhookEvent{
		ProviderRef: strutil.FirstNonEmpty(env.EventData.Reference, env.EventData.TransactionReference),
		Reference:   env.EventData.Reference,
		Status:      normalizeStatus(env.EventData.Status),
	}
	amt := env.EventData.Amount
	if amt == 0 {
		amt = env.EventData.AmountPaid
	}
	ev.AmountKobo = koboFromNaira(amt)
	switch env.EventType {
	case "SUCCESSFUL_DISBURSEMENT", "FAILED_DISBURSEMENT", "REVERSED_DISBURSEMENT":
		ev.Type = "transfer"
	case "SUCCESSFUL_TRANSACTION":
		ev.Type = "collection"
	default:
		ev.Type = ""
	}
	switch env.EventType {
	case "SUCCESSFUL_DISBURSEMENT", "SUCCESSFUL_TRANSACTION":
		ev.Status = "successful"
	case "FAILED_DISBURSEMENT":
		ev.Status = "failed"
	case "REVERSED_DISBURSEMENT":
		ev.Status = "reversed"
	}
	return ev, nil
}

func normalizeStatus(s string) string {
	switch s {
	case "SUCCESS", "SUCCESSFUL", "PAID", "COMPLETED":
		return "successful"
	case "FAILED", "REJECTED", "EXPIRED":
		return "failed"
	case "REVERSED":
		return "reversed"
	default:
		return "pending"
	}
}

func nairaFromKobo(kobo int64) int64 { return kobo / 100 }
func koboFromNaira(naira float64) int64 {
	return int64(naira*100 + 0.5)
}

func parseRecipientCode(code string) (bankCode, accountNumber string) {
	const prefix = "monnify:"
	if len(code) > len(prefix) && code[:len(prefix)] == prefix {
		rest := code[len(prefix):]
		for i := range len(rest) {
			if rest[i] == ':' {
				return rest[:i], rest[i+1:]
			}
		}
	}
	return "", code
}

func (c *Client) post(ctx context.Context, path string, body, dst any) error {
	token, err := c.authToken(ctx)
	if err != nil {
		return err
	}
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("monnify: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, dst)
}

func (c *Client) get(ctx context.Context, path string, dst any) error {
	token, err := c.authToken(ctx)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return c.do(req, dst)
}

func (c *Client) do(req *http.Request, dst any) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("monnify: http request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("monnify: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("monnify: server error %d: %s", resp.StatusCode, string(b))
	}
	return json.Unmarshal(b, dst)
}
