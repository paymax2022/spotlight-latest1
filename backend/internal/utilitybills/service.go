package utilitybills

// service.go is the Utility Bills money path: the pay → provider → settle saga,
// plus validate / quote / requery / reverse / dispute / beneficiaries.
// It is a port of frontend-web/src/server/utility/service.ts, restructured onto
// this repo's Go money-path conventions:
//   - the wallet debit goes through wallet.Service.Debit (NOT ledger.Service.Debit)
//     so the tier/daily-limit check keeps firing exactly as it does everywhere else;
//   - the debit credits the PASS-THROUGH clearing account (ledger.AccountProviderClearing),
//     never a revenue account — a bill payment is money held on the member's behalf
//     until the provider is settled, not income;
//   - the outbound provider call is guarded by the utility_provider_bind registry
//     (provider_bind.go), claimed BEFORE the call, so a replay or a concurrent
//     duplicate can never double-hit VTpass;
//   - a DEFINITE provider failure auto-reverses the debit; an AMBIGUOUS outcome
//     (timeout, transport error) does NOT — it lands in provider_pending for
//     reconciliation, because reversing a purchase that actually went through
//     would give the member both the electricity and the money back.
// The saga's shape is copied from backend/internal/insurance/policy/service.go's
// BindFromQuote, which solves the identical "debit → call an ambiguous third
// party → maybe reverse" problem.
// Commission is recorded via commission.Service.RecordExact with a REAL (non-nil)
// ledger, which posts a balanced revenue-recognition leg
// (DR provider_clearing → CR commission) per settled transaction — a deliberate
// divergence from the TS source, which wrote commission_earnings with
// `ledger_ref: null`.
// KYC tier gating. wallet.Service.Debit's tier/daily-limit check is the ONLY
// limit this module enforces; no additional "must be Tier 1" gate is added, per a
// confirmed product decision. (Note Tier 0 still cannot debit at all — that is
// tiers.EnforceWalletDebitLimit's own ErrWalletDisabled, not a gate this module
// adds.)

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"maps"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	ptrx "spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/provider"
)

var (
	// ErrIdempotencyKeyRequired — no Idempotency-Key header on a money mutation.
	// Rejected in the SERVICE, not in middleware: this repo has no shared
	// idempotency middleware, and the rule belongs next to the money.
	ErrIdempotencyKeyRequired = errors.New("utilitybills: Idempotency-Key header is required")
	// ErrInvalidCategory — category is not one of the six.
	ErrInvalidCategory = errors.New("utilitybills: invalid utility category")
	// ErrFieldRequired — a required request field was blank.
	ErrFieldRequired    = errors.New("utilitybills: required field missing")
	ErrCategoryMismatch = errors.New("utilitybills: biller and product do not match the requested category")
	// ErrCategoryUnavailable — the category is switched off (503).
	ErrCategoryUnavailable = errors.New("utilitybills: this utility category is currently unavailable")
	// ErrCategoryAmountOutOfRange — below/above the category-level spend bounds.
	ErrCategoryAmountOutOfRange = errors.New("utilitybills: amount is outside the category spend limits")
	// ErrCategoryDailyLimit — the per-category daily cap would be exceeded (429).
	// DISTINCT from the wallet's tier daily limit, which fires inside wallet.Debit.
	ErrCategoryDailyLimit = errors.New("utilitybills: daily utility category limit exceeded")
	// ErrCustomerValidationFailed — the biller does not recognise the customer
	// reference (wrong meter number etc.).
	ErrCustomerValidationFailed = errors.New("utilitybills: customer validation failed")
	// ErrNotEligibleForReversal — the transaction's status forbids a reversal.
	ErrNotEligibleForReversal = errors.New("utilitybills: transaction is not eligible for reversal")
	// ErrNotDisputable — only a delivered ('successful') charge can be disputed.
	ErrNotDisputable = errors.New("utilitybills: transaction is not eligible for a dispute")
	// ErrProviderUnavailable — no adapter is configured for the routed provider.
	ErrProviderUnavailable = errors.New("utilitybills: no configured adapter for this provider")
)

// Event payload keys for the settle/recovery paths — hoisted because goconst
// flags any further repetition of these strings.
const (
	eventKeyProviderID = "provider_id"
	eventKeyStatus     = "status"
)

// Auditor mirrors services.AuditService.LogAction structurally — importing
// internal/services from a domain package would create an import cycle (same
// convention as p2pmarket.Auditor). Deliberately fire-and-forget: an audit sink
// that could fail a money mutation is worse than a missing audit row.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string,
		oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// auditModule is the `module` column value for every row this package writes.
const auditModule = "utilitybills"

// Audit resource types — the `resource_type` column. One per table this module's
// admin surface mutates, named after the table so whoever reads an audit row can
// find the data it refers to without a lookup table.
const (
	resourceProvider        = "utility_provider"
	resourceBiller          = "utility_biller"
	resourceProduct         = "utility_product"
	resourceProviderMapping = "utility_provider_mapping"
	resourceRoutingRule     = "utility_routing_rule"
	resourceCategorySetting = "utility_category_setting"
	resourceTransaction     = "utility_transaction"
	resourceDispute         = "utility_dispute"
)

// Audit action names — `utilitybills.<entity>.<verb>`.
const (
	actionProviderCreate      = "utilitybills.provider.create"
	actionProviderUpdate      = "utilitybills.provider.update"
	actionProviderCredsRotate = "utilitybills.provider.credentials_rotate"
	actionProviderHealthCheck = "utilitybills.provider.health_check"
	actionBillerCreate        = "utilitybills.biller.create"
	actionBillerUpdate        = "utilitybills.biller.update"
	actionProductCreate       = "utilitybills.product.create"
	actionProductUpdate       = "utilitybills.product.update"
	actionProductImport       = "utilitybills.product.import"
	actionMappingCreate       = "utilitybills.mapping.create"
	actionMappingUpdate       = "utilitybills.mapping.update"
	actionRoutingRuleCreate   = "utilitybills.routing_rule.create"
	actionRoutingRuleUpdate   = "utilitybills.routing_rule.update"
	actionCategoryCreate      = "utilitybills.category.create"
	actionCategoryUpdate      = "utilitybills.category.update"
	actionTransactionReverse  = "utilitybills.transaction.reverse"
	actionDisputeResolve      = "utilitybills.dispute.resolve"
	// actionSweepTrigger is recorded ONLY for the manual admin-triggered sweep.
	// The scheduled job stays audit-silent — an
	// audit log is a record of who did something, and "the clock" is not a who.
	actionSweepTrigger = "utilitybills.sweep.trigger"
)

// Deps bundles the service dependencies.
type Deps struct {
	Repo          *Repository
	Beneficiaries *BeneficiaryRepository
	// Binds is the outbound purchase idempotency register. NOT optional in
	// effect: without it a retry can double-purchase, so the saga refuses to call
	// a provider when it is absent (Claim fails closed).
	Binds     *BindRegistry
	Providers *ProviderRegistry
	Wallet    *wallet.Service
	Ledger    *ledger.Service
	// Commission is optional (nil ⇒ no earning is recorded and no revenue leg is
	// posted; the payment is unaffected). When wired it MUST have been built with
	// a real ledger — that is what fills ledger_ref.
	Commission *commission.Service
	// DefaultTimeoutMs is the provider-call timeout used when a provider row's
	// config.timeout_ms does not override it (UTILITY_PROVIDER_TIMEOUT_MS,
	// defaulting to 15s exactly like provider-timeout.ts).
	DefaultTimeoutMs int
	// SandboxValidation enables validate.ts's sandbox safety net: when no provider
	// route is configured at all and the adapter is in sandbox mode, validation
	// still runs against the documented test meters so the module is testable in
	// an unseeded environment. Never enabled in production.
	SandboxValidation bool
	// SandboxAdapterCode is the adapter used by that safety net ("vtpass").
	SandboxAdapterCode string
	// CredentialsKey is the AES-256-GCM key for utility_providers.credentials,
	// derived ONCE at wiring time from UTILITY_PROVIDER_CREDENTIALS_KEY (see
	// credentials.go's DeriveCredentialsKey, which deliberately takes the raw
	// material as an argument rather than reading the environment itself).
	// Empty is allowed at construction — the module's money path does not need
	// it — but any attempt to ROTATE credentials without it fails closed with
	// ErrCredentialsKeyMissing rather than storing a secret in the clear.
	CredentialsKey []byte
	// Auditor records admin mutations (Phase 4). OPTIONAL: nil disables audit
	// logging without affecting any other behaviour, so a test can build a
	// Service without one. In the wired app it is always the real
	// services.AuditService — see RegisterUtilityBills.
	Auditor Auditor
}

// Service owns the utility bills lifecycle.
type Service struct {
	repo           *Repository
	beneficiaries  *BeneficiaryRepository
	binds          *BindRegistry
	providers      *ProviderRegistry
	wallet         *wallet.Service
	ledger         *ledger.Service
	commission     *commission.Service
	timeoutMs      int
	sandboxValid   bool
	sandboxCode    string
	credentialsKey []byte
	audit          Auditor
}

// NewService constructs the utility bills service.
func NewService(d Deps) *Service {
	timeout := d.DefaultTimeoutMs
	if timeout < 1000 {
		timeout = 15_000
	}
	return &Service{
		repo:           d.Repo,
		beneficiaries:  d.Beneficiaries,
		binds:          d.Binds,
		providers:      d.Providers,
		wallet:         d.Wallet,
		ledger:         d.Ledger,
		commission:     d.Commission,
		timeoutMs:      timeout,
		sandboxValid:   d.SandboxValidation,
		sandboxCode:    d.SandboxAdapterCode,
		credentialsKey: d.CredentialsKey,
		audit:          d.Auditor,
	}
}

// ReceiptNumber ports service.ts's receiptNumber(): UTL-YYYYMMDD-<first 8 of the
// transaction uuid, uppercased>. PURE apart from the clock, which is passed in so
// it is unit-testable.
func ReceiptNumber(transactionID string, at time.Time) string {
	head := transactionID
	if len(head) > 8 {
		head = head[:8]
	}
	return fmt.Sprintf("UTL-%s-%s", at.UTC().Format("20060102"), strings.ToUpper(head))
}

// ParseCategory ports service.ts's assertCategory: the six valid values, nothing
// else. Anything unrecognised is a 400, never a silent pass-through.
func ParseCategory(value string) (Category, error) {
	switch Category(value) {
	case CategoryAirtime, CategoryData, CategoryElectricity, CategoryCableTV, CategoryInternet, CategoryEducation:
		return Category(value), nil
	}
	return "", fmt.Errorf("%w: %q", ErrInvalidCategory, value)
}

func requireField(value, name string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", fmt.Errorf("%w: %s", ErrFieldRequired, name)
	}
	return trimmed, nil
}

