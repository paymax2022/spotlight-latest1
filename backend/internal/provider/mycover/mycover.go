package mycover

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"spotlight/backend/internal/insurance/gateway"
)

// Client is the MyCover.ai aggregator adapter. It implements
// gateway.UnderwriterGateway. MyCover is the aggregator that disclosed the
// underwriter on each response; this adapter surfaces that disclosure into the
// normalised models and NEVER leaks raw provider JSON past its boundary.
//
// Keys come from config/secrets via New(); they are NEVER hard-coded and NEVER
// logged. The HTTP layer mirrors internal/provider/paystack.
type Client struct {
	apiKey        string // secret key — server-to-server auth; never logged
	publicKey     string // publishable key — client-init / disclosure; safe to surface
	webhookSecret string
	baseURL       string
	httpClient    *http.Client
}

// Default sandbox base URL. The live base URL is injected via config in
// production; this default lets the adapter run against the provider sandbox.
// TODO(live): confirm the production base URL and plug it in via config.
const defaultBaseURL = "https://api.sandbox.mycover.ai/v1"

// New constructs a MyCover adapter. baseURL may be empty to use the sandbox.
// apiKey = secret key (server auth); publicKey = publishable key.
func New(apiKey, publicKey, webhookSecret, baseURL string) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		apiKey:        apiKey,
		publicKey:     publicKey,
		webhookSecret: webhookSecret,
		baseURL:       baseURL,
		httpClient:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Name returns the stable aggregator id.
func (c *Client) Name() string { return "mycover" }

// --- gateway.UnderwriterGateway ---

func (c *Client) GetQuote(ctx context.Context, req gateway.QuoteRequest) (gateway.Quote, error) {
	body := map[string]any{
		"product_code": req.ProviderProductCode,
		"currency":     req.Currency,
		"sum_insured":  req.SumInsuredKobo, // kobo
		"inputs":       req.Inputs,
	}
	var resp quoteResponse
	// TODO(live): confirm MyCover quote path + payload shape against live docs.
	if err := c.post(ctx, "/quotes", body, &resp); err != nil {
		return gateway.Quote{}, err
	}
	if !resp.OK() {
		return gateway.Quote{}, fmt.Errorf("mycover: quote: %s", resp.Message)
	}
	return gateway.Quote{
		ProviderQuoteRef:    resp.Data.QuoteRef,
		ProviderProductCode: req.ProviderProductCode,
		PremiumKobo:         resp.Data.PremiumKobo,
		SumInsuredKobo:      resp.Data.SumInsuredKobo,
		Currency:            resp.Data.Currency,
		Underwriter:         resp.Data.Underwriter,
		Aggregator:          c.Name(),
		CommissionKobo:      resp.Data.CommissionKobo,
		ExpiresAt:           parseTime(resp.Data.ExpiresAt),
		Terms:               resp.Data.Terms,
	}, nil
}

func (c *Client) BindPolicy(ctx context.Context, req gateway.BindRequest) (gateway.Policy, error) {
	body := map[string]any{
		"product_code":    req.ProviderProductCode,
		"quote_ref":       req.ProviderQuoteRef,
		"currency":        req.Currency,
		"sum_insured":     req.SumInsuredKobo,
		"premium":         req.PremiumKobo,
		"policyholder_ref": req.PolicyholderRef,
		"inputs":          req.Inputs,
	}
	var resp policyResponse
	// Idempotency-Key header makes the provider bind idempotent — a retried bind
	// with the same key returns the same policy (critical for the debit→bind saga).
	// TODO(live): confirm MyCover honours Idempotency-Key on the bind endpoint.
	if err := c.postIdem(ctx, "/policies", req.IdempotencyKey, body, &resp); err != nil {
		return gateway.Policy{}, err
	}
	if !resp.OK() {
		return gateway.Policy{}, fmt.Errorf("mycover: bind: %s", resp.Message)
	}
	return resp.toPolicy(c.Name()), nil
}

