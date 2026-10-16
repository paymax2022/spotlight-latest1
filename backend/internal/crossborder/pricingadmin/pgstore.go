package pricingadmin

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/crossborder/pricing"
)

// PGStore is the pgx implementation of Store.
type PGStore struct{ db *pgxpool.Pool }

// NewPGStore returns a pgx-backed store (needs 20271045000000_crossborder_pricing_admin).
func NewPGStore(db *pgxpool.Pool) *PGStore { return &PGStore{db: db} }

var _ Store = (*PGStore)(nil)

const feeCols = `id::text, rule_key::text, version, level, subject_id, service, direction, corridor, rail, currency, plan, tier,
	amount_min, amount_max, flat_minor, pct_bps, min_minor, max_minor, payer_mode, effective_from, effective_to,
	status, maker, COALESCE(checker,''), reason, COALESCE(rolled_back_from::text,''), created_at, decided_at`

func scanFee(row pgx.Row) (FeeRuleRecord, error) {
	var r FeeRuleRecord
	var lvl int16
	err := row.Scan(&r.ID, &r.RuleKey, &r.Version, &lvl, &r.SubjectID, &r.Service, &r.Direction, &r.Corridor, &r.Rail,
		&r.Currency, &r.Plan, &r.Tier, &r.AmountMin, &r.AmountMax, &r.FlatMinor, &r.PctBPS, &r.MinMinor, &r.MaxMinor,
		&r.PayerMode, &r.EffectiveFrom, &r.EffectiveTo, &r.Status, &r.Maker, &r.Checker, &r.Reason, &r.RolledBackFrom,
		&r.CreatedAt, &r.DecidedAt)
	r.Level = int(lvl)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	return r, err
}

func (s *PGStore) ListFeeRules(ctx context.Context, status string) ([]FeeRuleRecord, error) {
	q := `SELECT ` + feeCols + ` FROM public.crossborder_fee_rules`
	args := []any{}
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC, version DESC LIMIT 500`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("pricingadmin: list fee rules: %w", err)
	}
	defer rows.Close()
	out := []FeeRuleRecord{}
	for rows.Next() {
		r, err := scanFee(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *PGStore) GetFeeRule(ctx context.Context, id string) (FeeRuleRecord, error) {
	r, err := scanFee(s.db.QueryRow(ctx, `SELECT `+feeCols+` FROM public.crossborder_fee_rules WHERE id::text = $1`, id))
	return r, err
}

const feeInsert = `INSERT INTO public.crossborder_fee_rules
	(rule_key, version, level, subject_id, service, direction, corridor, rail, currency, plan, tier,
	 amount_min, amount_max, flat_minor, pct_bps, min_minor, max_minor, payer_mode,
	 effective_from, effective_to, status, maker, reason, rolled_back_from)
	VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'pending',$21,$22,$23::uuid)
	RETURNING ` + feeCols

func (s *PGStore) insertPending(ctx context.Context, tx pgx.Tx, r FeeRuleRecord, rolledBack string) (FeeRuleRecord, error) {
	var rb any
	if rolledBack != "" {
		rb = rolledBack
	}
	return scanFee(tx.QueryRow(ctx, feeInsert, r.RuleKey, r.Version, r.Level, r.SubjectID, r.Service, r.Direction, r.Corridor,
		r.Rail, r.Currency, r.Plan, r.Tier, r.AmountMin, r.AmountMax, r.FlatMinor, r.PctBPS, r.MinMinor, r.MaxMinor,
		r.PayerMode, r.EffectiveFrom, r.EffectiveTo, r.Maker, r.Reason, rb))
}

// nextVersion locks the lineage and returns max(version)+1 (1 for a new key).
func nextVersion(ctx context.Context, tx pgx.Tx, ruleKey string) (int, error) {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, ruleKey); err != nil {
		return 0, err
	}
	var v int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(version),0)+1 FROM public.crossborder_fee_rules WHERE rule_key = $1::uuid`, ruleKey).Scan(&v); err != nil {
		return 0, err
	}
	return v, nil
}

