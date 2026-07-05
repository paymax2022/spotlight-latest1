// Package property is the Property Management suite unification glue. It turns the
// existing estate (visitor access) module and the realtor agency/portfolio plane
// into sub-modules of a single Property Management umbrella, exposing read-mostly
// cross-module aggregations (role context, rent passport) under /api/finance/property.
//
// It owns NO money path. Context + rent passport are read/computed aggregations;
// active-context switching is metadata only. The stay→gate-pass moat flow lives in
// the realtor module and reuses the estate pass-issuance seam.
package property

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the Property Management suite aggregation service. All reads are
// scoped to the authenticated user id passed by the handler.
type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// ── Role / context model ──────────────────────────────────────────────────────

// ContextRef is a {type,id} pointer to an entity the user can act within.
// Type is one of: estate | property | agency | org.
type ContextRef struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// ContextEntity is one entity the caller has a role in, with that role set.
// Type is one of estate | property | agency | org; Roles holds the merged role set
// (e.g. tenant, landlord, estate_admin, resident, agency_owner).
type ContextEntity struct {
	Type  string   `json:"type"`
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Roles []string `json:"roles"`
}

// ContextResponse is the payload for GET /property/context.
type ContextResponse struct {
	ActiveContext *ContextRef     `json:"activeContext"`
	Contexts      []ContextEntity `json:"contexts"`
}

// GetContext aggregates the caller's role assignments across the property graph by
// reading existing tables only (no new writes):
//   - estate_residents      → estate membership + role (resident | estate_admin)
//   - estates.admin_id       → estate ownership (estate_admin)
//   - estate_properties      → per-property landlord / tenant assignments
//   - realtor_portfolios     → agency/portfolio ownership (agency_owner)
//
// Roles are merged per entity (a user may be both landlord and estate_admin). The
// caller's persisted active context (if any) is returned alongside.
func (s *Service) GetContext(ctx context.Context, userID string) (*ContextResponse, error) {
	// entity key "type:id" -> aggregated entity.
	idx := map[string]*ContextEntity{}
	add := func(typ, id, name, role string) {
		if id == "" {
			return
		}
		key := typ + ":" + id
		e, ok := idx[key]
		if !ok {
			e = &ContextEntity{Type: typ, ID: id, Name: name}
			idx[key] = e
		}
		if name != "" && e.Name == "" {
			e.Name = name
		}
		for _, r := range e.Roles {
			if r == role {
				return
			}
		}
		e.Roles = append(e.Roles, role)
	}

	// Estate membership (resident / estate_admin) joined to the estate name.
	rows, err := s.db.Query(ctx, `
		SELECT r.estate_id::TEXT, COALESCE(e.name,''), r.role
		FROM estate_residents r
		JOIN estates e ON e.id = r.estate_id
		WHERE r.user_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: estate memberships: %w", err)
	}
	for rows.Next() {
		var eid, name, role string
		if err := rows.Scan(&eid, &name, &role); err != nil {
			rows.Close()
			return nil, err
		}
		add("estate", eid, name, role)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Estate ownership (admin_id) — guarantees the estate_admin role even when the
	// admin has no estate_residents row.
	rows, err = s.db.Query(ctx, `SELECT id::TEXT, COALESCE(name,'') FROM estates WHERE admin_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: estate ownership: %w", err)
	}
	for rows.Next() {
		var eid, name string
		if err := rows.Scan(&eid, &name); err != nil {
			rows.Close()
			return nil, err
		}
		add("estate", eid, name, "estate_admin")
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Per-property landlord / tenant assignments (estate_properties).
	rows, err = s.db.Query(ctx, `
		SELECT id::TEXT, unit_label,
		       (landlord_id = $1) AS is_landlord,
		       (tenant_id   = $1) AS is_tenant
		FROM estate_properties
		WHERE landlord_id = $1 OR tenant_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: property assignments: %w", err)
	}
	for rows.Next() {
		var pid, label string
		var isLandlord, isTenant bool
		if err := rows.Scan(&pid, &label, &isLandlord, &isTenant); err != nil {
			rows.Close()
			return nil, err
		}
		if isLandlord {
			add("property", pid, label, "landlord")
		}
		if isTenant {
			add("property", pid, label, "tenant")
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Agency / portfolio ownership (realtor_portfolios).
	rows, err = s.db.Query(ctx, `SELECT id::TEXT, COALESCE(name,'') FROM realtor_portfolios WHERE owner_id = $1`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: agency portfolios: %w", err)
	}
	for rows.Next() {
		var aid, name string
		if err := rows.Scan(&aid, &name); err != nil {
			rows.Close()
			return nil, err
		}
		add("agency", aid, name, "agency_owner")
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := &ContextResponse{Contexts: make([]ContextEntity, 0, len(idx))}
	for _, e := range idx {
		out.Contexts = append(out.Contexts, *e)
	}

	// Active context (best-effort; absence is not an error).
	out.ActiveContext = s.activeContext(ctx, userID)
	return out, nil
}

// activeContext returns the user's persisted active context, or nil.
func (s *Service) activeContext(ctx context.Context, userID string) *ContextRef {
	var typ, id string
	err := s.db.QueryRow(ctx,
		`SELECT context_type, context_id::TEXT FROM property_active_context WHERE user_id=$1`, userID).
		Scan(&typ, &id)
	if err != nil {
		return nil
	}
	return &ContextRef{Type: typ, ID: id}
}

var validContextTypes = map[string]bool{"estate": true, "property": true, "agency": true, "org": true}

// SwitchContext upserts the caller's active context after validating that the
// caller actually holds a role in the target entity (fail-closed: a user cannot
// switch into a context they are not a member of). Returns the new active context.
func (s *Service) SwitchContext(ctx context.Context, userID, contextType, contextID string) (*ContextRef, error) {
	if !validContextTypes[contextType] {
		return nil, fmt.Errorf("property: invalid context_type %q", contextType)
	}
	if contextID == "" {
		return nil, fmt.Errorf("property: context_id required")
	}

	// Membership check against the aggregated context (reuses the same derivation
	// so the rule stays in one place).
	cur, err := s.GetContext(ctx, userID)
	if err != nil {
		return nil, err
	}
	allowed := false
	for _, e := range cur.Contexts {
		if e.Type == contextType && e.ID == contextID {
			allowed = true
			break
		}
	}
	if !allowed {
		return nil, fmt.Errorf("property: caller has no role in %s %s", contextType, contextID)
	}

	const up = `
		INSERT INTO property_active_context (user_id, context_type, context_id, updated_at)
		VALUES ($1,$2,$3, NOW())
		ON CONFLICT (user_id) DO UPDATE
		   SET context_type = EXCLUDED.context_type,
		       context_id   = EXCLUDED.context_id,
		       updated_at   = NOW()`
	if _, err := s.db.Exec(ctx, up, userID, contextType, contextID); err != nil {
		return nil, fmt.Errorf("property: persist active context: %w", err)
	}
	return &ContextRef{Type: contextType, ID: contextID}, nil
}
