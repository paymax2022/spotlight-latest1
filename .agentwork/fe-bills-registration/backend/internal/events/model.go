package events

import "time"

// TicketType defines a category of tickets for an event (e.g. VIP, Regular).
type TicketType struct {
	ID          string    `json:"id"`
	EventID     string    `json:"event_id"`
	Name        string    `json:"name"`
	PriceKobo   int64     `json:"price_kobo"`
	Capacity    int       `json:"capacity"`
	Sold        int       `json:"sold"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// Event is a ticketed gathering managed on the platform.
type Event struct {
	ID          string       `json:"id"`
	OrganizerID string       `json:"organizer_id"`
	Title       string       `json:"title"`
	Description string       `json:"description,omitempty"`
	VenueAddress string      `json:"venue_address,omitempty"`
	StartsAt    time.Time    `json:"starts_at"`
	EndsAt      time.Time    `json:"ends_at"`
	BannerURL   *string      `json:"banner_url,omitempty"`
	Status      string       `json:"status"` // draft | published | cancelled | completed
	TicketTypes []TicketType `json:"ticket_types,omitempty"`
	CreatedAt   time.Time    `json:"created_at"`
}

// Ticket is an issued ticket owned by a user.
type Ticket struct {
	ID             string    `json:"id"`
	EventID        string    `json:"event_id"`
	TicketTypeID   string    `json:"ticket_type_id"`
	OwnerID        string    `json:"owner_id"`
	QRCode         string    `json:"qr_code"` // UUID embedded in QR
	Status         string    `json:"status"`  // issued | used | refunded | cancelled
	PricePaidKobo  int64     `json:"price_paid_kobo"`
	IdempotencyKey string    `json:"idempotency_key"`
	ScannedAt      *time.Time `json:"scanned_at,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// CreateEventRequest is the body for POST /events.
type CreateEventRequest struct {
	Title        string       `json:"title" binding:"required,min=2,max=200"`
	Description  string       `json:"description"`
	VenueAddress string       `json:"venue_address"`
	StartsAt     time.Time    `json:"starts_at" binding:"required"`
	EndsAt       time.Time    `json:"ends_at" binding:"required"`
	BannerURL    *string      `json:"banner_url,omitempty"`
	TicketTypes  []TicketType `json:"ticket_types"`
}

// PurchaseTicketRequest is the body for POST /events/:id/tickets.
type PurchaseTicketRequest struct {
	TicketTypeID   string `json:"ticket_type_id" binding:"required"`
	IdempotencyKey string `json:"idempotency_key" binding:"required"`
}

// ScanTicketRequest is the body for POST /events/:id/scan.
type ScanTicketRequest struct {
	QRCode string `json:"qr_code" binding:"required"`
}
