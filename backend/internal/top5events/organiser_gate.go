package top5events

// Organiser-upgrade gate (UAT EVTA-D001).
//
// Before this, "organiser" was implicit — whoever owned events.organiser_id — so
// any authenticated customer could create, submit and publish events. The
// capability now comes from the platform merchant-onboarding pipeline
// (internal/onboarding): a customer applies for the `mt-event-organiser`
// merchant type, an admin approves, and approval grants the `event_organiser`
// role, which carries the (pre-existing) `events.manage` permission. The gate
// below checks that permission server-side through the same RBAC function the
// RequirePermission middleware falls back to (public.user_has_permission), so
// super-admins pass and per-user deny overrides apply.
//
// Flag: FEATURE_EVENTS_ORGANISER_GATE (default OFF). Off = today's behaviour —
// the gate is never consulted. Existing organisers are grandfathered by
// migration 20271068004010 and, when the flag is on, by GrandfatherOrganisers at
// boot (which covers events created between that migration and the flag flip).
//
// Scope: the gate guards the actions that bring a NEW event into being or put
// one in front of buyers — create, duplicate, submit for approval, go live.
// Every other organiser write is already object-level owner/MANAGER gated, and
// an owner necessarily passed this gate (or was grandfathered) to create the
// event in the first place. Steward scan, ticket purchase and admin routes are
// untouched.

import (
	"context"
	"fmt"
)

const (
	// OrganiserPermission is the RBAC permission an approved organiser holds.
	// Seeded with the events module (20260726000200_events.sql).
	OrganiserPermission = "events.manage"
	// OrganiserRoleSlug is the role onboarding grants on approval.
	OrganiserRoleSlug = "event_organiser"
	// OrganiserMerchantTypeID is the onboarding merchant type a customer applies for.
	OrganiserMerchantTypeID = "mt-event-organiser"
)

// ErrOrganiserRequired is returned when the gate is on and the caller has not
// been approved as an event organiser. It wraps ErrForbidden so every existing
// error mapper answers 403.
var ErrOrganiserRequired = fmt.Errorf("%w: organiser approval required — apply to become an event organiser", ErrForbidden)

// SetOrganiserGate turns the organiser-approval gate on or off (app-wiring,
// post-construction). Off is the zero value and preserves the legacy behaviour.
func (s *Service) SetOrganiserGate(enabled bool) { s.organiserGate = enabled }

// OrganiserGateEnabled reports whether the gate is on.
func (s *Service) OrganiserGateEnabled() bool { return s.organiserGate }

// CanOrganise reports whether userID may create/publish events. Always true
// while the gate is off.
func (s *Service) CanOrganise(ctx context.Context, userID string) (bool, error) {
	if !s.organiserGate {
		return true, nil
	}
	if userID == "" {
		return false, nil
	}
	var ok bool
	if err := s.db.QueryRow(ctx,
		`SELECT public.user_has_permission($1::uuid, $2, 'global', NULL)`,
		userID, OrganiserPermission).Scan(&ok); err != nil {
		return false, fmt.Errorf("events: organiser permission check: %w", err)
	}
	return ok, nil
}

// requireOrganiser fails closed: a lookup error is an error, never a pass.
func (s *Service) requireOrganiser(ctx context.Context, userID string) error {
	ok, err := s.CanOrganise(ctx, userID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrOrganiserRequired
	}
	return nil
}

// OrganiserEligibility is the caller's organiser status for the mobile create
// screen: whether the gate is on, whether they may organise, and which
// onboarding merchant type to apply for when they may not.
type OrganiserEligibility struct {
	GateEnabled    bool   `json:"gate_enabled"`
	CanOrganise    bool   `json:"can_organise"`
	MerchantTypeID string `json:"merchant_type_id"`
}

// Eligibility resolves OrganiserEligibility for userID.
func (s *Service) Eligibility(ctx context.Context, userID string) (*OrganiserEligibility, error) {
	ok, err := s.CanOrganise(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &OrganiserEligibility{GateEnabled: s.organiserGate, CanOrganise: ok, MerchantTypeID: OrganiserMerchantTypeID}, nil
}

// grandfatherSQL grants the organiser role (and an ACTIVE onboarding merchant
// profile, so /me/capabilities shows the workspace) to every user who already
// owns an event. It is the runtime twin of migration 20271068004010 and must
// stay in step with it.
//
// Idempotent and revocation-safe: a user who has ANY global user_roles row for
// the role — including a deactivated (revoked) one — is skipped, as is anyone
// who already has a profile row of this type, so a re-run never re-grants an
// organiser an admin has offboarded. Ownership is COALESCE(organiser_id,
// organizer_id) because events carries both spellings post-drift
// (20270228000000) and legacy rows may have organiser_id NULL. Only users
// present in public.platform_users — the actual FK target of user_roles.user_id
// — are granted: the auth.users bridge skips email-NULL identities, and one
// such row would fail the FK and abort the whole sweep. ON CONFLICT DO NOTHING
// (backed by the NULLS NOT DISTINCT index of 20271068000040) absorbs a
// concurrent instance running the same sweep.
const grandfatherRolesSQL = `
	WITH owners AS (
		SELECT DISTINCT COALESCE(e.organiser_id, e.organizer_id) AS user_id
		  FROM public.events e
		 WHERE COALESCE(e.organiser_id, e.organizer_id) IS NOT NULL
	), role AS (
		SELECT id FROM public.roles WHERE slug = 'event_organiser' AND is_active
	)
	INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id, is_active)
	SELECT o.user_id, r.id, 'global', NULL, true
	  FROM owners o CROSS JOIN role r
	 WHERE EXISTS (SELECT 1 FROM public.platform_users p WHERE p.id = o.user_id)
	   AND NOT EXISTS (
		SELECT 1 FROM public.user_roles ur
		 WHERE ur.user_id = o.user_id AND ur.role_id = r.id
		   AND ur.scope_type = 'global' AND ur.scope_id IS NULL)
	ON CONFLICT DO NOTHING`

const grandfatherProfilesSQL = `
	INSERT INTO onb_merchant_profile
		(user_id, module_id, merchant_type_id, application_id, role_granted, status, workspace_route, activated_at)
	SELECT DISTINCT o.user_id, 'mod-events', 'mt-event-organiser', NULL::uuid,
	       'event_organiser', 'ACTIVE', '/merchant/event-organiser', NOW()
	  FROM (SELECT DISTINCT COALESCE(e.organiser_id, e.organizer_id) AS user_id
	          FROM public.events e
	         WHERE COALESCE(e.organiser_id, e.organizer_id) IS NOT NULL) o
	 WHERE EXISTS (SELECT 1 FROM public.platform_users p WHERE p.id = o.user_id)
	   AND EXISTS (SELECT 1 FROM onb_merchant_type mt WHERE mt.id = 'mt-event-organiser')
	ON CONFLICT (user_id, merchant_type_id) DO NOTHING`

// GrandfatherOrganisers runs the grandfathering sweep and returns the number
// of role grants it inserted. Safe to run on every boot and on many instances.
func (s *Service) GrandfatherOrganisers(ctx context.Context) (int64, error) {
	tag, err := s.db.Exec(ctx, grandfatherRolesSQL)
	if err != nil {
		return 0, fmt.Errorf("events: grandfather organiser roles: %w", err)
	}
	if _, err := s.db.Exec(ctx, grandfatherProfilesSQL); err != nil {
		return tag.RowsAffected(), fmt.Errorf("events: grandfather organiser profiles: %w", err)
	}
	return tag.RowsAffected(), nil
}
