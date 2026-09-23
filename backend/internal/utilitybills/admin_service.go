package utilitybills

// admin_service.go is the ADMIN half of service.go: catalogue CRUD, provider
// credential rotation, provider health checks, dispute resolution, the manual
// sweep trigger, and the three reports.
//
// It is a port of the admin functions in frontend-web/src/server/utility/service.ts
// (adminListUtilityTable / adminCreateUtilityRow / adminUpdateUtilityRow /
// adminHealthCheckProvider / adminImportUtilityProducts /
// adminResolveUtilityDispute / adminUtilityReport), with ONE structural change
// that is the reason this file is longer than its source: the TS implementation
// is a single generic `(table, payload)` pair that forwards an arbitrary
// Record<string, unknown> straight to PostgREST, so its only validation is
// whatever the database rejects. Here each entity is explicit and validated
// BEFORE the insert, so a bad catalogue write fails as a 400 naming the field
// rather than as a 500 carrying a raw constraint name.
//
// Every mutation records an audit row (s.log). That is net-new: the Go module
// had no audit sink at all before this phase, and the TS routes' audit went to a
// different store than the platform audit log.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"spotlight/backend/internal/provider"
)

// ── Admin-only error sentinels (handler.go's writeErr maps these) ────────────

var (
	// ErrInvalidStatus — a status value outside the column's CHECK constraint.
	ErrInvalidStatus = errors.New("utilitybills: invalid status value")
	// ErrInvalidAmountType — amount_type is neither 'fixed' nor 'variable'.
	ErrInvalidAmountType = errors.New("utilitybills: amount_type must be 'fixed' or 'variable'")
	// ErrInvalidHealthStatus — health_status outside the CHECK constraint.
	ErrInvalidHealthStatus = errors.New("utilitybills: invalid health status value")
	// ErrHealthCheckUnsupported — the provider's adapter does not implement the
	// optional provider.HealthChecker capability. Deliberately an ERROR and not
	// a silent "unknown": an admin who clicked health-check must not be shown a
	// status that nothing actually checked, because routing.go trusts that
	// column to exclude 'down' providers from live money routing.
	ErrHealthCheckUnsupported = errors.New("utilitybills: this provider's adapter does not support health checks")
	// ErrCredentialsRequired — a credentials rotation with an empty body.
	ErrCredentialsRequired = errors.New("utilitybills: a non-empty credentials object is required")
	// ErrCredentialsNotPatchable — credentials were passed to the generic
	// provider PATCH. Rejected LOUDLY rather than ignored: silently dropping a
	// credentials field leaves an admin believing a rotation happened when the
	// provider is still using the old secret.
	ErrCredentialsNotPatchable = errors.New("utilitybills: credentials cannot be set through this endpoint — use PUT /providers/:id/credentials")
	// ErrEmptyImport — the product import body had no rows. Ports
	// adminImportUtilityProducts's `products must be a non-empty array.` 400.
	ErrEmptyImport = errors.New("utilitybills: products must be a non-empty array")
	// ErrInvalidDisputeStatus — a resolution status other than resolved/rejected.
	ErrInvalidDisputeStatus = errors.New("utilitybills: status must be 'resolved' or 'rejected'")
	// ErrInvalidReportType — an unknown report name reached the service.
	ErrInvalidReportType = errors.New("utilitybills: unknown report type")
)

// ── Shared value validation (mirrors the tables' CHECK constraints) ──────────

// Status vocabularies, taken from the live schema's CHECK constraints rather
// than inferred. They differ per table, which is exactly why they are separate
// lists: utility_providers permits 'maintenance', the other four do not.
var (
	providerStatuses   = []string{"active", "disabled", "maintenance"}
	catalogueStatuses  = []string{"active", "disabled"}
	healthStatuses     = []string{"healthy", "degraded", "down", "unknown"}
	disputeResolutions = []string{"resolved", "rejected"}
	amountTypes        = []string{string(AmountTypeFixed), string(AmountTypeVariable)}
)

func oneOf(value string, allowed []string) bool {
	for _, a := range allowed {
		if value == a {
			return true
		}
	}
	return false
}

// validateStatus accepts a blank value (meaning "leave at the DB default" on a
// create, or "not being changed" on a patch) and rejects anything else outside
// the allow-list, so a typo cannot reach the database and come back as a 500.
func validateStatus(value string, allowed []string, sentinel error) error {
	if value == "" || oneOf(value, allowed) {
		return nil
	}
	return fmt.Errorf("%w: %q (expected one of %s)", sentinel, value, strings.Join(allowed, ", "))
}

// validatePositiveKobo enforces the `IS NULL OR > 0` CHECK constraints that
// guard every nullable kobo column in this schema.
func validatePositiveKobo(value *int64, field string) error {
	if value == nil {
		return nil
	}
	if *value <= 0 {
		return fmt.Errorf("%w: %s must be a positive integer (kobo)", ErrInvalidAmount, field)
	}
	return nil
}

