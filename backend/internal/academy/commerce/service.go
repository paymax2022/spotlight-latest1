package commerce

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the Spotlight Academy commerce domain. It owns the GUARDED purchase
// state machine (cart→checkout→paid|bnpl_active→entitled→refunded), local
// entitlement state, access-card redemption and the deterministic offline sync.
//
// Money NEVER moves here directly: value movement is delegated to the injected
// PaymentRail / BNPLRail (paymax-rails.md §1 — adapter, not SDK leak). This module
// only flips LOCAL entitlement state once the rail confirms, and every guarded
// transition is idempotent (charge/grant/refund/activate) and audit-logged.
type Service struct {
	repo *Repository
	pay  PaymentRail
	bnpl BNPLRail
	gate ApprovalGate // child-safety purchase-approval gate (optional; nil = no gate)
}

// NewService wires the commerce service. nil rails fall back to dev stubs so the
// package runs end-to-end without a vendor bound (deterministic + idempotent).
func NewService(db *pgxpool.Pool, pay PaymentRail, bnpl BNPLRail) *Service {
	if pay == nil {
		pay = StubPaymentRail{}
	}
	if bnpl == nil {
		bnpl = StubBNPLRail{}
	}
	return &Service{repo: NewRepository(db), pay: pay, bnpl: bnpl}
}

// Idempotency scopes (must match academy_idempotency_keys.scope namespace docs).
const (
	scopePayNow    = "order.pay_now"
	scopeBNPL      = "order.bnpl"
	scopeRefund    = "order.refund"
	scopeActivate  = "access_card.activate"
	scopeSubscribe = "subscription.subscribe"
	scopeSync      = "sync"
)

