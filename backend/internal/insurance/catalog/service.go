package catalog

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/insurance/gateway"
)

// Product is the normalised catalog row. The catalog is the SINGLE source of
// truth for product → provider routing AND for the per-product provider route,
// pricing model and form schema: no product is hard-coded in logic anywhere.
//
// MONEY: every *_kobo field is INTEGER MINOR UNITS. The naira→kobo conversion
// happens once, in the provider adapter, before a value ever reaches this
// struct. RateBps is basis points (0.5% = 50).
//
// Field names carry BOTH the historical admin shape (display_name, provider)
// and the member contract shape (name, aggregator) so the admin console keeps
// working while mobile codes to the published contract.
type Product struct {
	Code        string `json:"code"`
	DisplayName string `json:"display_name"`
	Name        string `json:"name"` // contract alias of display_name
	Description string `json:"description"`
	ProductLine string `json:"product_line"`
	Category    string `json:"category"`
	Provider    string `json:"provider"`   // aggregator key: mycover | octamile
	Aggregator  string `json:"aggregator"` // contract alias of provider

	ProviderProductCode string `json:"provider_product_code"`
	ProviderProductID   string `json:"provider_product_id,omitempty"`
	ProviderBuyPath     string `json:"provider_buy_path,omitempty"`
	BuyPathVerified     bool   `json:"buy_path_verified"`

	BindingMode        string `json:"binding_mode"` // direct | embedded
	UnderwriterDisplay string `json:"underwriter_display"`
	Underwriter        string `json:"underwriter"` // contract alias
	UnderwriterLogoURL string `json:"underwriter_logo_url,omitempty"`
	PremiumModel       string `json:"premium_model"`
	RequiredKYCTier    int    `json:"required_kyc_tier"`

	// --- Pricing, integer minor units ---
	IsPercentage          bool   `json:"is_percentage"`
	BasePriceKobo         int64  `json:"base_price_kobo"`
	RateBps               int64  `json:"rate_bps"`
	SumInsuredKobo        int64  `json:"sum_insured_kobo"`
	ProviderBasePriceRaw  string `json:"provider_base_price_raw,omitempty"`
	DistributorCommission int64  `json:"distributor_commission_bps"`
	MCACommissionBps      int64  `json:"mca_commission_bps"`
	ProviderCommissionBps int64  `json:"provider_commission_bps"`
	CommissionFrom        string `json:"commission_from,omitempty"`

	// --- Cover terms ---
	CoverPeriodDays   int    `json:"cover_period_days"`
	IsRenewable       bool   `json:"is_renewable"`
	IsClaimable       bool   `json:"is_claimable"`
	IsCertificateable bool   `json:"is_certificateable"`
	IsInspectable     bool   `json:"is_inspectable"`
	Currency          string `json:"currency"`

	// --- Provider copy (HTML — render SANITISED, it is third-party markup) ---
	KeyBenefitsHTML  string `json:"key_benefits_html,omitempty"`
	FullBenefitsHTML string `json:"full_benefits_html,omitempty"`
	HowItWorksHTML   string `json:"how_it_works_html,omitempty"`
	HowToClaimHTML   string `json:"how_to_claim_html,omitempty"`
	DocumentURL      string `json:"document_url,omitempty"`

	// --- Dynamic form ---
	FormSchema       map[string]any `json:"form_schema"`
	FormSchemaSource string         `json:"form_schema_source,omitempty"`

	// --- Sellability (provider capability, NOT operator choice) ---
	// Purchasable is whether the AGGREGATOR can actually sell this. It is
	// separate from Active, which is whether Paymax offers it. The dangerous
	// pairing the admin console must warn on is active && !purchasable: offered
	// here, unsellable there.
	Purchasable          bool   `json:"purchasable"`
	ProviderConfigStatus string `json:"provider_config_status"`
	ProviderConfigError  string `json:"provider_config_error,omitempty"`
	// ProviderMissing marks a row the provider stopped listing. Kept for audit
	// and for policies that reference it; never sellable.
	ProviderMissing   bool   `json:"provider_missing"`
	DeactivatedReason string `json:"deactivated_reason,omitempty"`
	// ActiveOverridden records that an ADMIN ruled on visibility, so the sync
	// leaves it alone.
	ActiveOverridden bool `json:"active_overridden"`

	RequiredFields  map[string]any `json:"required_fields_schema_ref"`
	SumInsuredRules map[string]any `json:"sum_insured_rules"`
	CancellationRef string         `json:"cancellation_policy_ref"`

	// Indicative "from" premium (kobo) + cadence for browse cards.
	IndicativePremiumKobo int64  `json:"indicative_premium_kobo"`
	PremiumCadence        string `json:"premium_cadence"`
	LastSyncedAt          string `json:"last_synced_at,omitempty"`
	Version               int    `json:"version"`
	Active                bool   `json:"active"`
}

