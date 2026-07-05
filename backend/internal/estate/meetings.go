package estate

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// meetings.go — Block 32 meeting management: scheduling, RSVPs, attendance
// check-in, minutes (with approval) and documents.

// ── Models ───────────────────────────────────────────────────────────────────

type Meeting struct {
	ID        string     `json:"id"`
	EstateID  string     `json:"estate_id"`
	Title     string     `json:"title"`
	Agenda    string     `json:"agenda,omitempty"`
	Mode      string     `json:"mode"` // physical | virtual | hybrid
	Location  string     `json:"location,omitempty"`
	StartsAt  time.Time  `json:"starts_at"`
	EndsAt    *time.Time `json:"ends_at,omitempty"`
	Status    string     `json:"status"` // scheduled | live | ended | cancelled
	CreatedBy string     `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	// Populated by GetMeeting:
	MyRSVP        string `json:"my_rsvp,omitempty"`
	RSVPYes       int    `json:"rsvp_yes"`
	RSVPNo        int    `json:"rsvp_no"`
	RSVPMaybe     int    `json:"rsvp_maybe"`
	AttendeeCount int    `json:"attendee_count"`
}

type CreateMeetingRequest struct {
	Title    string     `json:"title" binding:"required,min=2,max=200"`
	Agenda   string     `json:"agenda"`
	Mode     string     `json:"mode"`
	Location string     `json:"location"`
	StartsAt time.Time  `json:"starts_at" binding:"required"`
	EndsAt   *time.Time `json:"ends_at"`
}

type RescheduleMeetingRequest struct {
	StartsAt time.Time  `json:"starts_at" binding:"required"`
	EndsAt   *time.Time `json:"ends_at"`
}

type MeetingMinutes struct {
	ID          string          `json:"id"`
	MeetingID   string          `json:"meeting_id"`
	Content     string          `json:"content"`
	Decisions   json.RawMessage `json:"decisions"`
	ActionItems json.RawMessage `json:"action_items"`
	CreatedBy   string          `json:"created_by"`
	ApprovedBy  *string         `json:"approved_by,omitempty"`
	ApprovedAt  *time.Time      `json:"approved_at,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
}

type UploadMinutesRequest struct {
	Content     string          `json:"content"`
	Decisions   json.RawMessage `json:"decisions"`
	ActionItems json.RawMessage `json:"action_items"`
}

