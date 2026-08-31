package mycover

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
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
// MyCover is NOT a generic quote→bind API. There is no POST /quotes and no
// generic POST /policies. Instead:
//
//   - Purchase endpoints are per product FAMILY:
//     `POST /products/{family}/buy-{family-slug}`. One family path serves MANY
//     products, and the specific product is selected by a `product_id` UUID in
//     the request BODY.
//   - Family names are their OWN namespace. `/products/bastion/buy-medisure` is
//     live although no product is named "MediSure", while route_name-derived
//     guesses (bastion-flexicare-mini, goxi-artisan-basic, allianz-travel-cover,
//     sti-flexi-guard) all 404. Deriving a path is a confirmed dead end: the
//     family path must be discovered and stored.
//   - Each family has its OWN required-field schema (gender/nin/image_url for
//     health, device_make/device_serial_number for gadget).
//   - Each product has its OWN pricing model — a flat naira price, or a
//     percentage RATE applied to the sum insured.
//
// All of it lives as DATA on the insurance_products catalog row and reaches this
// adapter inside gateway.ProviderProduct. Consequently this file contains ZERO
// per-product branching: adding a 69th product is a catalog sync, not a code
// change.
type Client struct {
	apiKey        string // secret key — server-to-server auth; never logged
	publicKey     string // publishable key — client-init / disclosure; safe to surface
	webhookSecret string
	baseURL       string
	httpClient    *http.Client
}

// defaultBaseURL is MyCover's ONLY host. Verified live 2026-08-31: this single
// host serves both test and live keys, and the environment is selected by the
// key prefix (MCASECK_T… is test/staging, assets come back from
// staging.mycover.ai). The previous default, `api.sandbox.mycover.ai`, does not
// resolve in DNS — every call the adapter has ever made has failed at dial.
const defaultBaseURL = "https://api.mycover.ai/v1"

// Verified live endpoint paths.
const (
	pathProducts = "/products/get-all-products"
	pathPolicies = "/policies"
	// pathClaims exists on the API but returns 403 "Forbidden resource" for our
	// key — the key lacks the claims scope. See ErrProviderScope.
	pathClaims = "/claims"
)

// Sentinel errors callers can branch on.
var (
	// ErrProviderScope means the endpoint exists but our API key lacks the
	// scope for it (MyCover answers 403 "Forbidden resource"). It is a
	// credentials/entitlement problem, NOT a bug and NOT a retryable fault.
	ErrProviderScope = errors.New("mycover: endpoint forbidden for this API key (missing scope)")
	// ErrUnsupported means MyCover exposes no endpoint for the operation at all.
	// We return it rather than inventing a call that would 404.
	ErrUnsupported = errors.New("mycover: operation not supported by the provider API")
	// ErrNoBuyPath means the catalog row is missing its family purchase path.
	// Bind fails CLOSED — we never guess a buy URL.
	ErrNoBuyPath = errors.New("mycover: product has no stored family buy path (run the catalog sync)")
	// ErrNoProductID means the catalog row is missing the MyCover product uuid.
	// A family endpoint selects the product from that uuid, so without it the
	// purchase would bind whichever cover the family defaults to — the wrong
	// product, paid for. Bind fails CLOSED.
	ErrNoProductID = errors.New("mycover: product has no provider product id (run the catalog sync)")
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

// WebhookConfigured reports whether a webhook secret is present. When false,
// VerifyWebhook fails closed and no provider webhook can ever be accepted.
func (c *Client) WebhookConfigured() bool { return c.webhookSecret != "" }

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
	var payload struct {
		TotalCount int          `json:"total_count"`
		Products   []rawProduct `json:"products"`
	}
	if err := json.Unmarshal(env.Data, &payload); err != nil {
		return nil, 0, fmt.Errorf("mycover: decode product list: %w", err)
	}
	// Re-decode raw objects alongside the typed ones so each product keeps its
	// verbatim provider JSON for reconciliation.
	var rawObjs struct {
		Products []json.RawMessage `json:"products"`
	}
	_ = json.Unmarshal(env.Data, &rawObjs)

	out := make([]CatalogProduct, 0, len(payload.Products))
	for i, rp := range payload.Products {
		p, cErr := normaliseProduct(rp)
		if cErr != nil {
			// One malformed product must not sink the whole sync; skip it and say
			// so. The product code is not a secret.
			log.Printf("[mycover] skipping product %q during sync: %v", rp.RouteName, cErr)
			continue
		}
		if i < len(rawObjs.Products) {
			p.Raw = rawObjs.Products[i]
		}
		out = append(out, p)
	}
	return out, payload.TotalCount, nil
}