func (c *Client) GetPolicy(ctx context.Context, providerPolicyRef string) (gateway.Policy, error) {
	var resp policyResponse
	if err := c.get(ctx, "/policies/"+providerPolicyRef, &resp); err != nil {
		return gateway.Policy{}, err
	}
	if !resp.OK() {
		return gateway.Policy{}, fmt.Errorf("mycover: get policy: %s", resp.Message)
	}
	return resp.toPolicy(c.Name()), nil
}

func (c *Client) CancelPolicy(ctx context.Context, providerPolicyRef, reason string) (gateway.Policy, error) {
	var resp policyResponse
	if err := c.post(ctx, "/policies/"+providerPolicyRef+"/cancel", map[string]any{"reason": reason}, &resp); err != nil {
		return gateway.Policy{}, err
	}
	if !resp.OK() {
		return gateway.Policy{}, fmt.Errorf("mycover: cancel: %s", resp.Message)
	}
	return resp.toPolicy(c.Name()), nil
}

func (c *Client) SubmitClaim(ctx context.Context, req gateway.ClaimRequest) (gateway.Claim, error) {
	body := map[string]any{
		"policy_ref":     req.ProviderPolicyRef,
		"loss_event_at":  req.LossEventAt.UTC().Format(time.RFC3339),
		"claimed_amount": req.ClaimedAmountKobo,
		"description":    req.Description,
		"inputs":         req.Inputs,
	}
	var resp claimResponse
	if err := c.postIdem(ctx, "/claims", req.IdempotencyKey, body, &resp); err != nil {
		return gateway.Claim{}, err
	}
	if !resp.OK() {
		return gateway.Claim{}, fmt.Errorf("mycover: submit claim: %s", resp.Message)
	}
	return resp.toClaim(), nil
}

func (c *Client) GetClaim(ctx context.Context, providerClaimRef string) (gateway.Claim, error) {
	var resp claimResponse
	if err := c.get(ctx, "/claims/"+providerClaimRef, &resp); err != nil {
		return gateway.Claim{}, err
	}
	if !resp.OK() {
		return gateway.Claim{}, fmt.Errorf("mycover: get claim: %s", resp.Message)
	}
	return resp.toClaim(), nil
}

func (c *Client) UploadEvidence(ctx context.Context, up gateway.EvidenceUpload) error {
	body := map[string]any{
		"file_name":    up.FileName,
		"content_type": up.ContentType,
		"storage_ref":  up.StorageRef,
	}
	var resp envelope
	if err := c.post(ctx, "/claims/"+up.ProviderClaimRef+"/evidence", body, &resp); err != nil {
		return err
	}
	if !resp.OK() {
		return fmt.Errorf("mycover: upload evidence: %s", resp.Message)
	}
	return nil
}

// VerifyWebhook validates the HMAC-SHA256 signature and returns the normalised
// event. SignatureValid is false (err nil) when the signature does not match.
// TODO(live): confirm MyCover's webhook signature scheme + header name.
func (c *Client) VerifyWebhook(ctx context.Context, payload []byte, signature string) (gateway.WebhookEvent, error) {
	valid := verifyHMACSHA256(c.webhookSecret, payload, signature)
	if !valid {
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: false}, nil
	}
	var w webhookPayload
	if err := json.Unmarshal(payload, &w); err != nil {
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: true}, fmt.Errorf("mycover: decode webhook: %w", err)
	}
	return gateway.WebhookEvent{
		Provider:          c.Name(),
		EventType:         w.Event,
		ExternalEventID:   w.ID,
		ProviderPolicyRef: w.Data.PolicyRef,
		ProviderClaimRef:  w.Data.ClaimRef,
		SignatureValid:    true,
	}, nil
}

// --- provider JSON shapes (never leak past this file) ---

type envelope struct {
	Status  bool   `json:"status"`
	Message string `json:"message"`
}

func (e envelope) OK() bool { return e.Status }