// Service reads the versioned product catalog + routing table. All queries are
// parameterized.
type Service struct {
	db      *pgxpool.Pool
	options OptionsFetcher
}

// NewService constructs the catalog service over the pgx pool.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// OptionsFetcher fetches a schema field's remote option list from the provider.
// Narrow on purpose: catalog needs one call, not the whole adapter.
type OptionsFetcher interface {
	FetchUtilityOptions(ctx context.Context, optionsURL, query string) ([]FieldOption, error)
}

// FieldOption is one choice in a remote-options select, in the shape the client
// already reads.
type FieldOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// WithOptionsFetcher attaches the provider adapter used to fill remote-options
// fields. Without it FieldOptions reports the lookup as unavailable rather than
// pretending the list is empty — an empty picker and an unreachable one are
// different problems and the form should not conflate them.
func (s *Service) WithOptionsFetcher(f OptionsFetcher) *Service {
	s.options = f
	return s
}

// ErrOptionsUnavailable means the field exists but its options cannot be served.
var ErrOptionsUnavailable = errors.New("catalog: field options unavailable")

// ErrNoSuchField means the product has no such field, or it carries no remote
// option list.
var ErrNoSuchField = errors.New("catalog: unknown field or field has no remote options")

// FieldOptions serves the list behind a schema field's options_url.
//
// The client names a PRODUCT and a FIELD, never a URL: the URL is read from our
// own stored schema here. That is what keeps this from being an open proxy —
// see the pin in mycover.FetchUtilityOptions for the second half of it.
//
// `query` forwards a dependent list's parent value (a state's LGAs, say). It is
// passed through as an opaque string; the provider decides whether it matters.
func (s *Service) FieldOptions(ctx context.Context, productCode, fieldName, query string) ([]FieldOption, error) {
	if s.db == nil {
		return nil, fmt.Errorf("catalog: nil pool")
	}
	schema, _, err := s.FormSchema(ctx, productCode)
	if err != nil {
		return nil, err
	}
	url := optionsURLFor(schema, fieldName)
	if url == "" {
		return nil, ErrNoSuchField
	}
	if s.options == nil {
		return nil, ErrOptionsUnavailable
	}
	return s.options.FetchUtilityOptions(ctx, url, query)
}

// optionsURLFor finds a field by name and returns its options_url.
//
// Walks nested children too: ~65 products nest their fields under a
// `policy_holder` object and 17 have repeating groups, so a top-level-only scan
// would miss most of the form.
func optionsURLFor(schema map[string]any, fieldName string) string {
	fields, _ := schema["fields"].([]any)
	return findOptionsURL(fields, fieldName, 0)
}

func findOptionsURL(fields []any, fieldName string, depth int) string {
	// Bounded so a schema that somehow references itself cannot spin.
	if depth > 6 {
		return ""
	}
	for _, raw := range fields {
		f, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if name, _ := f["name"].(string); name == fieldName {
			if u, _ := f["options_url"].(string); strings.TrimSpace(u) != "" {
				return u
			}
			// Named match with no options_url: keep looking, since a nested field
			// may legitimately share the name.
		}
		if kids, ok := f["children"].([]any); ok {
			if u := findOptionsURL(kids, fieldName, depth+1); u != "" {
				return u
			}
		}
	}
	return ""
}

