package rewards

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data-access layer for the academy rewards module.
//
// Money-path invariants enforced here:
//   - GetPoolForUpdate locks the pool row (SELECT ... FOR UPDATE) so the
//     funded-vs-spent balance check and the spend increment are serialised; two
//     concurrent credits can never overspend a pool.
//   - InsertLedgerEntry is append-only and keyed by idempotency_key (unique index
//     uq_academy_reward_idem). A duplicate key surfaces as ErrDuplicate.
//   - Balances are DERIVED by summation over the immutable ledger — never stored.
//
// All SQL is parameterised. Column lists mirror the migration
// 20260815000900_academy_engagement_commerce.sql exactly.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// Errors mapped to typed outcomes by the service / handler.
var (
	ErrNotFound  = errors.New("rewards: not found")
	ErrDuplicate = errors.New("rewards: duplicate idempotency key")
)

// Pool returns the underlying pool (tx orchestration lives in the service).
func (r *Repository) Pool() *pgxpool.Pool { return r.db }

// Begin opens a transaction. The service drives the credit flow inside it so the
// pool lock, balance check, ledger append and spend increment commit atomically.
func (r *Repository) Begin(ctx context.Context) (pgx.Tx, error) { return r.db.Begin(ctx) }

// ── Reward pools ────────────────────────────────────────────────────────────────

const poolCols = `id, sponsor_id, campaign_id, name, currency, funded_minor, spent_minor,
	per_user_cap_minor, per_campaign_cap_minor, conversion_rate, status, created_at`