// ProviderAnswered reports whether a provider error is a DEFINITE negative (the
// provider refused, or the adapter refused pre-flight and never sent anything) as
// opposed to a transport failure where the outcome is genuinely unknown.
// Deliberately conservative, mirroring insurance/policy/service.go's
// providerAnswered: ONLY errors positively identified as refusals count. Anything
// unrecognised — a timeout, a reset connection, a context deadline — is treated
// as UNKNOWN, which locks the idempotency key for reconciliation rather than
// authorising a possible double purchase or an unsafe auto-reverse.
// PURE. Unit-tested with zero I/O.
func ProviderAnswered(err error) bool {
	if err == nil {
		return false
	}
	return errors.Is(err, provider.ErrProviderRefused)
}

// CategoryInfo is one row of the member-facing category list.
type CategoryInfo struct {
	ID                  string `json:"id"`
	Label               string `json:"label"`
	AvailabilityMessage string `json:"availability_message,omitempty"`
	DailyLimitKobo      *int64 `json:"daily_limit_kobo,omitempty"`
	MinAmountKobo       *int64 `json:"min_amount_kobo,omitempty"`
	MaxAmountKobo       *int64 `json:"max_amount_kobo,omitempty"`
}

var categoryLabels = map[Category]string{
	CategoryAirtime:     "Airtime",
	CategoryData:        "Data",
	CategoryElectricity: "Electricity",
	CategoryCableTV:     "Cable TV",
	CategoryInternet:    "Internet",
	CategoryEducation:   "Education",
}

// defaultCategoryOrder is the hard-coded fallback list service.ts returns when
// utility_category_settings has no enabled rows. Slice literal (not a map range)
// so the order is stable.
var defaultCategoryOrder = []Category{
	CategoryAirtime, CategoryData, CategoryElectricity,
	CategoryCableTV, CategoryInternet, CategoryEducation,
}

// ListCategories ports listUtilityCategories, including its fallback to the
// hard-coded six when no settings rows are enabled.
func (s *Service) ListCategories(ctx context.Context) ([]CategoryInfo, error) {
	rows, err := s.repo.ListCategorySettings(ctx)
	if err != nil {
		return nil, err
	}
	if len(rows) > 0 {
		out := make([]CategoryInfo, 0, len(rows))
		for _, r := range rows {
			out = append(out, CategoryInfo{
				ID:                  r.Category,
				Label:               categoryLabels[Category(r.Category)],
				AvailabilityMessage: r.AvailabilityMessage,
				DailyLimitKobo:      r.DailyLimitKobo,
				MinAmountKobo:       r.MinAmountKobo,
				MaxAmountKobo:       r.MaxAmountKobo,
			})
		}
		return out, nil
	}
	out := make([]CategoryInfo, 0, len(defaultCategoryOrder))
	for _, c := range defaultCategoryOrder {
		out = append(out, CategoryInfo{ID: string(c), Label: categoryLabels[c]})
	}
	return out, nil
}

// ListBillers returns active billers for a category (or all, when blank).
func (s *Service) ListBillers(ctx context.Context, category string) ([]BillerRow, error) {
	return s.repo.ListBillers(ctx, category)
}

// ListProducts returns active products filtered by category and/or biller.
func (s *Service) ListProducts(ctx context.Context, category, billerID string) ([]ProductRow, error) {
	return s.repo.ListProducts(ctx, category, billerID)
}

// ValidateInput is the customer-verification request.
type ValidateInput struct {
	Category          string
	BillerID          string
	ProductID         string
	CustomerReference string
	Metadata          map[string]string
}

// ValidationResult is the member-facing verification answer.
type ValidationResult struct {
	Valid        bool   `json:"valid"`
	CustomerName string `json:"customer_name,omitempty"`
	Message      string `json:"message,omitempty"`
}

// ValidateCustomer ports validateUtilityCustomer, including its two fallbacks:
// a missing product_id falls back to the biller's first active product (so an
// electricity meter can be checked before a bundle is chosen), and an environment
// with NO seeded provider route still validates against the sandbox test meters
// when sandbox validation is enabled.
func (s *Service) ValidateCustomer(ctx context.Context, in ValidateInput) (*ValidationResult, error) {
	category, err := ParseCategory(in.Category)
	if err != nil {
		return nil, err
	}
	billerID, err := requireField(in.BillerID, "biller_id")
	if err != nil {
		return nil, err
	}
	customerReference, err := requireField(in.CustomerReference, "customer_reference")
	if err != nil {
		return nil, err
	}

	biller, err := s.repo.GetBiller(ctx, billerID)
	if err != nil {
		return nil, err
	}
	if Category(biller.Category) != category {
		return nil, fmt.Errorf("%w: biller %s is %s", ErrCategoryMismatch, biller.Code, biller.Category)
	}

	// Resolve a product: the requested one, else the biller's first active one.
	var product *ProductRow
	if strings.TrimSpace(in.ProductID) != "" {
		product, err = s.repo.GetProduct(ctx, strings.TrimSpace(in.ProductID))
		if err != nil {
			return nil, err
		}
	} else {
		products, perr := s.repo.ListProducts(ctx, string(category), biller.ID)
		if perr != nil {
			return nil, perr
		}
		if len(products) > 0 {
			product = &products[0]
		}
	}

	var selected *Route
	if product != nil {
		routes, rerr := s.repo.GetRouteCandidates(ctx, product.ID)
		if rerr != nil {
			return nil, rerr
		}
		if ordered := FailoverOrder(routes, category); len(ordered) > 0 {
			selected = &ordered[0]
		}
	}

	if selected == nil {
		// Sandbox safety net (validateUtilityCustomer L476-498): with no route
		// seeded, the documented test meters must still validate so this module is
		// testable in an environment nobody has configured a provider in.
		// providerBillerCode is derived from the biller code the same way the TS
		// source does ('vtpass-eko-electric' → 'eko-electric'); the sandbox stub keys
		// off the meter number, so this only has to be non-empty.
		if s.sandboxValid && biller.RequiresValidation {
			if validator, ok := s.providers.Validator(s.sandboxCode); ok {
				res, verr := validator.ValidateCustomer(ctx, provider.BillValidationRequest{
					Type:              string(category),
					CustomerReference: customerReference,
					Params:            validationParams(biller.Code, strings.TrimPrefix(biller.Code, "vtpass-"), customerReference, in.Metadata),
				})
				if verr != nil {
					return nil, fmt.Errorf("utilitybills: sandbox validate: %w", verr)
				}
				return &ValidationResult{Valid: res.Valid, CustomerName: res.CustomerName, Message: res.Message}, nil
			}
		}
		if biller.RequiresValidation {
			return &ValidationResult{
				Valid:   false,
				Message: "No provider route configured for this biller. (Set VTPASS_ENVIRONMENT=sandbox to test with the sandbox meters.)",
			}, nil
		}
		return &ValidationResult{
			Valid:        true,
			CustomerName: "Unvalidated customer",
			Message:      "Validation is not required for this biller.",
		}, nil
	}

	validator, ok := s.providers.Validator(selected.Provider.AdapterCode)
	if !ok {
		// The provider has no verification capability. Not a refusal: the TS
		// adapters that cannot verify report valid=true with a "skipped" reason, and
		// blocking a purchase for lack of an optional capability would be wrong.
		return &ValidationResult{
			Valid:   true,
			Message: "This provider does not support customer verification.",
		}, nil
	}

	res, err := validator.ValidateCustomer(ctx, provider.BillValidationRequest{
		Type:              string(category),
		CustomerReference: customerReference,
		Params:            validationParams(biller.Code, selected.Mapping.ProviderBillerCode, customerReference, in.Metadata),
	})
	if err != nil {
		return nil, fmt.Errorf("utilitybills: validate customer: %w", err)
	}
	return &ValidationResult{Valid: res.Valid, CustomerName: res.CustomerName, Message: res.Message}, nil
}

// validationParams builds the flat Params map the adapter's Params contract
// documents. Caller-supplied metadata is merged FIRST so the resolved codes below
// always win — a client cannot override which biller it is verifying against.
func validationParams(billerCode, providerBillerCode, customerReference string, metadata map[string]string) map[string]string {
	params := map[string]string{}
	maps.Copy(params, metadata)
	params["billerCode"] = billerCode
	if providerBillerCode != "" {
		params["providerBillerCode"] = providerBillerCode
	}
	params["customerReference"] = customerReference
	return params
}

// QuoteInput is the pre-purchase pricing request.
type QuoteInput struct {
	Category   string
	BillerID   string
	ProductID  string
	AmountKobo *int64
}

// QuoteResult is the priced quote returned to the client. Every field is integer
// kobo.
type QuoteResult struct {
	Category           string `json:"category"`
	BillerID           string `json:"biller_id"`
	ProductID          string `json:"product_id"`
	ProviderID         string `json:"provider_id"`
	AmountKobo         int64  `json:"amount_kobo"`
	MarkupKobo         int64  `json:"markup_kobo"`
	ConvenienceFeeKobo int64  `json:"convenience_fee_kobo"`
	RetailAmountKobo   int64  `json:"retail_amount_kobo"`
	// ProviderCostKobo / GrossProfitKobo / GrossMarginBps are INTERNAL margin
	// figures. They are deliberately NOT in this struct's client-facing use — the
	// handler strips them — but they are carried here because PayUtility needs the
	// same computation. See handler.go's quote response shaping.
	ProviderCostKobo int64 `json:"-"`
	GrossProfitKobo  int64 `json:"-"`
	GrossMarginBps   int64 `json:"-"`
}

