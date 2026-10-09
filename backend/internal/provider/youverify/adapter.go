// Package youverify implements the Paymax KYC gateway ports against Youverify
// (https://youverify.co). Auth is a single `token` header; base
// api.sandbox.youverify.co → live. Every identity request MUST carry
// isSubjectConsent:true. No Youverify DTO leaks out — everything normalizes to
// provider.KycCheckResult / provider.KycWebhookEvent. Stdlib only.

package youverify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/go-common/strutil"
	"spotlight/backend/internal/provider"
	"time"
)

// VerifyIDNumber performs a Youverify identity data-match. Every request carries
// isSubjectConsent:true (mandatory) and echoes ClientRef as the provider reference.
func (c *Client) VerifyIDNumber(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	path, ok := idNumberPath(req.IDType)
	if !ok {
		res := sandboxPending(req.ClientRef)
		res.Reason = "youverify: unsupported id_type " + req.IDType
		return res, nil
	}
	body := map[string]any{
		"id":               req.IDNumber,
		"isSubjectConsent": true,
		"reference":        req.ClientRef,
	}
	raw, err := c.post(ctx, path, body, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapIDNumber(raw, req.ClientRef), nil
}

// VerifyIDFacial performs a Youverify facial match (bvn_facial/nin_facial/
// passport_facial); face_details.confidence is compared to the threshold. The
// DOMAIN gates PASS vs REVIEW.
func (c *Client) VerifyIDFacial(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	ftype, ok := facialType(req.IDType)
	if !ok {
		res := sandboxPending(req.ClientRef)
		res.Reason = "youverify: unsupported facial id_type " + req.IDType
		return res, nil
	}
	body := map[string]any{
		"id":               req.IDNumber,
		"type":             ftype,
		"image":            req.SelfieB64,
		"isSubjectConsent": true,
		"reference":        req.ClientRef,
	}
	raw, err := c.post(ctx, "/v2/api/identity/ng/facial", body, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapFacial(raw, req.ClientRef, req.Threshold), nil
}

// VerifyLiveness runs a Youverify liveness check on a captured selfie.
func (c *Client) VerifyLiveness(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	body := map[string]any{
		"image":            req.SelfieB64,
		"isSubjectConsent": true,
		"reference":        req.ClientRef,
	}
	raw, err := c.post(ctx, "/v2/api/identity/liveness", body, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapLiveness(raw, req.ClientRef), nil
}

// VerifyDocument runs a Youverify document/candidate verification.
func (c *Client) VerifyDocument(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	body := map[string]any{
		"documentType":     strutil.FirstNonEmpty(req.DocType, "id_card"),
		"documentImage":    req.DocFrontB64,
		"documentBack":     req.DocBackB64,
		"isSubjectConsent": true,
		"reference":        req.ClientRef,
	}
	raw, err := c.post(ctx, "/v2/api/identity/document", body, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapDocument(raw, req.ClientRef), nil
}

// ScreenAML runs a Youverify AML screening (PEP/sanctions/watchlist).
func (c *Client) ScreenAML(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	body := map[string]any{
		"firstName":        req.FirstName,
		"lastName":         req.LastName,
		"dateOfBirth":      req.DOB,
		"isSubjectConsent": true,
		"reference":        req.ClientRef,
	}
	raw, err := c.post(ctx, "/v2/api/identity/aml", body, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapAML(raw, req.ClientRef), nil
}

// VerifyKycSignature validates Youverify's HMAC-SHA256 signature over the raw
// body, hex-encoded, with the vault-stored webhook secret, constant-time compared.
func (c *Client) VerifyKycSignature(payload []byte, signature string) bool {
	if c.webhookSecret == "" || signature == "" {
		return false
	}
	return cryptox.ConstantTimeEqual(cryptox.HMACSHA256Hex(c.webhookSecret, string(payload)), signature)
}

// ParseKycWebhook normalizes a Youverify webhook into a provider.KycWebhookEvent.
func (c *Client) ParseKycWebhook(payload []byte) (*provider.KycWebhookEvent, error) {
	return mapWebhook(payload)
}

var (
	_ provider.IdNumberPort     = (*Client)(nil)
	_ provider.FacialPort       = (*Client)(nil)
	_ provider.LivenessPort     = (*Client)(nil)
	_ provider.DocumentPort     = (*Client)(nil)
	_ provider.AmlPort          = (*Client)(nil)
	_ provider.KycWebhookParser = (*Client)(nil)
)

const (
	sandboxBaseURL = "https://api.sandbox.youverify.co"
	prodBaseURL    = "https://api.youverify.co"
)

// Client implements IdNumberPort, FacialPort, LivenessPort, DocumentPort, AmlPort
// and KycWebhookParser behind Paymax's provider-agnostic KYC surface.
type Client struct {
	token         string
	webhookSecret string
	baseURL       string
	httpClient    *http.Client
}

// New creates a Youverify client. Set prod=true for the live environment.
func New(token string, prod bool) *Client {
	url := sandboxBaseURL
	if prod {
		url = prodBaseURL
	}
	return &Client{
		token:      token,
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

func (c *Client) Name() string { return "youverify" }

// configured reports whether the token is present. Missing → sandbox PENDING.
func (c *Client) configured() bool { return c.token != "" }

func (c *Client) post(ctx context.Context, path string, body, dst any) ([]byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("youverify: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Token", c.token)
	req.Header.Set("Accept", "application/json")
	return c.do(req, dst)
}

// do executes the request, returns the raw body (for KycCheckResult.Raw) and
// unmarshals into dst when non-nil.
func (c *Client) do(req *http.Request, dst any) ([]byte, error) {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("youverify: http request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("youverify: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		return b, fmt.Errorf("youverify: server error %d: %s", resp.StatusCode, string(b))
	}
	if dst != nil {
		if err := json.Unmarshal(b, dst); err != nil {
			return b, fmt.Errorf("youverify: decode response: %w", err)
		}
	}
	return b, nil
}