// validateNonNegative enforces the `>= 0` CHECK constraints on fees and basis
// points. A negative markup is not a discount — it is a silent loss per sale.
func validateNonNegative(value *int64, field string) error {
	if value == nil {
		return nil
	}
	if *value < 0 {
		return fmt.Errorf("%w: %s must not be negative", ErrInvalidAmount, field)
	}
	return nil
}

// ── Providers ────────────────────────────────────────────────────────────────

// AdminListProviders returns every provider, any status, without credentials.
func (s *Service) AdminListProviders(ctx context.Context, limit, offset int) ([]AdminProviderView, error) {
	return s.repo.AdminListProviders(ctx, limit, offset)
}

// CreateProvider validates and inserts a provider, then records an audit row.
func (s *Service) CreateProvider(ctx context.Context, actorUserID string, in ProviderInput) (*AdminProviderView, error) {
	var err error
	if in.Name, err = requireField(in.Name, "name"); err != nil {
		return nil, err
	}
	if in.Code, err = requireField(in.Code, "code"); err != nil {
		return nil, err
	}
	if in.AdapterCode, err = requireField(in.AdapterCode, "adapter_code"); err != nil {
		return nil, err
	}
	if err := validateStatus(in.Status, providerStatuses, ErrInvalidStatus); err != nil {
		return nil, err
	}
	if err := validateStatus(in.HealthStatus, healthStatuses, ErrInvalidHealthStatus); err != nil {
		return nil, err
	}
	if err := validateCategoryList(in.SupportedCategories); err != nil {
		return nil, err
	}

	created, err := s.repo.CreateProvider(ctx, in)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionProviderCreate, resourceProvider, created.ID, nil, providerAudit(created))
	return created, nil
}

// UpdateProvider validates and applies a partial provider patch.
//
// oldValues for the audit row is read BEFORE the write. That extra SELECT is the
// price of an audit trail that can answer "what did this used to be?" — the
// question every configuration incident actually asks.
func (s *Service) UpdateProvider(ctx context.Context, actorUserID, id string, patch ProviderPatch) (*AdminProviderView, error) {
	if patch.Status != nil {
		if err := validateStatus(*patch.Status, providerStatuses, ErrInvalidStatus); err != nil {
			return nil, err
		}
	}
	if patch.HealthStatus != nil {
		if err := validateStatus(*patch.HealthStatus, healthStatuses, ErrInvalidHealthStatus); err != nil {
			return nil, err
		}
	}
	if patch.SupportedCategories != nil {
		if err := validateCategoryList(*patch.SupportedCategories); err != nil {
			return nil, err
		}
	}
	if err := requireNonBlank(patch.Name, "name", patch.Code, "code", patch.AdapterCode, "adapter_code"); err != nil {
		return nil, err
	}

	before, err := s.repo.AdminGetProvider(ctx, id)
	if err != nil {
		return nil, err
	}
	updated, err := s.repo.UpdateProvider(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionProviderUpdate, resourceProvider, id, providerAudit(before), providerAudit(updated))
	return updated, nil
}

// providerAudit renders a provider for the audit trail. Credentials are NOT
// included in any form — not the ciphertext, not the envelope, not the key id.
// Only whether one is configured, which is the fact an auditor needs.
func providerAudit(p *AdminProviderView) map[string]any {
	if p == nil {
		return nil
	}
	return map[string]any{
		"name":                   p.Name,
		"code":                   p.Code,
		"adapter_code":           p.AdapterCode,
		"status":                 p.Status,
		"supported_categories":   p.SupportedCategories,
		"priority":               p.Priority,
		"health_status":          p.HealthStatus,
		"credentials_configured": p.CredentialsConfigured,
	}
}

// validateCategoryList checks every entry against the six-value vocabulary,
// reusing ParseCategory so this surface cannot drift from the purchase path's.
func validateCategoryList(categories []string) error {
	for _, c := range categories {
		if _, err := ParseCategory(c); err != nil {
			return fmt.Errorf("supported_categories: %w", err)
		}
	}
	return nil
}

// requireNonBlank rejects a patch that explicitly sets a NOT NULL text column to
// whitespace. Without it, `{"name": "  "}` would pass (non-nil pointer, no CHECK
// constraint on emptiness) and leave an unnameable row in the admin console.
// Takes (pointer, field) pairs.
func requireNonBlank(pairs ...any) error {
	for i := 0; i+1 < len(pairs); i += 2 {
		ptr, _ := pairs[i].(*string)
		name, _ := pairs[i+1].(string)
		if ptr == nil {
			continue
		}
		trimmed := strings.TrimSpace(*ptr)
		if trimmed == "" {
			return fmt.Errorf("%w: %s", ErrFieldRequired, name)
		}
		*ptr = trimmed
	}
	return nil
}

