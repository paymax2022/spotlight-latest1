package embedded

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Handler exposes an internal/member route for exercising the embedded engine
// (testing + manual triggers). In production the engine is driven by Handle()
// called from existing platform emit points, not by this route.
type Handler struct {
	svc *Service
}

// NewHandler constructs the embedded handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Trigger (member/internal): POST /embedded/events
// body: {source_event_id, event_type, user_id?, sum_insured_kobo?, inputs?}
// For the member-authenticated variant the caller's user_id is used unless an
// admin override is supplied.
func (h *Handler) Trigger(c *gin.Context) {
	var body struct {
		SourceEventID  string         `json:"source_event_id" binding:"required"`
		EventType      string         `json:"event_type" binding:"required"`
		UserID         string         `json:"user_id"`
		SumInsuredKobo int64          `json:"sum_insured_kobo"`
		Inputs         map[string]any `json:"inputs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uid := body.UserID
	if uid == "" {
		uid = c.GetString("user_id")
	}
	if uid == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id required"})
		return
	}
	res, err := h.svc.Handle(c.Request.Context(), EmbeddedEvent{
		SourceEventID:  body.SourceEventID,
		EventType:      body.EventType,
		UserID:         uid,
		SumInsuredKobo: body.SumInsuredKobo,
		Inputs:         body.Inputs,
	})
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// KnownEvents (member/internal): GET /embedded/events — lists the mapped event
// types (discovery for clients/tests).
func (h *Handler) KnownEvents(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"events": knownEvents(), "as_of": time.Now().UTC()}})
}
