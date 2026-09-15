package utilitybills

// repository.go is the ONLY file in this package that talks to Postgres. It reads
// and writes the tables created by supabase/migrations/2026061310*_utility_*.sql —
// whose shape is NOT changed by this migration (iron rule: additive only). Every
// column list below was taken from those migration files, not guessed.
//
// Access is via the pgx pool (the money-path convention in this repo), never the
// Supabase REST client the Next.js implementation used.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a requested row does not exist. Handlers map it
// to 404.
var ErrNotFound = errors.New("utilitybills: not found")

// pgUniqueViolation is Postgres's unique_violation SQLSTATE. The TS source
// branches on the same value (`insertError.code === '23505'`) to turn a lost
// idempotency race into a replay rather than a 500.
const pgUniqueViolation = "23505"

// isUniqueViolation reports whether err is a Postgres unique-constraint failure.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation
}

// Repository owns all utility_* table access.
type Repository struct {
	db *pgxpool.Pool
}

// NewRepository constructs the repository over the pgx pool.
func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ── Row types ────────────────────────────────────────────────────────────────
//
// These are DB row shapes, deliberately separate from model.go's domain types
// (Product/Provider/ProviderMapping), which carry only the fields pricing.go and
// routing.go consume. Domain() converts one to the other.

// BillerRow mirrors public.utility_billers.
type BillerRow struct {
	ID                     string `json:"id"`
	Category               string `json:"category"`
	Name                   string `json:"name"`
	Code                   string `json:"code"`
	Country                string `json:"country"`
	Status                 string `json:"status"`
	RequiresValidation     bool   `json:"requires_validation"`
	CustomerReferenceLabel string `json:"customer_reference_label"`
}

