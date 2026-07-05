package spotlightwealth

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// Auditor is the immutable-audit sink (nil-safe), matching the finance modules.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string, oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

// Service owns the Spotlight Wealth reads plus the join/complete challenge
// mutations. Content (videos / challenges / campaigns / leaderboard) is
// server-driven config seeded by migration. The reward wallet is a per-user
// append-only ledger of learning credits (spotlight_reward_ledger): its balance
// is SUM(entries), never a mutated column (NL-8).
//
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

// ───────────────────────── Videos ─────────────────────────

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

// ───────────────────────── Challenges ─────────────────────────

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

// ───────────────────────── Leaderboard ─────────────────────────

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

// ───────────────────────── Reward wallet ─────────────────────────

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

// ───────────────────────── Campaigns ─────────────────────────

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

// ───────────────────────── helpers ─────────────────────────

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
