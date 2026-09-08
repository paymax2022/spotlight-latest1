// Package modulegate refuses API traffic for modules the registry has not published.
//
// It is the server half of the module registry: the mobile grid already hides or
// greys out unpublished modules, but hiding an icon is not access control — a crafted
// request still reached the API. This package closes that.
//
// THREE DESIGN RULES, each chosen so the gate degrades toward availability:
//
//  1. THE MAP IS PARTIAL ON PURPOSE, AND UNMAPPED PATHS ARE ALLOWED. Only prefixes
//     verified against real gin Group() registrations appear below. An incomplete map
//     therefore under-enforces (a module stays reachable) instead of 503-ing endpoints
//     that work today. The opposite default — deny unknown paths — turns every gap in
//     this table into an outage, and the table has to track 36 modules by hand.
//
//  2. ADMIN PATHS ARE NEVER GATED. Administering a module is exactly what you need to
//     do while it is hidden; gating /admin would make a hidden module impossible to
//     publish, and the admin surfaces already fail closed behind RBAC.
//
//  3. A REGISTRY READ FAILURE ALLOWS THE REQUEST (see gate.go). Refusing all module
//     traffic because a config table is unreadable converts a small fault into a total
//     outage, and the module's own handlers need that same database anyway.
//
// Authorisation still lives in each module's own auth/RBAC/tier checks. This gate
// answers "is this module released?", never "may this caller do this?".
package modulegate

import "strings"

// route binds an absolute path prefix to a registry module key.
//
// Every prefix here was read off an actual `.Group(...)` registration in
// backend/internal/app rather than inferred from the module's name — several do not
// match (walletTransfers serves /transfers, virtualAccounts serves /va), and a guessed
// prefix is how a live endpoint starts returning 503.
type route struct {
	prefix    string
	moduleKey string
}

// routes is matched LONGEST PREFIX FIRST, so a more specific entry can override a
// broader one if the two ever overlap.
var routes = []route{
	{"/api/finance/wallet", "wallet"},
	{"/api/finance/transfers", "walletTransfers"},
	{"/api/finance/savings", "savings"},
	{"/api/finance/fx", "fx"},
	{"/api/v1/fx", "fx"},
	{"/api/finance/restaurant", "restaurant"},
	{"/api/finance/telemedicine", "telemedicine"},
	{"/api/v1/telemedicine", "telemedicine"},
	{"/api/finance/stays", "stays"},
	{"/api/finance/insurance", "insurance"},
	{"/api/finance/crowdfunding", "crowdfunding"},
	{"/api/finance/events", "events"},
	{"/api/finance/groups", "groups"},
	{"/api/finance/estate", "estate"},
	{"/api/finance/transport", "transport"},
	{"/api/finance/referrals", "referrals"},
	{"/api/finance/referral", "referrals"},
	{"/api/finance/kyc", "kyc"},
	{"/api/finance/va", "virtualAccounts"},
	{"/api/finance/disputes", "disputes"},
	{"/api/finance/ratings", "ratings"},
	{"/api/finance/loyalty", "loyalty"},
	{"/api/finance/realtor", "realtor"},
	{"/api/finance/creators", "creators"},
	{"/api/finance/associations", "association"},
	{"/api/finance/social", "socialPay"},
	{"/api/v1/pharmacy", "healthPharmacy"},
}

// Deliberately UNMAPPED, and why — so the gaps are a recorded decision, not an oversight:
//
//	aiCare, health, healthLab, healthVet, voteBridge, votesBridge, utilityPayments,
//	beneficiaries   — their routes are nested under paths this table cannot attribute
//	                  unambiguously yet. Left allowed rather than guessed.
//	checkoutTopupTier0, tierLimits, fintechAdmin, walletBankTransfers
//	                — behavioural flags and sub-behaviours, not standalone API surfaces.
//	                  Each is already gated inside its own handler.

// adminSegments mark a path as an administration surface, which is never gated.
// Matched as a path SEGMENT so "/api/finance/administrators" (were it ever added)
// could not be mistaken for an admin route.
var adminSegments = []string{"/admin/", "/admin"}

// IsAdminPath reports whether p is an administration surface.
func IsAdminPath(p string) bool {
	for _, seg := range adminSegments {
		if strings.HasSuffix(p, seg) || strings.Contains(p, seg+"/") || strings.Contains(p, "/admin/") {
			return true
		}
	}
	return strings.HasSuffix(p, "/admin")
}

// ModuleFor resolves the registry key that owns path p, or "" when no entry matches
// (which the caller must treat as "allow").
func ModuleFor(p string) string {
	best, bestLen := "", -1
	for _, r := range routes {
		if !strings.HasPrefix(p, r.prefix) {
			continue
		}
		// Require a boundary so "/api/finance/wallets-x" cannot match "/api/finance/wallet".
		rest := p[len(r.prefix):]
		if rest != "" && rest[0] != '/' && rest[0] != '?' {
			continue
		}
		if len(r.prefix) > bestLen {
			best, bestLen = r.moduleKey, len(r.prefix)
		}
	}
	return best
}
