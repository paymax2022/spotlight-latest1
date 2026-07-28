// Package connectevents implements Paymax Connect Phase 3 (event networking).
// It REUSES the existing public.events / public.event_tickets / public.event_ticket_types
// tables (20260616240000_events.sql) — ticketing is NOT rebuilt. This package only
// adds opt-in networking, opt-in-privacy attendee discovery, QR check-in/scan,
// saved event contacts and follow-up on top of the existing event a user holds a
// ticket for. Discovery is gated on mutual opt-in.
package connectevents

import (
	"encoding/json"
	"time"
)

type OptIn struct {
	ID         string          `json:"id"`
	EventID    string          `json:"event_id"`
	UserID     string          `json:"user_id"`
	OptedIn    bool            `json:"opted_in"`
	Visibility json.RawMessage `json:"visibility"`
	CheckedIn  bool            `json:"checked_in"`
	CreatedAt  time.Time       `json:"created_at"`
}

// Attendee is a discovery card honouring the other party's opt-in privacy mask.
type Attendee struct {
	UserID    string `json:"user_id"`
	CheckedIn bool   `json:"checked_in"`
	// Masked fields are populated only where the attendee's visibility allows.
	Name     string `json:"name,omitempty"`
	Headline string `json:"headline,omitempty"`
	Company  string `json:"company,omitempty"`
}

type EventContact struct {
	ID        string    `json:"id"`
	EventID   string    `json:"event_id"`
	OwnerID   string    `json:"owner_id"`
	ContactID string    `json:"contact_id"`
	Note      string    `json:"note,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// --- Request DTOs ---

type OptInInput struct {
	OptedIn    bool            `json:"opted_in"`
	Visibility json.RawMessage `json:"visibility"`
}

type ScanInput struct {
	QRCode string `json:"qr_code" binding:"required"` // event_tickets.qr_code
}

type SaveContactInput struct {
	ContactID string `json:"contact_id" binding:"required"`
	Note      string `json:"note"`
}
