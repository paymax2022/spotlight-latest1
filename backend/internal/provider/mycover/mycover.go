package mycover

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"spotlight/backend/internal/insurance/gateway"
)

// Client is the MyCover.ai aggregator adapter. It implements
// gateway.UnderwriterGateway. MyCover is an AGGREGATOR: it discloses the
// underwriter (the licensed risk-carrier) on each product, and this adapter
// surfaces that disclosure into the normalised models. Raw provider JSON NEVER
// leaks past this file.
//
// Keys come from config/env via New(); they are NEVER hard-coded and NEVER
// logged. The HTTP layer mirrors internal/provider/paystack.
//
// ════════════════════════════════════════════════════════════════════════════
// THE CENTRAL FACT ABOUT THIS PROVIDER
// ════════════════════════════════════════════════════════════════════════════
// This adapter targets MyCover **v2** (https://v2.api.mycover.ai/v2), which is
// the only API MyCover documents today. The v1 model — one bespoke purchase
// endpoint per product, then per product FAMILY — is a dead end and is gone from
// this file. v2 replaces all of it with:
//
//	POST /products/compute-price          ONE quote endpoint, all products
//	POST /products/buy                    ONE purchase endpoint, all products
//	GET  /public-product-details/{id}     the per-product form schema, NO AUTH
//
// The product is selected by a `product_id` UUID in the body. So the correct
// model is not "68 endpoints" nor "19 family endpoints" but:
//
//	one endpoint + one publicly-readable schema per product.
//
// Consequences this file is built around:
//
//   - GetQuote is a REAL provider call. v1 had no reachable quote endpoint and
//     the premium had to be computed locally from catalog pricing; v2's
//     compute-price returns the provider's own figure, so we never invent a
//     price again.
//   - Form schemas are FETCHED, not maintained. There is no hand-written table
//     of fields to drift out of date — adding a product really is a data change.
//   - MyCover documents NO idempotency mechanism on /products/buy. Idempotency
//     is therefore entirely Paymax's responsibility and is enforced upstream of
//     this adapter (see the insurance policy service); the header is still sent
//     in case the provider ever honours it, but nothing depends on that.
//
// Raw provider JSON NEVER leaks past this file. Keys come from config/env via
// New(); they are NEVER hard-coded and NEVER logged.
type Client struct {
	apiKey        string // secret key — server-to-server auth; never logged
	publicKey     string // publishable key — client-init / disclosure; safe to surface
	webhookSecret string
	baseURL       string
	httpClient    *http.Client
}

// defaultBaseURL is the MyCover v2 host, serving both test and live keys; the
// environment is selected by the key prefix (MCASECK_T… is test/staging).
// Verified live 2026-08-31.
//
// Two earlier defaults were wrong: `api.sandbox.mycover.ai` does not resolve in
// DNS at all, and `api.mycover.ai/v1` is the legacy API MyCover no longer
// documents (its /claims is 403 for the very key that gets 200 on v2).
const defaultBaseURL = "https://v2.api.mycover.ai/v2"

// Verified live endpoint paths (all v2).
const (
	// pathProducts lists the catalog in a LIGHT shape — ids, names, category,
	// provider, base_price. It carries neither route_name nor is_percentage nor
	// sharing_formula, so the sync follows each id to pathProduct.
	pathProducts = "/products/all"
	// pathProduct is the FULL product record.
	pathProduct = "/products/"
	// pathPublicProductDetails is the per-product form schema. It takes NO AUTH
	// and returns a BARE object with no responseCode envelope.
	pathPublicProductDetails = "/public-product-details/"
	// pathComputePrice is the quote endpoint: {"product_id":…,"body":{…}}.
	pathComputePrice = "/products/compute-price"
	// pathBuy is the single purchase endpoint: a flat body plus product_id.
	pathBuy      = "/products/buy"
	pathPolicies = "/policies"
	pathClaims   = "/claims"
	// pathUtility backs the dependent dropdowns a schema points at.
	pathUtility = "/products/utility/"
)

// detailFetchConcurrency bounds how many per-product detail calls a catalog sync
// makes at once. v2's list endpoint is a light shape, so the full record for each
// of the ~69 products must be fetched individually; done sequentially that
// overruns any sane request timeout. Kept modest so a sync does not look like an
// attack from the provider's side.
const detailFetchConcurrency = 8

// Sentinel errors callers can branch on.
var (
	// ErrProviderScope means the endpoint exists but our API key lacks the
	// scope for it (MyCover answers 403 "Forbidden resource"). It is a
	// credentials/entitlement problem, NOT a bug and NOT a retryable fault.
	ErrProviderScope = fmt.Errorf(
		"%w: mycover endpoint forbidden for this API key (missing scope)", gateway.ErrProviderRejected)
	// ErrUnsupported means MyCover exposes no endpoint for the operation at all.
	// We return it rather than inventing a call that would 404.
	ErrUnsupported = fmt.Errorf(
		"%w: operation not supported by the mycover API", gateway.ErrProviderRejected)
	// ErrNoProductID means the catalog row is missing the MyCover product uuid.
	// product_id is the ONLY thing that selects which cover is quoted or bought
	// on v2's single endpoints, so without it we would buy an unknown product.
	// Both quote and bind fail CLOSED.
	ErrNoProductID = fmt.Errorf(
		"%w: mycover product has no provider product id (run the catalog sync)",
		gateway.ErrProviderRejected)
	// ErrProductNotPurchasable means MyCover's own configuration for the product
	// is broken — no purchase config, or no sharing formula (which would earn
	// Paymax zero commission). Verified live for 7 of the 69 products. Selling
	// one would take a member's money for cover the provider cannot issue.
	ErrProductNotPurchasable = fmt.Errorf(
		"%w: mycover product is not purchasable — the provider's configuration for it is broken",
		gateway.ErrProviderRejected)
	// ErrNoFormSchema means the catalog row carries no published form schema, so
	// we cannot tell WHICH of the member's answers are monetary.
	//
	// MyCover's form inputs are naira and every client submits kobo, so an
	// unconverted answer reaches the insurer 100x too large — a ₦200,000 phone
	// declared as ₦20,000,000. The conversion is only safe because it keys off
	// the same schema the client rendered; with no schema there is nothing to key
	// off, and guessing is what caused the bug. Quote and bind fail CLOSED.
	ErrNoFormSchema = fmt.Errorf(
		"%w: mycover product has no published form schema, so its money inputs cannot be converted (run the catalog sync)",
		gateway.ErrProviderRejected)
	// ErrWebhookSecretMissing is returned when webhook verification is attempted
	// with no configured secret. Verification then fails CLOSED.
	ErrWebhookSecretMissing = errors.New("mycover: webhook secret not configured")

	// ErrInsufficientProviderFloat means MyCover accepted the whole payload and
	// then refused at settlement because PAYMAX'S PREFUNDED DISTRIBUTOR WALLET
	// with MyCover has no money in it.
	//
	// ⛔ This is the single most important error in this adapter, and it is NOT a
	// rare edge case. MyCover does not charge per transaction: the distributor
	// holds a prefunded balance and every policy purchase debits it. When that
	// float runs dry EVERY bind fails, all at once — so if members have already
	// been debited by then, we owe refunds at scale.
	//
	// It is deliberately its own type, distinct from a generic bind failure,
	// because the two demand opposite responses: a generic failure is a per-member
	// problem, while this one is a treasury problem that must stop the queue and
	// page an operator. Verified live: a fully valid purchase payload returns
	// {"responseCode":0,"responseText":"v2 Error: Insufficient wallet fund for purchase"}.
	// It WRAPS gateway.ErrProviderFloatExhausted so feature code can branch on
	// the condition without importing this provider package.
	ErrInsufficientProviderFloat = fmt.Errorf(
		"%w: mycover prefunded distributor wallet is empty — no policy can be bound until it is topped up",
		gateway.ErrProviderFloatExhausted)
)

