package spray

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
)

// Auditor mirrors services.AuditService (NL-12); nil is safe.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// AMLConfig bounds spray velocity (NL-10). Defaults are conservative; admins can
// widen via config. Zero values fall back to the defaults below.
type AMLConfig struct {
	MaxSingleKobo int64 // reject a single spray above this
	MaxDailyKobo  int64 // reject when the sender's rolling-24h spray total would exceed this
	MaxDailyCount int64 // reject when the sender's rolling-24h spray count would exceed this
	MinSingleKobo int64 // reject dust sprays (anti-structuring noise)
}

func (c AMLConfig) withDefaults() AMLConfig {
	if c.MaxSingleKobo <= 0 {
		c.MaxSingleKobo = 500_000_00 // ₦500,000
	}
	if c.MaxDailyKobo <= 0 {
		c.MaxDailyKobo = 2_000_000_00 // ₦2,000,000 / 24h
	}
	if c.MaxDailyCount <= 0 {
		c.MaxDailyCount = 500
	}
	if c.MinSingleKobo <= 0 {
		c.MinSingleKobo = 1_00 // ₦1
	}
	return c
}

// Service is the shared spray engine. A spray is wallet.Debit(from) → ledger.Credit(to)
// gated by tier limits (inside wallet.Debit) AND AML velocity limits (here). Both the
// money leg and the spray row are idempotent on the same key (NL-9).
type Service struct {
	db     *pgxpool.Pool
	led    *ledger.Service
	wallet *wallet.Service
	aml    AMLConfig
	audit  Auditor
}

func NewService(db *pgxpool.Pool, led *ledger.Service, w *wallet.Service, aml AMLConfig, audit Auditor) *Service {
	return &Service{db: db, led: led, wallet: w, aml: aml.withDefaults(), audit: audit}
}

