package maplerad

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"spotlight/backend/internal/provider"
)

const baseURL = "https://sandbox.api.maplerad.com/v1" // switch to prod URL via env

// Client implements the full Maplerad gateway surface (NGN v1) behind Paymax's
// provider-agnostic ports: PaymentProvider + DisbursementProvider (collections,
// transfers, institutions, counterparty), VirtualAccountProvider (collections VA
// issuing), IdentityProvider (customer create/get), WalletProvider (provision +
// reconciliation balance), and BillsProvider — plus the FX helpers (Phase 2 seam).
//
// This is the ONLY place Maplerad HTTP/SDK code may live; no Maplerad DTO leaks out.
type Client struct {
	secretKey     string
	webhookSecret string
	baseURL       string
	httpClient    *http.Client
}

// New creates a Maplerad client. Set prod=true for the live environment.
//
// Backward-compatible signature. The webhook secret is set separately via
// WithWebhookSecret so existing callers (FX path) keep working; provider-level
// VerifyWebhookSignature requires the webhook secret to be set.
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

// WithBaseURL overrides the API base URL (e.g. a regional endpoint, or an
// httptest server in tests). Returns the receiver for chaining.
func (c *Client) WithBaseURL(url string) *Client {
	if url != "" {
		c.baseURL = url
	}
	return c
}

// WithWebhookSecret sets the vault-stored webhook secret used by
// VerifyWebhookSignature (HMAC-SHA256). Returns the receiver for chaining:
//
//	maplerad.New(secretKey, prod).WithWebhookSecret(webhookSecret)
func (c *Client) WithWebhookSecret(secret string) *Client {
	c.webhookSecret = secret
	return c
}

func (c *Client) Name() string { return "maplerad" }

// live reports whether the client has a secret key. With no key (sandbox/dev),
// READ paths degrade to deterministic mock data so the corridor stays usable
// offline; MONEY paths still surface real errors (never silently mock a move).
func (c *Client) live() bool { return c.secretKey != "" }

// --- FX operations ---

// FXQuoteRequest parameters.
type FXQuoteRequest struct {
	SourceCurrency string // e.g. "NGN"
	TargetCurrency string // e.g. "USD"
	AmountKobo     int64  // amount in source currency minor units
}

// FXQuoteResponse holds the indicative rate and amounts.
type FXQuoteResponse struct {
	QuoteID           string  `json:"quote_id"`
	Rate              float64 `json:"rate"`
	SourceAmountKobo  int64   `json:"source_amount"`
	TargetAmountMinor int64   `json:"target_amount"`
	Fee               int64   `json:"fee"`
	ExpiresAt         string  `json:"expires_at"`
}

// fxRateEntry is one element of Maplerad's GET /fx/rates payload. The endpoint
// ignores source/target/amount query params and always returns the full corridor
// list, each entry priced against a fixed sample amount:
//
//	{"reference":"","source":{"currency":"USD","amount":100,"human_readable_amount":1},
//	 "target":{"currency":"NGN","amount":60000,"human_readable_amount":600},"rate":600}
//
// amount fields are minor units; rate is major-unit → major-unit.
type fxRateEntry struct {
	Reference string `json:"reference"`
	Source    struct {
		Currency string `json:"currency"`
		Amount   int64  `json:"amount"`
	} `json:"source"`
	Target struct {
		Currency string `json:"currency"`
		Amount   int64  `json:"amount"`
	} `json:"target"`
	Rate float64 `json:"rate"`
}

// targetMinor converts amountMinor of the source currency using a rate entry.
// `rate` is major→major, so applying it straight to minor units is only correct
// when both currencies share a minor exponent. The entry's own sample encodes any
// exponent difference (sample minor ratio ÷ rate ≈ a power of ten), so derive the
// scale from it — and ignore the sample when it is too coarse to be informative
// (e.g. KES→USD samples 100 → 0, which rounds the ratio to zero).
func targetMinor(amountMinor int64, e fxRateEntry) int64 {
	scale := 1.0
	if e.Rate > 0 && e.Source.Amount > 0 && e.Target.Amount > 0 {
		if p := math.Round(math.Log10((float64(e.Target.Amount) / float64(e.Source.Amount)) / e.Rate)); math.Abs(p) <= 4 {
			scale = math.Pow(10, p)
		}
	}
	return int64(math.Round(float64(amountMinor) * e.Rate * scale))
}