// RotateProviderCredentials encrypts and stores a new credentials set.
//
// The plaintext map reaches exactly two places: EncryptCredentials, and the
// garbage collector. It is never logged, never audited, never returned, and
// never written to the database unencrypted — the repository method below it
// accepts only a sealed envelope, so there is no code path that could.
func (s *Service) RotateProviderCredentials(ctx context.Context, actorUserID, id string, credentials map[string]any) (*AdminProviderView, error) {
	if len(credentials) == 0 {
		return nil, ErrCredentialsRequired
	}
	if len(s.credentialsKey) == 0 {
		// The key is resolved once at wiring time. Absent, this MUST fail rather
		// than fall back to storing plaintext.
		return nil, ErrCredentialsKeyMissing
	}
	// Resolve the provider first so a rotation against a non-existent id is a
	// clean 404 rather than an encrypt-then-discard.
	if _, err := s.repo.AdminGetProvider(ctx, id); err != nil {
		return nil, err
	}

	envelope, err := EncryptCredentials(s.credentialsKey, credentials)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: marshal credentials envelope: %w", err)
	}

	updated, err := s.repo.SetProviderCredentials(ctx, id, encoded)
	if err != nil {
		return nil, err
	}
	// The audit row records THAT a rotation happened and which keys were set —
	// the key NAMES only, never the values. Knowing an api_key was rotated is
	// the auditable fact; knowing its value would make the audit log a secret
	// store.
	s.log(actorUserID, actionProviderCredsRotate, resourceProvider, id,
		map[string]any{"credentials_configured": false},
		map[string]any{"credentials_configured": true, "fields": credentialFieldNames(credentials)})
	return updated, nil
}

// credentialFieldNames returns the KEY names of a credentials map, sorted, for
// the audit row. Values are never touched.
func credentialFieldNames(credentials map[string]any) []string {
	names := make([]string, 0, len(credentials))
	for k := range credentials {
		names = append(names, k)
	}
	sort.Strings(names)
	return names
}

// HealthCheckProvider asks the provider's adapter for its live health and
// persists the answer. Ports adminHealthCheckProvider.
//
// Returns the RESULT alongside the updated row. A 'down' result is a successful
// health check that found a down provider — not an error — so it is reported as
// 200 with status 'down', exactly as the TS source did.
func (s *Service) HealthCheckProvider(ctx context.Context, actorUserID, id string) (*provider.HealthCheckResult, *AdminProviderView, error) {
	// GetProvider (not AdminGetProvider) because the timeout override lives in
	// the config JSONB, which the admin projection deliberately omits.
	row, err := s.repo.GetProvider(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	checker, ok := s.providers.HealthChecker(row.AdapterCode)
	if !ok {
		// Two distinct causes, one error: no adapter registered for this
		// adapter_code at all, or an adapter that does not implement the optional
		// capability. Neither is something an admin can fix by retrying, and both
		// mean the same thing to the caller — nothing checked this provider.
		return nil, nil, fmt.Errorf("%w: adapter %q", ErrHealthCheckUnsupported, row.AdapterCode)
	}

	timeoutMs := row.TimeoutMs(s.timeoutMs)
	callCtx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	result, cerr := checker.HealthCheck(callCtx)
	cancel()
	if cerr != nil {
		// Per the HealthChecker contract an adapter should fold a bad answer into
		// a 'down' RESULT rather than an error, so reaching here means the adapter
		// could not ask at all. Record that as 'down' — which is true, and is what
		// the TS catch block did — instead of failing the request and leaving the
		// stored health_status stale.
		result = &provider.HealthCheckResult{Status: string(HealthDown), Message: cerr.Error()}
	}
	if result == nil || !oneOf(result.Status, healthStatuses) {
		// An adapter returning something outside the CHECK constraint would
		// otherwise fail at the UPDATE with an opaque constraint error. 'unknown'
		// is the honest value for "the adapter answered, unintelligibly".
		bad := "<nil>"
		if result != nil {
			bad = result.Status
		}
		result = &provider.HealthCheckResult{
			Status:  string(HealthUnknown),
			Message: fmt.Sprintf("adapter %q returned an unrecognised health status %q", row.AdapterCode, bad),
		}
	}

	updated, err := s.repo.SetProviderHealth(ctx, id, result.Status)
	if err != nil {
		return nil, nil, err
	}
	s.log(actorUserID, actionProviderHealthCheck, resourceProvider, id,
		map[string]any{"health_status": row.HealthStatus},
		map[string]any{"health_status": result.Status, "message": result.Message})
	return result, updated, nil
}

// ── Billers ──────────────────────────────────────────────────────────────────

// AdminListBillers returns every biller, any status.
func (s *Service) AdminListBillers(ctx context.Context, limit, offset int) ([]BillerRow, error) {
	return s.repo.AdminListBillers(ctx, limit, offset)
}

// CreateBiller validates and inserts a biller.
func (s *Service) CreateBiller(ctx context.Context, actorUserID string, in BillerInput) (*BillerRow, error) {
	cat, err := ParseCategory(in.Category)
	if err != nil {
		return nil, err
	}
	in.Category = string(cat)
	if in.Name, err = requireField(in.Name, "name"); err != nil {
		return nil, err
	}
	if in.Code, err = requireField(in.Code, "code"); err != nil {
		return nil, err
	}
	if err := validateStatus(in.Status, catalogueStatuses, ErrInvalidStatus); err != nil {
		return nil, err
	}

	created, err := s.repo.CreateBiller(ctx, in)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionBillerCreate, resourceBiller, created.ID, nil, billerAudit(created))
	return created, nil
}

