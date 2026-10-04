package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"time"
)

// Named is implemented by every adapter so audit/metrics + logs can identify the
// underwriter aggregator a call was dispatched to (mirrors maps.Named).
type Named interface {
	// Name returns a stable aggregator id, e.g. "mycover", "octamile".
	Name() string
}

// UnderwriterGateway is the single, provider-agnostic capability interface every
// insurtech aggregator adapter implements. Feature code (policy/quote services)
// depends ONLY on this interface; swapping MyCover for Octamile on a product line
// is a routing-table edit, never a code change.
// BindPolicy MUST be idempotent on BindRequest.IdempotencyKey — a retried bind
// returns the same policy. This is load-bearing for the debit→bind saga: the saga
// may retry a bind after a transient failure without ever creating two policies.
type UnderwriterGateway interface {
	Named

	GetQuote(ctx context.Context, req QuoteRequest) (Quote, error)
	BindPolicy(ctx context.Context, req BindRequest) (Policy, error)
	GetPolicy(ctx context.Context, providerPolicyRef string) (Policy, error)
	CancelPolicy(ctx context.Context, providerPolicyRef, reason string) (Policy, error)
	SubmitClaim(ctx context.Context, req ClaimRequest) (Claim, error)
	GetClaim(ctx context.Context, providerClaimRef string) (Claim, error)
	UploadEvidence(ctx context.Context, up EvidenceUpload) error
	// VerifyWebhook validates a provider webhook signature and returns the
	// normalised event. SignatureValid is false (and err nil) when the signature
	// does not match — callers MUST reject unverified events.
	VerifyWebhook(ctx context.Context, payload []byte, signature string) (WebhookEvent, error)

	// WebhookSignatureHeader returns the HTTP header this provider delivers its
	// signature in, e.g. "x-mycoverai-signature".
	// The adapter declares it because only the adapter knows it. The alternative
	// — the ingestion handler guessing a header from the URL slug — silently
	// fails: MyCover's slug is "mycover" but its header says "mycoverai", so a
	// guessed "X-mycover-Signature" never matches, the signature arrives empty,
	// and every genuine delivery is rejected before the HMAC even runs. That is
	// a 401 with no bad actor anywhere in it, and nothing in the logs pointing at
	// a header name.
	// An empty return means "no provider-specific header"; the handler then falls
	// back to the generic ones.
	WebhookSignatureHeader() string
}

// ProductResolver is the slice of the catalog the Router needs to map a Paymax
// product_code to (aggregator name, provider_product_code). The catalog package
// implements this; keeping it as an interface keeps the gateway free of a catalog
// import cycle and keeps routing data-driven.
type ProductResolver interface {
	// ResolveProduct returns the aggregator key (e.g. "mycover") and the full
	// per-product routing descriptor (provider code, buy path, pricing model,
	// cover terms) for a Paymax product_code. ok is false when the product is
	// unknown or inactive.
	// Everything an adapter needs to reach a product travels in the descriptor,
	// which is a CATALOG ROW — that is what makes adding a product a data change.
	ResolveProduct(ctx context.Context, productCode string) (aggregator string, product ProviderProduct, ok bool)
}

// Router resolves the concrete adapter for a Paymax product_code via the catalog.
// It mirrors maps.Service.resolve: a config/data lookup, then a registry lookup.
type Router struct {
	resolver ProductResolver
	adapters map[string]UnderwriterGateway // keyed by adapter Name()
}

// NewRouter builds a router over a product resolver and the registered adapters.
func NewRouter(resolver ProductResolver, adapters ...UnderwriterGateway) *Router {
	m := make(map[string]UnderwriterGateway, len(adapters))
	for _, a := range adapters {
		if a != nil {
			m[a.Name()] = a
		}
	}
	return &Router{resolver: resolver, adapters: m}
}

// ErrNoProvider is returned when no aggregator is configured for a product, or
// the product is unknown/inactive.
var ErrNoProvider = fmt.Errorf("insurance gateway: no provider for product")

