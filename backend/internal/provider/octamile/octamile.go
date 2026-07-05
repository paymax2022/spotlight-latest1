package octamile

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

// Client is the Octamile aggregator adapter. It implements
// gateway.UnderwriterGateway and is the preferred aggregator for embedded,
// per-event cover (trip / parcel / haulage protection). Like the MyCover adapter,
// it surfaces the disclosed underwriter into normalised models and never leaks
// raw provider JSON past its boundary.
//
// Keys come from config/secrets via New(); they are NEVER hard-coded or logged.
type Client struct {
	apiKey        string // secret key — server-to-server auth; never logged
	publicKey     string // publishable key — client-init / disclosure; safe to surface
	webhookSecret string
	baseURL       string
	httpClient    *http.Client
}

// defaultBaseURL is the Octamile sandbox base URL.
// TODO(live): confirm the production base URL and inject via config.
const defaultBaseURL = "https://api.sandbox.octamile.com/v1"

// New constructs an Octamile adapter. baseURL may be empty to use the sandbox.
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
func (c *Client) Name() string { return "octamile" }

// --- gateway.UnderwriterGateway ---

func (c *Client) GetQuote(ctx context.Context, req gateway.QuoteRequest) (gateway.Quote, error) {
	body := map[string]any{
		"plan_code":   req.ProviderProductCode,
		"currency":    req.Currency,
		"sum_insured": req.SumInsuredKobo,
		"inputs":      req.Inputs,
	}
	var resp quoteResponse
	// TODO(live): confirm Octamile quote path + payload shape against live docs.
	if err := c.post(ctx, "/quotes", body, &resp); err != nil {
		return gateway.Quote{}, err
	}
	if !resp.OK() {
		return gateway.Quote{}, fmt.Errorf("octamile: quote: %s", resp.Error)
	}
	return gateway.Quote{
		ProviderQuoteRef:    resp.Quote.Reference,
		ProviderProductCode: req.ProviderProductCode,
		PremiumKobo:         resp.Quote.PremiumKobo,
		SumInsuredKobo:      resp.Quote.SumInsuredKobo,
		Currency:            resp.Quote.Currency,
		Underwriter:         resp.Quote.Insurer,
		Aggregator:          c.Name(),
		CommissionKobo:      resp.Quote.CommissionKobo,
		ExpiresAt:           parseTime(resp.Quote.ExpiresAt),
		Terms:               resp.Quote.Terms,
	}, nil
}

func (c *Client) BindPolicy(ctx context.Context, req gateway.BindRequest) (gateway.Policy, error) {
	body := map[string]any{
		"plan_code":        req.ProviderProductCode,
		"quote_reference":  req.ProviderQuoteRef,
		"currency":         req.Currency,
		"sum_insured":      req.SumInsuredKobo,
		"premium":          req.PremiumKobo,
		"policyholder_ref": req.PolicyholderRef,
		"inputs":           req.Inputs,
	}
	var resp policyResponse
	// Idempotency key forwarded so a retried bind returns the same policy.
	// TODO(live): confirm Octamile honours Idempotency-Key on the bind endpoint.
	if err := c.postIdem(ctx, "/policies", req.IdempotencyKey, body, &resp); err != nil {
		return gateway.Policy{}, err
	}
	if !resp.OK() {
		return gateway.Policy{}, fmt.Errorf("octamile: bind: %s", resp.Error)
	}
	return resp.toPolicy(c.Name()), nil
}

func (c *Client) GetPolicy(ctx context.Context, providerPolicyRef string) (gateway.Policy, error) {
	var resp policyResponse
	if err := c.get(ctx, "/policies/"+providerPolicyRef, &resp); err != nil {
		return gateway.Policy{}, err
	}
	if !resp.OK() {
		return gateway.Policy{}, fmt.Errorf("octamile: get policy: %s", resp.Error)
	}
	return resp.toPolicy(c.Name()), nil
}

func (c *Client) CancelPolicy(ctx context.Context, providerPolicyRef, reason string) (gateway.Policy, error) {
	var resp policyResponse
	if err := c.post(ctx, "/policies/"+providerPolicyRef+"/cancellation", map[string]any{"reason": reason}, &resp); err != nil {
		return gateway.Policy{}, err
	}
	if !resp.OK() {
		return gateway.Policy{}, fmt.Errorf("octamile: cancel: %s", resp.Error)
	}
	return resp.toPolicy(c.Name()), nil
}

func (c *Client) SubmitClaim(ctx context.Context, req gateway.ClaimRequest) (gateway.Claim, error) {
	body := map[string]any{
		"policy_reference": req.ProviderPolicyRef,
		"loss_event_at":    req.LossEventAt.UTC().Format(time.RFC3339),
		"claimed_amount":   req.ClaimedAmountKobo,
		"description":      req.Description,
		"inputs":           req.Inputs,
	}
	var resp claimResponse
	if err := c.postIdem(ctx, "/claims", req.IdempotencyKey, body, &resp); err != nil {
		return gateway.Claim{}, err
	}
	if !resp.OK() {
		return gateway.Claim{}, fmt.Errorf("octamile: submit claim: %s", resp.Error)
	}
	return resp.toClaim(), nil
}