// requestHash binds an idempotency key to its request body so the same key with a
// different body is rejected (idempotency_key_reused) rather than silently replayed.
func requestHash(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// ── Catalog reads ──────────────────────────────────────────────────────────────

func (s *Service) ListPlans(ctx context.Context) ([]Plan, error) {
	return s.repo.ListPlans(ctx)
}

func (s *Service) ListBundles(ctx context.Context, arenaID string) ([]ExamBundle, error) {
	return s.repo.ListBundles(ctx, arenaID)
}

// GetBundle returns a single exam bundle by id (public catalog read; same ExamBundle
// row/shape as the ListBundles list item). Mirrors ListBundles' visibility rule —
// only active bundles are catalog-visible — so a non-active or missing id is 404.
func (s *Service) GetBundle(ctx context.Context, id string) (*ExamBundle, error) {
	b, err := s.repo.GetBundle(ctx, id)
	if err != nil {
		return nil, err
	}
	if b.Status != "active" {
		return nil, ErrNotFound
	}
	return b, nil
}

func (s *Service) BundleManifest(ctx context.Context, id string) (*BundleManifest, error) {
	return s.repo.GetContentBundleManifest(ctx, id)
}

// ── Order creation (cart → checkout) ────────────────────────────────────────────

// CreateOrder opens an order in checkout with the price LOCKED from the catalog
// (never client-supplied). kind ∈ {plan, bundle}; the referenced item must be active.
func (s *Service) CreateOrder(ctx context.Context, userID string, req CreateOrderRequest) (*Order, error) {
	if userID == "" {
		return nil, ErrNotFound
	}
	var amount int64
	switch req.Kind {
	case "plan":
		p, err := s.repo.GetPlan(ctx, req.RefID)
		if err != nil {
			return nil, err
		}
		if p.Status != "active" {
			return nil, ErrCatalogItemInactive
		}
		amount = p.PriceMinor
	case "bundle":
		b, err := s.repo.GetBundle(ctx, req.RefID)
		if err != nil {
			return nil, err
		}
		if b.Status != "active" {
			return nil, ErrCatalogItemInactive
		}
		amount = b.PriceMinor
	default:
		return nil, ErrInvalidAmount
	}
	if amount < 0 {
		return nil, ErrInvalidAmount
	}
	ord, err := s.repo.InsertOrder(ctx, userID, req.Kind, req.RefID, amount)
	if err != nil {
		return nil, err
	}
	// cart → checkout is implicit in InsertOrder (created at checkout); audit it.
	_ = s.audit(ctx, s.repo.db, userID, "order.checkout", "academy_order", ord.ID, OrderCart, OrderCheckout, "", ord)
	return ord, nil
}

// ── PayNow (checkout → paid → entitled) ─────────────────────────────────────────

// PayNow charges the rail then flips the order paid→entitled and grants the LOCAL
// entitlement (source=order) atomically. Idempotent on idemKey: a replay returns
// the original effect with NO second charge and NO second entitlement.
func (s *Service) PayNow(ctx context.Context, userID, orderID, idemKey string) (*Order, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	ord, err := s.repo.GetOrder(ctx, userID, orderID)
	if err != nil {
		return nil, err
	}
	rh := requestHash(scopePayNow, userID, orderID)

	// Idempotency replay: same key returns the stored result; different body ⇒ reuse error.
	if prior, err := s.repo.FindIdem(ctx, idemKey, scopePayNow); err == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		return s.repo.GetOrder(ctx, userID, orderID)
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	// Already settled? Treat as idempotent success (no second charge).
	if ord.State == OrderPaid || ord.State == OrderEntitled {
		return ord, nil
	}
	// Child-safety: a minor's purchase needs guardian approval before any charge.
	if err := s.authorize(ctx, userID, orderID); err != nil {
		return nil, err
	}
	if !canOrder(ord.State, OrderPaid) {
		_ = s.audit(ctx, s.repo.db, userID, "order.pay_now_rejected", "academy_order", ord.ID, ord.State, OrderPaid, idemKey, emptyDetail())
		return nil, ErrIllegalTransition
	}

	// Money via RAIL (idempotent on idemKey). Charge is OUTSIDE the local tx: the rail
	// owns value movement; we record its ref and only then flip local state.
	payRef, err := s.pay.Charge(ctx, userID, orderID, idemKey, ord.AmountMinor)
	if err != nil {
		return nil, err
	}

	err = s.repo.withTx(ctx, func(tx pgx.Tx) error {
		if err := setOrderState(ctx, tx, orderID, OrderCheckout, OrderPaid, &payRef, nil, idemKey); err != nil {
			return err
		}
		if err := setOrderState(ctx, tx, orderID, OrderPaid, OrderEntitled, nil, nil, idemKey); err != nil {
			return err
		}
		if _, _, err := grantEntitlement(ctx, tx, userID, ord.Kind, ord.RefID, "order"); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, userID, "order.paid", "academy_order", orderID, OrderCheckout, OrderEntitled, idemKey, map[string]any{"paymentRef": payRef}); err != nil {
			return err
		}
		return saveIdem(ctx, tx, idemKey, scopePayNow, userID, rh, orderID, map[string]any{"orderId": orderID, "state": OrderEntitled})
	})
	if err != nil {
		return nil, err
	}
	return s.repo.GetOrder(ctx, userID, orderID)
}

// ── StartBNPL (checkout → bnpl_active → entitled) ───────────────────────────────

// StartBNPL opens a BNPL plan on the rail (rail OWNS eligibility + schedule), flips
// the order bnpl_active→entitled and grants the entitlement (source=bnpl). Idempotent.
func (s *Service) StartBNPL(ctx context.Context, userID, orderID, idemKey string) (*Order, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	ord, err := s.repo.GetOrder(ctx, userID, orderID)
	if err != nil {
		return nil, err
	}
	rh := requestHash(scopeBNPL, userID, orderID)

	if prior, err := s.repo.FindIdem(ctx, idemKey, scopeBNPL); err == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		return s.repo.GetOrder(ctx, userID, orderID)
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	if ord.State == OrderBNPLActive || ord.State == OrderEntitled {
		return ord, nil
	}
	// Child-safety: a minor's purchase needs guardian approval before BNPL starts.
	if err := s.authorize(ctx, userID, orderID); err != nil {
		return nil, err
	}
	if !canOrder(ord.State, OrderBNPLActive) {
		_ = s.audit(ctx, s.repo.db, userID, "order.bnpl_rejected", "academy_order", ord.ID, ord.State, OrderBNPLActive, idemKey, emptyDetail())
		return nil, ErrIllegalTransition
	}

	bnplRef, err := s.bnpl.StartPlan(ctx, userID, orderID, idemKey, ord.AmountMinor)
	if err != nil {
		return nil, err
	}

	err = s.repo.withTx(ctx, func(tx pgx.Tx) error {
		if err := setOrderState(ctx, tx, orderID, OrderCheckout, OrderBNPLActive, nil, &bnplRef, idemKey); err != nil {
			return err
		}
		if err := setOrderState(ctx, tx, orderID, OrderBNPLActive, OrderEntitled, nil, nil, idemKey); err != nil {
			return err
		}
		if _, _, err := grantEntitlement(ctx, tx, userID, ord.Kind, ord.RefID, "bnpl"); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, userID, "order.bnpl_active", "academy_order", orderID, OrderCheckout, OrderEntitled, idemKey, map[string]any{"bnplRef": bnplRef}); err != nil {
			return err
		}
		return saveIdem(ctx, tx, idemKey, scopeBNPL, userID, rh, orderID, map[string]any{"orderId": orderID, "state": OrderEntitled})
	})
	if err != nil {
		return nil, err
	}
	return s.repo.GetOrder(ctx, userID, orderID)
}