// ErrProviderFloatExhausted is the provider-agnostic signal that an aggregator
// refused a bind because PAYMAX'S PREFUNDED BALANCE WITH THAT AGGREGATOR is
// empty — not because anything about the member or the product was wrong.
// Aggregators that settle from a distributor float (MyCover does; it does not
// charge per transaction) wrap this sentinel around their own error, so feature
// code branches on the CONDITION without importing a provider package. Keeping
// it here is what stops the money path from growing a per-provider import.
// It is called out separately from a generic bind failure because the two need
// opposite responses: a generic failure is one member's problem, while this is a
// treasury outage that fails every bind at once and must pause the queue before
// more members are debited.
var ErrProviderFloatExhausted = fmt.Errorf("insurance gateway: provider prefunded float exhausted")

// ErrProviderRejected marks a DEFINITE negative: the provider (or our own
// pre-flight check) answered and refused, so nothing was created on their side.
// This exists to separate "the provider said no" from "we never found out". It
// is the difference between a retry that is safe and a retry that might buy a
// second policy with real money, and no aggregator reports it as a distinct
// code — so every adapter must wrap this sentinel around the errors it KNOWS
// were replies. Anything not wrapping it is treated as an unknown outcome and
// is never auto-retried, which is the safe default for silence.
var ErrProviderRejected = fmt.Errorf("insurance gateway: provider rejected the request")

// ValidationRejection is a provider refusal caused by the APPLICANT'S ANSWERS
// rather than by us or by an outage — a missing NIN, a malformed email, a value
// under the insurer's floor.
// It exists so feature code can tell "your form is wrong" apart from "the
// provider is down" WITHOUT importing a specific adapter. Both unwrap to
// ErrProviderRejected, but only this one is the member's to fix, and only this
// one should be shown to them as form errors. Answering a rejected application
// with a 500 tells the client nothing is actionable: the person sees a generic
// failure, retypes everything, and hits the same wall.
type ValidationRejection interface {
	error
	// Validation reports that this refusal is about the submitted values.
	Validation() bool
	// ValidationMessages returns the provider's per-field complaints, verbatim.
	// Callers attribute each message to a field; they are NOT rewritten here,
	// because the insurer's wording is what the applicant must satisfy.
	ValidationMessages() []string
}

// Resolve returns the UnderwriterGateway and the per-product routing descriptor
// for a Paymax product_code. The product → provider mapping AND the per-product
// buy path / pricing model live entirely in the catalog data; this function
// performs no per-product branching.
func (r *Router) Resolve(ctx context.Context, productCode string) (UnderwriterGateway, ProviderProduct, error) {
	if r == nil || r.resolver == nil {
		return nil, ProviderProduct{}, ErrNoProvider
	}
	aggregator, product, ok := r.resolver.ResolveProduct(ctx, productCode)
	if !ok || aggregator == "" {
		return nil, ProviderProduct{}, fmt.Errorf("%w: %s", ErrNoProvider, productCode)
	}
	gw, ok := r.adapters[aggregator]
	if !ok {
		return nil, ProviderProduct{}, fmt.Errorf("%w: aggregator %q not registered", ErrNoProvider, aggregator)
	}
	return gw, product, nil
}

// Adapter returns a registered adapter by aggregator name (used by webhook
// ingestion, which routes on the URL path, not on a product code).
func (r *Router) Adapter(name string) (UnderwriterGateway, bool) {
	if r == nil {
		return nil, false
	}
	gw, ok := r.adapters[name]
	return gw, ok
}

// This package defines the provider-agnostic underwriter gateway. It MIRRORS the
// maps adapter pattern (internal/maps/adapter.go): one small interface, concrete
// per-provider adapters (internal/provider/{mycover,octamile}), and a Router that
// resolves an adapter from the data-driven catalog/routing table.
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

