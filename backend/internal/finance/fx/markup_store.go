package fx

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MarkupRate is one row of the operator-tunable rate registry
// (public.fx_markup_rates). RateBPS is the stored integer; RatePercent is the
// same value rendered for operators, so a client never has to divide by 100 and
// get it wrong.
type MarkupRate struct {
	ID          string    `json:"id"`
	Corridor    string    `json:"corridor"`
	Tier        string    `json:"tier"`
	RateBPS     int       `json:"rateBps"`
	RatePercent string    `json:"ratePercent"`
	Active      bool      `json:"active"`
	Notes       string    `json:"notes,omitempty"`
	UpdatedBy   *string   `json:"updatedBy,omitempty"`
	UpdatedAt   time.Time `json:"updatedAt"`
	CreatedAt   time.Time `json:"createdAt"`
}

// MarkupAudit is one immutable before/after record of a rate change.
type MarkupAudit struct {
	ID            string    `json:"id"`
	Corridor      string    `json:"corridor"`
	Tier          string    `json:"tier"`
	BeforeBPS     *int      `json:"beforeBps,omitempty"`
	BeforePercent string    `json:"beforePercent,omitempty"`
	AfterBPS      int       `json:"afterBps"`
	AfterPercent  string    `json:"afterPercent"`
	BeforeActive  *bool     `json:"beforeActive,omitempty"`
	AfterActive   bool      `json:"afterActive"`
	ChangedBy     *string   `json:"changedBy,omitempty"`
	Note          string    `json:"note,omitempty"`
	ChangedAt     time.Time `json:"changedAt"`
}

// MarkupStore reads and writes the FX markup registry. It is the production
// MarkupResolver: FeeMinor resolves the corridor's rate straight from the table,
// so an operator change takes effect on the very next quote with no restart and
// no cache to invalidate.
type MarkupStore struct {
	db *pgxpool.Pool
}

// NewMarkupStore returns a DB-backed markup resolver (requires the
// 20261204000000_fx_markup_rates migration).
func NewMarkupStore(db *pgxpool.Pool) *MarkupStore { return &MarkupStore{db: db} }

// resolveBPS returns the active rate for a corridor, falling back to the DEFAULT
// row. A missing DEFAULT row is an error, NOT a silent zero: the seed migration
// guarantees one, so its absence means the schema is not what this code expects
// and we must not guess what to charge.
// The ORDER BY reproduces orchestration.SpreadEngine.resolve's specificity
// scoring exactly — corridor(+2) + tier(+1), most specific wins — so both FX
// surfaces resolve the same row for the same inputs. The legacy service has no
// tier concept and passes "", which matches only the tier-agnostic rows.
//
// min_bps/max_bps clamp the result, preserving SpreadRule's per-corridor band.
func (s *MarkupStore) resolveBPS(ctx context.Context, source, target, tier string) (int, error) {
	const q = `
		SELECT rate_bps, COALESCE(min_bps, 0), COALESCE(max_bps, 0)
		FROM public.fx_markup_rates
		WHERE active
		  AND (corridor = $1 OR corridor = $2)
		  AND (tier = $3 OR tier = '')
		ORDER BY ((corridor <> $2)::int * 2 + (tier <> '')::int) DESC
		LIMIT 1`
	corridor := CorridorKey(source, target)
	var bps, minBPS, maxBPS int
	err := s.db.QueryRow(ctx, q, corridor, DefaultCorridor, strings.ToLower(strings.TrimSpace(tier))).
		Scan(&bps, &minBPS, &maxBPS)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, fmt.Errorf("fx: no active markup rate for %s and no %s row", corridor, DefaultCorridor)
	}
	if err != nil {
		return 0, fmt.Errorf("fx: resolve markup for %s: %w", corridor, err)
	}
	if maxBPS > 0 && bps > maxBPS {
		bps = maxBPS
	}
	if bps < minBPS {
		bps = minBPS
	}
	return bps, nil
}

// FeeMinor implements MarkupResolver against the live registry.
func (s *MarkupStore) FeeMinor(ctx context.Context, source, target string, amountMinor int64) (int64, error) {
	if amountMinor <= 0 {
		return 0, nil
	}
	bps, err := s.resolveBPS(ctx, source, target, "")
	if err != nil {
		return 0, err
	}
	return FeeFromBPS(bps, amountMinor), nil
}

const markupCols = `id, corridor, tier, rate_bps, active, COALESCE(notes,''), updated_by, updated_at, created_at`

func scanRate(row pgx.Row) (*MarkupRate, error) {
	r := &MarkupRate{}
	if err := row.Scan(&r.ID, &r.Corridor, &r.Tier, &r.RateBPS, &r.Active, &r.Notes, &r.UpdatedBy, &r.UpdatedAt, &r.CreatedAt); err != nil {
		return nil, err
	}
	r.RatePercent = BPSToPercent(r.RateBPS)
	return r, nil
}