func (s *PGStore) CreateFeeRuleChange(ctx context.Context, rec FeeRuleRecord) (FeeRuleRecord, error) {
	var out FeeRuleRecord
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		if rec.RuleKey == "" {
			if err := tx.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&rec.RuleKey); err != nil {
				return err
			}
		}
		v, err := nextVersion(ctx, tx, rec.RuleKey)
		if err != nil {
			return err
		}
		rec.Version = v
		out, err = s.insertPending(ctx, tx, rec, "")
		return err
	})
	if err != nil {
		return FeeRuleRecord{}, fmt.Errorf("pricingadmin: create fee change: %w", err)
	}
	return out, nil
}

func (s *PGStore) decide(ctx context.Context, id, checker string, now time.Time, approve bool) (FeeRuleRecord, error) {
	var out FeeRuleRecord
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		cur, err := scanFee(tx.QueryRow(ctx, `SELECT `+feeCols+` FROM public.crossborder_fee_rules WHERE id::text = $1 FOR UPDATE`, id))
		if err != nil {
			return err
		}
		if strings.EqualFold(strings.TrimSpace(cur.Maker), strings.TrimSpace(checker)) {
			return ErrSelfApproval
		}
		if cur.Status != StatusPending {
			return ErrNotPending
		}
		if !approve {
			out, err = scanFee(tx.QueryRow(ctx, `UPDATE public.crossborder_fee_rules SET status='rejected', checker=$2, decided_at=$3
				WHERE id::text=$1 RETURNING `+feeCols, id, checker, now))
			return err
		}
		eff := now
		if cur.EffectiveFrom != nil {
			eff = *cur.EffectiveFrom
		}
		// Supersede earlier active versions of this lineage: end their window at
		// the new rule's start (no gap, no overlap); retire any that never began
		// before it.
		if _, err = tx.Exec(ctx, `UPDATE public.crossborder_fee_rules
			SET effective_to = $2, status = CASE WHEN COALESCE(effective_from, '-infinity'::timestamptz) >= $2 THEN 'retired' ELSE status END
			WHERE rule_key = $1::uuid AND status = 'active' AND id::text <> $3
			  AND (effective_to IS NULL OR effective_to > $2)`, cur.RuleKey, eff, id); err != nil {
			return err
		}
		out, err = scanFee(tx.QueryRow(ctx, `UPDATE public.crossborder_fee_rules SET status='active', checker=$2, decided_at=$3,
			effective_from = COALESCE(effective_from, $3) WHERE id::text=$1 RETURNING `+feeCols, id, checker, now))
		return err
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrSelfApproval) || errors.Is(err, ErrNotPending) {
			return FeeRuleRecord{}, err
		}
		return FeeRuleRecord{}, fmt.Errorf("pricingadmin: decide fee change: %w", err)
	}
	return out, nil
}

func (s *PGStore) ApproveFeeRule(ctx context.Context, id, checker string, now time.Time) (FeeRuleRecord, error) {
	return s.decide(ctx, id, checker, now, true)
}

func (s *PGStore) RejectFeeRule(ctx context.Context, id, checker string, now time.Time) (FeeRuleRecord, error) {
	return s.decide(ctx, id, checker, now, false)
}

func (s *PGStore) RollbackFeeRule(ctx context.Context, ruleKey string, toVersion int, maker, reason string, effectiveFrom time.Time) (FeeRuleRecord, error) {
	var out FeeRuleRecord
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		src, err := scanFee(tx.QueryRow(ctx, `SELECT `+feeCols+` FROM public.crossborder_fee_rules
			WHERE rule_key::text = $1 AND version = $2`, ruleKey, toVersion))
		if errors.Is(err, ErrNotFound) {
			return ErrVersionNotFound
		}
		if err != nil {
			return err
		}
		v, err := nextVersion(ctx, tx, src.RuleKey)
		if err != nil {
			return err
		}
		src.Version, src.Maker, src.Reason = v, maker, reason
		src.EffectiveFrom, src.EffectiveTo = &effectiveFrom, nil
		out, err = s.insertPending(ctx, tx, src, src.ID)
		return err
	})
	if err != nil {
		if errors.Is(err, ErrVersionNotFound) {
			return FeeRuleRecord{}, err
		}
		return FeeRuleRecord{}, fmt.Errorf("pricingadmin: rollback fee rule: %w", err)
	}
	return out, nil
}

