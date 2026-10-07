// Package loyalty wires the points earn-rules to live modules (payments, savings,
// tickets, referral §7A), runs the membership tier engine, and exposes the rewards
// catalog + redemption. It owns NO money primitive and NO points ledger of its own:
// awards go through points.Earn, redemptions through points.Redeem, and reward
// fulfilment is delegated to bill-pay / airtime / ticket-discount (NL-4: never cash).

package loyalty

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/points"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
	defer func() { _ = tx.Rollback(ctx) }()

	var lifetime int64
	var curTier string
	err = tx.QueryRow(ctx, `SELECT lifetime_points, tier FROM loyalty_memberships WHERE user_id=$1 FOR UPDATE`, userID).Scan(&lifetime, &curTier)
	if errors.Is(err, pgx.ErrNoRows) {
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
	if errors.Is(err, pgx.ErrNoRows) {
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
	case TierBlack:
		// BLACK is the highest tier (above TIER3). Without this case it fell
		// through to 0, ranking BLACK below TIER1 — a MinTier=BLACK reward gate
		// would then admit every member (rank(member) >= 0 always). Fail-closed.
		return 4
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
	if errors.Is(err, pgx.ErrNoRows) {
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
//
// idemKey is the OPTIONAL client Idempotency-Key. When supplied, a replay returns
// the original redemption — no second points debit and no duplicate PENDING
// fulfilment row (loyalty_redemptions.idempotency_key dedupes the insert). When
// empty the behaviour is the legacy per-call record — kept so live clients that
// never send the header keep working (follow-up: require it like other mutations).
func (s *Service) Redeem(ctx context.Context, userID, sku, idemKey string) (*Redemption, error) {
	if idemKey != "" {
		// Replay short-circuit before any fresh work: return the original row.
		prior, err := s.redemptionByIdem(ctx, userID, idemKey)
		if err == nil {
			return prior, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("loyalty: redeem replay check: %w", err)
		}
	}
	item, err := s.catalogItem(ctx, sku)
	if err != nil {
		return nil, err
	}
	if !item.Active {
		return nil, errors.New("loyalty: reward inactive")
	}
	m, err := s.GetMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	if rank(m.Tier) < rank(item.MinTier) {
		return nil, ErrTierTooLow
	}

	// Debit points (no cash branch exists inside points.Redeem either — NL-4).
	pr, pitem, err := s.points.Redeem(ctx, userID, sku, idemKey)
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
	// NULLIF keeps headerless calls unaffected by the partial unique index; the
	// ON CONFLICT arm covers a same-key race that slipped past the pre-check.
	const ins = `
		INSERT INTO loyalty_redemptions (id, user_id, sku, kind, cost_points, fulfil_status, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'PENDING',NULLIF($6,''))
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, red.ID, red.UserID, red.SKU, red.Kind, red.CostPoints, idemKey); err != nil {
		return nil, fmt.Errorf("loyalty: insert redemption: %w", err)
	}
	if idemKey != "" {
		// Read back what stands under the key — either the row just written or,
		// on a lost same-key race, the winner's row.
		if stored, err := s.redemptionByIdem(ctx, userID, idemKey); err == nil {
			red = stored
		}
	}
	// Fulfilment is a non-cash dispatch handled by the owning module (airtime / bill
	// / ticket-discount). It is intentionally decoupled and marked PENDING here.
	s.log(userID, "loyalty.redeem", red.ID, map[string]any{"sku": sku, "kind": pitem.Kind, "cost": pr.CostPoints})
	return red, nil
}

// redemptionByIdem loads the redemption recorded under a client idempotency key.
func (s *Service) redemptionByIdem(ctx context.Context, userID, idemKey string) (*Redemption, error) {
	const q = `SELECT id, user_id, sku, kind, cost_points, fulfil_status, created_at
		FROM loyalty_redemptions WHERE user_id=$1 AND idempotency_key=$2`
	var r Redemption
	if err := s.db.QueryRow(ctx, q, userID, idemKey).Scan(
		&r.ID, &r.UserID, &r.SKU, &r.Kind, &r.CostPoints, &r.FulfilStatus, &r.CreatedAt); err != nil {
		return nil, err
	}
	return &r, nil
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

func (s *Service) bindingRuleKey(ctx context.Context, module, trigger string) (string, bool, error) {
	const q = `SELECT rule_key FROM loyalty_earn_rules WHERE module=$1 AND trigger=$2 AND active=true LIMIT 1`
	var rk string
	err := s.db.QueryRow(ctx, q, module, trigger).Scan(&rk)
	if errors.Is(err, pgx.ErrNoRows) {
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
		if errors.Is(err, pgx.ErrNoRows) {
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
var ErrTierTooLow = errors.New("loyalty: membership tier too low for this reward")

// Handler exposes loyalty member endpoints (membership, rewards, redeem). Awards are
// never a public endpoint — they fire only as side effects of live-module actions
// via AwardFor — so a client can never self-promote a tier or mint points.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// GuardFunc returns a permission-checking middleware.
type GuardFunc func(permission string) gin.HandlerFunc

// Register mounts member + admin routes. The caller passes groups already
// scoped to their base paths (finance.Group("/loyalty") and
// adminGroupTop5(r, "/api/loyalty/admin")) — routes registered here must NOT
// re-add the "/loyalty" segment, or Gin will double it
// (e.g. /api/finance/loyalty/loyalty/me instead of /api/finance/loyalty/me).
//
//	member: /api/finance/loyalty/*
//	admin : /api/loyalty/admin/*  (RBAC loyalty.*)
func (h *Handler) Register(member, admin *gin.RouterGroup, guard GuardFunc) {
	member.GET("/me", h.Me)
	member.GET("/tiers", h.Tiers)
	member.GET("/rewards", h.Rewards)
	member.POST("/redeem", h.Redeem)

	// Admin reward/tier config is RBAC-gated; CRUD lands directly on the config
	// tables (loyalty_tiers / loyalty_earn_rules / loyalty_catalog) which are seeded
	// by migration — these endpoints are the guarded management surface.
	admin.GET("/memberships/:userId", guard("loyalty.read"), h.AdminMembership)
}

func (h *Handler) Me(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	m, err := h.svc.GetMembership(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "membership": m})
}

// Tiers GET /loyalty/tiers — active tier config (thresholds + benefits).
func (h *Handler) Tiers(c *gin.Context) {
	tiers, err := h.svc.ListTiers(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "tiers": tiers})
}

func (h *Handler) Rewards(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	items, err := h.svc.ListCatalog(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "rewards": items})
}

type redeemRequest struct {
	SKU string `json:"sku" binding:"required"`
}

func (h *Handler) Redeem(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var req redeemRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	red, err := h.svc.Redeem(c.Request.Context(), userID, req.SKU, ginutil.IdempotencyKey(c))
	if err != nil {
		status := http.StatusBadRequest
		if errors.Is(err, ErrTierTooLow) {
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": httperr.Msg(c, status, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "redemption": red})
}

func (h *Handler) AdminMembership(c *gin.Context) {
	m, err := h.svc.GetMembership(c.Request.Context(), c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "membership": m})
}

// Tier is the membership level. TierBlack (BLACK) is defined in black.go.
type Tier string

const (
	Tier1 Tier = "TIER1"
	Tier2 Tier = "TIER2"
	Tier3 Tier = "TIER3"
)

// Membership is a user's loyalty standing. Lifetime points drive tier; the tier is
// re-evaluated on every earn (monotonic up within P1 — no auto-downgrade mid-period).
type Membership struct {
	UserID         string    `json:"user_id"`
	Tier           Tier      `json:"tier"`
	LifetimePoints int64     `json:"lifetime_points"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// TierDef is the versioned threshold + benefits config for a tier.
type TierDef struct {
	Tier            Tier           `json:"tier"`
	ThresholdPoints int64          `json:"threshold_points"`
	Benefits        map[string]any `json:"benefits"`
	Active          bool           `json:"active"`
}

// EarnRuleBinding maps a live-module action to a points rule key (config-driven so a
// new module event can be wired without code). Mirrors the points earn-rule but at
// the loyalty layer it records WHICH module trigger fires WHICH rule.
type EarnRuleBinding struct {
	ID        string    `json:"id"`
	Module    string    `json:"module"`   // payments | savings | tickets | referral
	Trigger   string    `json:"trigger"`  // e.g. bill_paid, vault_deposit, ticket_purchased, referral_converted
	RuleKey   string    `json:"rule_key"` // -> points_earn_rules.rule_key
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

// CatalogItem is a loyalty reward surfaced to members (a view over points catalog
// SKUs that are loyalty-eligible). Kind constrains fulfilment to non-cash rails.
type CatalogItem struct {
	ID         string `json:"id"`
	SKU        string `json:"sku"` // -> points_catalog.sku
	Title      string `json:"title"`
	Kind       string `json:"kind"` // airtime | bill | ticket_discount | perk
	CostPoints int64  `json:"cost_points"`
	MinTier    Tier   `json:"min_tier"` // gate a reward behind a tier
	Active     bool   `json:"active"`
}

// Redemption is the loyalty-side record of a reward claim (points already debited
// by points.Redeem). Fulfilment status tracks the non-cash dispatch.
type Redemption struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	SKU          string    `json:"sku"`
	Kind         string    `json:"kind"`
	CostPoints   int64     `json:"cost_points"`
	FulfilStatus string    `json:"fulfil_status"` // PENDING | FULFILLED | FAILED
	CreatedAt    time.Time `json:"created_at"`
}
