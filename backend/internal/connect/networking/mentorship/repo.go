package connectmentor

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository holds the parameterized pgx queries for the mentorship tables.
// It never touches the finance ledger, and its discovery query never references
// the Dating-mode (connect_profiles) tables (PN-7).
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// UpsertProfile creates/updates the caller's opt-in mentorship profile (MN-01).
func (r *Repository) UpsertProfile(ctx context.Context, userID, role string, domains []string, capacity int) (*MentorshipProfile, error) {
	if domains == nil {
		domains = []string{}
	}
	if capacity <= 0 {
		capacity = 1
	}
	const q = `INSERT INTO connect_mentorship_profiles (user_id, role, domains, capacity)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (user_id) DO UPDATE SET
			role=EXCLUDED.role, domains=EXCLUDED.domains, capacity=EXCLUDED.capacity,
			active=true, updated_at=now()
		RETURNING id, user_id, role, domains, capacity, active, created_at, updated_at`
	p := &MentorshipProfile{}
	if err := r.db.QueryRow(ctx, q, userID, role, domains, capacity).Scan(
		&p.ID, &p.UserID, &p.Role, &p.Domains, &p.Capacity, &p.Active, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, fmt.Errorf("connect: upsert mentorship profile: %w", err)
	}
	return p, nil
}

// discoverSafeSelect is the SELECT list for MN-02 discovery. It is built ONLY from
// safeMentorProjectionColumns (PN-7) so the safe projection is enforced in one place
// and asserted by the projection test.
var discoverSafeSelect = strings.Join(safeMentorProjectionColumns, ", ")

