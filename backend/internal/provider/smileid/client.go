// Package smileid implements the Paymax KYC gateway ports against Smile Identity
// (https://smileidentity.com). Smile ID is CALLBACK-BASED: job submission returns
// an accepted/PENDING result and the authoritative verdict arrives asynchronously
// at SMILEID_CALLBACK_URL, verified via `confirm_signature`. Auth uses
// partner_id + a request signature computed from the API key. sid_server 0=sandbox,
// 1=prod. No Smile DTO leaks out — everything normalizes to provider types.
// Stdlib only.
package smileid

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const (
	sandboxBaseURL = "https://testapi.smileidentity.com/v1"
	prodBaseURL    = "https://api.smileidentity.com/v1"
)

// Client implements FacialPort, LivenessPort, DocumentPort and KycWebhookParser
// behind Paymax's provider-agnostic KYC surface.
type Client struct {
	partnerID   string
	apiKey      string
	callbackURL string
	sidServer   string // "0" sandbox | "1" prod
	baseURL     string
	httpClient  *http.Client
}

// New creates a Smile ID client. Set prod=true for the live environment.
//
//	func New(partnerID, apiKey string, prod bool, callbackURL string) *Client
func New(partnerID, apiKey string, prod bool, callbackURL string) *Client {
	url := sandboxBaseURL
	sid := "0"
	if prod {
		url = prodBaseURL
		sid = "1"
	}
	return &Client{
		partnerID:   partnerID,
		apiKey:      apiKey,
		callbackURL: callbackURL,
		sidServer:   sid,
		baseURL:     url,
		httpClient:  &http.Client{Timeout: 30 * time.Second},
	}
}

// WithBaseURL overrides the API base URL (e.g. an httptest server in tests).
func (c *Client) WithBaseURL(url string) *Client {
	if url != "" {
		c.baseURL = url
	}
	return c
}

func (c *Client) Name() string { return "smileid" }

// configured reports whether the required credentials are present.
func (c *Client) configured() bool { return c.partnerID != "" && c.apiKey != "" }

// generateSignature builds Smile ID's request signature:
//
//	base64( HMAC-SHA256( timestamp + partner_id + "sid_request", api_key ) )
//
// (This is the documented v2 signature scheme.) Returns the signature and the
// ISO-8601 timestamp that must be sent alongside it in the request body.
func (c *Client) generateSignature() (sig string, timestamp string) {
	timestamp = time.Now().UTC().Format(time.RFC3339)
	mac := hmac.New(sha256.New, []byte(c.apiKey))
	mac.Write([]byte(timestamp))
	mac.Write([]byte(c.partnerID))
	mac.Write([]byte("sid_request"))
	sig = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return sig, timestamp
}

// --- HTTP helper. Smile ID posts JSON; signature travels in the body, not headers. ---

func (c *Client) post(ctx context.Context, path string, body, dst any) ([]byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("smileid: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return c.do(req, dst)
}

func (c *Client) do(req *http.Request, dst any) ([]byte, error) {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("smileid: http request: %w", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("smileid: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		return b, fmt.Errorf("smileid: server error %d: %s", resp.StatusCode, string(b))
	}
	if dst != nil {
		if err := json.Unmarshal(b, dst); err != nil {
			return b, fmt.Errorf("smileid: decode response: %w", err)
		}
	}
	return b, nil
}
