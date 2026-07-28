package youverify

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"

	"spotlight/backend/internal/provider"
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
		"documentType":     firstNonEmpty(req.DocType, "id_card"),
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
	mac := hmac.New(sha256.New, []byte(c.webhookSecret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// ParseKycWebhook normalizes a Youverify webhook into a provider.KycWebhookEvent.
func (c *Client) ParseKycWebhook(payload []byte) (*provider.KycWebhookEvent, error) {
	return mapWebhook(payload)
}

// --- Compile-time interface assertions ---
var (
	_ provider.IdNumberPort     = (*Client)(nil)
	_ provider.FacialPort       = (*Client)(nil)
	_ provider.LivenessPort     = (*Client)(nil)
	_ provider.DocumentPort     = (*Client)(nil)
	_ provider.AmlPort          = (*Client)(nil)
	_ provider.KycWebhookParser = (*Client)(nil)
)
