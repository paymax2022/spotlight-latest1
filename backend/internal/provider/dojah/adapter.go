// Package dojah implements the Paymax KYC gateway ports against Dojah
// (https://dojah.io). Dojah is synchronous for data-match / document / AML checks
// and exposes async webhooks; auth is header-based (Authorization: <secret> +
// AppId: <app_id>). No Dojah DTO leaks out — everything normalizes to
// provider.KycCheckResult / provider.KycWebhookEvent.
// This is the ONLY place Dojah HTTP code may live. Mirrors the maplerad adapter
// for HTTP/webhook style. Stdlib only.

package dojah

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/internal/provider"
	"time"
)

// VerifyIDNumber performs a Dojah KYC data-match (BVN/NIN/vNIN/passport/DL/PVC/
// phone) via GET /api/v1/kyc/*. Synchronous + authoritative. The ClientRef is
// echoed on ProviderRef so a later webhook can correlate.
func (c *Client) VerifyIDNumber(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	path, ok := idNumberPath(req.IDType, req.IDNumber)
	if !ok {
		res := sandboxPending(req.ClientRef)
		res.Reason = "dojah: unsupported id_type " + req.IDType
		return res, nil
	}
	raw, err := c.get(ctx, path, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapIDNumber(raw, req.ClientRef), nil
}

// VerifyLiveness runs a Dojah Liveness Check on a captured selfie (base64).
func (c *Client) VerifyLiveness(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	body := map[string]any{
		"image":     req.SelfieB64,
		"reference": req.ClientRef,
	}
	raw, err := c.post(ctx, "/api/v1/ml/liveness", body, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapLiveness(raw, req.ClientRef), nil
}

// VerifyDocument runs Dojah Document Analysis (OCR + authenticity) on a captured
// document image (base64). The DOMAIN gates PASS vs REVIEW via the threshold.
func (c *Client) VerifyDocument(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	body := map[string]any{
		"image":     req.DocFrontB64,
		"reference": req.ClientRef,
	}
	raw, err := c.post(ctx, "/api/v1/document/analysis", body, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapDocument(raw, req.ClientRef), nil
}

// ScreenAML runs Dojah AML Screening (individual PEP/sanctions/watchlist).
func (c *Client) ScreenAML(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	body := map[string]any{
		"first_name": req.FirstName,
		"last_name":  req.LastName,
		"dob":        req.DOB,
		"reference":  req.ClientRef,
	}
	raw, err := c.post(ctx, "/api/v1/aml/screening", body, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapAML(raw, req.ClientRef), nil
}

// VerifyKycSignature validates Dojah's HMAC-SHA256 signature over the raw body,
// hex-encoded, using the vault-stored webhook secret, constant-time compared.
// Mirrors the maplerad scheme. Rejects when secret or signature is missing.
func (c *Client) VerifyKycSignature(payload []byte, signature string) bool {
	if c.webhookSecret == "" || signature == "" {
		return false
	}
	return cryptox.ConstantTimeEqual(cryptox.HMACSHA256Hex(c.webhookSecret, string(payload)), signature)
}

// ParseKycWebhook normalizes a Dojah webhook into a provider.KycWebhookEvent.
func (c *Client) ParseKycWebhook(payload []byte) (*provider.KycWebhookEvent, error) {
	return mapWebhook(payload)
}

var (
	_ provider.IdNumberPort     = (*Client)(nil)
	_ provider.LivenessPort     = (*Client)(nil)
	_ provider.DocumentPort     = (*Client)(nil)
	_ provider.AmlPort          = (*Client)(nil)
	_ provider.KycWebhookParser = (*Client)(nil)
)

const (
	sandboxBaseURL = "https://sandbox.dojah.io"
	prodBaseURL    = "https://api.dojah.io"
)

// Client implements IdNumberPort, LivenessPort, DocumentPort, AmlPort and
// KycWebhookParser behind Paymax's provider-agnostic KYC surface.
type Client struct {
	appID         string
	secretKey     string
	webhookSecret string
	baseURL       string
	httpClient    *http.Client
}

// New creates a Dojah client. Set prod=true for the live environment.
// Constructor signature is fixed by the gateway wiring:
func New(appID, secretKey string, prod bool) *Client {
	url := sandboxBaseURL
	if prod {
		url = prodBaseURL
	}
	return &Client{
		appID:      appID,
		secretKey:  secretKey,
		baseURL:    url,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// WithBaseURL overrides the API base URL (e.g. an httptest server in tests).
func (c *Client) WithBaseURL(url string) *Client {
	if url != "" {
		c.baseURL = url
	}
	return c
}

// WithWebhookSecret sets the vault-stored webhook secret used by
// VerifyKycSignature (HMAC-SHA256). Returns the receiver for chaining.
func (c *Client) WithWebhookSecret(s string) *Client {
	c.webhookSecret = s
	return c
}

func (c *Client) Name() string { return "dojah" }

// configured reports whether both credentials are present. With missing creds the
// adapter returns a sandbox PENDING result instead of panicking or hitting the net.
func (c *Client) configured() bool { return c.appID != "" && c.secretKey != "" }

func (c *Client) get(ctx context.Context, path string, dst any) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	c.setHeaders(req)
	return c.do(req, dst)
}

func (c *Client) post(ctx context.Context, path string, body, dst any) ([]byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("dojah: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	c.setHeaders(req)
	return c.do(req, dst)
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", c.secretKey)
	req.Header.Set("Appid", c.appID)
	req.Header.Set("Accept", "application/json")
}

// do executes the request, returns the raw body (for KycCheckResult.Raw) and
// unmarshals into dst when non-nil.
func (c *Client) do(req *http.Request, dst any) ([]byte, error) {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dojah: http request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("dojah: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		return b, fmt.Errorf("dojah: server error %d: %s", resp.StatusCode, string(b))
	}
	if dst != nil {
		if err := json.Unmarshal(b, dst); err != nil {
			return b, fmt.Errorf("dojah: decode response: %w", err)
		}
	}
	return b, nil
}
