package paystack

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/internal/provider"
)

const defaultBaseURL = "https://api.paystack.co"

// Client implements provider.PaymentProvider and provider.VirtualAccountProvider.
type Client struct {
	secretKey  string
	baseURL    string
	httpClient *http.Client
}

// New creates a Paystack client against the live API.
func New(secretKey string) *Client {
	return NewWithBaseURL(secretKey, "")
}

// NewWithBaseURL creates a Paystack client against a non-default API base URL —
// the seam a local/dev environment uses to point the whole provider surface
// (initialize/verify/refund/transfers/VA) at the Paystack fake (tools/fakes)
// via PAYSTACK_BASE_URL instead of api.paystack.co. An empty baseURL keeps the
// live default; a configured one has any trailing slash trimmed so request
// paths stay "/transaction/verify/..." shaped.
func NewWithBaseURL(secretKey, baseURL string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		secretKey:  secretKey,
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *Client) Name() string { return "paystack" }

func (c *Client) InitializePayment(ctx context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error) {
	body := map[string]any{
		"email":        req.Email,
		"amount":       req.AmountKobo,
		"reference":    req.Reference,
		"callback_url": req.CallbackURL,
	}
	var resp struct {
		Status bool `json:"status"`
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
			Status    string `json:"status"`
			Reference string `json:"reference"`
			Amount    int64  `json:"amount"`
			Currency  string `json:"currency"`
			Channel   string `json:"channel"`
			PaidAt    string `json:"paid_at"`
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
		Currency:   resp.Data.Currency,
		Channel:    resp.Data.Channel,
		PaidAt:     paidAt,
	}, nil
}

// RefundPayment reverses a previously-collected charge via Paystack's
// /refund endpoint. Used by callers that collected money for something they
// then could not fulfill and must return it the same way it arrived (an
// EXTERNAL reversal), rather than crediting an internal wallet — see
// restaurant.PlaceOrderPaystackFunded's amount-mismatch failure path for why
// that distinction matters. amountKobo is optional to Paystack (omitting it
// refunds the full transaction); this adapter always sends it explicitly so
// a caller can never accidentally trigger a full refund by a zero value —
// callers must pass the exact amount they intend to reverse.
func (c *Client) RefundPayment(ctx context.Context, reference string, amountKobo int64) (*provider.RefundResult, error) {
	return c.RefundPaymentNoted(ctx, reference, amountKobo, "")
}

// RefundPaymentNoted is RefundPayment that also stamps the refund with a
// merchant note (sent as merchant_note; omitted when empty). A transaction may
// carry several PARTIAL refunds (car hire: fare then deposit); the note is the
// caller's per-refund identity, echoed back by LookupRefunds. Paystack has no
// client idempotency key for refunds, so the note is a hint — the caller's
// lookup arithmetic (sum of accepted refunds) is what guarantees safety.
func (c *Client) RefundPaymentNoted(ctx context.Context, reference string, amountKobo int64, note string) (*provider.RefundResult, error) {
	if amountKobo <= 0 {
		return nil, fmt.Errorf("paystack: refund amount must be positive, got %d", amountKobo)
	}
	body := map[string]any{
		"transaction": reference,
		"amount":      amountKobo,
	}
	if note != "" {
		body["merchant_note"] = note
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID          int64 `json:"id"`
			Transaction struct {
				Reference string `json:"reference"`
			} `json:"transaction"`
			Status       string `json:"status"`
			Amount       int64  `json:"amount"`
			MerchantNote string `json:"merchant_note"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/refund", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		if isAlreadyReversedMessage(resp.Message) {
			return nil, fmt.Errorf("paystack: refund %s: %s: %w", reference, resp.Message, provider.ErrAlreadyReversed)
		}
		return nil, fmt.Errorf("paystack: refund %s: %s", reference, resp.Message)
	}
	ref := resp.Data.Transaction.Reference
	if ref == "" {
		ref = reference
	}
	// The refund STATUS is part of the answer: Paystack can accept the request
	// (status:true) and still report the refund itself as failed. That is NOT a
	// refunded customer. pending/processing/processed are accepted; failed is a
	// definite non-refund; anything else is returned as-is for the caller to
	// treat as AMBIGUOUS and resolve by LookupRefund.
	if strings.EqualFold(resp.Data.Status, provider.RefundStatusFailed) {
		return nil, fmt.Errorf("paystack: refund %s: %w", reference, provider.ErrRefundFailed)
	}
	out := &provider.RefundResult{
		Reference:  ref,
		Status:     resp.Data.Status,
		AmountKobo: resp.Data.Amount,
		Note:       resp.Data.MerchantNote,
	}
	if resp.Data.ID != 0 {
		out.ID = strconv.FormatInt(resp.Data.ID, 10)
	}
	return out, nil
}

// isAlreadyReversedMessage recognises Paystack's "this transaction was already
// (fully) reversed/refunded" answers. A match is NOT proof the earlier refund
// succeeded — callers must LookupRefund.
func isAlreadyReversedMessage(msg string) bool {
	m := strings.ToLower(msg)
	return (strings.Contains(m, "revers") || strings.Contains(m, "refunded")) &&
		(strings.Contains(m, "fully") || strings.Contains(m, "already"))
}

// LookupRefund returns the refund Paystack holds for a transaction reference
// (GET /refund?reference=…), or (nil, nil) when none exists. When several
// attempts exist, an accepted (processed/pending/processing) refund wins over a
// failed one: the customer is refunded if ANY attempt is. Any transport/API
// error is an error — never "no refund".
func (c *Client) LookupRefund(ctx context.Context, reference string) (*provider.RefundResult, error) {
	var resp struct {
		Status bool `json:"status"`
		Data   []struct {
			ID                   int64  `json:"id"`
			Amount               int64  `json:"amount"`
			Status               string `json:"status"`
			TransactionReference string `json:"transaction_reference"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/refund?perPage=50&reference="+url.QueryEscape(reference), &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("paystack: lookup refund %s: %s", reference, resp.Message)
	}
	var best *provider.RefundResult
	for _, r := range resp.Data {
		ref := r.TransactionReference
		if ref == "" {
			ref = reference
		}
		cand := &provider.RefundResult{Reference: ref, Status: r.Status, AmountKobo: r.Amount}
		if best == nil || (!provider.RefundAccepted(best.Status) && provider.RefundAccepted(cand.Status)) ||
			(best.Status != provider.RefundStatusProcessed && cand.Status == provider.RefundStatusProcessed) {
			best = cand
		}
	}
	return best, nil
}