// UpdateBiller validates and applies a partial biller patch.
func (s *Service) UpdateBiller(ctx context.Context, actorUserID, id string, patch BillerPatch) (*BillerRow, error) {
	if patch.Category != nil {
		cat, err := ParseCategory(*patch.Category)
		if err != nil {
			return nil, err
		}
		patch.Category = strPtr(string(cat))
	}
	if patch.Status != nil {
		if err := validateStatus(*patch.Status, catalogueStatuses, ErrInvalidStatus); err != nil {
			return nil, err
		}
	}
	if err := requireNonBlank(patch.Name, "name", patch.Code, "code",
		patch.Country, "country", patch.CustomerReferenceLabel, "customer_reference_label"); err != nil {
		return nil, err
	}

	before, err := s.repo.GetBiller(ctx, id)
	if err != nil {
		return nil, err
	}
	updated, err := s.repo.UpdateBiller(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionBillerUpdate, resourceBiller, id, billerAudit(before), billerAudit(updated))
	return updated, nil
}

func billerAudit(b *BillerRow) map[string]any {
	if b == nil {
		return nil
	}
	return map[string]any{
		"category": b.Category, "name": b.Name, "code": b.Code, "country": b.Country,
		"status": b.Status, "requires_validation": b.RequiresValidation,
		"customer_reference_label": b.CustomerReferenceLabel,
	}
}

// ── Products ─────────────────────────────────────────────────────────────────

// AdminListProducts returns every product, any status.
func (s *Service) AdminListProducts(ctx context.Context, limit, offset int) ([]ProductRow, error) {
	return s.repo.AdminListProducts(ctx, limit, offset)
}

// validateProductInput enforces the utility_products CHECK constraints ahead of
// the insert. Shared by create and import so a bulk import cannot smuggle in a
// row that a single create would have rejected.
//
// NOT enforced here, deliberately: "a fixed-price product must have an
// amount_kobo". The database does not require it, the TS source did not check
// it, and pricing.go already refuses such a product at purchase time with
// ErrAmountRequired. Adding the rule here would be a real improvement but also a
// behaviour change that could reject catalogue rows an existing import script
// writes — flagged for a follow-up rather than slipped in under a port.
func validateProductInput(in *ProductInput) error {
	cat, err := ParseCategory(in.Category)
	if err != nil {
		return err
	}
	in.Category = string(cat)
	if in.BillerID, err = requireField(in.BillerID, "biller_id"); err != nil {
		return err
	}
	if in.Name, err = requireField(in.Name, "name"); err != nil {
		return err
	}
	if in.Code, err = requireField(in.Code, "code"); err != nil {
		return err
	}
	if in.AmountType != "" && !oneOf(in.AmountType, amountTypes) {
		return fmt.Errorf("%w: %q", ErrInvalidAmountType, in.AmountType)
	}
	if err := validateStatus(in.Status, catalogueStatuses, ErrInvalidStatus); err != nil {
		return err
	}
	if err := validatePositiveKobo(in.AmountKobo, "amount_kobo"); err != nil {
		return err
	}
	if err := validatePositiveKobo(in.MinAmountKobo, "min_amount_kobo"); err != nil {
		return err
	}
	if err := validatePositiveKobo(in.MaxAmountKobo, "max_amount_kobo"); err != nil {
		return err
	}
	if err := validateNonNegative(in.ConvenienceFeeKobo, "convenience_fee_kobo"); err != nil {
		return err
	}
	if err := validateNonNegative(in.MarkupBps, "markup_bps"); err != nil {
		return err
	}
	if err := validateNonNegative(in.ProviderDiscountBps, "provider_discount_bps"); err != nil {
		return err
	}
	// A min above a max makes the product unbuyable at every amount. The database
	// has no cross-column constraint for it, and pricing.go would reject each
	// purchase individually with a confusing message.
	if in.MinAmountKobo != nil && in.MaxAmountKobo != nil && *in.MinAmountKobo > *in.MaxAmountKobo {
		return fmt.Errorf("%w: min_amount_kobo exceeds max_amount_kobo", ErrInvalidAmount)
	}
	return nil
}

