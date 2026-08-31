package gateway

import "time"

// This package defines the provider-agnostic underwriter gateway. It MIRRORS the
// maps adapter pattern (internal/maps/adapter.go): one small interface, concrete
// per-provider adapters (internal/provider/{mycover,octamile}), and a Router that
// resolves an adapter from the data-driven catalog/routing table.
//
// INVARIANT: only NORMALISED models cross this boundary. Provider JSON never
// leaks past an adapter — adapters translate to/from these structs. The
// underwriter + aggregator are carried on every Quote/Policy as data surfaced
// FROM the provider; they are never hard-coded in business logic.

// BindingMode describes how a policy is bound.
type BindingMode string

const (
	// BindingModeDirect — the user explicitly buys cover (quote → pay → bind).
	BindingModeDirect BindingMode = "direct"
	// BindingModeEmbedded — cover is bound automatically off a platform event.
	BindingModeEmbedded BindingMode = "embedded"
)

// QuoteRequest is the normalised quote input handed to an adapter. Inputs are the
// schema-validated, product-specific fields (already minimised per the product's
// required_fields_schema before reaching the provider).
type QuoteRequest struct {
	// ProviderProductCode is the provider-side code resolved by the Router from
	// the Paymax product_code; adapters never see Paymax product codes.
	ProviderProductCode string
	// Product is the full per-product routing/pricing descriptor from the
	// catalog (buy path, pricing model, cover terms). Adapters that have no
	// generic quote/bind endpoint dispatch on this.
	Product  ProviderProduct
	Currency string
	// SumInsuredKobo is the requested cover amount in minor units (kobo).
	SumInsuredKobo int64
	// Inputs are product-specific, schema-validated answers (no raw PII beyond
	// what the product schema requires; data-minimised upstream).
	Inputs map[string]any
}

// Quote is the normalised quote returned by an adapter. Disclosure fields
// (Underwriter / Aggregator) are surfaced from the provider response.
type Quote struct {
	ProviderQuoteRef    string
	ProviderProductCode string
	PremiumKobo         int64
	SumInsuredKobo      int64
	Currency            string
	// Underwriter is the risk-carrier disclosed by the provider (e.g. the
	// licensed insurer). Aggregator is the insurtech aggregator (MyCover/Octamile).
	Underwriter string
	Aggregator  string
	// CommissionKobo is the Paymax commission portion disclosed by the provider,
	// if the provider itemises it; 0 when the provider does not disclose a split.
	CommissionKobo int64
	ExpiresAt      time.Time
	// Terms is an opaque (already normalised) summary of cover terms for display.
	Terms map[string]any
}

// BindRequest is the normalised, idempotent bind input.
type BindRequest struct {
	ProviderProductCode string
	// Product is the per-product routing descriptor (see QuoteRequest.Product).
	Product          ProviderProduct
	ProviderQuoteRef string
	Currency         string
	SumInsuredKobo   int64
	PremiumKobo      int64
	// PolicyholderRef is an opaque Paymax-side reference for the policyholder
	// (NOT the auth user id; adapters must never receive internal user ids).
	PolicyholderRef string
	// IdempotencyKey makes the provider bind idempotent — a retried bind with the
	// same key MUST return the same policy, never a second one.
	IdempotencyKey string
	Inputs         map[string]any
}

// Policy is the normalised bound-policy view from a provider.
type Policy struct {
	ProviderPolicyRef   string
	ProviderProductCode string
	Status              string // provider status, normalised to lower-case tokens
	PremiumKobo         int64
	SumInsuredKobo      int64
	Currency            string
	Underwriter         string
	Aggregator          string
	CommissionKobo      int64
	EffectiveAt         time.Time
	ExpiresAt           time.Time
	// CertificateRef is a provider-hosted certificate link (may be empty until the
	// certificate is issued; the service stores a ref and re-signs on demand).
	CertificateRef string
}

// ClaimRequest is the normalised FNOL input.
type ClaimRequest struct {
	ProviderPolicyRef string
	LossEventAt       time.Time
	ClaimedAmountKobo int64
	Description       string
	IdempotencyKey    string
	Inputs            map[string]any
}

// Claim is the normalised claim view from a provider.
type Claim struct {
	ProviderClaimRef   string
	ProviderPolicyRef  string
	Status             string
	ClaimedAmountKobo  int64
	ApprovedAmountKobo int64
	Currency           string
}

// EvidenceUpload is the normalised evidence-attach input.
type EvidenceUpload struct {
	ProviderClaimRef string
	FileName         string
	ContentType      string
	// StorageRef is a Paymax R2 object key already uploaded by the client via a
	// signed URL; the adapter forwards the ref/URL, never the bytes.
	StorageRef string
}

// WebhookEvent is the normalised provider webhook after signature verification.
type WebhookEvent struct {
	Provider          string
	EventType         string // policy.bound | policy.cancelled | claim.updated | ...
	ExternalEventID   string // used for (provider, external_event_id) idempotency
	ProviderPolicyRef string
	ProviderClaimRef  string
	SignatureValid    bool
	// RawRef is an opaque pointer to the stored raw payload (e.g. an audit ref);
	// the raw provider JSON itself never travels with the normalised event.
	RawRef string
}

// ════════════════════════════════════════════════════════════════════════════
// PER-PRODUCT ROUTING DESCRIPTOR
// ════════════════════════════════════════════════════════════════════════════
//
// Some aggregators (MyCover) expose NO generic bind endpoint. Each product has
// its own purchase path (`POST /products/{prefix}/buy-{slug}`), its own pricing
// model (flat naira amount vs a percentage RATE of the sum insured) and its own
// required-field schema. The slug is NOT derivable from the product's route_name
// — `bastion-flexicare-mini` maps to `/products/bastion/buy-flexicare-mini` for
// one product and 404s for another — so it MUST be discovered and stored, never
// computed.
//
// ProviderProduct is that stored descriptor, resolved from the DB catalog and
// handed to the adapter on every call. It is what keeps "add a product" a DATA
// change (one catalog row, written by the catalog sync) rather than a code
// change: no adapter method branches on a product identity.
type ProviderProduct struct {
	// Code is the provider-side product code (MyCover `route_name`).
	Code string
	// ProviderProductID is the provider's own product id (MyCover uuid), used on
	// endpoints that key on the uuid rather than the route name.
	ProviderProductID string
	// BuyPath is the FULL provider-relative purchase path, e.g.
	// "/products/sti/buy-marine-cover". Stored per product; never derived.
	BuyPath string

	// --- Pricing (already converted to Paymax minor units at sync time) ---
	// IsPercentage selects the pricing model. When false, BasePriceKobo is the
	// flat premium. When true, RateBps is a rate in basis points applied to the
	// sum insured.
	IsPercentage bool
	// BasePriceKobo is the flat premium in kobo (IsPercentage == false).
	BasePriceKobo int64
	// RateBps is the premium rate in basis points (IsPercentage == true);
	// 0.5% is 50 bps.
	RateBps int64
	// DefaultSumInsuredKobo is the product's own declared cover amount in kobo
	// (MyCover `meta.sum_insured`), 0 when the product does not declare one and
	// the caller must supply it.
	DefaultSumInsuredKobo int64
	// CommissionBps is Paymax's distributor commission on the premium, in basis
	// points (sharing_formula.distributor_commission of 10% is 1000 bps).
	CommissionBps int64

	// --- Cover terms ---
	CoverPeriodDays   int
	Underwriter       string
	IsRenewable       bool
	IsClaimable       bool
	IsCertificateable bool
}
