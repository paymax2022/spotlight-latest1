package connectlive

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository holds the parameterized pgx queries for the live module. All queries
// are parameterized — no string interpolation of user input.
type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

func (r *Repository) CreateSession(ctx context.Context, hostID string, in CreateSessionInput, maxCohosts int) (*Session, error) {
	const q = `INSERT INTO connect_live_sessions (host_id, title, topic, status, low_bandwidth, max_cohosts)
		VALUES ($1,$2,NULLIF($3,''),'scheduled',$4,$5)
		RETURNING id, host_id, title, COALESCE(topic,''), status, low_bandwidth,
			viewer_count, max_cohosts, started_at, ended_at, created_at`
	s := &Session{}
	if err := r.db.QueryRow(ctx, q, hostID, in.Title, in.Topic, in.LowBandwidth, maxCohosts).Scan(
		&s.ID, &s.HostID, &s.Title, &s.Topic, &s.Status, &s.LowBandwidth,
		&s.ViewerCount, &s.MaxCohosts, &s.StartedAt, &s.EndedAt, &s.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: create live session: %w", err)
	}
	return s, nil
}

func (r *Repository) GetSession(ctx context.Context, id string) (*Session, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, ErrNotFound
	}
	const q = `SELECT id, host_id, title, COALESCE(topic,''), status, low_bandwidth,
			viewer_count, max_cohosts, started_at, ended_at, created_at
		FROM connect_live_sessions WHERE id=$1`
	s := &Session{}
	if err := r.db.QueryRow(ctx, q, id).Scan(
		&s.ID, &s.HostID, &s.Title, &s.Topic, &s.Status, &s.LowBandwidth,
		&s.ViewerCount, &s.MaxCohosts, &s.StartedAt, &s.EndedAt, &s.CreatedAt); err != nil {
		return nil, ErrNotFound
	}
	return s, nil
}

// SetStatus moves a session between lifecycle states, stamping started/ended
// timestamps. Returns ErrNotFound if the guarded transition matched no row.
func (r *Repository) SetStatus(ctx context.Context, id, from, to string) (*Session, error) {
	const q = `UPDATE connect_live_sessions
		SET status=$3,
			started_at = CASE WHEN $3='live'  AND started_at IS NULL THEN now() ELSE started_at END,
			ended_at   = CASE WHEN $3 IN ('ended','terminated') THEN now() ELSE ended_at END,
			updated_at = now()
		WHERE id=$1 AND status=$2
		RETURNING id, host_id, title, COALESCE(topic,''), status, low_bandwidth,
			viewer_count, max_cohosts, started_at, ended_at, created_at`
	s := &Session{}
	if err := r.db.QueryRow(ctx, q, id, from, to).Scan(
		&s.ID, &s.HostID, &s.Title, &s.Topic, &s.Status, &s.LowBandwidth,
		&s.ViewerCount, &s.MaxCohosts, &s.StartedAt, &s.EndedAt, &s.CreatedAt); err != nil {
		return nil, ErrNotFound
	}
	return s, nil
}

// ForceTerminate ends a session from any non-terminal state (admin moderation).
func (r *Repository) ForceTerminate(ctx context.Context, id string) (*Session, error) {
	const q = `UPDATE connect_live_sessions
		SET status='terminated', ended_at=now(), updated_at=now()
		WHERE id=$1 AND status IN ('scheduled','live')
		RETURNING id, host_id, title, COALESCE(topic,''), status, low_bandwidth,
			viewer_count, max_cohosts, started_at, ended_at, created_at`
	s := &Session{}
	if err := r.db.QueryRow(ctx, q, id).Scan(
		&s.ID, &s.HostID, &s.Title, &s.Topic, &s.Status, &s.LowBandwidth,
		&s.ViewerCount, &s.MaxCohosts, &s.StartedAt, &s.EndedAt, &s.CreatedAt); err != nil {
		return nil, ErrNotFound
	}
	return s, nil
}

