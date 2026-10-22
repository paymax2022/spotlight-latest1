package cryptosvc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGControlsStore keeps the controls history in public.crypto_controls (append-only).
type PGControlsStore struct{ pool *pgxpool.Pool }

var _ ControlsStore = (*PGControlsStore)(nil)

// NewPGControlsStore wraps pool.
func NewPGControlsStore(pool *pgxpool.Pool) *PGControlsStore { return &PGControlsStore{pool: pool} }

const controlsLockKey = "crypto_controls"

const controlsCols = `version, trading_paused, withdrawals_paused, disabled_assets, max_quote_kobo,
	banner_message, banner_severity, reason, created_by, created_at`

func scanControls(row pgx.Row) (VersionedControls, error) {
	var v VersionedControls
	var msg, sev *string
	if err := row.Scan(&v.Version, &v.TradingPaused, &v.WithdrawalsPaused, &v.DisabledAssets, &v.MaxQuoteKobo,
		&msg, &sev, &v.Reason, &v.CreatedBy, &v.CreatedAt); err != nil {
		return VersionedControls{}, err
	}
	if msg != nil && sev != nil {
		v.Banner = &Banner{Message: *msg, Severity: *sev}
	}
	return v, nil
}

func noControls() VersionedControls {
	return VersionedControls{Reason: "nothing stored: all open", CreatedBy: "system"}
}

// Current returns the active state (Version 0, all open, when none is stored).
func (s *PGControlsStore) Current(ctx context.Context) (VersionedControls, error) {
	v, err := scanControls(s.pool.QueryRow(ctx, `SELECT `+controlsCols+` FROM public.crypto_controls ORDER BY version DESC LIMIT 1`))
	if errors.Is(err, pgx.ErrNoRows) {
		return noControls(), nil
	}
	return v, err
}

// History returns up to limit versions, newest first.
func (s *PGControlsStore) History(ctx context.Context, limit int) ([]VersionedControls, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+controlsCols+` FROM public.crypto_controls ORDER BY version DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VersionedControls{}
	for rows.Next() {
		v, err := scanControls(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// Append stores a new version and its audit row in ONE transaction under an advisory lock:
// idempotency replay/conflict, then the version check, then insert + audit.
func (s *PGControlsStore) Append(ctx context.Context, in ControlsInput) (ControlsChange, error) {
	if err := in.Validate(); err != nil {
		return ControlsChange{}, err
	}
	c := in.Controls.normalised()
	if c.DisabledAssets == nil {
		c.DisabledAssets = []string{}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ControlsChange{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext($1))`, controlsLockKey); err != nil {
		return ControlsChange{}, err
	}
	if prev, err := scanControls(tx.QueryRow(ctx, `SELECT `+controlsCols+` FROM public.crypto_controls WHERE idempotency_key = $1`, in.IdempotencyKey)); err == nil {
		if !sameControls(prev.Controls, c) {
			return ControlsChange{}, ErrControlsIdempotencyConflict
		}
		return ControlsChange{New: prev}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ControlsChange{}, err
	}
	old := noControls()
	if cur, err := scanControls(tx.QueryRow(ctx, `SELECT `+controlsCols+` FROM public.crypto_controls ORDER BY version DESC LIMIT 1`)); err == nil {
		old = cur
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ControlsChange{}, err
	}
	if old.Version != in.ExpectedVersion {
		return ControlsChange{}, ErrControlsVersionConflict
	}
	var msg, sev *string
	if c.Banner != nil {
		msg, sev = &c.Banner.Message, &c.Banner.Severity
	}
	v, err := scanControls(tx.QueryRow(ctx,
		`INSERT INTO public.crypto_controls (trading_paused, withdrawals_paused, disabled_assets, max_quote_kobo,
		   banner_message, banner_severity, reason, created_by, idempotency_key)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+controlsCols,
		c.TradingPaused, c.WithdrawalsPaused, c.DisabledAssets, c.MaxQuoteKobo, msg, sev,
		strings.TrimSpace(in.Reason), in.Actor, in.IdempotencyKey))
	if err != nil {
		return ControlsChange{}, err
	}
	oldJSON, _ := json.Marshal(old.Controls)
	newJSON, _ := json.Marshal(v.Controls)
	if _, err := tx.Exec(ctx,
		`INSERT INTO public.crypto_audit_log (actor_id, action, entity_type, entity_id, old_value, new_value, reason)
		 VALUES ($1, 'crypto.controls.update', 'crypto_controls', $2, $3::jsonb, $4::jsonb, $5)`,
		in.Actor, strconv.FormatInt(v.Version, 10), string(oldJSON), string(newJSON), v.Reason); err != nil {
		return ControlsChange{}, fmt.Errorf("cryptosvc: write controls audit record: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return ControlsChange{}, err
	}
	return ControlsChange{New: v, Old: old, Created: true}, nil
}
