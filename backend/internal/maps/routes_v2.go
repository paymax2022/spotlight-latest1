package maps

import (
	"context"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/scheduler"
)

// routes_v2.go — startup wiring + admin surface for MapService v2 (MAPSERVICE.md
// §5/§7/§10). Additive; only runs when v2 is enabled.

// RegisterMapsV2Background seeds the Lagos coverage tiers and registers the OSM
// contribution batch job handler. Best-effort: failures are logged, never fatal.
func RegisterMapsV2Background(svc *Service, pool *pgxpool.Pool) {
	if pool == nil {
		return
	}
	// Seed coverage tiers for Lagos H3 cells (idempotent).
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := NewCoverage(pool).SeedLagos(ctx); err != nil {
			log.Printf("[maps] coverage seed (Lagos) failed: %v", err)
		}
	}()

	// Register the OSM contribution batch handler (moderated, scheduler-driven).
	sched := scheduler.NewService(pool)
	pipeline := NewOSMPipeline(NewContributionService(pool), NoopOSMUploader{})
	RegisterContributionJob(sched, pipeline)
	log.Println("[maps] v2 background wired (coverage seed + OSM contribution job registered)")
}

// mapsV2Admin holds the read/review collaborators for the admin dashboard.
type mapsV2Admin struct {
	rec     *Recorder
	guard   *Guard
	contrib *ContributionService
	cov     *Coverage
}

// RegisterMapsV2Admin mounts the cost/coverage/provider-health dashboard +
// OSM contribution review under /api/maps/admin, gated by RBAC (map.admin.review).
// auth sets user_id; perm enforces the permission (built by the caller).
func RegisterMapsV2Admin(r *gin.Engine, pool *pgxpool.Pool, auth, perm gin.HandlerFunc) {
	if pool == nil {
		return
	}
	a := &mapsV2Admin{
		rec:     NewRecorder(pool),
		guard:   NewGuard(pool, nil),
		contrib: NewContributionService(pool),
		cov:     NewCoverage(pool),
	}
	grp := r.Group("/api/maps/admin")
	if auth != nil {
		grp.Use(auth)
	}
	if perm != nil {
		grp.Use(perm)
	}
	grp.GET("/dashboard", a.dashboard)
	grp.GET("/events", a.events)
	grp.GET("/providers", a.providers)
	grp.GET("/contributions", a.listContributions)
	grp.POST("/contributions/:id/review", a.reviewContribution)
	log.Println("[maps] v2 admin dashboard registered at /api/maps/admin (map.admin.review)")
}

func (a *mapsV2Admin) sinceParam(c *gin.Context) time.Time {
	days := 7
	if v := c.Query("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 365 {
			days = n
		}
	}
	return time.Now().AddDate(0, 0, -days)
}

// dashboard returns paid-vs-deflected rollups + provider health (MS-7).
func (a *mapsV2Admin) dashboard(c *gin.Context) {
	stats, err := a.rec.DeflectionStats(c.Request.Context(), a.sinceParam(c))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	health, _ := a.guard.Snapshot(c.Request.Context())
	c.JSON(http.StatusOK, gin.H{"deflection": stats, "deflection_rate": stats.DeflectionRate(), "providers": health})
}

func (a *mapsV2Admin) events(c *gin.Context) {
	limit := 100
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	evs, err := a.rec.RecentEvents(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"events": evs})
}

func (a *mapsV2Admin) providers(c *gin.Context) {
	health, err := a.guard.Snapshot(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"providers": health})
}

func (a *mapsV2Admin) listContributions(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")
	rows, err := a.contrib.ListForReview(c.Request.Context(), status, 200)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"candidates": rows})
}

func (a *mapsV2Admin) reviewContribution(c *gin.Context) {
	var body struct {
		Action string `json:"action" binding:"required"` // approve | reject
		Notes  string `json:"notes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	out, err := a.contrib.Review(c.Request.Context(), c.Param("id"), c.GetString("user_id"), body.Action, body.Notes)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, out)
}
