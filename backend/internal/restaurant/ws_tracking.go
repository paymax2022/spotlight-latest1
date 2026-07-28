package restaurant

import (
	"context"
	"encoding/json"
	"time"

	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/platform/ws"
)

// fanoutChannel carries order events between backend instances so a customer
// connected to instance B receives updates from a rider/restaurant on instance A.
const fanoutChannel = "ws:restaurant:order:fanout"

// Realtime fans order events (status changes, rider location, chat messages) out
// to an order's three participants over the shared WebSocket hub. The hub is
// keyed by userID; Realtime resolves the order's participants and pushes to each.
// With Redis it publishes once and every instance delivers to its local clients
// (avoids double-delivery), mirroring transport.TripTracker.
type Realtime struct {
	parties func(ctx context.Context, orderID string) (customer, owner, rider string, err error)
	hub     *ws.Hub
	redis   *platformRedis.Client // optional; nil → in-process fan-out only
}

// LocationUpdate is the rider position pushed to an order's participants.
type LocationUpdate struct {
	OrderID string  `json:"order_id"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	TS      int64   `json:"ts"`
}

// NewRealtime builds the fan-out. partiesFn resolves an order's participants
// (use Service.orderParties). redis may be nil.
func NewRealtime(hub *ws.Hub, redis *platformRedis.Client, partiesFn func(ctx context.Context, orderID string) (string, string, string, error)) *Realtime {
	return &Realtime{hub: hub, redis: redis, parties: partiesFn}
}

// Start launches the cross-instance fan-out subscriber (no-op without Redis).
func (r *Realtime) Start(ctx context.Context) {
	if r == nil || r.redis == nil {
		return
	}
	go r.subscribeLoop(ctx)
}

// recipients resolves the live participant user-ids for an order.
func (r *Realtime) recipients(ctx context.Context, orderID string) []string {
	if r == nil || r.parties == nil {
		return nil
	}
	customer, owner, rider, err := r.parties(ctx, orderID)
	if err != nil {
		return nil
	}
	out := make([]string, 0, 3)
	for _, uid := range []string{customer, owner, rider} {
		if uid != "" {
			out = append(out, uid)
		}
	}
	return out
}

// publish fans a message out to an order's participants.
func (r *Realtime) publish(ctx context.Context, orderID string, msg ws.Message) {
	if r == nil || r.hub == nil {
		return
	}
	recips := r.recipients(ctx, orderID)
	if len(recips) == 0 {
		return
	}
	if r.redis != nil {
		if b, err := json.Marshal(fanoutEnvelope{Recipients: recips, Message: msg}); err == nil {
			_ = r.redis.Publish(ctx, fanoutChannel, b).Err()
			return
		}
	}
	for _, uid := range recips {
		r.hub.SendToUser(uid, msg)
	}
}

type fanoutEnvelope struct {
	Recipients []string   `json:"recipients"`
	Message    ws.Message `json:"message"`
}

func (r *Realtime) subscribeLoop(ctx context.Context) {
	sub := r.redis.Subscribe(ctx, fanoutChannel)
	defer func() { _ = sub.Close() }()
	for msg := range sub.Channel() {
		var env fanoutEnvelope
		if err := json.Unmarshal([]byte(msg.Payload), &env); err != nil {
			continue
		}
		for _, uid := range env.Recipients {
			r.hub.SendToUser(uid, env.Message) // delivers only to locally-connected clients
		}
	}
}

// ── Service convenience broadcasters (nil-safe when no Realtime is attached) ──

func (s *Service) broadcastStatus(orderID string, status OrderStatus) {
	if s.rt == nil {
		return
	}
	s.rt.publish(context.Background(), orderID, ws.Message{
		Type:    "order.status",
		Payload: map[string]any{"order_id": orderID, "status": status, "ts": time.Now().UnixMilli()},
	})
}

func (s *Service) broadcastLocation(orderID string, lat, lng float64) {
	if s.rt == nil {
		return
	}
	s.rt.publish(context.Background(), orderID, ws.Message{
		Type:    "order.location",
		Payload: LocationUpdate{OrderID: orderID, Lat: lat, Lng: lng, TS: time.Now().UnixMilli()},
	})
}

func (s *Service) broadcastMessage(orderID string, m *OrderMessage) {
	if s.rt == nil {
		return
	}
	s.rt.publish(context.Background(), orderID, ws.Message{Type: "order.message", Payload: m})
}