// priceQuote resolves biller/product/route and computes pricing, applying the
// commission_config convenience-fee override when one is active. Shared by
// QuotePayment and PayUtility so a quote can never disagree with what is charged.
func (s *Service) priceQuote(ctx context.Context, category Category, billerID, productID string, amountKobo *int64) (
	biller *BillerRow, product *ProductRow, routes []Route, pricing Pricing, calc *commission.CalcResult, service, subtype string, err error) {

	biller, err = s.repo.GetBiller(ctx, billerID)
	if err != nil {
		return biller, product, routes, pricing, calc, service, subtype, err
	}
	product, err = s.repo.GetProduct(ctx, productID)
	if err != nil {
		return biller, product, routes, pricing, calc, service, subtype, err
	}
	if Category(biller.Category) != category || Category(product.Category) != category || product.BillerID != biller.ID {
		err = fmt.Errorf("%w (biller=%s product=%s)", ErrCategoryMismatch, biller.Category, product.Category)
		return biller, product, routes, pricing, calc, service, subtype, err
	}

	// A fixed-price product ignores any caller-supplied amount, exactly like the
	// TS source: `product.amount_type === 'fixed' ? product.amount_kobo : input.amountKobo`.
	resolvedAmount := amountKobo
	if product.AmountType == string(AmountTypeFixed) {
		resolvedAmount = product.AmountKobo
	}

	candidates, rerr := s.repo.GetRouteCandidates(ctx, product.ID)
	if rerr != nil {
		err = rerr
		return biller, product, routes, pricing, calc, service, subtype, err
	}
	routes = FailoverOrder(candidates, category)
	if len(routes) == 0 {
		err = ErrNoViableRoute
		return biller, product, routes, pricing, calc, service, subtype, err
	}

	pricing, err = CalculateUtilityPricing(product.Domain(), routes[0].Mapping.Domain(), resolvedAmount)
	if err != nil {
		return biller, product, routes, pricing, calc, service, subtype, err
	}

	// Commission module (best-effort, never fatal): when an active config row
	// prices this (service, subtype) it can override the convenience fee.
	service = CategoryToCommissionService(category)
	if service != "" && s.commission != nil {
		subtype = DeriveCommissionSubtype(service, biller.Code, biller.Name)
		if c, cerr := s.commission.Calculate(ctx, CommissionCategory, service, subtype, pricing.AmountKobo); cerr == nil && c != nil {
			calc = c
			pricing = ApplyCommissionConvenienceFee(pricing, c.ConvenienceFeeKobo, true)
		}
	}
	return biller, product, routes, pricing, calc, service, subtype, err
}

// QuotePayment ports quoteUtilityPayment.
func (s *Service) QuotePayment(ctx context.Context, in QuoteInput) (*QuoteResult, error) {
	category, err := ParseCategory(in.Category)
	if err != nil {
		return nil, err
	}
	billerID, err := requireField(in.BillerID, "biller_id")
	if err != nil {
		return nil, err
	}
	productID, err := requireField(in.ProductID, "product_id")
	if err != nil {
		return nil, err
	}

	biller, product, routes, pricing, _, _, _, err := s.priceQuote(ctx, category, billerID, productID, in.AmountKobo)
	if err != nil {
		return nil, err
	}
	return &QuoteResult{
		Category:           string(category),
		BillerID:           biller.ID,
		ProductID:          product.ID,
		ProviderID:         routes[0].Provider.ID,
		AmountKobo:         pricing.AmountKobo,
		MarkupKobo:         pricing.MarkupKobo,
		ConvenienceFeeKobo: pricing.ConvenienceFeeKobo,
		RetailAmountKobo:   pricing.RetailAmountKobo,
		ProviderCostKobo:   pricing.ProviderCostKobo,
		GrossProfitKobo:    pricing.GrossProfitKobo,
		GrossMarginBps:     pricing.GrossMarginBps,
	}, nil
}

// PayInput is the purchase request.
type PayInput struct {
	Category          string
	BillerID          string
	ProductID         string
	CustomerReference string
	AmountKobo        *int64
	// PaymentSource is 'wallet' (the only source this phase debits) or 'paystack'
	// (an already-collected payment; the transaction is recorded and fulfilled but
	// no wallet debit and — matching today's behaviour exactly, including the known
	// gap — NO auto-reversal on provider failure).
	PaymentSource string
	Metadata      map[string]any
}

// PayResult is the purchase outcome.
type PayResult struct {
	AlreadyProcessed bool            `json:"already_processed"`
	Transaction      *TransactionRow `json:"transaction"`
}

const (
	paymentSourceWallet   = "wallet"
	paymentSourcePaystack = "paystack"
)

// PayUtility runs the full pay → provider → settle saga.
//  1. Idempotency pre-check on utility_transactions.idempotency_key.
//  2. Resolve biller/product/routes, price, enforce category limits, verify the
//     customer at the biller (all BEFORE any row is written or money moves).
//  3. Insert the transaction (status 'initiated'), with the unique-constraint
//     fallback as the second idempotency layer.
//  4. wallet.Debit → AccountProviderClearing (tier limit fires here). Status
//     'wallet_debited'.
//  5. Walk the failover order. Each attempt claims an outbound idempotency key
//     BEFORE the call, writes a utility_provider_attempts row, and classifies
//     the outcome.
//  6. Settle: 'successful' | 'provider_pending' | 'failed'. A DEFINITE failure on
//     a wallet-sourced payment auto-reverses the debit → 'reversed'.
//  7. For a SETTLED transaction only (successful / provider_pending) record the
//     commission earning with its balanced revenue leg.
func (s *Service) PayUtility(ctx context.Context, userID string, in PayInput, idempotencyKey string) (*PayResult, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyKeyRequired
	}
	category, err := ParseCategory(in.Category)
	if err != nil {
		return nil, err
	}
	billerID, err := requireField(in.BillerID, "biller_id")
	if err != nil {
		return nil, err
	}
	productID, err := requireField(in.ProductID, "product_id")
	if err != nil {
		return nil, err
	}
	customerReference, err := requireField(in.CustomerReference, "customer_reference")
	if err != nil {
		return nil, err
	}
	paymentSource := in.PaymentSource
	if paymentSource == "" {
		paymentSource = paymentSourceWallet
	}
	if paymentSource != paymentSourceWallet && paymentSource != paymentSourcePaystack {
		return nil, fmt.Errorf("%w: payment_source must be 'wallet' or 'paystack'", ErrFieldRequired)
	}

	// (1) Idempotency pre-check; the unique constraint at (3) is the layer that
	// actually holds under concurrency.
	if existing, eerr := s.repo.GetTransactionByIdempotencyKey(ctx, idempotencyKey); eerr != nil {
		return nil, eerr
	} else if existing != nil {
		return &PayResult{AlreadyProcessed: true, Transaction: existing}, nil
	}

	// (2) Resolve + price.
	biller, product, routes, pricing, calc, commissionService, commissionSubtype, err :=
		s.priceQuote(ctx, category, billerID, productID, in.AmountKobo)
	if err != nil {
		return nil, err
	}

	if err := s.enforceCategoryLimits(ctx, userID, category, pricing.RetailAmountKobo); err != nil {
		return nil, err
	}

	// Verify the customer at the biller BEFORE debiting. A wrong meter number
	// caught here costs nothing; caught after the debit it costs a reversal.
	var customerName *string
	if biller.RequiresValidation {
		validator, ok := s.providers.Validator(routes[0].Provider.AdapterCode)
		if ok {
			res, verr := validator.ValidateCustomer(ctx, provider.BillValidationRequest{
				Type:              string(category),
				CustomerReference: customerReference,
				Params:            validationParams(biller.Code, routes[0].Mapping.ProviderBillerCode, customerReference, stringMetadata(in.Metadata)),
			})
			if verr != nil {
				return nil, fmt.Errorf("utilitybills: validate customer: %w", verr)
			}
			if !res.Valid {
				msg := res.Message
				if msg == "" {
					msg = "Customer validation failed."
				}
				return nil, fmt.Errorf("%w: %s", ErrCustomerValidationFailed, msg)
			}
			if res.CustomerName != "" {
				name := res.CustomerName
				customerName = &name
			}
		}
	}

	// (3) Insert the transaction.
	transactionID := uuid.New().String()
	receipt := ReceiptNumber(transactionID, time.Now())
	metadata := json.RawMessage(`{}`)
	if in.Metadata != nil {
		if b, merr := json.Marshal(in.Metadata); merr == nil {
			metadata = b
		}
	}
	providerID := routes[0].Provider.ID
	mappingID := routes[0].Mapping.ID
	row := &TransactionRow{
		ID:                 transactionID,
		UserID:             userID,
		Category:           string(category),
		BillerID:           biller.ID,
		ProductID:          &product.ID,
		ProviderID:         &providerID,
		ProviderMappingID:  &mappingID,
		CustomerReference:  customerReference,
		CustomerName:       customerName,
		AmountKobo:         pricing.AmountKobo,
		ConvenienceFeeKobo: pricing.ConvenienceFeeKobo,
		RetailAmountKobo:   pricing.RetailAmountKobo,
		ProviderCostKobo:   pricing.ProviderCostKobo,
		GrossProfitKobo:    pricing.GrossProfitKobo,
		GrossMarginBps:     pricing.GrossMarginBps,
		Status:             string(StatusInitiated),
		ReceiptNumber:      &receipt,
		IdempotencyKey:     idempotencyKey,
		PaymentSource:      paymentSource,
		Metadata:           metadata,
	}
	inserted, duplicate, err := s.repo.InsertTransaction(ctx, row)
	if err != nil {
		return nil, err
	}
	if duplicate {
		// Another writer won the same-key race; theirs is the answer and no
		// money moved on this path.
		return &PayResult{AlreadyProcessed: true, Transaction: inserted}, nil
	}
	transaction := inserted
	s.event(ctx, transactionID, "initiated", "Utility payment initiated.", map[string]any{"pricing": pricing})

	// (4) Wallet debit → provider clearing (a PASS-THROUGH liability, not revenue).
	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: resolve clearing account: %w", err)
	}
	if paymentSource == paymentSourceWallet {
		debitErr := s.wallet.Debit(ctx, userID, receipt, idempotencyKey+":debit", clearing.ID, pricing.RetailAmountKobo)
		if debitErr != nil && !errors.Is(debitErr, ledger.ErrDuplicate) {
			// Money could not be taken. Nothing was sent to a provider, so there is
			// nothing to reverse — mark the transaction failed and surface the reason
			// (insufficient funds / tier limit) unchanged to the caller.
			s.markFailed(ctx, transactionID, debitErr.Error())
			s.event(ctx, transactionID, "wallet_debit_failed", debitErr.Error(), nil)
			return nil, fmt.Errorf("utilitybills: wallet debit failed: %w", debitErr)
		}
		// AUD-BILL-005: advance to wallet_debited only while we still own the row —
		// the CAS on (status, updated_at) detects a recovery/admin claim that landed
		// between the insert and the debit. Losing the race means the claim winner
		// owns the outcome INCLUDING compensating the debit we just posted, and the
		// purchase loop must NOT run (a vend delivered after a refund pays out twice).
		if t, uerr := s.repo.UpdateTransaction(ctx, transactionID, TransactionPatch{
			Status:         ptrx.Of(string(StatusWalletDebited)),
			GuardStatuses:  []string{string(StatusInitiated)},
			GuardUpdatedAt: &transaction.UpdatedAt,
		}); uerr == nil {
			transaction = t
		} else if errors.Is(uerr, ErrStatusGuard) {
			s.event(ctx, transactionID, "writer_outraced",
				"A settlement claim landed between the wallet debit and fulfilment — the writer yields.", nil)
			// CRITICAL not WARN: this writer DID post the debit; if the claim
			// winner's probe ran before it committed, nothing was compensated.
			log.Printf("[utilitybills] CRITICAL %s was claimed for settlement mid-debit — the debit posted and the writer yielded; verify the claim winner compensated it", transactionID)
			current, rerr := s.repo.GetTransaction(ctx, transactionID)
			if rerr != nil {
				return nil, fmt.Errorf("utilitybills: reload after losing settlement claim: %w", rerr)
			}
			return &PayResult{AlreadyProcessed: false, Transaction: current}, nil
		} else {
			log.Printf("[utilitybills] WARN could not persist wallet_debited for %s: %v", transactionID, uerr)
		}
		s.event(ctx, transactionID, "wallet_debited", "Wallet debited for utility payment.", nil)
	} else {
		var paymentRef any
		if in.Metadata != nil {
			paymentRef = in.Metadata["payment_reference"]
		}
		s.event(ctx, transactionID, "paystack_verified", "Paystack payment verified for utility payment.",
			map[string]any{"payment_reference": paymentRef})
	}

	// (5) Provider failover.
	outcome, fulfilled := s.purchaseWithFailover(ctx, purchaseContext{
		TransactionID:     transactionID,
		IdempotencyKey:    idempotencyKey,
		Category:          category,
		Biller:            biller,
		Product:           product,
		CustomerReference: customerReference,
		Pricing:           pricing,
		Metadata:          stringMetadata(in.Metadata),
		Routes:            routes,
	})

	// (6) Settle.
	nextStatus := NextStatusFromProvider(outcome.Outcome)
	patch := TransactionPatch{
		Status:           ptrx.Of(string(nextStatus)),
		ProviderID:       ptrx.Of(fulfilled.Provider.ID),
		ProviderResponse: outcome.Raw,
	}
	if fulfilled.Mapping.ID != "" {
		patch.ProviderMappingID = ptrx.Of(fulfilled.Mapping.ID)
	}
	if outcome.ProviderRef != "" {
		patch.ProviderReference = ptrx.Of(outcome.ProviderRef)
	}
	// The prepaid-electricity token IS the deliverable. Only ever written, never
	// cleared — a later requery that returns no token must not erase one already
	// vended to the customer.
	if outcome.Token != "" {
		patch.Token = ptrx.Of(outcome.Token)
	}
	if outcome.Outcome == ProviderOutcomeFailed {
		reason := outcome.Message
		if reason == "" {
			reason = "Provider failed transaction."
		}
		patch.FailureReason = ptrx.Of(reason)
	}
	// AUD-BILL-005: only write the settle patch while the row is still at the
	// version AND status we own — a settlement claim bumps updated_at and flips
	// the row to 'failed', so a claimed row rejects this write outright.
	patch.GuardStatuses = []string{string(StatusInitiated), string(StatusWalletDebited)}
	patch.GuardUpdatedAt = &transaction.UpdatedAt
	settleWon := false
	if t, uerr := s.repo.UpdateTransaction(ctx, transactionID, patch); uerr == nil {
		transaction = t
		settleWon = true
	} else if errors.Is(uerr, ErrStatusGuard) {
		// Recovery or an admin settled first — the claim winner owns the
		// outcome INCLUDING the money legs; record what the provider said so
		// reconciliation can see a vend that landed after settlement.
		s.event(ctx, transactionID, "provider_outcome_after_claim", outcome.Message, map[string]any{
			eventKeyProviderID: fulfilled.Provider.ID, "outcome": string(outcome.Outcome),
		})
		log.Printf("[utilitybills] WARN settle patch rejected for %s — a settlement claim owns the row (provider outcome: %s)", transactionID, outcome.Outcome)
		if t, rerr := s.repo.GetTransaction(ctx, transactionID); rerr == nil {
			transaction = t
		}
	} else {
		log.Printf("[utilitybills] WARN could not persist settle patch for %s: %v", transactionID, uerr)
	}
	s.event(ctx, transactionID, "provider_"+string(outcome.Outcome), outcome.Message, map[string]any{
		"provider_id": fulfilled.Provider.ID,
	})

	// Auto-reverse ONLY on definite failure of a WALLET-sourced payment while
	// this writer still owns the settle — a lost settle means the claim winner
	// owns compensation. Known gap (faithful port): a Paystack-sourced failure
	// is not auto-refunded — the money is at Paystack, not in the ledger, so a
	// reversal would invent funds.
	if outcome.Outcome == ProviderOutcomeFailed && paymentSource == paymentSourceWallet && settleWon {
		if t := s.autoReverse(ctx, transaction, idempotencyKey, clearing.ID); t != nil {
			transaction = t
		}
	}

	// (7) Commission — SETTLED transactions only.
	if transaction.Status == string(StatusSuccessful) || transaction.Status == string(StatusProviderPending) {
		s.recordCommission(ctx, transaction, pricing, calc, commissionService, commissionSubtype, idempotencyKey)
	}

	// Convenience only: stamp the saved beneficiary, if the member has one.
	if s.beneficiaries != nil {
		if berr := s.beneficiaries.TouchLastUsed(ctx, userID, biller.ID, customerReference); berr != nil {
			log.Printf("[utilitybills] WARN could not stamp beneficiary for %s: %v", transactionID, berr)
		}
	}

	return &PayResult{AlreadyProcessed: false, Transaction: transaction}, nil
}