// CreateProduct validates and inserts a product.
func (s *Service) CreateProduct(ctx context.Context, actorUserID string, in ProductInput) (*ProductRow, error) {
	if err := validateProductInput(&in); err != nil {
		return nil, err
	}
	created, err := s.repo.CreateProduct(ctx, in)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionProductCreate, resourceProduct, created.ID, nil, productAudit(created))
	return created, nil
}

// UpdateProduct validates and applies a partial product patch.
func (s *Service) UpdateProduct(ctx context.Context, actorUserID, id string, patch ProductPatch) (*ProductRow, error) {
	if patch.Category != nil {
		cat, err := ParseCategory(*patch.Category)
		if err != nil {
			return nil, err
		}
		patch.Category = strPtr(string(cat))
	}
	if patch.AmountType != nil && !oneOf(*patch.AmountType, amountTypes) {
		return nil, fmt.Errorf("%w: %q", ErrInvalidAmountType, *patch.AmountType)
	}
	if patch.Status != nil {
		if err := validateStatus(*patch.Status, catalogueStatuses, ErrInvalidStatus); err != nil {
			return nil, err
		}
	}
	if err := requireNonBlank(patch.Name, "name", patch.Code, "code", patch.BillerID, "biller_id"); err != nil {
		return nil, err
	}
	for _, c := range []struct {
		v    *int64
		name string
	}{
		{patch.AmountKobo, "amount_kobo"},
		{patch.MinAmountKobo, "min_amount_kobo"},
		{patch.MaxAmountKobo, "max_amount_kobo"},
	} {
		if err := validatePositiveKobo(c.v, c.name); err != nil {
			return nil, err
		}
	}
	for _, c := range []struct {
		v    *int64
		name string
	}{
		{patch.ConvenienceFeeKobo, "convenience_fee_kobo"},
		{patch.MarkupBps, "markup_bps"},
		{patch.ProviderDiscountBps, "provider_discount_bps"},
	} {
		if err := validateNonNegative(c.v, c.name); err != nil {
			return nil, err
		}
	}

	before, err := s.repo.GetProduct(ctx, id)
	if err != nil {
		return nil, err
	}
	// Cross-column check against the POST-patch shape, so patching only the
	// minimum cannot push it past an untouched maximum.
	if err := validateProductBounds(before, patch); err != nil {
		return nil, err
	}
	updated, err := s.repo.UpdateProduct(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionProductUpdate, resourceProduct, id, productAudit(before), productAudit(updated))
	return updated, nil
}

// validateProductBounds resolves min/max as the patch would leave them and
// rejects an inverted pair.
func validateProductBounds(before *ProductRow, patch ProductPatch) error {
	min, max := before.MinAmountKobo, before.MaxAmountKobo
	if patch.ClearMinAmountKobo {
		min = nil
	} else if patch.MinAmountKobo != nil {
		min = patch.MinAmountKobo
	}
	if patch.ClearMaxAmountKobo {
		max = nil
	} else if patch.MaxAmountKobo != nil {
		max = patch.MaxAmountKobo
	}
	if min != nil && max != nil && *min > *max {
		return fmt.Errorf("%w: min_amount_kobo exceeds max_amount_kobo", ErrInvalidAmount)
	}
	return nil
}

func productAudit(p *ProductRow) map[string]any {
	if p == nil {
		return nil
	}
	return map[string]any{
		"biller_id": p.BillerID, "category": p.Category, "name": p.Name, "code": p.Code,
		"amount_type": p.AmountType, "amount_kobo": p.AmountKobo,
		"min_amount_kobo": p.MinAmountKobo, "max_amount_kobo": p.MaxAmountKobo,
		"convenience_fee_kobo": p.ConvenienceFeeKobo, "markup_bps": p.MarkupBps,
		"provider_discount_bps": p.ProviderDiscountBps, "status": p.Status,
	}
}

// ImportProducts bulk-upserts a catalogue batch keyed on product code.
//
// Every row is validated BEFORE any row is written, so a batch with one bad
// entry writes nothing at all rather than half a catalogue. (The repository also
// wraps the writes in a transaction, which covers the database-side failures
// this validation cannot predict.)
func (s *Service) ImportProducts(ctx context.Context, actorUserID string, products []ProductInput) ([]ProductRow, error) {
	if len(products) == 0 {
		return nil, ErrEmptyImport
	}
	for i := range products {
		if err := validateProductInput(&products[i]); err != nil {
			return nil, fmt.Errorf("products[%d]: %w", i, err)
		}
	}
	imported, err := s.repo.ImportProducts(ctx, products)
	if err != nil {
		return nil, err
	}
	// The audit row carries the count and the codes, not the full rows: an import
	// of 500 products should leave a readable audit entry, and the codes are
	// enough to find every row it touched.
	codes := make([]string, 0, len(imported))
	for _, p := range imported {
		codes = append(codes, p.Code)
	}
	s.log(actorUserID, actionProductImport, resourceProduct, "",
		nil, map[string]any{"count": len(imported), "codes": codes})
	return imported, nil
}

