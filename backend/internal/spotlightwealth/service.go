package spotlightwealth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const keyUnauthenticated = "unauthenticated"

const keyError = "error"

// Auditor is the immutable-audit sink (nil-safe), matching the finance modules.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Service owns the Spotlight Wealth reads plus the join/complete challenge
// mutations. Content (videos / challenges / campaigns / leaderboard) is
// server-driven config seeded by migration. The reward wallet is a per-user
// append-only ledger of learning credits (spotlight_reward_ledger): its balance
// is SUM(entries), never a mutated column (NL-8).
// A challenge-completion reward is a real money move: it is REDISTRIBUTED from
// the paymax_revenue standing account into the member's main wallet via the
// finance double-entry ledger under an Idempotency-Key (never minted; NL-1/NL-9)
// AND recorded in the reward wallet sub-ledger for the member's history view.
type Service struct {
	db    *pgxpool.Pool
	led   *ledger.Service
	audit Auditor
}

func NewService(db *pgxpool.Pool, led *ledger.Service, audit Auditor) *Service {
	return &Service{db: db, led: led, audit: audit}
}

// ListVideos returns creator-education videos, optionally filtered by topic.
func (s *Service) ListVideos(ctx context.Context, topic string) ([]FinanceVideo, error) {
	q := `SELECT id, title, creator, thumbnail_color, duration_mins, topic
	      FROM spotlight_videos WHERE published`
	args := []any{}
	if topic != "" {
		q += ` AND topic=$1`
		args = append(args, topic)
	}
	q += ` ORDER BY sort_order, title`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("spotlight: list videos: %w", err)
	}
	defer rows.Close()
	vids := []FinanceVideo{}
	for rows.Next() {
		var v FinanceVideo
		var t string
		if err := rows.Scan(&v.ID, &v.Title, &v.Creator, &v.ThumbnailColor, &v.DurationMins, &t); err != nil {
			return nil, err
		}
		v.Topic = SpotlightTopic(t)
		vids = append(vids, v)
	}
	return vids, rows.Err()
}