// enforceCategoryLimits ports assertCategoryAvailableForPayment. A category with
// no settings row has no category-level restriction (the wallet tier limit still
// applies — this is an ADDITIONAL cap, never a replacement).
func (s *Service) enforceCategoryLimits(ctx context.Context, userID string, category Category, retailAmountKobo int64) error {
	setting, err := s.repo.GetCategorySetting(ctx, string(category))
	if err != nil {
		// FAIL CLOSED: a limit we cannot read is a limit we must assume binds.
		return fmt.Errorf("utilitybills: read category settings (fail closed): %w", err)
	}
	if setting == nil {
		return nil
	}
	if !setting.Enabled {
		msg := setting.AvailabilityMessage
		if msg == "" {
			msg = "This utility category is currently unavailable."
		}
		return fmt.Errorf("%w: %s", ErrCategoryUnavailable, msg)
	}
	if setting.MinAmountKobo != nil && retailAmountKobo < *setting.MinAmountKobo {
		return fmt.Errorf("%w: minimum category spend is %d kobo", ErrCategoryAmountOutOfRange, *setting.MinAmountKobo)
	}
	if setting.MaxAmountKobo != nil && retailAmountKobo > *setting.MaxAmountKobo {
		return fmt.Errorf("%w: maximum category spend is %d kobo", ErrCategoryAmountOutOfRange, *setting.MaxAmountKobo)
	}
	if setting.DailyLimitKobo == nil {
		return nil
	}
	used, err := s.repo.CategorySpendToday(ctx, userID, string(category))
	if err != nil {
		return fmt.Errorf("utilitybills: read category daily spend (fail closed): %w", err)
	}
	if used+retailAmountKobo > *setting.DailyLimitKobo {
		return fmt.Errorf("%w (used %d + %d > %d kobo)", ErrCategoryDailyLimit, used, retailAmountKobo, *setting.DailyLimitKobo)
	}
	return nil
}

type purchaseContext struct {
	TransactionID     string
	IdempotencyKey    string
	Category          Category
	Biller            *BillerRow
	Product           *ProductRow
	CustomerReference string
	Pricing           Pricing
	Metadata          map[string]string
	Routes            []Route
}

// purchaseOutcome is the normalised result of the whole failover walk.
type purchaseOutcome struct {
	Outcome     ProviderOutcome
	ProviderRef string
	Token       string
	Message     string
	Raw         json.RawMessage
}

