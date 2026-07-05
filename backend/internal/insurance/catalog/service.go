package catalog

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Product is the normalised catalog row. The catalog is the SINGLE source of
// truth for product → provider routing: no product is hard-coded in logic. The
// routing table is derived from products.provider (single source of truth), which
// keeps the routing data-driven per the build plan §3.
type Product struct {
	Code                string         `json:"code"`
	DisplayName         string         `json:"display_name"`
	ProductLine         string         `json:"product_line"`
	Provider            string         `json:"provider"` // aggregator key: mycover | octamile
	ProviderProductCode string         `json:"provider_product_code"`
	BindingMode         string         `json:"binding_mode"` // direct | embedded
	UnderwriterDisplay  string         `json:"underwriter_display"`
	PremiumModel        string         `json:"premium_model"`
	RequiredKYCTier     int            `json:"required_kyc_tier"`
	RequiredFields      map[string]any `json:"required_fields_schema_ref"`
	SumInsuredRules     map[string]any `json:"sum_insured_rules"`
	CancellationRef     string         `json:"cancellation_policy_ref"`
	Version             int            `json:"version"`
	Active              bool           `json:"active"`
}

// Service reads the versioned product catalog + routing table. All queries are
// parameterized.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs the catalog service over the pgx pool.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ResolveProduct implements gateway.ProductResolver: maps a Paymax product_code
// to (aggregator, provider_product_code). Only ACTIVE products resolve.
func (s *Service) ResolveProduct(ctx context.Context, productCode string) (string, string, bool) {
	if s.db == nil {
		return "", "", false
	}
	var provider, providerProductCode string
	err := s.db.QueryRow(ctx, `
		SELECT provider, provider_product_code
		FROM public.insurance_products
		WHERE code = $1 AND active = true
		LIMIT 1`, productCode).Scan(&provider, &providerProductCode)
	if err != nil {
		return "", "", false
	}
	return provider, providerProductCode, true
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
		onlyActive: true,
		maxKYCTier: &kycTier,
		line:       line,
		bindingMode: "direct",
	})
}

// ListAdmin returns ALL products (active + inactive) for admin tooling.
func (s *Service) ListAdmin(ctx context.Context) ([]Product, error) {
	return s.list(ctx, listFilter{})
}

type listFilter struct {
	code        string
	line        string
	bindingMode string
	onlyActive  bool
	maxKYCTier  *int
}

func (s *Service) list(ctx context.Context, f listFilter) ([]Product, error) {
	if s.db == nil {
		return nil, fmt.Errorf("catalog: nil pool")
	}
	q := `
		SELECT code, display_name, product_line, provider, provider_product_code,
		       binding_mode, underwriter_display, premium_model, required_kyc_tier,
		       required_fields_schema_ref, sum_insured_rules, cancellation_policy_ref,
		       version, active
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
		var reqFields, sumRules []byte
		if err := rows.Scan(
			&p.Code, &p.DisplayName, &p.ProductLine, &p.Provider, &p.ProviderProductCode,
			&p.BindingMode, &p.UnderwriterDisplay, &p.PremiumModel, &p.RequiredKYCTier,
			&reqFields, &sumRules, &p.CancellationRef, &p.Version, &p.Active,
		); err != nil {
			return nil, fmt.Errorf("catalog: scan: %w", err)
		}
		_ = json.Unmarshal(reqFields, &p.RequiredFields)
		_ = json.Unmarshal(sumRules, &p.SumInsuredRules)
		out = append(out, p)
	}
	return out, rows.Err()
}

// SetActive flips a product's active flag (admin catalog management).
func (s *Service) SetActive(ctx context.Context, productCode string, active bool) error {
	if s.db == nil {
		return fmt.Errorf("catalog: nil pool")
	}
	_, err := s.db.Exec(ctx, `
		UPDATE public.insurance_products SET active = $2, updated_at = now()
		WHERE code = $1`, productCode, active)
	return err
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