func scanPool(row pgx.Row) (*RewardPool, error) {
	p := &RewardPool{}
	err := row.Scan(&p.ID, &p.SponsorID, &p.CampaignID, &p.Name, &p.Currency,
		&p.FundedMinor, &p.SpentMinor, &p.PerUserCapMinor, &p.PerCampaignCapMinor,
		&p.ConversionRate, &p.Status, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return p, nil
}

// GetPoolForUpdate locks and returns the pool row inside the supplied tx. The
// FOR UPDATE row lock is the concurrency guard for the overspend invariant.
func (r *Repository) GetPoolForUpdate(ctx context.Context, tx pgx.Tx, poolID string) (*RewardPool, error) {
	const q = `SELECT ` + poolCols + ` FROM public.academy_reward_pools WHERE id = $1 FOR UPDATE`
	return scanPool(tx.QueryRow(ctx, q, poolID))
}

// GetPool returns a pool without locking (read paths / admin).
func (r *Repository) GetPool(ctx context.Context, poolID string) (*RewardPool, error) {
	const q = `SELECT ` + poolCols + ` FROM public.academy_reward_pools WHERE id = $1`
	return scanPool(r.db.QueryRow(ctx, q, poolID))
}

func (r *Repository) ListPools(ctx context.Context) ([]RewardPool, error) {
	const q = `SELECT ` + poolCols + ` FROM public.academy_reward_pools ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RewardPool{}
	for rows.Next() {
		p, err := scanPool(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (r *Repository) CreatePool(ctx context.Context, req CreatePoolRequest) (*RewardPool, error) {
	currency := req.Currency
	if currency == "" {
		currency = "NGN"
	}
	rate := 1.0
	if req.ConversionRate != nil {
		rate = *req.ConversionRate
	}
	const q = `
		INSERT INTO public.academy_reward_pools
			(sponsor_id, campaign_id, name, currency, per_user_cap_minor,
			 per_campaign_cap_minor, conversion_rate, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'draft')
		RETURNING ` + poolCols
	return scanPool(r.db.QueryRow(ctx, q, req.SponsorID, req.CampaignID, req.Name, currency,
		req.PerUserCapMinor, req.PerCampaignCapMinor, rate))
}

// IncrementPoolFunded credits the pool's funded_minor and activates it (admin fund
// op). Idempotency for funding is the caller's concern (FundPoolRequest carries an
// idempotency_key audited separately); the spend invariant is unaffected.
func (r *Repository) IncrementPoolFunded(ctx context.Context, poolID string, amountMinor int64) (*RewardPool, error) {
	const q = `
		UPDATE public.academy_reward_pools
		SET funded_minor = funded_minor + $2,
		    status = CASE WHEN status = 'draft' THEN 'active' ELSE status END
		WHERE id = $1
		RETURNING ` + poolCols
	return scanPool(r.db.QueryRow(ctx, q, poolID, amountMinor))
}

// SetPoolStatus updates the pool lifecycle status.
func (r *Repository) SetPoolStatus(ctx context.Context, poolID string, status PoolStatus) (*RewardPool, error) {
	const q = `UPDATE public.academy_reward_pools SET status = $2 WHERE id = $1 RETURNING ` + poolCols
	return scanPool(r.db.QueryRow(ctx, q, poolID, string(status)))
}

// IncrementPoolSpent adds amountMinor to spent_minor inside the supplied tx and
// flips the pool to 'exhausted' once fully spent. Called only after the balance
// check passed under the same FOR UPDATE lock.
func (r *Repository) IncrementPoolSpent(ctx context.Context, tx pgx.Tx, poolID string, amountMinor int64) error {
	const q = `
		UPDATE public.academy_reward_pools
		SET spent_minor = spent_minor + $2,
		    status = CASE WHEN spent_minor + $2 >= funded_minor THEN 'exhausted' ELSE status END
		WHERE id = $1`
	_, err := tx.Exec(ctx, q, poolID, amountMinor)
	return err
}

// ── Reward ledger (audit trail; balances derived) ────────────────────────────────

const entryCols = `id, user_id, pool_id, type, amount_minor, points, reason,
	source_event, wallet_ref, idempotency_key, created_at`

func scanEntry(row pgx.Row) (*LedgerEntry, error) {
	e := &LedgerEntry{}
	err := row.Scan(&e.ID, &e.UserID, &e.PoolID, &e.Type, &e.AmountMinor, &e.Points,
		&e.Reason, &e.SourceEvent, &e.WalletRef, &e.IdempotencyKey, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return e, nil
}

// GetByIdempotencyKey returns the prior ledger entry for an idempotency key, or
// ErrNotFound if the key is fresh. Backs idempotent replay.
func (r *Repository) GetByIdempotencyKey(ctx context.Context, key string) (*LedgerEntry, error) {
	const q = `SELECT ` + entryCols + ` FROM public.academy_reward_ledger_entries WHERE idempotency_key = $1`
	return scanEntry(r.db.QueryRow(ctx, q, key))
}

// InsertLedgerEntry appends an immutable ledger row inside the supplied tx. A
// unique-constraint violation on idempotency_key is surfaced as ErrDuplicate so the
// service can fall back to a replay.
func (r *Repository) InsertLedgerEntry(ctx context.Context, tx pgx.Tx, e LedgerEntry) (*LedgerEntry, error) {
	var poolArg, reasonArg, sourceArg, walletArg any
	if e.PoolID != nil {
		poolArg = *e.PoolID
	}
	if e.Reason != nil && *e.Reason != "" {
		reasonArg = *e.Reason
	}
	if e.SourceEvent != nil && *e.SourceEvent != "" {
		sourceArg = *e.SourceEvent
	}
	if e.WalletRef != nil && *e.WalletRef != "" {
		walletArg = *e.WalletRef
	}
	const q = `
		INSERT INTO public.academy_reward_ledger_entries
			(user_id, pool_id, type, amount_minor, points, reason, source_event, wallet_ref, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING ` + entryCols
	out, err := scanEntry(tx.QueryRow(ctx, q, e.UserID, poolArg, string(e.Type), e.AmountMinor,
		e.Points, reasonArg, sourceArg, walletArg, e.IdempotencyKey))
	if err != nil && isUniqueViolation(err) {
		return nil, ErrDuplicate
	}
	return out, err
}

// SetEntryWalletRef stamps the finance/ledger reference onto a previously written
// ledger entry once the wallet credit has been posted (value-movement linkage).
func (r *Repository) SetEntryWalletRef(ctx context.Context, entryID, walletRef string) error {
	const q = `UPDATE public.academy_reward_ledger_entries SET wallet_ref = $2 WHERE id = $1`
	_, err := r.db.Exec(ctx, q, entryID, walletRef)
	return err
}

// SumUserCreditsFromPool returns the user's prior credited value from a pool (per-user cap).
func (r *Repository) SumUserCreditsFromPool(ctx context.Context, tx pgx.Tx, userID, poolID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(amount_minor),0)
		FROM public.academy_reward_ledger_entries
		WHERE user_id = $1 AND pool_id = $2 AND type = 'credit'`
	var sum int64
	err := tx.QueryRow(ctx, q, userID, poolID).Scan(&sum)
	return sum, err
}

// SumCampaignCredits returns the total credited value across every pool of a
// campaign (per-campaign cap). Joins the ledger to its pool to resolve the campaign.
func (r *Repository) SumCampaignCredits(ctx context.Context, tx pgx.Tx, campaignID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(le.amount_minor),0)
		FROM public.academy_reward_ledger_entries le
		JOIN public.academy_reward_pools p ON p.id = le.pool_id
		WHERE p.campaign_id = $1 AND le.type = 'credit'`
	var sum int64
	err := tx.QueryRow(ctx, q, campaignID).Scan(&sum)
	return sum, err
}

// SumUserBalance derives the user's reward balance: credits minus redemptions and
// reversals, summed over the immutable ledger.
func (r *Repository) SumUserBalance(ctx context.Context, userID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(
			CASE WHEN type = 'credit' THEN amount_minor ELSE -amount_minor END
		),0)
		FROM public.academy_reward_ledger_entries
		WHERE user_id = $1`
	var bal int64
	err := r.db.QueryRow(ctx, q, userID).Scan(&bal)
	return bal, err
}

// ListUserEntries returns the user's reward ledger history (read path).
func (r *Repository) ListUserEntries(ctx context.Context, userID string, limit int) ([]LedgerEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `SELECT ` + entryCols + `
		FROM public.academy_reward_ledger_entries
		WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LedgerEntry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// ListPoolEntries returns the ledger entries posted against a pool (admin report).
func (r *Repository) ListPoolEntries(ctx context.Context, poolID string, limit int) ([]LedgerEntry, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	const q = `SELECT ` + entryCols + `
		FROM public.academy_reward_ledger_entries
		WHERE pool_id = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, poolID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LedgerEntry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

// ── Redemption catalog (CRUD) ────────────────────────────────────────────────────

const catalogCols = `id, sku, name, kind, cost_points, value_minor, status`

func scanCatalog(row pgx.Row) (*CatalogItem, error) {
	c := &CatalogItem{}
	err := row.Scan(&c.ID, &c.SKU, &c.Name, &c.Kind, &c.CostPoints, &c.ValueMinor, &c.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (r *Repository) ListCatalog(ctx context.Context, activeOnly bool) ([]CatalogItem, error) {
	q := `SELECT ` + catalogCols + ` FROM public.academy_redemption_catalog`
	if activeOnly {
		q += ` WHERE status = 'active'`
	}
	q += ` ORDER BY sku`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CatalogItem{}
	for rows.Next() {
		c, err := scanCatalog(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

func (r *Repository) GetCatalogBySKU(ctx context.Context, sku string) (*CatalogItem, error) {
	const q = `SELECT ` + catalogCols + ` FROM public.academy_redemption_catalog WHERE sku = $1`
	return scanCatalog(r.db.QueryRow(ctx, q, sku))
}

// UpsertCatalog inserts or updates a catalog item keyed by its unique SKU.
func (r *Repository) UpsertCatalog(ctx context.Context, req UpsertCatalogRequest) (*CatalogItem, error) {
	status := req.Status
	if status == "" {
		status = "active"
	}
	const q = `
		INSERT INTO public.academy_redemption_catalog (sku, name, kind, cost_points, value_minor, status)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (sku) DO UPDATE SET
			name = EXCLUDED.name, kind = EXCLUDED.kind, cost_points = EXCLUDED.cost_points,
			value_minor = EXCLUDED.value_minor, status = EXCLUDED.status
		RETURNING ` + catalogCols
	return scanCatalog(r.db.QueryRow(ctx, q, req.SKU, req.Name, req.Kind, req.CostPoints, req.ValueMinor, status))
}

// ── Redemptions ──────────────────────────────────────────────────────────────────

const redemptionCols = `id, user_id, sku, points_spent, value_minor, state, idempotency_key, created_at`

func scanRedemption(row pgx.Row) (*Redemption, error) {
	rd := &Redemption{}
	err := row.Scan(&rd.ID, &rd.UserID, &rd.SKU, &rd.PointsSpent, &rd.ValueMinor,
		&rd.State, &rd.IdempotencyKey, &rd.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return rd, nil
}

// GetRedemptionByIdempotencyKey backs idempotent replay of a redemption.
func (r *Repository) GetRedemptionByIdempotencyKey(ctx context.Context, key string) (*Redemption, error) {
	const q = `SELECT ` + redemptionCols + ` FROM public.academy_redemptions WHERE idempotency_key = $1`
	return scanRedemption(r.db.QueryRow(ctx, q, key))
}

// InsertRedemption appends an idempotent redemption row. A duplicate idempotency
// key surfaces as ErrDuplicate.
func (r *Repository) InsertRedemption(ctx context.Context, rd Redemption) (*Redemption, error) {
	state := rd.State
	if state == "" {
		state = "requested"
	}
	const q = `
		INSERT INTO public.academy_redemptions (user_id, sku, points_spent, value_minor, state, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING ` + redemptionCols
	out, err := scanRedemption(r.db.QueryRow(ctx, q, rd.UserID, rd.SKU, rd.PointsSpent, rd.ValueMinor, state, rd.IdempotencyKey))
	if err != nil && isUniqueViolation(err) {
		return nil, ErrDuplicate
	}
	return out, err
}

// SetRedemptionState transitions a redemption (requested→fulfilled|failed|reversed).
func (r *Repository) SetRedemptionState(ctx context.Context, id, state string) error {
	const q = `UPDATE public.academy_redemptions SET state = $2 WHERE id = $1`
	_, err := r.db.Exec(ctx, q, id, state)
	return err
}

// ── audit ─────────────────────────────────────────────────────────────────────

// InsertAudit appends an immutable audit row (module=academy). Non-tx; reward
// outcomes are audited on the read path after the money tx commits.
func (r *Repository) InsertAudit(ctx context.Context, actor, action, resourceType, resourceID string, newValues map[string]any, severity string) error {
	if severity == "" {
		severity = "info"
	}
	var actorArg any
	if actor != "" {
		actorArg = actor
	}
	const q = `
		INSERT INTO public.audit_logs
			(actor_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES ($1,$2,'academy',$3,$4,$5,$6)`
	_, err := r.db.Exec(ctx, q, actorArg, action, resourceType, resourceID, toJSONB(newValues), severity)
	return err
}

// ── helpers ──────────────────────────────────────────────────────────────────────

// isUniqueViolation reports whether err is a Postgres unique_violation (23505).
func isUniqueViolation(err error) bool {
	// Match without importing pgconn directly: pgx wraps a *pgconn.PgError whose
	// SQLState() == "23505" for a unique violation.
	type sqlStater interface{ SQLState() string }
	var pgErr sqlStater
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return false
}

// toJSONB marshals a map to a JSONB-ready byte slice ("{}" when empty/nil).
func toJSONB(v any) []byte {
	if v == nil {
		return []byte("{}")
	}
	b, err := json.Marshal(v)
	if err != nil || len(b) == 0 {
		return []byte("{}")
	}
	return b
}
