package connectdiscovery

import (
	"context"
	"errors"
	"time"
)

// ── Money-path seams (REUSED from internal/finance, never re-implemented here) ──

// WalletDebiter debits the caller's wallet and credits a standing account — a
// balanced double-entry, tier-checked fail-closed, keyed by idempotencyKey. This
// is the SAME interface paid voting uses (connectvoting.WalletDebiter); the route
// wiring binds it to internal/finance/wallet.Service.Debit. We never touch the
// ledger SQL here.
type WalletDebiter interface {
	Debit(ctx context.Context, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error
}

// RevenueAccountResolver returns the standing paymax_revenue account id that boost
// revenue credits. Implemented by the ledger service (GetOrCreateStandingAccount).
type RevenueAccountResolver interface {
	RevenueAccountID(ctx context.Context) (string, error)
}

// BoostAuditor writes an immutable audit entry (connect_audit_log). Every boost
// purchase emits one. Implemented by an adapter over connect/safety.Service.
type BoostAuditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

// BoostFlagger reports boost purchases to AML monitoring (best-effort; a flag
// error never blocks a charged boost). Optional (may be nil).
type BoostFlagger interface {
	FlagBoost(ctx context.Context, userID string, amountKobo int64, ref string) error
}

// ── Model ──────────────────────────────────────────────────────────────────────

// Boost statuses — MUST match the connect_boosts.status CHECK constraint.
const (
	BoostActive   = "active"
	BoostExpired  = "expired"
	BoostRefunded = "refunded"
)

// Boost is the member-facing (camelCase) view of a connect_boosts row.
type Boost struct {
	ID              string    `json:"id"`
	UserID          string    `json:"userId"`
	Status          string    `json:"status"`
	PriceKobo       int64     `json:"priceKobo"`
	DurationMinutes int       `json:"durationMinutes"`
	StartedAt       time.Time `json:"startedAt"`
	ExpiresAt       time.Time `json:"expiresAt"`
	LedgerRef       string    `json:"ledgerRef,omitempty"`
	CreatedAt       time.Time `json:"createdAt"`
	// IdempotencyKey is the charge dedup key, persisted UNIQUE. Never serialised to
	// the client (json:"-").
	IdempotencyKey string `json:"-"`
}

// BoostInfo is the GET /discovery/boosts response: any active boost plus the
// backend-owned price and default duration so the client never guesses a price.
type BoostInfo struct {
	ActiveBoost     *Boost `json:"activeBoost,omitempty"`
	PriceKobo       int64  `json:"priceKobo"`
	DurationMinutes int    `json:"durationMinutes"`
}

// Sentinel errors for the boost money path.
var (
	ErrBoostMissingIdem   = errors.New("connect: Idempotency-Key required")
	ErrBoostInvalidAmount = errors.New("connect: boost price must be positive kobo")
	ErrBoostActive        = errors.New("connect: an active boost already exists")
)

// BoostStore is the persistence seam for connect_boosts (injected so the money
// path can be unit-tested without a live DB). Implemented by boostRepo.
type BoostStore interface {
	// ActiveBoost returns the caller's current active, unexpired boost, or nil.
	ActiveBoost(ctx context.Context, userID string, now time.Time) (*Boost, error)
	// Insert records the boost row AFTER a successful, idempotent charge. The
	// idempotency_key is UNIQUE so a replayed charge maps to the same row.
	Insert(ctx context.Context, b *Boost) (*Boost, error)
}

// ── Service ────────────────────────────────────────────────────────────────────

// BoostService orchestrates paid discovery boosts. It owns NO balance state —
// money movement is delegated to the wallet (ledger) via WalletDebiter; the
// connect_boosts row is a projection recorded after a successful idempotent debit.
//
// The price and default duration are backend-owned (connect_config), NEVER taken
// from the client — the client may only request a duration variant, and even that
// is validated against config.
type BoostService struct {
	store    BoostStore
	wallet   WalletDebiter
	revenue  RevenueAccountResolver
	tiers    TierGuard
	audit    BoostAuditor
	flagger  BoostFlagger
	cfg      *configReader
}

// TierGuard enforces the caller's KYC tier daily-debit limit, fail-closed, BEFORE
// any money moves. Same contract as connectgifting.TierGuard; bound to
// internal/finance/tiers.Service.EnforceWalletDebitLimit in the route wiring.
type TierGuard interface {
	EnforceWalletDebitLimit(ctx context.Context, userID string, amountKobo int64) error
}

// NewBoostService builds the boost service. flagger may be nil.
func NewBoostService(store BoostStore, wallet WalletDebiter, revenue RevenueAccountResolver, tiers TierGuard, audit BoostAuditor, flagger BoostFlagger, cfg *configReader) *BoostService {
	return &BoostService{store: store, wallet: wallet, revenue: revenue, tiers: tiers, audit: audit, flagger: flagger, cfg: cfg}
}

// Info returns the current active boost (if any) plus backend-owned price/duration.
func (s *BoostService) Info(ctx context.Context, userID string) (*BoostInfo, error) {
	now := time.Now().UTC()
	active, err := s.store.ActiveBoost(ctx, userID, now)
	if err != nil {
		return nil, err
	}
	return &BoostInfo{
		ActiveBoost:     active,
		PriceKobo:       s.priceKobo(ctx),
		DurationMinutes: s.durationMinutes(ctx, 0),
	}, nil
}

// priceKobo reads the backend-owned boost price (kobo). Conservative default keeps
// the money path fail-closed on a missing key (a positive, non-trivial price).
func (s *BoostService) priceKobo(ctx context.Context) int64 {
	return int64(s.cfg.intVal(ctx, "discovery.boost_price_kobo", 50000)) // ₦500 default
}

// durationMinutes resolves the boost duration: a requested variant is only honoured
// when it matches the configured default (no arbitrary client-chosen windows).
func (s *BoostService) durationMinutes(ctx context.Context, requested int) int {
	def := s.cfg.intVal(ctx, "discovery.boost_duration_minutes", 30)
	if requested > 0 && requested == def {
		return requested
	}
	return def
}

// Purchase is the boost money path.
//
// Ordering (correctness > convenience):
//  1. require an Idempotency-Key;
//  2. resolve price + duration SERVER-SIDE (connect_config), never from the client;
//  3. enforce the caller's tier daily-debit limit, fail-closed, BEFORE money moves;
//  4. debit wallet → paymax_revenue (balanced double-entry, idempotent — a retry is
//     a safe no-op via the ledger unique idempotency_key);
//  5. record the immutable connect_boosts row (idempotency_key UNIQUE);
//  6. emit an audit event + fire the AML hook.
func (s *BoostService) Purchase(ctx context.Context, userID, idemKey string, requestedDuration int) (*Boost, error) {
	if idemKey == "" {
		return nil, ErrBoostMissingIdem
	}
	priceKobo := s.priceKobo(ctx)
	if priceKobo <= 0 {
		return nil, ErrBoostInvalidAmount
	}
	duration := s.durationMinutes(ctx, requestedDuration)

	// Tier limit, fail-closed, BEFORE any money moves.
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, priceKobo); err != nil {
		return nil, err
	}

	revAcc, err := s.revenue.RevenueAccountID(ctx)
	if err != nil {
		return nil, err
	}

	ref := "connect:boost:" + userID
	// Money mutation — tier-checked, balanced double-entry, idempotent. The
	// Idempotency-Key dedups the CHARGE: a replayed key never double-debits.
	if err := s.wallet.Debit(ctx, userID, ref, idemKey, revAcc, priceKobo); err != nil {
		return nil, err // ErrInsufficientFunds / ErrDuplicate / tier-limit bubble up
	}

	now := time.Now().UTC()
	b, err := s.store.Insert(ctx, &Boost{
		UserID:          userID,
		Status:          BoostActive,
		PriceKobo:       priceKobo,
		DurationMinutes: duration,
		StartedAt:       now,
		ExpiresAt:       now.Add(time.Duration(duration) * time.Minute),
		LedgerRef:       ref,
		IdempotencyKey:  idemKey,
	})
	if err != nil {
		// Debit succeeded but projection failed: surface loudly so reconciliation
		// can detect a posted ledger entry with no boost row.
		return nil, err
	}

	// Immutable audit event (ids + amount + ref only — never raw PII).
	_ = s.audit.WriteAudit(ctx, "connect.discovery.boost", userID, "connect_boost", b.ID, map[string]any{
		"price_kobo": priceKobo, "duration_minutes": duration,
		"idempotency_key": idemKey, "ledger_ref": ref,
	})
	if s.flagger != nil {
		_ = s.flagger.FlagBoost(ctx, userID, priceKobo, ref)
	}
	return b, nil
}