func (c *Client) GetClaim(ctx context.Context, providerClaimRef string) (gateway.Claim, error) {
	var resp claimResponse
	if err := c.get(ctx, "/claims/"+providerClaimRef, &resp); err != nil {
		return gateway.Claim{}, err
	}
	if !resp.OK() {
		return gateway.Claim{}, fmt.Errorf("octamile: get claim: %s", resp.Error)
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
	if err := c.post(ctx, "/claims/"+up.ProviderClaimRef+"/documents", body, &resp); err != nil {
		return err
	}
	if !resp.OK() {
		return fmt.Errorf("octamile: upload evidence: %s", resp.Error)
	}
	return nil
}

// VerifyWebhook validates the HMAC-SHA256 signature and returns the normalised
// event. SignatureValid is false (err nil) when the signature does not match.
// TODO(live): confirm Octamile's webhook signature scheme + header name.
func (c *Client) VerifyWebhook(ctx context.Context, payload []byte, signature string) (gateway.WebhookEvent, error) {
	valid := verifyHMACSHA256(c.webhookSecret, payload, signature)
	if !valid {
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: false}, nil
	}
	var w webhookPayload
	if err := json.Unmarshal(payload, &w); err != nil {
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: true}, fmt.Errorf("octamile: decode webhook: %w", err)
	}
	return gateway.WebhookEvent{
		Provider:          c.Name(),
		EventType:         w.Type,
		ExternalEventID:   w.EventID,
		ProviderPolicyRef: w.Payload.PolicyReference,
		ProviderClaimRef:  w.Payload.ClaimReference,
		SignatureValid:    true,
	}, nil
}

// --- provider JSON shapes (never leak past this file) ---

type envelope struct {
	Success bool   `json:"success"`
	Error   string `json:"error"`
}

func (e envelope) OK() bool { return e.Success }

type quoteResponse struct {
	envelope
	Quote struct {
		Reference      string         `json:"reference"`
		PremiumKobo    int64          `json:"premium"`
		SumInsuredKobo int64          `json:"sum_insured"`
		Currency       string         `json:"currency"`
		Insurer        string         `json:"insurer"`
		CommissionKobo int64          `json:"commission"`
		ExpiresAt      string         `json:"expires_at"`
		Terms          map[string]any `json:"terms"`
	} `json:"quote"`
}

type policyResponse struct {
	envelope
	Policy struct {
		Reference      string `json:"reference"`
		PlanCode       string `json:"plan_code"`
		Status         string `json:"status"`
		PremiumKobo    int64  `json:"premium"`
		SumInsuredKobo int64  `json:"sum_insured"`
		Currency       string `json:"currency"`
		Insurer        string `json:"insurer"`
		CommissionKobo int64  `json:"commission"`
		EffectiveAt    string `json:"effective_at"`
		ExpiresAt      string `json:"expires_at"`
		CertificateRef string `json:"certificate_ref"`
	} `json:"policy"`
}

func (p policyResponse) toPolicy(aggregator string) gateway.Policy {
	return gateway.Policy{
		ProviderPolicyRef:   p.Policy.Reference,
		ProviderProductCode: p.Policy.PlanCode,
		Status:              p.Policy.Status,
		PremiumKobo:         p.Policy.PremiumKobo,
		SumInsuredKobo:      p.Policy.SumInsuredKobo,
		Currency:            p.Policy.Currency,
		Underwriter:         p.Policy.Insurer,
		Aggregator:          aggregator,
		CommissionKobo:      p.Policy.CommissionKobo,
		EffectiveAt:         parseTime(p.Policy.EffectiveAt),
		ExpiresAt:           parseTime(p.Policy.ExpiresAt),
		CertificateRef:      p.Policy.CertificateRef,
	}
}

type claimResponse struct {
	envelope
	Claim struct {
		Reference          string `json:"reference"`
		PolicyReference    string `json:"policy_reference"`
		Status             string `json:"status"`
		ClaimedAmountKobo  int64  `json:"claimed_amount"`
		ApprovedAmountKobo int64  `json:"approved_amount"`
		Currency           string `json:"currency"`
	} `json:"claim"`
}

func (cl claimResponse) toClaim() gateway.Claim {
	return gateway.Claim{
		ProviderClaimRef:   cl.Claim.Reference,
		ProviderPolicyRef:  cl.Claim.PolicyReference,
		Status:             cl.Claim.Status,
		ClaimedAmountKobo:  cl.Claim.ClaimedAmountKobo,
		ApprovedAmountKobo: cl.Claim.ApprovedAmountKobo,
		Currency:           cl.Claim.Currency,
	}
}

type webhookPayload struct {
	EventID string `json:"event_id"`
	Type    string `json:"type"`
	Payload struct {
		PolicyReference string `json:"policy_reference"`
		ClaimReference  string `json:"claim_reference"`
	} `json:"payload"`
}

// --- HTTP helpers ---

func (c *Client) post(ctx context.Context, path string, body, dst any) error {
	return c.postIdem(ctx, path, "", body, dst)
}

func (c *Client) postIdem(ctx context.Context, path, idemKey string, body, dst any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("octamile: marshal request: %w", err)
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
		return fmt.Errorf("octamile: http request: %w", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("octamile: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("octamile: server error %d", resp.StatusCode)
	}
	if dst == nil {
		return nil
	}
	return json.Unmarshal(b, dst)
}

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