// isInsufficientFloat detects the provider's prefunded-wallet refusal. MyCover
// reports it as a plain message with no distinct code, so the message is the only
// available signal. Matching is narrow and case-insensitive; a false negative
// merely degrades to a generic bind failure (safe), whereas a false positive
// would wrongly trip the treasury alarm.
func isInsufficientFloat(messages []string) bool {
	for _, m := range messages {
		l := strings.ToLower(m)
		if strings.Contains(l, "insufficient wallet fund") {
			return true
		}
		if strings.Contains(l, "insufficient") && strings.Contains(l, "wallet") && strings.Contains(l, "fund") {
			return true
		}
	}
	return false
}

// New constructs a MyCover adapter. baseURL may be empty to use the verified
// default host. apiKey = secret key (server auth); publicKey = publishable key.
func New(apiKey, publicKey, webhookSecret, baseURL string) *Client {
	if baseURL == "" {
		baseURL = defaultBaseURL
	}
	return &Client{
		apiKey:        apiKey,
		publicKey:     publicKey,
		webhookSecret: webhookSecret,
		baseURL:       strings.TrimRight(baseURL, "/"),
		httpClient:    &http.Client{Timeout: 45 * time.Second},
	}
}

// Name returns the stable aggregator id.
func (c *Client) Name() string { return "mycover" }

// BaseURL exposes the configured host for admin provider-health reporting.
func (c *Client) BaseURL() string { return c.baseURL }

// Configured reports whether a secret key is present. Used by the admin
// provider-health endpoint; it NEVER reveals the key itself.
func (c *Client) Configured() bool { return c.apiKey != "" }

// WebhookConfigured reports whether webhook verification can run at all. MyCover
// keys the signature on the secret API key, so a configured API key is enough.
// When false, VerifyWebhook fails closed and no provider webhook is ever
// accepted.
func (c *Client) WebhookConfigured() bool { return c.webhookKey() != "" }

// ════════════════════════════════════════════════════════════════════════════
// RESPONSE ENVELOPE
// ════════════════════════════════════════════════════════════════════════════
//
// Every MyCover endpoint answers with:
//
//	{ "responseCode": 1, "responseText": "...", "data": { ... } }
//
// responseCode 1 is success, 0 is failure. responseText is a STRING on the happy
// path but an ARRAY OF STRINGS on validation failure — decoding it into a
// `string` field panics/errors on every validation error, which is exactly the
// case a bind hits most. It is therefore decoded as json.RawMessage and
// flattened by Text().
type envelope struct {
	ResponseCode int             `json:"responseCode"`
	ResponseText json.RawMessage `json:"responseText"`
	Data         json.RawMessage `json:"data"`
	Path         string          `json:"path"`
}

// OK reports provider-level success.
func (e envelope) OK() bool { return e.ResponseCode == 1 }

// Text flattens responseText, which is either a string or an array of strings.
func (e envelope) Text() string {
	if len(e.ResponseText) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(e.ResponseText, &s); err == nil {
		return s
	}
	var list []string
	if err := json.Unmarshal(e.ResponseText, &list); err == nil {
		return strings.Join(list, "; ")
	}
	// Neither shape — surface the raw text rather than swallowing the reason.
	return string(e.ResponseText)
}

// Messages returns responseText as a list — the natural shape for the
// field-by-field validation errors a buy endpoint returns. A plain string
// response comes back as a single-element list.
func (e envelope) Messages() []string {
	if len(e.ResponseText) == 0 {
		return nil
	}
	var list []string
	if err := json.Unmarshal(e.ResponseText, &list); err == nil {
		return list
	}
	var s string
	if err := json.Unmarshal(e.ResponseText, &s); err == nil && s != "" {
		return []string{s}
	}
	return nil
}

// APIError is a normalised provider failure. It carries the HTTP status, the
// provider's responseCode and the flattened message list. It NEVER carries the
// request body (which holds PII) or the API key.
type APIError struct {
	StatusCode   int
	ResponseCode int
	Path         string
	Messages     []string
}

// Unwrap makes every structured provider error match gateway.ErrProviderRejected:
// an APIError only exists because MyCover ANSWERED and refused, so nothing was
// created and a retry is safe.
func (e *APIError) Unwrap() error { return gateway.ErrProviderRejected }

func (e *APIError) Error() string {
	msg := strings.Join(e.Messages, "; ")
	if msg == "" {
		msg = "no message"
	}
	return fmt.Sprintf("mycover: %s (http %d, responseCode %d)", msg, e.StatusCode, e.ResponseCode)
}

// Validation reports whether this is a per-field validation rejection (HTTP 400
// with a message list) rather than a transport or entitlement failure. Callers
// surface these to the member as form errors.
func (e *APIError) Validation() bool { return e.StatusCode == http.StatusBadRequest }

// ValidationMessages satisfies gateway.ValidationRejection, so the policy layer
// can surface these as form errors without importing this package. Returns nil
// when this is not a validation rejection, so a transport or entitlement failure
// can never be mistaken for something the applicant can fix.
func (e *APIError) ValidationMessages() []string {
	if !e.Validation() {
		return nil
	}
	return e.Messages
}

// ════════════════════════════════════════════════════════════════════════════
// CATALOG — GET /products/get-all-products
// ════════════════════════════════════════════════════════════════════════════