type MeetingDocument struct {
	ID         string    `json:"id"`
	MeetingID  string    `json:"meeting_id"`
	UploadedBy string    `json:"uploaded_by"`
	Name       string    `json:"name"`
	FileURL    string    `json:"file_url"`
	ObjectKey  string    `json:"object_key,omitempty"`
	SizeBytes  int64     `json:"size_bytes,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

type AddMeetingDocumentRequest struct {
	Name      string `json:"name" binding:"required,min=1,max=200"`
	FileURL   string `json:"file_url" binding:"required,url"`
	ObjectKey string `json:"object_key"`
	SizeBytes int64  `json:"size_bytes"`
}

// ── Pure validators (unit-testable) ──────────────────────────────────────────

func validRSVPResponse(r string) bool { return r == "yes" || r == "no" || r == "maybe" }

func validCheckinMethod(m string) bool { return m == "qr" || m == "manual" }

// validMeetingMode reports whether m is allowed ("" means default physical).
func validMeetingMode(m string) bool {
	return m == "" || m == "physical" || m == "virtual" || m == "hybrid"
}

// ── Service ──────────────────────────────────────────────────────────────────

const meetingCols = `id, estate_id, title, COALESCE(agenda,''), mode, COALESCE(location,''), starts_at, ends_at, status, created_by, created_at`

func scanMeeting(row interface{ Scan(...any) error }) (*Meeting, error) {
	var m Meeting
	if err := row.Scan(&m.ID, &m.EstateID, &m.Title, &m.Agenda, &m.Mode, &m.Location,
		&m.StartsAt, &m.EndsAt, &m.Status, &m.CreatedBy, &m.CreatedAt); err != nil {
		return nil, err
	}
	return &m, nil
}

// CreateMeeting schedules a meeting (estate admin only).
func (s *Service) CreateMeeting(ctx context.Context, estateID, adminID string, req CreateMeetingRequest) (*Meeting, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if !validMeetingMode(req.Mode) {
		return nil, fmt.Errorf("estate: invalid meeting mode %q", req.Mode)
	}
	if req.EndsAt != nil && !req.EndsAt.After(req.StartsAt) {
		return nil, fmt.Errorf("estate: ends_at must be after starts_at")
	}
	mode := req.Mode
	if mode == "" {
		mode = "physical"
	}
	m := &Meeting{
		ID: uuid.New().String(), EstateID: estateID, Title: req.Title, Agenda: req.Agenda,
		Mode: mode, Location: req.Location, StartsAt: req.StartsAt, EndsAt: req.EndsAt,
		Status: "scheduled", CreatedBy: adminID, CreatedAt: time.Now(),
	}
	const q = `INSERT INTO estate_meetings (id, estate_id, title, agenda, mode, location, starts_at, ends_at, status, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9)`
	if _, err := s.db.Exec(ctx, q, m.ID, estateID, m.Title, m.Agenda, mode, m.Location, m.StartsAt, m.EndsAt, adminID); err != nil {
		return nil, fmt.Errorf("estate: insert meeting: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "MEETING_CREATE", "meeting", m.ID, map[string]any{"title": m.Title})
	s.notifyMembers(ctx, estateID, NotifMeetingReminder, "New meeting: "+m.Title,
		"A meeting has been scheduled.", map[string]any{"meeting_id": m.ID})
	return m, nil
}

// ListMeetings returns meetings for an estate. filter: "upcoming" (default) | "past" | "all".
func (s *Service) ListMeetings(ctx context.Context, estateID, userID, filter string) ([]Meeting, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	q := `SELECT ` + meetingCols + ` FROM estate_meetings WHERE estate_id=$1`
	switch filter {
	case "past":
		q += ` AND starts_at < NOW()`
	case "all":
		// no time filter
	default: // upcoming
		q += ` AND starts_at >= NOW() AND status <> 'cancelled'`
	}
	q += ` ORDER BY starts_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Meeting
	for rows.Next() {
		m, err := scanMeeting(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// GetMeeting returns a meeting with the caller's RSVP and aggregate counts.
func (s *Service) GetMeeting(ctx context.Context, estateID, userID, meetingID string) (*Meeting, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx, `SELECT `+meetingCols+` FROM estate_meetings WHERE id=$1 AND estate_id=$2`, meetingID, estateID)
	m, err := scanMeeting(row)
	if err != nil {
		return nil, fmt.Errorf("estate: meeting not found in this estate")
	}
	const aggQ = `
SELECT
  COALESCE((SELECT response FROM meeting_rsvps WHERE meeting_id=$1 AND user_id=$2),''),
  (SELECT COUNT(*) FROM meeting_rsvps WHERE meeting_id=$1 AND response='yes'),
  (SELECT COUNT(*) FROM meeting_rsvps WHERE meeting_id=$1 AND response='no'),
  (SELECT COUNT(*) FROM meeting_rsvps WHERE meeting_id=$1 AND response='maybe'),
  (SELECT COUNT(*) FROM meeting_attendees WHERE meeting_id=$1)`
	_ = s.db.QueryRow(ctx, aggQ, meetingID, userID).Scan(&m.MyRSVP, &m.RSVPYes, &m.RSVPNo, &m.RSVPMaybe, &m.AttendeeCount)
	return m, nil
}

// RSVP records/updates the caller's attendance intent.
func (s *Service) RSVP(ctx context.Context, estateID, userID, meetingID, response string) error {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return err
	}
	if !validRSVPResponse(response) {
		return fmt.Errorf("estate: invalid RSVP response %q", response)
	}
	if err := s.assertMeetingInEstate(ctx, estateID, meetingID); err != nil {
		return err
	}
	const q = `INSERT INTO meeting_rsvps (id, estate_id, meeting_id, user_id, response)
		VALUES (gen_random_uuid(),$1,$2,$3,$4)
		ON CONFLICT (meeting_id, user_id) DO UPDATE SET response=EXCLUDED.response`
	_, err := s.db.Exec(ctx, q, estateID, meetingID, userID, response)
	return err
}

// CheckInAttendee records attendance (QR or manual). Members check themselves in.
func (s *Service) CheckInAttendee(ctx context.Context, estateID, userID, meetingID, method string) error {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return err
	}
	if !validCheckinMethod(method) {
		return fmt.Errorf("estate: invalid check-in method %q", method)
	}
	if err := s.assertMeetingInEstate(ctx, estateID, meetingID); err != nil {
		return err
	}
	const q = `INSERT INTO meeting_attendees (id, estate_id, meeting_id, user_id, method)
		VALUES (gen_random_uuid(),$1,$2,$3,$4)
		ON CONFLICT (meeting_id, user_id) DO NOTHING`
	_, err := s.db.Exec(ctx, q, estateID, meetingID, userID, method)
	return err
}