// ResolveProduct implements gateway.ProductResolver: maps a Paymax product_code
// to (aggregator, per-product routing descriptor). Only ACTIVE products resolve.
//
// The descriptor carries everything an adapter needs to reach the product — the
// buy path, the pricing model, the cover terms — straight off the catalog row.
// That is what keeps "add a product" a data change: nothing in the adapter or
// the router branches on which product this is.
func (s *Service) ResolveProduct(ctx context.Context, productCode string) (string, gateway.ProviderProduct, bool) {
	if s.db == nil {
		return "", gateway.ProviderProduct{}, false
	}
	var (
		provider    string
		pp          gateway.ProviderProduct
		buyPath     *string
		providerID  *string
		underwriter string
		schemaJSON  []byte
	)
	err := s.db.QueryRow(ctx, `
		SELECT provider, provider_product_code, provider_product_id, provider_buy_path,
		       is_percentage, base_price_kobo, rate_bps, default_sum_insured_kobo,
		       distributor_commission_bps, cover_period_days,
		       underwriter_display, is_renewable, is_claimable, is_certificateable,
		       (NOT purchasable OR provider_missing),
		       form_schema
		FROM public.insurance_products
		WHERE code = $1 AND active = true
		LIMIT 1`, productCode).Scan(
		&provider, &pp.Code, &providerID, &buyPath,
		&pp.IsPercentage, &pp.BasePriceKobo, &pp.RateBps, &pp.DefaultSumInsuredKobo,
		&pp.CommissionBps, &pp.CoverPeriodDays,
		&underwriter, &pp.IsRenewable, &pp.IsClaimable, &pp.IsCertificateable,
		&pp.NotPurchasable, &schemaJSON,
	)
	if err != nil {
		return "", gateway.ProviderProduct{}, false
	}
	pp.Underwriter = underwriter
	if providerID != nil {
		pp.ProviderProductID = *providerID
	}
	if buyPath != nil {
		pp.BuyPath = *buyPath
	}

	// MONEY-UNIT SEAM. The adapter has to know WHICH answers are monetary before
	// it can cross them into a provider that speaks a different unit, and the
	// only safe source for that is the very schema the client rendered the form
	// from. Deriving it from the same catalog row is what keeps the client's
	// scaling and the adapter's unscaling symmetric — see gateway/form_money.go.
	if schema := decodeStoredSchema(schemaJSON); schema != nil {
		gateway.NormalizeMoneyBounds(schema)
		pp.MoneyInputPaths = gateway.MoneyInputPaths(schema)
		pp.FormSchemaKnown = hasSchemaFields(schema)
	}
	return provider, pp, true
}

// decodeStoredSchema reads a stored form_schema jsonb.
//
// UseNumber is NOT optional here: a money bound decoded as float64 could not be
// scaled exactly, and float64 is banned from every money path.
func decodeStoredSchema(raw []byte) map[string]any {
	if len(raw) == 0 {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil || m == nil {
		return nil
	}
	return m
}

func hasSchemaFields(schema map[string]any) bool {
	fields, _ := schema["fields"].([]any)
	return len(fields) > 0
}

// Get returns a single active product by code.
func (s *Service) Get(ctx context.Context, productCode string) (*Product, error) {
	rows, err := s.list(ctx, listFilter{code: productCode, onlyActive: true})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("catalog: product %q not found", productCode)
	}
	return &rows[0], nil
}

// ListForMember returns active products visible to a member, filtered by the
// member's KYC tier (products requiring a higher tier are hidden) and an optional
// product_line "context". Direct-only here; embedded products are bound by events.
func (s *Service) ListForMember(ctx context.Context, kycTier int, line string) ([]Product, error) {
	return s.list(ctx, listFilter{
		onlyActive:   true,
		onlySellable: true,
		maxKYCTier:   &kycTier,
		line:         strings.ToLower(strings.TrimSpace(line)),
		bindingMode:  "direct",
	})
}

// ListAdmin returns ALL products (active + inactive) for admin tooling.
func (s *Service) ListAdmin(ctx context.Context) ([]Product, error) {
	return s.list(ctx, listFilter{})
}

type listFilter struct {
	code         string
	line         string
	bindingMode  string
	onlyActive   bool
	onlySellable bool
	maxKYCTier   *int
}