// CatalogProduct is the normalised view of one MyCover product. Money has
// ALREADY crossed the naira→kobo boundary here (see money.go) — nothing
// downstream of this struct ever sees a naira decimal string again.
type CatalogProduct struct {
	ProviderProductID string // MyCover uuid
	Code              string // route_name — the stable per-product key
	Prefix            string // underwriter prefix used in the buy path
	Name              string
	Description       string
	Category          string // Life | Auto | Health | Content | Gadget | Package | Travel
	Underwriter       string // provider.organization_name — the disclosed risk carrier
	UnderwriterLogo   string
	Currency          string
	Country           string

	// --- Pricing, in Paymax units ---
	IsPercentage bool
	// BasePriceKobo is the flat premium in kobo when IsPercentage is false.
	BasePriceKobo int64
	// RateBps is the premium rate in basis points when IsPercentage is true.
	RateBps int64
	// BasePriceRaw is the provider's original decimal string, retained verbatim
	// for reconciliation and audit (never used for arithmetic).
	BasePriceRaw string
	// DefaultSumInsuredKobo comes from meta.sum_insured when the product
	// declares a fixed cover amount; 0 otherwise.
	DefaultSumInsuredKobo int64

	// --- Commission split (whole percents as MyCover states them) ---
	DistributorCommissionPercent string // Paymax's revenue share
	MCACommissionPercent         string
	ProviderCommissionPercent    string
	CommissionFrom               string // original_premium | final_premium

	// --- Cover terms ---
	CoverPeriodDays   int
	IsRenewable       bool
	IsClaimable       bool
	IsInspectable     bool
	IsCertificateable bool
	Active            bool

	// --- Display copy (HTML — render sanitised) ---
	KeyBenefitsHTML  string
	FullBenefitsHTML string
	HowItWorksHTML   string
	HowToClaimHTML   string
	DocumentURL      string

	// Raw is the provider's product object, retained for reconciliation and for
	// fields we have not yet promoted. It is stored, never interpreted here.
	Raw json.RawMessage
}

// rawProduct mirrors the provider JSON for one product. It exists only inside
// this file.
type rawProduct struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Description  string          `json:"description"`
	RouteName    string          `json:"route_name"`
	Prefix       string          `json:"prefix"`
	BasePrice    json.RawMessage `json:"base_price"`   // decimal STRING (sometimes a number)
	CoverPeriod  json.RawMessage `json:"cover_period"` // string of days (sometimes a number)
	IsPercentage bool            `json:"is_percentage"`
	IsRenewable  bool            `json:"is_renewable"`
	IsClaimable  bool            `json:"is_claimable"`
	IsInspect    bool            `json:"is_inspectable"`
	IsCertable   bool            `json:"is_certificateable"`
	IsActive     bool            `json:"is_active"`
	// The copy fields are NOT consistently typed on the live API: most products
	// send an HTML string, but some send an ARRAY of strings (found by calling
	// the real catalog — a fixture built from one product will not show it).
	// flexText accepts either.
	KeyBenefits  flexText        `json:"key_benefits"`
	FullBenefits flexText        `json:"full_benefits"`
	HowItWorks   flexText        `json:"how_it_works"`
	HowToClaim   flexText        `json:"how_to_claim"`
	DocumentURL  string          `json:"document_url"`
	Meta         json.RawMessage `json:"meta"`
	Category     struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"category"`
	Provider struct {
		ID               string `json:"id"`
		OrganizationName string `json:"organization_name"`
		Logo             string `json:"logo"`
	} `json:"provider"`
	Currency struct {
		Name string `json:"name"`
	} `json:"currency"`
	Country struct {
		Name string `json:"name"`
	} `json:"country"`
	SharingFormula []struct {
		MCACommission         json.RawMessage `json:"mca_commission"`
		ProviderCommission    json.RawMessage `json:"provider_commission"`
		DistributorCommission json.RawMessage `json:"distributor_commission"`
		CommissionFrom        string          `json:"provider_commission_from"`
	} `json:"sharing_formula"`
}

// ListProducts pulls one page of the live product catalog. limit is capped by
// the provider; 100 returns the whole catalog today (68 products).
//
// This is NOT part of gateway.UnderwriterGateway — catalogue sync is an
// aggregator-specific capability, exposed through the narrow CatalogSource
// interface the catalog package depends on.
func (c *Client) ListProducts(ctx context.Context, page, limit int) ([]CatalogProduct, int, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 100
	}
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	q.Set("limit", strconv.Itoa(limit))

	env, err := c.get(ctx, pathProducts+"?"+q.Encode())
	if err != nil {
		return nil, 0, err
	}
	// v2's list is a LIGHT shape: id, name, category, provider, base_price. It
	// carries neither route_name nor is_percentage nor sharing_formula, so the
	// authoritative record for each product is fetched by id below.
	var payload struct {
		TotalCount int `json:"total_count"`
		Products   []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"products"`
	}
	if err := json.Unmarshal(env.Data, &payload); err != nil {
		return nil, 0, fmt.Errorf("mycover: decode product list: %w", err)
	}

	// Fetch the full records CONCURRENTLY. 69 sequential round-trips overruns any
	// sane request timeout; a bounded pool keeps the sync inside one admin
	// request without hammering the provider.
	type result struct {
		idx  int
		prod CatalogProduct
		err  error
		id   string
		name string
	}
	results := make([]result, len(payload.Products))
	sem := make(chan struct{}, detailFetchConcurrency)
	var wg sync.WaitGroup

	for i, light := range payload.Products {
		if light.ID == "" {
			results[i] = result{idx: i, err: fmt.Errorf("product has no id")}
			continue
		}
		wg.Add(1)
		go func(i int, id, name string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			p, err := c.GetProduct(ctx, id)
			results[i] = result{idx: i, prod: p, err: err, id: id, name: name}
		}(i, light.ID, light.Name)
	}
	wg.Wait()

	// Reassemble in catalog order so a sync is deterministic run to run.
	out := make([]CatalogProduct, 0, len(payload.Products))
	for _, r := range results {
		if r.err != nil {
			// One unreadable product must not sink the whole sync. Name it and
			// carry on — a product id is not a secret.
			if r.id != "" {
				log.Printf("[mycover] skipping product %s (%q) during sync: %v", r.id, r.name, r.err)
			}
			continue
		}
		if r.prod.Code == "" {
			continue
		}
		out = append(out, r.prod)
	}
	return out, payload.TotalCount, nil
}

// GetProduct fetches ONE full product record by MyCover uuid.
func (c *Client) GetProduct(ctx context.Context, productID string) (CatalogProduct, error) {
	if productID == "" {
		return CatalogProduct{}, fmt.Errorf("mycover: empty product id")
	}
	env, err := c.get(ctx, pathProduct+url.PathEscape(productID))
	if err != nil {
		return CatalogProduct{}, err
	}
	// The record is sometimes wrapped one level down.
	raw := env.Data
	var probe map[string]json.RawMessage
	if json.Unmarshal(raw, &probe) == nil {
		if inner, ok := probe["product"]; ok {
			raw = inner
		}
	}
	var rp rawProduct
	if err := json.Unmarshal(raw, &rp); err != nil {
		return CatalogProduct{}, fmt.Errorf("mycover: decode product %s: %w", productID, err)
	}
	if rp.ID == "" {
		rp.ID = productID
	}
	p, err := normaliseProduct(rp)
	if err != nil {
		return CatalogProduct{}, err
	}
	p.Raw = raw
	return p, nil
}

