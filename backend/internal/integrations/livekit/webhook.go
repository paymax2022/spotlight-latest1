package livekit

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/webhook"
)

// maxWebhookBytes bounds a webhook body; LiveKit events are small.
const maxWebhookBytes = 1 << 20

// Event is the part of a LiveKit webhook the platform acts on.
type Event struct {
	ID       string
	Type     string // room_started, room_finished, participant_joined, participant_left, track_published ...
	Room     string
	Identity string
	At       time.Time
}

// ParseWebhook verifies a LiveKit webhook (a JWT signed with the API secret over the body's
// SHA-256) and returns the event. Anything unsigned, forged or altered is ErrBadWebhook.
func (c *Client) ParseWebhook(r *http.Request) (Event, error) {
	r.Body = http.MaxBytesReader(nil, r.Body, maxWebhookBytes)
	ev, err := webhook.ReceiveWebhookEvent(r, auth.NewSimpleKeyProvider(c.cfg.APIKey, c.cfg.APISecret))
	if err != nil {
		return Event{}, fmt.Errorf("%w: %v", ErrBadWebhook, err)
	}
	return Event{
		ID:       ev.GetId(),
		Type:     ev.GetEvent(),
		Room:     ev.GetRoom().GetName(),
		Identity: ev.GetParticipant().GetIdentity(),
		At:       time.Unix(ev.GetCreatedAt(), 0).UTC(),
	}, nil
}

// WebhookHandler serves LiveKit's webhook endpoint. 401 for anything not signed by this
// server's credentials; 500 if the consumer fails, so LiveKit retries the delivery; 200
// otherwise. on may be nil (events are acknowledged and dropped).
func (c *Client) WebhookHandler(on func(context.Context, Event) error) gin.HandlerFunc {
	return func(g *gin.Context) {
		ev, err := c.ParseWebhook(g.Request)
		if err != nil {
			g.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "error": "invalid_webhook"})
			return
		}
		if on != nil {
			if err := on(g.Request.Context(), ev); err != nil {
				g.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"success": false, "error": "webhook_processing_failed"})
				return
			}
		}
		g.JSON(http.StatusOK, gin.H{"success": true})
	}
}