// purchaseWithFailover walks the routes in priority order until one ACCEPTS the
// purchase (SUCCESS or PENDING), and returns the outcome plus the route that
// fulfilled it (the last one tried, when all failed — matching the TS source,
// which leaves fulfilledRoute pointing at the final candidate).
// Failing over to the next provider is only safe when the previous one gave a
// DEFINITE negative. On an ambiguous outcome the walk STOPS: trying provider #2
// after provider #1 may-or-may-not have sold the customer electricity is exactly
// how a double purchase happens.
func (s *Service) purchaseWithFailover(ctx context.Context, pc purchaseContext) (purchaseOutcome, Route) {
	var (
		lastMessage string
		fulfilled   = pc.Routes[0]
	)

	for i, route := range pc.Routes {
		attemptNumber := i + 1
		fulfilled = route
		attemptKey := fmt.Sprintf("%s:provider:%s:attempt:%d", pc.IdempotencyKey, route.Provider.ID, attemptNumber)

		adapter, ok := s.providers.Adapter(route.Provider.AdapterCode)
		if !ok {
			lastMessage = fmt.Sprintf("no configured adapter for %q", route.Provider.AdapterCode)
			s.event(ctx, pc.TransactionID, "provider_attempt_error", lastMessage, map[string]any{
				"provider_id": route.Provider.ID, "attempt_number": attemptNumber,
			})
			continue
		}

		// Claim BEFORE the call. The claim is an INSERT on a unique key, so a
		// replay or a concurrent attempt cannot reach the provider at all. Fails
		// CLOSED: no claim, no call.
		claim, claimErr := s.binds.Claim(ctx, attemptKey, route.Provider.Code, pc.Biller.Code, pc.Product.Code, pc.TransactionID)
		if claimErr != nil {
			switch {
			case errors.Is(claimErr, ErrBindOutcomeUnknown), errors.Is(claimErr, ErrBindInFlight):
				// A previous or concurrent attempt with this exact key is/was in the
				// air. Neither retrying nor failing over is safe. Park as PENDING so
				// requery resolves it — never auto-reverse, never try provider #2.
				s.event(ctx, pc.TransactionID, "provider_attempt_ambiguous", claimErr.Error(), map[string]any{
					"provider_id": route.Provider.ID, "attempt_number": attemptNumber,
				})
				return purchaseOutcome{
					Outcome: ProviderOutcomePending,
					Message: claimErr.Error(),
					Raw:     json.RawMessage(`{"bind":"ambiguous"}`),
				}, route
			default:
				// The registry itself refused (unavailable, DB error). The call was
				// never made, so nothing exists upstream and moving on is safe.
				lastMessage = claimErr.Error()
				s.event(ctx, pc.TransactionID, "provider_attempt_error", lastMessage, map[string]any{
					"provider_id": route.Provider.ID, "attempt_number": attemptNumber,
				})
				continue
			}
		}
		if !claim.Fresh {
			// This exact attempt already reached the provider and was accepted.
			// Replay its reference instead of purchasing again. Reported as PENDING
			// rather than SUCCESS because the register records "accepted", not
			// "settled" — a requery is what turns it into a final status.
			log.Printf("[utilitybills] purchase replay for key %s — provider ref %s", attemptKey, claim.ProviderTransactionRef)
			return purchaseOutcome{
				Outcome:     ProviderOutcomePending,
				ProviderRef: claim.ProviderTransactionRef,
				Message:     "Replayed a purchase already accepted by the provider.",
				Raw:         json.RawMessage(`{"bind":"replay"}`),
			}, route
		}

		attempt, aerr := s.repo.StartAttempt(ctx, pc.TransactionID, route.Provider.ID, route.Mapping.ID, attemptNumber, attemptKey)
		if aerr != nil {
			// We could not record the attempt, so we must not make it — an unrecorded
			// provider call is an invisible money movement.
			s.binds.Failed(ctx, attemptKey, aerr.Error())
			lastMessage = aerr.Error()
			continue
		}

		timeoutMs := route.Provider.TimeoutMs(s.timeoutMs)
		callCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
		bill, perr := adapter.PurchaseBill(callCtx, provider.BillRequest{
			Ref:        attemptKey,
			Type:       string(pc.Category),
			AmountKobo: pc.Pricing.AmountKobo,
			Params:     purchaseParams(pc, route, attemptKey),
		})
		timedOut := callCtx.Err() != nil && errors.Is(callCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil
		cancel()

		switch {
		case perr != nil && timedOut:
			// OUR socket gave up; VTpass may still be processing. This is the case
			// that must never be guessed at — lock the key and park as pending.
			s.binds.Unknown(ctx, attemptKey, perr.Error())
			_ = s.repo.FinishAttempt(ctx, attempt.ID, AttemptOutcome{
				Status: "timeout", Message: perr.Error(), TimeoutMs: timeoutMs,
				RawResponse: json.RawMessage(fmt.Sprintf(`{"timeout":true,"timeout_ms":%d}`, timeoutMs)),
			})
			s.event(ctx, pc.TransactionID, "provider_attempt_timeout", perr.Error(), map[string]any{
				"provider_id": route.Provider.ID, "attempt_number": attemptNumber, "timeout_ms": timeoutMs,
			})
			return purchaseOutcome{
				Outcome: ProviderOutcomePending,
				Message: perr.Error(),
				Raw:     json.RawMessage(fmt.Sprintf(`{"timeout":true,"timeout_ms":%d}`, timeoutMs)),
			}, route

		case perr != nil && !ProviderAnswered(perr):
			// Unrecognised transport error. Same reasoning as a timeout.
			s.binds.Unknown(ctx, attemptKey, perr.Error())
			_ = s.repo.FinishAttempt(ctx, attempt.ID, AttemptOutcome{Status: "error", Message: perr.Error()})
			s.event(ctx, pc.TransactionID, "provider_attempt_ambiguous", perr.Error(), map[string]any{
				"provider_id": route.Provider.ID, "attempt_number": attemptNumber,
			})
			return purchaseOutcome{
				Outcome: ProviderOutcomePending,
				Message: perr.Error(),
				Raw:     json.RawMessage(`{"transport_error":true}`),
			}, route

		case perr != nil:
			// A DEFINITE refusal — nothing was created, so failing over is safe.
			s.binds.Failed(ctx, attemptKey, perr.Error())
			_ = s.repo.FinishAttempt(ctx, attempt.ID, AttemptOutcome{Status: "error", Message: perr.Error()})
			lastMessage = perr.Error()
			s.event(ctx, pc.TransactionID, "provider_attempt_error", lastMessage, map[string]any{
				"provider_id": route.Provider.ID, "attempt_number": attemptNumber,
			})
			continue
		}

		outcome := billOutcome(bill)
		message := bill.Message
		switch outcome {
		case ProviderOutcomeSuccessful, ProviderOutcomePending:
			// The provider ACCEPTED it. Lock the key against a second purchase —
			// "pending" is still a landed request, see BindRegistry.Succeeded.
			s.binds.Succeeded(ctx, attemptKey, bill.ProviderRef)
			status := "successful"
			if outcome == ProviderOutcomePending {
				status = "pending"
			}
			_ = s.repo.FinishAttempt(ctx, attempt.ID, AttemptOutcome{
				Status: status, ProviderReference: bill.ProviderRef, Message: message, RawResponse: bill.Raw,
			})
			s.event(ctx, pc.TransactionID, "provider_attempt_"+status, message, map[string]any{
				"provider_id": route.Provider.ID, "attempt_number": attemptNumber,
			})
			return purchaseOutcome{
				Outcome:     outcome,
				ProviderRef: bill.ProviderRef,
				Token:       bill.Token,
				Message:     message,
				Raw:         bill.Raw,
			}, route

		default:
			// The provider answered and refused. Release the key and try the next
			// route.
			s.binds.Failed(ctx, attemptKey, message)
			_ = s.repo.FinishAttempt(ctx, attempt.ID, AttemptOutcome{
				Status: "failed", ProviderReference: bill.ProviderRef, Message: message, RawResponse: bill.Raw,
			})
			if message != "" {
				lastMessage = message
			} else {
				lastMessage = "Provider failed transaction."
			}
			s.event(ctx, pc.TransactionID, "provider_attempt_failed", lastMessage, map[string]any{
				"provider_id": route.Provider.ID, "attempt_number": attemptNumber,
			})
			continue
		}
	}

	if lastMessage == "" {
		lastMessage = "All configured providers failed transaction."
	}
	return purchaseOutcome{
		Outcome: ProviderOutcomeFailed,
		Message: lastMessage,
		Raw:     json.RawMessage(`{"failover_exhausted":true}`),
	}, fulfilled
}

// billOutcome folds provider.Bill's uppercase status enum into the domain's
// ProviderOutcome vocabulary. Anything unrecognised is FAILED, matching
// 's NextStatusFromProvider fall-through.
func billOutcome(bill *provider.Bill) ProviderOutcome {
	if bill == nil {
		return ProviderOutcomeFailed
	}
	switch strings.ToUpper(bill.Status) {
	case "SUCCESS":
		return ProviderOutcomeSuccessful
	case "PENDING":
		return ProviderOutcomePending
	default:
		return ProviderOutcomeFailed
	}
}

// purchaseParams builds the adapter's flat Params map. Caller metadata is merged
// FIRST so the server-resolved routing fields below always win — a client cannot
// redirect its own purchase at a different biller or product code.
func purchaseParams(pc purchaseContext, route Route, attemptKey string) map[string]string {
	params := map[string]string{}
	maps.Copy(params, pc.Metadata)
	params["billerCode"] = pc.Biller.Code
	if route.Mapping.ProviderBillerCode != "" {
		params["providerBillerCode"] = route.Mapping.ProviderBillerCode
	}
	params["productCode"] = pc.Product.Code
	params["providerProductCode"] = route.Mapping.ProviderProductCode
	params["customerReference"] = pc.CustomerReference
	params["idempotencyKey"] = attemptKey
	return params
}

// autoReverse posts the compensating reversal for a DEFINITE provider failure on
// a wallet-sourced payment: restore the member's wallet, drain the clearing hold,
// and move the transaction to 'reversed'.
// The #1 invariant of this module: a member is never left debited for a bill that
// definitively did not happen.
func (s *Service) autoReverse(ctx context.Context, t *TransactionRow, idempotencyKey, clearingAccountID string) *TransactionRow {
	// AUD-BILL-005: the two planes compensate under different key conventions
	// (TS writes utility:<tx>:REVERSAL_DEBIT, this plane writes <key>:reversal
	// rev legs) so the ledger's unique constraint alone cannot dedupe a
	// cross-plane double refund. Probe every known compensation key first.
	legs, lerr := s.transactionMoneyLegs(ctx, t)
	switch {
	case lerr != nil:
		// Unknown money state — leave 'failed' and let the sweep retry.
		log.Printf("[utilitybills] WARN auto-reverse could not probe money legs for %s: %v", t.ID, lerr)
		return nil
	case legs.compensationPosted:
		// Money already returned elsewhere — converge the status, never double-pay.
		updated, uerr := s.repo.UpdateTransaction(ctx, t.ID, TransactionPatch{
			Status:        ptrx.Of(string(StatusReversed)),
			GuardStatuses: []string{string(StatusFailed)},
		})
		if uerr != nil {
			log.Printf("[utilitybills] WARN compensation posted but status not persisted for %s: %v", t.ID, uerr)
			return nil
		}
		s.event(ctx, t.ID, "wallet_reversed", "Compensation already posted; status converged to reversed.", nil)
		return updated
	case !legs.debitPosted:
		// Status says the wallet was debited but the ledger shows no debit —
		// reversing would mint funds. Loud, and left unresolved.
		log.Printf("[utilitybills] CRITICAL auto-reverse found no debit leg for %s — refusing to mint a reversal", t.ID)
		s.event(ctx, t.ID, "stuck_debit_missing", "No debit leg exists for this transaction — no compensation posted.", nil)
		return nil
	}
	userWallet, werr := s.ledger.GetOrCreateUserWallet(ctx, t.UserID)
	if werr != nil {
		log.Printf("[utilitybills] CRITICAL: auto-reverse could not resolve wallet for %s — debited, no bill, no refund: %v", t.ID, werr)
		return nil
	}
	reference := "utility:reversal:" + t.ID
	revErr := s.ledger.PostReversal(ctx, userWallet.ID, clearingAccountID, t.RetailAmountKobo, reference, idempotencyKey+":reversal")
	if revErr != nil && !errors.Is(revErr, ledger.ErrDuplicate) {
		// The worst case. Leave the transaction in 'failed' (NOT 'reversed') so the
		// refund queue and any human looking at it can see the money is still out.
		log.Printf("[utilitybills] CRITICAL: auto-reverse FAILED for %s — debited, no bill, no refund: %v", t.ID, revErr)
		s.event(ctx, t.ID, "wallet_reversal_failed", revErr.Error(), nil)
		return nil
	}
	updated, uerr := s.repo.UpdateTransaction(ctx, t.ID, TransactionPatch{
		Status:        ptrx.Of(string(StatusReversed)),
		GuardStatuses: []string{string(StatusFailed)},
	})
	if uerr != nil {
		log.Printf("[utilitybills] WARN reversal posted but status not persisted for %s: %v", t.ID, uerr)
		return nil
	}
	s.event(ctx, t.ID, "wallet_reversed", "Wallet debit reversed after provider failure.", nil)
	return updated
}

// recordCommission appends the immutable commission_earnings row for a SETTLED
// transaction, with the balanced revenue leg RecordExact posts before it.
// BEST-EFFORT, exactly like the TS source: any failure is logged and swallowed.
// It must never fail or reverse a payment the customer already received.
func (s *Service) recordCommission(ctx context.Context, t *TransactionRow, pricing Pricing, calc *commission.CalcResult, service, subtype, idempotencyKey string) {
	if s.commission == nil || service == "" {
		// No commission service wired, or a category with no mapped service
		// ('internet') — legacy behaviour is to record nothing at all.
		return
	}

	// Prefer the config-derived revenue; fall back to the per-transaction gross
	// profit already computed. Same rule as recordUtilityCommissionEarning.
	revenue := pricing.GrossProfitKobo
	if calc != nil && calc.SpotlightRevenueKobo > 0 {
		revenue = calc.SpotlightRevenueKobo
	}
	if revenue <= 0 {
		// RecordExact refuses a negative amount, and a zero-revenue earning row
		// carries no information. An underpriced product is a pricing bug to fix in
		// the catalogue, not something to paper over with a ledger entry.
		log.Printf("[utilitybills] commission skipped for %s: non-positive revenue (%d kobo)", t.ID, revenue)
		return
	}

	userID := t.UserID
	if _, err := s.commission.RecordExact(ctx,
		CommissionCategory, service, subtype,
		pricing.AmountKobo, revenue,
		"utility", t.ID, &userID,
		idempotencyKey+":commission",
	); err != nil {
		log.Printf("[utilitybills] commission recording failed for %s (payment unaffected): %v", t.ID, err)
	}
}

// ListUserTransactions returns a member's transactions, newest first.
func (s *Service) ListUserTransactions(ctx context.Context, userID string, limit, offset int) ([]TransactionRow, error) {
	return s.repo.ListUserTransactions(ctx, userID, limit, offset)
}

// GetUserTransaction returns one transaction the caller owns.
func (s *Service) GetUserTransaction(ctx context.Context, userID, transactionID string) (*TransactionRow, error) {
	return s.repo.GetUserTransaction(ctx, userID, transactionID)
}

// GetTransaction returns one transaction with NO ownership check. Admin only —
// the route is RBAC-gated.
func (s *Service) GetTransaction(ctx context.Context, transactionID string) (*TransactionRow, error) {
	return s.repo.GetTransaction(ctx, transactionID)
}

// ListAttempts returns a transaction's provider attempt trail.
func (s *Service) ListAttempts(ctx context.Context, transactionID string) ([]AttemptRow, error) {
	return s.repo.ListAttempts(ctx, transactionID)
}

// AUD-BILL-005 — stuck-fulfilment recovery, the Go-plane port of
// recoverStuckUtilityTransaction in frontend-web/src/server/utility/service.ts.
//
// PayUtility writes the transaction row first, debits the wallet, then calls
// the provider. A crash between debit and settle left the row at
// initiated/wallet_debited forever: money held, no provider call made,
// SweepPending requerying a purchase the provider never saw (the VTPass
// request_id embeds a timestamp and cannot be reconstructed), and
// provider_pending verdicts marking the row failed WITHOUT compensating the
// debit. Recovery is driven off utility_provider_attempts evidence — the
// attempt row is written BEFORE the provider call, so zero attempts proves the
// provider was never contacted — and off ledger-leg probes that recognise BOTH
// writer conventions (TS verbatim keys AND this plane's per-side suffixes).

// stuckRecoveryMinAge mirrors UTILITY_STUCK_MIN_AGE_MS. A row younger than
// this may belong to an in-flight purchase; recovering under it could refund a
// vend that is still completing. Comfortably beyond every provider timeout.
const stuckRecoveryMinAge = 10 * time.Minute

// ambiguousAttemptStatuses are attempt outcomes that cannot prove the provider
// did NOT vend — the request may have been received and fulfilled upstream
// (a 'timeout' in particular is OUR socket giving up, not the provider
// declining). Only 'failed' is definitive; zero attempts means the provider
// was never contacted at all.
var ambiguousAttemptStatuses = map[string]bool{
	"started": true, "pending": true, "timeout": true, "error": true, "successful": true,
}

// moneyLegs is the ledger evidence for one transaction: whether the purchase
// debit posted, and whether ANY compensation leg already did.
type moneyLegs struct {
	debitPosted        bool
	compensationPosted bool
}

// transactionMoneyLegs probes ledger_entries for every money leg this
// transaction could have, under BOTH writer conventions: the TS journal writes
// verbatim keys (utility:<tx>:DEBIT, :REVERSAL_DEBIT, :PAYSTACK_REFUND,
// :ADMIN_REVERSAL_*), while this plane's ledger appends per-side suffixes to a
// base key (<key>:debit:credit for the purchase debit, <key>:reversal:rev_*
// for autoReverse, utility:<tx>:ADMIN_REVERSAL_DEBIT:rev_* for the Go admin
// path). Probing only one family's keys is how double refunds happen.
func (s *Service) transactionMoneyLegs(ctx context.Context, t *TransactionRow) (*moneyLegs, error) {
	key := t.IdempotencyKey
	debitKeys := []string{"utility:" + t.ID + ":DEBIT"}
	compKeys := []string{
		"utility:" + t.ID + ":REVERSAL_DEBIT",
		"utility:" + t.ID + ":PAYSTACK_REFUND",
		"utility:" + t.ID + ":PAYSTACK_REFUND:credit",
		"utility:" + t.ID + ":ADMIN_REVERSAL_DEBIT",
		"utility:" + t.ID + ":ADMIN_REVERSAL_DEBIT:rev_debit",
		"utility:" + t.ID + ":ADMIN_REVERSAL_PAYSTACK_REFUND",
		"utility:" + t.ID + ":ADMIN_REVERSAL_PAYSTACK_REFUND:credit",
	}
	if key != "" {
		debitKeys = append(debitKeys, key+":debit:credit", key+":debit:debit")
		compKeys = append(compKeys, key+":reversal:rev_debit", key+":reversal:rev_credit")
	}
	exists := func(keys []string) (bool, error) {
		for _, k := range keys {
			ok, err := s.repo.LedgerEntryExists(ctx, k)
			if err != nil || ok {
				return ok, err
			}
		}
		return false, nil
	}
	debit, err := exists(debitKeys)
	if err != nil {
		return nil, err
	}
	comp, err := exists(compKeys)
	if err != nil {
		return nil, err
	}
	if !comp && t.PaymentSource == paymentSourcePaystack {
		// The VALIDATION_REFUND leg is keyed on the Paystack intent id, which
		// the transaction row does not store — detect it via the captured
		// payment reference instead. Scoped to paystack rows: a wallet-source
		// row carrying a foreign reference in its metadata must not read as
		// compensated.
		if ref := paymentRefFromMetadata(t.Metadata); ref != "" {
			ok, err := s.repo.LedgerCreditByReferenceExists(ctx, ref)
			if err != nil {
				return nil, err
			}
			comp = ok
		}
	}
	return &moneyLegs{debitPosted: debit, compensationPosted: comp}, nil
}

func paymentRefFromMetadata(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	v, _ := m["payment_reference"].(string)
	return v
}

// recoverStuckTransaction settles a transaction that stopped between the row
// insert and a provider-verified outcome. Attempt evidence decides which case
// it is:
//   - no attempts            → the provider was never contacted; safe to settle
//   - only 'failed' attempts → every attempt definitively failed; safe to settle
//   - any ambiguous attempt  → a vend may have happened; hold the money and
//     flag for manual reconciliation, never auto-refund
func (s *Service) recoverStuckTransaction(ctx context.Context, t *TransactionRow) (*TransactionRow, error) {
	if time.Since(t.UpdatedAt) < stuckRecoveryMinAge {
		return t, nil
	}
	attempts, err := s.repo.ListAttempts(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	if len(attempts) == 0 {
		return s.settleFailedTransaction(ctx, t,
			"Purchase never reached a provider — recovered after the transaction stalled.", false)
	}
	for _, a := range attempts {
		if ambiguousAttemptStatuses[a.Status] {
			return s.settleFailedTransaction(ctx, t,
				"Provider attempt evidence is ambiguous — held for manual reconciliation.", true)
		}
	}
	return s.settleFailedTransaction(ctx, t,
		"All provider attempts failed — recovered after the transaction stalled.", false)
}

// settleFailedTransaction claims the row, consults the ledger, compensates when
// the evidence proves it is safe, and converges the status. ambiguousEvidence
// skips every money leg — a provider that may have vended is never refunded
// automatically. When compensation cannot be posted the transaction lands on
// 'failed' (NOT 'reversed') so the outstanding money stays visible.
func (s *Service) settleFailedTransaction(ctx context.Context, t *TransactionRow, reason string, ambiguousEvidence bool) (*TransactionRow, error) {
	// The claim flips the row to 'failed' in one write — outside every other
	// claim set — so exactly one compensator can ever be inside the
	// probe→post window, and an in-flight writer's guarded settle patch can no
	// longer land after the claim.
	claimed, err := s.repo.ClaimForSettlement(ctx, t.ID, t.UpdatedAt, reason)
	if err != nil {
		return nil, err
	}
	if claimed == nil {
		// Another writer owns the transition — adopt their outcome.
		return s.repo.GetTransaction(ctx, t.ID)
	}
	if ambiguousEvidence {
		s.event(ctx, t.ID, "stuck_needs_manual_reconciliation",
			"Provider attempt evidence is ambiguous — a vend may have happened; holding money pending manual review.", nil)
		log.Printf("[utilitybills] CRITICAL stuck transaction %s has ambiguous attempt evidence — manual reconciliation required", t.ID)
		return claimed, nil
	}

	legs, err := s.transactionMoneyLegs(ctx, claimed)
	if err != nil {
		return nil, err
	}
	newStatus := string(StatusFailed)
	switch {
	case legs.compensationPosted:
		// Another path already returned the money — converge the status only.
		newStatus = string(StatusReversed)
	case claimed.PaymentSource == paymentSourceWallet && legs.debitPosted:
		if s.postStuckReversal(ctx, claimed) {
			newStatus = string(StatusReversed)
		}
	case claimed.PaymentSource == paymentSourcePaystack:
		if s.postPaystackRefund(ctx, claimed) {
			newStatus = string(StatusReversed)
		}
	case claimed.PaymentSource == paymentSourceWallet && t.Status != string(StatusInitiated):
		// The status claims a debit the ledger does not show — posting a
		// reversal here would mint funds. Loud, and left unresolved.
		s.event(ctx, t.ID, "stuck_debit_missing",
			"Status claims the wallet was debited but no debit leg exists — no compensation posted.", nil)
		log.Printf("[utilitybills] CRITICAL %s transaction %s has no debit leg — refusing to mint a reversal", t.Status, t.ID)
	}
	updated, uerr := s.repo.UpdateTransaction(ctx, t.ID, TransactionPatch{
		Status:        ptrx.Of(newStatus),
		FailureReason: ptrx.Of(reason),
	})
	if uerr != nil {
		return nil, uerr
	}
	s.event(ctx, t.ID, "stuck_recovered", reason, map[string]any{eventKeyStatus: newStatus})
	return updated, nil
}

// postStuckReversal compensates a stuck WALLET-sourced transaction by reversing
// the purchase debit back into the member's wallet, under the same
// "<key>:reversal" base convention autoReverse uses so the two paths dedupe on
// the ledger's unique idempotency key. False = money still outstanding.
func (s *Service) postStuckReversal(ctx context.Context, t *TransactionRow) bool {
	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		s.event(ctx, t.ID, "stuck_reversal_failed", "Could not resolve the clearing account — money still outstanding.", nil)
		log.Printf("[utilitybills] CRITICAL stuck recovery could not resolve clearing for %s: %v", t.ID, err)
		return false
	}
	userWallet, err := s.ledger.GetOrCreateUserWallet(ctx, t.UserID)
	if err != nil {
		s.event(ctx, t.ID, "stuck_reversal_failed", "Could not resolve the member wallet — money still outstanding.", nil)
		log.Printf("[utilitybills] CRITICAL stuck recovery could not resolve wallet for %s: %v", t.ID, err)
		return false
	}
	revErr := s.ledger.PostReversal(ctx, userWallet.ID, clearing.ID, t.RetailAmountKobo,
		"utility:reversal:"+t.ID, t.IdempotencyKey+":reversal")
	if revErr != nil && !errors.Is(revErr, ledger.ErrDuplicate) {
		s.event(ctx, t.ID, "stuck_reversal_failed", revErr.Error(), nil)
		log.Printf("[utilitybills] CRITICAL stuck recovery reversal FAILED for %s — debited, no bill, no refund: %v", t.ID, revErr)
		return false
	}
	s.event(ctx, t.ID, "wallet_reversed", "Wallet debit reversed during stuck-transaction recovery.", nil)
	return true
}

// postPaystackRefund compensates a stuck PAYSTACK-sourced transaction. The
// charge was captured before fulfilment and the wallet was never debited, so
// the compensation is a CREDIT (same key the TS plane writes, keeping the two
// planes' probes symmetric). False = captured money not yet returned.
func (s *Service) postPaystackRefund(ctx context.Context, t *TransactionRow) bool {
	// A paystack-source row must carry the captured charge's reference — the TS
	// intake writes it into metadata after verifying the payment. No reference
	// means nothing verifiably captured, so there is nothing to refund.
	if paymentRefFromMetadata(t.Metadata) == "" {
		s.event(ctx, t.ID, "paystack_refund_skipped",
			"Paystack-source transaction carries no payment_reference — captured charge cannot be verified.", nil)
		log.Printf("[utilitybills] CRITICAL paystack-source %s has no payment_reference — refusing to credit an unverifiable refund", t.ID)
		return false
	}
	reference := t.ID
	if t.ReceiptNumber != nil && *t.ReceiptNumber != "" {
		reference = *t.ReceiptNumber
	}
	err := s.wallet.Credit(ctx, t.UserID, reference, "utility:"+t.ID+":PAYSTACK_REFUND", t.RetailAmountKobo)
	if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		s.event(ctx, t.ID, "paystack_refund_failed", err.Error(), nil)
		log.Printf("[utilitybills] CRITICAL paystack refund FAILED for %s — captured money not returned: %v", t.ID, err)
		return false
	}
	s.event(ctx, t.ID, "paystack_refunded", "Captured Paystack charge refunded to wallet during stuck-transaction recovery.", nil)
	return true
}