// normaliseProduct converts provider JSON to the normalised catalog view,
// crossing the naira→kobo money boundary exactly once.
func normaliseProduct(rp rawProduct) (CatalogProduct, error) {
	// route_name is the human-readable stable key, but it is NOT guaranteed:
	// the v2-only "Comprehensive Auto (AAS)" product has none. Fall back to the
	// uuid so the product is still catalogued rather than silently dropped —
	// invisible cover is worse than an ugly code.
	if rp.RouteName == "" {
		if rp.ID == "" {
			return CatalogProduct{}, fmt.Errorf("product has neither route_name nor id")
		}
		rp.RouteName = rp.ID
	}
	basePrice := jsonNumberOrString(rp.BasePrice)
	p := CatalogProduct{
		ProviderProductID: rp.ID,
		Code:              rp.RouteName,
		Prefix:            rp.Prefix,
		Name:              rp.Name,
		Description:       rp.Description,
		Category:          rp.Category.Name,
		Underwriter:       rp.Provider.OrganizationName,
		UnderwriterLogo:   rp.Provider.Logo,
		Currency:          rp.Currency.Name,
		Country:           rp.Country.Name,
		IsPercentage:      rp.IsPercentage,
		BasePriceRaw:      basePrice,
		CoverPeriodDays:   atoiSafe(jsonNumberOrString(rp.CoverPeriod)),
		IsRenewable:       rp.IsRenewable,
		IsClaimable:       rp.IsClaimable,
		IsInspectable:     rp.IsInspect,
		IsCertificateable: rp.IsCertable,
		Active:            rp.IsActive,
		KeyBenefitsHTML:   rp.KeyBenefits.String(),
		FullBenefitsHTML:  rp.FullBenefits.String(),
		HowItWorksHTML:    rp.HowItWorks.String(),
		HowToClaimHTML:    rp.HowToClaim.String(),
		DocumentURL:       rp.DocumentURL,
	}

	// --- MONEY BOUNDARY: naira decimal string → integer kobo / bps ---
	if basePrice != "" {
		if rp.IsPercentage {
			bps, err := RateToBps(basePrice)
			if err != nil {
				return CatalogProduct{}, fmt.Errorf("base_price rate: %w", err)
			}
			p.RateBps = bps
		} else {
			kobo, err := NairaToKobo(basePrice)
			if err != nil {
				return CatalogProduct{}, fmt.Errorf("base_price amount: %w", err)
			}
			p.BasePriceKobo = kobo
		}
	}

	// meta.sum_insured is a declared cover amount in NAIRA on some products.
	if si := metaSumInsured(rp.Meta); si != "" {
		if kobo, err := NairaToKobo(si); err == nil {
			p.DefaultSumInsuredKobo = kobo
		}
	}

	if len(rp.SharingFormula) > 0 {
		sf := rp.SharingFormula[0]
		p.DistributorCommissionPercent = jsonNumberOrString(sf.DistributorCommission)
		p.MCACommissionPercent = jsonNumberOrString(sf.MCACommission)
		p.ProviderCommissionPercent = jsonNumberOrString(sf.ProviderCommission)
		p.CommissionFrom = sf.CommissionFrom
	}
	return p, nil
}

// flexText holds a provider copy field that arrives as either a string or an
// array of strings. Decoding it as a plain string fails the WHOLE catalog sync
// on the first product that uses the array form — which is how the live API
// differs from any single-product fixture.
type flexText struct{ v string }

// String returns the flattened text.
func (f flexText) String() string { return f.v }

// UnmarshalJSON accepts a string, an array of strings, or null.
func (f *flexText) UnmarshalJSON(b []byte) error {
	if len(b) == 0 || string(b) == "null" {
		f.v = ""
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		f.v = s
		return nil
	}
	var list []string
	if err := json.Unmarshal(b, &list); err == nil {
		// Each element is a self-contained HTML fragment; concatenating keeps the
		// markup renderable as one block.
		f.v = strings.Join(list, "")
		return nil
	}
	// An unexpected shape (object, number) must not sink the sync — the field is
	// display copy, not money. Keep it empty and carry on.
	f.v = ""
	return nil
}

// jsonNumberOrString renders a JSON value that MyCover sends inconsistently as
// either a quoted decimal string or a bare number into its canonical string
// form, WITHOUT going through float64.
func jsonNumberOrString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	s := strings.TrimSpace(string(raw))
	if s == "null" {
		return ""
	}
	if strings.HasPrefix(s, `"`) {
		var out string
		if err := json.Unmarshal(raw, &out); err == nil {
			return strings.TrimSpace(out)
		}
		return ""
	}
	// A bare JSON number: its literal text IS the exact decimal. Never parse it
	// into a float64 first — that is where drift enters.
	return s
}

// metaSumInsured pulls meta.sum_insured when meta is an object. meta is
// sometimes a plain string on this API, which is why it is decoded defensively.
func metaSumInsured(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return ""
	}
	v, ok := m["sum_insured"]
	if !ok {
		return ""
	}
	return jsonNumberOrString(v)
}

