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
	"time"
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
//
//	func New(token string, prod bool) *Client
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

// --- HTTP helpers (Youverify: token header) ---

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
	req.Header.Set("token", c.token)
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
	defer resp.Body.Close()
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
