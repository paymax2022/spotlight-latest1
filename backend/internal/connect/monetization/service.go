package connectmonetization

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WalletDebiter is the slice of the finance wallet service this package needs.
// The real implementation (internal/finance/wallet.Service.Debit) enforces the
// tier limit (fail-closed) and posts a BALANCED double-entry: DR user_wallet,
// CR the given account, keyed by idempotencyKey. We never touch the ledger here.
type WalletDebiter interface {
	Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
}

// RevenueAccountResolver returns the standing account id to credit for Connect
// revenue (paymax_revenue). Implemented by the ledger service.
type RevenueAccountResolver interface {
	RevenueAccountID(ctx context.Context) (string, error)
}

// Auditor writes an immutable audit entry. Implemented by the connect safety
// service (WriteAudit). Every money mutation emits one.
type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// Sentinel errors.
var (
	ErrPlanNotFound  = errors.New("connect: plan not found or inactive")
	ErrMissingIdem   = errors.New("connect: Idempotency-Key required")
	ErrInvalidAmount = errors.New("connect: amount must be positive kobo")
	ErrKindMismatch  = errors.New("connect: plan kind does not match endpoint")
)

// Service orchestrates Phase 6 money flows. It owns NO balance state — money
// movement is delegated to the wallet (ledger), and entitlements/orders are
// projections recorded after a successful, idempotent debit.
type Service struct {
	db      *pgxpool.Pool
	wallet  WalletDebiter
	revenue RevenueAccountResolver
	audit   Auditor
	// planLookup resolves an active plan by code. Defaults to the DB query;
	// overridable in tests so the money path runs without a live database.
	planLookup func(ctx context.Context, code string) (*Plan, error)
}

func NewService(db *pgxpool.Pool, w WalletDebiter, rev RevenueAccountResolver, audit Auditor) *Service {
	s := &Service{db: db, wallet: w, revenue: rev, audit: audit}
	s.planLookup = s.getPlan
	return s
}

