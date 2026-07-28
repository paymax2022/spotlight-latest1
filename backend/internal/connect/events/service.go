package connectevents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNoTicket    = errors.New("connect: a valid event ticket is required to opt in")
	ErrNotOptedIn  = errors.New("connect: opt in before discovering attendees")
	ErrBadQR       = errors.New("connect: invalid or unknown QR code")
	ErrSelfContact = errors.New("connect: cannot save yourself as a contact")
)

type Auditor interface {
	WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error
}

type Service struct {
	db    *pgxpool.Pool
	audit Auditor
}

func NewService(db *pgxpool.Pool, audit Auditor) *Service { return &Service{db: db, audit: audit} }

// hasTicket reports whether the user holds a non-cancelled ticket for the event
// (REUSE of existing public.event_tickets — we do not rebuild ticketing).
func (s *Service) hasTicket(ctx context.Context, userID, eventID string) (bool, error) {
	var n int
	err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM event_tickets
		 WHERE event_id=$1 AND owner_id=$2 AND status IN ('issued','used')`,
		eventID, userID).Scan(&n)
	if err != nil {
		return false, fmt.Errorf("connect: check ticket: %w", err)
	}
	return n > 0, nil
}

// OptIn records explicit per-event networking opt-in (requires a ticket).
func (s *Service) OptIn(ctx context.Context, userID, eventID string, in OptInInput) (*OptIn, error) {
	ok, err := s.hasTicket(ctx, userID, eventID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNoTicket
	}
	vis := in.Visibility
	if len(vis) == 0 {
		vis = json.RawMessage(`{"name":true,"headline":false,"company":false}`)
	}
	const q = `INSERT INTO connect_event_optins (event_id, user_id, opted_in, visibility)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (event_id, user_id) DO UPDATE SET
			opted_in=EXCLUDED.opted_in, visibility=EXCLUDED.visibility, updated_at=now()
		RETURNING id, event_id, user_id, opted_in, visibility, checked_in, created_at`
	o := &OptIn{}
	if err := s.db.QueryRow(ctx, q, eventID, userID, in.OptedIn, vis).Scan(
		&o.ID, &o.EventID, &o.UserID, &o.OptedIn, &o.Visibility, &o.CheckedIn, &o.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: event opt-in: %w", err)
	}
	_ = s.audit.WriteAudit(ctx, "connect.event.optin", userID, "connect_event_optin", o.ID,
		map[string]any{"event_id": eventID, "opted_in": in.OptedIn})
	return o, nil
}

// Attendees lists opted-in attendees of an event, honouring each one's privacy
// mask. The viewer must themselves be opted in (mutual-opt-in discovery).
func (s *Service) Attendees(ctx context.Context, viewerID, eventID string, limit int) ([]Attendee, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var viewerOpted bool
	err := s.db.QueryRow(ctx,
		`SELECT COALESCE((SELECT opted_in FROM connect_event_optins WHERE event_id=$1 AND user_id=$2), false)`,
		eventID, viewerID).Scan(&viewerOpted)
	if err != nil {
		return nil, fmt.Errorf("connect: check viewer opt-in: %w", err)
	}
	if !viewerOpted {
		return nil, ErrNotOptedIn
	}
	// Pull opted-in attendees + their professional fields, masked by their
	// visibility. We join only Connect-owned tables (no cross-team coupling).
	const q = `SELECT o.user_id, o.checked_in, o.visibility,
			COALESCE(p.headline,''), COALESCE(p.company,''),
			COALESCE(NULLIF(p.company,''), p.headline, '') AS display_name
		FROM connect_event_optins o
		LEFT JOIN connect_professional_profiles p ON p.user_id = o.user_id
		WHERE o.event_id=$1 AND o.opted_in = true AND o.user_id <> $2
		ORDER BY o.checked_in DESC, o.created_at DESC LIMIT $3`
	rows, err := s.db.Query(ctx, q, eventID, viewerID, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list attendees: %w", err)
	}
	defer rows.Close()
	var out []Attendee
	for rows.Next() {
		var (
			a       Attendee
			visRaw  []byte
			head    string
			company string
			name    string
		)
		if err := rows.Scan(&a.UserID, &a.CheckedIn, &visRaw, &head, &company, &name); err != nil {
			return nil, err
		}
		out = append(out, applyMask(a, visRaw, name, head, company))
	}
	return out, rows.Err()
}

// applyMask reveals only the fields the attendee opted to share.
func applyMask(a Attendee, visRaw []byte, name, headline, company string) Attendee {
	var vis map[string]bool
	_ = json.Unmarshal(visRaw, &vis)
	if vis["name"] {
		a.Name = name
	}
	if vis["headline"] {
		a.Headline = headline
	}
	if vis["company"] {
		a.Company = company
	}
	return a
}

// CheckInSelf marks the caller as checked-in for an event they hold a ticket for.
func (s *Service) CheckInSelf(ctx context.Context, userID, eventID string) error {
	ok, err := s.hasTicket(ctx, userID, eventID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNoTicket
	}
	const q = `INSERT INTO connect_event_optins (event_id, user_id, opted_in, checked_in, checked_in_at)
		VALUES ($1,$2,true,true,now())
		ON CONFLICT (event_id, user_id) DO UPDATE SET checked_in=true, checked_in_at=now(), updated_at=now()`
	if _, err := s.db.Exec(ctx, q, eventID, userID); err != nil {
		return fmt.Errorf("connect: self check-in: %w", err)
	}
	return nil
}

// ScanQR validates a ticket QR (REUSE event_tickets) and marks that ticket used +
// the holder checked-in. The scanner must be the event organiser.
func (s *Service) ScanQR(ctx context.Context, scannerID, eventID, qr string) (string, error) {
	qrUUID, err := uuid.Parse(qr)
	if err != nil {
		return "", ErrBadQR
	}
	// Authz: only the organiser of THIS event may scan its tickets.
	var organizer string
	if err := s.db.QueryRow(ctx, `SELECT organizer_id FROM events WHERE id=$1`, eventID).Scan(&organizer); err != nil {
		return "", fmt.Errorf("connect: event not found: %w", err)
	}
	if organizer != scannerID {
		return "", fmt.Errorf("connect: only the organiser may scan tickets")
	}
	// Resolve ticket + holder from QR within the event.
	var ticketID, ownerID, status string
	if err := s.db.QueryRow(ctx,
		`SELECT id, owner_id, status FROM event_tickets WHERE qr_code=$1 AND event_id=$2`,
		qrUUID, eventID).Scan(&ticketID, &ownerID, &status); err != nil {
		return "", ErrBadQR
	}
	if status == "cancelled" || status == "refunded" {
		return "", fmt.Errorf("connect: ticket %s", status)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx,
		`UPDATE event_tickets SET status='used', scanned_at=now() WHERE id=$1 AND status='issued'`,
		ticketID); err != nil {
		return "", fmt.Errorf("connect: mark ticket used: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO connect_event_optins (event_id, user_id, opted_in, checked_in, checked_in_at)
		 VALUES ($1,$2,true,true,now())
		 ON CONFLICT (event_id, user_id) DO UPDATE SET checked_in=true, checked_in_at=now(), updated_at=now()`,
		eventID, ownerID); err != nil {
		return "", fmt.Errorf("connect: check-in holder: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	_ = s.audit.WriteAudit(ctx, "connect.event.scan", scannerID, "event_ticket", ticketID,
		map[string]any{"event_id": eventID, "owner_id": ownerID})
	return ownerID, nil
}