// DiscoverMentors returns the SAFE mentorship projection (PN-7). It selects ONLY
// mentorship_profiles + professional_profiles columns and LEFT JOINs the
// professional profile for the display name. It NEVER joins connect_profiles or any
// Dating-mode table/column. Only opt-in, active mentor-capable profiles are returned.
func (r *Repository) DiscoverMentors(ctx context.Context, viewerID, domain string, limit int) ([]SafeMentorProfile, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	// NOTE: the only joined table is connect_professional_profiles (professional
	// identity). connect_profiles (Dating mode) is intentionally NOT referenced.
	q := `SELECT ` + discoverSafeSelect + `
		FROM connect_mentorship_profiles mp
		LEFT JOIN connect_professional_profiles pp ON pp.user_id = mp.user_id
		WHERE mp.active = true
		  AND mp.role IN ('mentor','both')
		  AND mp.user_id <> $1
		  AND ($2 = '' OR $2 = ANY(mp.domains))
		ORDER BY mp.created_at DESC
		LIMIT $3`
	rows, err := r.db.Query(ctx, q, viewerID, domain, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: discover mentors: %w", err)
	}
	defer rows.Close()
	out := []SafeMentorProfile{}
	for rows.Next() {
		var m SafeMentorProfile
		var display *string
		if err := rows.Scan(&m.UserID, &m.Role, &m.Domains, &m.Capacity, &display); err != nil {
			return nil, err
		}
		if display != nil {
			m.DisplayName = *display
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertMatch creates a pending match (MN-03). One row per (mentor,mentee) pair:
// a repeat request is idempotent (ON CONFLICT DO NOTHING → fetch existing).
func (r *Repository) InsertMatch(ctx context.Context, mentorID, menteeID string) (*MentorshipMatch, error) {
	const ins = `INSERT INTO connect_mentorship_matches (mentor_id, mentee_id, state)
		VALUES ($1,$2,'requested')
		ON CONFLICT (mentor_id, mentee_id) DO NOTHING
		RETURNING id, mentor_id, mentee_id, state, created_at, updated_at`
	m := &MentorshipMatch{}
	err := r.db.QueryRow(ctx, ins, mentorID, menteeID).Scan(
		&m.ID, &m.MentorID, &m.MenteeID, &m.State, &m.CreatedAt, &m.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Existing pair — idempotent: return the current row.
		return r.matchByPair(ctx, mentorID, menteeID)
	}
	if err != nil {
		return nil, fmt.Errorf("connect: insert match: %w", err)
	}
	return m, nil
}

func (r *Repository) matchByPair(ctx context.Context, mentorID, menteeID string) (*MentorshipMatch, error) {
	const q = `SELECT id, mentor_id, mentee_id, state, created_at, updated_at
		FROM connect_mentorship_matches WHERE mentor_id=$1 AND mentee_id=$2`
	m := &MentorshipMatch{}
	if err := r.db.QueryRow(ctx, q, mentorID, menteeID).Scan(
		&m.ID, &m.MentorID, &m.MenteeID, &m.State, &m.CreatedAt, &m.UpdatedAt); err != nil {
		return nil, fmt.Errorf("connect: load match by pair: %w", err)
	}
	return m, nil
}

// GetMatch loads a match by id.
func (r *Repository) GetMatch(ctx context.Context, id string) (*MentorshipMatch, error) {
	const q = `SELECT id, mentor_id, mentee_id, state, created_at, updated_at
		FROM connect_mentorship_matches WHERE id=$1`
	m := &MentorshipMatch{}
	if err := r.db.QueryRow(ctx, q, id).Scan(
		&m.ID, &m.MentorID, &m.MenteeID, &m.State, &m.CreatedAt, &m.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("connect: get match: %w", err)
	}
	return m, nil
}

// TransitionMatch applies a guarded state change atomically. It re-loads the row
// FOR UPDATE, verifies the from→to transition is legal (deny-by-default), and only
// writes if the current state still matches `from`. Returns applied=true exactly
// once for a given transition (the write is the idempotency gate for loyalty emits).
func (r *Repository) TransitionMatch(ctx context.Context, matchID string, from, to MatchState) (applied bool, m *MentorshipMatch, err error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return false, nil, fmt.Errorf("connect: begin transition: %w", err)
	}
	defer tx.Rollback(ctx)

	var cur MatchState
	if err := tx.QueryRow(ctx,
		`SELECT state FROM connect_mentorship_matches WHERE id=$1 FOR UPDATE`, matchID).
		Scan(&cur); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil, ErrNotFound
		}
		return false, nil, fmt.Errorf("connect: lock match: %w", err)
	}
	if cur != from {
		// Someone else moved it (or it's already at the target). Not our transition.
		return false, nil, ErrBadTransition
	}
	if !validTransition(from, to) {
		return false, nil, ErrBadTransition
	}
	const upd = `UPDATE connect_mentorship_matches SET state=$2, updated_at=now()
		WHERE id=$1 AND state=$3
		RETURNING id, mentor_id, mentee_id, state, created_at, updated_at`
	m = &MentorshipMatch{}
	if err := tx.QueryRow(ctx, upd, matchID, string(to), string(from)).Scan(
		&m.ID, &m.MentorID, &m.MenteeID, &m.State, &m.CreatedAt, &m.UpdatedAt); err != nil {
		return false, nil, fmt.Errorf("connect: apply transition: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, nil, fmt.Errorf("connect: commit transition: %w", err)
	}
	return true, m, nil
}

// ListMatchesForUser returns matches where the user is mentor or mentee.
func (r *Repository) ListMatchesForUser(ctx context.Context, userID string) ([]MentorshipMatch, error) {
	const q = `SELECT id, mentor_id, mentee_id, state, created_at, updated_at
		FROM connect_mentorship_matches
		WHERE mentor_id=$1 OR mentee_id=$1
		ORDER BY updated_at DESC`
	return r.scanMatches(ctx, q, userID)
}

// ListMatchesByState returns matches filtered by state (admin ADM-MN-01; empty state
// = all). Ordered newest-first for a moderation queue.
func (r *Repository) ListMatchesByState(ctx context.Context, state string, limit int) ([]MentorshipMatch, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, mentor_id, mentee_id, state, created_at, updated_at
		FROM connect_mentorship_matches
		WHERE ($1 = '' OR state = $1)
		ORDER BY updated_at DESC
		LIMIT $2`
	rows, err := r.db.Query(ctx, q, state, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list matches by state: %w", err)
	}
	defer rows.Close()
	out := []MentorshipMatch{}
	for rows.Next() {
		var m MentorshipMatch
		if err := rows.Scan(&m.ID, &m.MentorID, &m.MenteeID, &m.State, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (r *Repository) scanMatches(ctx context.Context, q string, args ...any) ([]MentorshipMatch, error) {
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("connect: list matches: %w", err)
	}
	defer rows.Close()
	out := []MentorshipMatch{}
	for rows.Next() {
		var m MentorshipMatch
		if err := rows.Scan(&m.ID, &m.MentorID, &m.MenteeID, &m.State, &m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// AppendLoyaltyLog records a Paymax Black emit (PN-8 / ADM-GM-01) append-only.
// UNIQUE(reference) makes a replay a no-op, mirroring the points-ledger idempotency.
func (r *Repository) AppendLoyaltyLog(ctx context.Context, userID, trigger, reference, matchID string) error {
	const q = `INSERT INTO connect_networking_loyalty_log (user_id, module, trigger, reference, match_id)
		VALUES ($1,$2,$3,$4,NULLIF($5,'')::uuid)
		ON CONFLICT (reference) DO NOTHING`
	if _, err := r.db.Exec(ctx, q, userID, LoyaltyModule, trigger, reference, matchID); err != nil {
		return fmt.Errorf("connect: append loyalty log: %w", err)
	}
	return nil
}

// LoyaltyLogForUser reads the Phase-6 loyalty emissions for a user (ADM-GM-01).
// READ-ONLY over module='connect'.
func (r *Repository) LoyaltyLogForUser(ctx context.Context, userID string, limit int) ([]LoyaltyLogEntry, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, user_id, module, trigger, reference, COALESCE(match_id::text,''), created_at
		FROM connect_networking_loyalty_log
		WHERE user_id=$1 AND module='connect'
		ORDER BY created_at DESC
		LIMIT $2`
	rows, err := r.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: loyalty log read: %w", err)
	}
	defer rows.Close()
	out := []LoyaltyLogEntry{}
	for rows.Next() {
		var e LoyaltyLogEntry
		if err := rows.Scan(&e.ID, &e.UserID, &e.Module, &e.Trigger, &e.Reference, &e.MatchID, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