// ── Provider/product mappings ────────────────────────────────────────────────

// AdminListMappings returns every provider/product mapping, any status.
func (s *Service) AdminListMappings(ctx context.Context, limit, offset int) ([]MappingRow, error) {
	return s.repo.AdminListMappings(ctx, limit, offset)
}

// CreateMapping validates and inserts a provider/product mapping.
func (s *Service) CreateMapping(ctx context.Context, actorUserID string, in MappingInput) (*MappingRow, error) {
	var err error
	if in.ProviderID, err = requireField(in.ProviderID, "provider_id"); err != nil {
		return nil, err
	}
	if in.ProductID, err = requireField(in.ProductID, "product_id"); err != nil {
		return nil, err
	}
	if in.ProviderProductCode, err = requireField(in.ProviderProductCode, "provider_product_code"); err != nil {
		return nil, err
	}
	if err := validateStatus(in.Status, catalogueStatuses, ErrInvalidStatus); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(in.ProviderCostKobo, "provider_cost_kobo"); err != nil {
		return nil, err
	}
	if err := validateNonNegative(in.ProviderDiscountBps, "provider_discount_bps"); err != nil {
		return nil, err
	}

	created, err := s.repo.CreateMapping(ctx, in)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionMappingCreate, resourceProviderMapping, created.ID, nil, mappingAudit(created))
	return created, nil
}

// UpdateMapping validates and applies a partial mapping patch.
func (s *Service) UpdateMapping(ctx context.Context, actorUserID, id string, patch MappingPatch) (*MappingRow, error) {
	if patch.Status != nil {
		if err := validateStatus(*patch.Status, catalogueStatuses, ErrInvalidStatus); err != nil {
			return nil, err
		}
	}
	if err := requireNonBlank(patch.ProviderID, "provider_id", patch.ProductID, "product_id",
		patch.ProviderProductCode, "provider_product_code"); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(patch.ProviderCostKobo, "provider_cost_kobo"); err != nil {
		return nil, err
	}
	if err := validateNonNegative(patch.ProviderDiscountBps, "provider_discount_bps"); err != nil {
		return nil, err
	}

	before, err := s.repo.GetMapping(ctx, id)
	if err != nil {
		return nil, err
	}
	updated, err := s.repo.UpdateMapping(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionMappingUpdate, resourceProviderMapping, id, mappingAudit(before), mappingAudit(updated))
	return updated, nil
}

func mappingAudit(m *MappingRow) map[string]any {
	if m == nil {
		return nil
	}
	return map[string]any{
		"provider_id": m.ProviderID, "product_id": m.ProductID,
		"provider_product_code": m.ProviderProductCode, "provider_biller_code": m.ProviderBillerCode,
		"provider_cost_kobo": m.ProviderCostKobo, "provider_discount_bps": m.ProviderDiscountBps,
		"status": m.Status,
	}
}

// ── Routing rules ────────────────────────────────────────────────────────────

// AdminListRoutingRules returns every routing rule, any status.
func (s *Service) AdminListRoutingRules(ctx context.Context, limit, offset int) ([]RoutingRuleRow, error) {
	return s.repo.AdminListRoutingRules(ctx, limit, offset)
}

// CreateRoutingRule validates and inserts a routing rule.
func (s *Service) CreateRoutingRule(ctx context.Context, actorUserID string, in RoutingRuleInput) (*RoutingRuleRow, error) {
	var err error
	if in.ProviderID, err = requireField(in.ProviderID, "provider_id"); err != nil {
		return nil, err
	}
	// category is NULLABLE here (a rule scoped to no category applies to all), so
	// a blank value is valid and only a non-blank one is checked.
	if strings.TrimSpace(in.Category) != "" {
		cat, cerr := ParseCategory(strings.TrimSpace(in.Category))
		if cerr != nil {
			return nil, cerr
		}
		in.Category = string(cat)
	} else {
		in.Category = ""
	}
	if err := validateStatus(in.Status, catalogueStatuses, ErrInvalidStatus); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(in.MinAmountKobo, "min_amount_kobo"); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(in.MaxAmountKobo, "max_amount_kobo"); err != nil {
		return nil, err
	}
	if in.MinAmountKobo != nil && in.MaxAmountKobo != nil && *in.MinAmountKobo > *in.MaxAmountKobo {
		return nil, fmt.Errorf("%w: min_amount_kobo exceeds max_amount_kobo", ErrInvalidAmount)
	}

	created, err := s.repo.CreateRoutingRule(ctx, in)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionRoutingRuleCreate, resourceRoutingRule, created.ID, nil, routingRuleAudit(created))
	return created, nil
}