// ListPlans returns the active backend-owned catalogue (optionally filtered by kind).
func (s *Service) ListPlans(ctx context.Context, kind PlanKind) ([]Plan, error) {
	const q = `SELECT id, code, kind, name, price_kobo, interval_days, entitlements, active
		FROM connect_plans
		WHERE active = true AND ($1 = '' OR kind = $1)
		ORDER BY kind, price_kobo`
	rows, err := s.db.Query(ctx, q, string(kind))
	if err != nil {
		return nil, fmt.Errorf("connect: list plans: %w", err)
	}
	defer rows.Close()
	var out []Plan
	for rows.Next() {
		var p Plan
		if err := rows.Scan(&p.ID, &p.Code, &p.Kind, &p.Name, &p.PriceKobo,
			&p.IntervalDays, &p.Entitlements, &p.Active); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// getPlan resolves an active plan by code (server-side price/entitlement source).
func (s *Service) getPlan(ctx context.Context, code string) (*Plan, error) {
	const q = `SELECT id, code, kind, name, price_kobo, interval_days, entitlements, active
		FROM connect_plans WHERE code = $1 AND active = true`
	var p Plan
	err := s.db.QueryRow(ctx, q, code).Scan(&p.ID, &p.Code, &p.Kind, &p.Name,
		&p.PriceKobo, &p.IntervalDays, &p.Entitlements, &p.Active)
	if err != nil {
		return nil, ErrPlanNotFound
	}
	return &p, nil
}

// Purchase is the core money path: subscribe / buy a boost / buy a pass.
//
// Ordering (correctness > convenience):
//  1. validate input + resolve plan (price comes from the DB, NOT the client);
//  2. require an Idempotency-Key;
//  3. debit the wallet (this enforces the tier limit fail-closed and posts the
//     balanced double-entry DR user_wallet → CR paymax_revenue, keyed by the
//     idempotency key — a retry is a safe no-op via the ledger unique constraint);
//  4. record the immutable order + project the entitlement (server-side);
//  5. emit an audit event.
//
// expectedKind guards the endpoint (POST /subscriptions must buy a subscription, etc.).
func (s *Service) Purchase(ctx context.Context, userID, idemKey string, expectedKind PlanKind, req PurchaseRequest) (*Order, *Entitlement, error) {
	if idemKey == "" {
		return nil, nil, ErrMissingIdem
	}
	plan, err := s.planLookup(ctx, req.PlanCode)
	if err != nil {
		return nil, nil, err
	}
	if plan.Kind != expectedKind {
		return nil, nil, ErrKindMismatch
	}
	if plan.PriceKobo <= 0 {
		return nil, nil, ErrInvalidAmount
	}

	revAcc, err := s.revenue.RevenueAccountID(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("connect: resolve revenue account: %w", err)
	}

	ref := "connect:" + string(plan.Kind) + ":" + plan.Code
	// Money mutation — balanced double-entry, tier-checked, idempotent.
	if err := s.wallet.Debit(ctx, userID, ref, idemKey, revAcc, plan.PriceKobo); err != nil {
		return nil, nil, err // ErrInsufficientFunds / ErrDuplicate / tier error bubble up
	}

	now := time.Now().UTC()
	order, ent, err := s.recordPurchase(ctx, userID, plan, idemKey, ref, now)
	if err != nil {
		// The debit succeeded but projection failed: surface loudly. Reconciliation
		// (admin) can detect orphaned ledger entries via the missing order row.
		return nil, nil, fmt.Errorf("connect: record purchase after debit: %w", err)
	}

	_ = s.audit.WriteAudit(ctx, "connect.purchase", userID, "connect_order", order.ID, map[string]any{
		"plan_code": plan.Code, "kind": string(plan.Kind), "amount_kobo": plan.PriceKobo,
		"idempotency_key": idemKey, "ledger_ref": ref,
	})
	return order, ent, nil
}

// recordPurchase inserts the immutable order and projects the entitlement in one tx.
func (s *Service) recordPurchase(ctx context.Context, userID string, plan *Plan, idemKey, ref string, now time.Time) (*Order, *Entitlement, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)

	orderID := uuid.New().String()
	const insOrder = `INSERT INTO connect_orders
		(id, user_id, plan_id, plan_code, kind, amount_kobo, status, idempotency_key, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,$6,'paid',$7,$8)
		RETURNING id, user_id, plan_id, plan_code, kind, amount_kobo, status, ledger_ref, created_at`
	o := &Order{}
	if err := tx.QueryRow(ctx, insOrder,
		orderID, userID, plan.ID, plan.Code, string(plan.Kind), plan.PriceKobo, idemKey, ref,
	).Scan(&o.ID, &o.UserID, &o.PlanID, &o.PlanCode, &o.Kind, &o.AmountKobo, &o.Status, &o.LedgerRef, &o.CreatedAt); err != nil {
		return nil, nil, err
	}

	exp := plan.expiresFor(now)
	var ent *Entitlement
	if plan.Kind == KindSubscription {
		// Replace any existing active subscription (one active sub per user).
		if _, err := tx.Exec(ctx,
			`UPDATE connect_entitlements SET active = false, updated_at = now()
			 WHERE user_id = $1 AND kind = 'subscription' AND active = true`, userID); err != nil {
			return nil, nil, err
		}
	}
	entID := uuid.New().String()
	const insEnt = `INSERT INTO connect_entitlements
		(id, user_id, plan_code, kind, features, granted_at, expires_at, source_order, active)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
		RETURNING id, user_id, plan_code, kind, features, granted_at, expires_at, active`
	ent = &Entitlement{}
	if err := tx.QueryRow(ctx, insEnt,
		entID, userID, plan.Code, string(plan.Kind), plan.Entitlements, now, exp, o.ID,
	).Scan(&ent.ID, &ent.UserID, &ent.PlanCode, &ent.Kind, &ent.Features, &ent.GrantedAt, &ent.ExpiresAt, &ent.Active); err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return o, ent, nil
}

// ActiveEntitlements returns the user's current server-side entitlements
// (active and not expired). This is the enforcement read — callers gate features
// on it, never on a client claim.
func (s *Service) ActiveEntitlements(ctx context.Context, userID string) ([]Entitlement, error) {
	const q = `SELECT id, user_id, plan_code, kind, features, granted_at, expires_at, active
		FROM connect_entitlements
		WHERE user_id = $1 AND active = true AND (expires_at IS NULL OR expires_at > now())
		ORDER BY granted_at DESC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: active entitlements: %w", err)
	}
	defer rows.Close()
	var out []Entitlement
	for rows.Next() {
		var e Entitlement
		if err := rows.Scan(&e.ID, &e.UserID, &e.PlanCode, &e.Kind, &e.Features,
			&e.GrantedAt, &e.ExpiresAt, &e.Active); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// HasFeature reports whether the user currently has a named feature flag set true
// in any active entitlement. Server-side enforcement helper.
func (s *Service) HasFeature(ctx context.Context, userID, feature string) (bool, error) {
	ents, err := s.ActiveEntitlements(ctx, userID)
	if err != nil {
		return false, err
	}
	return featureEnabled(ents, feature), nil
}

// Book debits the wallet for a date-planner ride/ticket and records the booking
// reference. Reuses the wallet (balanced, idempotent, tier-checked); the actual
// ride/ticket is provisioned by the reused Mobility/Events module (external_ref).
func (s *Service) Book(ctx context.Context, userID, idemKey string, req BookingRequest) (*Booking, error) {
	if idemKey == "" {
		return nil, ErrMissingIdem
	}
	if req.Kind != "ride" && req.Kind != "ticket" {
		return nil, fmt.Errorf("connect: booking kind must be ride|ticket")
	}
	if req.AmountKobo <= 0 {
		return nil, ErrInvalidAmount
	}

	revAcc, err := s.revenue.RevenueAccountID(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: resolve revenue account: %w", err)
	}
	ref := "connect:dateplan:" + req.Kind
	if err := s.wallet.Debit(ctx, userID, ref, idemKey, revAcc, req.AmountKobo); err != nil {
		return nil, err
	}

	id := uuid.New().String()
	const ins = `INSERT INTO connect_date_plan_bookings
		(id, user_id, kind, external_ref, event_id, amount_kobo, status, idempotency_key, ledger_ref)
		VALUES ($1,$2,$3,$4, NULLIF($5,'')::uuid, $6, 'booked', $7, $8)
		RETURNING id, user_id, kind, COALESCE(external_ref,''), COALESCE(event_id::text,''), amount_kobo, status, ledger_ref, created_at`
	b := &Booking{}
	if err := s.db.QueryRow(ctx, ins,
		id, userID, req.Kind, req.ExternalRef, req.EventID, req.AmountKobo, idemKey, ref,
	).Scan(&b.ID, &b.UserID, &b.Kind, &b.ExternalRef, &b.EventID, &b.AmountKobo, &b.Status, &b.LedgerRef, &b.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: record booking after debit: %w", err)
	}

	_ = s.audit.WriteAudit(ctx, "connect.dateplan.book", userID, "connect_date_plan_booking", b.ID, map[string]any{
		"kind": req.Kind, "amount_kobo": req.AmountKobo, "idempotency_key": idemKey, "ledger_ref": ref,
	})
	return b, nil
}

// --- Admin: plan management + reconciliation ---

// UpsertPlan creates or updates a plan (admin only). Backend-owned catalogue write.
func (s *Service) UpsertPlan(ctx context.Context, adminID string, p Plan) (*Plan, error) {
	if !ValidPlanKind(p.Kind) {
		return nil, fmt.Errorf("connect: invalid plan kind %q", p.Kind)
	}
	if p.PriceKobo < 0 {
		return nil, ErrInvalidAmount
	}
	const q = `INSERT INTO connect_plans (code, kind, name, price_kobo, interval_days, entitlements, active)
		VALUES ($1,$2,$3,$4,$5,COALESCE($6,'{}'::jsonb),$7)
		ON CONFLICT (code) DO UPDATE SET
			name = EXCLUDED.name, price_kobo = EXCLUDED.price_kobo,
			interval_days = EXCLUDED.interval_days, entitlements = EXCLUDED.entitlements,
			active = EXCLUDED.active, updated_at = now()
		RETURNING id, code, kind, name, price_kobo, interval_days, entitlements, active`
	out := &Plan{}
	if err := s.db.QueryRow(ctx, q,
		p.Code, string(p.Kind), p.Name, p.PriceKobo, p.IntervalDays, p.Entitlements, p.Active,
	).Scan(&out.ID, &out.Code, &out.Kind, &out.Name, &out.PriceKobo, &out.IntervalDays, &out.Entitlements, &out.Active); err != nil {
		return nil, fmt.Errorf("connect: upsert plan: %w", err)
	}
	_ = s.audit.WriteAudit(ctx, "connect.plan.upsert", adminID, "connect_plan", out.ID, map[string]any{
		"code": out.Code, "price_kobo": out.PriceKobo, "active": out.Active,
	})
	return out, nil
}

// ListOrders returns orders for reconciliation (admin). Optional user filter.
func (s *Service) ListOrders(ctx context.Context, userID string, limit int) ([]Order, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, user_id, plan_id, plan_code, kind, amount_kobo, status, ledger_ref, created_at
		FROM connect_orders WHERE ($1 = '' OR user_id = $1::uuid)
		ORDER BY created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list orders: %w", err)
	}
	defer rows.Close()
	var out []Order
	for rows.Next() {
		var o Order
		if err := rows.Scan(&o.ID, &o.UserID, &o.PlanID, &o.PlanCode, &o.Kind,
			&o.AmountKobo, &o.Status, &o.LedgerRef, &o.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
