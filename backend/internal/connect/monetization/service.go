package connectmonetization

import (
	"context"
	"encoding/json"
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

// CreditGranter grants consumable credits (super-likes, InMail) on a purchase.
// Optional dependency (set via SetCreditGranter) so a nil granter is a no-op and
// existing constructors/tests are unaffected. The grant is idempotent per key.
type CreditGranter interface {
	Grant(ctx context.Context, userID, creditType, idempotencyKey string, amount int64, reason string) error
}

// WalletRefunder reverses a charge back to the user's wallet as a BALANCED
// double-entry (DR paymax_revenue → CR user_wallet), keyed by idempotencyKey so a
// retried/concurrent refund posts AT MOST ONCE (PAY-007). The implementation must
// treat a duplicate idempotency key as success (money already returned), never as
// an error — that is what makes the refund single. We never touch a balance column.
type WalletRefunder interface {
	Refund(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64) error
}

// Sentinel errors.
var (
	ErrPlanNotFound   = errors.New("connect: plan not found or inactive")
	ErrMissingIdem    = errors.New("connect: Idempotency-Key required")
	ErrInvalidAmount  = errors.New("connect: amount must be positive kobo")
	ErrKindMismatch   = errors.New("connect: plan kind does not match endpoint")
	ErrOrderNotFound  = errors.New("connect: order not found")
	ErrNotRefundable  = errors.New("connect: order is not in a refundable state")
	ErrNoRefunder     = errors.New("connect: refunds not configured")
)

// Service orchestrates Phase 6 money flows. It owns NO balance state — money
// movement is delegated to the wallet (ledger), and entitlements/orders are
// projections recorded after a successful, idempotent debit.
type Service struct {
	db       *pgxpool.Pool
	wallet   WalletDebiter
	revenue  RevenueAccountResolver
	audit    Auditor
	refunder WalletRefunder
	credits  CreditGranter // optional; set via SetCreditGranter
	// planLookup resolves an active plan by code. Defaults to the DB query;
	// overridable in tests so the money path runs without a live database.
	planLookup func(ctx context.Context, code string) (*Plan, error)
}

func NewService(db *pgxpool.Pool, w WalletDebiter, rev RevenueAccountResolver, audit Auditor, refunder WalletRefunder) *Service {
	s := &Service{db: db, wallet: w, revenue: rev, audit: audit, refunder: refunder}
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

	// Grant consumable credits for one-off passes (super-likes/InMail). Best-effort:
	// money + order are already committed, and the grant is idempotent (keyed by the
	// order key), so a failure is audited for reconciliation rather than failing the
	// (already-charged) purchase. PAY-008.
	if err := s.grantPurchaseCredits(ctx, userID, idemKey, plan); err != nil {
		_ = s.audit.WriteAudit(ctx, "connect.credit.grant_failed", userID, "connect_order", order.ID, map[string]any{
			"plan_code": plan.Code, "error": err.Error(),
		})
	}
	return order, ent, nil
}

// SetCreditGranter wires the optional consumable-credit granter (PAY-008). Nil ⇒ no-op.
func (s *Service) SetCreditGranter(g CreditGranter) { s.credits = g }

// grantPurchaseCredits grants each positive numeric entitlement of a one-off PASS
// as consumable credits of that type, keyed per (order, credit type).
func (s *Service) grantPurchaseCredits(ctx context.Context, userID, idemKey string, plan *Plan) error {
	if s.credits == nil || plan.Kind != KindPass || len(plan.Entitlements) == 0 {
		return nil
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(plan.Entitlements, &m); err != nil {
		return nil // non-object entitlements → nothing to grant
	}
	for creditType, raw := range m {
		var n int64
		if err := json.Unmarshal(raw, &n); err == nil && n > 0 {
			if err := s.credits.Grant(ctx, userID, creditType, idemKey+":"+creditType, n, "purchase "+plan.Code); err != nil {
				return err
			}
		}
	}
	return nil
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

// Refund reverses a paid order (PAY-007): it returns the exact charged amount to
// the buyer's wallet via a balanced reversing ledger entry, marks the order
// 'refunded', and revokes the entitlement it granted. Admin-initiated.
//
// SAFE & SINGLE: the reversing entry is keyed by the order id, so the ledger's
// unique-idempotency-key constraint guarantees the money is returned at most once
// even under retries or concurrent calls (the refunder maps a duplicate key to
// success). Money movement happens FIRST; the order/entitlement projection follows,
// so a crash between the two is resolved safely on replay (the second attempt sees
// the ledger duplicate and just finishes the projection). Refunding an already-
// refunded order is an idempotent no-op.
func (s *Service) Refund(ctx context.Context, orderID, adminID, reason string) (*Order, error) {
	const sel = `SELECT id, user_id, plan_id, plan_code, kind, amount_kobo, status, ledger_ref, created_at
		FROM connect_orders WHERE id = $1`
	o := &Order{}
	if err := s.db.QueryRow(ctx, sel, orderID).Scan(
		&o.ID, &o.UserID, &o.PlanID, &o.PlanCode, &o.Kind, &o.AmountKobo, &o.Status, &o.LedgerRef, &o.CreatedAt,
	); err != nil {
		return nil, ErrOrderNotFound
	}
	if o.Status == "refunded" {
		return o, nil // idempotent: money already returned exactly once
	}
	if o.Status != "paid" {
		return nil, ErrNotRefundable
	}
	if s.refunder == nil {
		return nil, ErrNoRefunder
	}

	// 1) Money-movement first — reverse the charge, keyed by the order id so it is
	//    single under retries/concurrency. Duplicate key ⇒ already refunded ⇒ nil.
	refundKey := "connect:refund:" + o.ID
	refundRef := "connect:refund:" + string(o.Kind) + ":" + o.PlanCode
	if err := s.refunder.Refund(ctx, o.UserID, refundRef, refundKey, o.AmountKobo); err != nil {
		return nil, fmt.Errorf("connect: post refund entry: %w", err)
	}

	// 2) Projection — mark the order refunded (guarded) and revoke its entitlement,
	//    atomically. The WHERE status='paid' guard makes concurrent markers no-ops.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE connect_orders SET status = 'refunded' WHERE id = $1 AND status = 'paid'`, o.ID); err != nil {
		return nil, fmt.Errorf("connect: mark order refunded: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE connect_entitlements SET active = false, updated_at = now() WHERE source_order = $1`, o.ID); err != nil {
		return nil, fmt.Errorf("connect: revoke entitlement: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit refund: %w", err)
	}
	o.Status = "refunded"

	_ = s.audit.WriteAudit(ctx, "connect.refund", adminID, "connect_order", o.ID, map[string]any{
		"amount_kobo": o.AmountKobo, "plan_code": o.PlanCode, "reason": reason,
		"idempotency_key": refundKey, "ledger_ref": refundRef,
	})
	return o, nil
}

// --- PAY-006: subscription billing cycle (cancel / auto-renew / proration) ---

// ErrNoActiveSubscription is returned when a cancel finds no active subscription.
var ErrNoActiveSubscription = errors.New("connect: no active subscription")

// CancelResult reports the outcome of a cancellation.
type CancelResult struct {
	EntitlementID      string     `json:"entitlement_id"`
	Immediate          bool       `json:"immediate"`
	ProratedRefundKobo int64      `json:"prorated_refund_kobo"`
	ExpiresAt          *time.Time `json:"expires_at,omitempty"`
	AlreadyCanceled    bool       `json:"already_canceled"`
}

// CancelSubscription cancels the caller's active subscription (PAY-006).
//   - end-of-period (immediate=false, default): auto-renew is turned off and the
//     entitlement keeps working until its paid period ends. Idempotent.
//   - immediate=true: the entitlement is deactivated now and the UNUSED portion is
//     refunded pro-rata to the wallet via a partial reversing ledger entry keyed by
//     the entitlement id (single/idempotent, reuses the refund rail).
func (s *Service) CancelSubscription(ctx context.Context, userID string, immediate bool) (*CancelResult, error) {
	const q = `SELECT e.id, e.granted_at, e.expires_at, e.canceled_at,
	                  COALESCE(o.amount_kobo, 0), COALESCE(o.plan_code, e.plan_code)
	           FROM connect_entitlements e
	           LEFT JOIN connect_orders o ON o.id = e.source_order
	           WHERE e.user_id = $1::uuid AND e.kind = 'subscription' AND e.active = true
	           ORDER BY e.granted_at DESC LIMIT 1`
	var (
		entID      string
		granted    time.Time
		expires    *time.Time
		canceled   *time.Time
		amountKobo int64
		planCode   string
	)
	if err := s.db.QueryRow(ctx, q, userID).Scan(&entID, &granted, &expires, &canceled, &amountKobo, &planCode); err != nil {
		return nil, ErrNoActiveSubscription
	}
	res := &CancelResult{EntitlementID: entID, Immediate: immediate, ExpiresAt: expires}
	if canceled != nil && !immediate {
		res.AlreadyCanceled = true
		return res, nil // idempotent: already scheduled to end at period close
	}
	now := time.Now().UTC()

	if immediate {
		if expires != nil {
			refund := proratedRefundKobo(amountKobo, granted, *expires, now)
			if refund > 0 && s.refunder != nil {
				// Keyed by entitlement id ⇒ the unused-time refund posts at most once.
				if err := s.refunder.Refund(ctx, userID, "connect:prorate:subscription:"+planCode,
					"connect:prorate:"+entID, refund); err != nil {
					return nil, fmt.Errorf("connect: prorated refund: %w", err)
				}
				res.ProratedRefundKobo = refund
			}
		}
		if _, err := s.db.Exec(ctx,
			`UPDATE connect_entitlements SET active = false, auto_renew = false,
			        canceled_at = COALESCE(canceled_at, now()), expires_at = now(), updated_at = now()
			 WHERE id = $1`, entID); err != nil {
			return nil, fmt.Errorf("connect: deactivate entitlement: %w", err)
		}
		res.ExpiresAt = &now
	} else {
		if _, err := s.db.Exec(ctx,
			`UPDATE connect_entitlements SET auto_renew = false, canceled_at = now(), updated_at = now()
			 WHERE id = $1`, entID); err != nil {
			return nil, fmt.Errorf("connect: cancel entitlement: %w", err)
		}
	}

	_ = s.audit.WriteAudit(ctx, "connect.subscription.cancel", userID, "connect_entitlement", entID, map[string]any{
		"immediate": immediate, "prorated_refund_kobo": res.ProratedRefundKobo,
	})
	return res, nil
}

// RenewalReport summarises a renewal batch run.
type RenewalReport struct {
	Due     int `json:"due"`
	Renewed int `json:"renewed"`
	Lapsed  int `json:"lapsed"`
	Skipped int `json:"skipped"`
}

// ProcessRenewals charges + extends every subscription due to bill at `now`
// (PAY-006 auto-renewal). Intended to be driven by a scheduler; `now` is injected
// so it is deterministically testable.
//
// Per due entitlement: charge the plan price via the wallet, keyed by
// entitlement+period so a cycle is billed AT MOST ONCE (retry/crash-safe); on
// success (or an already-charged duplicate) extend expires_at by the interval and
// record a renewal order; on insufficient funds the subscription LAPSES
// (deactivated). A dead/invalid plan is skipped, not force-charged.
func (s *Service) ProcessRenewals(ctx context.Context, now time.Time) (*RenewalReport, error) {
	revAcc, err := s.revenue.RevenueAccountID(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: resolve revenue account: %w", err)
	}
	const q = `SELECT id, user_id, plan_code, expires_at
	           FROM connect_entitlements
	           WHERE kind = 'subscription' AND active = true AND auto_renew = true
	             AND canceled_at IS NULL AND expires_at IS NOT NULL AND expires_at <= $1
	           ORDER BY expires_at ASC LIMIT 500`
	rows, err := s.db.Query(ctx, q, now)
	if err != nil {
		return nil, fmt.Errorf("connect: select due renewals: %w", err)
	}
	type due struct {
		id, user, planCode string
		expires            time.Time
	}
	var dues []due
	for rows.Next() {
		var d due
		if err := rows.Scan(&d.id, &d.user, &d.planCode, &d.expires); err != nil {
			rows.Close()
			return nil, err
		}
		dues = append(dues, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rep := &RenewalReport{Due: len(dues)}
	for _, d := range dues {
		plan, perr := s.planLookup(ctx, d.planCode)
		if perr != nil || plan.Kind != KindSubscription || plan.IntervalDays == nil || *plan.IntervalDays <= 0 || plan.PriceKobo <= 0 {
			rep.Skipped++ // can't renew on a dead/invalid plan — leave for admin
			continue
		}
		key := "connect:renew:" + d.id + ":" + d.expires.UTC().Format(time.RFC3339)
		ref := "connect:renew:subscription:" + d.planCode
		derr := s.wallet.Debit(ctx, d.user, ref, key, revAcc, plan.PriceKobo)
		switch {
		case derr == nil || isDuplicateErr(derr):
			newExp := d.expires.AddDate(0, 0, *plan.IntervalDays)
			// Guard on the old expiry so concurrent/duplicate runs never double-extend.
			if _, err := s.db.Exec(ctx,
				`UPDATE connect_entitlements SET expires_at = $2, updated_at = now()
				 WHERE id = $1 AND expires_at = $3`, d.id, newExp, d.expires); err != nil {
				return rep, fmt.Errorf("connect: extend entitlement: %w", err)
			}
			// Idempotent renewal order (unique idempotency_key).
			_, _ = s.db.Exec(ctx,
				`INSERT INTO connect_orders (user_id, plan_id, plan_code, kind, amount_kobo, status, idempotency_key, ledger_ref)
				 VALUES ($1::uuid,$2,$3,'subscription',$4,'paid',$5,$6)
				 ON CONFLICT (idempotency_key) DO NOTHING`,
				d.user, plan.ID, d.planCode, plan.PriceKobo, key, ref)
			rep.Renewed++
			_ = s.audit.WriteAudit(ctx, "connect.subscription.renew", d.user, "connect_entitlement", d.id, map[string]any{
				"amount_kobo": plan.PriceKobo, "new_expiry": newExp,
			})
		case isInsufficientFundsErr(derr):
			if _, err := s.db.Exec(ctx,
				`UPDATE connect_entitlements SET active = false, updated_at = now() WHERE id = $1`, d.id); err != nil {
				return rep, fmt.Errorf("connect: lapse entitlement: %w", err)
			}
			rep.Lapsed++
			_ = s.audit.WriteAudit(ctx, "connect.subscription.lapse", d.user, "connect_entitlement", d.id, map[string]any{
				"reason": "insufficient_funds",
			})
		default:
			rep.Skipped++ // transient (e.g. tier/DB) — retried next run
		}
	}
	return rep, nil
}

// isDuplicateErr / isInsufficientFundsErr match the ledger's sentinel errors by
// message so this package need not import the ledger (same approach as the HTTP
// error mapper). The ledger guarantees these substrings.
func isDuplicateErr(err error) bool {
	return err != nil && contains(err.Error(), "duplicate")
}
func isInsufficientFundsErr(err error) bool {
	return err != nil && contains(err.Error(), "insufficient funds")
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