// RequeryTransaction asks the provider what actually happened and applies the
// answer. Ports requeryUtilityTransaction.
// Callable by a MEMBER (the handler resolves ownership first) and by an ADMIN
// (RBAC-gated route, no ownership filter) — it deliberately takes a transaction
// id rather than a user id so there is exactly ONE implementation and never a
// second writer deciding transitions on the same rows.
// A transaction in a non-requeryable state is returned unchanged rather than
// erroring, matching the TS guard (`if (!canRequery) return transaction`).
func (s *Service) RequeryTransaction(ctx context.Context, transactionID string) (*TransactionRow, error) {
	t, err := s.repo.GetTransaction(ctx, transactionID)
	if err != nil {
		return nil, err
	}
	if !CanRequeryStatus(Status(t.Status)) {
		return t, nil
	}
	// AUD-BILL-005: pre-provider states (initiated / wallet_debited) and
	// provider_pending rows with NO recorded provider reference cannot be
	// requeried — VTpass can only look a purchase up by the reference it echoed
	// back, and a fabricated request id would return a misleading "failed".
	// Recovery decides these rows from attempt + ledger evidence instead.
	if t.ProviderReference == nil || *t.ProviderReference == "" {
		return s.recoverStuckTransaction(ctx, t)
	}
	if t.ProviderID == nil || *t.ProviderID == "" {
		return s.recoverStuckTransaction(ctx, t)
	}

	providerRow, err := s.repo.GetProvider(ctx, *t.ProviderID)
	if err != nil {
		return nil, err
	}
	adapter, ok := s.providers.Adapter(providerRow.AdapterCode)
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrProviderUnavailable, providerRow.AdapterCode)
	}

	timeoutMs := providerRow.TimeoutMs(s.timeoutMs)
	callCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	bill, qerr := adapter.GetBill(callCtx, *t.ProviderReference)
	timedOut := callCtx.Err() != nil && errors.Is(callCtx.Err(), context.DeadlineExceeded) && ctx.Err() == nil
	cancel()

	if qerr != nil {
		if timedOut || !ProviderAnswered(qerr) {
			// A requery that could not be answered tells us nothing. Leave the
			// transaction exactly as it was — a requery must never be able to move a
			// transaction to 'failed' on its own silence.
			s.event(ctx, t.ID, "status_requery_unresolved", qerr.Error(), nil)
			return t, nil
		}
		return nil, fmt.Errorf("utilitybills: requery: %w", qerr)
	}

	// A nil bill with no error is not an authoritative answer — compensating on
	// it could refund a vend the provider actually delivered.
	if bill == nil {
		s.event(ctx, t.ID, "status_requery_unresolved", "Provider returned no bill — answer is not authoritative.", nil)
		return t, nil
	}

	outcome := billOutcome(bill)

	// AUD-BILL-005: a real provider reference makes this verdict authoritative —
	// a failed answer must COMPENSATE the debit, not just mark the row failed
	// and strand the money (the pre-fix behaviour).
	if outcome == ProviderOutcomeFailed {
		reason := bill.Message
		if reason == "" {
			reason = "Provider reported the transaction as failed."
		}
		updated, uerr := s.settleFailedTransaction(ctx, t, reason, false)
		if uerr != nil {
			return nil, uerr
		}
		s.event(ctx, t.ID, "status_requery", bill.Message, map[string]any{eventKeyStatus: updated.Status})
		return updated, nil
	}

	status := NextStatusFromProvider(outcome)
	patch := TransactionPatch{Status: ptrx.Of(string(status)), ProviderResponse: bill.Raw}
	if bill.ProviderRef != "" {
		patch.ProviderReference = ptrx.Of(bill.ProviderRef)
	}
	if bill.Token != "" {
		patch.Token = ptrx.Of(bill.Token)
	}
	patch.ClearFailureReason = true
	// The provider may have answered while a recovery claim or an admin reversal
	// settled the row — a successful/pending verdict only applies if the row is
	// still in the state we observed, at the same version (a claim bumps
	// updated_at, so a claimed row rejects this write even before status flips).
	patch.GuardStatuses = []string{string(StatusInitiated), string(StatusWalletDebited), string(StatusProviderPending)}
	patch.GuardUpdatedAt = &t.UpdatedAt

	updated, uerr := s.repo.UpdateTransaction(ctx, t.ID, patch)
	if uerr != nil {
		if errors.Is(uerr, ErrStatusGuard) {
			s.event(ctx, t.ID, "provider_verdict_after_claim",
				"A settlement claim owns this row — discarding verdict "+string(status)+".", nil)
			return s.repo.GetTransaction(ctx, t.ID)
		}
		return nil, uerr
	}
	s.event(ctx, t.ID, "status_requery", bill.Message, map[string]any{"status": string(status)})
	return updated, nil
}

