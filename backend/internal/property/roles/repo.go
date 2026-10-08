package roles

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct{ db *pgxpool.Pool }

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

const profileCols = `id::text, user_id::text, role, status, verification_status, display_name, details,
	rejection_reason, verified_at, verified_by::text, created_at, updated_at`

func scanProfile(row pgx.Row) (*Profile, error) {
	var p Profile
	var raw []byte
	if err := row.Scan(&p.ID, &p.UserID, &p.Role, &p.Status, &p.VerificationStatus, &p.DisplayName, &raw,
		&p.RejectionReason, &p.VerifiedAt, &p.VerifiedBy, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	p.Details = map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &p.Details); err != nil {
			return nil, fmt.Errorf("decode details: %w", err)
		}
	}
	p.Documents = []Document{}
	return &p, nil
}

// lock fetches a profile row FOR UPDATE inside tx. byID selects id vs (user, role).
func lockProfile(ctx context.Context, tx pgx.Tx, where string, args ...any) (*Profile, error) {
	p, err := scanProfile(tx.QueryRow(ctx,
		`SELECT `+profileCols+` FROM public.property_role_profiles WHERE `+where+` FOR UPDATE`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("lock profile: %w", err)
	}
	return p, nil
}

func insertEvent(ctx context.Context, tx pgx.Tx, profileID, actorID, action string, from, to, reason *string) error {
	_, err := tx.Exec(ctx, `INSERT INTO public.property_role_events
		(profile_id, actor_id, action, from_verification, to_verification, reason)
		VALUES ($1, $2, $3, $4, $5, $6)`, profileID, actorID, action, from, to, reason)
	if err != nil {
		return fmt.Errorf("insert event %s: %w", action, err)
	}
	return nil
}

func (r *Repository) loadDocuments(ctx context.Context, ps []Profile) error {
	if len(ps) == 0 {
		return nil
	}
	ids := make([]string, len(ps))
	idx := make(map[string]int, len(ps))
	for i := range ps {
		ids[i] = ps[i].ID
		idx[ps[i].ID] = i
	}
	rows, err := r.db.Query(ctx, `SELECT id::text, profile_id::text, kind, storage_key, created_at
		FROM public.property_role_documents WHERE profile_id = ANY($1::uuid[]) ORDER BY created_at, id`, ids)
	if err != nil {
		return fmt.Errorf("load documents: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var d Document
		var pid string
		if err := rows.Scan(&d.ID, &pid, &d.Kind, &d.StorageKey, &d.CreatedAt); err != nil {
			return fmt.Errorf("scan document: %w", err)
		}
		ps[idx[pid]].Documents = append(ps[idx[pid]].Documents, d)
	}
	return rows.Err()
}

// Register inserts the (user, role) profile, or returns the existing row. The
// no-op DO UPDATE makes RETURNING yield the row on conflict; xmax = 0 tells a
// fresh insert (event written) from a replay (no event).
func (r *Repository) Register(ctx context.Context, userID, role, displayName string) (*Profile, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	// xmax = 0 is true only for a freshly inserted tuple (the conflict path rewrites it).
	var inserted bool
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO public.property_role_profiles (user_id, role, display_name)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, role) DO UPDATE SET updated_at = property_role_profiles.updated_at
		RETURNING id::text, (xmax = 0)`, userID, role, displayName).Scan(&id, &inserted)
	if err != nil {
		return nil, fmt.Errorf("register: %w", err)
	}
	if inserted {
		to := VerUnverified
		if err := insertEvent(ctx, tx, id, userID, "registered", nil, &to, nil); err != nil {
			return nil, err
		}
	}
	p, err := scanProfile(tx.QueryRow(ctx, `SELECT `+profileCols+` FROM public.property_role_profiles WHERE id = $1`, id))
	if err != nil {
		return nil, fmt.Errorf("reload: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return r.withDocs(ctx, p)
}

func (r *Repository) withDocs(ctx context.Context, p *Profile) (*Profile, error) {
	ps := []Profile{*p}
	if err := r.loadDocuments(ctx, ps); err != nil {
		return nil, err
	}
	return &ps[0], nil
}

func (r *Repository) listWhere(ctx context.Context, where string, args ...any) ([]Profile, error) {
	rows, err := r.db.Query(ctx, `SELECT `+profileCols+` FROM public.property_role_profiles `+where, args...)
	if err != nil {
		return nil, fmt.Errorf("list profiles: %w", err)
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		p, err := scanProfile(rows)
		if err != nil {
			return nil, fmt.Errorf("scan profile: %w", err)
		}
		out = append(out, *p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.loadDocuments(ctx, out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *Repository) MyRoles(ctx context.Context, userID string) ([]Profile, error) {
	return r.listWhere(ctx, `WHERE user_id = $1 ORDER BY created_at`, userID)
}

// ListByVerification is the admin review queue: suspended profiles are not
// reviewable, so they are excluded (oldest change first).
func (r *Repository) ListByVerification(ctx context.Context, status string, limit, offset int) ([]Profile, error) {
	return r.listWhere(ctx, `WHERE verification_status = $1 AND status <> 'suspended'
		ORDER BY updated_at ASC, id LIMIT $2 OFFSET $3`, status, limit, offset)
}

// ProfileStatus returns the status of the caller's (user, role) profile.
func (r *Repository) ProfileStatus(ctx context.Context, userID, role string) (string, error) {
	var st string
	err := r.db.QueryRow(ctx, `SELECT status FROM public.property_role_profiles WHERE user_id = $1 AND role = $2`,
		userID, role).Scan(&st)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("profile status: %w", err)
	}
	return st, nil
}

// DocumentOf returns document docID only when it belongs to profileID.
func (r *Repository) DocumentOf(ctx context.Context, profileID, docID string) (*Document, error) {
	var d Document
	err := r.db.QueryRow(ctx, `SELECT id::text, kind, storage_key, created_at FROM public.property_role_documents
		WHERE id = $1 AND profile_id = $2`, docID, profileID).Scan(&d.ID, &d.Kind, &d.StorageKey, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("document of: %w", err)
	}
	return &d, nil
}

// IsVerified is true only for verification_status='verified' AND status='active'.
func (r *Repository) IsVerified(ctx context.Context, userID, role string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM public.property_role_profiles
		WHERE user_id = $1 AND role = $2 AND verification_status = 'verified' AND status = 'active')`,
		userID, role).Scan(&ok)
	if err != nil {
		return false, fmt.Errorf("is verified: %w", err)
	}
	return ok, nil
}

// inTx runs fn in a transaction; the caller's state change and event row commit together.
func (r *Repository) inTx(ctx context.Context, fn func(tx pgx.Tx) (*Profile, error)) (*Profile, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	p, err := fn(tx)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return r.withDocs(ctx, p)
}

func reload(ctx context.Context, tx pgx.Tx, id string) (*Profile, error) {
	p, err := scanProfile(tx.QueryRow(ctx, `SELECT `+profileCols+` FROM public.property_role_profiles WHERE id = $1`, id))
	if err != nil {
		return nil, fmt.Errorf("reload: %w", err)
	}
	return p, nil
}