func atoiSafe(s string) int {
	// cover_period arrives as "365"; a decimal form ("365.0") is truncated at the
	// dot rather than rejected — cover period is a term, not money.
	if i := strings.IndexByte(s, '.'); i >= 0 {
		s = s[:i]
	}
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

// FieldProductID is the body field v2's single quote and purchase endpoints use
// to select WHICH product is being priced or bought. Its value is the product's
// MyCover uuid. It is the only routing information a call carries — there is no
// per-product URL any more.
const FieldProductID = "product_id"

// BuyPath is v2's ONE purchase endpoint, shared by every product. It is exported
// so the catalog can record it per row: the column stays meaningful if a second
// aggregator (or a future MyCover version) ever needs a different path, without
// the sync hard-coding a literal.
const BuyPath = pathBuy

// QuotePath is v2's ONE quote endpoint, shared by every product.
const QuotePath = pathComputePrice

// FieldPaymentPlan is the instalment count (1..12 months) some products accept.
//
// Under v2 it is just one more schema field: it is forwarded to compute-price
// like any other answer and the PROVIDER returns the resulting premium (verified
// live: plan 1 prices at NGN4,000, plan 12 at NGN48,000 for the same product).
// There is nothing here for Paymax to compute and therefore nothing to get
// wrong — which is why v1's refusal to quote instalment plans is gone.
const FieldPaymentPlan = "payment_plan"

// ════════════════════════════════════════════════════════════════════════════
// gateway.UnderwriterGateway
// ════════════════════════════════════════════════════════════════════════════

// providerBody turns the member's stored answers into the body MyCover expects.
//
// It is the OUTBOUND MONEY BOUNDARY for form inputs. Every value the internal
// contract carries — including every money field — is INTEGER KOBO; MyCover's
// form fields are NAIRA. Exactly the paths the product's PUBLISHED schema
// classified as `money` are rescaled, once, here. Everything else is copied
// verbatim, and the caller's map is never mutated (quote answers are persisted
// and replayed at bind time).
//
// It fails CLOSED when the schema is unknown: without it we cannot tell which
// answers are money, and forwarding them unscaled is the 100x bug itself.
func providerBody(p gateway.ProviderProduct, inputs map[string]any) (map[string]any, error) {
	if !p.FormSchemaKnown {
		return nil, fmt.Errorf("%w: %s", ErrNoFormSchema, p.Code)
	}
	body, err := ConvertMoneyInputsToNaira(inputs, p.MoneyInputPaths)
	if err != nil {
		return nil, fmt.Errorf("%w: %s: %s", gateway.ErrProviderRejected, p.Code, err)
	}
	if body == nil {
		body = map[string]any{}
	}
	return body, nil
}

// GetQuote prices a product by calling MyCover's REAL quote endpoint,
// POST /products/compute-price with {"product_id": …, "body": {…fields…}}.
//
// This is the single biggest correctness win of v2. Under v1 there was no
// reachable quote endpoint (compute-price was 403), so the premium had to be
// derived locally from catalog pricing — an amount Paymax computed and then
// charged. Now the provider returns its own figure and we never invent a price:
// the number the member is debited is the number the underwriter quoted.
//
// The naira→kobo crossing happens once, here, on the way back.
func (c *Client) GetQuote(ctx context.Context, req gateway.QuoteRequest) (gateway.Quote, error) {
	p := req.Product
	if p.Code == "" {
		p.Code = req.ProviderProductCode
	}
	if p.ProviderProductID == "" {
		return gateway.Quote{}, fmt.Errorf("%w: cannot price %q", ErrNoProductID, p.Code)
	}
	if p.NotPurchasable {
		return gateway.Quote{}, fmt.Errorf("%w: %s", ErrProductNotPurchasable, p.Code)
	}

	// The body is the product's own schema-validated answers. We add nothing
	// MyCover's schema does not declare — unknown fields are a validation risk,
	// and mapping is the schema's job, upstream — but the MONEY answers are
	// rescaled here, exactly once, from the kobo the internal contract carries to
	// the naira the provider's form fields are denominated in.
	fields, err := providerBody(p, req.Inputs)
	if err != nil {
		return gateway.Quote{}, err
	}
	delete(fields, FieldProductID) // it travels in the envelope, not the body

	env, err := c.postIdem(ctx, pathComputePrice, "", map[string]any{
		FieldProductID: p.ProviderProductID,
		"body":         fields,
	})
	if err != nil {
		return gateway.Quote{}, err
	}

	m := decodeObject(env.Data)
	// `price` is the verified key — compute-price answers {"data":{"price":4000}}.
	// The rest are accepted defensively in case the provider enriches the shape.
	premium := pickMoney(m, "price", "premium", "amount", "total_price", "final_premium", "computed_price")
	if premium <= 0 {
		// A zero premium would debit nothing and bind cover nobody paid for.
		// Refuse rather than pass it on.
		return gateway.Quote{}, fmt.Errorf("mycover: compute-price returned no usable premium for %q", p.Code)
	}
	sumInsured := pickMoney(m, "sum_insured", "sum_assured", "cover_amount", "insured_value")
	if sumInsured <= 0 {
		sumInsured = req.SumInsuredKobo
	}
	if sumInsured <= 0 {
		sumInsured = p.DefaultSumInsuredKobo
	}

	currency := req.Currency
	if currency == "" {
		currency = "NGN"
	}

	// Paymax's distributor slice of the PROVIDER'S premium, from the catalog's
	// sharing_formula. Integer math on an integer premium.
	commission := PremiumFromRateBps(premium, p.CommissionBps)

	expires := time.Now().Add(24 * time.Hour)
	if p.CoverPeriodDays > 0 {
		if cover := time.Now().AddDate(0, 0, p.CoverPeriodDays); cover.Before(expires) {
			expires = cover
		}
	}

	return gateway.Quote{
		ProviderQuoteRef:    pickString(m, "quote_id", "reference", "quote_reference"),
		ProviderProductCode: p.Code,
		PremiumKobo:         premium,
		SumInsuredKobo:      sumInsured,
		Currency:            currency,
		Underwriter:         p.Underwriter,
		Aggregator:          c.Name(),
		CommissionKobo:      commission,
		ExpiresAt:           expires,
		Terms: map[string]any{
			"priced_by":         "provider",
			"pricing_model":     pricingModel(p.IsPercentage),
			"cover_period_days": p.CoverPeriodDays,
			"renewable":         p.IsRenewable,
			"claimable":         p.IsClaimable,
			"certificateable":   p.IsCertificateable,
		},
	}, nil
}

func pricingModel(isPct bool) string {
	if isPct {
		return "percentage_of_sum_insured"
	}
	return "flat"
}

// BindPolicy purchases cover through v2's SINGLE purchase endpoint,
// POST /products/buy, with a flat body of the product's own fields plus
// product_id.
//
// ⚠️ IDEMPOTENCY IS OURS. MyCover documents no idempotency mechanism on this
// endpoint, so a retried call would create a SECOND policy and debit our float
// twice. The Idempotency-Key header is sent in case the provider ever honours
// it, but nothing depends on that: the guarantee is enforced upstream, where a
// claimed key gates the outbound call (see insurance/policy). Never call this
// method outside that guard.
func (c *Client) BindPolicy(ctx context.Context, req gateway.BindRequest) (gateway.Policy, error) {
	p := req.Product
	if p.Code == "" {
		p.Code = req.ProviderProductCode
	}
	if p.ProviderProductID == "" {
		return gateway.Policy{}, fmt.Errorf("%w: cannot buy %q", ErrNoProductID, p.Code)
	}
	if p.NotPurchasable {
		return gateway.Policy{}, fmt.Errorf("%w: %s", ErrProductNotPurchasable, p.Code)
	}

	body, err := providerBody(p, req.Inputs)
	if err != nil {
		return gateway.Policy{}, err
	}
	body[FieldProductID] = p.ProviderProductID

	env, err := c.postIdem(ctx, pathBuy, req.IdempotencyKey, body)
	if err != nil {
		return gateway.Policy{}, err
	}

	pol := c.policyFromData(env.Data, p)
	if pol.PremiumKobo == 0 {
		pol.PremiumKobo = req.PremiumKobo
	}
	if pol.SumInsuredKobo == 0 {
		pol.SumInsuredKobo = req.SumInsuredKobo
	}
	if pol.Currency == "" {
		pol.Currency = req.Currency
	}
	if pol.CommissionKobo == 0 {
		pol.CommissionKobo = PremiumFromRateBps(pol.PremiumKobo, p.CommissionBps)
	}
	if pol.ProviderPolicyRef == "" {
		// A purchase we cannot reference is a purchase we cannot service, renew,
		// claim against or reconcile. Treat it as a failure so the saga reverses
		// the member rather than recording a policy we can never find again.
		return gateway.Policy{}, fmt.Errorf("mycover: purchase succeeded but returned no policy reference (product %q)", p.Code)
	}

	// MONEY GUARD: the provider's own premium is authoritative. A divergence from
	// what we quoted and debited is a reconciliation break, not a rounding
	// nuisance — say so loudly.
	if req.PremiumKobo > 0 && pol.PremiumKobo != req.PremiumKobo {
		log.Printf("[mycover] WARN premium divergence on product %q: quoted %d kobo, provider charged %d kobo",
			p.Code, req.PremiumKobo, pol.PremiumKobo)
	}
	return pol, nil
}

// GetPolicy fetches one policy. MyCover keys this endpoint on the policy UUID
// ("Id must be a uuid" for anything else), so providerPolicyRef must be the
// provider's uuid.
func (c *Client) GetPolicy(ctx context.Context, providerPolicyRef string) (gateway.Policy, error) {
	if providerPolicyRef == "" {
		return gateway.Policy{}, fmt.Errorf("mycover: empty policy reference")
	}
	env, err := c.get(ctx, pathPolicies+"/"+url.PathEscape(providerPolicyRef))
	if err != nil {
		return gateway.Policy{}, err
	}
	return c.policyFromData(env.Data, gateway.ProviderProduct{}), nil
}

// ListPolicies returns the policies MyCover holds for our account. It backs the
// admin reconciliation view (our policies vs the provider's).
//
// Not part of the gateway interface — reconciliation is aggregator-specific.
func (c *Client) ListPolicies(ctx context.Context, page, limit int) ([]gateway.Policy, int, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 100
	}
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	q.Set("limit", strconv.Itoa(limit))

	env, err := c.get(ctx, pathPolicies+"?"+q.Encode())
	if err != nil {
		return nil, 0, err
	}
	var payload struct {
		TotalCount int               `json:"total_count"`
		Policies   []json.RawMessage `json:"policies"`
	}
	if err := json.Unmarshal(env.Data, &payload); err != nil {
		return nil, 0, fmt.Errorf("mycover: decode policy list: %w", err)
	}
	out := make([]gateway.Policy, 0, len(payload.Policies))
	for _, raw := range payload.Policies {
		out = append(out, c.policyFromData(raw, gateway.ProviderProduct{}))
	}
	return out, payload.TotalCount, nil
}