// ProductRow mirrors public.utility_products.
type ProductRow struct {
	ID                  string     `json:"id"`
	BillerID            string     `json:"biller_id"`
	Category            string     `json:"category"`
	Name                string     `json:"name"`
	Code                string     `json:"code"`
	AmountType          string     `json:"amount_type"`
	AmountKobo          *int64     `json:"amount_kobo"`
	MinAmountKobo       *int64     `json:"min_amount_kobo"`
	MaxAmountKobo       *int64     `json:"max_amount_kobo"`
	ConvenienceFeeKobo  int64      `json:"convenience_fee_kobo"`
	MarkupBps           int64      `json:"markup_bps"`
	ProviderDiscountBps int64      `json:"provider_discount_bps"`
	Status              string     `json:"status"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           *time.Time `json:"updated_at,omitempty"`
}

// Domain projects the row onto the pure pricing input type in model.go.
func (p ProductRow) Domain() Product {
	return Product{
		AmountType:          AmountType(p.AmountType),
		AmountKobo:          p.AmountKobo,
		MinAmountKobo:       p.MinAmountKobo,
		MaxAmountKobo:       p.MaxAmountKobo,
		MarkupBps:           p.MarkupBps,
		ConvenienceFeeKobo:  p.ConvenienceFeeKobo,
		ProviderDiscountBps: p.ProviderDiscountBps,
	}
}

// ProviderRow mirrors public.utility_providers. Credentials is the RAW encrypted
// JSONB envelope — it is never logged and never serialised to a client (no json
// tag that would let it escape through a handler response).
type ProviderRow struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	Code                string   `json:"code"`
	AdapterCode         string   `json:"adapter_code"`
	Status              string   `json:"status"`
	SupportedCategories []string `json:"supported_categories"`
	Priority            int      `json:"priority"`
	HealthStatus        string   `json:"health_status"`
	Credentials         []byte   `json:"-"`
	Config              []byte   `json:"-"`
}

// Domain projects the row onto the pure routing input type in model.go.
func (p ProviderRow) Domain() Provider {
	cats := make([]Category, 0, len(p.SupportedCategories))
	for _, c := range p.SupportedCategories {
		cats = append(cats, Category(c))
	}
	return Provider{
		ID:                  p.ID,
		Status:              ProviderOperationalStatus(p.Status),
		HealthStatus:        HealthStatus(p.HealthStatus),
		SupportedCategories: cats,
		Priority:            p.Priority,
	}
}

// TimeoutMs reads the provider's configured purchase timeout out of its config
// JSONB, porting provider-timeout.ts's getUtilityProviderTimeoutMs: an integer
// >= 1000 in config.timeout_ms wins, capped at 120s; otherwise the caller's
// default (the env fallback, resolved once at wiring time) applies.
func (p ProviderRow) TimeoutMs(fallbackMs int) int {
	const minMs, maxMs = 1000, 120_000
	if len(p.Config) > 0 {
		var cfg struct {
			TimeoutMs *json.Number `json:"timeout_ms"`
		}
		if err := json.Unmarshal(p.Config, &cfg); err == nil && cfg.TimeoutMs != nil {
			// json.Number keeps the value off float64 — a config value is not money,
			// but the repo's no-floats-for-integers habit is cheap to keep.
			if v, err := cfg.TimeoutMs.Int64(); err == nil && v >= minMs {
				if v > maxMs {
					return maxMs
				}
				return int(v)
			}
		}
	}
	if fallbackMs >= minMs {
		if fallbackMs > maxMs {
			return maxMs
		}
		return fallbackMs
	}
	return 15_000
}

// MappingRow mirrors public.utility_provider_product_mappings.
type MappingRow struct {
	ID                  string `json:"id"`
	ProviderID          string `json:"provider_id"`
	ProductID           string `json:"product_id"`
	ProviderProductCode string `json:"provider_product_code"`
	ProviderBillerCode  string `json:"provider_biller_code"`
	ProviderCostKobo    *int64 `json:"provider_cost_kobo"`
	ProviderDiscountBps int64  `json:"provider_discount_bps"`
	Status              string `json:"status"`
}

// Domain projects the row onto the pure pricing/routing input type in model.go.
func (m MappingRow) Domain() ProviderMapping {
	return ProviderMapping{
		Status:              MappingStatus(m.Status),
		ProviderCostKobo:    m.ProviderCostKobo,
		ProviderDiscountBps: m.ProviderDiscountBps,
	}
}

// Route pairs a routing.go RouteCandidate with the full DB rows behind it. The
// pure filter/sort in routing.go deliberately works on the slim domain types, so
// the service re-associates the winner with its rows by Provider.ID (unique per
// product: utility_provider_product_mappings has UNIQUE(provider_id, product_id)).
type Route struct {
	Candidate RouteCandidate
	Provider  ProviderRow
	Mapping   MappingRow
}

// CategorySettingRow mirrors public.utility_category_settings.
type CategorySettingRow struct {
	Category            string `json:"category"`
	Enabled             bool   `json:"enabled"`
	AvailabilityMessage string `json:"availability_message"`
	DailyLimitKobo      *int64 `json:"daily_limit_kobo"`
	MinAmountKobo       *int64 `json:"min_amount_kobo"`
	MaxAmountKobo       *int64 `json:"max_amount_kobo"`
}

// TransactionRow mirrors public.utility_transactions.
type TransactionRow struct {
	ID                 string          `json:"id"`
	UserID             string          `json:"user_id"`
	Category           string          `json:"category"`
	BillerID           string          `json:"biller_id"`
	ProductID          *string         `json:"product_id"`
	ProviderID         *string         `json:"provider_id"`
	ProviderMappingID  *string         `json:"provider_mapping_id"`
	CustomerReference  string          `json:"customer_reference"`
	CustomerName       *string         `json:"customer_name"`
	AmountKobo         int64           `json:"amount_kobo"`
	ConvenienceFeeKobo int64           `json:"convenience_fee_kobo"`
	RetailAmountKobo   int64           `json:"retail_amount_kobo"`
	ProviderCostKobo   int64           `json:"provider_cost_kobo"`
	GrossProfitKobo    int64           `json:"gross_profit_kobo"`
	GrossMarginBps     int64           `json:"gross_margin_bps"`
	Status             string          `json:"status"`
	ProviderReference  *string         `json:"provider_reference"`
	Token              *string         `json:"token"`
	ReceiptNumber      *string         `json:"receipt_number"`
	IdempotencyKey     string          `json:"idempotency_key"`
	PaymentSource      string          `json:"payment_source"`
	FailureReason      *string         `json:"failure_reason"`
	ProviderResponse   json.RawMessage `json:"provider_response,omitempty"`
	Metadata           json.RawMessage `json:"metadata,omitempty"`
	CreatedAt          time.Time       `json:"created_at"`
	UpdatedAt          time.Time       `json:"updated_at"`
}

// AttemptRow mirrors public.utility_provider_attempts.
type AttemptRow struct {
	ID                    string          `json:"id"`
	TransactionID         string          `json:"transaction_id"`
	ProviderID            string          `json:"provider_id"`
	ProviderMappingID     *string         `json:"provider_mapping_id"`
	AttemptNumber         int             `json:"attempt_number"`
	Status                string          `json:"status"`
	RequestIdempotencyKey string          `json:"request_idempotency_key"`
	ProviderReference     *string         `json:"provider_reference"`
	Message               *string         `json:"message"`
	RawResponse           json.RawMessage `json:"raw_response,omitempty"`
	StartedAt             time.Time       `json:"started_at"`
	CompletedAt           *time.Time      `json:"completed_at"`
	DurationMs            *int            `json:"duration_ms"`
	TimeoutMs             *int            `json:"timeout_ms"`
}

// BeneficiaryRow mirrors public.saved_utility_beneficiaries.
type BeneficiaryRow struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	Category          string    `json:"category"`
	BillerID          string    `json:"biller_id"`
	Label             string    `json:"label"`
	CustomerReference string    `json:"customer_reference"`
	CustomerName      *string   `json:"customer_name"`
	CreatedAt         time.Time `json:"created_at"`
}

// DisputeRow mirrors public.utility_disputes.
type DisputeRow struct {
	ID             string    `json:"id"`
	TransactionID  string    `json:"transaction_id"`
	UserID         string    `json:"user_id"`
	Reason         string    `json:"reason"`
	Status         string    `json:"status"`
	ResolutionNote *string   `json:"resolution_note"`
	CreatedAt      time.Time `json:"created_at"`
}

// ── Catalogue reads ──────────────────────────────────────────────────────────

const billerCols = `id, category, name, code, country, status, requires_validation, customer_reference_label`

func scanBiller(row pgx.Row) (*BillerRow, error) {
	var b BillerRow
	if err := row.Scan(&b.ID, &b.Category, &b.Name, &b.Code, &b.Country, &b.Status,
		&b.RequiresValidation, &b.CustomerReferenceLabel); err != nil {
		return nil, err
	}
	return &b, nil
}

// GetBiller loads one biller by id. Mirrors service.ts's getBiller (404 on miss).
func (r *Repository) GetBiller(ctx context.Context, id string) (*BillerRow, error) {
	b, err := scanBiller(r.db.QueryRow(ctx, `SELECT `+billerCols+` FROM public.utility_billers WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility biller %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get biller: %w", err)
	}
	return b, nil
}