func (s *PGStore) ActiveFeeSchedule(ctx context.Context) (pricing.FeeSchedule, error) {
	recs, err := s.ListFeeRules(ctx, StatusActive)
	if err != nil {
		return pricing.FeeSchedule{}, err
	}
	var fs pricing.FeeSchedule
	for _, r := range recs {
		fs.Rules = append(fs.Rules, r.ToFeeRule())
	}
	return fs, nil
}

// ---- rate card ----------------------------------------------------------

const rcCols = `id::text, service, corridor, rail, currency, flat_minor, pct_bps, cost_unknown, valid_from, valid_to,
	source_ref, created_by, updated_by, created_at, updated_at`

func scanRC(row pgx.Row) (RateCardRow, error) {
	var r RateCardRow
	err := row.Scan(&r.ID, &r.Service, &r.Corridor, &r.Rail, &r.Currency, &r.FlatMinor, &r.PctBPS, &r.CostUnknown,
		&r.ValidFrom, &r.ValidTo, &r.SourceRef, &r.CreatedBy, &r.UpdatedBy, &r.CreatedAt, &r.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return r, ErrNotFound
	}
	return r, err
}

func (s *PGStore) ListRateCard(ctx context.Context) ([]RateCardRow, error) {
	rows, err := s.db.Query(ctx, `SELECT `+rcCols+` FROM public.crossborder_rate_card ORDER BY service, corridor, rail, currency, created_at`)
	if err != nil {
		return nil, fmt.Errorf("pricingadmin: list rate card: %w", err)
	}
	defer rows.Close()
	out := []RateCardRow{}
	for rows.Next() {
		r, err := scanRC(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *PGStore) CreateRateCard(ctx context.Context, r RateCardRow) (RateCardRow, error) {
	return scanRC(s.db.QueryRow(ctx, `INSERT INTO public.crossborder_rate_card
		(service, corridor, rail, currency, flat_minor, pct_bps, cost_unknown, valid_from, valid_to, source_ref, created_by, updated_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING `+rcCols,
		r.Service, r.Corridor, r.Rail, r.Currency, r.FlatMinor, r.PctBPS, r.CostUnknown, r.ValidFrom, r.ValidTo, r.SourceRef, r.CreatedBy))
}

func (s *PGStore) UpdateRateCard(ctx context.Context, r RateCardRow) (RateCardRow, error) {
	return scanRC(s.db.QueryRow(ctx, `UPDATE public.crossborder_rate_card SET service=$2, corridor=$3, rail=$4, currency=$5,
		flat_minor=$6, pct_bps=$7, cost_unknown=$8, valid_from=$9, valid_to=$10, source_ref=$11, updated_by=$12, updated_at=now()
		WHERE id::text=$1 RETURNING `+rcCols,
		r.ID, r.Service, r.Corridor, r.Rail, r.Currency, r.FlatMinor, r.PctBPS, r.CostUnknown, r.ValidFrom, r.ValidTo, r.SourceRef, r.UpdatedBy))
}

func (s *PGStore) ExpireRateCard(ctx context.Context, id, by string, at time.Time) (RateCardRow, error) {
	return scanRC(s.db.QueryRow(ctx, `UPDATE public.crossborder_rate_card SET valid_to=$2, updated_by=$3, updated_at=now()
		WHERE id::text=$1 AND (valid_to IS NULL OR valid_to > $2) RETURNING `+rcCols, id, at, by))
}

// ---- singletons ---------------------------------------------------------

func (s *PGStore) GetGuardrails(ctx context.Context) (Guardrails, bool, error) {
	var g Guardrails
	err := s.db.QueryRow(ctx, `SELECT floor_margin_minor, floor_margin_bps, hard_cap_bps, hard_cap_minor, tax_bps, updated_by, updated_at
		FROM public.crossborder_pricing_guardrails WHERE id = 1`).
		Scan(&g.FloorMarginMinor, &g.FloorMarginBPS, &g.HardCapBPS, &g.HardCapMinor, &g.TaxBPS, &g.UpdatedBy, &g.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Guardrails{}, false, nil
	}
	return g, err == nil, err
}

func (s *PGStore) PutGuardrails(ctx context.Context, g Guardrails, by string) (Guardrails, error) {
	err := s.db.QueryRow(ctx, `INSERT INTO public.crossborder_pricing_guardrails
		(id, floor_margin_minor, floor_margin_bps, hard_cap_bps, hard_cap_minor, tax_bps, updated_by, updated_at)
		VALUES (1,$1,$2,$3,$4,$5,$6,now())
		ON CONFLICT (id) DO UPDATE SET floor_margin_minor=EXCLUDED.floor_margin_minor, floor_margin_bps=EXCLUDED.floor_margin_bps,
		  hard_cap_bps=EXCLUDED.hard_cap_bps, hard_cap_minor=EXCLUDED.hard_cap_minor, tax_bps=EXCLUDED.tax_bps,
		  updated_by=EXCLUDED.updated_by, updated_at=now()
		RETURNING floor_margin_minor, floor_margin_bps, hard_cap_bps, hard_cap_minor, tax_bps, updated_by, updated_at`,
		g.FloorMarginMinor, g.FloorMarginBPS, g.HardCapBPS, g.HardCapMinor, g.TaxBPS, by).
		Scan(&g.FloorMarginMinor, &g.FloorMarginBPS, &g.HardCapBPS, &g.HardCapMinor, &g.TaxBPS, &g.UpdatedBy, &g.UpdatedAt)
	return g, err
}

func (s *PGStore) GetCollection(ctx context.Context) (CollectionSettings, error) {
	var c CollectionSettings
	err := s.db.QueryRow(ctx, `SELECT strategy, sweep_interval_minutes, sweep_threshold_minor, updated_by, updated_at
		FROM public.crossborder_fee_collection_settings WHERE id = 1`).
		Scan(&c.Strategy, &c.SweepIntervalMinutes, &c.SweepThresholdMinor, &c.UpdatedBy, &c.UpdatedAt)
	return c, err
}

func (s *PGStore) PutCollection(ctx context.Context, c CollectionSettings, by string) (CollectionSettings, error) {
	err := s.db.QueryRow(ctx, `INSERT INTO public.crossborder_fee_collection_settings
		(id, strategy, sweep_interval_minutes, sweep_threshold_minor, updated_by, updated_at) VALUES (1,$1,$2,$3,$4,now())
		ON CONFLICT (id) DO UPDATE SET strategy=EXCLUDED.strategy, sweep_interval_minutes=EXCLUDED.sweep_interval_minutes,
		  sweep_threshold_minor=EXCLUDED.sweep_threshold_minor, updated_by=EXCLUDED.updated_by, updated_at=now()
		RETURNING strategy, sweep_interval_minutes, sweep_threshold_minor, updated_by, updated_at`,
		c.Strategy, c.SweepIntervalMinutes, c.SweepThresholdMinor, by).
		Scan(&c.Strategy, &c.SweepIntervalMinutes, &c.SweepThresholdMinor, &c.UpdatedBy, &c.UpdatedAt)
	return c, err
}

func (s *PGStore) GetRefundPolicy(ctx context.Context) (RefundPolicy, error) {
	var p RefundPolicy
	err := s.db.QueryRow(ctx, `SELECT on_failed, on_cancelled, on_customer_refund, updated_by, updated_at
		FROM public.crossborder_refund_fee_policy WHERE id = 1`).
		Scan(&p.OnFailed, &p.OnCancelled, &p.OnCustomerRefund, &p.UpdatedBy, &p.UpdatedAt)
	return p, err
}

func (s *PGStore) PutRefundPolicy(ctx context.Context, p RefundPolicy, by string) (RefundPolicy, error) {
	err := s.db.QueryRow(ctx, `INSERT INTO public.crossborder_refund_fee_policy
		(id, on_failed, on_cancelled, on_customer_refund, updated_by, updated_at) VALUES (1,$1,$2,$3,$4,now())
		ON CONFLICT (id) DO UPDATE SET on_failed=EXCLUDED.on_failed, on_cancelled=EXCLUDED.on_cancelled,
		  on_customer_refund=EXCLUDED.on_customer_refund, updated_by=EXCLUDED.updated_by, updated_at=now()
		RETURNING on_failed, on_cancelled, on_customer_refund, updated_by, updated_at`,
		p.OnFailed, p.OnCancelled, p.OnCustomerRefund, by).
		Scan(&p.OnFailed, &p.OnCancelled, &p.OnCustomerRefund, &p.UpdatedBy, &p.UpdatedAt)
	return p, err
}
