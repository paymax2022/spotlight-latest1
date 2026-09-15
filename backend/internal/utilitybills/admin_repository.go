package utilitybills

// admin_repository.go is the ADMIN half of repository.go: catalogue CRUD, the
// unscoped transaction list, dispute resolution, and the three report
// aggregations. It is a separate file purely for size — everything here obeys
// repository.go's rules (pgx pool only, column lists taken from the live schema
// rather than guessed, ErrNotFound on a miss).
//
// Two deliberate differences from the member-facing reads in repository.go, both
// of which are the WHOLE point of an admin surface:
//
//   - NO status filter. ListBillers/ListProducts hard-code `status = 'active'`
//     because a member must never be offered a disabled product. An admin who
//     cannot see the disabled row cannot re-enable it, so AdminList* returns
//     every status.
//   - NO ownership filter on transactions, matching the existing GetTransaction.
//
// Columns NOT exposed by this surface, deliberately and flagged in the PR:
// utility_billers.dynamic_fields, utility_products.metadata,
// utility_category_settings.default_commission_bps and .config. They are outside
// this phase's scope; create leaves them at their DB defaults and update never
// touches them, so nothing is silently clobbered.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// adminListBounds ports app/api/admin/utility/_utils.ts's adminPagination:
// limit defaults to 50 and is capped at 200, offset floors at 0.
//
// These are NOT the member-facing numbers (20 / 100, in ListUserTransactions) —
// an admin paging a catalogue and a member scrolling their own history are
// different workloads, and the TS source already made that distinction.
func adminListBounds(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// ── Providers ────────────────────────────────────────────────────────────────

// adminProviderCols is providerCols plus last_health_check_at, which the admin
// console shows next to health_status ("healthy, as of when?") and which the
// health-check endpoint writes. credentials is NEVER selected here: this file
// has no use for the ciphertext, and a column that is never read cannot leak.
const adminProviderCols = `id, name, code, adapter_code, status, supported_categories, priority,
	health_status, last_health_check_at, (credentials IS NOT NULL) AS credentials_configured`

// AdminProviderView is a provider as the admin console sees it: the row, plus
// the last health-check timestamp, plus credentials_configured.
//
// credentials_configured ports sanitizeProvider()'s `Boolean(row.credentials)`
// — the admin needs to know WHETHER a provider has credentials without ever
// receiving them. The embedded ProviderRow keeps Credentials/Config tagged
// `json:"-"`, so the secret cannot escape through this type even if a future
// caller populates it.
type AdminProviderView struct {
	ProviderRow
	LastHealthCheckAt     *time.Time `json:"last_health_check_at"`
	CredentialsConfigured bool       `json:"credentials_configured"`
}

func scanAdminProvider(row pgx.Row) (*AdminProviderView, error) {
	var v AdminProviderView
	if err := row.Scan(&v.ID, &v.Name, &v.Code, &v.AdapterCode, &v.Status, &v.SupportedCategories,
		&v.Priority, &v.HealthStatus, &v.LastHealthCheckAt, &v.CredentialsConfigured); err != nil {
		return nil, err
	}
	return &v, nil
}

// AdminListProviders returns providers of EVERY status, newest first.
func (r *Repository) AdminListProviders(ctx context.Context, limit, offset int) ([]AdminProviderView, error) {
	limit, offset = adminListBounds(limit, offset)
	rows, err := r.db.Query(ctx, `SELECT `+adminProviderCols+`
		FROM public.utility_providers ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: admin list providers: %w", err)
	}
	defer rows.Close()
	out := []AdminProviderView{}
	for rows.Next() {
		v, err := scanAdminProvider(rows)
		if err != nil {
			return nil, fmt.Errorf("utilitybills: scan provider: %w", err)
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// AdminGetProvider loads one provider in the admin projection (no credentials).
func (r *Repository) AdminGetProvider(ctx context.Context, id string) (*AdminProviderView, error) {
	v, err := scanAdminProvider(r.db.QueryRow(ctx,
		`SELECT `+adminProviderCols+` FROM public.utility_providers WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility provider %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: admin get provider: %w", err)
	}
	return v, nil
}

// ProviderInput is a provider create. Every field maps to a NOT NULL column or
// one with a DB default; the service validates before this is reached.
type ProviderInput struct {
	Name                string          `json:"name"`
	Code                string          `json:"code"`
	AdapterCode         string          `json:"adapter_code"`
	Status              string          `json:"status"`
	SupportedCategories []string        `json:"supported_categories"`
	Priority            *int            `json:"priority"`
	HealthStatus        string          `json:"health_status"`
	Config              json.RawMessage `json:"config"`
}

// CreateProvider inserts a provider. Credentials are deliberately NOT settable
// here — they go through RotateProviderCredentials, which is the only path that
// encrypts. A create that accepted plaintext credentials would be one typo away
// from storing them unencrypted.
func (r *Repository) CreateProvider(ctx context.Context, in ProviderInput) (*AdminProviderView, error) {
	cats := in.SupportedCategories
	if cats == nil {
		cats = []string{}
	}
	config := in.Config
	if len(config) == 0 {
		config = json.RawMessage(`{}`)
	}
	v, err := scanAdminProvider(r.db.QueryRow(ctx, `
		INSERT INTO public.utility_providers
			(name, code, adapter_code, status, supported_categories, priority, health_status, config)
		VALUES ($1, $2, $3, COALESCE($4,'active'), $5, COALESCE($6,100), COALESCE($7,'unknown'), $8)
		RETURNING `+adminProviderCols,
		in.Name, in.Code, in.AdapterCode, nullIfEmpty(in.Status), cats, in.Priority,
		nullIfEmpty(in.HealthStatus), []byte(config)))
	if err != nil {
		return nil, fmt.Errorf("utilitybills: create provider: %w", err)
	}
	return v, nil
}

// ProviderPatch is a partial provider update, following TransactionPatch: only
// non-nil fields are written.
type ProviderPatch struct {
	Name                *string
	Code                *string
	AdapterCode         *string
	Status              *string
	SupportedCategories *[]string
	Priority            *int
	HealthStatus        *string
	Config              json.RawMessage
}

// UpdateProvider applies a partial patch and returns the updated row.
func (r *Repository) UpdateProvider(ctx context.Context, id string, patch ProviderPatch) (*AdminProviderView, error) {
	b := newSetBuilder()
	b.set("name", patch.Name)
	b.set("code", patch.Code)
	b.set("adapter_code", patch.AdapterCode)
	b.set("status", patch.Status)
	if patch.SupportedCategories != nil {
		b.add("supported_categories", *patch.SupportedCategories)
	}
	b.set("priority", patch.Priority)
	b.set("health_status", patch.HealthStatus)
	if len(patch.Config) > 0 {
		b.add("config", []byte(patch.Config))
	}
	if b.empty() {
		return r.AdminGetProvider(ctx, id)
	}
	v, err := scanAdminProvider(r.db.QueryRow(ctx, b.query("public.utility_providers", "id", adminProviderCols), b.args(id)...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility provider %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: update provider: %w", err)
	}
	return v, nil
}

// SetProviderCredentials stores an ALREADY-ENCRYPTED credentials envelope. It
// takes the ciphertext, never a plaintext map: encryption happens in the service
// (credentials.go's EncryptCredentials) and this layer cannot be called in a way
// that writes a secret in the clear.
func (r *Repository) SetProviderCredentials(ctx context.Context, id string, envelope []byte) (*AdminProviderView, error) {
	v, err := scanAdminProvider(r.db.QueryRow(ctx, `
		UPDATE public.utility_providers SET credentials = $2, updated_at = now()
		WHERE id = $1 RETURNING `+adminProviderCols, id, envelope))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility provider %s", ErrNotFound, id)
	}
	if err != nil {
		// Deliberately does NOT wrap anything derived from the envelope — an error
		// string is a log line waiting to happen.
		return nil, fmt.Errorf("utilitybills: set provider credentials: %w", err)
	}
	return v, nil
}

// SetProviderHealth persists a health-check outcome, porting
// adminHealthCheckProvider's update (health_status + last_health_check_at).
func (r *Repository) SetProviderHealth(ctx context.Context, id, status string) (*AdminProviderView, error) {
	v, err := scanAdminProvider(r.db.QueryRow(ctx, `
		UPDATE public.utility_providers
		SET health_status = $2, last_health_check_at = now(), updated_at = now()
		WHERE id = $1 RETURNING `+adminProviderCols, id, status))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility provider %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: set provider health: %w", err)
	}
	return v, nil
}