// ── Refund (entitled → refunded; admin) ─────────────────────────────────────────

// Refund reverses an entitled order: it revokes the LOCAL entitlement, flips the
// order entitled→refunded and writes a compensating audit record. Money reversal is
// the rail's concern (a refund posting is initiated out-of-band / by the rail); this
// module guarantees the local entitlement is reversed exactly once. Idempotent.
func (s *Service) Refund(ctx context.Context, adminID, orderID, idemKey string) (*Order, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	ord, err := s.repo.GetOrderAny(ctx, orderID)
	if err != nil {
		return nil, err
	}
	rh := requestHash(scopeRefund, orderID)

	if prior, err := s.repo.FindIdem(ctx, idemKey, scopeRefund); err == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		return s.repo.GetOrderAny(ctx, orderID)
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	if ord.State == OrderRefunded {
		return ord, nil // already reversed
	}
	if !canOrder(ord.State, OrderRefunded) {
		_ = s.audit(ctx, s.repo.db, adminID, "order.refund_rejected", "academy_order", ord.ID, ord.State, OrderRefunded, idemKey, emptyDetail())
		return nil, ErrRefundNotEligible
	}

	err = s.repo.withTx(ctx, func(tx pgx.Tx) error {
		if err := setOrderState(ctx, tx, orderID, OrderEntitled, OrderRefunded, nil, nil, idemKey); err != nil {
			return err
		}
		reversed, err := revokeEntitlement(ctx, tx, ord.UserID, ord.Kind, ord.RefID)
		if err != nil {
			return err
		}
		// Compensating record (immutable audit) — the reversal is the source of truth.
		if err := writeAudit(ctx, tx, adminID, "order.refunded", "academy_order", orderID, OrderEntitled, OrderRefunded, idemKey,
			map[string]any{"reversedEntitlement": reversed, "amountMinor": ord.AmountMinor, "userId": ord.UserID}); err != nil {
			return err
		}
		return saveIdem(ctx, tx, idemKey, scopeRefund, adminID, rh, orderID, map[string]any{"orderId": orderID, "state": OrderRefunded})
	})
	if err != nil {
		return nil, err
	}
	return s.repo.GetOrderAny(ctx, orderID)
}

// ── Subscribe (plan via pay-now path → academy_subscriptions) ───────────────────

// SubscribeResult bundles the order + subscription created via the pay-now path.
type SubscribeResult struct {
	Order        *Order        `json:"order"`
	Subscription *Subscription `json:"subscription"`
}

