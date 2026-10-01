// Package spray is the shared "spray money" engine: an instant wallet→wallet
// transfer with a returnable animation descriptor and a per-context leaderboard.
// It is reused by social (lives feed) and creators (live/event spray). All money
// REUSES the finance ledger (NL-8) via wallet.Debit/ledger.Credit, is idempotent
// (NL-9), tier-limited fail-closed, and runs under AML velocity limits (NL-10).
// Paymax never advances principal (NL-1) and never pays yield (NL-2): a spray is a
// pure peer-to-peer move, never a loan.

package spray

import (
	"context"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"time"
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

// Handler exposes spray member endpoints (send + leaderboard). The sender is always
// the authenticated caller (user_id from context) — a client can never spray FROM
// another user.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// GuardFunc returns a permission-checking middleware.
type GuardFunc func(permission string) gin.HandlerFunc

// Register mounts member + admin routes.
//
//	member: /api/finance/spray/*
//	admin : /api/p2p/admin/*  (RBAC spray.*) — mounted onto the p2p-market
//	        admin group by the caller (see RegisterP2PMarket), not a route
//	        this package registers on its own.
func (h *Handler) Register(member, admin *gin.RouterGroup, guard GuardFunc) {
	member.POST("/spray", h.Spray)
	member.GET("/spray/leaderboard/:contextRef", h.Leaderboard)

	// Admin: AML oversight reads the same leaderboard projection plus raw transfers.
	admin.GET("/spray/leaderboard/:contextRef", guard("spray.read"), h.Leaderboard)
}

type sprayRequest struct {
	ToUserID   string `json:"to_user_id" binding:"required"`
	ContextRef string `json:"context_ref" binding:"required"`
	AmountKobo int64  `json:"amount_kobo" binding:"required"`
}

func (h *Handler) Spray(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	idem := ginutil.IdempotencyKey(c)
	if idem == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var req sprayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	sp, err := h.svc.Spray(c.Request.Context(), userID, req.ToUserID, req.ContextRef, idem, req.AmountKobo)
	if err != nil {
		status := http.StatusBadRequest
		switch {
		case errors.Is(err, ErrAMLSingleLimit), errors.Is(err, ErrAMLDailyLimit), errors.Is(err, ErrAMLDailyCount):
			status = http.StatusForbidden
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "spray": sp})
}

func (h *Handler) Leaderboard(c *gin.Context) {
	rows, err := h.svc.Leaderboard(c.Request.Context(), c.Param("contextRef"), 20)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "leaderboard": rows})
}

// Animation is the returnable descriptor a client renders for a spray. It carries
// NO money authority — it is a pure presentation contract derived from the amount
// so the same engine drives social lives + creator lives consistently.
type Animation struct {
	Style      string `json:"style"`       // notes | confetti | rain | fireworks
	Intensity  int    `json:"intensity"`   // 1..5 scaled by amount tier
	DurationMs int    `json:"duration_ms"` // animation length
	Emoji      string `json:"emoji"`       // headline glyph
	Label      string `json:"label"`       // human label ("Big Baller")
}

// Spray is one completed spray transfer. The money already moved through the
// ledger when this row is written; the row is the idempotent audit projection.
type Spray struct {
	ID             string    `json:"id"`
	FromUserID     string    `json:"from_user_id"` // FK auth.users(id)
	ToUserID       string    `json:"to_user_id"`   // FK auth.users(id)
	ContextRef     string    `json:"context_ref"`  // live id / event id / creator id
	AmountKobo     int64     `json:"amount_kobo"`
	IdempotencyKey string    `json:"idempotency_key"`
	Animation      Animation `json:"animation"`
	CreatedAt      time.Time `json:"created_at"`
}

// LeaderboardRow is one ranked sprayer within a context.
type LeaderboardRow struct {
	Rank       int    `json:"rank"`
	UserID     string `json:"user_id"`
	TotalKobo  int64  `json:"total_kobo"`
	SprayCount int64  `json:"spray_count"`
}

// describeAnimation maps an amount to a presentation tier. Pure + deterministic so
// it can be unit-tested and rendered identically on every surface.
func describeAnimation(amountKobo int64) Animation {
	switch {
	case amountKobo >= 5_000_00:
		return Animation{Style: "fireworks", Intensity: 5, DurationMs: 4000, Emoji: "\U0001F386", Label: "Big Baller"}
	case amountKobo >= 1_000_00:
		return Animation{Style: "rain", Intensity: 4, DurationMs: 3000, Emoji: "\U0001F4B8", Label: "Money Rain"}
	case amountKobo >= 200_00:
		return Animation{Style: "confetti", Intensity: 3, DurationMs: 2200, Emoji: "\U0001F389", Label: "Generous"}
	case amountKobo >= 50_00:
		return Animation{Style: "notes", Intensity: 2, DurationMs: 1600, Emoji: "\U0001F4B5", Label: "Spray"}
	default:
		return Animation{Style: "notes", Intensity: 1, DurationMs: 1200, Emoji: "\U0001F4B5", Label: "Tip"}
	}
}