// Discover lists currently-live sessions (optionally low-bandwidth only).
func (r *Repository) Discover(ctx context.Context, lowBandwidth bool, limit int) ([]Session, error) {
	const q = `SELECT id, host_id, title, COALESCE(topic,''), status, low_bandwidth,
			viewer_count, max_cohosts, started_at, ended_at, created_at
		FROM connect_live_sessions
		WHERE status='live' AND ($1=false OR low_bandwidth=true)
		ORDER BY viewer_count DESC, started_at DESC LIMIT $2`
	rows, err := r.db.Query(ctx, q, lowBandwidth, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: discover live: %w", err)
	}
	defer rows.Close()
	var out []Session
	for rows.Next() {
		var s Session
		if err := rows.Scan(&s.ID, &s.HostID, &s.Title, &s.Topic, &s.Status, &s.LowBandwidth,
			&s.ViewerCount, &s.MaxCohosts, &s.StartedAt, &s.EndedAt, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// UpsertParticipant records a join (idempotent on session+user), returning the row.
func (r *Repository) UpsertParticipant(ctx context.Context, sessionID, userID, role, state string) (*Participant, error) {
	const q = `INSERT INTO connect_live_participants (session_id, user_id, role, state, joined_at)
		VALUES ($1,$2,$3,$4, CASE WHEN $4='active' THEN now() ELSE NULL END)
		ON CONFLICT (session_id, user_id) DO UPDATE SET
			role=EXCLUDED.role, state=EXCLUDED.state,
			joined_at=CASE WHEN EXCLUDED.state='active' THEN now() ELSE connect_live_participants.joined_at END,
			updated_at=now()
		RETURNING id, session_id, user_id, role, state, joined_at, created_at`
	p := &Participant{}
	if err := r.db.QueryRow(ctx, q, sessionID, userID, role, state).Scan(
		&p.ID, &p.SessionID, &p.UserID, &p.Role, &p.State, &p.JoinedAt, &p.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: upsert participant: %w", err)
	}
	return p, nil
}

// SetParticipantState moderates a single participant (mute/unmute/kick/leave).
func (r *Repository) SetParticipantState(ctx context.Context, sessionID, userID, state string) error {
	ct, err := r.db.Exec(ctx,
		`UPDATE connect_live_participants SET state=$3, updated_at=now()
		 WHERE session_id=$1 AND user_id=$2`, sessionID, userID, state)
	if err != nil {
		return fmt.Errorf("connect: set participant state: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// RecountViewers recomputes the cached viewer_count projection from active rows.
func (r *Repository) RecountViewers(ctx context.Context, sessionID string) (int, error) {
	const q = `UPDATE connect_live_sessions s
		SET viewer_count = (
			SELECT COUNT(*) FROM connect_live_participants p
			WHERE p.session_id=s.id AND p.state='active' AND p.role IN ('viewer','cohost')),
			updated_at=now()
		WHERE s.id=$1
		RETURNING viewer_count`
	var n int
	if err := r.db.QueryRow(ctx, q, sessionID).Scan(&n); err != nil {
		return 0, fmt.Errorf("connect: recount viewers: %w", err)
	}
	return n, nil
}

func (r *Repository) CountActiveCohosts(ctx context.Context, sessionID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_live_participants
		 WHERE session_id=$1 AND role='cohost' AND state='active'`, sessionID).Scan(&n)
	return n, err
}

// CreatePKBattle opens a PK battle between two live sessions.
func (r *Repository) CreatePKBattle(ctx context.Context, sessionID, opponentID string) (*PKBattle, error) {
	if _, err := uuid.Parse(opponentID); err != nil {
		return nil, ErrInvalidInput
	}
	const q = `INSERT INTO connect_pk_battles (session_id, opponent_session_id, status)
		VALUES ($1,$2,'active')
		RETURNING id, session_id, opponent_session_id, status, host_score, opponent_score, started_at, ended_at`
	b := &PKBattle{}
	if err := r.db.QueryRow(ctx, q, sessionID, opponentID).Scan(
		&b.ID, &b.SessionID, &b.OpponentID, &b.Status, &b.HostScore, &b.OpponentScore,
		&b.StartedAt, &b.EndedAt); err != nil {
		return nil, fmt.Errorf("connect: create pk battle: %w", err)
	}
	return b, nil
}

// ScorePK increments one side's non-cash score on the active battle for a session.
func (r *Repository) ScorePK(ctx context.Context, sessionID, side string, delta int64) (*PKBattle, error) {
	q := `UPDATE connect_pk_battles
		SET host_score = host_score + $2, updated_at=now()
		WHERE session_id=$1 AND status='active'
		RETURNING id, session_id, opponent_session_id, status, host_score, opponent_score, started_at, ended_at`
	if side == "opponent" {
		q = `UPDATE connect_pk_battles
			SET opponent_score = opponent_score + $2, updated_at=now()
			WHERE session_id=$1 AND status='active'
			RETURNING id, session_id, opponent_session_id, status, host_score, opponent_score, started_at, ended_at`
	}
	b := &PKBattle{}
	if err := r.db.QueryRow(ctx, q, sessionID, delta).Scan(
		&b.ID, &b.SessionID, &b.OpponentID, &b.Status, &b.HostScore, &b.OpponentScore,
		&b.StartedAt, &b.EndedAt); err != nil {
		return nil, ErrNotFound
	}
	return b, nil
}
