package handlers

// The per-user module membership view: "which modules is this person part of?"
// answered with one read-only call, for the admin User 360 profile.
//
// Same shape and failure policy as admin_overview.go: a registry of hand-written
// SQL, run concurrently under overviewConcurrency / overviewQueryTimeout, and a
// row that fails (table absent on a partially migrated database, permission
// denied, timeout) reports status "error" for THAT row only. "error" is never
// folded into "none": "not a member" and "we could not look" are opposite
// answers. The response carries counts, dates, labels and hrefs only - no
// personal data from the module tables.

import (
	"context"
	"log"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
)

type membershipSpec struct {
	Key   string
	Label string
	Group string
	// Href is the admin page for this module. "{userId}" is replaced with the
	// validated user id; the others are module-level pages.
	Href string
	// SQL takes the user id as $1 and returns (count, earliest-timestamp-as-text).
	SQL string
}

// membershipSpecs is the registry; the key is the table name. The "since" column
// is created_at on every table except ajo_members, which has no created_at and
// uses joined_at (verified against supabase/migrations).
var membershipSpecs = []membershipSpec{
	{Key: "restaurants", Label: "Restaurant owner", Group: "Commerce", Href: "/admin/restaurant",
		SQL: `SELECT count(*), min(created_at)::text FROM public.restaurants WHERE owner_id = $1`},
	{Key: "mkt_listings", Label: "Marketplace seller", Group: "Commerce", Href: "/admin/marketplace/users/{userId}",
		SQL: `SELECT count(*), min(created_at)::text FROM public.mkt_listings WHERE seller_id = $1`},
	{Key: "business_profiles", Label: "Registered business", Group: "Commerce", Href: "/admin/business",
		SQL: `SELECT count(*), min(created_at)::text FROM public.business_profiles WHERE user_id = $1`},
	{Key: "property_role_profiles", Label: "Property role", Group: "Commerce", Href: "/admin/property-roles",
		SQL: `SELECT count(*), min(created_at)::text FROM public.property_role_profiles WHERE user_id = $1`},
	{Key: "onb_merchant_profile", Label: "Merchant onboarding", Group: "Commerce", Href: "/admin/merchant-onboarding",
		SQL: `SELECT count(*), min(created_at)::text FROM public.onb_merchant_profile WHERE user_id = $1`},
	{Key: "stays_hotelier_profile", Label: "Stays hotelier", Group: "Travel", Href: "/admin/stays/dashboard",
		SQL: `SELECT count(*), min(created_at)::text FROM public.stays_hotelier_profile WHERE user_id = $1`},
	{Key: "drivers", Label: "Mobility driver", Group: "Travel", Href: "/admin/mobility/drivers",
		SQL: `SELECT count(*), min(created_at)::text FROM public.drivers WHERE user_id = $1`},
	{Key: "doctor_profiles", Label: "Doctor profile", Group: "Health", Href: "/admin/health/doctor/verification",
		SQL: `SELECT count(*), min(created_at)::text FROM public.doctor_profiles WHERE user_id = $1`},
	{Key: "doctors", Label: "Telemedicine doctor", Group: "Health", Href: "/admin/telemedicine/dashboard",
		SQL: `SELECT count(*), min(created_at)::text FROM public.doctors WHERE user_id = $1`},
	{Key: "events", Label: "Event organiser", Group: "Community", Href: "/admin/events/approval",
		SQL: `SELECT count(*), min(created_at)::text FROM public.events WHERE organizer_id = $1`},
	{Key: "event_tickets", Label: "Event ticket holder", Group: "Community", Href: "/admin/events/approval",
		SQL: `SELECT count(*), min(created_at)::text FROM public.event_tickets WHERE owner_id = $1`},
	{Key: "creator_profiles", Label: "Creator", Group: "Community", Href: "/admin/creators/dashboard",
		SQL: `SELECT count(*), min(created_at)::text FROM public.creator_profiles WHERE user_id = $1`},
	{Key: "connect_profiles", Label: "Connect profile", Group: "Community", Href: "/admin/connect/users/{userId}",
		SQL: `SELECT count(*), min(created_at)::text FROM public.connect_profiles WHERE user_id = $1`},
	{Key: "estate_residents", Label: "Estate resident", Group: "Community", Href: "/admin/estate",
		SQL: `SELECT count(*), min(created_at)::text FROM public.estate_residents WHERE user_id = $1`},
	{Key: "assoc_memberships", Label: "Association member", Group: "Community", Href: "/admin/association/dashboard",
		SQL: `SELECT count(*), min(created_at)::text FROM public.assoc_memberships WHERE user_id = $1`},
	{Key: "campaigns", Label: "Crowdfunding campaigner", Group: "Money", Href: "/admin/crowdfunding/review",
		SQL: `SELECT count(*), min(created_at)::text FROM public.campaigns WHERE creator_id = $1`},
	{Key: "insurance_policy", Label: "Insurance policyholder", Group: "Money", Href: "/admin/insurance/dashboard",
		SQL: `SELECT count(*), min(created_at)::text FROM public.insurance_policy WHERE policyholder_user_id = $1`},
	{Key: "savings_vaults", Label: "Savings vaults", Group: "Money", Href: "/admin/savings/vaults",
		SQL: `SELECT count(*), min(created_at)::text FROM public.savings_vaults WHERE owner_user_id = $1`},
	{Key: "ajo_members", Label: "Ajo member", Group: "Money", Href: "/admin/savings/ajo", // since: joined_at (no created_at column)
		SQL: `SELECT count(*), min(joined_at)::text FROM public.ajo_members WHERE user_id = $1`},
	{Key: "crypto_accounts", Label: "Crypto account", Group: "Money", Href: "/admin/crypto",
		SQL: `SELECT count(*), min(created_at)::text FROM public.crypto_accounts WHERE user_id = $1`},
	{Key: "user_module_grants", Label: "Module grants", Group: "Platform", Href: "/admin/modules", // active grants only: not revoked, not expired
		SQL: `SELECT count(*), min(created_at)::text FROM public.user_module_grants WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`},
	{Key: "academy_profiles", Label: "Academy learner", Group: "Programs", Href: "/admin/academy",
		SQL: `SELECT count(*), min(created_at)::text FROM public.academy_profiles WHERE user_id = $1`},
}