// Subscribe purchases a plan via the PayNow path (charge → entitle) and records a
// row in academy_subscriptions. Idempotent on idemKey end-to-end.
func (s *Service) Subscribe(ctx context.Context, userID, planID, idemKey string) (*SubscribeResult, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	rh := requestHash(scopeSubscribe, userID, planID)

	// Replay BEFORE creating any order: a recorded subscribe key returns the original
	// order + subscription with NO new order, NO second charge, NO duplicate sub.
	if prior, ferr := s.repo.FindIdem(ctx, idemKey, scopeSubscribe); ferr == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		return s.subscribeReplay(ctx, userID, prior)
	} else if !errors.Is(ferr, ErrNotFound) {
		return nil, ferr
	}

	p, err := s.repo.GetPlan(ctx, planID)
	if err != nil {
		return nil, err
	}
	if p.Status != "active" {
		return nil, ErrCatalogItemInactive
	}
	// Create + pay the order via the PayNow path (charge → entitle). PayNow uses its OWN
	// scope keyed to this order so the charge stays single within this first execution.
	ord, err := s.CreateOrder(ctx, userID, CreateOrderRequest{Kind: "plan", RefID: planID})
	if err != nil {
		return nil, err
	}
	paid, err := s.PayNow(ctx, userID, ord.ID, idemKey+":pay")
	if err != nil {
		return nil, err
	}

	var sub *Subscription
	err = s.repo.withTx(ctx, func(tx pgx.Tx) error {
		var serr error
		sub, serr = insertSubscription(ctx, tx, userID, planID, idemKey)
		if serr != nil {
			return serr
		}
		if err := writeAudit(ctx, tx, userID, "subscription.created", "academy_subscription", sub.ID, "", "active", idemKey, map[string]any{"planId": planID, "orderId": paid.ID}); err != nil {
			return err
		}
		return saveIdem(ctx, tx, idemKey, scopeSubscribe, userID, rh, sub.ID,
			map[string]any{"subscriptionId": sub.ID, "orderId": paid.ID})
	})
	if err != nil {
		return nil, err
	}
	return &SubscribeResult{Order: paid, Subscription: sub}, nil
}

// subscribeReplay rebuilds the SubscribeResult from a recorded subscribe idem record.
func (s *Service) subscribeReplay(ctx context.Context, userID string, prior *idemRecord) (*SubscribeResult, error) {
	var r struct {
		SubscriptionID string `json:"subscriptionId"`
		OrderID        string `json:"orderId"`
	}
	_ = json.Unmarshal(prior.Result, &r)
	res := &SubscribeResult{Subscription: &Subscription{ID: r.SubscriptionID, UserID: userID, State: "active"}}
	if r.OrderID != "" {
		if ord, err := s.repo.GetOrder(ctx, userID, r.OrderID); err == nil {
			res.Order = ord
		}
	}
	return res, nil
}

// ── Access cards ────────────────────────────────────────────────────────────────

// GenerateBatch (admin) mints `Count` access cards in `issued`. Each card stores a
// SALTED PIN HASH (plaintext PIN returned ONCE per card for printing, never stored).
func (s *Service) GenerateBatch(ctx context.Context, adminID string, req GenerateCardsRequest) ([]GeneratedCard, error) {
	if req.Count <= 0 || req.Count > 5000 {
		return nil, ErrInvalidAmount
	}
	if req.GrantKind != "plan" && req.GrantKind != "bundle" {
		return nil, ErrInvalidAmount
	}
	out := make([]GeneratedCard, 0, req.Count)
	for i := 0; i < req.Count; i++ {
		pin, err := randomPIN(req.PinDigits)
		if err != nil {
			return nil, err
		}
		serial, err := randomSerial(req.Batch + "-")
		if err != nil {
			return nil, err
		}
		pinHash, err := hashPIN(pin)
		if err != nil {
			return nil, err
		}
		id, err := s.repo.InsertCard(ctx, req.Batch, serial, pinHash, req.GrantKind, req.GrantRefID)
		if err != nil {
			return nil, err
		}
		out = append(out, GeneratedCard{ID: id, Serial: serial, PIN: pin})
	}
	_ = s.audit(ctx, s.repo.db, adminID, "access_card.generated", "academy_access_card", "", "", CardIssued, "",
		map[string]any{"batch": req.Batch, "count": req.Count, "grantKind": req.GrantKind, "grantRefId": req.GrantRefID})
	return out, nil
}

// AllocateToAgent (admin) assigns issued cards (whole batch or specific serials) to
// an agent: issued → allocated.
func (s *Service) AllocateToAgent(ctx context.Context, adminID string, req AllocateCardsRequest) (int64, error) {
	if req.Batch == "" && len(req.Serials) == 0 {
		return 0, ErrInvalidAmount
	}
	n, err := s.repo.AllocateCards(ctx, req.AgentID, req.Batch, req.Serials)
	if err != nil {
		return 0, err
	}
	_ = s.audit(ctx, s.repo.db, adminID, "access_card.allocated", "academy_access_card", "", CardIssued, CardAllocated, "",
		map[string]any{"agentId": req.AgentID, "batch": req.Batch, "serials": req.Serials, "count": n})
	return n, nil
}