// StartMeeting moves a scheduled meeting to live (estate admin only).
func (s *Service) StartMeeting(ctx context.Context, estateID, adminID, meetingID string) error {
	return s.transitionMeeting(ctx, estateID, adminID, meetingID, "live", "scheduled", "MEETING_START")
}

// EndMeeting moves a live meeting to ended (estate admin only).
func (s *Service) EndMeeting(ctx context.Context, estateID, adminID, meetingID string) error {
	return s.transitionMeeting(ctx, estateID, adminID, meetingID, "ended", "live", "MEETING_END")
}

// CancelMeeting cancels a scheduled or live meeting (estate admin only).
func (s *Service) CancelMeeting(ctx context.Context, estateID, adminID, meetingID string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	ct, err := s.db.Exec(ctx,
		`UPDATE estate_meetings SET status='cancelled' WHERE id=$1 AND estate_id=$2 AND status IN ('scheduled','live')`,
		meetingID, estateID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: meeting not found or not cancellable")
	}
	_ = s.audit(ctx, estateID, adminID, "MEETING_CANCEL", "meeting", meetingID, nil)
	s.notifyMembers(ctx, estateID, NotifMeetingReminder, "Meeting cancelled", "A scheduled meeting was cancelled.", map[string]any{"meeting_id": meetingID})
	return nil
}

// transitionMeeting enforces a from→to status change (to/from are trusted literals).
func (s *Service) transitionMeeting(ctx context.Context, estateID, adminID, meetingID, to, from, action string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	ct, err := s.db.Exec(ctx,
		`UPDATE estate_meetings SET status=$1 WHERE id=$2 AND estate_id=$3 AND status=$4`,
		to, meetingID, estateID, from)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: meeting not found or not in '%s' state", from)
	}
	_ = s.audit(ctx, estateID, adminID, action, "meeting", meetingID, nil)
	return nil
}

// RescheduleMeeting changes a meeting's time (estate admin only; not if ended/cancelled).
func (s *Service) RescheduleMeeting(ctx context.Context, estateID, adminID, meetingID string, req RescheduleMeetingRequest) (*Meeting, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if req.EndsAt != nil && !req.EndsAt.After(req.StartsAt) {
		return nil, fmt.Errorf("estate: ends_at must be after starts_at")
	}
	row := s.db.QueryRow(ctx,
		`UPDATE estate_meetings SET starts_at=$3, ends_at=$4, status='scheduled'
		 WHERE id=$1 AND estate_id=$2 AND status NOT IN ('ended','cancelled')
		 RETURNING `+meetingCols,
		meetingID, estateID, req.StartsAt, req.EndsAt)
	m, err := scanMeeting(row)
	if err != nil {
		return nil, fmt.Errorf("estate: meeting not found or not reschedulable")
	}
	_ = s.audit(ctx, estateID, adminID, "MEETING_RESCHEDULE", "meeting", meetingID, nil)
	s.notifyMembers(ctx, estateID, NotifMeetingReminder, "Meeting rescheduled: "+m.Title, "A meeting time changed.", map[string]any{"meeting_id": meetingID})
	return m, nil
}