// CancelPolicy is NOT SUPPORTED by MyCover's public API. No cancellation
// endpoint was found by live probing, and inventing one would 404 while
// reporting a cancellation that never happened. Cancellation is an underwriter
// back-office action today.
func (c *Client) CancelPolicy(ctx context.Context, providerPolicyRef, reason string) (gateway.Policy, error) {
	return gateway.Policy{}, fmt.Errorf("%w: policy cancellation", ErrUnsupported)
}

// SubmitClaim is NOT SUPPORTED as an API call.
//
// VERIFIED LIVE: POST /v2/claims returns 404 "Cannot POST /v2/claims". MyCover
// files claims through a HOSTED FLOW, not a REST endpoint: every
// purchase.successful / policy.updated webhook carries an `sdk.claim_link`, the
// member is redirected there, and claim progress returns over webhooks.
//
// So the Paymax claims module for this aggregator is "store the link, deep-link
// the member, ingest webhooks" — never a POST. Returning ErrUnsupported here is
// the honest answer; inventing a call would 404 while telling the member their
// claim was filed.
//
// (The v1 403 on /claims was a scope limit on the legacy API, not a missing
// path: v2's GET /claims answers 200 for the same key.)
func (c *Client) SubmitClaim(ctx context.Context, req gateway.ClaimRequest) (gateway.Claim, error) {
	return gateway.Claim{}, fmt.Errorf(
		"%w: claim filing (MyCover uses a hosted claim link delivered on the purchase webhook)", ErrUnsupported)
}

// ListClaims returns the claims MyCover holds for our account. Verified live:
// 200 on v2 (the v1 403 was a legacy scope limit).
func (c *Client) ListClaims(ctx context.Context, page, limit int) ([]gateway.Claim, int, error) {
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 100
	}
	q := url.Values{}
	q.Set("page", strconv.Itoa(page))
	q.Set("limit", strconv.Itoa(limit))
	env, err := c.get(ctx, pathClaims+"?"+q.Encode())
	if err != nil {
		return nil, 0, err
	}
	var payload struct {
		TotalCount int               `json:"total_count"`
		Claims     []json.RawMessage `json:"claims"`
	}
	if err := json.Unmarshal(env.Data, &payload); err != nil {
		return nil, 0, fmt.Errorf("mycover: decode claim list: %w", err)
	}
	out := make([]gateway.Claim, 0, len(payload.Claims))
	for _, raw := range payload.Claims {
		out = append(out, c.claimFromData(raw, ""))
	}
	return out, payload.TotalCount, nil
}

// GetClaim reads one claim by provider reference.
func (c *Client) GetClaim(ctx context.Context, providerClaimRef string) (gateway.Claim, error) {
	if providerClaimRef == "" {
		return gateway.Claim{}, fmt.Errorf("mycover: empty claim reference")
	}
	env, err := c.get(ctx, pathClaims+"/"+url.PathEscape(providerClaimRef))
	if err != nil {
		return gateway.Claim{}, err
	}
	return c.claimFromData(env.Data, ""), nil
}

// UploadEvidence is NOT SUPPORTED. Evidence is submitted inside MyCover's hosted
// claim flow (sdk.claim_link), which is also where inspections happen — there is
// no documents endpoint to post to. Paymax stores its own copy of what the
// member uploads; forwarding it is not ours to do.
func (c *Client) UploadEvidence(ctx context.Context, up gateway.EvidenceUpload) error {
	return fmt.Errorf("%w: claim evidence upload (handled in the hosted claim flow)", ErrUnsupported)
}

// webhookSignatureHeader is the header MyCover signs its callbacks with.
//
// Note "mycoverai", not "mycover": the header does NOT match the aggregator slug
// used in our webhook URL, which is why the header name has to be declared by
// the adapter rather than derived from the route.
const webhookSignatureHeader = "x-mycoverai-signature"

// WebhookSignatureHeader implements gateway.UnderwriterGateway.
func (c *Client) WebhookSignatureHeader() string { return webhookSignatureHeader }

// webhookKey returns the HMAC key for webhook verification.
//
// MyCover issues NO separate webhook secret: the signature is keyed on the
// distributor's own secret API key. So an empty INSURANCE_MYCOVER_WEBHOOK_SECRET
// was never a missing credential — it was a misunderstanding — and the API key
// is the correct fallback. Both empty still fails closed.
func (c *Client) webhookKey() string {
	if c.webhookSecret != "" {
		return c.webhookSecret
	}
	return c.apiKey
}

