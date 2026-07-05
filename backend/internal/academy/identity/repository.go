package identity

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository is the pgx data-access layer for the academy identity-bridge.
// All SQL is parameterized. Times are UTC (timestamptz). No balance columns here.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

// ErrNotFound is returned when a scoped row does not exist.
var ErrNotFound = errors.New("academy.identity: not found")

// ── Roles ─────────────────────────────────────────────────────────────────────

// GrantRole inserts an additive role idempotently (ON CONFLICT DO NOTHING).
func (r *Repository) GrantRole(ctx context.Context, userID string, role Role) error {
	const q = `
		INSERT INTO public.academy_roles (user_id, role)
		VALUES ($1, $2)
		ON CONFLICT (user_id, role) DO NOTHING`
	_, err := r.db.Exec(ctx, q, userID, string(role))
	return err
}

// ListRoles returns all additive roles for a user.
func (r *Repository) ListRoles(ctx context.Context, userID string) ([]RoleGrant, error) {
	const q = `
		SELECT user_id, role, granted_at
		FROM public.academy_roles WHERE user_id = $1
		ORDER BY granted_at ASC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RoleGrant{}
	for rows.Next() {
		var g RoleGrant
		if err := rows.Scan(&g.UserID, &g.Role, &g.GrantedAt); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// ── Profiles ──────────────────────────────────────────────────────────────────

// UpsertProfile writes the per-(user_id, role) profile row.
func (r *Repository) UpsertProfile(ctx context.Context, userID string, req UpsertProfileRequest) (*Profile, error) {
	const q = `
		INSERT INTO public.academy_profiles
			(user_id, role, class_id, stream, trade_track, school, display_name, avatar_url, entry_year, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
		ON CONFLICT (user_id, role) DO UPDATE SET
			class_id     = EXCLUDED.class_id,
			stream       = EXCLUDED.stream,
			trade_track  = EXCLUDED.trade_track,
			school       = EXCLUDED.school,
			display_name = EXCLUDED.display_name,
			avatar_url   = EXCLUDED.avatar_url,
			entry_year   = EXCLUDED.entry_year,
			updated_at   = now()`
	if _, err := r.db.Exec(ctx, q, userID, string(req.Role), req.ClassID, req.Stream,
		req.TradeTrack, req.School, req.DisplayName, req.AvatarURL, req.EntryYear); err != nil {
		return nil, err
	}
	return r.GetProfile(ctx, userID, req.Role)
}

// GetProfile returns one profile by (user_id, role).
func (r *Repository) GetProfile(ctx context.Context, userID string, role Role) (*Profile, error) {
	const q = `
		SELECT id, user_id, role, class_id, stream, trade_track, school, display_name,
		       avatar_url, entry_year, created_at, updated_at
		FROM public.academy_profiles WHERE user_id = $1 AND role = $2`
	p := &Profile{}
	err := r.db.QueryRow(ctx, q, userID, string(role)).Scan(
		&p.ID, &p.UserID, &p.Role, &p.ClassID, &p.Stream, &p.TradeTrack, &p.School,
		&p.DisplayName, &p.AvatarURL, &p.EntryYear, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// ListProfiles returns every profile row for a user.
func (r *Repository) ListProfiles(ctx context.Context, userID string) ([]Profile, error) {
	const q = `
		SELECT id, user_id, role, class_id, stream, trade_track, school, display_name,
		       avatar_url, entry_year, created_at, updated_at
		FROM public.academy_profiles WHERE user_id = $1 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Profile{}
	for rows.Next() {
		var p Profile
		if err := rows.Scan(&p.ID, &p.UserID, &p.Role, &p.ClassID, &p.Stream, &p.TradeTrack,
			&p.School, &p.DisplayName, &p.AvatarURL, &p.EntryYear, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ── Guardian links ────────────────────────────────────────────────────────────

// CreateGuardianLink inserts a pending link (idempotent on the UNIQUE pair).
// On conflict it returns the existing row so re-linking is a no-op replay.
func (r *Repository) CreateGuardianLink(ctx context.Context, guardianID, minorID string) (*GuardianLink, error) {
	const q = `
		INSERT INTO public.academy_guardian_links (guardian_user_id, minor_user_id, status)
		VALUES ($1, $2, 'pending')
		ON CONFLICT (guardian_user_id, minor_user_id) DO NOTHING
		RETURNING id, guardian_user_id, minor_user_id, consent_record_id, status, created_at`
	gl := &GuardianLink{}
	err := r.db.QueryRow(ctx, q, guardianID, minorID).Scan(
		&gl.ID, &gl.GuardianUserID, &gl.MinorUserID, &gl.ConsentRecordID, &gl.Status, &gl.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already linked — return the existing row (idempotent replay).
		return r.GetGuardianLink(ctx, guardianID, minorID)
	}
	return gl, err
}

// GetGuardianLink fetches a link by its (guardian, minor) pair.
func (r *Repository) GetGuardianLink(ctx context.Context, guardianID, minorID string) (*GuardianLink, error) {
	const q = `
		SELECT id, guardian_user_id, minor_user_id, consent_record_id, status, created_at
		FROM public.academy_guardian_links
		WHERE guardian_user_id = $1 AND minor_user_id = $2`
	gl := &GuardianLink{}
	err := r.db.QueryRow(ctx, q, guardianID, minorID).Scan(
		&gl.ID, &gl.GuardianUserID, &gl.MinorUserID, &gl.ConsentRecordID, &gl.Status, &gl.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return gl, err
}

// GetGuardianLinkByID fetches a link by primary key.
func (r *Repository) GetGuardianLinkByID(ctx context.Context, id string) (*GuardianLink, error) {
	const q = `
		SELECT id, guardian_user_id, minor_user_id, consent_record_id, status, created_at
		FROM public.academy_guardian_links WHERE id = $1`
	gl := &GuardianLink{}
	err := r.db.QueryRow(ctx, q, id).Scan(
		&gl.ID, &gl.GuardianUserID, &gl.MinorUserID, &gl.ConsentRecordID, &gl.Status, &gl.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return gl, err
}

// ListGuardianLinksAsGuardian returns links where the user is the guardian.
func (r *Repository) ListGuardianLinksAsGuardian(ctx context.Context, guardianID string) ([]GuardianLink, error) {
	return r.listLinks(ctx, `guardian_user_id = $1`, guardianID)
}

// ListGuardianLinksAsMinor returns links where the user is the minor.
func (r *Repository) ListGuardianLinksAsMinor(ctx context.Context, minorID string) ([]GuardianLink, error) {
	return r.listLinks(ctx, `minor_user_id = $1`, minorID)
}

func (r *Repository) listLinks(ctx context.Context, where, arg string) ([]GuardianLink, error) {
	q := `
		SELECT id, guardian_user_id, minor_user_id, consent_record_id, status, created_at
		FROM public.academy_guardian_links WHERE ` + where + ` ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []GuardianLink{}
	for rows.Next() {
		var gl GuardianLink
		if err := rows.Scan(&gl.ID, &gl.GuardianUserID, &gl.MinorUserID, &gl.ConsentRecordID,
			&gl.Status, &gl.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, gl)
	}
	return out, rows.Err()
}

// HasActiveConsent reports whether the minor has any active guardian link whose
// consent record grants the requested scope (scope value is truthy).
func (r *Repository) HasActiveConsent(ctx context.Context, minorID, scopeKey string) (bool, error) {
	// Join active links to their immutable consent record; the scope JSON must
	// contain the key set to boolean true.
	const q = `
		SELECT EXISTS (
			SELECT 1
			FROM public.academy_guardian_links gl
			JOIN public.academy_consent_records cr ON cr.id = gl.consent_record_id
			WHERE gl.minor_user_id = $1
			  AND gl.status = 'active'
			  AND (cr.scope ->> $2) = 'true'
		)`
	var ok bool
	if err := r.db.QueryRow(ctx, q, minorID, scopeKey).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// IsMinor reports whether the user is the minor side of ANY guardian link.
// Presence of a guardian link is the academy's signal that a user is a minor.
func (r *Repository) IsMinor(ctx context.Context, userID string) (bool, error) {
	const q = `SELECT EXISTS (SELECT 1 FROM public.academy_guardian_links WHERE minor_user_id = $1)`
	var ok bool
	if err := r.db.QueryRow(ctx, q, userID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}

// RecordConsentAndActivate posts an immutable ConsentRecord and flips the matching
// pending GuardianLink to active in ONE transaction. The transition is GUARDED:
// the UPDATE only fires WHERE status='pending'; if the link is missing or not
// pending the whole transaction rolls back with ErrIllegalTransition. Returns the
// new consent id.
func (r *Repository) RecordConsentAndActivate(
	ctx context.Context, guardianID, minorID string, scope map[string]any, actorID string,
) (string, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	scopeJSON, err := json.Marshal(scope)
	if err != nil {
		return "", err
	}
	if len(scopeJSON) == 0 {
		scopeJSON = []byte("{}")
	}

	const insConsent = `
		INSERT INTO public.academy_consent_records
			(minor_user_id, guardian_user_id, scope, actor_user_id, granted_at)
		VALUES ($1, $2, $3, $4, now())
		RETURNING id`
	var consentID string
	if err := tx.QueryRow(ctx, insConsent, minorID, guardianID, scopeJSON, actorID).Scan(&consentID); err != nil {
		return "", err
	}

	// Guarded transition: pending → active. Only flips a PENDING link.
	const activate = `
		UPDATE public.academy_guardian_links
		SET status = 'active', consent_record_id = $3
		WHERE guardian_user_id = $1 AND minor_user_id = $2 AND status = 'pending'`
	tag, err := tx.Exec(ctx, activate, guardianID, minorID, consentID)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		// No pending link to activate — illegal transition; roll back the consent.
		return "", ErrIllegalTransition
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return consentID, nil
}

// RevokeGuardianLink performs the guarded transition active → revoked.
// Returns ErrIllegalTransition if the link is not currently active.
func (r *Repository) RevokeGuardianLink(ctx context.Context, linkID string) (*GuardianLink, error) {
	const q = `
		UPDATE public.academy_guardian_links
		SET status = 'revoked'
		WHERE id = $1 AND status = 'active'`
	tag, err := r.db.Exec(ctx, q, linkID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Either the link does not exist or it is not active.
		if _, gerr := r.GetGuardianLinkByID(ctx, linkID); errors.Is(gerr, ErrNotFound) {
			return nil, ErrNotFound
		}
		return nil, ErrIllegalTransition
	}
	return r.GetGuardianLinkByID(ctx, linkID)
}

// ── Audit ─────────────────────────────────────────────────────────────────────

// InsertAudit appends an immutable row to the existing public.audit_logs table.
// module is fixed to "academy.identity"; actor/target may be empty (stored NULL).
func (r *Repository) InsertAudit(ctx context.Context, actorUserID, targetUserID, action, resourceType, resourceID string, newValues any) error {
	var nv []byte
	if newValues != nil {
		nv, _ = json.Marshal(newValues)
	}
	const q = `
		INSERT INTO public.audit_logs
			(actor_user_id, target_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES (NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, $3, 'academy.identity', $4, $5, $6, 'info')`
	_, err := r.db.Exec(ctx, q, actorUserID, targetUserID, action, resourceType, resourceID, nv)
	return err
}
