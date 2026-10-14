package app

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/telemetry/navigation"
)

type navLister interface {
	ListRecentByUser(ctx context.Context, userID string, limit int) ([]navigation.Event, error)
}

// AdminUserNavigationHandler serves GET /api/admin/users/:id/navigation. The
// response is built explicitly so the user id is never exposed.
func AdminUserNavigationHandler(repo navLister) gin.HandlerFunc {
	return func(c *gin.Context) {
		evs, err := repo.ListRecentByUser(c.Request.Context(), c.Param("id"), 100)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		out := make([]gin.H, 0, len(evs))
		for _, e := range evs {
			out = append(out, gin.H{
				"surface":     e.Surface,
				"route":       e.Route,
				"occurred_at": e.OccurredAt.UTC().Format(time.RFC3339),
			})
		}
		c.JSON(http.StatusOK, gin.H{"events": out})
	}
}
