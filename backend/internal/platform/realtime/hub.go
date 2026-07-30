// Package realtime provides a lightweight server-push layer (Server-Sent Events)
// for live features like marketplace chat. It fans an event out to every device a
// user has connected — across ALL backend instances — via Redis pub/sub, degrading
// to a single-instance in-process hub when Redis is unavailable.
//
// Design:
//   - Each SSE connection Subscribe()s and gets a buffered channel.
//   - PublishToUser() publishes to Redis channel "rt:user:<uid>"; every instance's
//     PSubscribe loop receives it and delivers to its locally-connected channels.
//     (The publishing instance also receives its own message via the loop, so we do
//     NOT deliver locally on publish when Redis is wired — avoids double delivery.)
//   - With no Redis, PublishToUser delivers in-process directly.
//
// This is transport-only: it never persists anything. The durable record (messages)
// lives in Postgres; realtime is a best-effort accelerator on top of it, so a missed
// push is harmless — the client still polls/refetches as a fallback.
package realtime

import (
	"context"
	"encoding/json"
	"strings"
	"sync"

	goredis "github.com/redis/go-redis/v9"
)

const channelPrefix = "rt:user:"

// Event is a single server-push payload. Data is a pre-marshalled JSON document.
type Event struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// Hub tracks per-user SSE subscribers and fans events out. Safe for concurrent use.
type Hub struct {
	rdb  *goredis.Client
	mu   sync.RWMutex
	subs map[string]map[chan Event]struct{} // userID → set of subscriber channels
}

// NewHub builds a hub. When rdb is non-nil it starts a background PSubscribe loop
// for cross-instance fan-out; when nil the hub is single-instance (in-process only).
func NewHub(rdb *goredis.Client) *Hub {
	h := &Hub{rdb: rdb, subs: make(map[string]map[chan Event]struct{})}
	if rdb != nil {
		go h.runRedis()
	}
	return h
}

// runRedis consumes Redis pub/sub and delivers to local subscribers. It reconnects
// implicitly via go-redis' PubSub channel semantics; a fatal close ends the loop
// (process restart re-establishes it).
func (h *Hub) runRedis() {
	ps := h.rdb.PSubscribe(context.Background(), channelPrefix+"*")
	defer ps.Close()
	for msg := range ps.Channel() {
		userID := strings.TrimPrefix(msg.Channel, channelPrefix)
		var ev Event
		if err := json.Unmarshal([]byte(msg.Payload), &ev); err != nil {
			continue
		}
		h.deliverLocal(userID, ev)
	}
}

// deliverLocal pushes an event to the user's locally-connected channels. Slow or
// full consumers are skipped (non-blocking send) so one stuck client can't stall
// the hub — that client simply misses the push and recovers on its next poll.
func (h *Hub) deliverLocal(userID string, ev Event) {
	h.mu.RLock()
	set := h.subs[userID]
	targets := make([]chan Event, 0, len(set))
	for ch := range set {
		targets = append(targets, ch)
	}
	h.mu.RUnlock()
	for _, ch := range targets {
		select {
		case ch <- ev:
		default:
		}
	}
}

// Subscribe registers a per-connection channel for userID and returns it plus an
// idempotent unsubscribe. The caller MUST call unsubscribe when the connection ends.
func (h *Hub) Subscribe(userID string) (<-chan Event, func()) {
	ch := make(chan Event, 16)
	h.mu.Lock()
	if h.subs[userID] == nil {
		h.subs[userID] = make(map[chan Event]struct{})
	}
	h.subs[userID][ch] = struct{}{}
	h.mu.Unlock()

	var once sync.Once
	return ch, func() {
		once.Do(func() {
			h.mu.Lock()
			if set := h.subs[userID]; set != nil {
				delete(set, ch)
				if len(set) == 0 {
					delete(h.subs, userID)
				}
			}
			h.mu.Unlock()
			close(ch)
		})
	}
}

// PublishToUser fans an event to every device userID has connected, across all
// instances (via Redis) or in-process when Redis is nil. eventType is the SSE event
// name; payload is JSON-marshalled into Event.Data. Best-effort — errors are
// returned but callers typically ignore them (the durable store is the source of truth).
func (h *Hub) PublishToUser(ctx context.Context, userID, eventType string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	ev := Event{Type: eventType, Data: data}
	if h.rdb != nil {
		buf, merr := json.Marshal(ev)
		if merr != nil {
			return merr
		}
		return h.rdb.Publish(ctx, channelPrefix+userID, buf).Err()
	}
	h.deliverLocal(userID, ev)
	return nil
}