// SweepRowResult is one transaction's outcome within a sweep pass.
type SweepRowResult struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// SweepResult summarises one sweep pass — the same shape
// requeryPendingUtilityTransactions returned, so the admin worker endpoint
// (Phase 4) can report it identically.
type SweepResult struct {
	Processed int              `json:"processed"`
	Succeeded int              `json:"succeeded"`
	Failed    int              `json:"failed"`
	Results   []SweepRowResult `json:"results"`
}

// SweepPending requeries every transaction still stuck in a non-terminal,
// requery-eligible state, oldest first. Ports requeryPendingUtilityTransactions
// verbatim: EVERY row runs even if an earlier one errors — one member's stuck
// purchase must never block another's from being checked — and each row's
// outcome is a recorded RESULT, not a returned error, mirroring the TS source's
// per-row try/catch. The only error this can return is failing to LIST the
// pending rows in the first place.
func (s *Service) SweepPending(ctx context.Context, limit int) (*SweepResult, error) {
	pending, err := s.repo.ListPending(ctx, limit)
	if err != nil {
		return nil, err
	}
	res := &SweepResult{Results: make([]SweepRowResult, 0, len(pending))}
	for _, t := range pending {
		row := SweepRowResult{ID: t.ID}
		updated, rerr := s.RequeryTransaction(ctx, t.ID)
		if rerr != nil {
			row.OK = false
			row.Status = t.Status
			row.Error = rerr.Error()
			log.Printf("utilitybills: pending sweep: requery id=%s: %v", t.ID, rerr)
			res.Failed++
		} else {
			row.OK = true
			row.Status = updated.Status
			res.Succeeded++
		}
		res.Processed++
		res.Results = append(res.Results, row)
	}
	return res, nil
}

