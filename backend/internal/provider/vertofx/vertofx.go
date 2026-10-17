// Package vertofx is a thin HTTP client for the VertoFX API (cross-border FX
// provider). Auth is POST /users/login {clientId, apiKey} -> bearer token +
// companyId. Tokens live 60 minutes with no refresh endpoint, so the client
// caches the token for ~50 minutes and re-logs-in (single-flight) when expired.
//
// NOTE: wire shapes follow the design spec Appendix B ("Verto call map");
// several paths are marked unconfirmed there. Verify against the live sandbox
// before production (this client was authored without network access).
// Amounts are in the client's native units (Verto uses major units); unit
// conversion is the orchestration adapter's job. All Verto types stay here.
package vertofx

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	sandboxBaseURL = "https://sandbox.vertofx.com"
	prodBaseURL    = "https://api.vertofx.com"
	tokenTTL       = 50 * time.Minute // Verto tokens last 60 min; refresh early
	rateTTL        = 30 * time.Second // vfxToken validity
	maxRetries     = 3
)

// Client is a token-caching VertoFX client.
type Client struct {
	clientID      string
	apiKey        string
	baseURL       string
	webhookSecret string
	prod          bool
	httpClient    *http.Client

	mu        sync.Mutex // held across login: single-flight
	token     string
	companyID string
	tokenExp  time.Time
}