// membershipQuerier runs one registry query for one user. It is a seam so the
// handler can be tested without a database; the default is pool-backed.
type membershipQuerier func(ctx context.Context, sql, userID string) (count int64, since string, err error)

func poolMembershipQuerier(pool *pgxpool.Pool) membershipQuerier {
	return func(ctx context.Context, sql, userID string) (int64, string, error) {
		var n int64
		var since *string // min() of an empty set is NULL
		if err := pool.QueryRow(ctx, sql, userID).Scan(&n, &since); err != nil {
			return 0, "", err
		}
		if since == nil {
			return n, "", nil
		}
		return n, *since, nil
	}
}

type userModule struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Group  string `json:"group"`
	Href   string `json:"href"`
	Status string `json:"status"` // member | none | error
	Count  int64  `json:"count"`
	Since  string `json:"since"`
}

// WithModules enables the per-user module membership view. Additive; returns the
// same handler for chaining. With the flag off, or without a pool, Modules 404s.
func (h *AdminUsersHandler) WithModules(pool *pgxpool.Pool, enabled bool) *AdminUsersHandler {
	h.modulesEnabled = enabled
	if pool != nil {
		h.membership = poolMembershipQuerier(pool)
	}
	return h
}

// Modules lists every registry module with the user's membership status. Gated
// upstream by users.view; runs the same object-level scope check as Get and
// Roles BEFORE any membership query, so a scoped admin cannot probe users
// outside their scope.
func (h *AdminUsersHandler) Modules(c *gin.Context) {
	if !h.modulesEnabled || h.membership == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "not found"})
		return
	}
	userID := c.Param("id")
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid user id"})
		return
	}
	target, err := h.svc.GetAdminUser(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "error": "user not found"})
		return
	}
	actor, _ := middleware.GetAuthenticatedUser(c)
	if !h.canAccessUser(c.Request.Context(), actor.ID, target) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "error": "forbidden by scope"})
		return
	}

	timeout := h.modulesTimeout
	if timeout <= 0 {
		timeout = overviewQueryTimeout
	}
	out := make([]userModule, len(membershipSpecs))
	sem := make(chan struct{}, overviewConcurrency)
	var wg sync.WaitGroup
	for i, spec := range membershipSpecs {
		wg.Add(1)
		go func(i int, s membershipSpec) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			m := userModule{
				Key: s.Key, Label: s.Label, Group: s.Group,
				Href: strings.ReplaceAll(s.Href, "{userId}", userID),
			}
			ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
			defer cancel()
			n, since, err := h.membership(ctx, s.SQL, userID)
			switch {
			case err != nil:
				// Log server-side only; the response never carries the raw error.
				log.Printf("admin user modules: %s: %v", s.Key, err)
				m.Status = "error"
			case n > 0:
				m.Status, m.Count, m.Since = "member", n, since
			default:
				m.Status = "none"
			}
			out[i] = m
		}(i, spec)
	}
	wg.Wait()

	c.JSON(http.StatusOK, gin.H{"success": true, "modules": out})
}