// SaveContact saves an event contact (follow-up). Both must be opted-in attendees.
func (s *Service) SaveContact(ctx context.Context, ownerID, eventID string, in SaveContactInput) (*EventContact, error) {
	if ownerID == in.ContactID {
		return nil, ErrSelfContact
	}
	// Both parties must be opted-in for this event.
	var n int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM connect_event_optins
		 WHERE event_id=$1 AND user_id IN ($2,$3) AND opted_in=true`,
		eventID, ownerID, in.ContactID).Scan(&n); err != nil {
		return nil, fmt.Errorf("connect: verify opt-in: %w", err)
	}
	if n < 2 {
		return nil, ErrNotOptedIn
	}
	id := uuid.New().String()
	const q = `INSERT INTO connect_event_contacts (id, event_id, owner_id, contact_id, note)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (event_id, owner_id, contact_id) DO UPDATE SET note=EXCLUDED.note
		RETURNING id, event_id, owner_id, contact_id, COALESCE(note,''), created_at`
	ec := &EventContact{}
	if err := s.db.QueryRow(ctx, q, id, eventID, ownerID, in.ContactID, in.Note).Scan(
		&ec.ID, &ec.EventID, &ec.OwnerID, &ec.ContactID, &ec.Note, &ec.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: save event contact: %w", err)
	}
	return ec, nil
}

// ListContacts returns the caller's saved event contacts (optionally per event).
func (s *Service) ListContacts(ctx context.Context, ownerID, eventID string) ([]EventContact, error) {
	const q = `SELECT id, event_id, owner_id, contact_id, COALESCE(note,''), created_at
		FROM connect_event_contacts WHERE owner_id=$1 AND ($2='' OR event_id=$2::uuid)
		ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, ownerID, eventID)
	if err != nil {
		return nil, fmt.Errorf("connect: list event contacts: %w", err)
	}
	defer rows.Close()
	var out []EventContact
	for rows.Next() {
		var ec EventContact
		if err := rows.Scan(&ec.ID, &ec.EventID, &ec.OwnerID, &ec.ContactID, &ec.Note, &ec.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, ec)
	}
	return out, rows.Err()
}
