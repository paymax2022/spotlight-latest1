package navigation

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
)

const (
	maxBatch     = 50
	maxBodyBytes = 64 << 10
)

// Inserter is satisfied by *Repository.
type Inserter interface {
	Insert(ctx context.Context, events []Event) (int, error)
}

// Handler serves the navigation ingest endpoint.
type Handler struct{ repo Inserter }

func NewHandler(repo Inserter) *Handler { return &Handler{repo: repo} }

type ingestEvent struct {
	Surface    string    `json:"surface"`
	Route      string    `json:"route"`
	OccurredAt time.Time `json:"occurred_at"`
}

type ingestRequest struct {
	Events []ingestEvent `json:"events"`
}

// Ingest handles POST /api/v1/telemetry/navigation. The user id is taken from
// the auth token only; invalid events are dropped, survivors stored.
func (h *Handler) Ingest(c *gin.Context) {
	uid := ginutil.UserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "error": "unauthorized"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBodyBytes)
	var req ingestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid body"})
		return
	}
	if len(req.Events) == 0 || len(req.Events) > maxBatch {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "events must contain 1 to 50 items"})
		return
	}
	now := time.Now()
	keep := make([]Event, 0, len(req.Events))
	for _, e := range req.Events {
		route, ok := CleanRoute(e.Route)
		if !ok || !validSurface(e.Surface) || !validTime(e.OccurredAt, now) {
			continue
		}
		keep = append(keep, Event{UserID: uid, Surface: e.Surface, Route: route, OccurredAt: e.OccurredAt.UTC()})
	}
	n := 0
	if len(keep) > 0 {
		var err error
		if n, err = h.repo.Insert(c.Request.Context(), keep); err != nil {
			log.Printf("[navtel] insert failed: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not record events"})
			return
		}
	}
	c.JSON(http.StatusAccepted, gin.H{"accepted": n})
}
