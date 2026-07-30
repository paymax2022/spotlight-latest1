package commission

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrConfigNotFound is returned when no active rate card resolves for a lookup.
var ErrConfigNotFound = errors.New("commission: no active config for service")

// Repository handles all commission DB operations over a pgx pool.
// commission_config is mutable (audited); commission_earnings is append-only.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{db: db}
}

const configCols = `
	id, service_category, service, service_subtype, fee_model,
	commission_bps, platform_charge_bps, convenience_fee_kobo, fixed_fee_kobo,
	fee_payer, currency, active, COALESCE(notes,''), updated_by, updated_at, created_at`

// scanConfig reads one commission_config row from any pgx row.
func scanConfig(row pgx.Row) (*Config, error) {
	var c Config
	err := row.Scan(
		&c.ID, &c.ServiceCategory, &c.Service, &c.ServiceSubtype, &c.FeeModel,
		&c.CommissionBps, &c.PlatformChargeBps, &c.ConvenienceFeeKobo, &c.FixedFeeKobo,
		&c.FeePayer, &c.Currency, &c.Active, &c.Notes, &c.UpdatedBy, &c.UpdatedAt, &c.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ListConfig returns configs, optionally filtered by category and/or active-only,
// ordered for stable grouped display (category → service → subtype).
func (r *Repository) ListConfig(ctx context.Context, category string, activeOnly bool) ([]Config, error) {
	q := `SELECT ` + configCols + ` FROM public.commission_config WHERE 1=1`
	args := []any{}
	if category != "" {
		args = append(args, category)
		q += fmt.Sprintf(" AND service_category = $%d", len(args))
	}
	if activeOnly {
		q += " AND active"
	}
	q += " ORDER BY service_category, service, service_subtype"

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("commission: list config: %w", err)
	}
	defer rows.Close()

	out := []Config{}
	for rows.Next() {
		c, err := scanConfig(rows)
		if err != nil {
			return nil, fmt.Errorf("commission: scan config: %w", err)
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// GetByID fetches a single config by primary key.
func (r *Repository) GetByID(ctx context.Context, id string) (*Config, error) {
	q := `SELECT ` + configCols + ` FROM public.commission_config WHERE id = $1`
	c, err := scanConfig(r.db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConfigNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("commission: get by id: %w", err)
	}
	return c, nil
}

// GetByKey resolves the active config for a (category, service, subtype) triple
// with FALLBACK: exact subtype match first, then the service-level row
// (subtype = ”). Only active rows are considered.
func (r *Repository) GetByKey(ctx context.Context, category, service, subtype string) (*Config, error) {
	q := `SELECT ` + configCols + `
		FROM public.commission_config
		WHERE active AND service_category = $1 AND service = $2 AND service_subtype = $3`

	// Exact subtype.
	if subtype != "" {
		c, err := scanConfig(r.db.QueryRow(ctx, q, category, service, subtype))
		if err == nil {
			return c, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("commission: get by key (exact): %w", err)
		}
		// fall through to service-level.
	}

	// Service-level fallback (subtype = '').
	c, err := scanConfig(r.db.QueryRow(ctx, q, category, service, ""))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConfigNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("commission: get by key (fallback): %w", err)
	}
	return c, nil
}

// UpsertConfig inserts a new config or updates the existing row that collides on
// the UNIQUE(category, service, subtype) key. Returns the persisted row.
func (r *Repository) UpsertConfig(ctx context.Context, in ConfigInput, updatedBy *string) (*Config, error) {
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	feeModel := in.FeeModel
	if feeModel == "" {
		feeModel = string(FeeModelNone)
	}
	feePayer := in.FeePayer
	if feePayer == "" {
		feePayer = FeePayerCustomer
	}
	currency := in.Currency
	if currency == "" {
		currency = "NGN"
	}

	q := `
		INSERT INTO public.commission_config
			(service_category, service, service_subtype, fee_model,
			 commission_bps, platform_charge_bps, convenience_fee_kobo, fixed_fee_kobo,
			 fee_payer, currency, active, notes, updated_by, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
		ON CONFLICT (service_category, service, service_subtype) DO UPDATE SET
			fee_model            = EXCLUDED.fee_model,
			commission_bps       = EXCLUDED.commission_bps,
			platform_charge_bps  = EXCLUDED.platform_charge_bps,
			convenience_fee_kobo = EXCLUDED.convenience_fee_kobo,
			fixed_fee_kobo       = EXCLUDED.fixed_fee_kobo,
			fee_payer            = EXCLUDED.fee_payer,
			currency             = EXCLUDED.currency,
			active               = EXCLUDED.active,
			notes                = EXCLUDED.notes,
			updated_by           = EXCLUDED.updated_by,
			updated_at           = now()
		RETURNING ` + configCols
	row := r.db.QueryRow(ctx, q,
		in.ServiceCategory, in.Service, in.ServiceSubtype, feeModel,
		in.CommissionBps, in.PlatformChargeBps, in.ConvenienceFeeKobo, in.FixedFeeKobo,
		feePayer, currency, active, nullableStr(in.Notes), updatedBy)
	c, err := scanConfig(row)
	if err != nil {
		return nil, fmt.Errorf("commission: upsert config: %w", err)
	}
	return c, nil
}

// UpdateConfigByID updates rates/attributes of an existing config identified by id.
// The identity columns (category/service/subtype) are NOT changed.
func (r *Repository) UpdateConfigByID(ctx context.Context, id string, in ConfigInput, updatedBy *string) (*Config, error) {
	active := true
	if in.Active != nil {
		active = *in.Active
	}
	feeModel := in.FeeModel
	if feeModel == "" {
		feeModel = string(FeeModelNone)
	}
	feePayer := in.FeePayer
	if feePayer == "" {
		feePayer = FeePayerCustomer
	}
	currency := in.Currency
	if currency == "" {
		currency = "NGN"
	}

	q := `
		UPDATE public.commission_config SET
			fee_model            = $2,
			commission_bps       = $3,
			platform_charge_bps  = $4,
			convenience_fee_kobo = $5,
			fixed_fee_kobo       = $6,
			fee_payer            = $7,
			currency             = $8,
			active               = $9,
			notes                = $10,
			updated_by           = $11,
			updated_at           = now()
		WHERE id = $1
		RETURNING ` + configCols
	row := r.db.QueryRow(ctx, q, id,
		feeModel, in.CommissionBps, in.PlatformChargeBps, in.ConvenienceFeeKobo, in.FixedFeeKobo,
		feePayer, currency, active, nullableStr(in.Notes), updatedBy)
	c, err := scanConfig(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConfigNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("commission: update config: %w", err)
	}
	return c, nil
}

// SetActive flips a config's active flag and returns the updated row.
func (r *Repository) SetActive(ctx context.Context, id string, active bool, updatedBy *string) (*Config, error) {
	q := `
		UPDATE public.commission_config
		SET active = $2, updated_by = $3, updated_at = now()
		WHERE id = $1
		RETURNING ` + configCols
	c, err := scanConfig(r.db.QueryRow(ctx, q, id, active, updatedBy))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConfigNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("commission: set active: %w", err)
	}
	return c, nil
}

// InsertAudit appends one immutable change-audit row. before/after may be nil
// (→ SQL NULL jsonb); changedBy nil = system.
func (r *Repository) InsertAudit(ctx context.Context, configID, action string, before, after map[string]any, changedBy *string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.commission_config_audit (config_id, action, before, after, changed_by)
		VALUES ($1,$2,$3,$4,$5)`,
		nullableStr(configID), action, jsonbOrNil(before), jsonbOrNil(after), changedBy)
	if err != nil {
		return fmt.Errorf("commission: insert audit: %w", err)
	}
	return nil
}

// InsertEarning idempotently appends a realized-earning row. On idempotency_key
// conflict it does NOT insert; instead it returns the pre-existing row so the
// caller sees a stable result. inserted reports whether a new row was written.
func (r *Repository) InsertEarning(ctx context.Context, e *Earning) (out *Earning, inserted bool, err error) {
	q := `
		INSERT INTO public.commission_earnings
			(config_id, service_category, service, service_subtype,
			 gross_amount_kobo, commission_kobo, platform_charge_kobo, convenience_fee_kobo, fixed_fee_kobo,
			 spotlight_revenue_kobo, currency, source_module, source_ref, ledger_ref, user_id, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		ON CONFLICT (idempotency_key) DO NOTHING
		RETURNING id, created_at`
	var id string
	var createdAt time.Time
	err = r.db.QueryRow(ctx, q,
		e.ConfigID, e.ServiceCategory, e.Service, e.ServiceSubtype,
		e.GrossAmountKobo, e.CommissionKobo, e.PlatformChargeKobo, e.ConvenienceFeeKobo, e.FixedFeeKobo,
		e.SpotlightRevenueKobo, e.Currency, e.SourceModule, e.SourceRef, e.LedgerRef, e.UserID, e.IdempotencyKey,
	).Scan(&id, &createdAt)

	if err == nil {
		e.ID = id
		e.CreatedAt = createdAt
		return e, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, fmt.Errorf("commission: insert earning: %w", err)
	}

	// Duplicate — fetch and return the pre-existing row.
	if e.IdempotencyKey == nil {
		return nil, false, fmt.Errorf("commission: earning conflict without idempotency key")
	}
	existing, gerr := r.GetEarningByIdempotencyKey(ctx, *e.IdempotencyKey)
	if gerr != nil {
		return nil, false, gerr
	}
	return existing, false, nil
}

const earningCols = `
	id, config_id, service_category, service, service_subtype,
	gross_amount_kobo, commission_kobo, platform_charge_kobo, convenience_fee_kobo, fixed_fee_kobo,
	spotlight_revenue_kobo, currency, source_module, source_ref, ledger_ref, user_id, idempotency_key, created_at`

func scanEarning(row pgx.Row) (*Earning, error) {
	var e Earning
	err := row.Scan(
		&e.ID, &e.ConfigID, &e.ServiceCategory, &e.Service, &e.ServiceSubtype,
		&e.GrossAmountKobo, &e.CommissionKobo, &e.PlatformChargeKobo, &e.ConvenienceFeeKobo, &e.FixedFeeKobo,
		&e.SpotlightRevenueKobo, &e.Currency, &e.SourceModule, &e.SourceRef, &e.LedgerRef, &e.UserID, &e.IdempotencyKey, &e.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// GetEarningByIdempotencyKey fetches a single earning by its idempotency key.
func (r *Repository) GetEarningByIdempotencyKey(ctx context.Context, key string) (*Earning, error) {
	q := `SELECT ` + earningCols + ` FROM public.commission_earnings WHERE idempotency_key = $1`
	e, err := scanEarning(r.db.QueryRow(ctx, q, key))
	if err != nil {
		return nil, fmt.Errorf("commission: get earning by key: %w", err)
	}
	return e, nil
}

// ListEarnings returns raw earning rows in a date range, optionally filtered by
// category, newest first, capped by limit.
func (r *Repository) ListEarnings(ctx context.Context, from, to time.Time, category string, limit int) ([]Earning, error) {
	q := `SELECT ` + earningCols + `
		FROM public.commission_earnings
		WHERE created_at >= $1 AND created_at < $2`
	args := []any{from, to}
	if category != "" {
		args = append(args, category)
		q += fmt.Sprintf(" AND service_category = $%d", len(args))
	}
	args = append(args, limit)
	q += fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d", len(args))

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("commission: list earnings: %w", err)
	}
	defer rows.Close()

	out := []Earning{}
	for rows.Next() {
		e, err := scanEarning(rows)
		if err != nil {
			return nil, fmt.Errorf("commission: scan earning: %w", err)
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// Report aggregates realized earnings over a date range grouped by one dimension:
// "category", "service", or "day".
func (r *Repository) Report(ctx context.Context, from, to time.Time, groupBy string) ([]ReportRow, error) {
	var groupExpr, keyExpr string
	switch strings.ToLower(groupBy) {
	case "service":
		groupExpr = "service_category, service"
		keyExpr = "service_category || ' / ' || service"
	case "day":
		groupExpr = "date_trunc('day', created_at)"
		keyExpr = "to_char(date_trunc('day', created_at), 'YYYY-MM-DD')"
	default:
		groupBy = "category"
		groupExpr = "service_category"
		keyExpr = "service_category"
	}

	q := fmt.Sprintf(`
		SELECT %s AS group_key,
		       COUNT(*)                          AS cnt,
		       COALESCE(SUM(gross_amount_kobo),0),
		       COALESCE(SUM(commission_kobo),0),
		       COALESCE(SUM(platform_charge_kobo),0),
		       COALESCE(SUM(convenience_fee_kobo),0),
		       COALESCE(SUM(fixed_fee_kobo),0),
		       COALESCE(SUM(spotlight_revenue_kobo),0)
		FROM public.commission_earnings
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY %s
		ORDER BY 8 DESC`, keyExpr, groupExpr)

	rows, err := r.db.Query(ctx, q, from, to)
	if err != nil {
		return nil, fmt.Errorf("commission: report: %w", err)
	}
	defer rows.Close()

	out := []ReportRow{}
	for rows.Next() {
		var rr ReportRow
		rr.GroupBy = groupBy
		if err := rows.Scan(&rr.GroupKey, &rr.Count,
			&rr.GrossAmountKobo, &rr.CommissionKobo, &rr.PlatformChargeKobo,
			&rr.ConvenienceFeeKobo, &rr.FixedFeeKobo, &rr.SpotlightRevenueKobo); err != nil {
			return nil, fmt.Errorf("commission: scan report: %w", err)
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ── helpers ──────────────────────────────────────────────────────────────────

// nullableStr returns nil (SQL NULL) for an empty string.
func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// jsonbOrNil returns nil (SQL NULL) for a nil map so an absent before/after stays
// NULL rather than encoding an empty object.
func jsonbOrNil(m map[string]any) any {
	if m == nil {
		return nil
	}
	return m
}