// selectColumns is shared by every read so a new column is added in ONE place.
const selectColumns = `
		code, display_name, COALESCE(description,''), product_line,
		COALESCE(provider_category,''), provider, provider_product_code,
		COALESCE(provider_product_id,''), COALESCE(provider_buy_path,''), buy_path_verified,
		binding_mode, underwriter_display, COALESCE(underwriter_logo_url,''),
		premium_model, required_kyc_tier,
		is_percentage, base_price_kobo, rate_bps, default_sum_insured_kobo,
		COALESCE(provider_base_price_raw,''),
		distributor_commission_bps, mca_commission_bps, provider_commission_bps,
		COALESCE(commission_from,''),
		cover_period_days, is_renewable, is_claimable, is_certificateable, is_inspectable,
		currency,
		COALESCE(key_benefits_html,''), COALESCE(full_benefits_html,''),
		COALESCE(how_it_works_html,''), COALESCE(how_to_claim_html,''),
		COALESCE(document_url,''),
		form_schema, COALESCE(form_schema_source,''),
		required_fields_schema_ref, sum_insured_rules, cancellation_policy_ref,
		indicative_premium_kobo, premium_cadence,
		COALESCE(to_char(last_synced_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),''),
		purchasable, provider_config_status, COALESCE(provider_config_error,''),
		provider_missing, COALESCE(deactivated_reason,''),
		(active_overridden_at IS NOT NULL),
		version, active`

func (s *Service) list(ctx context.Context, f listFilter) ([]Product, error) {
	if s.db == nil {
		return nil, fmt.Errorf("catalog: nil pool")
	}
	q := `SELECT ` + selectColumns + `
		FROM public.insurance_products
		WHERE 1=1`
	args := []any{}
	n := 0
	add := func(clause string, val any) {
		n++
		q += fmt.Sprintf(" AND %s$%d", clause, n)
		args = append(args, val)
	}
	if f.code != "" {
		add("code = ", f.code)
	}
	if f.line != "" {
		add("product_line = ", f.line)
	}
	if f.bindingMode != "" {
		add("binding_mode = ", f.bindingMode)
	}
	if f.onlyActive {
		q += " AND active = true"
	}
	if f.onlySellable {
		// Members never see cover the provider cannot issue, whatever `active`
		// says. This is belt-and-braces over the sync's own rule: two independent
		// guards, because showing a member a product that cannot be bought wastes
		// their time at best and takes their money at worst.
		q += " AND purchasable = true AND provider_missing = false"
	}
	if f.maxKYCTier != nil {
		add("required_kyc_tier <= ", *f.maxKYCTier)
	}
	q += " ORDER BY product_line, display_name"

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("catalog: list: %w", err)
	}
	defer rows.Close()

	var out []Product
	for rows.Next() {
		var p Product
		var formSchema, reqFields, sumRules []byte
		if err := rows.Scan(
			&p.Code, &p.DisplayName, &p.Description, &p.ProductLine,
			&p.Category, &p.Provider, &p.ProviderProductCode,
			&p.ProviderProductID, &p.ProviderBuyPath, &p.BuyPathVerified,
			&p.BindingMode, &p.UnderwriterDisplay, &p.UnderwriterLogoURL,
			&p.PremiumModel, &p.RequiredKYCTier,
			&p.IsPercentage, &p.BasePriceKobo, &p.RateBps, &p.SumInsuredKobo,
			&p.ProviderBasePriceRaw,
			&p.DistributorCommission, &p.MCACommissionBps, &p.ProviderCommissionBps,
			&p.CommissionFrom,
			&p.CoverPeriodDays, &p.IsRenewable, &p.IsClaimable, &p.IsCertificateable, &p.IsInspectable,
			&p.Currency,
			&p.KeyBenefitsHTML, &p.FullBenefitsHTML,
			&p.HowItWorksHTML, &p.HowToClaimHTML,
			&p.DocumentURL,
			&formSchema, &p.FormSchemaSource,
			&reqFields, &sumRules, &p.CancellationRef,
			&p.IndicativePremiumKobo, &p.PremiumCadence,
			&p.LastSyncedAt,
			&p.Purchasable, &p.ProviderConfigStatus, &p.ProviderConfigError,
			&p.ProviderMissing, &p.DeactivatedReason,
			&p.ActiveOverridden,
			&p.Version, &p.Active,
		); err != nil {
			return nil, fmt.Errorf("catalog: scan: %w", err)
		}
		p.FormSchema = decodeStoredSchema(formSchema)
		gateway.NormalizeMoneyBounds(p.FormSchema)
		_ = json.Unmarshal(reqFields, &p.RequiredFields)
		_ = json.Unmarshal(sumRules, &p.SumInsuredRules)
		if p.FormSchema == nil {
			p.FormSchema = map[string]any{}
		}
		// Contract aliases — one row, two vocabularies.
		p.Name = p.DisplayName
		p.Aggregator = p.Provider
		p.Underwriter = p.UnderwriterDisplay
		out = append(out, p)
	}
	return out, rows.Err()
}