// ListAccessCards (admin) returns access-card rows for the console, optionally
// filtered by batch, newest first. Read-only.
func (s *Service) ListAccessCards(ctx context.Context, batch string, limit int) ([]AccessCard, error) {
	return s.repo.ListAccessCards(ctx, batch, limit)
}

// PaymentsOverview (admin) aggregates orders by state/amount for the payments console.
func (s *Service) PaymentsOverview(ctx context.Context) (*OrdersOverview, error) {
	return s.repo.OrdersOverview(ctx)
}

// Activate redeems an access card (member). Guarded issued|allocated → activated,
// PIN verified against the stored salted hash (constant-time). On success it grants
// the LOCAL entitlement (source=access_card). Idempotent: a replay of the same
// (serial, pin, idemKey) returns success with no second grant; a wrong PIN is rejected.
func (s *Service) Activate(ctx context.Context, userID, serial, pin, idemKey string) (*Entitlement, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if userID == "" || serial == "" || pin == "" {
		return nil, ErrAccessCardInvalid
	}
	rh := requestHash(scopeActivate, userID, serial)

	if prior, err := s.repo.FindIdem(ctx, idemKey, scopeActivate); err == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		// Replay: re-derive the entitlement from the recorded grant target.
		return s.replayActivation(ctx, prior, userID)
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	var ent *Entitlement
	err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		id, state, pinHash, grantKind, grantRef, activatedBy, cerr := cardForActivation(ctx, tx, serial)
		if cerr != nil {
			return cerr
		}
		// Already activated: idempotent only if the SAME user redeemed it (replay-by-state).
		if state == CardActivated {
			if activatedBy != nil && *activatedBy == userID {
				e, _, gerr := grantEntitlement(ctx, tx, userID, grantKind, grantRef, "access_card")
				if gerr != nil {
					return gerr
				}
				ent = e
				return saveIdem(ctx, tx, idemKey, scopeActivate, userID, rh, e.ID, activationResult(grantKind, grantRef))
			}
			return ErrAccessCardConsumed
		}
		if state == CardVoid || !canCard(state, CardActivated) {
			_ = writeAudit(ctx, tx, userID, "access_card.activation_rejected", "academy_access_card", id, state, CardActivated, idemKey, map[string]any{"reason": "illegal_state"})
			return ErrIllegalTransition
		}
		// Verify PIN (constant-time) BEFORE consuming the card.
		if !verifyPIN(pinHash, pin) {
			_ = writeAudit(ctx, tx, userID, "access_card.activation_rejected", "academy_access_card", id, state, state, idemKey, map[string]any{"reason": "bad_pin"})
			return ErrAccessCardInvalid
		}
		if err := markCardActivated(ctx, tx, id, userID); err != nil {
			return err
		}
		e, _, gerr := grantEntitlement(ctx, tx, userID, grantKind, grantRef, "access_card")
		if gerr != nil {
			return gerr
		}
		ent = e
		if err := writeAudit(ctx, tx, userID, "access_card.activated", "academy_access_card", id, state, CardActivated, idemKey,
			map[string]any{"grantKind": grantKind, "grantRefId": grantRef}); err != nil {
			return err
		}
		return saveIdem(ctx, tx, idemKey, scopeActivate, userID, rh, e.ID, activationResult(grantKind, grantRef))
	})
	if err != nil {
		return nil, err
	}
	return ent, nil
}

func activationResult(grantKind, grantRef string) map[string]any {
	return map[string]any{"grantKind": grantKind, "grantRefId": grantRef}
}

// replayActivation reconstructs the entitlement for a recorded activation idem record.
func (s *Service) replayActivation(ctx context.Context, prior *idemRecord, userID string) (*Entitlement, error) {
	var r struct {
		GrantKind  string `json:"grantKind"`
		GrantRefID string `json:"grantRefId"`
	}
	_ = json.Unmarshal(prior.Result, &r)
	if r.GrantKind == "" {
		return nil, ErrAccessCardConsumed
	}
	ok, err := s.repo.HasActiveEntitlement(ctx, userID, r.GrantKind, r.GrantRefID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrAccessCardConsumed
	}
	return &Entitlement{ID: prior.ResultRef, UserID: userID, Kind: r.GrantKind, RefID: &r.GrantRefID,
		State: "active", Source: "access_card", GrantedAt: time.Now()}, nil
}

