package handlers

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/platform/buildinfo"
)

type HealthHandler struct {
	pool *pgxpool.Pool
}

func NewHealthHandler() *HealthHandler { return &HealthHandler{} }

// WithPool supplies the shared DB pool for the readiness probe. The pool is
// created late in router construction, after /healthz-worthy liveness routes
// are registered, so it arrives via a setter rather than the constructor.
func (h *HealthHandler) WithPool(pool *pgxpool.Pool) *HealthHandler {
	h.pool = pool
	return h
}

func (h *HealthHandler) PublicHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "service": "backend", "status": "ok"})
}

// Ready is the readiness probe backing /readyz. Distinct from liveness: the
// process must also be able to serve DB-backed traffic. A nil pool (dev/test
// boots without DATABASE_URL) reports not-ready — on deployed tiers a failed
// pool is fatal at boot anyway, so this state is only reachable locally.
func (h *HealthHandler) Ready(c *gin.Context) {
	if h.pool == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "status": "not_ready", "reason": "database pool not configured"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := h.pool.Ping(ctx); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "status": "not_ready", "reason": "database ping failed"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "status": "ready"})
}

func (h *HealthHandler) GenericHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Build reports which commit this process is serving.
//
// PublicHealth cannot answer that: its body is a fixed string, byte-identical on
// every build, so probing it before and after a deploy proves nothing. Verifying
// a deploy therefore meant trusting CI job conclusions and the platform's own
// status — never an observation of the running binary. This endpoint makes the
// server say it itself, in one unauthenticated request.
//
// Deliberately exposes ONLY build identity: commit, branch, dirty flag, process
// start time. No config, no environment, no versions of anything else — this is
// internet-facing and unauthenticated, and a commit SHA of a private repo is not
// a secret, whereas a dependency inventory would hand an attacker a target list.
//
// Reports commit "" with source "unknown" rather than inventing a value when
// nothing supplied one. A wrong commit here would be worse than a missing one:
// it would be believed, and the next person would verify a deploy against a lie.
func (h *HealthHandler) Build(c *gin.Context) {
	dir, err := os.Getwd()
	if err != nil {
		dir = "."
	}
	c.JSON(http.StatusOK, buildinfo.CurrentRelease(c.Request.Context(), dir))
}