// maxRefundListPages bounds LookupRefunds' paging: a transaction has a handful of
// refunds, so a list longer than this is a malformed/hostile answer — an ERROR,
// never a silently truncated total (a truncated list would under-count accepted
// refunds and allow an over-refund).
const maxRefundListPages = 20

// LookupRefunds returns EVERY refund Paystack holds for a transaction
// (GET /refund?reference=…, all pages), failed attempts included, so a caller
// issuing several partial refunds can reconcile the accepted total against its
// own books. An empty list means none; any transport/API error is an error —
// never "no refunds". An entry whose transaction_reference names a DIFFERENT
// transaction is an error (it must never be counted against this one).
func (c *Client) LookupRefunds(ctx context.Context, reference string) ([]provider.RefundResult, error) {
	var out []provider.RefundResult
	for page := 1; ; page++ {
		if page > maxRefundListPages {
			return nil, fmt.Errorf("paystack: lookup refunds %s: more than %d pages", reference, maxRefundListPages)
		}
		var resp struct {
			Status bool `json:"status"`
			Meta   struct {
				PageCount int `json:"pageCount"`
			} `json:"meta"`
			Data []struct {
				ID                   int64  `json:"id"`
				Amount               int64  `json:"amount"`
				Status               string `json:"status"`
				TransactionReference string `json:"transaction_reference"`
				MerchantNote         string `json:"merchant_note"`
			} `json:"data"`
			Message string `json:"message"`
		}
		if err := c.get(ctx, fmt.Sprintf("/refund?perPage=100&page=%d&reference=%s", page, url.QueryEscape(reference)), &resp); err != nil {
			return nil, err
		}
		if !resp.Status {
			return nil, fmt.Errorf("paystack: lookup refunds %s: %s", reference, resp.Message)
		}
		for _, r := range resp.Data {
			if r.TransactionReference != "" && r.TransactionReference != reference {
				return nil, fmt.Errorf("paystack: lookup refunds %s: refund %d belongs to transaction %q", reference, r.ID, r.TransactionReference)
			}
			rr := provider.RefundResult{Reference: reference, Status: r.Status, AmountKobo: r.Amount, Note: r.MerchantNote}
			if r.ID != 0 {
				rr.ID = strconv.FormatInt(r.ID, 10)
			}
			out = append(out, rr)
		}
		if resp.Meta.PageCount <= page || len(resp.Data) == 0 {
			return out, nil
		}
	}
}

func (c *Client) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	body := map[string]any{
		"source":    "balance",
		"recipient": req.RecipientCode,
		"amount":    req.AmountKobo,
		"reference": req.Reference,
		"reason":    req.Narration,
	}
	var resp struct {
		Status bool `json:"status"`
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
	return cryptox.VerifyHMACSHA512(c.secretKey, payload, signature)
}

func (c *Client) ProvisionVirtualAccount(ctx context.Context, req provider.ProvisionVARequest) (*provider.VirtualAccount, error) {
	body := map[string]any{
		"email":          req.Email,
		"first_name":     req.FirstName,
		"last_name":      req.LastName,
		"phone":          req.PhoneNumber,
		"preferred_bank": "wema-bank",
		"bvn":            req.BVN,
	}
	var resp struct {
		Status bool `json:"status"`
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
	return nil, errors.New("paystack: GetVirtualAccount not implemented — use VA service repo")
}

func (c *Client) post(ctx context.Context, path string, body, dst any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("paystack: marshal request: %w", err)
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
		return fmt.Errorf("paystack: http request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("paystack: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("paystack: server error %d: %s", resp.StatusCode, string(b))
	}
	return json.Unmarshal(b, dst)
}