// ── Gating ──────────────────────────────────────────────────────────────────────

// HasAccess is the exported entitlement-gating check used by exam/content modules.
// kind ∈ {plan, bundle, arena}; refID is the catalog/arena id. Returns true iff an
// active entitlement exists for (userID, kind, refID).
func (s *Service) HasAccess(ctx context.Context, userID, kind, refID string) (bool, error) {
	if userID == "" || kind == "" || refID == "" {
		return false, nil
	}
	return s.repo.HasActiveEntitlement(ctx, userID, kind, refID)
}

// ── Offline sync (deterministic + idempotent) ───────────────────────────────────

// Sync reconciles a batch of queued offline client events. It is DETERMINISTIC and
// REPLAY-SAFE: each event is upserted on (user_id, client_event_id); a replayed batch
// produces no new effect. The server is AUTHORITATIVE — money/scoring/timing are NOT
// trusted from the client; events only persist queued markers (progress, queued
// attempts, reward-eligibility) for server-side reconciliation downstream.
func (s *Service) Sync(ctx context.Context, userID string, env SyncRequest) (*SyncResult, error) {
	if userID == "" {
		return nil, ErrNotFound
	}
	res := &SyncResult{Reconciled: make([]SyncResolution, 0, len(env.Events))}
	err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		for _, ev := range env.Events {
			if ev.ClientEventID == "" {
				res.Reconciled = append(res.Reconciled, SyncResolution{
					Kind: ev.Kind, Resolution: "rejected", ServerTS: time.Now(), Note: "missing_client_event_id"})
				continue
			}
			resolution := classifySync(ev.Kind)
			inserted, uerr := upsertSyncEvent(ctx, tx, userID, ev, resolution)
			if uerr != nil {
				return uerr
			}
			note := ""
			if !inserted {
				// Deterministic replay: already recorded ⇒ no new effect, still "accepted".
				note = "replay_no_effect"
			}
			res.Reconciled = append(res.Reconciled, SyncResolution{
				ClientEventID: ev.ClientEventID, Kind: ev.Kind, Resolution: resolution,
				ServerTS: time.Now(), Note: note,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return res, nil
}

// classifySync is PURE: it maps an event kind to its server-authoritative resolution.
// Unknown kinds are rejected; known kinds are accepted (server reconciles downstream).
func classifySync(kind string) string {
	switch kind {
	case "progress", "attempt_queued", "reward_eligible":
		return "accepted"
	default:
		return "rejected"
	}
}

// ── internal helpers ────────────────────────────────────────────────────────────

// setOrderState performs a GUARDED order transition inside a tx. It re-checks the
// current state under FOR UPDATE so concurrent callers cannot double-transition, and
// rejects illegal transitions with ErrIllegalTransition.
func setOrderState(ctx context.Context, tx pgx.Tx, orderID, from, to string, paymentRef, bnplRef *string, idemKey string) error {
	if !canOrder(from, to) {
		return ErrIllegalTransition
	}
	const sel = `SELECT state FROM academy_orders WHERE id = $1 FOR UPDATE`
	var cur string
	if err := tx.QueryRow(ctx, sel, orderID).Scan(&cur); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if cur != from {
		return ErrIllegalTransition
	}
	const upd = `UPDATE academy_orders
	             SET state = $2,
	                 payment_ref = COALESCE($3, payment_ref),
	                 bnpl_ref = COALESCE($4, bnpl_ref),
	                 idempotency_key = COALESCE(idempotency_key, $5)
	             WHERE id = $1 AND state = $6`
	tag, err := tx.Exec(ctx, upd, orderID, to, paymentRef, bnplRef, nullStr(idemKey), from)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrIllegalTransition
	}
	return nil
}

// audit writes a non-transactional audit row (best-effort, for pre-tx rejections).
func (s *Service) audit(ctx context.Context, q querier, actorID, action, entityType, entityID, from, to, idemKey string, detail any) error {
	return writeAudit(ctx, q, actorID, action, entityType, entityID, from, to, idemKey, detail)
}

// emptyDetail returns an empty detail object for rejection audits.
func emptyDetail() map[string]any { return map[string]any{} }
