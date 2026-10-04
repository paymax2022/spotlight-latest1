package points

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"strconv"
	"strings"
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

// Service is the append-only points ledger + earn-rule engine. Hard invariant
// (NL-4): points are not cash. There is no API that credits a wallet from a points
// balance; Redeem only ever produces a non-cash fulfilment (airtime / bill /
// ticket-discount / perk). Every earn is idempotent (NL-9) via a unique idempotency
// key derived from the rule + business reference.
type Service struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewService(db *pgxpool.Pool, audit Auditor) *Service {
	return &Service{db: db, audit: audit}
}

// Earn awards points to a user under a rule. Idempotent: a duplicate (ruleKey +
// reference) is a safe no-op returning the existing entry with created=false. The
// active rule version is resolved at award time and stamped on the entry, so later
// rule edits never rewrite history. The created flag lets callers (loyalty tier
// re-eval) contribute a delta exactly once even when a webhook is replayed.
func (s *Service) Earn(ctx context.Context, userID, ruleKey string, ec EarnContext) (*Entry, bool, error) {
	if userID == "" || ruleKey == "" {
		return nil, false, errors.New("points: user and rule_key required")
	}
	rule, err := s.activeRule(ctx, ruleKey)
	if err != nil {
		return nil, false, err
	}
	if !rule.Active {
		return nil, false, fmt.Errorf("points: rule %s inactive", ruleKey)
	}

	award := rule.PointsFixed
	if rule.PointsPerKobo > 0 && ec.AmountKobo > 0 {
		award += int64(rule.PointsPerKobo * float64(ec.AmountKobo))
	}
	if award <= 0 {
		return nil, false, fmt.Errorf("points: rule %s yields non-positive award", ruleKey)
	}

	idem := fmt.Sprintf("earn:%s:v%d:%s", ruleKey, rule.Version, ec.Reference)
	var expires *time.Time
	if rule.ExpiryDays > 0 {
		t := time.Now().AddDate(0, 0, rule.ExpiryDays)
		expires = &t
	}

	e := &Entry{
		ID:             uuid.New().String(),
		UserID:         userID,
		Type:           EntryEarn,
		Points:         award,
		RuleKey:        ruleKey,
		Module:         rule.Module,
		Reference:      ec.Reference,
		IdempotencyKey: idem,
		ExpiresAt:      expires,
		CreatedAt:      time.Now(),
	}
	const ins = `
		INSERT INTO points_ledger (id, user_id, type, points, rule_key, module, reference, idempotency_key, expires_at)
		VALUES ($1,$2,'EARN',$3,$4,$5,$6,$7,$8)
		ON CONFLICT (idempotency_key) DO NOTHING`
	ct, err := s.db.Exec(ctx, ins, e.ID, e.UserID, e.Points, e.RuleKey, e.Module, e.Reference, e.IdempotencyKey, expires)
	if err != nil {
		return nil, false, fmt.Errorf("points: insert earn: %w", err)
	}
	if ct.RowsAffected() == 0 {
		// Idempotent replay — return the prior entry; created=false so callers do
		// not double-count the award (NL-9).
		prior, perr := s.entryByIdem(ctx, idem)
		return prior, false, perr
	}
	s.log(userID, "points.earn", e.ID, map[string]any{"rule": ruleKey, "points": award})
	return e, true, nil
}

// Balance returns the user's spendable points: EARN minus REDEEM/EXPIRE/ADJUST(neg)
// over non-expired entries. Computed from the append-only ledger — never stored.
func (s *Service) Balance(ctx context.Context, userID string) (int64, error) {
	const q = `
		SELECT COALESCE(SUM(CASE WHEN type='EARN' THEN points ELSE -points END), 0)
		FROM points_ledger
		WHERE user_id=$1
		  AND (type<>'EARN' OR expires_at IS NULL OR expires_at > now())`
	var bal int64
	if err := s.db.QueryRow(ctx, q, userID).Scan(&bal); err != nil {
		return 0, fmt.Errorf("points: balance: %w", err)
	}
	if bal < 0 {
		bal = 0
	}
	return bal, nil
}