// VerifyWebhook validates the webhook signature and returns the normalised
// event. SignatureValid is false (err nil) when the signature does not match.
//
// Scheme: HMAC-SHA512, hex digest, over the RAW request body, keyed on the
// MCASECK_* secret API key; delivered in the `x-mycoverai-signature` header.
// The body must be the bytes as received — re-serialising the JSON reorders or
// re-spaces it and the digest will not match.
//
// ⚠️ FAILS CLOSED. With no key configured, every inbound webhook is rejected.
// Accepting unsigned provider callbacks would let anyone who can reach the
// endpoint activate policies and approve claims, so this is deliberately never
// stubbed to return valid.
//
// ⚠️ UNPROVEN AGAINST A REAL DELIVERY. Our account has never received a webhook
// (it holds zero policies and no callback URL is registered in the MyCover
// dashboard), so this recipe comes from the documentation and has not been
// confirmed against a genuine signed request. Re-verify on the first real
// delivery before trusting webhook-driven state changes.
func (c *Client) VerifyWebhook(ctx context.Context, payload []byte, signature string) (gateway.WebhookEvent, error) {
	key := c.webhookKey()
	if key == "" {
		// No key: reject, and name the reason so nobody is tempted to "fix" it by
		// disabling verification.
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: false}, nil
	}
	if !verifyHMACSHA512(key, payload, signature) {
		// Log the DIGESTS on a mismatch — never the key, never the raw body.
		//
		// The signing recipe is documented but has never been confirmed against a
		// real delivery (this account has received none). When the first genuine
		// webhook arrives and is rejected, these two values are the difference
		// between diagnosing it in one pass and guessing at the algorithm, the
		// key and the canonicalisation all at once.
		mac := hmac.New(sha512.New, []byte(key))
		mac.Write(payload)
		log.Printf("[mycover] webhook signature mismatch: computed %s, received %s (body %d bytes)",
			hex.EncodeToString(mac.Sum(nil)), redactDigest(signature), len(payload))
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: false}, nil
	}
	var w webhookPayload
	if err := json.Unmarshal(payload, &w); err != nil {
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: true}, fmt.Errorf("mycover: decode webhook: %w", err)
	}
	return gateway.WebhookEvent{
		Provider:          c.Name(),
		EventType:         normaliseEventType(firstNonEmpty(w.Event, w.EventName)),
		ExternalEventID:   firstNonEmpty(w.ID, w.EventID, w.Reference),
		ProviderPolicyRef: firstNonEmpty(w.Data.Essential.PolicyID, w.Data.PolicyID, w.Data.PolicyRef, w.Data.ID),
		ProviderClaimRef:  firstNonEmpty(w.Data.Essential.ClaimID, w.Data.ClaimID, w.Data.ClaimRef),
		SignatureValid:    true,
	}, nil
}

// normaliseEventType translates MyCover's callback vocabulary into the internal
// contract's.
//
// MyCover names events <resource>.<action> ("purchase.successful"), while the
// webhook service speaks policy.bound / policy.cancelled / policy.lapsed /
// policy.expired. Nothing translated between them, so a real delivery verified
// its signature and was then dropped as an "unhandled event type" — the webhook
// worked and did nothing.
//
// ⚠️ Only UNAMBIGUOUS events are translated. webhooks.policyTargetState turns
// policy.bound into ACTIVE, so mapping a vague "policy.updated" onto it would
// reactivate a policy the provider had just cancelled. An unrecognised event is
// passed through unchanged and logged as unhandled, which is the safe failure;
// silently marking cover active is not. The event vocabulary is still DOCS ONLY
// (no delivery has ever reached this account), so err toward passing through.
func normaliseEventType(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "purchase.successful":
		// The event a real MyCover purchase emits. A successful purchase IS a bind.
		return "policy.bound"
	default:
		return strings.TrimSpace(s)
	}
}

// webhookPayload mirrors MyCover's v2 callback envelope:
//
//	{"event":"purchase.successful","status":"processed","event_id":"<nanoid>",
//	 "data":{"meta":{…},"essential":{…},"sdk":{…}}}
//
// event_id is a nanoid and is the webhook idempotency key.
type webhookPayload struct {
	ID        string `json:"id"`
	EventID   string `json:"event_id"`
	Reference string `json:"reference"`
	Event     string `json:"event"`
	EventName string `json:"event_name"`
	Data      struct {
		ID        string `json:"id"`
		PolicyID  string `json:"policy_id"`
		PolicyRef string `json:"policy_ref"`
		ClaimID   string `json:"claim_id"`
		ClaimRef  string `json:"claim_ref"`
		Essential struct {
			PolicyID       string `json:"policy_id"`
			PolicyNumber   string `json:"policy_number"`
			ClaimID        string `json:"claim_id"`
			ProductID      string `json:"product_id"`
			CertificateURL string `json:"certificate_url"`
		} `json:"essential"`
	} `json:"data"`
}

// ════════════════════════════════════════════════════════════════════════════
// Normalisation of purchase / policy / claim payloads
// ════════════════════════════════════════════════════════════════════════════
//
// MyCover's purchase responses are per-product and the account has no purchased
// policies yet to sample, so these decoders are KEY-TOLERANT: they accept any of
// the field names the API uses across its documented shapes rather than pinning
// one guess. Money is read as a decimal STRING or bare number and crossed to
// kobo through money.go — never through float64.

func (c *Client) policyFromData(data json.RawMessage, p gateway.ProviderProduct) gateway.Policy {
	m := decodeObject(data)
	pol := gateway.Policy{
		ProviderPolicyRef:   pickString(m, "policy_id", "id", "policy_no", "policy_number", "reference", "policy_reference"),
		ProviderProductCode: firstNonEmpty(pickString(m, "product_route_name", "product_code", "route_name"), p.Code),
		Status:              "", // set below, once ExpiresAt is known
		Currency:            "NGN",
		Underwriter:         firstNonEmpty(pickString(m, "provider_name", "underwriter", "organization_name"), p.Underwriter),
		Aggregator:          c.Name(),
		EffectiveAt:         pickTime(m, "start_date", "effective_date", "effective_at", "commencement_date"),
		ExpiresAt:           pickTime(m, "end_date", "expiry_date", "expires_at", "expiration_date"),
		CertificateRef:      pickString(m, "certificate_url", "certificate", "certificate_link", "policy_document"),
	}
	if v := pickMoney(m, "premium", "price", "amount", "premium_amount", "total_price"); v > 0 {
		pol.PremiumKobo = v
	}
	if v := pickMoney(m, "sum_insured", "sum_assured", "cover_amount", "insured_value"); v > 0 {
		pol.SumInsuredKobo = v
	}
	pol.Status = policyStatus(m, pol.ExpiresAt)
	return pol
}

// policyStatus derives a policy's state.
//
// ⚠️ MyCover sends NO status field on a policy. Not status, not policy_status,
// not state — verified against every real policy on the account. Liveness is the
// boolean `is_active`, which the catalog path already reads and the policy path
// did not, so every policy we bound was stored with an EMPTY status.
//
// An explicit status still wins where a provider sends one, so this stays
// correct for Octamile or any future aggregator.
func policyStatus(m map[string]json.RawMessage, expiresAt time.Time) string {
	if s := normaliseStatus(pickString(m, "status", "policy_status", "state")); s != "" {
		return s
	}
	active, ok := pickBool(m, "is_active", "active")
	if !ok {
		// No signal at all. Empty, never a guessed "active": reporting a policy
		// as live when we do not know is the dangerous direction — it is the
		// answer a member would be told when they try to claim.
		return ""
	}
	if active {
		return "active"
	}
	// Inactive. If the cover window has closed we can say expired from the dates.
	// Otherwise MyCover does not distinguish cancelled from lapsed, and naming
	// either would be inventing a fact about someone's cover.
	if !expiresAt.IsZero() && expiresAt.Before(time.Now()) {
		return "expired"
	}
	return "inactive"
}

// pickBool returns the first key present as a JSON boolean, and whether one was
// found. Absent and "present but not a bool" are both reported as not-found, so
// a caller can tell "false" apart from "no signal".
func pickBool(m map[string]json.RawMessage, keys ...string) (bool, bool) {
	for _, k := range keys {
		raw, ok := m[k]
		if !ok || len(raw) == 0 {
			continue
		}
		var b bool
		if err := json.Unmarshal(raw, &b); err == nil {
			return b, true
		}
	}
	return false, false
}