// Spray moves amountKobo from→to and records a spray under contextRef. It is
// idempotent on idemKey: a replay returns the existing spray without re-debiting.
// Fail-closed on AML velocity (NL-10), self-spray, and (via wallet.Debit) tier
// limits + insufficient funds (NL-1: no negative balance, no advance).
func (s *Service) Spray(ctx context.Context, fromUserID, toUserID, contextRef, idemKey string, amountKobo int64) (*Spray, error) {
	if fromUserID == "" || toUserID == "" || idemKey == "" {
		return nil, fmt.Errorf("spray: from, to and idempotency key required")
	}
	if fromUserID == toUserID {
		return nil, fmt.Errorf("spray: cannot spray yourself")
	}
	if amountKobo < s.aml.MinSingleKobo {
		return nil, fmt.Errorf("spray: amount below minimum")
	}
	if amountKobo > s.aml.MaxSingleKobo {
		return nil, ErrAMLSingleLimit
	}

	// Replay: if a spray already exists for this key, return it (no double-debit).
	if existing, err := s.getByIdem(ctx, idemKey); err == nil && existing != nil {
		return existing, nil
	}

	// AML velocity (NL-10): rolling-24h amount + count caps for the sender. Checked
	// before any money moves so the engine fails closed under structuring pressure.
	if err := s.checkVelocity(ctx, fromUserID, amountKobo); err != nil {
		return nil, err
	}

	// Money leg. wallet.Debit enforces tier limits + fails closed on low balance.
	// The receiver is credited from the spray-clearing standing account so both legs
	// post to the shared ledger (NL-8) and balance.
	clearing, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, err
	}
	if err := s.wallet.Debit(ctx, fromUserID, "spray:"+contextRef, idemKey+":debit", clearing.ID, amountKobo); err != nil {
		return nil, fmt.Errorf("spray: debit: %w", err)
	}
	if err := s.led.Credit(ctx, toUserID, "spray:"+contextRef, idemKey+":credit", clearing.ID, amountKobo); err != nil {
		return nil, fmt.Errorf("spray: credit: %w", err)
	}

	sp := &Spray{
		ID:             uuid.New().String(),
		FromUserID:     fromUserID,
		ToUserID:       toUserID,
		ContextRef:     contextRef,
		AmountKobo:     amountKobo,
		IdempotencyKey: idemKey,
		Animation:      describeAnimation(amountKobo),
		CreatedAt:      time.Now(),
	}
	const ins = `
		INSERT INTO spray_transfers (id, from_user_id, to_user_id, context_ref, amount_kobo, idempotency_key, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (idempotency_key) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, sp.ID, sp.FromUserID, sp.ToUserID, sp.ContextRef, sp.AmountKobo, sp.IdempotencyKey, sp.CreatedAt); err != nil {
		return nil, fmt.Errorf("spray: insert: %w", err)
	}
	// Best-effort denormalised leaderboard upsert (the truth is spray_transfers).
	const upsert = `
		INSERT INTO spray_leaderboard (context_ref, user_id, total_kobo, spray_count, updated_at)
		VALUES ($1,$2,$3,1,now())
		ON CONFLICT (context_ref, user_id)
		DO UPDATE SET total_kobo = spray_leaderboard.total_kobo + EXCLUDED.total_kobo,
		              spray_count = spray_leaderboard.spray_count + 1,
		              updated_at = now()`
	_, _ = s.db.Exec(ctx, upsert, contextRef, fromUserID, amountKobo)

	s.log(fromUserID, toUserID, "spray.send", sp.ID, map[string]any{"context": contextRef, "amount_kobo": amountKobo})
	return sp, nil
}

// Leaderboard returns the top sprayers for a context, highest total first.
func (s *Service) Leaderboard(ctx context.Context, contextRef string, limit int) ([]LeaderboardRow, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	const q = `
		SELECT user_id, total_kobo, spray_count
		FROM spray_leaderboard
		WHERE context_ref = $1
		ORDER BY total_kobo DESC, spray_count DESC
		LIMIT $2`
	rows, err := s.db.Query(ctx, q, contextRef, limit)
	if err != nil {
		return nil, fmt.Errorf("spray: leaderboard: %w", err)
	}
	defer rows.Close()
	var out []LeaderboardRow
	rank := 0
	for rows.Next() {
		rank++
		var r LeaderboardRow
		if err := rows.Scan(&r.UserID, &r.TotalKobo, &r.SprayCount); err != nil {
			return nil, err
		}
		r.Rank = rank
		out = append(out, r)
	}
	return out, rows.Err()
}

// --- internals ---

// checkVelocity enforces the rolling-24h amount + count caps for a sender (NL-10).
func (s *Service) checkVelocity(ctx context.Context, fromUserID string, amountKobo int64) error {
	const q = `
		SELECT COALESCE(SUM(amount_kobo),0), COUNT(*)
		FROM spray_transfers
		WHERE from_user_id = $1 AND created_at >= now() - interval '24 hours'`
	var sum, count int64
	if err := s.db.QueryRow(ctx, q, fromUserID).Scan(&sum, &count); err != nil {
		// Fail-closed: if we cannot evaluate AML, do not allow the spray.
		return fmt.Errorf("spray: aml check unavailable: %w", err)
	}
	if count+1 > s.aml.MaxDailyCount {
		return ErrAMLDailyCount
	}
	if sum+amountKobo > s.aml.MaxDailyKobo {
		return ErrAMLDailyLimit
	}
	return nil
}

func (s *Service) getByIdem(ctx context.Context, idemKey string) (*Spray, error) {
	const q = `
		SELECT id, from_user_id, to_user_id, context_ref, amount_kobo, idempotency_key, created_at
		FROM spray_transfers WHERE idempotency_key = $1`
	var sp Spray
	if err := s.db.QueryRow(ctx, q, idemKey).Scan(
		&sp.ID, &sp.FromUserID, &sp.ToUserID, &sp.ContextRef, &sp.AmountKobo, &sp.IdempotencyKey, &sp.CreatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, pgx.ErrNoRows
		}
		return nil, err
	}
	sp.Animation = describeAnimation(sp.AmountKobo)
	return &sp, nil
}

func (s *Service) log(actor, target, action, id string, meta map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, target, action, "spray", "spray_transfer", id, nil, meta, "", "", "info")
}

// Sentinel errors (stable for client UX + AML alerting).
var (
	ErrAMLSingleLimit = fmt.Errorf("spray: amount exceeds single-spray limit")
	ErrAMLDailyLimit  = fmt.Errorf("spray: daily spray amount limit exceeded")
	ErrAMLDailyCount  = fmt.Errorf("spray: daily spray count limit exceeded")
)
