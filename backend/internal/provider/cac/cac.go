// Package cac abstracts the Nigerian Corporate Affairs Commission (CAC) business
// registry behind a single provider-agnostic port, BusinessRegistryProvider. The
// domain (internal/business) depends ONLY on this port — no CAC HTTP/DTO detail
// ever leaks into the money-path service (iron rule: no vendor SDK in domain logic).
//
// Two concrete implementations are provided:
//   - httpProvider    — a real HTTP client reading base URL + credentials from config
//     (Bearer api key + HMAC consumer secret). The exact CAC VAS
//     request/response field mapping is behind accredited-only docs,
//     so every wire mapping is marked TODO(cac-vas) to confirm
//     against https://vas.cac.gov.ng accredited documentation.
//   - sandboxProvider — a deterministic stub used when credentials are absent, so
//     dev/CI stay offline-functional. NEVER used when creds are set.
//
// New(cfg) picks the implementation: httpProvider when a base URL AND api key are
// configured, else sandboxProvider.
package cac

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ── Domain models (provider-agnostic; NOT CAC DTOs) ──────────────────────────

// Availability is the result of a proposed-name search.
type Availability struct {
	Available   bool     `json:"available"`
	Status      string   `json:"status"` // "available" | "taken" | "restricted" | "review"
	Reason      string   `json:"reason,omitempty"`
	Suggestions []string `json:"suggestions,omitempty"`
}

// Applicant is the party reserving a proposed name.
type Applicant struct {
	FullName string
	Email    string
	Phone    string
	Address  string
}