// ListBillers returns active billers, optionally filtered by category. Mirrors
// service.ts's listBillers (status='active', ordered by name).
func (r *Repository) ListBillers(ctx context.Context, category string) ([]BillerRow, error) {
	q := `SELECT ` + billerCols + ` FROM public.utility_billers WHERE status = 'active'`
	args := []any{}
	if category != "" {
		q += ` AND category = $1`
		args = append(args, category)
	}
	q += ` ORDER BY name ASC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: list billers: %w", err)
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

const productCols = `id, biller_id, category, name, code, amount_type, amount_kobo, min_amount_kobo,
	max_amount_kobo, convenience_fee_kobo, markup_bps, provider_discount_bps, status, created_at`

func scanProduct(row pgx.Row) (*ProductRow, error) {
	var p ProductRow
	if err := row.Scan(&p.ID, &p.BillerID, &p.Category, &p.Name, &p.Code, &p.AmountType,
		&p.AmountKobo, &p.MinAmountKobo, &p.MaxAmountKobo, &p.ConvenienceFeeKobo,
		&p.MarkupBps, &p.ProviderDiscountBps, &p.Status, &p.CreatedAt); err != nil {
		return nil, err
	}
	return &p, nil
}

// GetProduct loads one product by id. Mirrors service.ts's getProduct.
func (r *Repository) GetProduct(ctx context.Context, id string) (*ProductRow, error) {
	p, err := scanProduct(r.db.QueryRow(ctx, `SELECT `+productCols+` FROM public.utility_products WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility product %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get product: %w", err)
	}
	return p, nil
}

