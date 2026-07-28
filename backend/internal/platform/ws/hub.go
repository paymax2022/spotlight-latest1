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
	mu      sync.RWMutex
	clients map[string][]*client // userID → clients
}

// New creates a new Hub.
func New() *Hub {
	return &Hub{clients: make(map[string][]*client)}
}

// ServeHTTP upgrades the HTTP request to a WebSocket and registers the client.
// userID must be extracted from the JWT by the caller before invoking this.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request, userID string) error {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: false,
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
