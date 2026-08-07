package offlinesync

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
)

// Handler exposes the offline-sync ingest endpoint over Gin. Member self-service:
// the event is always scoped to the authenticated caller's user id (never a client-
// supplied id), so no extra RBAC is required beyond authentication.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// uid resolves the authenticated learner (mirrors the assessment/progression packages).
func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

// RegisterAcademySync wires POST /sync onto the academy member group. The member base
// is /api/finance/academy (finance.Group("/academy") in RegisterAcademy), so the route
// resolves to POST /api/finance/academy/sync — exactly the path the mobile offlineQueue
// flushes to (ACADEMY_API_BASE + "/sync"). Thin ingest only; NO money path.
func RegisterAcademySync(member *gin.RouterGroup, pool *pgxpool.Pool) {
	if member == nil || pool == nil {
		return
	}
	h := NewHandler(NewService(pool))
	member.POST("/sync", h.Sync)
}

// Sync ingests one queued offline event (the mobile client posts a single flat event
// per request) or a batch ({"events":[...]}). It responds 200 with a per-event result
// so the client can clear its queue deterministically — both "acked" and "duplicate"
// are acknowledgements. Retries are safe because each event carries a stable idempotency
// key (clientEventId, or the Idempotency-Key header).
func (h *Handler) Sync(c *gin.Context) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}

	req, err := parseSyncBody(body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}

	out, err := h.svc.Sync(c.Request.Context(), u, c.GetHeader("Idempotency-Key"), req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// parseSyncBody normalises EITHER a batch envelope ({"events":[...]}) OR a single flat
// event ({"clientEventId":...,"kind":...}) into a SyncRequest. The mobile offlineQueue
// posts the single flat form (pushEvent); the batch form is accepted for completeness.
func parseSyncBody(body []byte) (SyncRequest, error) {
	var req SyncRequest
	if len(body) == 0 {
		return req, errors.New("empty body")
	}
	// Batch form: an explicit "events" key (even if empty) selects the envelope.
	var probe struct {
		Events *[]InboundEvent `json:"events"`
	}
	if err := json.Unmarshal(body, &probe); err == nil && probe.Events != nil {
		req.Events = *probe.Events
		return req, nil
	}
	// Single flat event.
	var one InboundEvent
	if err := json.Unmarshal(body, &one); err != nil {
		return req, err
	}
	if one.ClientEventID == "" && one.Kind == "" && one.Type == "" {
		return req, errors.New("no events")
	}
	req.Events = []InboundEvent{one}
	return req, nil
}
