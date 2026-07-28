package onboarding

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
)

// grantRole idempotently assigns the role identified by slug to the user at global
// scope by inserting into the existing public.user_roles table. A retry is a no-op
// thanks to the table's UNIQUE(user_id, role_id, scope_type, scope_id) constraint.
// Returns false if the role slug is unknown.
func (r *Repository) grantRole(ctx context.Context, userID, roleSlug string) (bool, error) {
	var roleID string
	err := r.db.QueryRow(ctx,
		`SELECT id FROM public.roles WHERE slug = $1 AND is_active = true`, roleSlug).Scan(&roleID)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	const q = `
		INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
		VALUES ($1, $2, 'global', NULL, true)
		ON CONFLICT (user_id, role_id, scope_type, scope_id)
		DO UPDATE SET is_active = true, updated_at = NOW()`
	_, err = r.db.Exec(ctx, q, userID, roleID)
	return true, err
}

// activateProfile idempotently creates (or re-activates) the merchant profile for an
// approved application. The UNIQUE(user_id, merchant_type_id) constraint makes retries
// safe. Returns the profile id.
func (r *Repository) activateProfile(ctx context.Context, userID, moduleID, merchantTypeID, applicationID, roleSlug, workspaceRoute string) (string, error) {
	const q = `
		INSERT INTO onb_merchant_profile
			(user_id, module_id, merchant_type_id, application_id, role_granted, status, workspace_route, activated_at)
		VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6, NOW())
		ON CONFLICT (user_id, merchant_type_id)
		DO UPDATE SET status = 'ACTIVE',
		              application_id = EXCLUDED.application_id,
		              role_granted = EXCLUDED.role_granted,
		              workspace_route = EXCLUDED.workspace_route,
		              activated_at = COALESCE(onb_merchant_profile.activated_at, NOW()),
		              updated_at = NOW()
		RETURNING id`
	var id string
	err := r.db.QueryRow(ctx, q, userID, moduleID, merchantTypeID, applicationID, roleSlug, workspaceRoute).Scan(&id)
	return id, err
}

// writeAudit appends an immutable entry to the existing public.audit_logs table.
func (r *Repository) writeAudit(ctx context.Context, actorUserID, targetUserID, action, resourceID string, newValues any) error {
	var nv []byte
	if newValues != nil {
		nv, _ = json.Marshal(newValues)
	}
	const q = `
		INSERT INTO public.audit_logs
			(actor_user_id, target_user_id, action, module, resource_type, resource_id, new_values, severity)
		VALUES ($1, NULLIF($2,'')::uuid, $3, 'onboarding', 'onboarding_application', $4, $5, 'info')`
	_, err := r.db.Exec(ctx, q, nullUUID(actorUserID), targetUserID, action, resourceID, nv)
	return err
}

// nullUUID returns nil for empty strings so NULL is stored instead of failing the cast.
func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}
