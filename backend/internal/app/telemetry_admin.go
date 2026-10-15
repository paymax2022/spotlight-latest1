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

type navAggregator interface {
	AggregateNavigation(ctx context.Context, f navigation.AnalyticsFilter) (*navigation.NavAnalytics, error)
}

// AdminNavigationAnalyticsHandler serves GET /api/admin/analytics/navigation.
// Invalid range/surface values coerce to defaults; the payload is built
// explicitly and carries no user ids.
func AdminNavigationAnalyticsHandler(repo navAggregator) gin.HandlerFunc {
	return func(c *gin.Context) {
		rng := c.DefaultQuery("range", "30d")
		if rng != "7d" && rng != "30d" && rng != "90d" {
			rng = "30d"
		}
		surface := c.DefaultQuery("surface", "all")
		if surface != "all" && surface != "mobile" && surface != "web" {
			surface = "all"
		}
		a, err := repo.AggregateNavigation(c.Request.Context(), navigation.AnalyticsFilter{
			Range: rng, Surface: surface, Search: c.Query("search"),
		})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		top := make([]gin.H, 0, len(a.TopScreens))
		for _, s := range a.TopScreens {
			top = append(top, gin.H{"route": s.Route, "views": s.Views, "users": s.Users})
		}
		ts := make([]gin.H, 0, len(a.Timeseries))
		for _, b := range a.Timeseries {
			ts = append(ts, gin.H{"day": b.Day, "mobile": b.Mobile, "web": b.Web, "total": b.Total})
		}
		c.JSON(http.StatusOK, gin.H{
			"range":      rng,
			"surface":    surface,
			"topScreens": top,
			"timeseries": ts,
			"surfaceSplit": gin.H{
				"mobile": a.SurfaceSplit.Mobile, "web": a.SurfaceSplit.Web, "total": a.SurfaceSplit.Total,
			},
		})
	}
}