// normaliseProduct converts provider JSON to the normalised catalog view,
// crossing the naira→kobo money boundary exactly once.
func normaliseProduct(rp rawProduct) (CatalogProduct, error) {
	if rp.RouteName == "" {
		return CatalogProduct{}, fmt.Errorf("product has no route_name")
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

// FieldProductID is the body field every MyCover buy endpoint uses to select
// which product in the family is being purchased. Its value is the product's
// MyCover uuid ("product_id must be a UUID").
const FieldProductID = "product_id"

// FieldPaymentPlan is the instalment count (1..12 months) some family schemas
// accept. It changes what the member is charged, so it is never defaulted
// silently — see GetQuote.
const FieldPaymentPlan = "payment_plan"

// ProbePathExists interprets a discovery probe of a candidate family path: POST
// the path with an empty body and read the answer. 404 ("Cannot POST …") means
// the path is absent; a 400 validation array or a 403 means it exists. Probing
// is safe — validation rejects before anything is created.
//
// There is deliberately NO function here that DERIVES a buy path from a product
// code. That was tried and is a confirmed dead end; a derived path either 404s
// or, far worse, could reach the wrong family. Paths are data.
func ProbePathExists(statusCode int) bool {
	return statusCode != http.StatusNotFound
}

// ════════════════════════════════════════════════════════════════════════════
// gateway.UnderwriterGateway
// ════════════════════════════════════════════════════════════════════════════

// GetQuote prices a product.
//
// IMPORTANT AND DELIBERATE: MyCover exposes no quote endpoint we can reach —
// `/products/bulk/compute-price` answers 403 "Forbidden resource" for our key.
// The premium is therefore computed HERE from the product's own pricing terms,
// which came from MyCover's catalog and were converted to kobo at sync time:
//
//	flat product       premium_kobo = base_price_kobo
//	percentage product premium_kobo = sum_insured_kobo × rate_bps / 10_000
//
// This is arithmetic on the provider's own numbers, not an invented price, and
// the quote says so in Terms["priced_by"]. The provider's own figure is
// authoritative at purchase time and BindPolicy reconciles against it.
func (c *Client) GetQuote(ctx context.Context, req gateway.QuoteRequest) (gateway.Quote, error) {
	p := req.Product
	if p.Code == "" {
		p.Code = req.ProviderProductCode
	}

	sumInsured := req.SumInsuredKobo
	if sumInsured <= 0 {
		sumInsured = p.DefaultSumInsuredKobo
	}

	var premium int64
	switch {
	case p.IsPercentage:
		if sumInsured <= 0 {
			return gateway.Quote{}, fmt.Errorf(
				"mycover: product %q is rate-priced (%d bps) and needs a sum insured", p.Code, p.RateBps)
		}
		if p.RateBps <= 0 {
			return gateway.Quote{}, fmt.Errorf("mycover: product %q has no rate (run the catalog sync)", p.Code)
		}
		premium = PremiumFromRateBps(sumInsured, p.RateBps)
	default:
		if p.BasePriceKobo <= 0 {
			return gateway.Quote{}, fmt.Errorf("mycover: product %q has no base price (run the catalog sync)", p.Code)
		}
		premium = p.BasePriceKobo
	}

	// INSTALMENTS — deliberately fail closed.
	//
	// Some family schemas (health, e.g. /products/bastion/buy-medisure) accept a
	// `payment_plan` of 1..12 months. It changes what the member is charged, and
	// MyCover's instalment pricing rule is NOT verified: we do not know whether
	// base_price is the full cover price to be split, or a per-instalment
	// amount to be multiplied. Guessing is a money bug in one direction or the
	// other — either we over-charge the member or we under-collect and owe the
	// underwriter.
	//
	// So: payment_plan 1 (or absent) prices normally; anything else refuses to
	// quote until the rule is confirmed with MyCover. The single-payment path is
	// unambiguous and stays open.
	if plan, ok := paymentPlan(req.Inputs); ok && plan != 1 {
		return gateway.Quote{}, fmt.Errorf(
			"mycover: product %q requested a %d-month payment_plan, but MyCover's instalment "+
				"pricing rule is unverified — refusing to quote a premium that may be wrong", p.Code, plan)
	}

	currency := req.Currency
	if currency == "" {
		currency = "NGN"
	}

	// Paymax's distributor commission slice of the premium. CommissionBps is a
	// catalog value derived from MyCover's sharing_formula.
	commission := PremiumFromRateBps(premium, p.CommissionBps)

	expires := time.Now().Add(24 * time.Hour)
	if p.CoverPeriodDays > 0 {
		// Never let the quote outlive the cover it prices.
		if cover := time.Now().AddDate(0, 0, p.CoverPeriodDays); cover.Before(expires) {
			expires = cover
		}
	}

	return gateway.Quote{
		ProviderQuoteRef:    "", // MyCover issues no quote reference
		ProviderProductCode: p.Code,
		PremiumKobo:         premium,
		SumInsuredKobo:      sumInsured,
		Currency:            currency,
		Underwriter:         p.Underwriter,
		Aggregator:          c.Name(),
		CommissionKobo:      commission,
		ExpiresAt:           expires,
		Terms: map[string]any{
			"priced_by":         "catalog",
			"payment_plan":      1,
			"pricing_model":     pricingModel(p.IsPercentage),
			"rate_bps":          p.RateBps,
			"cover_period_days": p.CoverPeriodDays,
			"renewable":         p.IsRenewable,
			"claimable":         p.IsClaimable,
			"certificateable":   p.IsCertificateable,
		},
	}, nil
}

// paymentPlan reads the instalment count from the member's answers. It accepts
// the JSON shapes a form can produce (number or numeric string) and reports
// ok=false when the field is absent or unreadable.
func paymentPlan(inputs map[string]any) (int, bool) {
	v, ok := inputs[FieldPaymentPlan]
	if !ok || v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case int:
		return t, true
	case int64:
		return int(t), true
	case float64:
		// JSON numbers decode to float64; an instalment count is a small integer
		// so the conversion is exact. This is a COUNT, never money.
		return int(t), true
	case json.Number:
		n, err := t.Int64()
		if err != nil {
			return 0, false
		}
		return int(n), true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(t))
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

func pricingModel(isPct bool) string {
	if isPct {
		return "percentage_of_sum_insured"
	}
	return "flat"
}

// BindPolicy purchases cover at MyCover.
//
// There is no generic bind endpoint: the request goes to the product's OWN
// purchase path, carried on the catalog row as ProviderProduct.BuyPath. The body
// is the product's own schema-validated field set (req.Inputs) sent FLAT, which
// is the shape every `buy-*` endpoint validates against.
//
// If the catalog row carries no buy path, this fails CLOSED — guessing a URL
// would either 404 or, worse, purchase the wrong product.
func (c *Client) BindPolicy(ctx context.Context, req gateway.BindRequest) (gateway.Policy, error) {
	p := req.Product
	if p.Code == "" {
		p.Code = req.ProviderProductCode
	}
	if p.BuyPath == "" {
		return gateway.Policy{}, fmt.Errorf("%w: product %q", ErrNoBuyPath, p.Code)
	}

	// The body is the family schema's own fields PLUS product_id, which is how a
	// family endpoint is told which product to sell. Everything else the member
	// answered is forwarded flat; we inject no Paymax concepts (policyholder_ref,
	// quote_ref) that no MyCover schema declares, because unknown fields are a
	// validation risk.
	body := map[string]any{}
	for k, v := range req.Inputs {
		body[k] = v
	}
	if _, supplied := body[FieldProductID]; !supplied {
		if p.ProviderProductID == "" {
			// Without the uuid the family endpoint cannot know which product to
			// sell, and a family default would sell the WRONG cover. Fail closed.
			return gateway.Policy{}, fmt.Errorf(
				"%w: the family endpoint %q cannot select product %q", ErrNoProductID, p.BuyPath, p.Code)
		}
		body[FieldProductID] = p.ProviderProductID
	}

	env, err := c.postIdem(ctx, p.BuyPath, req.IdempotencyKey, body)
	if err != nil {
		return gateway.Policy{}, err
	}

	pol := c.policyFromData(env.Data, p)
	// Fall back to the quoted figures for anything the provider did not echo.
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
		return gateway.Policy{}, fmt.Errorf("mycover: purchase succeeded but returned no policy reference (product %q)", p.Code)
	}

	// MONEY GUARD: the provider's own premium is authoritative. If it disagrees
	// with what we quoted and debited, say so loudly — a silent divergence is a
	// reconciliation break, and the amounts must be settled against the provider
	// figure, not ours.
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

// SubmitClaim posts an FNOL. VERIFIED LIVE: `/claims` answers 403 "Forbidden
// resource" with our key — the path exists but the key lacks the claims scope.
// The call is made for real and the 403 is surfaced as ErrProviderScope so the
// operator sees an entitlement problem, not a phantom success. No fake claim
// reference is ever returned.
func (c *Client) SubmitClaim(ctx context.Context, req gateway.ClaimRequest) (gateway.Claim, error) {
	body := map[string]any{
		"policy_id":     req.ProviderPolicyRef,
		"incident_date": req.LossEventAt.UTC().Format("2006-01-02"),
		"description":   req.Description,
	}
	for k, v := range req.Inputs {
		body[k] = v
	}
	env, err := c.postIdem(ctx, pathClaims, req.IdempotencyKey, body)
	if err != nil {
		return gateway.Claim{}, err
	}
	return c.claimFromData(env.Data, req.ProviderPolicyRef), nil
}

// GetClaim reads a claim. Same 403 scope caveat as SubmitClaim.
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

// UploadEvidence attaches a document to a claim. Same 403 scope caveat.
// The R2 object URL is forwarded; bytes never pass through this adapter.
func (c *Client) UploadEvidence(ctx context.Context, up gateway.EvidenceUpload) error {
	if up.ProviderClaimRef == "" {
		return fmt.Errorf("mycover: empty claim reference")
	}
	body := map[string]any{
		"file_name":    up.FileName,
		"content_type": up.ContentType,
		"document_url": up.StorageRef,
	}
	_, err := c.postIdem(ctx, pathClaims+"/"+url.PathEscape(up.ProviderClaimRef)+"/documents", "", body)
	return err
}

// VerifyWebhook validates the webhook signature and returns the normalised
// event. SignatureValid is false (err nil) when the signature does not match.
//
// ⚠️ FAILS CLOSED BY DESIGN. INSURANCE_MYCOVER_WEBHOOK_SECRET is currently EMPTY
// in this environment, so every inbound webhook is rejected as unverified. That
// is the correct behaviour — accepting unsigned provider callbacks would let
// anyone who can reach the endpoint activate policies and approve claims. This
// is a BLOCKER that needs a real signing secret from MyCover; it is deliberately
// not stubbed to return valid.
func (c *Client) VerifyWebhook(ctx context.Context, payload []byte, signature string) (gateway.WebhookEvent, error) {
	if c.webhookSecret == "" {
		// No secret: reject, and name the reason so it is diagnosable without
		// anyone being tempted to "fix" it by disabling verification.
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: false}, nil
	}
	if !verifyHMACSHA256(c.webhookSecret, payload, signature) {
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: false}, nil
	}
	var w webhookPayload
	if err := json.Unmarshal(payload, &w); err != nil {
		return gateway.WebhookEvent{Provider: c.Name(), SignatureValid: true}, fmt.Errorf("mycover: decode webhook: %w", err)
	}
	return gateway.WebhookEvent{
		Provider:          c.Name(),
		EventType:         firstNonEmpty(w.Event, w.EventName),
		ExternalEventID:   firstNonEmpty(w.ID, w.EventID, w.Reference),
		ProviderPolicyRef: firstNonEmpty(w.Data.PolicyID, w.Data.PolicyRef, w.Data.ID),
		ProviderClaimRef:  firstNonEmpty(w.Data.ClaimID, w.Data.ClaimRef),
		SignatureValid:    true,
	}, nil
}

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
		Status:              normaliseStatus(pickString(m, "status", "policy_status", "state")),
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
	return pol
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
			return envelope{}, fmt.Errorf("%w: %s", ErrInsufficientProviderFloat, apiErr.Error())
		}
		return envelope{}, apiErr
	}
	return env, nil
}

// verifyHMACSHA256 returns true if signature == hex(HMAC-SHA256(secret, payload)).
// Comparison is constant-time. An empty secret or signature is always false.
func verifyHMACSHA256(secret string, payload []byte, signature string) bool {
	if secret == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
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
