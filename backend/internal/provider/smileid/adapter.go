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
	"spotlight/backend/go-common/timeutil"
	"spotlight/backend/internal/provider"
	"time"
)

// submitJob posts a Smile ID job with the signature block + partner params, and
// returns the PENDING accepted result. Smile ID is callback-based: the verdict
// arrives via ParseKycWebhook, so Terminal is always false here.
func (c *Client) submitJob(ctx context.Context, jobType int, req provider.KycVerifyRequest, extra map[string]any) (provider.KycCheckResult, error) {
	if !c.configured() {
		return sandboxPending(req.ClientRef), nil
	}
	sig, ts := c.generateSignature()
	body := map[string]any{
		"partner_id":   c.partnerID,
		"signature":    sig,
		"timestamp":    ts,
		"sid_server":   c.sidServer,
		"callback_url": c.callbackURL,
		"partner_params": map[string]any{
			"job_id":   req.ClientRef, // idempotency / correlation key
			"user_id":  req.UserID,
			"job_type": jobType,
		},
	}
	for k, v := range extra {
		body[k] = v
	}
	raw, err := c.post(ctx, "/async_job", body, nil)
	if err != nil {
		return provider.KycCheckResult{}, err
	}
	return mapSubmitAccepted(raw, req.ClientRef), nil
}

// VerifyIDFacial submits a Smile ID enhanced_kyc + SmartSelfie (biometric KYC)
// job — ID data + a captured selfie for face match. Callback-authoritative.
func (c *Client) VerifyIDFacial(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	extra := map[string]any{
		"id_info": map[string]any{
			"country":    "NG",
			"id_type":    req.IDType,
			"id_number":  req.IDNumber,
			"first_name": req.FirstName,
			"last_name":  req.LastName,
			"dob":        req.DOB,
		},
		"images": []map[string]any{
			{"image_type_id": 2, "image": req.SelfieB64}, // 2 = base64 selfie
		},
	}
	return c.submitJob(ctx, jobTypeBiometricKYC, req, extra)
}

// VerifyLiveness submits a Smile ID biometric_kyc / SmartSelfie liveness job
// (6 anti-spoof models). Callback-authoritative.
func (c *Client) VerifyLiveness(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	extra := map[string]any{
		"images": []map[string]any{
			{"image_type_id": 2, "image": req.SelfieB64},
		},
	}
	return c.submitJob(ctx, jobTypeBiometricKYC, req, extra)
}

// VerifyDocument submits a Smile ID doc_verification job (job_type 11): OCR +
// authenticity + face match on an ID document. Callback-authoritative.
func (c *Client) VerifyDocument(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	images := []map[string]any{
		{"image_type_id": 3, "image": req.DocFrontB64}, // 3 = base64 id-card front
	}
	if req.DocBackB64 != "" {
		images = append(images, map[string]any{"image_type_id": 7, "image": req.DocBackB64})
	}
	if req.SelfieB64 != "" {
		images = append(images, map[string]any{"image_type_id": 2, "image": req.SelfieB64})
	}
	extra := map[string]any{
		"id_info": map[string]any{
			"country": "NG",
			"id_type": req.DocType,
		},
		"images": images,
	}
	return c.submitJob(ctx, jobTypeDocVerify, req, extra)
}

// VerifyKycSignature verifies a Smile ID callback's `confirm_signature`.
// Smile ID's confirm_signature is computed the same way as the request signature:
// base64( HMAC-SHA256( timestamp + partner_id + "sid_request", api_key ) ), using
// the `timestamp` carried in the callback body. Because the timestamp lives inside
// the payload, callers pass the raw payload and the confirm_signature string; this
// method extracts the timestamp, recomputes, and constant-time compares.
// TODO(smileid): confirm the exact signature domain string against the current
// Smile ID docs if callbacks fail verification in staging — some SDK versions use
// "sid_request" while older ones omit it. The HMAC key (api_key) and base64
// encoding are stable across versions.
func (c *Client) VerifyKycSignature(payload []byte, signature string) bool {
	if c.apiKey == "" || signature == "" {
		return false
	}
	ts := extractTimestamp(payload)
	if ts == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(c.apiKey))
	mac.Write([]byte(ts))
	mac.Write([]byte(c.partnerID))
	mac.Write([]byte("sid_request"))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// ParseKycWebhook normalizes a Smile ID callback into a provider.KycWebhookEvent,
// including the duplicate-identity fraud signal via the mapper.
func (c *Client) ParseKycWebhook(payload []byte) (*provider.KycWebhookEvent, error) {
	return mapCallback(payload)
}

// extractTimestamp pulls the `timestamp` field out of a Smile ID callback body.
func extractTimestamp(payload []byte) string {
	var env struct {
		Timestamp string `json:"timestamp"`
	}
	if err := json.Unmarshal(payload, &env); err != nil {
		return ""
	}
	return env.Timestamp
}

var (
	_ provider.FacialPort       = (*Client)(nil)
	_ provider.LivenessPort     = (*Client)(nil)
	_ provider.DocumentPort     = (*Client)(nil)
	_ provider.KycWebhookParser = (*Client)(nil)
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
// (This is the documented v2 signature scheme.) Returns the signature and the
// ISO-8601 timestamp that must be sent alongside it in the request body.
func (c *Client) generateSignature() (string, string) {
	var timestamp string

	var sig string

	timestamp = timeutil.RFC3339(time.Now())
	mac := hmac.New(sha256.New, []byte(c.apiKey))
	mac.Write([]byte(timestamp))
	mac.Write([]byte(c.partnerID))
	mac.Write([]byte("sid_request"))
	sig = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return sig, timestamp
}

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