// ProviderProduct — PER-PRODUCT ROUTING DESCRIPTOR
// Some aggregators (MyCover) expose NO generic bind endpoint. Each product has
// its own purchase path (`POST /products/{prefix}/buy-{slug}`), its own pricing
// model (flat naira amount vs a percentage RATE of the sum insured) and its own
// required-field schema. The slug is NOT derivable from the product's route_name
// — `bastion-flexicare-mini` maps to `/products/bastion/buy-flexicare-mini` for
// one product and 404s for another — so it MUST be discovered and stored, never
// computed.
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

	CoverPeriodDays   int
	Underwriter       string
	IsRenewable       bool
	IsClaimable       bool
	IsCertificateable bool

	// FormSchemaKnown is true when the catalog row carries the product's
	// published form schema. Without it we cannot tell which inputs are money,
	// and an adapter whose provider speaks a different unit MUST refuse rather
	// than forward the answers at the wrong scale.
	FormSchemaKnown bool
	// MoneyInputPaths are the dot-separated paths of every input the PUBLISHED
	// schema classified as `money`, in the shape MoneyInputPaths returns. An
	// adapter converts exactly these and nothing else, which is what keeps the
	// client's scaling and the adapter's unscaling symmetric.
	MoneyInputPaths []string

	// NotPurchasable marks a product the AGGREGATOR's own configuration is
	// broken for — no purchase config, or no commission-sharing formula. Such a
	// product can be listed and described but must never be sold: taking a
	// member's money for cover the provider cannot issue is the worst failure
	// this module has. Adapters refuse both quote and bind on it.
	NotPurchasable bool
}

// THE MONEY UNIT SEAM — the contract between the form schema and the adapter
// A product's form schema classifies each input. One of those labels, `money`,
// is LOAD-BEARING: it is the only thing that says a value is denominated, and
// therefore the only thing that says a scale must be applied when the value
// crosses into a provider that speaks a different unit.
// MyCover's form inputs are denominated in NAIRA. Paymax's iron rule is INTEGER
// KOBO, and every client submits kobo — without a single conversion point every
// declared value reaches the insurer 100x too large.
// The rule, stated here so both sides read it from the same place:
//	A money input crosses EVERY internal boundary in kobo (MoneyInputWireUnit).
//	The PROVIDER ADAPTER converts to the provider's unit exactly once, for
//	exactly the field paths this file derives from the SAME schema the client
//	rendered.
// Deriving the field set from the published schema is what makes a name-based
// `money` heuristic safe. A misclassified field is multiplied by 100 by the
// client and divided by 100 by the adapter, and round-trips to identity. A
// design where either side decided independently which fields are money would
// not have that property, and a wrong guess would become a money bug.

// FieldTypeMoney is the schema field-type label that marks an input as a
// monetary amount. It is not presentational: see the note above.
const FieldTypeMoney = "money"

// MoneyUnitKobo is the value of a money field's `unit` in the published schema.
const MoneyUnitKobo = "kobo"

// MoneyInputWireUnit is the unit EVERY money-typed form input is carried in
// across the internal API — client → backend → adapter. The adapter converts out
// of it; nothing else may.
// Clients declare the same constant on their side and a regression test in each
// lane compares the two, so the two halves of this seam cannot drift apart
// silently again. It is spelled out as a LITERAL rather than aliasing
// MoneyUnitKobo so those tests can read it out of this file without evaluating
// Go; a unit test asserts the two stay equal.
const MoneyInputWireUnit = "kobo"

// schemaFieldsKey / schemaChildrenKey are the published contract's own keys.
const (
	schemaFieldsKey   = "fields"
	schemaChildrenKey = "children"
	schemaNameKey     = "name"
	schemaTypeKey     = "type"
	schemaUnitKey     = "unit"
	schemaMinKey      = "min"
	schemaMaxKey      = "max"
)

// MoneyInputPaths returns the dot-separated path of every input a stored form
// schema classified as `money`, sorted so the result is stable.
// Nested shapes are included: an object's child is `policy_holder.annual_income`
// and a repeating row's child is `office_items.item_value`. Array rows add no
// index segment — every row of one array shares one shape and therefore one path.
// The schema passed in MUST be the one published to clients. That identity is
// the whole safety argument.
func MoneyInputPaths(schema map[string]any) []string {
	if schema == nil {
		return nil
	}
	var out []string
	collectMoneyPaths(schema[schemaFieldsKey], "", &out)
	sort.Strings(out)
	return out
}

