package restaurant

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"time"
)

// ws_ticket.go — validates the short-lived, HMAC-signed WebSocket ticket minted by
// frontend-web (src/lib/restaurant/ws-ticket.ts) for live order tracking.
//
// WHY: browser/RN WebSocket clients cannot reliably set an Authorization header
// across a proxy hop, so the food app authenticates over HTTP, receives a signed
// ticket, and connects directly to this backend's WS endpoint with `?ticket=`.
// The ws route is therefore mounted WITHOUT the Bearer-required middleware and is
// authenticated solely by this ticket (the handler still enforces order
// participation as defense-in-depth).
//
// Scheme (must match the JS minter byte-for-byte):
//   payload = {"sub","order_id","exp","nonce"}              (JSON)
//   encoded = base64url(payload)                            (no padding)
//   sig     = base64url(HMAC_SHA256(encoded, secret))       (no padding)
//   ticket  = "<encoded>.<sig>"
// Secret comes from WS_TICKET_SIGNING_SECRET (fail-closed if unset).

// WSScopeUser is the reserved `order_id` marking a ticket that authenticates a
// USER-scoped socket rather than one bound to a single order (ADR-049).
//
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
func validateWSTicket(ticket, orderID string) (userID string, ok bool) {
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