// ListProducts returns active products filtered by category and/or biller.
func (r *Repository) ListProducts(ctx context.Context, category, billerID string) ([]ProductRow, error) {
	q := `SELECT ` + productCols + ` FROM public.utility_products WHERE status = 'active'`
	args := []any{}
	if category != "" {
		args = append(args, category)
		q += fmt.Sprintf(` AND category = $%d`, len(args))
	}
	if billerID != "" {
		args = append(args, billerID)
		q += fmt.Sprintf(` AND biller_id = $%d`, len(args))
	}
	q += ` ORDER BY name ASC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: list products: %w", err)
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

// GetProvider loads one provider row by id (used by requery, which must reach the
// SAME provider the purchase went to).
func (r *Repository) GetProvider(ctx context.Context, id string) (*ProviderRow, error) {
	var p ProviderRow
	err := r.db.QueryRow(ctx, `
		SELECT id, name, code, adapter_code, status, supported_categories, priority,
		       health_status, credentials, config
		FROM public.utility_providers WHERE id = $1`, id).
		Scan(&p.ID, &p.Name, &p.Code, &p.AdapterCode, &p.Status, &p.SupportedCategories,
			&p.Priority, &p.HealthStatus, &p.Credentials, &p.Config)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility provider %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get provider: %w", err)
	}
	return &p, nil
}

// GetRouteCandidates ports service.ts's getRouteCandidates: every ACTIVE mapping
// for the product joined to its provider, with the route priority taken from an
// active utility_routing_rules row when one exists, else the provider's own
// priority, else 100 (the TS `??` chain, reproduced here in SQL via COALESCE —
// note SQL COALESCE matches JS `??` semantics, NOT `||`: a priority of 0 is kept,
// not skipped).
func (r *Repository) GetRouteCandidates(ctx context.Context, productID string) ([]Route, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			m.id, m.provider_id, m.product_id, m.provider_product_code,
			COALESCE(m.provider_biller_code, ''), m.provider_cost_kobo,
			m.provider_discount_bps, m.status,
			p.id, p.name, p.code, p.adapter_code, p.status, p.supported_categories,
			p.priority, p.health_status, p.credentials, p.config,
			COALESCE(rr.priority, p.priority, 100) AS route_priority
		FROM public.utility_provider_product_mappings m
		JOIN public.utility_providers p ON p.id = m.provider_id
		LEFT JOIN LATERAL (
			SELECT priority FROM public.utility_routing_rules
			WHERE product_id = m.product_id AND provider_id = m.provider_id AND status = 'active'
			ORDER BY priority ASC LIMIT 1
		) rr ON true
		WHERE m.product_id = $1 AND m.status = 'active'`, productID)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get route candidates: %w", err)
	}
	defer rows.Close()

	out := []Route{}
	for rows.Next() {
		var (
			m        MappingRow
			p        ProviderRow
			priority int
		)
		if err := rows.Scan(
			&m.ID, &m.ProviderID, &m.ProductID, &m.ProviderProductCode,
			&m.ProviderBillerCode, &m.ProviderCostKobo, &m.ProviderDiscountBps, &m.Status,
			&p.ID, &p.Name, &p.Code, &p.AdapterCode, &p.Status, &p.SupportedCategories,
			&p.Priority, &p.HealthStatus, &p.Credentials, &p.Config,
			&priority,
		); err != nil {
			return nil, fmt.Errorf("utilitybills: scan route candidate: %w", err)
		}
		out = append(out, Route{
			Candidate: RouteCandidate{
				Provider: p.Domain(),
				Mapping:  m.Domain(),
				Priority: priority,
			},
			Provider: p,
			Mapping:  m,
		})
	}
	return out, rows.Err()
}

