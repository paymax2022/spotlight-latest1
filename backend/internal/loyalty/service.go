package loyalty

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/points"
)

// Auditor mirrors services.AuditService (NL-12); nil-safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Service is the loyalty engine. It is a thin orchestration layer over the points
// package: AwardFor translates a live-module trigger into a points.Earn under the
// bound rule, then re-evaluates the user's tier; Redeem delegates to points.Redeem
// and records the non-cash fulfilment (NL-4 — there is no cash path anywhere here).
type Service struct {
	db     *pgxpool.Pool
	points *points.Service
	audit  Auditor
}

func NewService(db *pgxpool.Pool, pts *points.Service, audit Auditor) *Service {
	return &Service{db: db, points: pts, audit: audit}
}

// AwardFor is the single entry point live modules call when an earnable action
// happens (payments bill paid, savings deposit, ticket purchased, referral §7A
// conversion). It looks up the active binding for (module, trigger), awards points
// idempotently via points.Earn (NL-9), then re-evaluates the membership tier. A
// missing/inactive binding is a silent no-op so callers never hard-fail on loyalty.
func (s *Service) AwardFor(ctx context.Context, userID, module, trigger string, ec points.EarnContext) (*points.Entry, error) {
	ruleKey, ok, err := s.bindingRuleKey(ctx, module, trigger)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil // no active binding — nothing to award
	}
	if ec.Module == "" {
		ec.Module = module
	}
	entry, created, err := s.points.Earn(ctx, userID, ruleKey, ec)
	if err != nil {
		return nil, fmt.Errorf("loyalty: award: %w", err)
	}
	// Only a freshly-created award contributes to lifetime points; a replayed earn
	// (created=false) must not double-count toward tier (NL-9).
	if entry != nil && created {
		if _, rerr := s.ReevaluateTier(ctx, userID, entry.Points); rerr != nil {
			// Tier re-eval failure must not unwind a valid award; log + continue.
			s.log(userID, "loyalty.tier.reeval_error", userID, map[string]any{"err": rerr.Error()})
		}
	}
	return entry, nil
}