// FormSchema returns just the dynamic form schema for a product, plus whether it
// has actually been discovered. ok=false means "no schema known yet" — the
// caller must say so rather than render an empty form that can never validate.
func (s *Service) FormSchema(ctx context.Context, productCode string) (map[string]any, bool, error) {
	if s.db == nil {
		return nil, false, fmt.Errorf("catalog: nil pool")
	}
	var raw []byte
	var source string
	err := s.db.QueryRow(ctx, `
		SELECT form_schema, COALESCE(form_schema_source,'')
		FROM public.insurance_products
		WHERE code = $1 AND active = true
		LIMIT 1`, productCode).Scan(&raw, &source)
	if err != nil {
		return nil, false, fmt.Errorf("catalog: product %q not found", productCode)
	}
	schema := decodeStoredSchema(raw)
	if schema == nil {
		return map[string]any{"fields": []any{}}, false, nil
	}
	// Publish money bounds in the unit the contract says they are in. Rows synced
	// before the sync learned to do this still carry the provider's naira
	// figures, and an unscaled bound makes a NGN 100,000 minimum bite at
	// NGN 1,000. The normaliser is idempotent, so a row that already carries
	// `unit` is left exactly as stored.
	gateway.NormalizeMoneyBounds(schema)
	fields, _ := schema["fields"].([]any)
	if len(fields) == 0 {
		if schema["fields"] == nil {
			schema["fields"] = []any{}
		}
		return schema, false, nil
	}
	schema["source"] = source
	return schema, true, nil
}

// SetActive flips a product's visibility (admin catalog management) and stamps
// active_overridden_at, which tells the sync a human has ruled and it should stop
// managing visibility for this product.
//
// It CANNOT activate a product the provider cannot sell. That guard is not
// negotiable by role: an unsellable product offered to members either wastes
// their time or takes their money for cover that will never be issued, and no
// admin has a legitimate reason to override the provider on that.
func (s *Service) SetActive(ctx context.Context, productCode string, active bool, byUserID string) error {
	if s.db == nil {
		return fmt.Errorf("catalog: nil pool")
	}
	var by any
	if byUserID != "" {
		by = byUserID
	}
	ct, err := s.db.Exec(ctx, `
		UPDATE public.insurance_products
		SET active = $2,
		    active_overridden_at = now(),
		    active_overridden_by = $3,
		    updated_at = now()
		WHERE code = $1
		  AND ($2 = false OR (purchasable AND NOT provider_missing))`,
		productCode, active, by)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("catalog: %q cannot be activated — the provider cannot sell it", productCode)
	}
	return nil
}

// ActivateAllPurchasable turns on every product the provider CAN sell, skipping
// any an admin has explicitly ruled on. It is the bulk counterpart to a sync's
// own default, for a catalog that was synced before visibility was sync-managed.
//
// It never activates an unsellable or provider-missing product.
func (s *Service) ActivateAllPurchasable(ctx context.Context, provider string) (int, error) {
	if s.db == nil {
		return 0, fmt.Errorf("catalog: nil pool")
	}
	ct, err := s.db.Exec(ctx, `
		UPDATE public.insurance_products
		SET active = true, updated_at = now()
		WHERE purchasable
		  AND NOT provider_missing
		  AND NOT active
		  AND active_overridden_at IS NULL
		  AND ($1 = '' OR provider = $1)`, provider)
	if err != nil {
		return 0, err
	}
	return int(ct.RowsAffected()), nil
}

// SetProvider re-routes a product to a different aggregator (routing edit, not a
// code change). The provider_product_code is updated atomically with it.
func (s *Service) SetProvider(ctx context.Context, productCode, provider, providerProductCode string) error {
	if s.db == nil {
		return fmt.Errorf("catalog: nil pool")
	}
	_, err := s.db.Exec(ctx, `
		UPDATE public.insurance_products
		SET provider = $2, provider_product_code = $3, version = version + 1, updated_at = now()
		WHERE code = $1`, productCode, provider, providerProductCode)
	return err
}