// ListChallenges returns active challenges with the caller's joined state.
func (s *Service) ListChallenges(ctx context.Context, userID string) ([]Challenge, error) {
	const q = `SELECT c.id, c.title, c.description, c.reward_kobo, c.currency, c.ends_at, c.kind,
	                  EXISTS(SELECT 1 FROM spotlight_challenge_members m
	                         WHERE m.challenge_id=c.id AND m.user_id=$1) AS joined
	           FROM spotlight_challenges c WHERE c.published ORDER BY c.ends_at`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("spotlight: list challenges: %w", err)
	}
	defer rows.Close()
	out := []Challenge{}
	for rows.Next() {
		c, err := scanChallenge(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetChallenge returns one challenge with the caller's joined state.
func (s *Service) GetChallenge(ctx context.Context, userID, id string) (*Challenge, error) {
	const q = `SELECT c.id, c.title, c.description, c.reward_kobo, c.currency, c.ends_at, c.kind,
	                  EXISTS(SELECT 1 FROM spotlight_challenge_members m
	                         WHERE m.challenge_id=c.id AND m.user_id=$1) AS joined
	           FROM spotlight_challenges c WHERE c.id=$2 AND c.published`
	row := s.db.QueryRow(ctx, q, userID, id)
	c, err := scanChallengeRow(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &c, nil
}

// JoinChallenge enrols the caller in a challenge (idempotent). Returns the
// challenge in its now-joined state. Object-level authZ: the session id is
// always the acting identity (a user can only join for themselves).
func (s *Service) JoinChallenge(ctx context.Context, userID, id string) (*Challenge, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	ch, err := s.GetChallenge(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	// Reject joining a challenge that has already ended.
	if ends, perr := time.Parse(time.RFC3339, ch.EndsAt); perr == nil && time.Now().After(ends) {
		return nil, ErrChallengeEnded
	}
	const ins = `INSERT INTO spotlight_challenge_members (id, challenge_id, user_id, state)
	             VALUES ($1,$2,$3,'JOINED')
	             ON CONFLICT (challenge_id, user_id) DO NOTHING`
	if _, err := s.db.Exec(ctx, ins, uuid.New().String(), id, userID); err != nil {
		return nil, fmt.Errorf("spotlight: join challenge: %w", err)
	}
	s.log(userID, "spotlight.challenge.join", "challenge", id, nil, nil)
	ch.Joined = true
	return ch, nil
}

// CompleteChallenge marks the caller's enrolment complete and pays the reward
// as WALLET CREDIT (never a return). The reward is redistributed from the
// paymax_revenue standing account into the member's main wallet via the finance
// ledger under idemKey (NL-9), and recorded in the reward sub-ledger for
// history. Guarded: JOINED → COMPLETED, and the credit is posted at most once.
func (s *Service) CompleteChallenge(ctx context.Context, userID, id, idemKey string) (*RewardWallet, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	if idemKey == "" {
		return nil, ErrBadInput
	}
	// Load challenge + membership state under one read.
	var rewardKobo int64
	var currency, memberState string
	const load = `SELECT c.reward_kobo, c.currency, COALESCE(m.state,'')
	              FROM spotlight_challenges c
	              LEFT JOIN spotlight_challenge_members m
	                ON m.challenge_id=c.id AND m.user_id=$2
	              WHERE c.id=$1 AND c.published`
	if err := s.db.QueryRow(ctx, load, id, userID).Scan(&rewardKobo, &currency, &memberState); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("spotlight: load challenge: %w", err)
	}
	if memberState == "" {
		return nil, ErrForbidden // must join before completing
	}
	// Guarded transition JOINED → COMPLETED; RowsAffected==0 means already done.
	const upd = `UPDATE spotlight_challenge_members SET state='COMPLETED', completed_at=now()
	             WHERE challenge_id=$1 AND user_id=$2 AND state='JOINED'`
	ct, err := s.db.Exec(ctx, upd, id, userID)
	if err != nil {
		return nil, fmt.Errorf("spotlight: complete transition: %w", err)
	}
	firstCompletion := ct.RowsAffected() == 1
	// Pay reward only on the first completion and only for a positive reward.
	if firstCompletion && rewardKobo > 0 {
		if currency == "" {
			currency = DefaultCurrency
		}
		revAcc, err := s.led.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
		if err != nil {
			return nil, err
		}
		// Credit member wallet from revenue (redistributed, never minted).
		if err := s.led.Credit(ctx, userID, "spotlight:reward:"+id, idemKey+":wallet", revAcc.ID, rewardKobo); err != nil {
			// A duplicate here means the credit already posted — treat as success.
			if err != ledger.ErrDuplicate {
				return nil, fmt.Errorf("spotlight: reward credit: %w", err)
			}
		}
		// Record in the reward sub-ledger for the member's history view (idempotent).
		const rew = `INSERT INTO spotlight_reward_ledger (id, user_id, label, amount_kobo, currency, idempotency_key)
		             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (idempotency_key) DO NOTHING`
		label := "Challenge reward"
		if _, err := s.db.Exec(ctx, rew, uuid.New().String(), userID, label, rewardKobo, currency, idemKey+":reward"); err != nil {
			return nil, fmt.Errorf("spotlight: reward entry: %w", err)
		}
		s.log(userID, "spotlight.challenge.complete", "challenge", id, nil,
			map[string]any{"reward_kobo": rewardKobo})
	}
	return s.RewardWallet(ctx, userID)
}

// Leaderboard returns the top learners ranked by LEARNING points (never profit).
// Points are aggregated from spotlight_learning_points; the caller's own row is
// always included and labelled 'You'.
func (s *Service) Leaderboard(ctx context.Context, userID string) ([]LeaderboardEntry, error) {
	const q = `SELECT display_name, points, user_id FROM spotlight_learning_points
	           ORDER BY points DESC LIMIT 50`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("spotlight: leaderboard: %w", err)
	}
	defer rows.Close()
	out := []LeaderboardEntry{}
	rank := 0
	for rows.Next() {
		rank++
		var e LeaderboardEntry
		var rowUser string
		if err := rows.Scan(&e.DisplayName, &e.Points, &rowUser); err != nil {
			return nil, err
		}
		e.Rank = rank
		if rowUser == userID {
			e.DisplayName = "You"
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// RewardWallet returns the caller's learning-reward credit balance (derived,
// NL-8) plus the newest-first history of credits/redemptions.
func (s *Service) RewardWallet(ctx context.Context, userID string) (*RewardWallet, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	var bal int64
	const balQ = `SELECT COALESCE(SUM(amount_kobo),0) FROM spotlight_reward_ledger WHERE user_id=$1`
	if err := s.db.QueryRow(ctx, balQ, userID).Scan(&bal); err != nil {
		return nil, fmt.Errorf("spotlight: reward balance: %w", err)
	}
	rows, err := s.db.Query(ctx, `SELECT id, label, amount_kobo, currency, created_at
	                              FROM spotlight_reward_ledger WHERE user_id=$1
	                              ORDER BY created_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, fmt.Errorf("spotlight: reward history: %w", err)
	}
	defer rows.Close()
	hist := []RewardWalletEntry{}
	for rows.Next() {
		var e RewardWalletEntry
		var amt int64
		var cur string
		var at time.Time
		if err := rows.Scan(&e.ID, &e.Label, &amt, &cur, &at); err != nil {
			return nil, err
		}
		e.Amount = koboToMoney(amt, cur)
		e.At = at.Format(time.RFC3339)
		hist = append(hist, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &RewardWallet{Balance: koboToMoney(bal, DefaultCurrency), History: hist}, nil
}

// ListCampaigns returns published education/referral programmes.
func (s *Service) ListCampaigns(ctx context.Context) ([]Campaign, error) {
	rows, err := s.db.Query(ctx, `SELECT id, title, description, icon_color, cta
	                              FROM spotlight_campaigns WHERE published ORDER BY sort_order, title`)
	if err != nil {
		return nil, fmt.Errorf("spotlight: campaigns: %w", err)
	}
	defer rows.Close()
	out := []Campaign{}
	for rows.Next() {
		var c Campaign
		if err := rows.Scan(&c.ID, &c.Title, &c.Description, &c.IconColor, &c.CTA); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetCampaign returns one published campaign.
func (s *Service) GetCampaign(ctx context.Context, id string) (*Campaign, error) {
	var c Campaign
	if err := s.db.QueryRow(ctx, `SELECT id, title, description, icon_color, cta
	                              FROM spotlight_campaigns WHERE id=$1 AND published`, id).
		Scan(&c.ID, &c.Title, &c.Description, &c.IconColor, &c.CTA); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("spotlight: get campaign: %w", err)
	}
	return &c, nil
}

func scanChallenge(rows pgx.Rows) (Challenge, error) {
	var c Challenge
	var rewardKobo int64
	var currency, kind string
	var endsAt time.Time
	if err := rows.Scan(&c.ID, &c.Title, &c.Description, &rewardKobo, &currency, &endsAt, &kind, &c.Joined); err != nil {
		return c, err
	}
	c.Reward = koboToMoney(rewardKobo, currency)
	c.Kind = ChallengeKind(kind)
	c.EndsAt = endsAt.Format(time.RFC3339)
	return c, nil
}

func scanChallengeRow(row pgx.Row) (Challenge, error) {
	var c Challenge
	var rewardKobo int64
	var currency, kind string
	var endsAt time.Time
	if err := row.Scan(&c.ID, &c.Title, &c.Description, &rewardKobo, &currency, &endsAt, &kind, &c.Joined); err != nil {
		return c, err
	}
	c.Reward = koboToMoney(rewardKobo, currency)
	c.Kind = ChallengeKind(kind)
	c.EndsAt = endsAt.Format(time.RFC3339)
	return c, nil
}

func (s *Service) log(actor, action, resType, resID string, oldV, newV map[string]any) {
	if s.audit == nil {
		return
	}
	s.audit.LogAction(actor, "", action, "spotlightwealth", resType, resID, oldV, newV, "", "", "info")
}

// RegisterSpotlightwealth mounts the Spotlight Wealth member routes on the
// provided group. The caller passes a group already scoped to /spotlight and
// already carrying the auth middleware (user_id mirrored onto the gin context),
// matching the mobile base path /api/v1/spotlight/*.
//
//	GET  /videos?topic=              — creator-education videos
//	GET  /challenges                 — learn-and-earn challenges (+ joined state)
//	GET  /challenges/:id             — one challenge
//	POST /challenges/:id/join        — join a challenge
//	POST /challenges/:id/complete    — complete a challenge → wallet credit (Idempotency-Key)
//	GET  /leaderboard                — LEARNING-points leaderboard (never profit)
//	GET  /reward-wallet              — reward credit balance + history
//	GET  /campaigns                  — education/referral programmes
//	GET  /campaigns/:id              — one campaign
func RegisterSpotlightwealth(g *gin.RouterGroup, h *Handler) {
	g.GET("/videos", h.GetVideos)
	g.GET("/challenges", h.GetChallenges)
	g.GET("/challenges/:id", h.GetChallenge)
	g.POST("/challenges/:id/join", h.JoinChallenge)
	g.POST("/challenges/:id/complete", h.CompleteChallenge)
	g.GET("/leaderboard", h.GetLeaderboard)
	g.GET("/reward-wallet", h.GetRewardWallet)
	g.GET("/campaigns", h.GetCampaigns)
	g.GET("/campaigns/:id", h.GetCampaign)
}

// Spotlight Wealth — the education-first Spotlight ⇄ Invest growth surface.
// Server counterpart of mobile features/spotlightwealth/types/spotlight.types.ts.
// STRICT RULES (docs/crypto/product.md → Spotlight Integration), enforced here:
//   • Leaderboards rank LEARNING points (lessons/quizzes) — never profit/gains.
//   • Challenge rewards are WALLET CREDIT — never a guaranteed investment return.
//   • Nothing recommends a security or surfaces a celebrity buy-signal.
// MONEY: internally every reward amount is BIGINT kobo (int64) and moves through
// the finance double-entry ledger — a completion credit is redistributed from
// the paymax_revenue standing account into the member's wallet, never minted.
// The client-facing Money struct is a { amount(major units), currency } display
// pair (matching the mobile type), converted at the handler boundary only.

// Money is the client-facing display pair. amount is MAJOR units (e.g. Naira),
// matching the mobile type. Server-side math always uses kobo int64.
type Money struct {
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

// koboToMoney converts an internal kobo amount to the display Money pair.
func koboToMoney(kobo int64, currency string) Money {
	return Money{Amount: float64(kobo) / 100.0, Currency: currency}
}

// SpotlightTopic tags a video / challenge (drives chip styling client-side).
type SpotlightTopic string

// ChallengeKind — all education-first (never a trade).
type ChallengeKind string

// FinanceVideo is a creator-led financial-literacy video (education only).
type FinanceVideo struct {
	ID             string         `json:"id"`
	Title          string         `json:"title"`
	Creator        string         `json:"creator"`
	ThumbnailColor string         `json:"thumbnailColor"`
	DurationMins   int            `json:"durationMins"`
	Topic          SpotlightTopic `json:"topic"`
}

// Challenge is a learn-and-earn challenge. reward is credited to the member's
// WALLET on completion — never a guaranteed return, never framed as profit.
// `joined` is per-caller (derived from spotlight_challenge_members).
type Challenge struct {
	ID          string        `json:"id"`
	Title       string        `json:"title"`
	Description string        `json:"description"`
	Reward      Money         `json:"reward"`
	EndsAt      string        `json:"endsAt"`
	Joined      bool          `json:"joined"`
	Kind        ChallengeKind `json:"kind"`
}

// LeaderboardEntry — points are LEARNING points, explicitly NOT profit.
type LeaderboardEntry struct {
	Rank        int    `json:"rank"`
	DisplayName string `json:"displayName"`
	Points      int    `json:"points"`
}

// RewardWalletEntry is one credit/spend movement in the reward wallet history.
type RewardWalletEntry struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Amount Money  `json:"amount"` // positive = credit earned, negative = redeemed
	At     string `json:"at"`
}

// RewardWallet is the member's learning-reward credit balance + history.
type RewardWallet struct {
	Balance Money               `json:"balance"`
	History []RewardWalletEntry `json:"history"`
}

// Campaign is a creator/event-led education or referral programme.
type Campaign struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	IconColor   string `json:"iconColor"`
	CTA         string `json:"cta"`
}

// DefaultCurrency for reward credit (matches the mobile DEFAULT_CURRENCY).
const DefaultCurrency = "NGN"

// Sentinel errors — mapped to HTTP status in the handler.
var (
	ErrNotFound       = errors.New("spotlight: not found")
	ErrForbidden      = errors.New("spotlight: forbidden")
	ErrBadInput       = errors.New("spotlight: invalid input")
	ErrAlreadyJoined  = errors.New("spotlight: already joined")
	ErrChallengeEnded = errors.New("spotlight: challenge has ended")
)

// Handler exposes the Spotlight Wealth member API. user_id is set on the gin
// context by the auth middleware (c.GetString("user_id")). Responses are the raw
// payload (no envelope) to match the mobile api wrapper's
// unwrap(res.data?.data ?? res.data), mirroring the invest module.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusForbidden, ErrForbidden),
	httperr.R(http.StatusBadRequest, ErrBadInput),
	httperr.R(http.StatusConflict, ErrChallengeEnded, ErrAlreadyJoined),
)

// httpErr writes the mapped status; unknown errors get a generic 500 body so
// internals never leak to the client.
func httpErr(c *gin.Context, err error) {
	if code := errMap.Code(err); code != http.StatusInternalServerError {
		c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{keyError: "something went wrong"})
}

// GetVideos — GET /videos?topic=
func (h *Handler) GetVideos(c *gin.Context) {
	vids, err := h.svc.ListVideos(c.Request.Context(), c.Query("topic"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, vids)
}

// GetChallenges — GET /challenges
func (h *Handler) GetChallenges(c *gin.Context) {
	out, err := h.svc.ListChallenges(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// GetChallenge — GET /challenges/:id
func (h *Handler) GetChallenge(c *gin.Context) {
	ch, err := h.svc.GetChallenge(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ch)
}

// JoinChallenge — POST /challenges/:id/join
func (h *Handler) JoinChallenge(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	ch, err := h.svc.JoinChallenge(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ch)
}

// CompleteChallenge — POST /challenges/:id/complete (money mutation; needs Idempotency-Key)
func (h *Handler) CompleteChallenge(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	key, ok := ginutil.RequireIdempotencyKey(c)
	if !ok {
		return
	}
	wallet, err := h.svc.CompleteChallenge(c.Request.Context(), uid, c.Param("id"), key)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, wallet)
}

// GetLeaderboard — GET /leaderboard?metric=learning_points
func (h *Handler) GetLeaderboard(c *gin.Context) {
	out, err := h.svc.Leaderboard(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// GetRewardWallet — GET /reward-wallet
func (h *Handler) GetRewardWallet(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	w, err := h.svc.RewardWallet(c.Request.Context(), uid)
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, w)
}

// GetCampaigns — GET /campaigns
func (h *Handler) GetCampaigns(c *gin.Context) {
	out, err := h.svc.ListCampaigns(c.Request.Context())
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

// GetCampaign — GET /campaigns/:id
func (h *Handler) GetCampaign(c *gin.Context) {
	ch, err := h.svc.GetCampaign(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ch)
}
