package connectdiscovery

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

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

// DebitConfirmer proves — from the ledger of record, never Redis — that the
// balanced journal under a namespaced idempotency key carries the exact identity
// this path intended (DR caller wallet → CR paymax_revenue, this ref + amount).
// A duplicate-key rejection is NOT proof the caller's journal landed: a stale
// Redis lock or a foreign claim under the same key both produce ErrDuplicate.
type DebitConfirmer interface {
	ConfirmDebit(ctx context.Context, userID, reference, idempotencyKey string, amountKobo int64) (bool, error)
}

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

// BoostService orchestrates paid discovery boosts. It owns NO balance state —
// money movement is delegated to the wallet (ledger) via WalletDebiter; the
// connect_boosts row is a projection recorded after a successful idempotent debit.
// The price and default duration are backend-owned (connect_config), NEVER taken
// from the client — the client may only request a duration variant, and even that
// is validated against config.
type BoostService struct {
	store     BoostStore
	wallet    WalletDebiter
	revenue   RevenueAccountResolver
	tiers     TierGuard
	audit     BoostAuditor
	flagger   BoostFlagger
	cfg       *configReader
	confirmer DebitConfirmer // optional; set via SetDebitConfirmer
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

// SetDebitConfirmer wires the durable-ledger replay confirmer used when a debit
// attempt reports a DUPLICATE. Nil ⇒ unconfirmed duplicates are never treated
// as success (the caller retries instead of fulfilling on phantom money).
func (s *BoostService) SetDebitConfirmer(c DebitConfirmer) { s.confirmer = c }

// boostLedgerKey namespaces the client-supplied key per (rail, purpose, caller)
// before it enters the GLOBAL ledger keyspace: a raw key is unique per journal,
// so the same key arriving from another rail or user would cross-claim.
func boostLedgerKey(userID, idemKey string) string {
	return "connect:discovery:boost:" + userID + ":" + idemKey
}

// isDuplicateErr matches the ledger's duplicate-idempotency-key sentinel by
// substring so this package need not import the ledger (mirrors the
// monetization package's approach).
func isDuplicateErr(err error) bool {
	return err != nil && strings.Contains(err.Error(), "duplicate idempotency key")
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
	ledgerKey := boostLedgerKey(userID, idemKey)
	// Deploy-mid-flight convergence: a purchase that committed under the
	// pre-namespace code posted its journal under the RAW client key. If that
	// exact journal is durably posted, the charge already happened — record the
	// boost under the same key instead of debiting again.
	chargeKey := ledgerKey
	if s.confirmer != nil {
		ok, cerr := s.confirmer.ConfirmDebit(ctx, userID, ref, idemKey, priceKobo)
		if cerr != nil {
			return nil, fmt.Errorf("connect: confirm legacy boost debit: %w", cerr)
		}
		if ok {
			chargeKey = idemKey
		}
	}
	if chargeKey == ledgerKey {
		// Money mutation — tier-checked, balanced double-entry, idempotent. The
		// namespaced key dedups the CHARGE: a replayed key never double-debits.
		if derr := s.wallet.Debit(ctx, userID, ref, ledgerKey, revAcc, priceKobo); derr != nil {
			if !isDuplicateErr(derr) {
				return nil, derr // ErrInsufficientFunds / tier-limit bubble up
			}
			// Claimed key — not proof of our journal. Charge confirmed only when
			// the ledger of record carries this exact journal.
			if s.confirmer == nil {
				return nil, derr
			}
			ok, cerr := s.confirmer.ConfirmDebit(ctx, userID, ref, ledgerKey, priceKobo)
			if cerr != nil {
				return nil, fmt.Errorf("connect: confirm boost debit: %w", cerr)
			}
			if !ok {
				return nil, derr
			}
		}
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
		IdempotencyKey:  chargeKey,
	})
	if err != nil {
		// Debit succeeded but projection failed: surface loudly so reconciliation
		// can detect a posted ledger entry with no boost row.
		return nil, err
	}
	// The INSERT returns the PRE-EXISTING row on an idempotency_key conflict —
	// converge on it only when it is THIS purchase (the ledger charge was
	// confirmed for priceKobo above; a row that disagrees is a foreign or stale
	// claim and must fail closed, never be adopted as our boost).
	if b.UserID != userID || b.PriceKobo != priceKobo || b.DurationMinutes != duration || b.LedgerRef != ref {
		return nil, errors.New("connect: duplicate boost idempotency key held by a different purchase")
	}

	// Immutable audit event (ids + amount + ref only — never raw PII).
	_ = s.audit.WriteAudit(ctx, "connect.discovery.boost", userID, "connect_boost", b.ID, map[string]any{
		"price_kobo": priceKobo, "duration_minutes": duration,
		"idempotency_key": chargeKey, "ledger_ref": ref,
	})
	if s.flagger != nil {
		_ = s.flagger.FlagBoost(ctx, userID, priceKobo, ref)
	}
	return b, nil
}

// boostRepo persists connect_boosts over a pgx pool. The boost insert is
// append-only and idempotent on the UNIQUE idempotency_key: a replayed charge maps
// to the pre-existing row rather than creating a duplicate. It NEVER touches a
// balance column — money lives in the ledger.
type boostRepo struct {
	db *pgxpool.Pool
}

// NewBoostRepo builds a connect_boosts repository.
func NewBoostRepo(db *pgxpool.Pool) *boostRepo { return &boostRepo{db: db} }

const boostColumns = `id, user_id, status, price_kobo, duration_minutes,
	started_at, expires_at, ledger_ref, created_at`

// ActiveBoost returns the caller's current active, unexpired boost, or (nil,nil).
func (r *boostRepo) ActiveBoost(ctx context.Context, userID string, now time.Time) (*Boost, error) {
	const q = `SELECT ` + boostColumns + `
		FROM connect_boosts
		WHERE user_id = $1 AND status = 'active' AND expires_at > $2
		ORDER BY started_at DESC
		LIMIT 1`
	b, err := scanBoost(r.db.QueryRow(ctx, q, userID, now))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("connect: active boost: %w", err)
	}
	return b, nil
}

// Insert records the boost row after a successful ledger debit. ON CONFLICT on the
// UNIQUE idempotency_key returns the existing row, so a replayed purchase is a safe
// no-op that yields the SAME boost (one charge → one boost).
func (r *boostRepo) Insert(ctx context.Context, in *Boost) (*Boost, error) {
	const ins = `INSERT INTO connect_boosts
		(user_id, status, price_kobo, duration_minutes, started_at, expires_at, idempotency_key, ledger_ref)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (idempotency_key) DO UPDATE SET user_id = connect_boosts.user_id
		RETURNING ` + boostColumns
	// The DO UPDATE is a no-op that lets RETURNING yield the row whether it was just
	// inserted or already existed (idempotent replay).
	b, err := scanBoost(r.db.QueryRow(ctx, ins,
		in.UserID, in.Status, in.PriceKobo, in.DurationMinutes,
		in.StartedAt, in.ExpiresAt, in.IdempotencyKey, in.LedgerRef))
	if err != nil {
		return nil, fmt.Errorf("connect: insert boost: %w", err)
	}
	return b, nil
}

// scanBoost reads a connect_boosts row in boostColumns order.
func scanBoost(row pgx.Row) (*Boost, error) {
	b := &Boost{}
	if err := row.Scan(
		&b.ID, &b.UserID, &b.Status, &b.PriceKobo, &b.DurationMinutes,
		&b.StartedAt, &b.ExpiresAt, &b.LedgerRef, &b.CreatedAt,
	); err != nil {
		return nil, err
	}
	return b, nil
}