// Redeem spends points against a catalog item. It debits the points ledger atomically
// (balance check under a row guard) and returns the Redemption + the item so the
// caller (loyalty layer) can dispatch the NON-CASH fulfilment. There is intentionally
// no cash-out branch (NL-4).
func (s *Service) Redeem(ctx context.Context, userID, sku string) (*Redemption, *CatalogItem, error) {
	item, err := s.catalogItem(ctx, sku)
	if err != nil {
		return nil, nil, err
	}
	if !item.Active {
		return nil, nil, fmt.Errorf("points: catalog item %s inactive", sku)
	}
	if item.Kind == "cash" || strings.Contains(strings.ToLower(item.Kind), "withdraw") {
		// Defence in depth: a misconfigured cash-like item can never be redeemed.
		return nil, nil, ErrCashRedemptionForbidden
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("points: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Recompute balance inside the tx and lock against concurrent redemptions by
	// serialising on the user's latest ledger rows.
	const balQ = `
		SELECT COALESCE(SUM(CASE WHEN type='EARN' THEN points ELSE -points END), 0)
		FROM points_ledger
		WHERE user_id=$1 AND (type<>'EARN' OR expires_at IS NULL OR expires_at > now())
		FOR UPDATE`
	var bal int64
	if err := tx.QueryRow(ctx, balQ, userID).Scan(&bal); err != nil {
		return nil, nil, fmt.Errorf("points: redeem balance: %w", err)
	}
	if bal < item.CostPoints {
		return nil, nil, ErrInsufficientPoints
	}

	redemptionID := uuid.New().String()
	idem := "redeem:" + redemptionID
	const debit = `
		INSERT INTO points_ledger (id, user_id, type, points, rule_key, module, reference, idempotency_key)
		VALUES ($1,$2,'REDEEM',$3,$4,'loyalty',$5,$6)`
	if _, err := tx.Exec(ctx, debit, uuid.New().String(), userID, item.CostPoints, "redeem:"+sku, redemptionID, idem); err != nil {
		return nil, nil, fmt.Errorf("points: redeem debit: %w", err)
	}
	const insRedemption = `
		INSERT INTO points_redemptions (id, user_id, sku, cost_points, status)
		VALUES ($1,$2,$3,$4,'REDEEMED')`
	if _, err := tx.Exec(ctx, insRedemption, redemptionID, userID, sku, item.CostPoints); err != nil {
		return nil, nil, fmt.Errorf("points: insert redemption: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, fmt.Errorf("points: commit redeem: %w", err)
	}

	r := &Redemption{ID: redemptionID, UserID: userID, SKU: sku, CostPoints: item.CostPoints, Status: "REDEEMED", CreatedAt: time.Now()}
	s.log(userID, "points.redeem", redemptionID, map[string]any{"sku": sku, "cost": item.CostPoints, "kind": item.Kind})
	return r, item, nil
}

// ExpireDue appends EXPIRE entries for earn rows past their expires_at that have not
// already been expired. Idempotent per earn row. Returns rows expired.
func (s *Service) ExpireDue(ctx context.Context, limit int) (int, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	const sel = `
		SELECT e.id, e.user_id, e.points
		FROM points_ledger e
		WHERE e.type='EARN' AND e.expires_at IS NOT NULL AND e.expires_at <= now()
		  AND NOT EXISTS (
		    SELECT 1 FROM points_ledger x
		    WHERE x.type='EXPIRE' AND x.reference = ('expire:' || e.id))
		LIMIT $1`
	rows, err := s.db.Query(ctx, sel, limit)
	if err != nil {
		return 0, err
	}
	type due struct {
		id, uid string
		pts     int64
	}
	var batch []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.uid, &d.pts); err != nil {
			rows.Close()
			return 0, err
		}
		batch = append(batch, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, d := range batch {
		idem := "expire:" + d.id
		const ins = `
			INSERT INTO points_ledger (id, user_id, type, points, rule_key, module, reference, idempotency_key)
			VALUES ($1,$2,'EXPIRE',$3,'expiry','loyalty',$4,$5)
			ON CONFLICT (idempotency_key) DO NOTHING`
		if _, err := s.db.Exec(ctx, ins, uuid.New().String(), d.uid, d.pts, "expire:"+d.id, idem); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func (s *Service) activeRule(ctx context.Context, ruleKey string) (*EarnRule, error) {
	const q = `
		SELECT id, rule_key, module, version, points_fixed, points_per_kobo, expiry_days, active, created_at
		FROM points_earn_rules
		WHERE rule_key=$1 AND active=true
		ORDER BY version DESC LIMIT 1`
	var r EarnRule
	if err := s.db.QueryRow(ctx, q, ruleKey).Scan(
		&r.ID, &r.RuleKey, &r.Module, &r.Version, &r.PointsFixed, &r.PointsPerKobo, &r.ExpiryDays, &r.Active, &r.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("points: no active rule for %s", ruleKey)
		}
		return nil, fmt.Errorf("points: load rule: %w", err)
	}
	return &r, nil
}

func (s *Service) catalogItem(ctx context.Context, sku string) (*CatalogItem, error) {
	const q = `SELECT id, sku, title, kind, cost_points, value_kobo, active FROM points_catalog WHERE sku=$1`
	var it CatalogItem
	if err := s.db.QueryRow(ctx, q, sku).Scan(
		&it.ID, &it.SKU, &it.Title, &it.Kind, &it.CostPoints, &it.ValueKobo, &it.Active,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("points: catalog item %s not found", sku)
		}
		return nil, fmt.Errorf("points: load catalog: %w", err)
	}
	return &it, nil
}

func (s *Service) entryByIdem(ctx context.Context, idem string) (*Entry, error) {
	const q = `
		SELECT id, user_id, type, points, rule_key, module, reference, idempotency_key, expires_at, created_at
		FROM points_ledger WHERE idempotency_key=$1`
	var e Entry
	var typ string
	if err := s.db.QueryRow(ctx, q, idem).Scan(
		&e.ID, &e.UserID, &typ, &e.Points, &e.RuleKey, &e.Module, &e.Reference, &e.IdempotencyKey, &e.ExpiresAt, &e.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("points: fetch by idem: %w", err)
	}
	e.Type = EntryType(typ)
	return &e, nil
}

// ListCatalog returns active redeemable items.
func (s *Service) ListCatalog(ctx context.Context) ([]CatalogItem, error) {
	const q = `SELECT id, sku, title, kind, cost_points, value_kobo, active FROM points_catalog WHERE active=true ORDER BY cost_points ASC`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CatalogItem
	for rows.Next() {
		var it CatalogItem
		if err := rows.Scan(&it.ID, &it.SKU, &it.Title, &it.Kind, &it.CostPoints, &it.ValueKobo, &it.Active); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// History returns the user's points ledger entries (append-only), newest first.
// This is the member-facing points transaction history (go-live gap).
func (s *Service) History(ctx context.Context, userID string, limit int) ([]Entry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT id, user_id, type, points, rule_key, module, reference, idempotency_key, expires_at, created_at
		FROM points_ledger WHERE user_id=$1
		ORDER BY created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Entry{}
	for rows.Next() {
		var e Entry
		var typ string
		if err := rows.Scan(&e.ID, &e.UserID, &typ, &e.Points, &e.RuleKey, &e.Module,
			&e.Reference, &e.IdempotencyKey, &e.ExpiresAt, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Type = EntryType(typ)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Service) log(userID, action, id string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(userID, "", action, "points", "points_ledger", id, nil, meta, "", "", "info")
}

// Sentinel errors.
var (
	ErrInsufficientPoints      = errors.New("points: insufficient points")
	ErrCashRedemptionForbidden = errors.New("points: points cannot be redeemed for cash (NL-4)")
)

// Handler exposes read-only points endpoints to members. Earn is never a public
// endpoint — points accrue only as a side effect of live module actions wired in
// the loyalty layer, so a client can never self-award points.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register mounts member points routes. Earn-rule + catalog administration is
// mounted by the loyalty admin group (RBAC points.*).
func (h *Handler) Register(member *gin.RouterGroup) {
	member.GET("/points/balance", h.Balance)
	member.GET("/points/history", h.History)
	member.GET("/points/catalog", h.Catalog)
	member.POST("/points/redeem", h.Redeem)
}

func (h *Handler) History(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	entries, err := h.svc.History(c.Request.Context(), userID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "history": entries})
}

func (h *Handler) Balance(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	bal, err := h.svc.Balance(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "balance_points": bal})
}

func (h *Handler) Catalog(c *gin.Context) {
	items, err := h.svc.ListCatalog(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "items": items})
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
	red, item, err := h.svc.Redeem(c.Request.Context(), userID, req.SKU)
	if err != nil {
		switch {
		case errors.Is(err, ErrInsufficientPoints):
			c.JSON(http.StatusPaymentRequired, gin.H{"error": httperr.Msg(c, http.StatusPaymentRequired, err)})
		case errors.Is(err, ErrCashRedemptionForbidden):
			c.JSON(http.StatusForbidden, gin.H{"error": httperr.Msg(c, http.StatusForbidden, err)})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		}
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "redemption": red, "item": item})
}

// EntryType is the direction of a points-ledger row. Append-only: balance is the
// projection of EARN - REDEEM - EXPIRE (never an updated column).
type EntryType string

const (
	EntryEarn   EntryType = "EARN"
	EntryRedeem EntryType = "REDEEM"
	EntryExpire EntryType = "EXPIRE"
	EntryAdjust EntryType = "ADJUST" // manual correction (admin, audited)
)

// Entry is one immutable points movement. Points are NOT money (NL-4): there is no
// kobo column and no path that converts a points balance to a cash withdrawal.
type Entry struct {
	ID             string     `json:"id"`
	UserID         string     `json:"user_id"`
	Type           EntryType  `json:"type"`
	Points         int64      `json:"points"` // always positive; direction from Type
	RuleKey        string     `json:"rule_key,omitempty"`
	Module         string     `json:"module,omitempty"` // payments | savings | tickets | referral | ...
	Reference      string     `json:"reference"`
	IdempotencyKey string     `json:"idempotency_key"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
}

// EarnRule is a versioned, config-driven earn definition (per action/module). A new
// version supersedes the prior one; historical entries keep the version they earned
// under, so a rule change never rewrites past awards.
type EarnRule struct {
	ID            string    `json:"id"`
	RuleKey       string    `json:"rule_key"` // e.g. "payments.bill_paid"
	Module        string    `json:"module"`
	Version       int       `json:"version"`
	PointsFixed   int64     `json:"points_fixed"`    // flat award
	PointsPerKobo float64   `json:"points_per_kobo"` // optional value-scaled award
	ExpiryDays    int       `json:"expiry_days"`     // 0 => never expires
	Active        bool      `json:"active"`
	CreatedAt     time.Time `json:"created_at"`
}

// CatalogItem is a redeemable reward. Redemption only ever targets airtime, bills,
// a ticket discount or a perk (NL-4) — never cash. Fulfilment is delegated to the
// owning module (bill-pay / airtime / ticketing) via the loyalty layer.
type CatalogItem struct {
	ID         string         `json:"id"`
	SKU        string         `json:"sku"`
	Title      string         `json:"title"`
	Kind       string         `json:"kind"` // airtime | bill | ticket_discount | perk
	CostPoints int64          `json:"cost_points"`
	ValueKobo  int64          `json:"value_kobo"` // notional value for airtime/bill fulfilment (NOT cash-out)
	Active     bool           `json:"active"`
	Metadata   map[string]any `json:"metadata,omitempty"`
}

// Redemption records a points spend against a catalog item.
type Redemption struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	SKU        string    `json:"sku"`
	CostPoints int64     `json:"cost_points"`
	Status     string    `json:"status"` // REDEEMED | FULFILLED | FAILED
	CreatedAt  time.Time `json:"created_at"`
}

// EarnContext carries the data an earn rule scales against (e.g. the kobo amount of
// the underlying transaction) plus the reference that makes the award idempotent.
type EarnContext struct {
	Module     string
	Reference  string // unique business ref of the earning event
	AmountKobo int64  // for value-scaled rules
	Metadata   map[string]any
}