// New builds a client. With empty credentials it runs in offline-mock mode.
func New(clientID, apiKey string, prod bool) *Client {
	base := sandboxBaseURL
	if prod {
		base = prodBaseURL
	}
	return &Client{
		clientID:   clientID,
		apiKey:     apiKey,
		baseURL:    base,
		prod:       prod,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// WithBaseURL overrides the API base URL (tests / regional endpoints).
func (c *Client) WithBaseURL(u string) *Client {
	if u != "" {
		c.baseURL = strings.TrimRight(u, "/")
	}
	return c
}

// WithWebhookSecret sets the secret used by VerifyWebhookSignature.
func (c *Client) WithWebhookSecret(secret string) *Client {
	c.webhookSecret = secret
	return c
}

// Name is the provider identifier.
func (c *Client) Name() string { return "vertofx" }

// live reports whether credentials are configured. Without them every method
// returns deterministic stub data and makes no HTTP call.
func (c *Client) live() bool { return c.clientID != "" && c.apiKey != "" }

// ensureToken returns a valid bearer token, logging in when none is cached or
// the cached one is past its (early) expiry. The mutex makes concurrent
// callers share a single login.
func (c *Client) ensureToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && time.Now().Before(c.tokenExp) {
		return c.token, nil
	}
	payload, _ := json.Marshal(map[string]string{
		"clientId": c.clientID,
		"apiKey":   c.apiKey,
		"mode":     map[bool]string{true: "live", false: "sandbox"}[c.prod],
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/users/login", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", fmt.Errorf("vertofx: login %d: %s", resp.StatusCode, string(body))
	}
	var out struct {
		Data struct {
			Token     string `json:"token"`
			CompanyID string `json:"companyId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.Data.Token == "" {
		return "", errors.New("vertofx: login: invalid response")
	}
	c.token = out.Data.Token
	c.companyID = out.Data.CompanyID
	c.tokenExp = time.Now().Add(tokenTTL)
	return c.token, nil
}

// invalidate drops the cached token if it still equals tok.
func (c *Client) invalidate(tok string) {
	c.mu.Lock()
	if c.token == tok {
		c.token = ""
	}
	c.mu.Unlock()
}

// do performs an authenticated JSON call. When retry is true, transport errors
// and 5xx responses are retried with linear backoff (use only for idempotent
// calls). A 401 triggers one forced re-login and replay.
func (c *Client) do(ctx context.Context, method, path string, in, out any, retry bool) error {
	var payload []byte
	if in != nil {
		payload, _ = json.Marshal(in)
	}
	attempts := 1
	if retry {
		attempts = maxRetries
	}
	reloggedIn := false
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Duration(attempt) * 200 * time.Millisecond):
			}
		}
		tok, err := c.ensureToken(ctx)
		if err != nil {
			return err
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
			lastErr = err
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusUnauthorized && !reloggedIn {
			reloggedIn = true
			c.invalidate(tok)
			attempt-- // replay without consuming a retry
			continue
		}
		if resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("vertofx: %s %s -> %d: %s", method, path, resp.StatusCode, string(body))
			continue
		}
		if resp.StatusCode >= 300 {
			return fmt.Errorf("vertofx: %s %s -> %d: %s", method, path, resp.StatusCode, string(body))
		}
		if out != nil {
			return json.Unmarshal(body, out)
		}
		return nil
	}
	return lastErr
}

// decimalPPM parses a JSON number or numeric string into parts-per-million
// without going through float64.
type decimalPPM int64

func (d *decimalPPM) UnmarshalJSON(b []byte) error {
	s := strings.Trim(strings.TrimSpace(string(b)), `"`)
	v, err := parsePPM(s)
	if err != nil {
		return err
	}
	*d = decimalPPM(v)
	return nil
}

func parsePPM(s string) (int64, error) {
	if s == "" || strings.ContainsAny(s, "eE-+") {
		return 0, fmt.Errorf("vertofx: invalid rate %q", s)
	}
	whole, frac, _ := strings.Cut(s, ".")
	if len(frac) > 6 {
		frac = frac[:6]
	}
	frac += strings.Repeat("0", 6-len(frac))
	var n int64
	for _, ch := range whole + frac {
		if ch < '0' || ch > '9' {
			return 0, fmt.Errorf("vertofx: invalid rate %q", s)
		}
		n = n*10 + int64(ch-'0')
	}
	return n, nil
}

// Rate is an FX rate with the lock token Verto returns (valid ~30s).
type Rate struct {
	RatePPM   int64 // destination units per 1 source unit, in parts-per-million
	VfxToken  string
	ExpiresAt time.Time
}

// GetFXRate fetches a rate + vfxToken (GET /fx/rate). amountMinor is passed
// through as the integer "amount" query parameter in the client's native unit.
func (c *Client) GetFXRate(ctx context.Context, from, to string, amountMinor int64) (Rate, error) {
	if !c.live() {
		return Rate{RatePPM: 1_500_000_000, VfxToken: "mock-vfx-" + from + to, ExpiresAt: time.Now().Add(rateTTL)}, nil
	}
	q := url.Values{}
	q.Set("from", from)
	q.Set("to", to)
	q.Set("amount", fmt.Sprintf("%d", amountMinor))
	var resp struct {
		Data struct {
			Rate     decimalPPM `json:"rate"`
			VfxToken string     `json:"vfxToken"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, "/fx/rate?"+q.Encode(), nil, &resp, true); err != nil {
		return Rate{}, err
	}
	if resp.Data.VfxToken == "" || resp.Data.Rate <= 0 {
		return Rate{}, errors.New("vertofx: fx rate: invalid response")
	}
	return Rate{RatePPM: int64(resp.Data.Rate), VfxToken: resp.Data.VfxToken, ExpiresAt: time.Now().Add(rateTTL)}, nil
}

// FXMarkup is Spotlight's markup on a trade. MarkupPerc is in basis points.
type FXMarkup struct {
	MarkupType string `json:"markupType"`
	MarkupPerc int64  `json:"markupPerc"`
}

// TradeInput books an FX trade. PaymentID is the idempotency key.
type TradeInput struct {
	PaymentID       string
	PaymentType     string // e.g. "convertWalletPayout"
	SourceWalletID  string
	SourceAmount    int64 // native units
	VfxToken        string
	TargetAccountID string
	FXMarkup        FXMarkup
}

// Trade is the booked FX trade.
type Trade struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	PaymentID string `json:"paymentId"`
}

// CreateFXTrade books a trade (POST /fx/trades). Idempotent by PaymentID, so
// transient failures are safely retried.
func (c *Client) CreateFXTrade(ctx context.Context, in TradeInput) (Trade, error) {
	if !c.live() {
		return Trade{ID: "mock-trade-" + in.PaymentID, Status: "pending", PaymentID: in.PaymentID}, nil
	}
	body := map[string]any{
		"paymentId":       in.PaymentID,
		"paymentType":     in.PaymentType,
		"sourceWalletId":  in.SourceWalletID,
		"sourceAmount":    in.SourceAmount,
		"vfxToken":        in.VfxToken,
		"targetAccountId": in.TargetAccountID,
		"fxMarkup":        in.FXMarkup,
	}
	var resp struct {
		Data Trade `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/fx/trades", body, &resp, true); err != nil {
		return Trade{}, err
	}
	if resp.Data.ID == "" {
		return Trade{}, errors.New("vertofx: create fx trade: invalid response")
	}
	return resp.Data, nil
}

// Funding holds bank funding details for a wallet.
type Funding struct {
	AccountName   string `json:"accountName"`
	AccountNumber string `json:"accountNumber"`
	BankName      string `json:"bankName"`
	BankCode      string `json:"bankCode"`
	Reference     string `json:"reference"`
}

// CreateFundingDetails fetches (auto-creating) funding methods for a currency
// (GET /{companyId}/funding-methods?autoCreate=true).
func (c *Client) CreateFundingDetails(ctx context.Context, companyID, currency string) (Funding, error) {
	if !c.live() {
		return Funding{AccountName: "Mock Verto " + currency, AccountNumber: "0000000001", BankName: "Mock Bank", BankCode: "000", Reference: "mock-" + companyID}, nil
	}
	if companyID == "" {
		if _, err := c.ensureToken(ctx); err != nil {
			return Funding{}, err
		}
		c.mu.Lock()
		companyID = c.companyID
		c.mu.Unlock()
	}
	path := "/" + url.PathEscape(companyID) + "/funding-methods?autoCreate=true&currency=" + url.QueryEscape(currency)
	var resp struct {
		Data Funding `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, path, nil, &resp, true); err != nil {
		return Funding{}, err
	}
	return resp.Data, nil
}

// VerifyWebhookSignature checks the hex HMAC-SHA256 of the raw payload using a
// constant-time compare. Fails closed on a missing secret or signature.
func (c *Client) VerifyWebhookSignature(payload []byte, signature string) bool {
	if c.webhookSecret == "" || signature == "" {
		return false
	}
	m := hmac.New(sha256.New, []byte(c.webhookSecret))
	m.Write(payload)
	want := hex.EncodeToString(m.Sum(nil))
	return hmac.Equal([]byte(want), []byte(strings.ToLower(signature)))
}

// Event is a parsed Verto webhook.
type Event struct {
	ID        string `json:"id"`
	Type      string `json:"event"`
	PaymentID string `json:"paymentId"`
	Status    string `json:"status"`
}

// ParseWebhook decodes a webhook body. Callers must verify the signature first.
func (c *Client) ParseWebhook(payload []byte) (Event, error) {
	var ev Event
	if err := json.Unmarshal(payload, &ev); err != nil {
		return Event{}, fmt.Errorf("vertofx: parse webhook: %w", err)
	}
	if ev.Type == "" {
		return Event{}, errors.New("vertofx: parse webhook: missing event type")
	}
	return ev, nil
}