// ── Category settings ────────────────────────────────────────────────────────

// GetCategorySetting loads the category-level controls, or (nil, nil) when the
// category has no row — service.ts's assertCategoryAvailableForPayment treats a
// missing row as "no category-level restriction", NOT as a failure.
func (r *Repository) GetCategorySetting(ctx context.Context, category string) (*CategorySettingRow, error) {
	var s CategorySettingRow
	var msg *string
	err := r.db.QueryRow(ctx, `
		SELECT category, enabled, availability_message, daily_limit_kobo, min_amount_kobo, max_amount_kobo
		FROM public.utility_category_settings WHERE category = $1`, category).
		Scan(&s.Category, &s.Enabled, &msg, &s.DailyLimitKobo, &s.MinAmountKobo, &s.MaxAmountKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get category setting: %w", err)
	}
	if msg != nil {
		s.AvailabilityMessage = *msg
	}
	return &s, nil
}

// ListCategorySettings returns every enabled category setting (for the member
// catalogue endpoint).
func (r *Repository) ListCategorySettings(ctx context.Context) ([]CategorySettingRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT category, enabled, COALESCE(availability_message,''), daily_limit_kobo, min_amount_kobo, max_amount_kobo
		FROM public.utility_category_settings WHERE enabled = true ORDER BY category ASC`)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: list category settings: %w", err)
	}
	defer rows.Close()
	out := []CategorySettingRow{}
	for rows.Next() {
		var s CategorySettingRow
		if err := rows.Scan(&s.Category, &s.Enabled, &s.AvailabilityMessage,
			&s.DailyLimitKobo, &s.MinAmountKobo, &s.MaxAmountKobo); err != nil {
			return nil, fmt.Errorf("utilitybills: scan category setting: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// CategorySpendToday sums today's committed spend for (user, category), porting
// the TS query exactly — including its status set, which counts wallet_debited /
// provider_pending / successful / disputed and deliberately EXCLUDES failed and
// reversed (money that came back does not consume the day's allowance).
//
// One deliberate divergence, flagged: the TS source computes "today" with
// `new Date(); start.setHours(0,0,0,0)` — midnight in the SERVER's local zone,
// whatever that happens to be. This uses the database's own date_trunc in UTC, to
// match how tiers.getDailyDebited (the wallet-side limit this module also rides
// on) defines a day. Two limits on the same purchase disagreeing about when a day
// starts is a support ticket waiting to happen.
func (r *Repository) CategorySpendToday(ctx context.Context, userID, category string) (int64, error) {
	var total int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(retail_amount_kobo), 0)
		FROM public.utility_transactions
		WHERE user_id = $1 AND category = $2
		  AND status IN ('wallet_debited','provider_pending','successful','disputed')
		  AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`, userID, category).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("utilitybills: category spend today: %w", err)
	}
	return total, nil
}

// ── Transactions ─────────────────────────────────────────────────────────────

const transactionCols = `id, user_id, category, biller_id, product_id, provider_id, provider_mapping_id,
	customer_reference, customer_name, amount_kobo, convenience_fee_kobo, retail_amount_kobo,
	provider_cost_kobo, gross_profit_kobo, gross_margin_bps, status, provider_reference, token,
	receipt_number, idempotency_key, payment_source, failure_reason, provider_response, metadata,
	created_at, updated_at`

func scanTransaction(row pgx.Row) (*TransactionRow, error) {
	var t TransactionRow
	if err := row.Scan(&t.ID, &t.UserID, &t.Category, &t.BillerID, &t.ProductID, &t.ProviderID,
		&t.ProviderMappingID, &t.CustomerReference, &t.CustomerName, &t.AmountKobo,
		&t.ConvenienceFeeKobo, &t.RetailAmountKobo, &t.ProviderCostKobo, &t.GrossProfitKobo,
		&t.GrossMarginBps, &t.Status, &t.ProviderReference, &t.Token, &t.ReceiptNumber,
		&t.IdempotencyKey, &t.PaymentSource, &t.FailureReason, &t.ProviderResponse, &t.Metadata,
		&t.CreatedAt, &t.UpdatedAt); err != nil {
		return nil, err
	}
	return &t, nil
}

