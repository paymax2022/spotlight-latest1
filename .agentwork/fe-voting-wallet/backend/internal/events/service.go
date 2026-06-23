package events

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

// Service manages events, ticket sales, and settlement.
type Service struct {
	db         *pgxpool.Pool
	ledger     *ledger.Service
	settlement *settlement.Service
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service, settlement *settlement.Service) *Service {
	return &Service{db: db, ledger: ledger, settlement: settlement}
}

// Create creates a new event with optional ticket types in a single tx.
func (s *Service) Create(ctx context.Context, organizerID string, req CreateEventRequest) (*Event, error) {
	e := &Event{
		ID:           uuid.New().String(),
		OrganizerID:  organizerID,
		Title:        req.Title,
		Description:  req.Description,
		VenueAddress: req.VenueAddress,
		StartsAt:     req.StartsAt,
		EndsAt:       req.EndsAt,
		BannerURL:    req.BannerURL,
		Status:       "draft",
		CreatedAt:    time.Now(),
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("events: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insertEvent = `
		INSERT INTO events (id, organizer_id, title, description, venue_address, starts_at, ends_at, banner_url, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft')`
	if _, err := tx.Exec(ctx, insertEvent,
		e.ID, e.OrganizerID, e.Title, e.Description, e.VenueAddress,
		e.StartsAt, e.EndsAt, e.BannerURL,
	); err != nil {
		return nil, fmt.Errorf("events: insert event: %w", err)
	}

	for _, tt := range req.TicketTypes {
		if tt.PriceKobo < 0 {
			return nil, fmt.Errorf("events: ticket price must be non-negative")
		}
		tt.ID = uuid.New().String()
		tt.EventID = e.ID
		const insertTT = `
			INSERT INTO event_ticket_types (id, event_id, name, price_kobo, capacity, description)
			VALUES ($1,$2,$3,$4,$5,$6)`
		if _, err := tx.Exec(ctx, insertTT, tt.ID, tt.EventID, tt.Name, tt.PriceKobo, tt.Capacity, tt.Description); err != nil {
			return nil, fmt.Errorf("events: insert ticket type: %w", err)
		}
		e.TicketTypes = append(e.TicketTypes, tt)
	}

	return e, tx.Commit(ctx)
}

// Publish changes an event's status from draft to published.
func (s *Service) Publish(ctx context.Context, eventID, organizerID string) error {
	const q = `UPDATE events SET status='published' WHERE id=$1 AND organizer_id=$2 AND status='draft'`
	tag, err := s.db.Exec(ctx, q, eventID, organizerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("events: event not found or already published")
	}
	return nil
}

// Get fetches an event with its ticket types.
func (s *Service) Get(ctx context.Context, id string) (*Event, error) {
	const q = `SELECT id, organizer_id, title, description, venue_address, starts_at, ends_at, banner_url, status, created_at FROM events WHERE id=$1`
	e := &Event{}
	if err := s.db.QueryRow(ctx, q, id).Scan(
		&e.ID, &e.OrganizerID, &e.Title, &e.Description, &e.VenueAddress,
		&e.StartsAt, &e.EndsAt, &e.BannerURL, &e.Status, &e.CreatedAt,
	); err != nil {
		return nil, err
	}
	tts, err := s.listTicketTypes(ctx, id)
	if err != nil {
		return nil, err
	}
	e.TicketTypes = tts
	return e, nil
}

func (s *Service) listTicketTypes(ctx context.Context, eventID string) ([]TicketType, error) {
	const q = `
		SELECT id, event_id, name, price_kobo, capacity,
		       (SELECT COUNT(*) FROM event_tickets t WHERE t.ticket_type_id=ett.id AND t.status NOT IN ('refunded','cancelled')) AS sold,
		       description, created_at
		FROM event_ticket_types ett WHERE event_id=$1`
	rows, err := s.db.Query(ctx, q, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TicketType
	for rows.Next() {
		var tt TicketType
		if err := rows.Scan(&tt.ID, &tt.EventID, &tt.Name, &tt.PriceKobo, &tt.Capacity, &tt.Sold, &tt.Description, &tt.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, tt)
	}
	return out, rows.Err()
}

// PurchaseTicket deducts the ticket price from the buyer's wallet and issues a ticket.
// For paid tickets the amount is held in escrow; the organiser claims it post-event.
func (s *Service) PurchaseTicket(ctx context.Context, eventID, buyerID string, req PurchaseTicketRequest) (*Ticket, error) {
	// Fetch ticket type + capacity check.
	var tt TicketType
	const qTT = `
		SELECT id, event_id, price_kobo, capacity,
		       (SELECT COUNT(*) FROM event_tickets t WHERE t.ticket_type_id=ett.id AND t.status NOT IN ('refunded','cancelled'))
		FROM event_ticket_types ett WHERE id=$1 AND event_id=$2`
	if err := s.db.QueryRow(ctx, qTT, req.TicketTypeID, eventID).Scan(
		&tt.ID, &tt.EventID, &tt.PriceKobo, &tt.Capacity, &tt.Sold,
	); err != nil {
		return nil, fmt.Errorf("events: ticket type not found: %w", err)
	}
	if tt.Capacity > 0 && tt.Sold >= tt.Capacity {
		return nil, fmt.Errorf("events: ticket type sold out")
	}

	t := &Ticket{
		ID:             uuid.New().String(),
		EventID:        eventID,
		TicketTypeID:   req.TicketTypeID,
		OwnerID:        buyerID,
		QRCode:         uuid.New().String(),
		Status:         "issued",
		PricePaidKobo:  tt.PriceKobo,
		IdempotencyKey: req.IdempotencyKey,
		CreatedAt:      time.Now(),
	}

	// Paid tickets: escrow buyer's wallet via settlement service.
	if tt.PriceKobo > 0 {
		ref := "ticket:" + t.ID
		if _, err := s.settlement.Escrow(ctx, buyerID, ref, req.IdempotencyKey, "event_ticket", tt.PriceKobo); err != nil {
			return nil, fmt.Errorf("events: escrow payment: %w", err)
		}
	}

	const insertTicket = `
		INSERT INTO event_tickets (id, event_id, ticket_type_id, owner_id, qr_code, status, price_paid_kobo, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,'issued',$6,$7)`
	if _, err := s.db.Exec(ctx, insertTicket,
		t.ID, t.EventID, t.TicketTypeID, t.OwnerID, t.QRCode, t.PricePaidKobo, t.IdempotencyKey,
	); err != nil {
		return nil, fmt.Errorf("events: insert ticket: %w", err)
	}
	return t, nil
}

// ScanTicket marks a ticket as used by its QR code. Only the event organiser can scan.
func (s *Service) ScanTicket(ctx context.Context, eventID, scannerID, qrCode string) (*Ticket, error) {
	// Verify scanner is the organiser.
	var organizerID string
	if err := s.db.QueryRow(ctx, `SELECT organizer_id FROM events WHERE id=$1`, eventID).Scan(&organizerID); err != nil {
		return nil, fmt.Errorf("events: event not found")
	}
	if organizerID != scannerID {
		return nil, fmt.Errorf("events: only the organiser can scan tickets")
	}

	now := time.Now()
	const q = `
		UPDATE event_tickets SET status='used', scanned_at=$1
		WHERE qr_code=$2 AND event_id=$3 AND status='issued'
		RETURNING id, event_id, ticket_type_id, owner_id, qr_code, status, price_paid_kobo, idempotency_key, scanned_at, created_at`
	t := &Ticket{}
	if err := s.db.QueryRow(ctx, q, now, qrCode, eventID).Scan(
		&t.ID, &t.EventID, &t.TicketTypeID, &t.OwnerID, &t.QRCode,
		&t.Status, &t.PricePaidKobo, &t.IdempotencyKey, &t.ScannedAt, &t.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("events: ticket not found or already used")
	}
	return t, nil
}

// ListMyTickets returns tickets owned by a user.
func (s *Service) ListMyTickets(ctx context.Context, userID string) ([]Ticket, error) {
	const q = `
		SELECT id, event_id, ticket_type_id, owner_id, qr_code, status, price_paid_kobo, idempotency_key, scanned_at, created_at
		FROM event_tickets WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Ticket
	for rows.Next() {
		var t Ticket
		if err := rows.Scan(&t.ID, &t.EventID, &t.TicketTypeID, &t.OwnerID, &t.QRCode, &t.Status, &t.PricePaidKobo, &t.IdempotencyKey, &t.ScannedAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