type quoteResponse struct {
	envelope
	Data struct {
		QuoteRef       string         `json:"quote_ref"`
		PremiumKobo    int64          `json:"premium"`
		SumInsuredKobo int64          `json:"sum_insured"`
		Currency       string         `json:"currency"`
		Underwriter    string         `json:"underwriter"`
		CommissionKobo int64          `json:"commission"`
		ExpiresAt      string         `json:"expires_at"`
		Terms          map[string]any `json:"terms"`
	} `json:"data"`
}

type policyResponse struct {
	envelope
	Data struct {
		PolicyRef      string `json:"policy_ref"`
		ProductCode    string `json:"product_code"`
		Status         string `json:"status"`
		PremiumKobo    int64  `json:"premium"`
		SumInsuredKobo int64  `json:"sum_insured"`
		Currency       string `json:"currency"`
		Underwriter    string `json:"underwriter"`
		CommissionKobo int64  `json:"commission"`
		EffectiveAt    string `json:"effective_at"`
		ExpiresAt      string `json:"expires_at"`
		CertificateRef string `json:"certificate_ref"`
	} `json:"data"`
}

func (p policyResponse) toPolicy(aggregator string) gateway.Policy {
	return gateway.Policy{
		ProviderPolicyRef:   p.Data.PolicyRef,
		ProviderProductCode: p.Data.ProductCode,
		Status:              p.Data.Status,
		PremiumKobo:         p.Data.PremiumKobo,
		SumInsuredKobo:      p.Data.SumInsuredKobo,
		Currency:            p.Data.Currency,
		Underwriter:         p.Data.Underwriter,
		Aggregator:          aggregator,
		CommissionKobo:      p.Data.CommissionKobo,
		EffectiveAt:         parseTime(p.Data.EffectiveAt),
		ExpiresAt:           parseTime(p.Data.ExpiresAt),
		CertificateRef:      p.Data.CertificateRef,
	}
}

type claimResponse struct {
	envelope
	Data struct {
		ClaimRef           string `json:"claim_ref"`
		PolicyRef          string `json:"policy_ref"`
		Status             string `json:"status"`
		ClaimedAmountKobo  int64  `json:"claimed_amount"`
		ApprovedAmountKobo int64  `json:"approved_amount"`
		Currency           string `json:"currency"`
	} `json:"data"`
}

func (cl claimResponse) toClaim() gateway.Claim {
	return gateway.Claim{
		ProviderClaimRef:   cl.Data.ClaimRef,
		ProviderPolicyRef:  cl.Data.PolicyRef,
		Status:             cl.Data.Status,
		ClaimedAmountKobo:  cl.Data.ClaimedAmountKobo,
		ApprovedAmountKobo: cl.Data.ApprovedAmountKobo,
		Currency:           cl.Data.Currency,
	}
}

type webhookPayload struct {
	ID    string `json:"id"`
	Event string `json:"event"`
	Data  struct {
		PolicyRef string `json:"policy_ref"`
		ClaimRef  string `json:"claim_ref"`
	} `json:"data"`
}

// --- HTTP helpers (mirror paystack adapter) ---

func (c *Client) post(ctx context.Context, path string, body, dst any) error {
	return c.postIdem(ctx, path, "", body, dst)
}

func (c *Client) postIdem(ctx context.Context, path, idemKey string, body, dst any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("mycover: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	return c.do(req, dst)
}

func (c *Client) get(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	return c.do(req, dst)
}

func (c *Client) do(req *http.Request, dst any) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("mycover: http request: %w", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("mycover: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		// Do NOT log body — may contain provider-side detail. Surface status only.
		return fmt.Errorf("mycover: server error %d", resp.StatusCode)
	}
	if dst == nil {
		return nil
	}
	return json.Unmarshal(b, dst)
}

// verifyHMACSHA256 returns true if signature == hex(HMAC-SHA256(secret, payload)).
func verifyHMACSHA256(secret string, payload []byte, signature string) bool {
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}