// Reservation is a successful name reservation (CAC availability code).
type Reservation struct {
	Ref       string    `json:"ref"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Proprietor is one owner/partner/director attached to a registration.
type Proprietor struct {
	FullName string
	Role     string // proprietor | partner | director | trustee | shareholder
	BVN      string // PII — forwarded to CAC only, never logged
	NIN      string // PII — forwarded to CAC only, never logged
	SharePct int
	Phone    string
	Email    string
}

// EntityType is the registrable entity classification.
type EntityType string

const (
	EntityBusinessName        EntityType = "business_name"
	EntityCompany             EntityType = "company"
	EntityIncorporatedTrustee EntityType = "incorporated_trustee"
)

// RegistrationRequest carries everything CAC needs to open a registration.
type RegistrationRequest struct {
	EntityType     EntityType
	ProposedName   string
	LineOfBusiness string
	ReservationRef string
	Address        string
	Objects        string   // nature/objects of the business
	DocumentRefs   []string // storage refs for uploaded supporting docs
	Proprietors    []Proprietor
	FeeKobo        int64 // registration fee (₦15,000 = 1_500_000 kobo), forwarded in the CAC payload
}

// Submission is the accepted-registration handle returned by CAC.
type Submission struct {
	Ref    string `json:"ref"`
	Status string `json:"status"` // submitted | under_review | registered | rejected
}

// RegistrationStatus is the polled state of a submitted registration.
type RegistrationStatus struct {
	State          string `json:"state"` // submitted | under_review | registered | rejected | failed
	RCOrBNNumber   string `json:"rc_or_bn_number,omitempty"`
	Reason         string `json:"reason,omitempty"`
	RegisteredName string `json:"registered_name,omitempty"`
	CertificateURL string `json:"certificate_url,omitempty"` // downloadable CAC certificate, when registered
}

// EntityVerification is a lookup of an EXISTING registered business.
type EntityVerification struct {
	Found        bool   `json:"found"`
	Name         string `json:"name,omitempty"`
	Status       string `json:"status,omitempty"` // active | inactive | delisted
	Type         string `json:"type,omitempty"`   // business_name | company | ...
	RegisteredAt string `json:"registered_at,omitempty"`
}

// BusinessRegistryProvider is the port the domain depends on. Implementations
// must be safe for concurrent use, must apply timeouts, must return typed errors,
// and must NEVER panic.
type BusinessRegistryProvider interface {
	CheckNameAvailability(ctx context.Context, proposedName, lineOfBusiness string) (Availability, error)
	ReserveName(ctx context.Context, proposedName string, applicant Applicant) (Reservation, error)
	SubmitRegistration(ctx context.Context, req RegistrationRequest) (Submission, error)
	GetRegistrationStatus(ctx context.Context, ref string) (RegistrationStatus, error)
	VerifyEntity(ctx context.Context, rcOrBnNumber string) (EntityVerification, error)
	Name() string
}

// Config is the config-driven construction input (mirrors sibling provider creds).
type Config struct {
	BaseURL        string // CAC VAS API root, e.g. https://vas.cac.gov.ng/api
	APIKey         string // Bearer / consumer key
	ConsumerSecret string // HMAC signing secret (request signature)
	Timeout        time.Duration
}

// New returns the HTTP provider when a base URL AND api key are configured,
// otherwise the deterministic sandbox provider (offline dev/CI).
func New(cfg Config) BusinessRegistryProvider {
	if strings.TrimSpace(cfg.BaseURL) != "" && strings.TrimSpace(cfg.APIKey) != "" {
		to := cfg.Timeout
		if to == 0 {
			to = 30 * time.Second
		}
		return &httpProvider{
			baseURL:        strings.TrimRight(cfg.BaseURL, "/"),
			apiKey:         cfg.APIKey,
			consumerSecret: cfg.ConsumerSecret,
			httpClient:     &http.Client{Timeout: to},
		}
	}
	return &sandboxProvider{}
}

// ── HTTP provider ────────────────────────────────────────────────────────────

type httpProvider struct {
	baseURL        string
	apiKey         string
	consumerSecret string
	httpClient     *http.Client
}

func (c *httpProvider) Name() string { return "cac-vas" }

func (c *httpProvider) CheckNameAvailability(ctx context.Context, proposedName, lineOfBusiness string) (Availability, error) {
	// TODO(cac-vas): confirm path + payload against https://vas.cac.gov.ng accredited docs.
	body := map[string]any{
		"proposed_name":    proposedName,
		"line_of_business": lineOfBusiness,
	}
	var data struct {
		Available   bool     `json:"available"`
		State       string   `json:"status"` // CAC data.status, e.g. "available"|"taken"
		Reason      string   `json:"reason"`
		Suggestions []string `json:"suggestions"`
	}
	if err := c.post(ctx, "/name-search", body, &data); err != nil {
		return Availability{}, err
	}
	state := data.State
	if state == "" {
		if data.Available {
			state = "available"
		} else {
			state = "taken"
		}
	}
	return Availability{
		Available:   data.Available,
		Status:      state,
		Reason:      data.Reason,
		Suggestions: data.Suggestions,
	}, nil
}

func (c *httpProvider) ReserveName(ctx context.Context, proposedName string, applicant Applicant) (Reservation, error) {
	// TODO(cac-vas): confirm path + payload against https://vas.cac.gov.ng accredited docs.
	body := map[string]any{
		"proposed_name":     proposedName,
		"applicant_name":    applicant.FullName,
		"applicant_email":   applicant.Email,
		"applicant_phone":   applicant.Phone,
		"applicant_address": applicant.Address,
	}
	var data struct {
		Ref       string `json:"reservation_ref"`
		ExpiresAt string `json:"expires_at"`
	}
	if err := c.post(ctx, "/name-reservation", body, &data); err != nil {
		return Reservation{}, err
	}
	if data.Ref == "" {
		return Reservation{}, fmt.Errorf("cac: reserve name: empty reservation reference")
	}
	exp := parseTime(data.ExpiresAt)
	if exp.IsZero() {
		exp = time.Now().Add(60 * 24 * time.Hour) // CAC availability codes are long-lived; refresh on confirm
	}
	return Reservation{Ref: data.Ref, ExpiresAt: exp}, nil
}

func (c *httpProvider) SubmitRegistration(ctx context.Context, req RegistrationRequest) (Submission, error) {
	// TODO(cac-vas): confirm path + payload (proprietor identity block, documents,
	// objects, reservation linkage) against https://vas.cac.gov.ng accredited docs.
	props := make([]map[string]any, 0, len(req.Proprietors))
	for _, p := range req.Proprietors {
		props = append(props, map[string]any{
			"full_name": p.FullName,
			"role":      p.Role,
			"bvn":       p.BVN, // PII — sent to CAC only, never logged
			"nin":       p.NIN, // PII — sent to CAC only, never logged
			"share_pct": p.SharePct,
			"phone":     p.Phone,
			"email":     p.Email,
		})
	}
	body := map[string]any{
		"entity_type":      string(req.EntityType),
		"proposed_name":    req.ProposedName,
		"line_of_business": req.LineOfBusiness,
		"reservation_ref":  req.ReservationRef,
		"address":          req.Address,
		"objects":          req.Objects,
		"documents":        req.DocumentRefs,
		"proprietors":      props,
		// Registration fee included in the submission payload (kobo + naira for
		// providers that expect either). TODO(cac-vas): confirm the exact fee field name.
		"registration_fee_kobo":  req.FeeKobo,
		"registration_fee_naira": req.FeeKobo / 100,
	}
	var data struct {
		Ref    string `json:"registration_ref"`
		State  string `json:"state"`
		Status string `json:"status"`
	}
	if err := c.post(ctx, "/registrations", body, &data); err != nil {
		return Submission{}, err
	}
	if data.Ref == "" {
		return Submission{}, fmt.Errorf("cac: submit registration: empty registration reference")
	}
	state := firstNonEmpty(data.State, data.Status, "submitted")
	return Submission{Ref: data.Ref, Status: normalizeState(state)}, nil
}

func (c *httpProvider) GetRegistrationStatus(ctx context.Context, ref string) (RegistrationStatus, error) {
	// TODO(cac-vas): confirm path + response against https://vas.cac.gov.ng accredited docs.
	var data struct {
		State          string `json:"status"` // CAC data.status
		RCOrBNNumber   string `json:"rc_number"`
		Name           string `json:"company_name"`
		Reason         string `json:"reason"`
		CertificateURL string `json:"certificate_url"`
		CertificateAlt string `json:"certificate"`
	}
	if err := c.get(ctx, "/registrations/"+ref, &data); err != nil {
		return RegistrationStatus{}, err
	}
	return RegistrationStatus{
		State:          normalizeState(data.State),
		RCOrBNNumber:   data.RCOrBNNumber,
		RegisteredName: data.Name,
		Reason:         data.Reason,
		CertificateURL: firstNonEmpty(data.CertificateURL, data.CertificateAlt),
	}, nil
}

func (c *httpProvider) VerifyEntity(ctx context.Context, rcOrBnNumber string) (EntityVerification, error) {
	// CAC VAS verification returns the `data` envelope with rc_number + company_name
	// (business_name for BN entities), e.g. the confirmed sample:
	//   {statusCode:200,status:"OK",data:{rc_number:"66808794",company_name:"J&S group",...}}
	// TODO(cac-vas): confirm the exact verify PATH + whether it keys off the RC/BN
	// directly or a paid verification code ("vrc") against the accredited docs. Some
	// CAC VAS flows require POST {"vrc":"<code>"} after a verification purchase.
	var data struct {
		RCNumber     string `json:"rc_number"`
		CompanyName  string `json:"company_name"`
		BusinessName string `json:"business_name"`
		Status       string `json:"status"`
		Type         string `json:"type"`
		Classified   string `json:"classification"`
		RegisteredAt string `json:"registration_date"`
	}
	if err := c.get(ctx, "/entities/"+rcOrBnNumber, &data); err != nil {
		return EntityVerification{}, err
	}
	name := firstNonEmpty(data.CompanyName, data.BusinessName)
	return EntityVerification{
		Found:        name != "" || data.RCNumber != "",
		Name:         name,
		Status:       data.Status,
		Type:         firstNonEmpty(data.Type, data.Classified),
		RegisteredAt: data.RegisteredAt,
	}, nil
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

func (c *httpProvider) post(ctx context.Context, path string, body, dst any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("cac: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	c.sign(req, b)
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, dst)
}

func (c *httpProvider) get(ctx context.Context, path string, dst any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return err
	}
	c.sign(req, nil)
	return c.do(req, dst)
}

// sign applies the Bearer api key and, when a consumer secret is configured, an
// HMAC-SHA256 request signature header over the raw body (hex-encoded).
// TODO(cac-vas): confirm the exact signature scheme + header names against the
// accredited docs (Bearer vs consumer-key header; SHA256 vs SHA512; signed base).
func (c *httpProvider) sign(req *http.Request, body []byte) {
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	if c.consumerSecret != "" {
		mac := hmac.New(sha256.New, []byte(c.consumerSecret))
		mac.Write(body)
		req.Header.Set("X-CAC-Signature", hex.EncodeToString(mac.Sum(nil)))
	}
}

// cacEnvelope is the CONFIRMED CAC VAS response envelope, e.g.:
//
//	{ "statusCode":200, "status":"OK", "message":"...", "data":{...}, "success":true, "count":1 }
//
// `data` is captured raw and unmarshaled into the caller's typed struct only when
// the call succeeded. Note `status` is a STRING ("OK"), not a boolean.
type cacEnvelope struct {
	StatusCode int             `json:"statusCode"`
	Status     string          `json:"status"`
	Message    string          `json:"message"`
	Success    bool            `json:"success"`
	Count      int             `json:"count"`
	Data       json.RawMessage `json:"data"`
}

// do executes the request, unwraps the CAC envelope, verifies success, and
// unmarshals `data` into dst. dst may be nil when the caller only needs success.
func (c *httpProvider) do(req *http.Request, dst any) error {
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("cac: http request: %w", err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("cac: read response: %w", err)
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("cac: server error %d", resp.StatusCode)
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("cac: auth rejected (%d)", resp.StatusCode)
	}

	var env cacEnvelope
	if err := json.Unmarshal(b, &env); err != nil {
		return fmt.Errorf("cac: decode envelope (%d): %w", resp.StatusCode, err)
	}
	ok := env.Success || env.StatusCode == 200 || strings.EqualFold(env.Status, "OK")
	if !ok {
		msg := firstNonEmpty(env.Message, env.Status)
		if msg == "" {
			msg = fmt.Sprintf("status %d", firstNonZero(env.StatusCode, resp.StatusCode))
		}
		return fmt.Errorf("cac: %s", msg)
	}
	if dst != nil && len(env.Data) > 0 && string(env.Data) != "null" {
		if err := json.Unmarshal(env.Data, dst); err != nil {
			return fmt.Errorf("cac: decode data (%d): %w", resp.StatusCode, err)
		}
	}
	return nil
}

func firstNonZero(vals ...int) int {
	for _, v := range vals {
		if v != 0 {
			return v
		}
	}
	return 0
}

// VerifyWebhookSignature validates a CAC callback HMAC-SHA512 over the raw body,
// hex-encoded, with a constant-time compare. Exposed for a future webhook handler;
// rejects when the secret or signature is missing.
// TODO(cac-vas): confirm the digest + header against the accredited docs.
func (c *httpProvider) VerifyWebhookSignature(payload []byte, signature string) bool {
	if c.consumerSecret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha512.New, []byte(c.consumerSecret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}

// ── shared normalizers ───────────────────────────────────────────────────────

func normalizeState(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "available":
		return "available"
	case "reserved", "name_reserved":
		return "name_reserved"
	case "submitted", "accepted", "pending":
		return "submitted"
	case "under_review", "in_review", "processing", "reviewing":
		return "under_review"
	case "registered", "approved", "completed", "success", "successful":
		return "registered"
	case "rejected", "declined", "refused":
		return "rejected"
	case "failed", "error":
		return "failed"
	default:
		return strings.ToLower(strings.TrimSpace(s))
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func parseTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05Z07:00", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}
