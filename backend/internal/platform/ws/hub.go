package ws

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"nhooyr.io/websocket"
)

// Message is the envelope sent over WebSocket connections.
type Message struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
}

// client represents one connected WebSocket client.
type client struct {
	conn   *websocket.Conn
	userID string
	send   chan []byte
	done   chan struct{}
}

// Hub manages all active WebSocket connections.
// Fan-out is done via Redis pub/sub in a multi-instance deployment; for MVP
// this in-process hub is used directly.
type Hub struct {
	mu            sync.RWMutex
	clients       map[string][]*client // userID → clients
	originAllowed func(origin string) bool
}

// New creates a new Hub. originAllowed reports whether a browser-sent Origin
// header is trusted; pass nil to allow every origin (only appropriate for a
// hub no browser client ever reaches).
//
// nhooyr's default Origin check only accepts an Origin that is byte-identical
// to the request's own Host — i.e. "the frontend page and this WS endpoint are
// the exact same origin". That is never true here: the browser/RN-web client
// always lives on a different port (dev: :8083 vs :8091) or a different
// subdomain entirely (staging/prod: frontend-web-* vs backend-*). Left on the
// default, EVERY real browser WebSocket connection 403s at the handshake while
// curl (which sends no Origin header) succeeds — the split that made this look
// like a client bug rather than a server one. originAllowed lets callers reuse
// the same allowlist as the HTTP CORS middleware (CORS_ALLOW_ORIGINS + the
// dev-only loopback/LAN patterns) instead.
func New(originAllowed func(origin string) bool) *Hub {
	return &Hub{clients: make(map[string][]*client), originAllowed: originAllowed}
}

// ServeHTTP upgrades the HTTP request to a WebSocket and registers the client.
// userID must be extracted from the JWT by the caller before invoking this.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request, userID string) error {
	origin := r.Header.Get("Origin")
	// A missing Origin means a non-browser client (native app, curl) that
	// browser same-origin enforcement never applied to in the first place —
	// this endpoint's real auth boundary is the ticket/JWT the caller already
	// validated, not Origin. Only a PRESENT, disallowed Origin is rejected.
	if origin != "" && h.originAllowed != nil && !h.originAllowed(origin) {
		http.Error(w, fmt.Sprintf("request Origin %q is not authorized", origin), http.StatusForbidden)
		return fmt.Errorf("ws: origin %q not authorized", origin)
	}
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		// Origin is verified explicitly above using the shared allowlist rather
		// than nhooyr's built-in same-host-only check. See the New() doc comment.
		InsecureSkipVerify: true,
	})
	if err != nil {
		return fmt.Errorf("ws: accept: %w", err)
	}
	c := &client{
		conn:   conn,
		userID: userID,
		send:   make(chan []byte, 64),
		done:   make(chan struct{}),
	}
	h.register(c)
	defer h.unregister(c)

	ctx := r.Context()
	go c.writePump(ctx)
	c.readPump(ctx) // blocks until disconnect
	return nil
}

// SendToUser fans out a message to all connections for the given user.
func (h *Hub) SendToUser(userID string, msg Message) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.clients[userID] {
		select {
		case c.send <- b:
		default:
			// slow client — drop rather than block
		}
	}
}

func (h *Hub) register(c *client) {
	h.mu.Lock()
	h.clients[c.userID] = append(h.clients[c.userID], c)
	h.mu.Unlock()
}

func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	list := h.clients[c.userID]
	for i, cc := range list {
		if cc == c {
			h.clients[c.userID] = append(list[:i], list[i+1:]...)
			break
		}
	}
	if len(h.clients[c.userID]) == 0 {
		delete(h.clients, c.userID)
	}
}

func (c *client) writePump(ctx context.Context) {
	for {
		select {
		case msg := <-c.send:
			writeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			_ = c.conn.Write(writeCtx, websocket.MessageText, msg)
			cancel()
		case <-c.done:
			return
		case <-ctx.Done():
			return
		}
	}
}

func (c *client) readPump(ctx context.Context) {
	defer close(c.done)
	for {
		_, _, err := c.conn.Read(ctx)
		if err != nil {
			return
		}
		// Client-to-server messages are not used in MVP; we only push server→client.
	}
}