// UpdateRoutingRule validates and applies a partial routing-rule patch.
func (s *Service) UpdateRoutingRule(ctx context.Context, actorUserID, id string, patch RoutingRulePatch) (*RoutingRuleRow, error) {
	if patch.Category != nil {
		cat, err := ParseCategory(*patch.Category)
		if err != nil {
			return nil, err
		}
		patch.Category = strPtr(string(cat))
	}
	if patch.Status != nil {
		if err := validateStatus(*patch.Status, catalogueStatuses, ErrInvalidStatus); err != nil {
			return nil, err
		}
	}
	if err := requireNonBlank(patch.ProviderID, "provider_id"); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(patch.MinAmountKobo, "min_amount_kobo"); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(patch.MaxAmountKobo, "max_amount_kobo"); err != nil {
		return nil, err
	}

	before, err := s.repo.GetRoutingRule(ctx, id)
	if err != nil {
		return nil, err
	}
	updated, err := s.repo.UpdateRoutingRule(ctx, id, patch)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionRoutingRuleUpdate, resourceRoutingRule, id, routingRuleAudit(before), routingRuleAudit(updated))
	return updated, nil
}

func routingRuleAudit(rr *RoutingRuleRow) map[string]any {
	if rr == nil {
		return nil
	}
	return map[string]any{
		"category": rr.Category, "biller_id": rr.BillerID, "product_id": rr.ProductID,
		"provider_id": rr.ProviderID, "priority": rr.Priority,
		"min_amount_kobo": rr.MinAmountKobo, "max_amount_kobo": rr.MaxAmountKobo,
		"status": rr.Status,
	}
}

// ── Category settings ────────────────────────────────────────────────────────

// AdminListCategorySettings returns every category setting, enabled or not.
func (s *Service) AdminListCategorySettings(ctx context.Context) ([]CategorySettingRow, error) {
	return s.repo.AdminListCategorySettings(ctx)
}

// CreateCategorySetting validates and inserts a category setting.
func (s *Service) CreateCategorySetting(ctx context.Context, actorUserID string, in CategorySettingInput) (*CategorySettingRow, error) {
	cat, err := ParseCategory(in.Category)
	if err != nil {
		return nil, err
	}
	in.Category = string(cat)
	if err := validatePositiveKobo(in.DailyLimitKobo, "daily_limit_kobo"); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(in.MinAmountKobo, "min_amount_kobo"); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(in.MaxAmountKobo, "max_amount_kobo"); err != nil {
		return nil, err
	}
	if in.MinAmountKobo != nil && in.MaxAmountKobo != nil && *in.MinAmountKobo > *in.MaxAmountKobo {
		return nil, fmt.Errorf("%w: min_amount_kobo exceeds max_amount_kobo", ErrInvalidAmount)
	}

	created, err := s.repo.CreateCategorySetting(ctx, in)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionCategoryCreate, resourceCategorySetting, created.Category, nil, categoryAudit(created))
	return created, nil
}

// UpdateCategorySetting validates and applies a partial patch, keyed on the
// category text column rather than a uuid.
//
// This is the switch that can take a whole vertical offline (enabled = false
// feeds assertCategoryAvailableForPayment), which is why it is audited with both
// the old and new value rather than just the new one.
func (s *Service) UpdateCategorySetting(ctx context.Context, actorUserID, category string, patch CategorySettingPatch) (*CategorySettingRow, error) {
	cat, err := ParseCategory(category)
	if err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(patch.DailyLimitKobo, "daily_limit_kobo"); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(patch.MinAmountKobo, "min_amount_kobo"); err != nil {
		return nil, err
	}
	if err := validatePositiveKobo(patch.MaxAmountKobo, "max_amount_kobo"); err != nil {
		return nil, err
	}

	before, err := s.repo.GetCategorySetting(ctx, string(cat))
	if err != nil {
		return nil, err
	}
	if before == nil {
		return nil, fmt.Errorf("%w: utility category setting %s", ErrNotFound, cat)
	}
	updated, err := s.repo.UpdateCategorySetting(ctx, string(cat), patch)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionCategoryUpdate, resourceCategorySetting, string(cat),
		categoryAudit(before), categoryAudit(updated))
	return updated, nil
}

func categoryAudit(c *CategorySettingRow) map[string]any {
	if c == nil {
		return nil
	}
	return map[string]any{
		"category": c.Category, "enabled": c.Enabled,
		"availability_message": c.AvailabilityMessage, "daily_limit_kobo": c.DailyLimitKobo,
		"min_amount_kobo": c.MinAmountKobo, "max_amount_kobo": c.MaxAmountKobo,
	}
}

// ── Transactions / disputes / sweep ──────────────────────────────────────────