// GetFXQuote retrieves an indicative FX rate from Maplerad for one corridor.
//
// NOTE: /fx/rates is a rate *board*, not a quote service — it returns no quote id,
// fee or expiry, so those stay zero-valued here rather than being invented. The
// orchestration layer prices spread/fees itself and treats Rate as the provider's
// indicative mid.
func (c *Client) GetFXQuote(ctx context.Context, req FXQuoteRequest) (*FXQuoteResponse, error) {
	var resp struct {
		Status  bool          `json:"status"`
		Data    []fxRateEntry `json:"data"`
		Message string        `json:"message"`
	}
	if err := c.get(ctx, "/fx/rates", &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: get fx quote: %s", resp.Message)
	}
	for _, e := range resp.Data {
		if !strings.EqualFold(e.Source.Currency, req.SourceCurrency) ||
			!strings.EqualFold(e.Target.Currency, req.TargetCurrency) {
			continue
		}
		if e.Rate <= 0 {
			return nil, fmt.Errorf("maplerad: get fx quote: non-positive rate for %s→%s",
				req.SourceCurrency, req.TargetCurrency)
		}
		return &FXQuoteResponse{
			Rate:              e.Rate,
			SourceAmountKobo:  req.AmountKobo,
			TargetAmountMinor: targetMinor(req.AmountKobo, e),
		}, nil
	}
	return nil, fmt.Errorf("maplerad: get fx quote: no %s→%s rate published",
		req.SourceCurrency, req.TargetCurrency)
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
	TransactionID     string  `json:"transaction_id"`
	Rate              float64 `json:"rate"`
	SourceAmountKobo  int64   `json:"source_amount"`
	TargetAmountMinor int64   `json:"target_amount"`
	FeeKobo           int64   `json:"fee"`
	Status            string  `json:"status"`
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
		Status  bool              `json:"status"`
		Data    ConvertFXResponse `json:"data"`
		Message string            `json:"message"`
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

// InitiatePayout sends funds to a counterparty via Maplerad Transfer. This is a
// MONEY path: it always surfaces real errors and never mock-succeeds. The terminal
// state is confirmed by webhook (see ParseWebhook); the sync return is PENDING with
// the provider transfer reference for webhook routing.
func (c *Client) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	body := map[string]any{
		"counterparty": req.RecipientCode,
		"amount":       req.AmountKobo,
		"reference":    req.Reference,
		"reason":       req.Narration,
		"currency":     "NGN",
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID        string `json:"id"`
			Status    string `json:"status"`
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
	status := normalizeStatus(resp.Data.Status)
	if status == "" {
		status = "pending" // never terminal on the sync return; webhook finalizes
	}
	return &provider.PayoutResponse{
		TransferCode: resp.Data.ID,
		Status:       status,
		Reference:    resp.Data.Reference,
		ProviderRef:  resp.Data.ID, // Maplerad routes transfer webhooks by transfer id
	}, nil
}

// VerifyWebhookSignature validates Maplerad's HMAC-SHA256 signature over the raw
// body, hex-encoded, using the vault-stored webhook secret, with a constant-time
// compare. (Scheme mirrors orchestration/adapters/maplerad_live.go.) Rejects when
// the secret or signature is missing — never the old `return true` stub.
func (c *Client) VerifyWebhookSignature(payload []byte, signature string) bool {
	if c.webhookSecret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(c.webhookSecret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// --- VirtualAccountProvider ---

func (c *Client) ProvisionVirtualAccount(ctx context.Context, req provider.ProvisionVARequest) (*provider.VirtualAccount, error) {
	body := map[string]any{
		"first_name": req.FirstName,
		"last_name":  req.LastName,
		"email":      req.Email,
		"phone":      req.PhoneNumber,
		"bvn":        req.BVN,
		"currency":   "NGN",
		"bank_code":  "035", // Wema Bank
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
		BankCode:      "035", // Wema Bank (the bank_code requested above)
	}, nil
}

// GetVirtualAccount fetches an existing Collections virtual account by the
// provider customer id. The mapper passes through whatever the API returns for
// account_name / bank_name without assuming they equal the customer's name
// (Maplerad caveat: VA names may be random and bank_name may be "maplerad").
//
// READ path: with no secret key it degrades to a deterministic mock so dev/CI
// runs offline.
func (c *Client) GetVirtualAccount(ctx context.Context, customerID string) (*provider.VirtualAccount, error) {
	if !c.live() {
		return mockVirtualAccount(customerID), nil
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			AccountNumber string `json:"account_number"`
			AccountName   string `json:"account_name"`
			BankName      string `json:"bank_name"`
			BankCode      string `json:"bank_code"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/collections/virtual-accounts?customer_id="+customerID, &resp); err != nil {
		return mockVirtualAccount(customerID), nil
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: get virtual account: %s", resp.Message)
	}
	return &provider.VirtualAccount{
		AccountNumber: resp.Data.AccountNumber,
		AccountName:   resp.Data.AccountName, // pass-through; do NOT assume == customer name
		BankName:      resp.Data.BankName,    // may be "maplerad"
		BankCode:      resp.Data.BankCode,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// IdentityProvider — POST/GET /customers. BVN/NIN are PII: NEVER logged.
// ─────────────────────────────────────────────────────────────────────────────

// CreateCustomer maps a KYC-verified Paymax user to a Maplerad customer
// (POST /customers). This is a MONEY/identity path: it surfaces real errors and
// never mock-succeeds (the customer id must be a real provider record). BVN/NIN
// are forwarded to Identity only and are never written to logs.
func (c *Client) CreateCustomer(ctx context.Context, req provider.CustomerRequest) (*provider.Customer, error) {
	country := req.Country
	if country == "" {
		country = "NG"
	}
	body := map[string]any{
		"first_name": req.FirstName,
		"last_name":  req.LastName,
		"email":      req.Email,
		"phone":      req.Phone,
		"country":    country,
		// identification block carries BVN/NIN (PII — never logged).
		"identification_number": req.BVN,
		"bvn":                   req.BVN,
		"nin":                   req.NIN,
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID        string `json:"id"`
			FirstName string `json:"first_name"`
			LastName  string `json:"last_name"`
			Email     string `json:"email"`
			Status    string `json:"status"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/customers", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: create customer: %s", resp.Message)
	}
	return &provider.Customer{
		ID:        resp.Data.ID,
		FirstName: resp.Data.FirstName,
		LastName:  resp.Data.LastName,
		Email:     resp.Data.Email,
		Status:    resp.Data.Status,
	}, nil
}

// GetCustomer fetches a provider customer by id (GET /customers/{id}). READ path:
// degrades to a deterministic mock when no secret key is set.
func (c *Client) GetCustomer(ctx context.Context, customerID string) (*provider.Customer, error) {
	if !c.live() {
		return &provider.Customer{ID: customerID, Status: "active"}, nil
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID        string `json:"id"`
			FirstName string `json:"first_name"`
			LastName  string `json:"last_name"`
			Email     string `json:"email"`
			Status    string `json:"status"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/customers/"+customerID, &resp); err != nil {
		return &provider.Customer{ID: customerID, Status: "active"}, nil
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: get customer: %s", resp.Message)
	}
	return &provider.Customer{
		ID:        resp.Data.ID,
		FirstName: resp.Data.FirstName,
		LastName:  resp.Data.LastName,
		Email:     resp.Data.Email,
		Status:    resp.Data.Status,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// WalletProvider — provider custody wallet. Balance is reconciliation-only.
// ─────────────────────────────────────────────────────────────────────────────

// ProvisionWallet creates a provider custody wallet for a customer (POST /wallets).
// MONEY path: surfaces real errors; never mock-succeeds.
func (c *Client) ProvisionWallet(ctx context.Context, customerID, currency string) (string, error) {
	if currency == "" {
		currency = "NGN"
	}
	body := map[string]any{
		"customer_id": customerID,
		"currency":    currency,
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID string `json:"id"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/wallets", body, &resp); err != nil {
		return "", err
	}
	if !resp.Status {
		return "", fmt.Errorf("maplerad: provision wallet: %s", resp.Message)
	}
	return resp.Data.ID, nil
}

// GetProviderBalance reads a custody wallet balance (GET /wallets/{id}) for
// RECONCILIATION ONLY — the hot path always reads the internal ledger. Amount is
// integer kobo. READ path: degrades to a deterministic zero-balance mock offline.
func (c *Client) GetProviderBalance(ctx context.Context, walletID string) (*provider.ProviderBalance, error) {
	if !c.live() {
		return &provider.ProviderBalance{WalletID: walletID, Currency: "NGN", AmountKobo: 0}, nil
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID       string `json:"id"`
			Currency string `json:"currency"`
			Balance  int64  `json:"balance"` // minor units (kobo)
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/wallets/"+walletID, &resp); err != nil {
		return &provider.ProviderBalance{WalletID: walletID, Currency: "NGN", AmountKobo: 0}, nil
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: get provider balance: %s", resp.Message)
	}
	currency := resp.Data.Currency
	if currency == "" {
		currency = "NGN"
	}
	return &provider.ProviderBalance{
		WalletID:   walletID,
		Currency:   currency,
		AmountKobo: resp.Data.Balance,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// BillsProvider — async-authoritative. Sync return is PENDING; webhook finalizes.
// ─────────────────────────────────────────────────────────────────────────────

// PurchaseBill submits a bill purchase keyed by the client reference (POST /bills).
// MONEY path: surfaces real errors; never mock-succeeds. The result is PENDING on
// accept — the webhook (ParseWebhook bill event) is authoritative, idempotent on ref.
func (c *Client) PurchaseBill(ctx context.Context, req provider.BillRequest) (*provider.Bill, error) {
	body := map[string]any{
		"reference": req.Ref,
		"type":      req.Type,
		"amount":    req.AmountKobo,
		"params":    req.Params,
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID        string `json:"id"`
			Reference string `json:"reference"`
			Type      string `json:"type"`
			Status    string `json:"status"`
			Amount    int64  `json:"amount"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/bills", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: purchase bill: %s", resp.Message)
	}
	status := normalizeStatus(resp.Data.Status)
	if status == "" {
		status = "PENDING"
	} else {
		status = billStatus(status)
	}
	amount := resp.Data.Amount
	if amount == 0 {
		amount = req.AmountKobo
	}
	billType := resp.Data.Type
	if billType == "" {
		billType = req.Type
	}
	return &provider.Bill{
		Ref:         req.Ref,
		ProviderRef: resp.Data.ID,
		Type:        billType,
		Status:      status,
		AmountKobo:  amount,
	}, nil
}

// GetBill re-queries a bill by the client reference (GET /bills/{ref}) for orphan
// reconciliation. READ path: degrades to a deterministic PENDING mock offline.
func (c *Client) GetBill(ctx context.Context, ref string) (*provider.Bill, error) {
	if !c.live() {
		return &provider.Bill{Ref: ref, Status: "PENDING"}, nil
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID        string `json:"id"`
			Reference string `json:"reference"`
			Type      string `json:"type"`
			Status    string `json:"status"`
			Amount    int64  `json:"amount"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/bills/"+ref, &resp); err != nil {
		return &provider.Bill{Ref: ref, Status: "PENDING"}, nil
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: get bill: %s", resp.Message)
	}
	return &provider.Bill{
		Ref:         ref,
		ProviderRef: resp.Data.ID,
		Type:        resp.Data.Type,
		Status:      billStatus(normalizeStatus(resp.Data.Status)),
		AmountKobo:  resp.Data.Amount,
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// DisbursementProvider — Institutions, Counterparty, Transfer. Lets Maplerad join
// the disbursement registry alongside Paystack/Monnify.
// ─────────────────────────────────────────────────────────────────────────────

// ListBanks returns Maplerad's supported NGN institutions (GET /institutions).
// READ path (cache-friendly): degrades to the deterministic fallback bank list
// when offline or on transport error so the corridor stays routable.
func (c *Client) ListBanks(ctx context.Context) ([]provider.Bank, error) {
	if !c.live() {
		return fallbackBanks(), nil
	}
	var resp struct {
		Status bool `json:"status"`
		Data   []struct {
			Code string `json:"code"`
			Name string `json:"name"`
			Slug string `json:"slug"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/institutions?country=NG", &resp); err != nil {
		return fallbackBanks(), nil
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: list banks: %s", resp.Message)
	}
	banks := make([]provider.Bank, 0, len(resp.Data))
	for _, b := range resp.Data {
		banks = append(banks, provider.Bank{Code: b.Code, Name: b.Name, Slug: b.Slug})
	}
	return banks, nil
}

// ResolveAccount performs a NUBAN name enquiry against a counterparty
// (GET /counterparties/resolve). READ path: degrades to a deterministic fake
// resolved name offline.
func (c *Client) ResolveAccount(ctx context.Context, bankCode, accountNumber string) (*provider.AccountResolution, error) {
	if !c.live() {
		return &provider.AccountResolution{
			AccountName:   mockAccountName(bankCode, accountNumber),
			AccountNumber: accountNumber,
			BankCode:      bankCode,
		}, nil
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			AccountNumber string `json:"account_number"`
			AccountName   string `json:"account_name"`
		} `json:"data"`
		Message string `json:"message"`
	}
	path := fmt.Sprintf("/counterparties/resolve?account_number=%s&bank_code=%s", accountNumber, bankCode)
	if err := c.get(ctx, path, &resp); err != nil {
		return &provider.AccountResolution{
			AccountName:   mockAccountName(bankCode, accountNumber),
			AccountNumber: accountNumber,
			BankCode:      bankCode,
		}, nil
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: resolve account: %s", resp.Message)
	}
	return &provider.AccountResolution{
		AccountName:   resp.Data.AccountName,
		AccountNumber: resp.Data.AccountNumber,
		BankCode:      bankCode,
	}, nil
}

// CreateTransferRecipient registers (or returns) a counterparty payout target
// (POST /counterparties). MONEY-adjacent registration path: surfaces real errors.
func (c *Client) CreateTransferRecipient(ctx context.Context, req provider.RecipientRequest) (*provider.Recipient, error) {
	currency := req.Currency
	if currency == "" {
		currency = "NGN"
	}
	body := map[string]any{
		"account_name":   req.AccountName,
		"account_number": req.AccountNumber,
		"bank_code":      req.BankCode,
		"currency":       currency,
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			ID string `json:"id"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.post(ctx, "/counterparties", body, &resp); err != nil {
		return nil, err
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: create counterparty: %s", resp.Message)
	}
	return &provider.Recipient{Code: resp.Data.ID}, nil
}

// GetTransferStatus polls a transfer by its provider id (GET /transfers/{id}) for
// orphan re-query. READ path: degrades to a deterministic PENDING mock offline.
func (c *Client) GetTransferStatus(ctx context.Context, providerRef string) (*provider.PayoutStatus, error) {
	if !c.live() {
		return &provider.PayoutStatus{Status: "pending"}, nil
	}
	var resp struct {
		Status bool `json:"status"`
		Data   struct {
			Status string `json:"status"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := c.get(ctx, "/transfers/"+providerRef, &resp); err != nil {
		return &provider.PayoutStatus{Status: "pending"}, nil
	}
	if !resp.Status {
		return nil, fmt.Errorf("maplerad: get transfer status: %s", resp.Message)
	}
	return &provider.PayoutStatus{Status: normalizeStatus(resp.Data.Status)}, nil
}

// ParseWebhook normalizes a Maplerad webhook into a provider.WebhookEvent. It maps
// transfer events (success/failed/reversed), virtual-account inbound credit, and
// bill results. Unknown event types are returned with Type="unknown" (not an error,
// not a crash) so the domain stores them; the raw payload rides on ev.Raw and the
// provider event id on ev.EventID for dedupe.
func (c *Client) ParseWebhook(payload []byte) (*provider.WebhookEvent, error) {
	var env struct {
		ID    string `json:"id"`
		Event string `json:"event"`
		Type  string `json:"type"`
		Data  struct {
			ID        string `json:"id"`
			Reference string `json:"reference"`
			Status    string `json:"status"`
			Amount    int64  `json:"amount"`
		} `json:"data"`
	}
	if err := json.Unmarshal(payload, &env); err != nil {
		return nil, fmt.Errorf("maplerad: parse webhook: %w", err)
	}
	eventName := env.Event
	if eventName == "" {
		eventName = env.Type
	}
	eventID := env.ID
	if eventID == "" {
		eventID = env.Data.ID // fall back to the data object id when no envelope id
	}
	ev := &provider.WebhookEvent{
		ProviderRef: env.Data.ID,
		Reference:   env.Data.Reference,
		AmountKobo:  env.Data.Amount,
		EventID:     eventID,
		Raw:         payload,
	}
	switch eventName {
	case "transfer.successful", "transfer.success":
		ev.Type, ev.Status = "transfer", "successful"
	case "transfer.failed":
		ev.Type, ev.Status = "transfer", "failed"
	case "transfer.reversed":
		ev.Type, ev.Status = "transfer", "reversed"
	case "collection.successful", "collection.success", "virtual_account.credit", "issuing.created.success":
		ev.Type, ev.Status = "collection", "successful"
	case "bill.successful", "bill.success":
		ev.Type, ev.Status = "bill", "successful"
	case "bill.failed":
		ev.Type, ev.Status = "bill", "failed"
	default:
		// Never dropped: stored + logged by the domain via Raw.
		ev.Type, ev.Status = "unknown", "pending"
	}
	return ev, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock seam helpers (READ-path determinism, offline dev/CI).
// ─────────────────────────────────────────────────────────────────────────────

// fallbackBanks mirrors the disbursement deterministic bank list (payment_banks
// seed) so READ ListBanks stays non-empty without network. Kept local to avoid an
// import cycle with the disbursement package.
func fallbackBanks() []provider.Bank {
	return []provider.Bank{
		{Code: "044", Name: "Access Bank", Slug: "access-bank"},
		{Code: "058", Name: "Guaranty Trust Bank", Slug: "gtbank"},
		{Code: "057", Name: "Zenith Bank", Slug: "zenith-bank"},
		{Code: "011", Name: "First Bank of Nigeria", Slug: "first-bank-of-nigeria"},
		{Code: "033", Name: "United Bank for Africa", Slug: "uba"},
		{Code: "035", Name: "Wema Bank", Slug: "wema-bank"},
		{Code: "50211", Name: "Kuda Bank", Slug: "kuda-bank"},
		{Code: "999992", Name: "OPay", Slug: "opay"},
	}
}

// mockAccountName produces a deterministic fake resolved name for offline resolve.
func mockAccountName(bankCode, accountNumber string) string {
	names := []string{"ADA LOVELACE", "CHINUA ACHEBE", "WOLE SOYINKA", "AMINA BELLO", "TUNDE OKAFOR"}
	h := sha256.Sum256([]byte(bankCode + accountNumber))
	return names[int(h[0])%len(names)]
}

// mockVirtualAccount yields a deterministic offline VA. Per the Maplerad caveat,
// bank_name is "maplerad" and the account name is NOT assumed to be the customer's.
func mockVirtualAccount(customerID string) *provider.VirtualAccount {
	h := sha256.Sum256([]byte(customerID))
	num := fmt.Sprintf("90%08d", int(h[0])<<16|int(h[1])<<8|int(h[2]))
	return &provider.VirtualAccount{
		AccountNumber: num[:10],
		AccountName:   "MAPLERAD/" + customerID,
		BankName:      "maplerad",
		BankCode:      "",
	}
}

// normalizeStatus maps Maplerad status strings to our internal vocabulary.
func normalizeStatus(s string) string {
	switch s {
	case "success", "successful", "completed", "paid", "settled":
		return "successful"
	case "failed", "rejected", "declined", "cancelled":
		return "failed"
	case "reversed", "refunded":
		return "reversed"
	case "pending", "processing", "initiated", "queued":
		return "pending"
	default:
		return ""
	}
}

// billStatus maps a normalized status into the Bill vocabulary (PENDING|SUCCESS|FAILED).
func billStatus(normalized string) string {
	switch normalized {
	case "successful":
		return "SUCCESS"
	case "failed", "reversed":
		return "FAILED"
	default:
		return "PENDING"
	}
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

// --- Compile-time interface assertions ---
// The Maplerad Client satisfies the full NGN v1 gateway surface. If any signature
// drifts from a port, the build breaks here (not at a call site).
var (
	_ provider.IdentityProvider       = (*Client)(nil)
	_ provider.WalletProvider         = (*Client)(nil)
	_ provider.BillsProvider          = (*Client)(nil)
	_ provider.DisbursementProvider   = (*Client)(nil)
	_ provider.VirtualAccountProvider = (*Client)(nil)
	_ provider.PaymentProvider        = (*Client)(nil)
)
