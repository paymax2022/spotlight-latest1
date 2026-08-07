package points

import (
	"context"
	"fmt"
	"strings"
	"time"

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
		return nil, false, fmt.Errorf("points: user and rule_key required")
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
	defer tx.Rollback(ctx)

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

// --- rule / catalog access ---

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
		if err == pgx.ErrNoRows {
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
		if err == pgx.ErrNoRows {
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
	ErrInsufficientPoints      = fmt.Errorf("points: insufficient points")
	ErrCashRedemptionForbidden = fmt.Errorf("points: points cannot be redeemed for cash (NL-4)")
)