// AdminListTransactions returns transactions across all members.
//
// An unrecognised status filter is a 400 rather than an empty list: a typo'd
// filter returning "no transactions" reads exactly like a healthy system with
// nothing wrong in it, which is the worst possible answer for a support tool.
func (s *Service) AdminListTransactions(ctx context.Context, status string, limit, offset int) ([]TransactionRow, error) {
	if status != "" && !oneOf(status, allTransactionStatuses) {
		return nil, fmt.Errorf("%w: %q is not a utility transaction status", ErrInvalidStatus, status)
	}
	return s.repo.AdminListTransactions(ctx, status, limit, offset)
}

// allTransactionStatuses is the seven-value lifecycle vocabulary from model.go,
// used to reject a filter value that could only ever return an empty list.
var allTransactionStatuses = []string{
	string(StatusInitiated), string(StatusWalletDebited), string(StatusProviderPending),
	string(StatusSuccessful), string(StatusFailed), string(StatusReversed), string(StatusDisputed),
}

// ResolveDispute closes the dispute attached to a transaction. Ports
// adminResolveUtilityDispute.
//
// ── WHAT THIS DOES NOT DO, AND WHY ──────────────────────────────────────────
// It does NOT change utility_transactions.status. The TS source does not either:
// adminResolveUtilityDispute updates utility_disputes, appends the
// 'dispute_resolved' event, and notifies the customer — the transaction row is
// only re-READ (to address the notification) and never written.
//
// So a transaction moved to 'disputed' by CreateDispute stays 'disputed' after
// resolution. That is very likely a real gap, but the correct destination is not
// derivable: a dispute resolved in the member's favour usually implies a
// separate reversal (which sets 'reversed' itself), while a rejected one should
// presumably return to 'successful' — and guessing wrong would rewrite the
// status of settled money. Ported faithfully and raised for a product decision
// rather than invented here.
func (s *Service) ResolveDispute(ctx context.Context, actorUserID, transactionID, status, resolutionNote string) (*DisputeRow, error) {
	if !oneOf(status, disputeResolutions) {
		return nil, fmt.Errorf("%w: %q", ErrInvalidDisputeStatus, status)
	}
	resolutionNote, err := requireField(resolutionNote, "resolution_note")
	if err != nil {
		return nil, err
	}
	// Resolve the transaction first so a bad id is a 404 rather than a confusing
	// "no dispute for transaction" on a transaction that never existed.
	t, err := s.repo.GetTransaction(ctx, transactionID)
	if err != nil {
		return nil, err
	}

	dispute, err := s.repo.UpdateDisputeByTransaction(ctx, t.ID, status, resolutionNote)
	if err != nil {
		return nil, err
	}
	// Matches the TS source's addEvent(transactionId, 'dispute_resolved',
	// resolutionNote, { status }) exactly — same event type, same message, same
	// payload key — so the member-visible event trail reads identically either
	// side of the migration.
	s.event(ctx, t.ID, "dispute_resolved", resolutionNote, map[string]any{"status": status})
	s.log(actorUserID, actionDisputeResolve, resourceDispute, dispute.ID,
		map[string]any{"status": "open"},
		map[string]any{
			"status":          dispute.Status,
			"resolution_note": resolutionNote,
			"transaction_id":  t.ID,
		})
	return dispute, nil
}

// TriggerSweep runs the pending-requery sweep on an admin's explicit request.
//
// A thin wrapper over the Phase 3 SweepPending — the sweep logic itself is NOT
// duplicated here; there is exactly one implementation, shared with the hourly
// job. The only thing this adds is the audit row, which is precisely what
// distinguishes a manual trigger from the scheduled run (jobs.go calls
// SweepPending directly and stays audit-silent: the clock is not an actor).
func (s *Service) TriggerSweep(ctx context.Context, actorUserID string, limit int) (*SweepResult, error) {
	res, err := s.SweepPending(ctx, limit)
	if err != nil {
		return nil, err
	}
	s.log(actorUserID, actionSweepTrigger, resourceTransaction, "", nil, map[string]any{
		"limit":     limit,
		"processed": res.Processed,
		"succeeded": res.Succeeded,
		"failed":    res.Failed,
	})
	return res, nil
}

// ── Reports ──────────────────────────────────────────────────────────────────

// Report type names, as they appear in the route paths.
const (
	ReportProfitability       = "profitability"
	ReportProviderPerformance = "provider-performance"
	ReportReconciliation      = "reconciliation"
)

// ProfitabilityReport returns the whole-table profit summary.
func (s *Service) ProfitabilityReport(ctx context.Context) (*ProfitabilityReport, error) {
	return s.repo.ProfitabilityReport(ctx)
}

// ProviderPerformanceReport returns per-provider attempt statistics.
func (s *Service) ProviderPerformanceReport(ctx context.Context) ([]ProviderPerformanceRow, error) {
	return s.repo.ProviderPerformanceReport(ctx)
}

// ReconciliationReport returns the reconciliation row listing.
func (s *Service) ReconciliationReport(ctx context.Context) ([]ReconciliationRow, error) {
	return s.repo.ReconciliationReport(ctx)
}
