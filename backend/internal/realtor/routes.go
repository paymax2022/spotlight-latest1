package realtor

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// RealtorManagePermission is the RBAC slug required to reach the realtor admin
// control plane. Grant it to Property-Ops / Trust-&-Safety / Finance / Super-Admin
// roles via the RBAC UI (seeded for super-admin by migration
// 20260621060000_realtor_admin_rbac.sql).
const RealtorManagePermission = "realtor.manage"

// Deps carries the collaborators needed to wire the realtor admin control plane.
type Deps struct {
	DB       *pgxpool.Pool
	Supabase *integrations.SupabaseRestClient
	RBAC     services.RBACService
	Enabled  bool // FEATURE_REALTOR_ENABLED
}

// Register mounts the realtor admin control-plane routes under /api/realtor/admin.
// The mobile/marketplace data plane is served directly from Supabase + RPCs; this
// module only exposes the admin control plane (overview, moderation, verification,
// payments, escrow). RBAC-gated and audited.
func Register(r *gin.Engine, d Deps) {
	if !d.Enabled {
		log.Println("[realtor] FEATURE_REALTOR_ENABLED is false — skipping admin routes")
		return
	}
	if d.DB == nil {
		log.Println("[realtor] no database pool — skipping admin routes")
		return
	}

	repo := NewRepository(d.DB)
	ah := NewAdminHandler(repo)

	// authn maps the authenticated user's id into the gin context key handlers
	// read (matches the finance/invest modules' user_id convention).
	authn := func() gin.HandlerFunc {
		// RequireAuthContext validates the token and sets user_id/user_email before
		// it calls c.Next(); handlers read those directly, so no post-base mirror.
		return middleware.RequireAuthContext(d.Supabase, d.RBAC)
	}

	// ── Admin control plane ──────────────────────────────────────────────────
	// RBAC-gated: requires the `realtor.manage` permission (fail-closed). Every
	// mutation is written to realtor_admin_audit_log by the handlers.
	admin := r.Group("/api/realtor/admin")
	admin.Use(authn())
	admin.Use(middleware.RequirePermission(d.RBAC, RealtorManagePermission))
	{
		admin.GET("/overview", ah.Overview)
		admin.GET("/listings/pending", ah.PendingListings)
		admin.POST("/listings/:id/decision", ah.DecideListing)
		admin.GET("/verifications", ah.PendingVerifications)
		admin.POST("/verifications/:id/decision", ah.DecideVerification)
		admin.GET("/payments", ah.Payments)
		admin.GET("/escrow", ah.Escrow)
	}

	log.Println("[realtor] admin control plane registered at /api/realtor/admin")
}