// GetTransactionByIdempotencyKey is the FIRST of the two idempotency layers on
// pay (the pre-check). The second is the unique constraint on idempotency_key,
// caught as 23505 by InsertTransaction — a pre-check alone loses the race between
// two concurrent identical requests.
func (r *Repository) GetTransactionByIdempotencyKey(ctx context.Context, key string) (*TransactionRow, error) {
	t, err := scanTransaction(r.db.QueryRow(ctx,
		`SELECT `+transactionCols+` FROM public.utility_transactions WHERE idempotency_key = $1`, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // not a failure: "nobody has used this key" is the normal path
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get transaction by idempotency key: %w", err)
	}
	return t, nil
}

// GetTransaction loads a transaction by id with NO ownership filter. Admin/
// requery path only — the member-facing read is GetUserTransaction.
func (r *Repository) GetTransaction(ctx context.Context, id string) (*TransactionRow, error) {
	t, err := scanTransaction(r.db.QueryRow(ctx,
		`SELECT `+transactionCols+` FROM public.utility_transactions WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility transaction %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get transaction: %w", err)
	}
	return t, nil
}

// GetUserTransaction loads a transaction scoped to its owner. The user_id
// predicate is the object-level authZ: a member asking for someone else's
// transaction gets ErrNotFound, never the row.
func (r *Repository) GetUserTransaction(ctx context.Context, userID, id string) (*TransactionRow, error) {
	t, err := scanTransaction(r.db.QueryRow(ctx,
		`SELECT `+transactionCols+` FROM public.utility_transactions WHERE id = $1 AND user_id = $2`, id, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility transaction %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: get user transaction: %w", err)
	}
	return t, nil
}

// ListUserTransactions returns a member's transactions, newest first.
func (r *Repository) ListUserTransactions(ctx context.Context, userID string, limit, offset int) ([]TransactionRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := r.db.Query(ctx, `SELECT `+transactionCols+`
		FROM public.utility_transactions WHERE user_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: list user transactions: %w", err)
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

// InsertTransaction creates the initiated transaction row.
//
// Returns (row, false, nil) on a fresh insert and (existing, true, nil) when the
// unique idempotency_key was claimed concurrently — porting service.ts's 23505
// branch, which re-reads the winner's row and reports it as already processed
// rather than surfacing a 500 to a caller who simply retried.
func (r *Repository) InsertTransaction(ctx context.Context, t *TransactionRow) (*TransactionRow, bool, error) {
	metadata := t.Metadata
	if len(metadata) == 0 {
		metadata = json.RawMessage(`{}`)
	}
	inserted, err := scanTransaction(r.db.QueryRow(ctx, `
		INSERT INTO public.utility_transactions (
			id, user_id, category, biller_id, product_id, provider_id, provider_mapping_id,
			customer_reference, customer_name, amount_kobo, convenience_fee_kobo, retail_amount_kobo,
			provider_cost_kobo, gross_profit_kobo, gross_margin_bps, status, receipt_number,
			idempotency_key, payment_source, metadata
		) VALUES (
			COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7,
			$8, $9, $10, $11, $12,
			$13, $14, $15, $16, $17,
			$18, $19, $20
		) RETURNING `+transactionCols,
		nullIfEmpty(t.ID), t.UserID, t.Category, t.BillerID, t.ProductID, t.ProviderID, t.ProviderMappingID,
		t.CustomerReference, t.CustomerName, t.AmountKobo, t.ConvenienceFeeKobo, t.RetailAmountKobo,
		t.ProviderCostKobo, t.GrossProfitKobo, t.GrossMarginBps, t.Status, t.ReceiptNumber,
		t.IdempotencyKey, t.PaymentSource, metadata))
	if err == nil {
		return inserted, false, nil
	}
	if isUniqueViolation(err) {
		existing, rerr := r.GetTransactionByIdempotencyKey(ctx, t.IdempotencyKey)
		if rerr == nil && existing != nil {
			return existing, true, nil
		}
		// The collision was on some OTHER unique column (receipt_number is the only
		// other one). Surface it rather than pretending it was a replay.
		return nil, false, fmt.Errorf("utilitybills: insert transaction (unique violation, not the idempotency key): %w", err)
	}
	return nil, false, fmt.Errorf("utilitybills: insert transaction: %w", err)
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// TransactionPatch is the settle-time update applied after the provider answers.
// Only non-nil fields are written, so a patch can advance the status without
// clobbering a token or provider reference an earlier step recorded.
type TransactionPatch struct {
	Status            *string
	ProviderID        *string
	ProviderMappingID *string
	ProviderReference *string
	Token             *string
	ProviderResponse  json.RawMessage
	FailureReason     *string
	// ClearFailureReason forces failure_reason to NULL (a successful requery of a
	// previously-failed transaction must not leave the old reason behind). Takes
	// precedence over FailureReason.
	ClearFailureReason bool
}

// UpdateTransaction applies a partial patch and returns the updated row.
func (r *Repository) UpdateTransaction(ctx context.Context, id string, patch TransactionPatch) (*TransactionRow, error) {
	sets := []string{"updated_at = now()"}
	args := []any{}
	add := func(col string, val any) {
		args = append(args, val)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}
	if patch.Status != nil {
		add("status", *patch.Status)
	}
	if patch.ProviderID != nil {
		add("provider_id", *patch.ProviderID)
	}
	if patch.ProviderMappingID != nil {
		add("provider_mapping_id", *patch.ProviderMappingID)
	}
	if patch.ProviderReference != nil {
		add("provider_reference", *patch.ProviderReference)
	}
	if patch.Token != nil {
		add("token", *patch.Token)
	}
	if len(patch.ProviderResponse) > 0 {
		add("provider_response", patch.ProviderResponse)
	}
	switch {
	case patch.ClearFailureReason:
		sets = append(sets, "failure_reason = NULL")
	case patch.FailureReason != nil:
		add("failure_reason", *patch.FailureReason)
	}

	args = append(args, id)
	q := `UPDATE public.utility_transactions SET ` + strings.Join(sets, ", ") +
		fmt.Sprintf(` WHERE id = $%d RETURNING `, len(args)) + transactionCols
	t, err := scanTransaction(r.db.QueryRow(ctx, q, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: utility transaction %s", ErrNotFound, id)
	}
	if err != nil {
		return nil, fmt.Errorf("utilitybills: update transaction: %w", err)
	}
	return t, nil
}

// ── Events ───────────────────────────────────────────────────────────────────

// AddEvent appends to the immutable per-transaction event trail. BEST-EFFORT by
// design (the TS source does not check its result either): an event that fails to
// write must never fail or reverse a payment, so callers log and continue.
func (r *Repository) AddEvent(ctx context.Context, transactionID, eventType, message string, payload any) error {
	body := json.RawMessage(`{}`)
	if payload != nil {
		if b, err := json.Marshal(payload); err == nil {
			body = b
		}
	}
	var msg any
	if message != "" {
		msg = message
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.utility_transaction_events (transaction_id, event_type, message, payload)
		VALUES ($1, $2, $3, $4)`, transactionID, eventType, msg, body)
	if err != nil {
		return fmt.Errorf("utilitybills: add event: %w", err)
	}
	return nil
}

// ── Provider attempts ────────────────────────────────────────────────────────

// StartAttempt records the 'started' attempt row before the provider call, so an
// attempt that never returns still leaves a trace. Mirrors recordProviderAttempt.
func (r *Repository) StartAttempt(ctx context.Context, transactionID, providerID, mappingID string, attemptNumber int, requestKey string) (*AttemptRow, error) {
	var a AttemptRow
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.utility_provider_attempts
			(transaction_id, provider_id, provider_mapping_id, attempt_number, status, request_idempotency_key)
		VALUES ($1, $2, $3, $4, 'started', $5)
		RETURNING id, transaction_id, provider_id, provider_mapping_id, attempt_number, status,
		          request_idempotency_key, provider_reference, message, raw_response, started_at,
		          completed_at, duration_ms, timeout_ms`,
		transactionID, providerID, nullIfEmpty(mappingID), attemptNumber, requestKey).
		Scan(&a.ID, &a.TransactionID, &a.ProviderID, &a.ProviderMappingID, &a.AttemptNumber, &a.Status,
			&a.RequestIdempotencyKey, &a.ProviderReference, &a.Message, &a.RawResponse, &a.StartedAt,
			&a.CompletedAt, &a.DurationMs, &a.TimeoutMs)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: start provider attempt: %w", err)
	}
	return &a, nil
}

// AttemptOutcome is the terminal patch for one attempt row.
type AttemptOutcome struct {
	// Status is the attempt vocabulary from the migration's CHECK constraint:
	// started | successful | pending | failed | timeout | error. Note this is a
	// DIFFERENT vocabulary from ProviderOutcome — 'timeout' and 'error' exist here
	// for observability and have no domain-status counterpart.
	Status            string
	ProviderReference string
	Message           string
	RawResponse       json.RawMessage
	TimeoutMs         int
}

// FinishAttempt closes an attempt row, computing duration_ms from started_at in
// the database (not from a Go clock) so the value cannot drift with process
// scheduling.
func (r *Repository) FinishAttempt(ctx context.Context, attemptID string, out AttemptOutcome) error {
	var ref, msg, timeoutMs any
	if out.ProviderReference != "" {
		ref = out.ProviderReference
	}
	if out.Message != "" {
		msg = out.Message
	}
	if out.TimeoutMs > 0 {
		timeoutMs = out.TimeoutMs
	}
	var raw any
	if len(out.RawResponse) > 0 {
		raw = []byte(out.RawResponse)
	}
	_, err := r.db.Exec(ctx, `
		UPDATE public.utility_provider_attempts
		SET status = $2, provider_reference = $3, message = $4, raw_response = $5,
		    completed_at = now(),
		    duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int),
		    timeout_ms = $6
		WHERE id = $1`, attemptID, out.Status, ref, msg, raw, timeoutMs)
	if err != nil {
		return fmt.Errorf("utilitybills: finish provider attempt: %w", err)
	}
	return nil
}

// ListAttempts returns a transaction's attempt trail in attempt order.
func (r *Repository) ListAttempts(ctx context.Context, transactionID string) ([]AttemptRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, transaction_id, provider_id, provider_mapping_id, attempt_number, status,
		       request_idempotency_key, provider_reference, message, raw_response, started_at,
		       completed_at, duration_ms, timeout_ms
		FROM public.utility_provider_attempts
		WHERE transaction_id = $1 ORDER BY attempt_number ASC`, transactionID)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: list provider attempts: %w", err)
	}
	defer rows.Close()
	out := []AttemptRow{}
	for rows.Next() {
		var a AttemptRow
		if err := rows.Scan(&a.ID, &a.TransactionID, &a.ProviderID, &a.ProviderMappingID,
			&a.AttemptNumber, &a.Status, &a.RequestIdempotencyKey, &a.ProviderReference, &a.Message,
			&a.RawResponse, &a.StartedAt, &a.CompletedAt, &a.DurationMs, &a.TimeoutMs); err != nil {
			return nil, fmt.Errorf("utilitybills: scan provider attempt: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ── Disputes ─────────────────────────────────────────────────────────────────

// InsertDispute opens a dispute against a transaction.
func (r *Repository) InsertDispute(ctx context.Context, transactionID, userID, reason string) (*DisputeRow, error) {
	var d DisputeRow
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.utility_disputes (transaction_id, user_id, reason)
		VALUES ($1, $2, $3)
		RETURNING id, transaction_id, user_id, reason, status, resolution_note, created_at`,
		transactionID, userID, reason).
		Scan(&d.ID, &d.TransactionID, &d.UserID, &d.Reason, &d.Status, &d.ResolutionNote, &d.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("utilitybills: insert dispute: %w", err)
	}
	return &d, nil
}