func collectMoneyPaths(fields any, prefix string, out *[]string) {
	list, ok := fields.([]any)
	if !ok {
		return
	}
	for _, raw := range list {
		f, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		name, _ := f[schemaNameKey].(string)
		if name == "" {
			continue
		}
		path := name
		if prefix != "" {
			path = prefix + "." + name
		}
		if t, _ := f[schemaTypeKey].(string); t == FieldTypeMoney {
			*out = append(*out, path)
		}
		collectMoneyPaths(f[schemaChildrenKey], path, out)
	}
}

// NormalizeMoneyBounds rewrites a stored form schema so every `money` field's
// bounds are published in KOBO and SAY so.
// The provider states its own minimums in naira (`value >= 100000` means
// ₦100,000). Published unscaled and unlabelled, a client applying the contract's
// kobo default validates that as ₦1,000 — a minimum 100x too lenient, which lets
// a ₦1,000 phone through a ₦100,000 floor and gets it rejected at the insurer.
// Publishing kobo bounds (rather than naira ones plus a `unit: naira` tag) is
// deliberate: a client that ignores `unit` entirely still enforces the right
// magnitude, because kobo is what the contract defaults to.
// It is IDEMPOTENT — a field that already carries a `unit` is left alone — so it
// is safe to run on both freshly synced schemas and rows stored before this
// existed. It mutates in place and never introduces a float64.
func NormalizeMoneyBounds(schema map[string]any) {
	if schema == nil {
		return
	}
	normalizeMoneyFields(schema[schemaFieldsKey])
}

func normalizeMoneyFields(fields any) {
	list, ok := fields.([]any)
	if !ok {
		return
	}
	for _, raw := range list {
		f, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if t, _ := f[schemaTypeKey].(string); t == FieldTypeMoney {
			if _, already := f[schemaUnitKey]; !already {
				scaleBoundToKobo(f, schemaMinKey)
				scaleBoundToKobo(f, schemaMaxKey)
				f[schemaUnitKey] = MoneyUnitKobo
			}
		}
		normalizeMoneyFields(f[schemaChildrenKey])
	}
}

func scaleBoundToKobo(field map[string]any, key string) {
	v, present := field[key]
	if !present || v == nil {
		return
	}
	kobo, ok := nairaBoundToKobo(v)
	if !ok {
		// A bound we cannot scale exactly is deleted rather than published at
		// the wrong magnitude: no minimum at all is honest, a 100x-lenient one
		// is a money bug wearing a validation rule's clothes.
		delete(field, key)
		return
	}
	field[key] = kobo
}

// boundDecimalRe matches a plain decimal literal. It deliberately rejects the
// exponent and rational forms big.Rat.SetString would otherwise accept: a bound
// arriving in either shape means the schema contract changed and we must stop
// interpreting it, not guess.
var boundDecimalRe = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?$`)

// nairaBoundToKobo multiplies an exact decimal bound by 100, rounding half-up to
// the kobo. Exact rational arithmetic throughout — float64 is never an
// intermediate, because float64(100000.5)*100 is the kind of drift that turns a
// validation rule into a money bug.
func nairaBoundToKobo(v any) (json.Number, bool) {
	var lit string
	switch n := v.(type) {
	case json.Number:
		lit = n.String()
	case string:
		lit = n
	default:
		// A float64 here means the schema was decoded without UseNumber. Refuse
		// rather than launder an inexact value into a published bound.
		return "", false
	}
	lit = strings.TrimSpace(lit)
	if !boundDecimalRe.MatchString(lit) {
		return "", false
	}
	r, ok := new(big.Rat).SetString(lit)
	if !ok {
		return "", false
	}
	r.Mul(r, new(big.Rat).SetInt64(100))

	// floor((2n + d) / 2d) — half-up for non-negative values, and bounds are
	// non-negative in every schema the provider publishes.
	num := new(big.Int).Mul(r.Num(), big.NewInt(2))
	num.Add(num, r.Denom())
	den := new(big.Int).Mul(r.Denom(), big.NewInt(2))
	q := new(big.Int).Div(num, den)
	return json.Number(q.String()), true
}
