package dojah

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"

	"spotlight/backend/internal/provider"
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
	mac := hmac.New(sha256.New, []byte(c.webhookSecret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// ParseKycWebhook normalizes a Dojah webhook into a provider.KycWebhookEvent.
func (c *Client) ParseKycWebhook(payload []byte) (*provider.KycWebhookEvent, error) {
	return mapWebhook(payload)
}

// --- Compile-time interface assertions ---
var (
	_ provider.IdNumberPort     = (*Client)(nil)
	_ provider.LivenessPort     = (*Client)(nil)
	_ provider.DocumentPort     = (*Client)(nil)
	_ provider.AmlPort          = (*Client)(nil)
	_ provider.KycWebhookParser = (*Client)(nil)
)