func (c *Client) claimFromData(data json.RawMessage, policyRef string) gateway.Claim {
	m := decodeObject(data)
	return gateway.Claim{
		ProviderClaimRef:   pickString(m, "claim_id", "id", "claim_no", "claim_number", "reference"),
		ProviderPolicyRef:  firstNonEmpty(pickString(m, "policy_id", "policy_ref", "policy_no"), policyRef),
		Status:             normaliseStatus(pickString(m, "status", "claim_status", "state")),
		ClaimedAmountKobo:  pickMoney(m, "claim_amount", "amount", "claimed_amount"),
		ApprovedAmountKobo: pickMoney(m, "approved_amount", "settlement_amount", "paid_amount"),
		Currency:           "NGN",
	}
}

// decodeObject decodes a JSON object into a raw-valued map. A non-object (null,
// array, scalar) yields an empty map rather than an error — callers then simply
// find no fields.
func decodeObject(data json.RawMessage) map[string]json.RawMessage {
	if len(data) == 0 {
		return nil
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	// Some endpoints nest the useful object one level down.
	for _, wrapper := range []string{"policy", "claim", "data"} {
		if inner, ok := m[wrapper]; ok && len(m) <= 2 {
			var im map[string]json.RawMessage
			if json.Unmarshal(inner, &im) == nil && len(im) > 0 {
				for k, v := range m {
					if k != wrapper {
						im[k] = v
					}
				}
				return im
			}
		}
	}
	return m
}

func pickString(m map[string]json.RawMessage, keys ...string) string {
	for _, k := range keys {
		if raw, ok := m[k]; ok {
			if s := jsonNumberOrString(raw); s != "" {
				return s
			}
		}
	}
	return ""
}

// pickMoney reads a NAIRA amount under any of the given keys and returns integer
// kobo. Unparseable amounts yield 0 — never a guessed figure.
func pickMoney(m map[string]json.RawMessage, keys ...string) int64 {
	for _, k := range keys {
		raw, ok := m[k]
		if !ok {
			continue
		}
		s := jsonNumberOrString(raw)
		if s == "" {
			continue
		}
		kobo, err := NairaToKobo(s)
		if err != nil {
			log.Printf("[mycover] WARN unparseable money field %q — ignoring", k)
			continue
		}
		return kobo
	}
	return 0
}

func pickTime(m map[string]json.RawMessage, keys ...string) time.Time {
	for _, k := range keys {
		if raw, ok := m[k]; ok {
			if t := parseTime(jsonNumberOrString(raw)); !t.IsZero() {
				return t
			}
		}
	}
	return time.Time{}
}

// normaliseStatus maps provider status tokens onto the lower-case vocabulary the
// rest of the platform uses. Unknown tokens pass through lower-cased rather than
// being coerced into "active" — an unrecognised status must never read as cover.
func normaliseStatus(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "":
		return ""
	case "active", "success", "successful", "completed", "approved", "paid":
		return "active"
	case "pending", "processing", "in_progress", "awaiting_payment":
		return "pending"
	case "expired", "lapsed":
		return "expired"
	case "cancelled", "canceled", "terminated":
		return "cancelled"
	case "rejected", "declined", "failed":
		return "rejected"
	default:
		return strings.ToLower(strings.TrimSpace(s))
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// ════════════════════════════════════════════════════════════════════════════
// HTTP
// ════════════════════════════════════════════════════════════════════════════

func (c *Client) postIdem(ctx context.Context, path, idemKey string, body any) (envelope, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return envelope{}, fmt.Errorf("mycover: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(b))
	if err != nil {
		return envelope{}, err
	}
	// VERIFIED: the "Bearer " prefix is mandatory — sending the bare key returns
	// 400 "Invalid bearer token format".
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if idemKey != "" {
		// MyCover is not documented to honour this; it is sent so that a retried
		// bind is de-duplicated if the provider ever does. Paymax's own
		// idempotency does not depend on it — the saga is keyed on our side.
		req.Header.Set("Idempotency-Key", idemKey)
	}
	return c.do(req)
}

func (c *Client) get(ctx context.Context, path string) (envelope, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return envelope{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Accept", "application/json")
	return c.do(req)
}

// do executes the request and unwraps the MyCover envelope. It NEVER logs the
// request body (PII), the Authorization header, or the API key.
func (c *Client) do(req *http.Request) (envelope, error) {
	if c.apiKey == "" {
		return envelope{}, fmt.Errorf("mycover: no API key configured")
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return envelope{}, fmt.Errorf("mycover: http request: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return envelope{}, fmt.Errorf("mycover: read response: %w", err)
	}

	var env envelope
	decodeErr := json.Unmarshal(raw, &env)

	if resp.StatusCode == http.StatusForbidden {
		return envelope{}, fmt.Errorf("%w: %s (%s)", ErrProviderScope, env.Text(), req.URL.Path)
	}
	if decodeErr != nil {
		// Non-JSON body (gateway HTML error page, etc.). Surface status only.
		return envelope{}, fmt.Errorf("mycover: unreadable response (http %d)", resp.StatusCode)
	}
	if resp.StatusCode >= 400 || !env.OK() {
		apiErr := &APIError{
			StatusCode:   resp.StatusCode,
			ResponseCode: env.ResponseCode,
			Path:         env.Path,
			Messages:     env.Messages(),
		}
		// The prefunded-wallet refusal arrives as an ordinary failure envelope.
		// Wrap it so callers can branch with errors.Is and stop the queue rather
		// than treating a treasury outage as one member's bad luck.
		if isInsufficientFloat(apiErr.Messages) {
			// Also a definite reply: the provider evaluated the purchase and
			// refused it for want of float, so nothing was created.
			return envelope{}, fmt.Errorf("%w: %s (%w)",
				ErrInsufficientProviderFloat, apiErr.Error(), gateway.ErrProviderRejected)
		}
		return envelope{}, apiErr
	}
	return env, nil
}

// redactDigest renders a received signature for logging. A digest is not a
// secret, but a caller can put anything in that header — so it is length-capped
// and stripped of anything that is not hex, to keep an attacker from writing
// arbitrary text into our logs.
func redactDigest(sig string) string {
	sig = strings.TrimSpace(sig)
	if sig == "" {
		return "(absent)"
	}
	var b strings.Builder
	for _, r := range sig {
		if b.Len() >= 128 {
			break
		}
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "(not hex)"
	}
	return b.String()
}

// verifyHMACSHA512 returns true if signature == hex(HMAC-SHA512(key, payload)).
// Comparison is constant-time. An empty key or signature is always false.
func verifyHMACSHA512(key string, payload []byte, signature string) bool {
	if key == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha512.New, []byte(key))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(strings.TrimSpace(signature)))
}

// parseTime accepts the date formats MyCover uses across its payloads.
func parseTime(s string) time.Time {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02 15:04:05",
		"2006-01-02",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}