// ListRates returns every configured rate, DEFAULT first then corridors A-Z.
func (s *MarkupStore) ListRates(ctx context.Context) ([]*MarkupRate, error) {
	rows, err := s.db.Query(ctx, `
		SELECT `+markupCols+` FROM public.fx_markup_rates
		ORDER BY (corridor = $1) DESC, corridor, tier`, DefaultCorridor)
	if err != nil {
		return nil, fmt.Errorf("fx: list markup rates: %w", err)
	}
	defer rows.Close()
	out := make([]*MarkupRate, 0, 8)
	for rows.Next() {
		r, err := scanRate(rows)
		if err != nil {
			return nil, fmt.Errorf("fx: scan markup rate: %w", err)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// SetRate upserts a corridor's markup and records the change, atomically.
//
// The read-modify-write runs inside ONE transaction with the existing row locked
// FOR UPDATE, so two concurrent admin edits cannot interleave and write an audit
// row whose "before" never existed. bps is validated by the caller (PercentToBPS)
// and again by the table's CHECK constraint — belt and braces on a value that
// decides what every customer pays.
func (s *MarkupStore) SetRate(ctx context.Context, corridor, tier string, bps int, active bool, notes, changedBy, note string) (*MarkupRate, error) {
	if bps < 0 || bps > MaxMarkupBPS {
		return nil, ErrMarkupOutOfRange
	}
	corridor = NormalizeCorridor(corridor)
	if corridor == "" {
		return nil, fmt.Errorf("fx: corridor is required")
	}
	tier = strings.ToLower(strings.TrimSpace(tier))

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var beforeBPS *int
	var beforeActive *bool
	var curBPS int
	var curActive bool
	err = tx.QueryRow(ctx, `SELECT rate_bps, active FROM public.fx_markup_rates WHERE corridor=$1 AND tier=$2 FOR UPDATE`, corridor, tier).
		Scan(&curBPS, &curActive)
	switch {
	case err == nil:
		beforeBPS, beforeActive = &curBPS, &curActive
	case errors.Is(err, pgx.ErrNoRows):
		// First write for this corridor — audit "before" stays NULL.
	default:
		return nil, fmt.Errorf("fx: read current markup for %s: %w", corridor, err)
	}

	var actor *string
	if changedBy != "" {
		actor = &changedBy
	}

	rate, err := scanRate(tx.QueryRow(ctx, `
		INSERT INTO public.fx_markup_rates (corridor, tier, rate_bps, active, notes, updated_by, updated_at)
		VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,now())
		ON CONFLICT (corridor, tier) DO UPDATE
		   SET rate_bps=EXCLUDED.rate_bps, active=EXCLUDED.active,
		       notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=now()
		RETURNING `+markupCols, corridor, tier, bps, active, notes, actor))
	if err != nil {
		return nil, fmt.Errorf("fx: upsert markup for %s: %w", corridor, err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO public.fx_markup_rate_audit
		    (corridor, tier, before_bps, after_bps, before_active, after_active, changed_by, note)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''))`,
		corridor, tier, beforeBPS, bps, beforeActive, active, actor, note); err != nil {
		return nil, fmt.Errorf("fx: audit markup change for %s: %w", corridor, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return rate, nil
}

// ListAudit returns the change history, newest first. corridor "" means all.
func (s *MarkupStore) ListAudit(ctx context.Context, corridor string, limit int) ([]*MarkupAudit, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	corridor = NormalizeCorridor(corridor)
	rows, err := s.db.Query(ctx, `
		SELECT id, corridor, tier, before_bps, after_bps, before_active, after_active,
		       changed_by, COALESCE(note,''), changed_at
		FROM public.fx_markup_rate_audit
		WHERE ($1 = '' OR corridor = $1)
		ORDER BY changed_at DESC
		LIMIT $2`, corridor, limit)
	if err != nil {
		return nil, fmt.Errorf("fx: list markup audit: %w", err)
	}
	defer rows.Close()
	out := make([]*MarkupAudit, 0, limit)
	for rows.Next() {
		a := &MarkupAudit{}
		if err := rows.Scan(&a.ID, &a.Corridor, &a.Tier, &a.BeforeBPS, &a.AfterBPS,
			&a.BeforeActive, &a.AfterActive, &a.ChangedBy, &a.Note, &a.ChangedAt); err != nil {
			return nil, fmt.Errorf("fx: scan markup audit: %w", err)
		}
		if a.BeforeBPS != nil {
			a.BeforePercent = BPSToPercent(*a.BeforeBPS)
		}
		a.AfterPercent = BPSToPercent(a.AfterBPS)
		out = append(out, a)
	}
	return out, rows.Err()
}
