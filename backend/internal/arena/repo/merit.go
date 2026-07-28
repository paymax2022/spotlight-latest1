// Package repo holds the pgxpool implementations of every port declared in
// arena/service/ports.go. It is the ONLY place that touches the Arena tables.
//
// The merit repo is the physical append-only store (NDC-1,2,6): Insert writes a
// verified arena.SignedMeritEntry and relies on the unique constraint
// arena_merit_no_replay to reject replays; it never verifies signatures itself
// (that is MeritService.Append's job) and holds no signer.
package repo

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/service"
)

// MeritRepo is the pgxpool-backed append-only signed merit ledger.
type MeritRepo struct{ pool *pgxpool.Pool }

// NewMeritRepo builds the merit repo.
func NewMeritRepo(pool *pgxpool.Pool) *MeritRepo { return &MeritRepo{pool: pool} }

var _ service.MeritRepo = (*MeritRepo)(nil)

// AuthorizedAdapters returns a competition's active adapter public keys, used to
// build the verifier BEFORE any append (NDC-2).
func (r *MeritRepo) AuthorizedAdapters(ctx context.Context, competitionID string) ([]service.AuthorizedAdapter, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT adapter_id, source_type, public_key, active
		  FROM arena_authorized_adapter
		 WHERE competition_id = $1`, competitionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.AuthorizedAdapter{}
	for rows.Next() {
		var a service.AuthorizedAdapter
		if err := rows.Scan(&a.AdapterID, &a.SourceType, &a.PublicKey, &a.Active); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// LastEntryHash returns the contestant's most recent entry_hash for chaining
// (nil for genesis). entry_hash is stored hex-encoded.
func (r *MeritRepo) LastEntryHash(ctx context.Context, competitionID, contestantID string) ([]byte, error) {
	var hexHash string
	err := r.pool.QueryRow(ctx, `
		SELECT entry_hash FROM arena_merit_entry
		 WHERE competition_id = $1 AND contestant_id = $2
		 ORDER BY recorded_at DESC, signed_at DESC
		 LIMIT 1`, competitionID, contestantID).Scan(&hexHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // genesis
	}
	if err != nil {
		return nil, err
	}
	if hexHash == "" {
		return nil, nil
	}
	return hex.DecodeString(hexHash)
}

// Insert persists a verified entry. A duplicate (arena_merit_no_replay) → ErrReplay.
func (r *MeritRepo) Insert(ctx context.Context, e arena.SignedMeritEntry) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO arena_merit_entry
			(competition_id, contestant_id, source_type, source_adapter_id, stage,
			 rubric_version, raw_score, normalized_score, reason,
			 canonical_payload, signature, prev_hash, entry_hash, signed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
		e.Payload.CompetitionID,
		e.Payload.ContestantID,
		string(e.Payload.SourceType),
		e.Payload.AdapterID,
		string(e.Payload.Stage),
		e.Payload.RubricVersion,
		e.Payload.RawScore,
		e.Payload.NormalizedScore,
		e.Payload.Reason,
		string(e.Canonical),
		base64.StdEncoding.EncodeToString(e.Signature),
		hex.EncodeToString(e.PrevHash),
		hex.EncodeToString(e.EntryHash),
		e.Payload.SignedAt.UTC(),
	)
	if err != nil {
		if isUniqueViolation(err) {
			return service.ErrReplay
		}
		return err
	}
	return nil
}

// Leaderboard reads the refreshed matview for a stage.
func (r *MeritRepo) Leaderboard(ctx context.Context, competitionID string, stage arena.Stage) ([]service.LeaderRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT contestant_id, stage, total_score
		  FROM arena_merit_leaderboard
		 WHERE competition_id = $1 AND stage = $2
		 ORDER BY total_score DESC, contestant_id`, competitionID, string(stage))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []service.LeaderRow{}
	for rows.Next() {
		var lr service.LeaderRow
		var st string
		if err := rows.Scan(&lr.ContestantID, &st, &lr.TotalScore); err != nil {
			return nil, err
		}
		lr.Stage = arena.Stage(st)
		out = append(out, lr)
	}
	return out, rows.Err()
}

// RefreshLeaderboard refreshes the materialized view. CONCURRENTLY requires the
// unique index (present); falls back to a plain refresh if concurrency fails.
func (r *MeritRepo) RefreshLeaderboard(ctx context.Context) error {
	if _, err := r.pool.Exec(ctx, `REFRESH MATERIALIZED VIEW CONCURRENTLY arena_merit_leaderboard`); err != nil {
		if _, ferr := r.pool.Exec(ctx, `REFRESH MATERIALIZED VIEW arena_merit_leaderboard`); ferr != nil {
			return ferr
		}
	}
	return nil
}

// ContestantMerit lists a contestant's merit rows (read side).
func (r *MeritRepo) ContestantMerit(ctx context.Context, competitionID, contestantID string) ([]service.MeritEntryRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, competition_id, contestant_id, source_type, source_adapter_id,
		       stage, normalized_score, entry_hash, signed_at
		  FROM arena_merit_entry
		 WHERE competition_id = $1 AND contestant_id = $2
		 ORDER BY signed_at`, competitionID, contestantID)
	if err != nil {
		return nil, err
	}
	return scanMeritRows(rows)
}

// CompetitionMerit lists all merit rows for a competition (auditor read).
func (r *MeritRepo) CompetitionMerit(ctx context.Context, competitionID string) ([]service.MeritEntryRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, competition_id, contestant_id, source_type, source_adapter_id,
		       stage, normalized_score, entry_hash, signed_at
		  FROM arena_merit_entry
		 WHERE competition_id = $1
		 ORDER BY signed_at`, competitionID)
	if err != nil {
		return nil, err
	}
	return scanMeritRows(rows)
}

func scanMeritRows(rows pgx.Rows) ([]service.MeritEntryRow, error) {
	defer rows.Close()
	out := []service.MeritEntryRow{}
	for rows.Next() {
		var m service.MeritEntryRow
		var signedAt time.Time
		if err := rows.Scan(&m.ID, &m.CompetitionID, &m.ContestantID, &m.SourceType,
			&m.SourceAdapterID, &m.Stage, &m.NormalizedScore, &m.EntryHash, &signedAt); err != nil {
			return nil, err
		}
		m.SignedAt = signedAt
		out = append(out, m)
	}
	return out, rows.Err()
}

// isUniqueViolation reports whether err is a Postgres 23505 unique_violation. It
// avoids a hard pgconn dependency by matching on the SQLState via the error text
// as a fallback (the pgconn.PgError path is the primary check).
func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	if errors.As(err, &pgErr) {
		return pgErr.SQLState() == "23505"
	}
	return strings.Contains(err.Error(), "23505") ||
		strings.Contains(err.Error(), "duplicate key")
}