// UploadMinutes creates/updates a meeting's minutes (estate admin only).
func (s *Service) UploadMinutes(ctx context.Context, estateID, adminID, meetingID string, req UploadMinutesRequest) (*MeetingMinutes, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if err := s.assertMeetingInEstate(ctx, estateID, meetingID); err != nil {
		return nil, err
	}
	decisions := req.Decisions
	if len(decisions) == 0 {
		decisions = json.RawMessage("[]")
	}
	actions := req.ActionItems
	if len(actions) == 0 {
		actions = json.RawMessage("[]")
	}
	const q = `
		INSERT INTO meeting_minutes (id, estate_id, meeting_id, content, decisions, action_items, created_by)
		VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6)
		ON CONFLICT (meeting_id) DO UPDATE SET
			content=EXCLUDED.content, decisions=EXCLUDED.decisions, action_items=EXCLUDED.action_items,
			approved_by=NULL, approved_at=NULL
		RETURNING id, meeting_id, content, decisions, action_items, created_by, approved_by, approved_at, created_at`
	mm := &MeetingMinutes{}
	if err := s.db.QueryRow(ctx, q, estateID, meetingID, req.Content, decisions, actions, adminID).Scan(
		&mm.ID, &mm.MeetingID, &mm.Content, &mm.Decisions, &mm.ActionItems, &mm.CreatedBy, &mm.ApprovedBy, &mm.ApprovedAt, &mm.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("estate: upload minutes: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "MEETING_MINUTES_UPLOAD", "meeting", meetingID, nil)
	return mm, nil
}

// GetMinutes returns a meeting's minutes (members).
func (s *Service) GetMinutes(ctx context.Context, estateID, userID, meetingID string) (*MeetingMinutes, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	mm := &MeetingMinutes{}
	const q = `SELECT id, meeting_id, content, decisions, action_items, created_by, approved_by, approved_at, created_at
		FROM meeting_minutes WHERE meeting_id=$1 AND estate_id=$2`
	if err := s.db.QueryRow(ctx, q, meetingID, estateID).Scan(
		&mm.ID, &mm.MeetingID, &mm.Content, &mm.Decisions, &mm.ActionItems, &mm.CreatedBy, &mm.ApprovedBy, &mm.ApprovedAt, &mm.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("estate: minutes not found")
	}
	return mm, nil
}

// ApproveMinutes marks a meeting's minutes approved (estate admin only).
func (s *Service) ApproveMinutes(ctx context.Context, estateID, adminID, meetingID string) error {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return err
	}
	ct, err := s.db.Exec(ctx,
		`UPDATE meeting_minutes SET approved_by=$1, approved_at=NOW() WHERE meeting_id=$2 AND estate_id=$3`,
		adminID, meetingID, estateID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("estate: minutes not found for this meeting")
	}
	_ = s.audit(ctx, estateID, adminID, "MEETING_MINUTES_APPROVE", "meeting", meetingID, nil)
	return nil
}

// AddDocument attaches a document to a meeting (estate admin only).
func (s *Service) AddMeetingDocument(ctx context.Context, estateID, adminID, meetingID string, req AddMeetingDocumentRequest) (*MeetingDocument, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if err := s.assertMeetingInEstate(ctx, estateID, meetingID); err != nil {
		return nil, err
	}
	d := &MeetingDocument{
		ID: uuid.New().String(), MeetingID: meetingID, UploadedBy: adminID,
		Name: req.Name, FileURL: req.FileURL, ObjectKey: req.ObjectKey, SizeBytes: req.SizeBytes, CreatedAt: time.Now(),
	}
	const q = `INSERT INTO meeting_documents (id, estate_id, meeting_id, uploaded_by, name, file_url, object_key, size_bytes)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := s.db.Exec(ctx, q, d.ID, estateID, meetingID, adminID, d.Name, d.FileURL, d.ObjectKey, d.SizeBytes); err != nil {
		return nil, fmt.Errorf("estate: add meeting document: %w", err)
	}
	return d, nil
}

// ListMeetingDocuments returns a meeting's documents (members).
func (s *Service) ListMeetingDocuments(ctx context.Context, estateID, userID, meetingID string) ([]MeetingDocument, error) {
	if err := s.assertResident(ctx, estateID, userID); err != nil {
		return nil, err
	}
	const q = `SELECT id, meeting_id, uploaded_by, name, file_url, COALESCE(object_key,''), COALESCE(size_bytes,0), created_at
		FROM meeting_documents WHERE meeting_id=$1 AND estate_id=$2 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, meetingID, estateID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MeetingDocument
	for rows.Next() {
		var d MeetingDocument
		if err := rows.Scan(&d.ID, &d.MeetingID, &d.UploadedBy, &d.Name, &d.FileURL, &d.ObjectKey, &d.SizeBytes, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// assertMeetingInEstate verifies a meeting belongs to the estate.
func (s *Service) assertMeetingInEstate(ctx context.Context, estateID, meetingID string) error {
	var exists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM estate_meetings WHERE id=$1 AND estate_id=$2)`, meetingID, estateID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("estate: meeting not found in this estate")
	}
	return nil
}
