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

type funnelRepo interface {
	FunnelStepEvents(ctx context.Context, steps []string, f navigation.AnalyticsFilter) ([]navigation.StepEvent, error)
}

type funnelRequest struct {
	Steps      []string `json:"steps"`
	Range      string   `json:"range"`
	Surface    string   `json:"surface"`
	GapMinutes int      `json:"gapMinutes"`
}

// AdminNavigationFunnelHandler serves POST /api/admin/analytics/navigation/funnel.
// steps must hold 2-10 non-empty routes (<=256 chars). Invalid range/surface
// coerce to defaults; gapMinutes defaults to 30 and clamps to [1,1440]. The
// payload is built explicitly and carries no user ids.
func AdminNavigationFunnelHandler(repo funnelRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req funnelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		if len(req.Steps) < 2 || len(req.Steps) > 10 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "steps must contain 2 to 10 routes"})
			return
		}
		for _, s := range req.Steps {
			if s == "" || len(s) > 256 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "each step must be a non-empty route up to 256 characters"})
				return
			}
		}
		rng := req.Range
		if rng != "7d" && rng != "30d" && rng != "90d" {
			rng = "30d"
		}
		surface := req.Surface
		if surface != "all" && surface != "mobile" && surface != "web" {
			surface = "all"
		}
		gapMin := req.GapMinutes
		switch {
		case gapMin == 0:
			gapMin = 30
		case gapMin < 1:
			gapMin = 1
		case gapMin > 1440:
			gapMin = 1440
		}
		evs, err := repo.FunnelStepEvents(c.Request.Context(), req.Steps, navigation.AnalyticsFilter{Range: rng, Surface: surface})
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
			return
		}
		counts := navigation.ComputeFunnel(evs, req.Steps, time.Duration(gapMin)*time.Minute)
		steps := make([]gin.H, 0, len(req.Steps))
		for i, route := range req.Steps {
			steps = append(steps, gin.H{"route": route, "users": counts[i]})
		}
		c.JSON(http.StatusOK, gin.H{
			"range":      rng,
			"surface":    surface,
			"gapMinutes": gapMin,
			"steps":      steps,
		})
	}
}