// ReevaluateTier bumps lifetime points by delta and promotes the membership tier if
// a higher threshold is crossed. Within P1 the tier is monotonic (no mid-period
// downgrade). Idempotency at the points layer means a replayed award contributes
// its delta at most once.
func (s *Service) ReevaluateTier(ctx context.Context, userID string, delta int64) (Tier, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("loyalty: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var lifetime int64
	var curTier string
	err = tx.QueryRow(ctx, `SELECT lifetime_points, tier FROM loyalty_memberships WHERE user_id=$1 FOR UPDATE`, userID).Scan(&lifetime, &curTier)
	if err == pgx.ErrNoRows {
		curTier = string(Tier1)
		lifetime = 0
		if _, err := tx.Exec(ctx, `INSERT INTO loyalty_memberships (user_id, tier, lifetime_points) VALUES ($1,'TIER1',0)`, userID); err != nil {
			return "", fmt.Errorf("loyalty: create membership: %w", err)
		}
	} else if err != nil {
		return "", fmt.Errorf("loyalty: load membership: %w", err)
	}

	lifetime += delta
	newTier, err := s.tierForTx(ctx, tx, lifetime, Tier(curTier))
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE loyalty_memberships SET lifetime_points=$2, tier=$3, updated_at=now() WHERE user_id=$1`, userID, lifetime, string(newTier)); err != nil {
		return "", fmt.Errorf("loyalty: update membership: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("loyalty: commit membership: %w", err)
	}
	if newTier != Tier(curTier) {
		s.log(userID, "loyalty.tier.promote", userID, map[string]any{"from": curTier, "to": string(newTier), "lifetime": lifetime})
	}
	return newTier, nil
}

// ListTiers returns the active tier configuration (thresholds + benefits) ordered
// low→high. This is the member-facing tiers config read surfaced by the mobile
// integration agents (loyalty go-live gap). benefits is a JSONB map.
func (s *Service) ListTiers(ctx context.Context) ([]TierDef, error) {
	const q = `SELECT tier, threshold_points, COALESCE(benefits,'{}'::jsonb), active
	           FROM loyalty_tiers WHERE active=true ORDER BY threshold_points ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TierDef{}
	for rows.Next() {
		var d TierDef
		var tier string
		if err := rows.Scan(&tier, &d.ThresholdPoints, &d.Benefits, &d.Active); err != nil {
			return nil, err
		}
		d.Tier = Tier(tier)
		out = append(out, d)
	}
	return out, rows.Err()
}

// tierForTx returns the highest tier whose threshold <= lifetime, never below cur.
func (s *Service) tierForTx(ctx context.Context, tx pgx.Tx, lifetime int64, cur Tier) (Tier, error) {
	const q = `SELECT tier FROM loyalty_tiers WHERE active=true AND threshold_points <= $1 ORDER BY threshold_points DESC LIMIT 1`
	var t string
	err := tx.QueryRow(ctx, q, lifetime).Scan(&t)
	if err == pgx.ErrNoRows {
		return cur, nil
	}
	if err != nil {
		return cur, fmt.Errorf("loyalty: tier lookup: %w", err)
	}
	// Monotonic: never downgrade within P1.
	if rank(Tier(t)) < rank(cur) {
		return cur, nil
	}
	return Tier(t), nil
}

func rank(t Tier) int {
	switch t {
	case Tier1:
		return 1
	case Tier2:
		return 2
	case Tier3:
		return 3
	default:
		return 0
	}
}

// GetMembership returns the caller's membership (creating a TIER1 baseline if none).
func (s *Service) GetMembership(ctx context.Context, userID string) (*Membership, error) {
	const q = `SELECT user_id, tier, lifetime_points, updated_at FROM loyalty_memberships WHERE user_id=$1`
	var m Membership
	var tier string
	err := s.db.QueryRow(ctx, q, userID).Scan(&m.UserID, &tier, &m.LifetimePoints, &m.UpdatedAt)
	if err == pgx.ErrNoRows {
		_, _ = s.db.Exec(ctx, `INSERT INTO loyalty_memberships (user_id, tier, lifetime_points) VALUES ($1,'TIER1',0) ON CONFLICT (user_id) DO NOTHING`, userID)
		return &Membership{UserID: userID, Tier: Tier1, LifetimePoints: 0, UpdatedAt: time.Now()}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("loyalty: get membership: %w", err)
	}
	m.Tier = Tier(tier)
	return &m, nil
}

// Redeem claims a loyalty reward. It first checks the member's tier meets the
// reward's MinTier, then debits points via points.Redeem (NL-4: no cash path), then
// records a PENDING fulfilment for the owning module to dispatch (airtime/bill/
// ticket-discount). The points debit and the loyalty redemption row are linked by SKU.
func (s *Service) Redeem(ctx context.Context, userID, sku string) (*Redemption, error) {
	item, err := s.catalogItem(ctx, sku)
	if err != nil {
		return nil, err
	}
	if !item.Active {
		return nil, fmt.Errorf("loyalty: reward inactive")
	}
	m, err := s.GetMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	if rank(m.Tier) < rank(item.MinTier) {
		return nil, ErrTierTooLow
	}

	// Debit points (no cash branch exists inside points.Redeem either — NL-4).
	pr, pitem, err := s.points.Redeem(ctx, userID, sku)
	if err != nil {
		return nil, err
	}
	red := &Redemption{
		ID:           uuid.New().String(),
		UserID:       userID,
		SKU:          sku,
		Kind:         pitem.Kind,
		CostPoints:   pr.CostPoints,
		FulfilStatus: "PENDING",
		CreatedAt:    time.Now(),
	}
	const ins = `INSERT INTO loyalty_redemptions (id, user_id, sku, kind, cost_points, fulfil_status) VALUES ($1,$2,$3,$4,$5,'PENDING')`
	if _, err := s.db.Exec(ctx, ins, red.ID, red.UserID, red.SKU, red.Kind, red.CostPoints); err != nil {
		return nil, fmt.Errorf("loyalty: insert redemption: %w", err)
	}
	// Fulfilment is a non-cash dispatch handled by the owning module (airtime / bill
	// / ticket-discount). It is intentionally decoupled and marked PENDING here.
	s.log(userID, "loyalty.redeem", red.ID, map[string]any{"sku": sku, "kind": pitem.Kind, "cost": pr.CostPoints})
	return red, nil
}

// ListCatalog returns active rewards the member's tier can redeem.
func (s *Service) ListCatalog(ctx context.Context, userID string) ([]CatalogItem, error) {
	m, err := s.GetMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	const q = `SELECT id, sku, title, kind, cost_points, min_tier, active FROM loyalty_catalog WHERE active=true ORDER BY cost_points ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CatalogItem
	for rows.Next() {
		var it CatalogItem
		var minTier string
		if err := rows.Scan(&it.ID, &it.SKU, &it.Title, &it.Kind, &it.CostPoints, &minTier, &it.Active); err != nil {
			return nil, err
		}
		it.MinTier = Tier(minTier)
		if rank(m.Tier) >= rank(it.MinTier) {
			out = append(out, it)
		}
	}
	return out, rows.Err()
}

// --- internals ---

func (s *Service) bindingRuleKey(ctx context.Context, module, trigger string) (string, bool, error) {
	const q = `SELECT rule_key FROM loyalty_earn_rules WHERE module=$1 AND trigger=$2 AND active=true LIMIT 1`
	var rk string
	err := s.db.QueryRow(ctx, q, module, trigger).Scan(&rk)
	if err == pgx.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("loyalty: load binding: %w", err)
	}
	return rk, true, nil
}

func (s *Service) catalogItem(ctx context.Context, sku string) (*CatalogItem, error) {
	const q = `SELECT id, sku, title, kind, cost_points, min_tier, active FROM loyalty_catalog WHERE sku=$1`
	var it CatalogItem
	var minTier string
	if err := s.db.QueryRow(ctx, q, sku).Scan(&it.ID, &it.SKU, &it.Title, &it.Kind, &it.CostPoints, &minTier, &it.Active); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("loyalty: reward %s not found", sku)
		}
		return nil, fmt.Errorf("loyalty: load reward: %w", err)
	}
	it.MinTier = Tier(minTier)
	return &it, nil
}

func (s *Service) log(actor, action, id string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "loyalty", "loyalty", id, nil, meta, "", "", "info")
}

// Sentinel errors.
var ErrTierTooLow = fmt.Errorf("loyalty: membership tier too low for this reward")
