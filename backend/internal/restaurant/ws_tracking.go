package restaurant

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
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

// ws_ticket.go — validates the short-lived, HMAC-signed WebSocket ticket minted by
// frontend-web (src/lib/restaurant/ws-ticket.ts) for live order tracking.
// WHY: browser/RN WebSocket clients cannot reliably set an Authorization header
// across a proxy hop, so the food app authenticates over HTTP, receives a signed
// ticket, and connects directly to this backend's WS endpoint with `?ticket=`.
// The ws route is therefore mounted WITHOUT the Bearer-required middleware and is
// authenticated solely by this ticket (the handler still enforces order
// participation as defense-in-depth).
// Scheme (must match the JS minter byte-for-byte):
//   payload = {"sub","order_id","exp","nonce"}              (JSON)
//   encoded = base64url(payload)                            (no padding)
//   sig     = base64url(HMAC_SHA256(encoded, secret))       (no padding)
// Secret comes from WS_TICKET_SIGNING_SECRET (fail-closed if unset).

// WSScopeUser is the reserved `order_id` marking a ticket that authenticates a
// USER-scoped socket rather than one bound to a single order (ADR-049).
// Safe as a sentinel because every real order id is a UUID, so it can never
// collide, and validateWSTicket compares order_id for exact equality — an
// order ticket therefore cannot be replayed on the user socket, nor the reverse.
// The two scopes are separated by construction, not by convention.
const WSScopeUser = "*"

type wsTicketPayload struct {
	Sub     string `json:"sub"`
	OrderID string `json:"order_id"`
	Exp     int64  `json:"exp"`
	Nonce   string `json:"nonce"`
}

// validateWSTicket returns the authenticated user id when the ticket is valid,
// unexpired, and bound to orderID. It fails closed on any error or missing secret.
func validateWSTicket(ticket, orderID string) (string, bool) {
	secret := os.Getenv("WS_TICKET_SIGNING_SECRET")
	if secret == "" || ticket == "" {
		return "", false
	}
	parts := strings.SplitN(ticket, ".", 2)
	if len(parts) != 2 {
		return "", false
	}
	encoded, sig := parts[0], parts[1]

	// Recompute the HMAC over the encoded payload and constant-time compare.
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(encoded))
	want := mac.Sum(nil)
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(want, got) {
		return "", false
	}

	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return "", false
	}
	var p wsTicketPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", false
	}
	if p.Sub == "" || p.OrderID != orderID {
		return "", false
	}
	if time.Now().Unix() >= p.Exp {
		return "", false // expired
	}
	return p.Sub, true
}
