package app

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/academy/platform"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// academy_platform_routes.go — Paymax × Spotlight EdTech PLATFORM super-admin.
//
// WHY THIS FILE EXISTS
// The /admin/platform/edtech console (frontend-admin, 12 screens SU-01..SU-12) calls
// /api/academy/admin/platform/* — an endpoint group that did not exist. Every school
// role (school_owner / bursar / class_teacher / head_teacher) authorizes against a
// PER-SCHOOL membership; a Paymax platform operator is not a member of any school, so
// this NEW group is authorized PURELY by the seeded platform capability
// `platform_edtech_admin` (migration 20260918000100), mirroring how
// estate_admin_routes.go exposes a platform-oversight surface over per-tenant data.
//
// SCOPE — READ + LIGHT OVERSIGHT ONLY. Nothing here posts a ledger entry or moves
// money. The two write endpoints ride EXISTING guarded, money-free paths:
//   - POST /schools/:id/verify           → advances academy_schools.verification_tier
//   - POST /trust-scores/:schoolId/override → appends academy_fees_trust_overrides
// Both touch money-free tables only; every SF/idempotency money invariant stays in
// the fees money-path. Cross-tenant reads are authorized by platform RBAC alone.
//
// ROUTING — mounted at /api/academy/admin/platform on the engine (the same admin
// prefix the fees admin packages use), NOT under /api/finance, because the console's
// base() resolves to /api/academy/admin/platform. RequireAuthContext is applied so
// the per-route RequirePermission guard sees an authenticated user (RequirePermission
// reads GetAuthenticatedUser, which only RequireAuthContext populates).
//
// AUTH — every route carries middleware.RequirePermission(rbac, "platform_edtech_admin").
// The slug MUST match the seeded permission verbatim or it fails closed.

// RegisterAcademyPlatform wires the read-only EdTech platform oversight surface onto
// the engine. Call from finance_routes.go inside the academy fees feature-flag block.
// authMW is the shared RequireAuthContext handler (so RequirePermission has a user in
// context). Pool must be non-nil (all reads use pgx); when nil we skip.
func RegisterAcademyPlatform(
	r *gin.Engine,
	pool *pgxpool.Pool,
	rbac services.RBACService,
	authMW gin.HandlerFunc,
) {
	if pool == nil {
		log.Println("[academy-platform] nil pool — skipping EdTech platform oversight routes")
		return
	}
	h := platform.NewHandler(platform.NewRepo(pool))

	guard := middleware.RequirePermission(rbac, "platform_edtech_admin")

	g := r.Group("/api/academy/admin/platform")
	if authMW != nil {
		g.Use(authMW) // populate GetAuthenticatedUser for the RBAC guard
	}
	g.Use(guard) // every route is platform_edtech_admin-gated (group-level, applied to all)

	// SU-01 — Platform School Directory
	g.GET("/schools", h.ListSchools)
	// SU-02 — Verification Queue (+ advance tier)
	g.GET("/verification-queue", h.ListVerificationQueue)
	g.POST("/schools/:id/verify", h.VerifySchool)
	// Console client's live review route (platformEdtechAdminService.reviewVerification):
	// POST /verification-queue/:id/review, :id = school id in the derived queue.
	g.POST("/verification-queue/:id/review", h.VerifySchool)
	// SU-03 — Platform-Wide Collections
	g.GET("/collections", h.Collections)
	// SU-04 — Fraud & Risk (best-effort heuristic reads)
	g.GET("/risk", h.ListRisk)
	// SU-05 — Gov/Regulator sync + SF-11 compliance-export log
	g.GET("/gov-sync", h.ListGovSync)
	g.GET("/compliance-exports", h.ListComplianceExports)
	// SU-06 — Competition ops (real table academy_competitions)
	g.GET("/competitions", h.ListCompetitions)
	// SU-07 — Trust scores (+ override → academy_fees_trust_overrides)
	g.GET("/trust-scores", h.ListTrustScores)
	g.POST("/trust-scores/:schoolId/override", h.OverrideTrustScore)
	// SU-08 — Scholarship / sponsor fund-flow audit
	g.GET("/scholarship-pledges", h.ListScholarships)
	// SU-09 — Support tickets (no backing table → documented empty)
	g.GET("/support-tickets", h.ListSupportTickets)
	// SU-10 — Feature flags (no override store → documented placeholder + no-op toggle)
	g.GET("/flags", h.ListFlags)
	g.POST("/flags/toggle", h.ToggleFlag)
	g.PUT("/flags", h.ToggleFlag)
	// SU-11 — Audit log viewer (academy_commerce_audit)
	g.GET("/audit-log", h.SearchAudit)
	// SU-12 — Compliance posture (Model-A drift check)
	g.GET("/compliance-posture", h.CompliancePosture)

	log.Println("[academy-platform] EdTech platform oversight routes registered — SU-01..SU-12 (read-only, platform_edtech_admin RBAC)")
}