// ReverseTransaction is the ADMIN-initiated reversal (a support refund), porting
// reverseUtilityTransaction. Same single implementation serves any caller; the
// route is RBAC-gated.
// Idempotency is keyed on the TRANSACTION, not on a caller-supplied header:
// "reverse this transaction" is inherently a once-per-transaction operation, and
// keying it on the transaction id means two admins clicking refund cannot pay the
// member twice — a deliberate divergence from the pay path's client-key-derived
// suffixes.
// actorUserID is the acting ADMIN (Phase 4), recorded as the audit actor. It is
// deliberately a parameter rather than something read off the context: a money
// reversal with no attributable author is exactly the record an audit trail
// exists to prevent, and a parameter cannot be silently absent at compile time.
// An empty value is still accepted rather than rejected — refusing to reverse a
// member's stuck debit because an audit field was blank would punish the wrong
// person — but it is logged as an anomaly.
func (s *Service) ReverseTransaction(ctx context.Context, actorUserID, transactionID, reason string) (*TransactionRow, error) {
	t, err := s.repo.GetTransaction(ctx, transactionID)
	if err != nil {
		return nil, err
	}
	if !CanReverseTransaction(Status(t.Status)) {
		return nil, fmt.Errorf("%w (status %s)", ErrNotEligibleForReversal, t.Status)
	}
	if t.PaymentSource != paymentSourceWallet {
		// The money is at Paystack, not in the ledger. A ledger reversal here would
		// credit a wallet that was never debited — inventing funds.
		return nil, fmt.Errorf("%w: payment_source %q is not wallet-sourced", ErrNotEligibleForReversal, t.PaymentSource)
	}

	// AUD-BILL-005: the automatic paths compensate under different key families
	// (TS utility:<tx>:REVERSAL_DEBIT, this plane's <key>:reversal rev legs) so
	// the ADMIN_REVERSAL_* unique key cannot dedupe a cross-plane double refund
	// when a crash left the status 'failed' after money already returned. And a
	// failed row with NO debit leg at all is an integrity anomaly — minting a
	// reversal against it creates funds.
	legs, lerr := s.transactionMoneyLegs(ctx, t)
	if lerr != nil {
		return nil, fmt.Errorf("utilitybills: probe money legs: %w", lerr)
	}
	if !legs.debitPosted && !legs.compensationPosted {
		return nil, fmt.Errorf("%w: no wallet debit exists for transaction %s — nothing to reverse", ErrNotEligibleForReversal, t.ID)
	}

	// Serialise compensation behind the settlement claim: it flips the row to
	// 'failed' (or refreshes an already-failed stale row) so a recovery pass or
	// a second admin cannot enter the probe→post window concurrently.
	claimed, cerr := s.repo.ClaimForSettlement(ctx, t.ID, t.UpdatedAt, reason)
	if cerr != nil {
		return nil, fmt.Errorf("utilitybills: claim for reversal: %w", cerr)
	}
	if claimed == nil {
		// Either another writer moved the row first, or it is a just-failed row
		// still inside the settle window — a concurrent compensator may be
		// mid-flight; refusing here is what prevents the double refund.
		return nil, fmt.Errorf("%w: transaction %s is being settled by another process — retry shortly", ErrNotEligibleForReversal, t.ID)
	}

	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: resolve clearing account: %w", err)
	}
	userWallet, err := s.ledger.GetOrCreateUserWallet(ctx, t.UserID)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: resolve user wallet: %w", err)
	}

	if !legs.compensationPosted {
		reference := t.ID
		if t.ReceiptNumber != nil && *t.ReceiptNumber != "" {
			reference = *t.ReceiptNumber
		}
		revErr := s.ledger.PostReversal(ctx, userWallet.ID, clearing.ID, t.RetailAmountKobo,
			reference, "utility:"+t.ID+":ADMIN_REVERSAL_DEBIT")
		if revErr != nil && !errors.Is(revErr, ledger.ErrDuplicate) {
			return nil, fmt.Errorf("utilitybills: admin reversal failed: %w", revErr)
		}
	} else {
		s.event(ctx, t.ID, "admin_reversal_skipped",
			"Compensation already posted for this transaction; skipping duplicate money leg. Reason: "+reason, nil)
	}

	updated, err := s.repo.UpdateTransaction(ctx, t.ID, TransactionPatch{
		Status:        ptrx.Of(string(StatusReversed)),
		FailureReason: ptrx.Of(reason),
	})
	if err != nil {
		return nil, err
	}
	s.event(ctx, t.ID, "admin_reversed", reason, nil)
	if actorUserID == "" {
		log.Printf("[utilitybills] WARN admin reversal of %s has no attributable actor", t.ID)
	}
	// oldValues carries the pre-reversal status and the amount that moved, so the
	// audit row stands alone: an auditor should never have to re-read the
	// transaction (which by then shows only the post-state) to know what changed.
	s.log(actorUserID, actionTransactionReverse, resourceTransaction, t.ID,
		map[string]any{"status": t.Status},
		map[string]any{
			"status":             string(StatusReversed),
			"reason":             reason,
			"retail_amount_kobo": t.RetailAmountKobo,
			"user_id":            t.UserID,
		})
	return updated, nil
}

// CreateDispute opens a dispute against a transaction the caller owns and moves
// it to 'disputed'. Ports createUtilityDispute.
func (s *Service) CreateDispute(ctx context.Context, userID, transactionID, reason string) (*DisputeRow, error) {
	reason, err := requireField(reason, "reason")
	if err != nil {
		return nil, err
	}
	t, err := s.repo.GetUserTransaction(ctx, userID, transactionID)
	if err != nil {
		return nil, err
	}
	// AUD-BILL-005: 'disputed' is outside every claim, requery, and reversal
	// set — flipping a NON-terminal row to it freezes the row out of the sweep
	// and breaks the writer's settle CAS, stranding a debited wallet with no
	// compensator able to claim it. Disputes exist for delivered charges only.
	if t.Status != string(StatusSuccessful) {
		return nil, fmt.Errorf("%w (status %s)", ErrNotDisputable, t.Status)
	}
	dispute, err := s.repo.InsertDispute(ctx, t.ID, userID, reason)
	if err != nil {
		return nil, err
	}
	if _, uerr := s.repo.UpdateTransaction(ctx, t.ID, TransactionPatch{Status: ptrx.Of(string(StatusDisputed))}); uerr != nil {
		log.Printf("[utilitybills] WARN dispute opened but status not persisted for %s: %v", t.ID, uerr)
	}
	s.event(ctx, t.ID, "dispute_opened", reason, nil)
	return dispute, nil
}

// ListBeneficiaries returns a member's saved beneficiaries.
func (s *Service) ListBeneficiaries(ctx context.Context, userID, category string) ([]BeneficiaryRow, error) {
	return s.beneficiaries.List(ctx, userID, category)
}

// SaveBeneficiary upserts a saved beneficiary, verifying the biller supports the
// stated category first (the same check the TS source makes).
func (s *Service) SaveBeneficiary(ctx context.Context, userID string, category, billerID, label, customerReference, customerName string) (*BeneficiaryRow, error) {
	cat, err := ParseCategory(category)
	if err != nil {
		return nil, err
	}
	billerID, err = requireField(billerID, "biller_id")
	if err != nil {
		return nil, err
	}
	label, err = requireField(label, "label")
	if err != nil {
		return nil, err
	}
	customerReference, err = requireField(customerReference, "customer_reference")
	if err != nil {
		return nil, err
	}
	biller, err := s.repo.GetBiller(ctx, billerID)
	if err != nil {
		return nil, err
	}
	if Category(biller.Category) != cat {
		return nil, fmt.Errorf("%w: biller %s is %s", ErrCategoryMismatch, biller.Code, biller.Category)
	}
	return s.beneficiaries.Save(ctx, userID, string(cat), biller.ID, label, customerReference, customerName)
}

// DeleteBeneficiary removes a saved beneficiary the caller owns.
func (s *Service) DeleteBeneficiary(ctx context.Context, userID, beneficiaryID string) error {
	return s.beneficiaries.Delete(ctx, userID, beneficiaryID)
}

// UnresolvedBindCount exposes the reconciliation backlog (outbound purchases with
// an unknown outcome) for admin monitoring.
func (s *Service) UnresolvedBindCount(ctx context.Context) (int, error) {
	return s.binds.UnresolvedCount(ctx)
}

// event appends a transaction event, best-effort. An event trail that fails to
// write must never fail a payment.
func (s *Service) event(ctx context.Context, transactionID, eventType, message string, payload any) {
	if err := s.repo.AddEvent(ctx, transactionID, eventType, message, payload); err != nil {
		log.Printf("[utilitybills] WARN could not append event %q for %s: %v", eventType, transactionID, err)
	}
}

// log records one admin mutation in the platform audit trail, best-effort.
// NIL-SAFE: Deps.Auditor is optional and every caller fires unconditionally.
// Deliberately a different trail from event(): event() is the per-transaction
// lifecycle a support case is reconstructed from; this is the who-did-what
// record of an admin's actions.
func (s *Service) log(actorUserID, action, resourceType, resourceID string, oldValues, newValues map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actorUserID, "", action, auditModule, resourceType, resourceID,
		oldValues, newValues, "", "", "info")
}

// markFailed moves a transaction to 'failed' with a reason, best-effort. Used on
// the pre-provider failure paths where there is nothing to reverse.
func (s *Service) markFailed(ctx context.Context, transactionID, reason string) {
	if _, err := s.repo.UpdateTransaction(ctx, transactionID, TransactionPatch{
		Status:        ptrx.Of(string(StatusFailed)),
		FailureReason: &reason,
	}); err != nil {
		log.Printf("[utilitybills] WARN could not mark %s failed: %v", transactionID, err)
	}
}

// stringMetadata flattens the caller's free-form metadata into the flat
// map[string]string the adapter Params contract uses. Only string, numeric and
// boolean scalars are carried across — nested objects have no representation in a
// flat param map, and silently stringifying them ("[object Object]", in the TS
// source's case) would send the provider garbage.
func stringMetadata(metadata map[string]any) map[string]string {
	if metadata == nil {
		return nil
	}
	out := make(map[string]string, len(metadata))
	for k, v := range metadata {
		switch val := v.(type) {
		case string:
			out[k] = val
		case bool:
			out[k] = strconv.FormatBool(val)
		case json.Number:
			out[k] = val.String()
		case int:
			out[k] = strconv.Itoa(val)
		case int64:
			out[k] = strconv.FormatInt(val, 10)
		case float64:
			// JSON numbers decode as float64. Integral values render without a
			// spurious ".0"; a genuinely fractional value is not a money amount here
			// (amounts never travel through metadata) so %v is safe.
			if val == float64(int64(val)) {
				out[k] = strconv.FormatInt(int64(val), 10)
			} else {
				out[k] = fmt.Sprintf("%v", val)
			}
		}
	}
	return out
}

// Background reconciliation job (Phase 3, closes UTIL-002). Follows the
// goroutine+ticker pattern from maplerad/jobs.go's StartOrphanSweep: runs on an
// interval, stops when ctx is cancelled, and never lets one bad tick kill the
// loop.

// defaultSweepLimit mirrors requeryPendingUtilityTransactions's own default —
// the TS source's admin worker route falls back to 25 when no ?limit is given.
const defaultSweepLimit = 25

// StartPendingSweep periodically requeries transactions stuck in a non-terminal
// state (initiated / wallet_debited / provider_pending) with no resolved
// webhook or synchronous answer — without it they are only resolvable by an
// admin hitting the requery-pending worker endpoint (UTIL-002).
func StartPendingSweep(ctx context.Context, svc *Service, interval time.Duration) {
	if interval <= 0 {
		interval = time.Hour
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				res, err := svc.SweepPending(ctx, defaultSweepLimit)
				if err != nil {
					log.Printf("utilitybills: pending sweep job: %v", err)
					continue
				}
				if res.Processed > 0 {
					log.Printf("utilitybills: pending sweep: processed=%d succeeded=%d failed=%d",
						res.Processed, res.Succeeded, res.Failed)
				}
			}
		}
	}()
}
