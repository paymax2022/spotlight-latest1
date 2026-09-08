package handlers

import (
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/platform/buildinfo"
)

type HealthHandler struct{}

func NewHealthHandler() *HealthHandler { return &HealthHandler{} }

func (h *HealthHandler) PublicHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "service": "backend", "status": "ok"})
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
