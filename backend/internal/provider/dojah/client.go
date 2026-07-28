// Package dojah implements the Paymax KYC gateway ports against Dojah
// (https://dojah.io). Dojah is synchronous for data-match / document / AML checks
// and exposes async webhooks; auth is header-based (Authorization: <secret> +
// AppId: <app_id>). No Dojah DTO leaks out — everything normalizes to
// provider.KycCheckResult / provider.KycWebhookEvent.
//
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
	"time"
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
//
// Constructor signature is fixed by the gateway wiring:
//
//	func New(appID, secretKey string, prod bool) *Client
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

// --- HTTP helpers (Dojah: Authorization=<secret>, AppId=<app_id>) ---

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
	req.Header.Set("AppId", c.appID)
	req.Header.Set("Accept", "application/json")
}

// do executes the request, returns the raw body (for KycCheckResult.Raw) and
// unmarshals into dst when non-nil.
func (c *Client) do(req *http.Request, dst any) ([]byte, error) {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("dojah: http request: %w", err)
	}
	defer resp.Body.Close()
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