// ProviderCredentials returns the raw encrypted credentials envelope for one
// provider. Used only by the service's health check, which needs to know whether
// credentials exist at all. Never returned to a client.
func (r *Repository) ProviderCredentials(ctx context.Context, id string) ([]byte, error) {
	var creds []byte
	err := r.db.QueryRow(ctx, `SELECT credentials FROM public.utility_providers WHERE id = $1`, id).Scan(&creds)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility provider %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: read provider credentials: %w", err)
	}
	return creds, nil
}

// ── Billers ──────────────────────────────────────────────────────────────────

// AdminListBillers returns billers of EVERY status (contrast ListBillers, which
// is member-facing and hard-filters to active).
func (r *Repository) AdminListBillers(ctx context.Context, limit, offset int) ([]BillerRow, error) {
	limit, offset = adminListBounds(limit, offset)
	rows, err := r.db.Query(ctx, `SELECT `+billerCols+`
		FROM public.utility_billers ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: admin list billers: %w", err)
	}
	defer rows.Close()
	out := []BillerRow{}
	for rows.Next() {
		b, err := scanBiller(rows)
		if err != nil {
			return nil, fmt.Errorf("utilitybills: scan biller: %w", err)
		}
		out = append(out, *b)
	}
	return out, rows.Err()
}

// BillerInput is a biller create.
type BillerInput struct {
	Category               string `json:"category"`
	Name                   string `json:"name"`
	Code                   string `json:"code"`
	Country                string `json:"country"`
	Status                 string `json:"status"`
	RequiresValidation     *bool  `json:"requires_validation"`
	CustomerReferenceLabel string `json:"customer_reference_label"`
}

// CreateBiller inserts a biller, leaving unset columns at their DB defaults
// (country 'NG', status 'active', requires_validation false, the label).
func (r *Repository) CreateBiller(ctx context.Context, in BillerInput) (*BillerRow, error) {
	b, err := scanBiller(r.db.QueryRow(ctx, `
		INSERT INTO public.utility_billers
			(category, name, code, country, status, requires_validation, customer_reference_label)
		VALUES ($1, $2, $3, COALESCE($4,'NG'), COALESCE($5,'active'), COALESCE($6,false),
		        COALESCE($7,'Customer reference'))
		RETURNING `+billerCols,
		in.Category, in.Name, in.Code, nullIfEmpty(in.Country), nullIfEmpty(in.Status),
		in.RequiresValidation, nullIfEmpty(in.CustomerReferenceLabel)))
	if err != nil {
		return nil, fmt.Errorf("utilitybills: create biller: %w", err)
	}
	return b, nil
}

// BillerPatch is a partial biller update.
type BillerPatch struct {
	Category               *string
	Name                   *string
	Code                   *string
	Country                *string
	Status                 *string
	RequiresValidation     *bool
	CustomerReferenceLabel *string
}

// UpdateBiller applies a partial patch and returns the updated row.
func (r *Repository) UpdateBiller(ctx context.Context, id string, patch BillerPatch) (*BillerRow, error) {
	b := newSetBuilder()
	b.set("category", patch.Category)
	b.set("name", patch.Name)
	b.set("code", patch.Code)
	b.set("country", patch.Country)
	b.set("status", patch.Status)
	b.set("requires_validation", patch.RequiresValidation)
	b.set("customer_reference_label", patch.CustomerReferenceLabel)
	if b.empty() {
		return r.GetBiller(ctx, id)
	}
	row, err := scanBiller(r.db.QueryRow(ctx, b.query("public.utility_billers", "id", billerCols), b.args(id)...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility biller %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: update biller: %w", err)
	}
	return row, nil
}

// ── Products ─────────────────────────────────────────────────────────────────

// AdminListProducts returns products of EVERY status.
func (r *Repository) AdminListProducts(ctx context.Context, limit, offset int) ([]ProductRow, error) {
	limit, offset = adminListBounds(limit, offset)
	rows, err := r.db.Query(ctx, `SELECT `+productCols+`
		FROM public.utility_products ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: admin list products: %w", err)
	}
	defer rows.Close()
	out := []ProductRow{}
	for rows.Next() {
		p, err := scanProduct(rows)
		if err != nil {
			return nil, fmt.Errorf("utilitybills: scan product: %w", err)
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// ProductInput is a product create (and one element of an import batch).
//
// The three kobo bounds are pointers because the columns are nullable AND their
// CHECK constraints reject 0 — the difference between "unbounded" and "zero" is
// load-bearing here, so a plain int64 defaulting to 0 would turn an omitted
// minimum into a constraint violation.
type ProductInput struct {
	BillerID            string `json:"biller_id"`
	Category            string `json:"category"`
	Name                string `json:"name"`
	Code                string `json:"code"`
	AmountType          string `json:"amount_type"`
	AmountKobo          *int64 `json:"amount_kobo"`
	MinAmountKobo       *int64 `json:"min_amount_kobo"`
	MaxAmountKobo       *int64 `json:"max_amount_kobo"`
	ConvenienceFeeKobo  *int64 `json:"convenience_fee_kobo"`
	MarkupBps           *int64 `json:"markup_bps"`
	ProviderDiscountBps *int64 `json:"provider_discount_bps"`
	Status              string `json:"status"`
}

const productInsertSQL = `
	INSERT INTO public.utility_products
		(biller_id, category, name, code, amount_type, amount_kobo, min_amount_kobo, max_amount_kobo,
		 convenience_fee_kobo, markup_bps, provider_discount_bps, status)
	VALUES ($1, $2, $3, $4, COALESCE($5,'fixed'), $6, $7, $8,
	        COALESCE($9,0), COALESCE($10,0), COALESCE($11,0), COALESCE($12,'active'))`

func productInsertArgs(in ProductInput) []any {
	return []any{
		in.BillerID, in.Category, in.Name, in.Code, nullIfEmpty(in.AmountType),
		in.AmountKobo, in.MinAmountKobo, in.MaxAmountKobo,
		in.ConvenienceFeeKobo, in.MarkupBps, in.ProviderDiscountBps, nullIfEmpty(in.Status),
	}
}

// CreateProduct inserts a product.
func (r *Repository) CreateProduct(ctx context.Context, in ProductInput) (*ProductRow, error) {
	p, err := scanProduct(r.db.QueryRow(ctx, productInsertSQL+` RETURNING `+productCols, productInsertArgs(in)...))
	if err != nil {
		return nil, fmt.Errorf("utilitybills: create product: %w", err)
	}
	return p, nil
}

// ImportProducts bulk-upserts products keyed on code, porting
// adminImportUtilityProducts's `upsert(rows, { onConflict: 'code' })`.
//
// Run inside ONE transaction, which the Supabase upsert also was: a half-applied
// catalogue import is the state nobody can reason about — some products at new
// prices, some at old, and no record of where the boundary fell.
//
// A conflicting row is fully REPLACED (every column in the input), matching
// Supabase's upsert semantics. This is not a merge: an import that omits
// markup_bps resets that product's markup to 0. That is the TS behaviour and the
// reason the import endpoint takes complete product objects.
func (r *Repository) ImportProducts(ctx context.Context, products []ProductInput) ([]ProductRow, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: import products: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }() // no-op once committed

	const upsertSQL = productInsertSQL + `
		ON CONFLICT (code) DO UPDATE SET
			biller_id = EXCLUDED.biller_id,
			category = EXCLUDED.category,
			name = EXCLUDED.name,
			amount_type = EXCLUDED.amount_type,
			amount_kobo = EXCLUDED.amount_kobo,
			min_amount_kobo = EXCLUDED.min_amount_kobo,
			max_amount_kobo = EXCLUDED.max_amount_kobo,
			convenience_fee_kobo = EXCLUDED.convenience_fee_kobo,
			markup_bps = EXCLUDED.markup_bps,
			provider_discount_bps = EXCLUDED.provider_discount_bps,
			status = EXCLUDED.status,
			updated_at = now()
		RETURNING ` + productCols

	out := make([]ProductRow, 0, len(products))
	for i, in := range products {
		p, err := scanProduct(tx.QueryRow(ctx, upsertSQL, productInsertArgs(in)...))
		if err != nil {
			return nil, fmt.Errorf("utilitybills: import products: row %d (code %q): %w", i, in.Code, err)
		}
		out = append(out, *p)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("utilitybills: import products: commit: %w", err)
	}
	return out, nil
}

// ProductPatch is a partial product update. The Clear* flags exist for the three
// nullable kobo columns, following TransactionPatch.ClearFailureReason: without
// them there is no way to say "this product no longer has a maximum", because a
// nil pointer already means "leave it alone".
type ProductPatch struct {
	BillerID            *string
	Category            *string
	Name                *string
	Code                *string
	AmountType          *string
	AmountKobo          *int64
	ClearAmountKobo     bool
	MinAmountKobo       *int64
	ClearMinAmountKobo  bool
	MaxAmountKobo       *int64
	ClearMaxAmountKobo  bool
	ConvenienceFeeKobo  *int64
	MarkupBps           *int64
	ProviderDiscountBps *int64
	Status              *string
}

// UpdateProduct applies a partial patch and returns the updated row.
func (r *Repository) UpdateProduct(ctx context.Context, id string, patch ProductPatch) (*ProductRow, error) {
	b := newSetBuilder()
	b.set("biller_id", patch.BillerID)
	b.set("category", patch.Category)
	b.set("name", patch.Name)
	b.set("code", patch.Code)
	b.set("amount_type", patch.AmountType)
	b.setOrNull("amount_kobo", patch.AmountKobo, patch.ClearAmountKobo)
	b.setOrNull("min_amount_kobo", patch.MinAmountKobo, patch.ClearMinAmountKobo)
	b.setOrNull("max_amount_kobo", patch.MaxAmountKobo, patch.ClearMaxAmountKobo)
	b.set("convenience_fee_kobo", patch.ConvenienceFeeKobo)
	b.set("markup_bps", patch.MarkupBps)
	b.set("provider_discount_bps", patch.ProviderDiscountBps)
	b.set("status", patch.Status)
	if b.empty() {
		return r.GetProduct(ctx, id)
	}
	p, err := scanProduct(r.db.QueryRow(ctx, b.query("public.utility_products", "id", productCols), b.args(id)...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility product %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: update product: %w", err)
	}
	return p, nil
}

// ── Provider/product mappings ────────────────────────────────────────────────

// mappingCols is the column list behind MappingRow (the existing type — this
// table's Go name is MappingRow, not "ProviderProductRow"). provider_biller_code
// is nullable and COALESCEd to ”, exactly as GetRouteCandidates does it.
const mappingCols = `id, provider_id, product_id, provider_product_code,
	COALESCE(provider_biller_code,''), provider_cost_kobo, provider_discount_bps, status`

func scanMapping(row pgx.Row) (*MappingRow, error) {
	var m MappingRow
	if err := row.Scan(&m.ID, &m.ProviderID, &m.ProductID, &m.ProviderProductCode,
		&m.ProviderBillerCode, &m.ProviderCostKobo, &m.ProviderDiscountBps, &m.Status); err != nil {
		return nil, err
	}
	return &m, nil
}

// AdminListMappings returns provider/product mappings of EVERY status.
func (r *Repository) AdminListMappings(ctx context.Context, limit, offset int) ([]MappingRow, error) {
	limit, offset = adminListBounds(limit, offset)
	rows, err := r.db.Query(ctx, `SELECT `+mappingCols+`
		FROM public.utility_provider_product_mappings ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: admin list mappings: %w", err)
	}
	defer rows.Close()
	out := []MappingRow{}
	for rows.Next() {
		m, err := scanMapping(rows)
		if err != nil {
			return nil, fmt.Errorf("utilitybills: scan mapping: %w", err)
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// GetMapping loads one mapping by id.
func (r *Repository) GetMapping(ctx context.Context, id string) (*MappingRow, error) {
	m, err := scanMapping(r.db.QueryRow(ctx,
		`SELECT `+mappingCols+` FROM public.utility_provider_product_mappings WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility provider mapping %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get mapping: %w", err)
	}
	return m, nil
}

// MappingInput is a provider/product mapping create.
type MappingInput struct {
	ProviderID          string `json:"provider_id"`
	ProductID           string `json:"product_id"`
	ProviderProductCode string `json:"provider_product_code"`
	ProviderBillerCode  string `json:"provider_biller_code"`
	ProviderCostKobo    *int64 `json:"provider_cost_kobo"`
	ProviderDiscountBps *int64 `json:"provider_discount_bps"`
	Status              string `json:"status"`
}

// CreateMapping inserts a provider/product mapping.
func (r *Repository) CreateMapping(ctx context.Context, in MappingInput) (*MappingRow, error) {
	m, err := scanMapping(r.db.QueryRow(ctx, `
		INSERT INTO public.utility_provider_product_mappings
			(provider_id, product_id, provider_product_code, provider_biller_code,
			 provider_cost_kobo, provider_discount_bps, status)
		VALUES ($1, $2, $3, $4, $5, COALESCE($6,0), COALESCE($7,'active'))
		RETURNING `+mappingCols,
		in.ProviderID, in.ProductID, in.ProviderProductCode, nullIfEmpty(in.ProviderBillerCode),
		in.ProviderCostKobo, in.ProviderDiscountBps, nullIfEmpty(in.Status)))
	if err != nil {
		return nil, fmt.Errorf("utilitybills: create mapping: %w", err)
	}
	return m, nil
}

// MappingPatch is a partial mapping update.
type MappingPatch struct {
	ProviderID            *string
	ProductID             *string
	ProviderProductCode   *string
	ProviderBillerCode    *string
	ProviderCostKobo      *int64
	ClearProviderCostKobo bool
	ProviderDiscountBps   *int64
	Status                *string
}

// UpdateMapping applies a partial patch and returns the updated row.
func (r *Repository) UpdateMapping(ctx context.Context, id string, patch MappingPatch) (*MappingRow, error) {
	b := newSetBuilder()
	b.set("provider_id", patch.ProviderID)
	b.set("product_id", patch.ProductID)
	b.set("provider_product_code", patch.ProviderProductCode)
	b.set("provider_biller_code", patch.ProviderBillerCode)
	b.setOrNull("provider_cost_kobo", patch.ProviderCostKobo, patch.ClearProviderCostKobo)
	b.set("provider_discount_bps", patch.ProviderDiscountBps)
	b.set("status", patch.Status)
	if b.empty() {
		return r.GetMapping(ctx, id)
	}
	m, err := scanMapping(r.db.QueryRow(ctx,
		b.query("public.utility_provider_product_mappings", "id", mappingCols), b.args(id)...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility provider mapping %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: update mapping: %w", err)
	}
	return m, nil
}

// ── Routing rules ────────────────────────────────────────────────────────────
//
// utility_routing_rules had NO Go representation before this phase: Phase 1 read
// the table only through a correlated subquery inside GetRouteCandidates, which
// needed nothing but the priority column. The row type below is therefore new,
// and its shape comes from `\d utility_routing_rules` on the live schema.

// RoutingRuleRow mirrors public.utility_routing_rules. Category, BillerID and
// ProductID are all nullable: a rule scoped to nothing in particular is a
// PROVIDER-wide default, and that is a legitimate configuration, not missing
// data.
type RoutingRuleRow struct {
	ID            string  `json:"id"`
	Category      *string `json:"category"`
	BillerID      *string `json:"biller_id"`
	ProductID     *string `json:"product_id"`
	ProviderID    string  `json:"provider_id"`
	Priority      int     `json:"priority"`
	MinAmountKobo *int64  `json:"min_amount_kobo"`
	MaxAmountKobo *int64  `json:"max_amount_kobo"`
	Status        string  `json:"status"`
}

const routingRuleCols = `id, category, biller_id, product_id, provider_id, priority,
	min_amount_kobo, max_amount_kobo, status`

func scanRoutingRule(row pgx.Row) (*RoutingRuleRow, error) {
	var rr RoutingRuleRow
	if err := row.Scan(&rr.ID, &rr.Category, &rr.BillerID, &rr.ProductID, &rr.ProviderID,
		&rr.Priority, &rr.MinAmountKobo, &rr.MaxAmountKobo, &rr.Status); err != nil {
		return nil, err
	}
	return &rr, nil
}

// AdminListRoutingRules returns routing rules of EVERY status.
func (r *Repository) AdminListRoutingRules(ctx context.Context, limit, offset int) ([]RoutingRuleRow, error) {
	limit, offset = adminListBounds(limit, offset)
	rows, err := r.db.Query(ctx, `SELECT `+routingRuleCols+`
		FROM public.utility_routing_rules ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: admin list routing rules: %w", err)
	}
	defer rows.Close()
	out := []RoutingRuleRow{}
	for rows.Next() {
		rr, err := scanRoutingRule(rows)
		if err != nil {
			return nil, fmt.Errorf("utilitybills: scan routing rule: %w", err)
		}
		out = append(out, *rr)
	}
	return out, rows.Err()
}

// GetRoutingRule loads one routing rule by id.
func (r *Repository) GetRoutingRule(ctx context.Context, id string) (*RoutingRuleRow, error) {
	rr, err := scanRoutingRule(r.db.QueryRow(ctx,
		`SELECT `+routingRuleCols+` FROM public.utility_routing_rules WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility routing rule %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get routing rule: %w", err)
	}
	return rr, nil
}

// RoutingRuleInput is a routing-rule create. provider_id is the only NOT NULL
// scoping column — everything else narrows the rule.
type RoutingRuleInput struct {
	Category      string `json:"category"`
	BillerID      string `json:"biller_id"`
	ProductID     string `json:"product_id"`
	ProviderID    string `json:"provider_id"`
	Priority      *int   `json:"priority"`
	MinAmountKobo *int64 `json:"min_amount_kobo"`
	MaxAmountKobo *int64 `json:"max_amount_kobo"`
	Status        string `json:"status"`
}

// CreateRoutingRule inserts a routing rule.
func (r *Repository) CreateRoutingRule(ctx context.Context, in RoutingRuleInput) (*RoutingRuleRow, error) {
	rr, err := scanRoutingRule(r.db.QueryRow(ctx, `
		INSERT INTO public.utility_routing_rules
			(category, biller_id, product_id, provider_id, priority, min_amount_kobo, max_amount_kobo, status)
		VALUES ($1, $2, $3, $4, COALESCE($5,100), $6, $7, COALESCE($8,'active'))
		RETURNING `+routingRuleCols,
		nullIfEmpty(in.Category), nullIfEmpty(in.BillerID), nullIfEmpty(in.ProductID),
		in.ProviderID, in.Priority, in.MinAmountKobo, in.MaxAmountKobo, nullIfEmpty(in.Status)))
	if err != nil {
		return nil, fmt.Errorf("utilitybills: create routing rule: %w", err)
	}
	return rr, nil
}

// RoutingRulePatch is a partial routing-rule update. The three scoping columns
// get Clear* flags because widening a rule (dropping its category/biller/product
// narrowing) is a normal admin operation that no non-nil value can express.
type RoutingRulePatch struct {
	Category           *string
	ClearCategory      bool
	BillerID           *string
	ClearBillerID      bool
	ProductID          *string
	ClearProductID     bool
	ProviderID         *string
	Priority           *int
	MinAmountKobo      *int64
	ClearMinAmountKobo bool
	MaxAmountKobo      *int64
	ClearMaxAmountKobo bool
	Status             *string
}

// UpdateRoutingRule applies a partial patch and returns the updated row.
func (r *Repository) UpdateRoutingRule(ctx context.Context, id string, patch RoutingRulePatch) (*RoutingRuleRow, error) {
	b := newSetBuilder()
	b.setOrNull("category", patch.Category, patch.ClearCategory)
	b.setOrNull("biller_id", patch.BillerID, patch.ClearBillerID)
	b.setOrNull("product_id", patch.ProductID, patch.ClearProductID)
	b.set("provider_id", patch.ProviderID)
	b.set("priority", patch.Priority)
	b.setOrNull("min_amount_kobo", patch.MinAmountKobo, patch.ClearMinAmountKobo)
	b.setOrNull("max_amount_kobo", patch.MaxAmountKobo, patch.ClearMaxAmountKobo)
	b.set("status", patch.Status)
	if b.empty() {
		return r.GetRoutingRule(ctx, id)
	}
	rr, err := scanRoutingRule(r.db.QueryRow(ctx,
		b.query("public.utility_routing_rules", "id", routingRuleCols), b.args(id)...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility routing rule %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: update routing rule: %w", err)
	}
	return rr, nil
}

// ── Category settings ────────────────────────────────────────────────────────
//
// Keyed on the `category` TEXT primary key, not a uuid — which is why the route
// is PATCH /categories/:category and adminUpdateUtilityRow special-cases this
// one table's key column.

const categorySettingCols = `category, enabled, COALESCE(availability_message,''),
	daily_limit_kobo, min_amount_kobo, max_amount_kobo`

func scanCategorySetting(row pgx.Row) (*CategorySettingRow, error) {
	var s CategorySettingRow
	if err := row.Scan(&s.Category, &s.Enabled, &s.AvailabilityMessage,
		&s.DailyLimitKobo, &s.MinAmountKobo, &s.MaxAmountKobo); err != nil {
		return nil, err
	}
	return &s, nil
}

// AdminListCategorySettings returns EVERY category setting, enabled or not
// (contrast ListCategorySettings, which is member-facing and filters to
// enabled = true — an admin who cannot see the disabled row cannot re-enable it).
func (r *Repository) AdminListCategorySettings(ctx context.Context) ([]CategorySettingRow, error) {
	rows, err := r.db.Query(ctx, `SELECT `+categorySettingCols+`
		FROM public.utility_category_settings ORDER BY category ASC`)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: admin list category settings: %w", err)
	}
	defer rows.Close()
	out := []CategorySettingRow{}
	for rows.Next() {
		s, err := scanCategorySetting(rows)
		if err != nil {
			return nil, fmt.Errorf("utilitybills: scan category setting: %w", err)
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// CategorySettingInput is a category-setting create.
type CategorySettingInput struct {
	Category            string `json:"category"`
	Enabled             *bool  `json:"enabled"`
	AvailabilityMessage string `json:"availability_message"`
	DailyLimitKobo      *int64 `json:"daily_limit_kobo"`
	MinAmountKobo       *int64 `json:"min_amount_kobo"`
	MaxAmountKobo       *int64 `json:"max_amount_kobo"`
}

// CreateCategorySetting inserts a category setting.
func (r *Repository) CreateCategorySetting(ctx context.Context, in CategorySettingInput) (*CategorySettingRow, error) {
	s, err := scanCategorySetting(r.db.QueryRow(ctx, `
		INSERT INTO public.utility_category_settings
			(category, enabled, availability_message, daily_limit_kobo, min_amount_kobo, max_amount_kobo)
		VALUES ($1, COALESCE($2,true), $3, $4, $5, $6)
		RETURNING `+categorySettingCols,
		in.Category, in.Enabled, nullIfEmpty(in.AvailabilityMessage),
		in.DailyLimitKobo, in.MinAmountKobo, in.MaxAmountKobo))
	if err != nil {
		return nil, fmt.Errorf("utilitybills: create category setting: %w", err)
	}
	return s, nil
}

// CategorySettingPatch is a partial category-setting update.
type CategorySettingPatch struct {
	Enabled                  *bool
	AvailabilityMessage      *string
	ClearAvailabilityMessage bool
	DailyLimitKobo           *int64
	ClearDailyLimitKobo      bool
	MinAmountKobo            *int64
	ClearMinAmountKobo       bool
	MaxAmountKobo            *int64
	ClearMaxAmountKobo       bool
}

// UpdateCategorySetting applies a partial patch, keyed on the category column.
func (r *Repository) UpdateCategorySetting(ctx context.Context, category string, patch CategorySettingPatch) (*CategorySettingRow, error) {
	b := newSetBuilder()
	b.set("enabled", patch.Enabled)
	b.setOrNull("availability_message", patch.AvailabilityMessage, patch.ClearAvailabilityMessage)
	b.setOrNull("daily_limit_kobo", patch.DailyLimitKobo, patch.ClearDailyLimitKobo)
	b.setOrNull("min_amount_kobo", patch.MinAmountKobo, patch.ClearMinAmountKobo)
	b.setOrNull("max_amount_kobo", patch.MaxAmountKobo, patch.ClearMaxAmountKobo)
	if b.empty() {
		s, err := r.GetCategorySetting(ctx, category)
		if err != nil {
			return nil, err
		}
		if s == nil {
			return nil, fmt.Errorf("%w: utility category setting %s", ErrNotFound, category)
		}
		return s, nil
	}
	s, err := scanCategorySetting(r.db.QueryRow(ctx,
		b.query("public.utility_category_settings", "category", categorySettingCols), b.args(category)...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility category setting %s", ErrNotFound, category)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: update category setting: %w", err)
	}
	return s, nil
}

// ── Transactions (admin) ─────────────────────────────────────────────────────

// AdminListTransactions returns transactions across ALL members, newest first,
// optionally filtered by status. Ports adminListUtilityTransactions.
//
// Pagination uses the ADMIN bounds (50/200), not ListUserTransactions's member
// bounds (20/100) — see adminListBounds.
func (r *Repository) AdminListTransactions(ctx context.Context, status string, limit, offset int) ([]TransactionRow, error) {
	limit, offset = adminListBounds(limit, offset)
	q := `SELECT ` + transactionCols + ` FROM public.utility_transactions`
	args := []any{}
	if status != "" {
		args = append(args, status)
		q += fmt.Sprintf(` WHERE status = $%d`, len(args))
	}
	args = append(args, limit, offset)
	q += fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args))

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: admin list transactions: %w", err)
	}
	defer rows.Close()
	out := []TransactionRow{}
	for rows.Next() {
		t, err := scanTransaction(rows)
		if err != nil {
			return nil, fmt.Errorf("utilitybills: scan transaction: %w", err)
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

// ── Disputes (admin) ─────────────────────────────────────────────────────────

// UpdateDisputeByTransaction resolves the dispute attached to a transaction.
//
// Keyed on transaction_id, NOT on a dispute id, because that is what the TS
// source does (`.update(...).eq('transaction_id', transactionId)`) and what the
// route exposes (POST /transactions/:id/resolve — the caller never has a dispute
// id to give).
//
// ONE deliberate divergence, flagged: where a transaction has more than one
// dispute row, the TS update would write EVERY one of them and then throw on
// `.single()`. This targets the most recent dispute only, so the outcome is
// deterministic and the older history is left intact as history.
func (r *Repository) UpdateDisputeByTransaction(ctx context.Context, transactionID, status, resolutionNote string) (*DisputeRow, error) {
	var d DisputeRow
	err := r.db.QueryRow(ctx, `
		UPDATE public.utility_disputes
		SET status = $2, resolution_note = $3, updated_at = now()
		WHERE id = (
			SELECT id FROM public.utility_disputes
			WHERE transaction_id = $1 ORDER BY created_at DESC LIMIT 1
		)
		RETURNING id, transaction_id, user_id, reason, status, resolution_note, created_at`,
		transactionID, status, resolutionNote).
		Scan(&d.ID, &d.TransactionID, &d.UserID, &d.Reason, &d.Status, &d.ResolutionNote, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: no utility dispute for transaction %s", ErrNotFound, transactionID)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: update dispute: %w", err)
	}
	return &d, nil
}

// ── Reports ──────────────────────────────────────────────────────────────────
//
// All three port adminUtilityReport. The RESULT SHAPES are identical to the TS
// function's (same field names, same units, same semantics) because those shapes
// are the contract the admin console and its CSV export already consume.
//
// The COMPUTATION is not a line-by-line port: the TS source pulls up to 10,000
// rows over the network and folds them in JavaScript. These aggregate in SQL.
// That is the change the task asked for, and it also fixes a real defect — the
// TS `.range(0, 9999)` silently truncated both aggregate reports at 10,000 rows,
// so every figure quietly became wrong once the table outgrew that. The
// reconciliation report keeps its 10,000-row cap because it is a row LISTING,
// not an aggregate, and an unbounded one would be a denial-of-service on the
// admin console rather than a more accurate answer.

// ProfitabilityReport is adminUtilityReport('profitability')'s summary object.
//
// Scope note, ported deliberately: the TS reduce runs over EVERY transaction
// regardless of status — failed and reversed rows are counted in
// total_transactions and their kobo columns are summed too. That is almost
// certainly not what "profit" should mean, but changing it here would silently
// move a number the business already reads. Ported as-is and flagged.
type ProfitabilityReport struct {
	TotalTransactions         int64 `json:"total_transactions"`
	GrossTransactionValueKobo int64 `json:"gross_transaction_value_kobo"`
	ProviderCostKobo          int64 `json:"provider_cost_kobo"`
	GrossProfitKobo           int64 `json:"gross_profit_kobo"`
}

// ProfitabilityReport aggregates the whole utility_transactions table.
func (r *Repository) ProfitabilityReport(ctx context.Context) (*ProfitabilityReport, error) {
	var out ProfitabilityReport
	err := r.db.QueryRow(ctx, `
		SELECT COUNT(*),
		       COALESCE(SUM(retail_amount_kobo), 0),
		       COALESCE(SUM(provider_cost_kobo), 0),
		       COALESCE(SUM(gross_profit_kobo), 0)
		FROM public.utility_transactions`).
		Scan(&out.TotalTransactions, &out.GrossTransactionValueKobo, &out.ProviderCostKobo, &out.GrossProfitKobo)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: profitability report: %w", err)
	}
	return &out, nil
}

// ProviderPerformanceRow is one provider's row in
// adminUtilityReport('provider-performance').
type ProviderPerformanceRow struct {
	ProviderID        string `json:"provider_id"`
	Attempts          int64  `json:"attempts"`
	Successful        int64  `json:"successful"`
	Pending           int64  `json:"pending"`
	Failed            int64  `json:"failed"`
	Timeout           int64  `json:"timeout"`
	Error             int64  `json:"error"`
	AverageDurationMs int64  `json:"average_duration_ms"`
	MaxDurationMs     int64  `json:"max_duration_ms"`
	SuccessRateBps    int64  `json:"success_rate_bps"`
}

// ProviderPerformanceReport groups utility_provider_attempts by provider.
//
// Two details carried over verbatim from the TS fold, because they change the
// numbers: a NULL duration_ms counts as 0 in BOTH the average's numerator and
// its denominator (TS: `row.duration_ms ?? 0`, divided by total attempts, not by
// attempts that recorded a duration), and the 'started' status — an attempt that
// never completed — is counted in `attempts` but in none of the five outcome
// buckets, so the buckets legitimately need not sum to attempts.
func (r *Repository) ProviderPerformanceReport(ctx context.Context) ([]ProviderPerformanceRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT provider_id,
		       COUNT(*)                                                        AS attempts,
		       COUNT(*) FILTER (WHERE status = 'successful')                   AS successful,
		       COUNT(*) FILTER (WHERE status = 'pending')                      AS pending,
		       COUNT(*) FILTER (WHERE status = 'failed')                       AS failed,
		       COUNT(*) FILTER (WHERE status = 'timeout')                      AS timeout,
		       COUNT(*) FILTER (WHERE status = 'error')                        AS error,
		       ROUND(SUM(COALESCE(duration_ms, 0))::numeric / COUNT(*))::bigint AS average_duration_ms,
		       COALESCE(MAX(COALESCE(duration_ms, 0)), 0)                      AS max_duration_ms,
		       ROUND((COUNT(*) FILTER (WHERE status = 'successful') * 10000)::numeric / COUNT(*))::bigint AS success_rate_bps
		FROM public.utility_provider_attempts
		GROUP BY provider_id`)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: provider performance report: %w", err)
	}
	defer rows.Close()
	out := []ProviderPerformanceRow{}
	for rows.Next() {
		var p ProviderPerformanceRow
		if err := rows.Scan(&p.ProviderID, &p.Attempts, &p.Successful, &p.Pending, &p.Failed,
			&p.Timeout, &p.Error, &p.AverageDurationMs, &p.MaxDurationMs, &p.SuccessRateBps); err != nil {
			return nil, fmt.Errorf("utilitybills: scan provider performance: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ReconciliationRow is one row of adminUtilityReport('reconciliation') — the
// exact nine columns the TS select lists, in that order.
type ReconciliationRow struct {
	ID                string    `json:"id"`
	ReceiptNumber     *string   `json:"receipt_number"`
	Category          string    `json:"category"`
	ProviderID        *string   `json:"provider_id"`
	ProviderReference *string   `json:"provider_reference"`
	Status            string    `json:"status"`
	RetailAmountKobo  int64     `json:"retail_amount_kobo"`
	ProviderCostKobo  int64     `json:"provider_cost_kobo"`
	GrossProfitKobo   int64     `json:"gross_profit_kobo"`
	CreatedAt         time.Time `json:"created_at"`
}

// reconciliationLimit matches the TS source's `.range(0, 9999)`.
const reconciliationLimit = 10_000

// ReconciliationReport lists transactions newest-first for reconciliation.
func (r *Repository) ReconciliationReport(ctx context.Context) ([]ReconciliationRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, receipt_number, category, provider_id, provider_reference, status,
		       retail_amount_kobo, provider_cost_kobo, gross_profit_kobo, created_at
		FROM public.utility_transactions
		ORDER BY created_at DESC LIMIT $1`, reconciliationLimit)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: reconciliation report: %w", err)
	}
	defer rows.Close()
	out := []ReconciliationRow{}
	for rows.Next() {
		var rr ReconciliationRow
		if err := rows.Scan(&rr.ID, &rr.ReceiptNumber, &rr.Category, &rr.ProviderID,
			&rr.ProviderReference, &rr.Status, &rr.RetailAmountKobo, &rr.ProviderCostKobo,
			&rr.GrossProfitKobo, &rr.CreatedAt); err != nil {
			return nil, fmt.Errorf("utilitybills: scan reconciliation row: %w", err)
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ── Partial-update SQL builder ───────────────────────────────────────────────

// setBuilder assembles the `SET col = $n, ...` half of a partial UPDATE. It is
// the same mechanic UpdateTransaction writes inline, factored out here because
// six entities now need it and six hand-rolled copies of placeholder arithmetic
// is six chances to bind the wrong argument to the wrong column.
//
// Column names are always Go string literals from this file — never caller
// input — so they are not, and cannot become, an injection surface; every VALUE
// goes through a numbered placeholder.
type setBuilder struct {
	sets []string
	vals []any
}

func newSetBuilder() *setBuilder {
	return &setBuilder{sets: []string{"updated_at = now()"}}
}

// add appends `col = $n` with a bound value.
func (b *setBuilder) add(col string, val any) {
	b.vals = append(b.vals, val)
	b.sets = append(b.sets, fmt.Sprintf("%s = $%d", col, len(b.vals)))
}

// set appends the column only when the typed pointer is non-nil, which is the
// "leave this column alone" signal throughout this package.
func (b *setBuilder) set(col string, val any) {
	switch v := val.(type) {
	case *string:
		if v != nil {
			b.add(col, *v)
		}
	case *int:
		if v != nil {
			b.add(col, *v)
		}
	case *int64:
		if v != nil {
			b.add(col, *v)
		}
	case *bool:
		if v != nil {
			b.add(col, *v)
		}
	default:
		panic(fmt.Sprintf("utilitybills: setBuilder.set: unsupported type %T for column %s", val, col))
	}
}

// setOrNull is set() plus an explicit NULL path for nullable columns. clear
// WINS over a non-nil value, matching TransactionPatch.ClearFailureReason's
// precedence — one rule, applied everywhere, so a patch carrying both is never
// ambiguous.
func (b *setBuilder) setOrNull(col string, val any, clear bool) {
	if clear {
		b.sets = append(b.sets, col+" = NULL")
		return
	}
	b.set(col, val)
}

// empty reports whether the patch would change nothing (only updated_at).
func (b *setBuilder) empty() bool { return len(b.sets) == 1 }

// query renders the full UPDATE, keyed on keyCol, returning returningCols.
func (b *setBuilder) query(table, keyCol, returningCols string) string {
	return `UPDATE ` + table + ` SET ` + strings.Join(b.sets, ", ") +
		fmt.Sprintf(` WHERE %s = $%d RETURNING `, keyCol, len(b.vals)+1) + returningCols
}

// args returns the bound values with the key appended last, matching query().
func (b *setBuilder) args(key any) []any {
	return append(append([]any{}, b.vals...), key)
}
