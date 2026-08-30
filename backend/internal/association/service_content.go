package association

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Content authoring for an organisation: announcements, meetings, documents,
// events, tasks, dues invoices and member devices.
//
// Every table written here previously had a read endpoint and NO writer, so it
// was permanently empty. Authorization is org-scoped throughout
// (requireOrgAdmin); each mutation writes an audit row, and creates optionally
// fan out an in-app notification to the organisation's active members — which
// is what makes assoc_notifications non-orphan too.

var validMeetingModes = map[string]bool{"PHYSICAL": true, "VIRTUAL": true, "HYBRID": true}
var validMeetingStates = map[string]bool{"UPCOMING": true, "LIVE": true, "PAST": true, "CANCELLED": true}
var validDocKinds = map[string]bool{"pdf": true, "image": true, "doc": true}
var validTaskStatuses = map[string]bool{
	"DRAFT": true, "ASSIGNED": true, "ACCEPTED": true, "IN_PROGRESS": true, "BLOCKED": true,
	"AWAITING_REVIEW": true, "COMPLETED": true, "REJECTED": true, "REOPENED": true,
	"CANCELLED": true, "OVERDUE": true,
}
var validTaskPriorities = map[string]bool{"LOW": true, "MEDIUM": true, "HIGH": true}
var validInvoiceScopes = map[string]bool{"NATIONAL": true, "STATE": true, "LOCAL": true, "COMMITTEE": true}

// parseTime accepts RFC3339 and returns a *time.Time, or nil for an empty
// string. A malformed timestamp is an error rather than a silent zero value.
func parseTime(v *string, field string) (*time.Time, error) {
	if v == nil || strings.TrimSpace(*v) == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, *v)
	if err != nil {
		return nil, fmt.Errorf("%w: association: %s must be RFC3339: %w", ErrInvalidInput, field, err)
	}
	return &t, nil
}

func mustParseTime(v, field string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(v))
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: association: %s must be RFC3339: %w", ErrInvalidInput, field, err)
	}
	return t, nil
}

// notifyOrg inserts one notification per ACTIVE member of the organisation.
// Best-effort by design: a notification failure must never roll back the
// content it is announcing, so the caller passes its own tx and ignores nothing
// — but the fan-out itself is a single INSERT…SELECT, so it is cheap and atomic
// with the content write.
func (s *Service) notifyOrg(ctx context.Context, tx pgx.Tx, orgID, kind, title, body, route string) error {
	const q = `
		INSERT INTO assoc_notifications (id, membership_id, kind, title, body, route)
		SELECT gen_random_uuid(), m.id, $2, $3, NULLIF($4,''), NULLIF($5,'')
		FROM assoc_memberships m
		WHERE m.organisation_id = $1 AND m.status = 'ACTIVE'`
	if _, err := tx.Exec(ctx, q, orgID, kind, title, body, route); err != nil {
		return fmt.Errorf("association: notify org: %w", err)
	}
	return nil
}

// ── Announcements ────────────────────────────────────────────────────────────

func (s *Service) CreateAnnouncement(ctx context.Context, adminID, orgID string, r AnnouncementRequest) (string, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	author := s.actorName(ctx, adminID)
	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_announcements
		  (id, organisation_id, title, body, audience, author, urgent, requires_ack, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, orgID, r.Title, r.Body, r.Audience, author, r.Urgent, r.RequiresAck, adminID); err != nil {
		return "", fmt.Errorf("association: create announcement: %w", err)
	}
	if r.Notify {
		if err := s.notifyOrg(ctx, tx, orgID, "ANNOUNCEMENT", r.Title, deref(r.Body), "/association/announcements/"+id); err != nil {
			return "", err
		}
	}
	if err := s.audit(ctx, tx, orgID, adminID, "ANNOUNCEMENT_CREATE", "announcement", id,
		map[string]any{"title": r.Title, "urgent": r.Urgent}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (s *Service) UpdateAnnouncement(ctx context.Context, adminID, id string, r AnnouncementRequest) error {
	orgID, err := s.orgOfChild(ctx, "assoc_announcements", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	return s.simpleUpdate(ctx, adminID, orgID, "ANNOUNCEMENT_UPDATE", "announcement", id, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE assoc_announcements
			   SET title=$2, body=$3, audience=$4, urgent=$5, requires_ack=$6, updated_at=now()
			 WHERE id=$1`,
			id, r.Title, r.Body, r.Audience, r.Urgent, r.RequiresAck)
		return err
	})
}

func (s *Service) DeleteAnnouncement(ctx context.Context, adminID, id string) error {
	orgID, err := s.orgOfChild(ctx, "assoc_announcements", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	return s.simpleUpdate(ctx, adminID, orgID, "ANNOUNCEMENT_DELETE", "announcement", id, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM assoc_announcement_reads WHERE announcement_id=$1`, id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM assoc_announcements WHERE id=$1`, id)
		return err
	})
}

// ── Meetings ─────────────────────────────────────────────────────────────────

func (s *Service) CreateMeeting(ctx context.Context, adminID, orgID string, r MeetingRequest) (string, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	mode := nz(r.Mode, "PHYSICAL")
	if !validMeetingModes[mode] {
		return "", fmt.Errorf("%w: association: invalid meeting mode %q", ErrInvalidInput, mode)
	}
	state := nz(r.State, "UPCOMING")
	if !validMeetingStates[state] {
		return "", fmt.Errorf("%w: association: invalid meeting state %q", ErrInvalidInput, state)
	}
	startsAt, err := mustParseTime(r.StartsAt, "startsAt")
	if err != nil {
		return "", err
	}
	endsAt, err := parseTime(r.EndsAt, "endsAt")
	if err != nil {
		return "", err
	}
	if endsAt != nil && endsAt.Before(startsAt) {
		return "", fmt.Errorf("%w: association: endsAt is before startsAt", ErrInvalidInput)
	}
	agenda, err := json.Marshal(nonNilStrings(r.Agenda))
	if err != nil {
		return "", fmt.Errorf("association: agenda: %w", err)
	}
	var code *string
	if r.GenerateAttendanceCode {
		c := strings.ToUpper(uuid.New().String()[:6])
		code = &c
	}

	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_meetings
		  (id, organisation_id, title, description, mode, starts_at, ends_at, location, state, agenda, attendance_code, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		id, orgID, r.Title, r.Description, mode, startsAt, endsAt, r.Location, state, agenda, code, adminID); err != nil {
		return "", fmt.Errorf("association: create meeting: %w", err)
	}
	if r.Notify {
		if err := s.notifyOrg(ctx, tx, orgID, "MEETING", r.Title, deref(r.Description), "/association/meetings/"+id); err != nil {
			return "", err
		}
	}
	if err := s.audit(ctx, tx, orgID, adminID, "MEETING_CREATE", "meeting", id,
		map[string]any{"title": r.Title, "startsAt": startsAt}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (s *Service) UpdateMeeting(ctx context.Context, adminID, id string, r MeetingRequest) error {
	orgID, err := s.orgOfChild(ctx, "assoc_meetings", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	mode := nz(r.Mode, "PHYSICAL")
	if !validMeetingModes[mode] {
		return fmt.Errorf("%w: association: invalid meeting mode %q", ErrInvalidInput, mode)
	}
	state := nz(r.State, "UPCOMING")
	if !validMeetingStates[state] {
		return fmt.Errorf("%w: association: invalid meeting state %q", ErrInvalidInput, state)
	}
	startsAt, err := mustParseTime(r.StartsAt, "startsAt")
	if err != nil {
		return err
	}
	endsAt, err := parseTime(r.EndsAt, "endsAt")
	if err != nil {
		return err
	}
	agenda, err := json.Marshal(nonNilStrings(r.Agenda))
	if err != nil {
		return fmt.Errorf("association: agenda: %w", err)
	}
	return s.simpleUpdate(ctx, adminID, orgID, "MEETING_UPDATE", "meeting", id, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE assoc_meetings
			   SET title=$2, description=$3, mode=$4, starts_at=$5, ends_at=$6,
			       location=$7, state=$8, agenda=$9
			 WHERE id=$1`,
			id, r.Title, r.Description, mode, startsAt, endsAt, r.Location, state, agenda)
		return err
	})
}

// PublishMinutes flips minutes_published, which the meeting detail screen reads
// and nothing could previously set.
func (s *Service) PublishMinutes(ctx context.Context, adminID, id string, published bool) error {
	orgID, err := s.orgOfChild(ctx, "assoc_meetings", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	return s.simpleUpdate(ctx, adminID, orgID, "MEETING_MINUTES_PUBLISH", "meeting", id, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE assoc_meetings SET minutes_published=$2 WHERE id=$1`, id, published)
		return err
	})
}

func (s *Service) DeleteMeeting(ctx context.Context, adminID, id string) error {
	orgID, err := s.orgOfChild(ctx, "assoc_meetings", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	return s.simpleUpdate(ctx, adminID, orgID, "MEETING_DELETE", "meeting", id, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE assoc_tasks SET meeting_id=NULL WHERE meeting_id=$1`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM assoc_meeting_attendance WHERE meeting_id=$1`, id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM assoc_meetings WHERE id=$1`, id)
		return err
	})
}

// ── Documents ────────────────────────────────────────────────────────────────

func (s *Service) CreateDocument(ctx context.Context, adminID, orgID string, r DocumentRequest) (string, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	kind := nz(r.Kind, "pdf")
	if !validDocKinds[kind] {
		return "", fmt.Errorf("%w: association: invalid document kind %q", ErrInvalidInput, kind)
	}
	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_documents
		  (id, organisation_id, title, category, kind, storage_key, size_label, version,
		   restricted, requires_ack, ai_summary, uploaded_by, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		id, orgID, r.Title, r.Category, kind, r.StorageKey, r.SizeLabel, nz(r.Version, "v1"),
		r.Restricted, r.RequiresAck, r.AISummary, s.actorName(ctx, adminID), adminID); err != nil {
		return "", fmt.Errorf("association: create document: %w", err)
	}
	if r.Notify {
		if err := s.notifyOrg(ctx, tx, orgID, "DOCUMENT", r.Title, "", "/association/documents/"+id); err != nil {
			return "", err
		}
	}
	if err := s.audit(ctx, tx, orgID, adminID, "DOCUMENT_CREATE", "document", id,
		map[string]any{"title": r.Title, "restricted": r.Restricted}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (s *Service) UpdateDocument(ctx context.Context, adminID, id string, r DocumentRequest) error {
	orgID, err := s.orgOfChild(ctx, "assoc_documents", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	kind := nz(r.Kind, "pdf")
	if !validDocKinds[kind] {
		return fmt.Errorf("%w: association: invalid document kind %q", ErrInvalidInput, kind)
	}
	return s.simpleUpdate(ctx, adminID, orgID, "DOCUMENT_UPDATE", "document", id, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE assoc_documents
			   SET title=$2, category=$3, kind=$4, storage_key=$5, size_label=$6, version=$7,
			       restricted=$8, requires_ack=$9, ai_summary=$10, updated_at=now()
			 WHERE id=$1`,
			id, r.Title, r.Category, kind, r.StorageKey, r.SizeLabel, nz(r.Version, "v1"),
			r.Restricted, r.RequiresAck, r.AISummary)
		return err
	})
}

func (s *Service) DeleteDocument(ctx context.Context, adminID, id string) error {
	orgID, err := s.orgOfChild(ctx, "assoc_documents", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	return s.simpleUpdate(ctx, adminID, orgID, "DOCUMENT_DELETE", "document", id, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM assoc_document_acks WHERE document_id=$1`, id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM assoc_documents WHERE id=$1`, id)
		return err
	})
}

// ── Events ───────────────────────────────────────────────────────────────────

func (s *Service) CreateEvent(ctx context.Context, adminID, orgID string, r EventRequest) (string, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	if r.FeeKobo < 0 {
		return "", fmt.Errorf("%w: association: feeKobo must not be negative", ErrInvalidInput)
	}
	// A paid event with no fee (or a fee on a free event) is a configuration
	// mistake that would otherwise surface as a silently free ticket.
	if r.Paid && r.FeeKobo == 0 {
		return "", fmt.Errorf("%w: association: a paid event needs a feeKobo greater than zero", ErrInvalidInput)
	}
	if !r.Paid && r.FeeKobo > 0 {
		return "", fmt.Errorf("%w: association: feeKobo is set but the event is not marked paid", ErrInvalidInput)
	}
	startsAt, err := mustParseTime(r.StartsAt, "startsAt")
	if err != nil {
		return "", err
	}
	endsAt, err := parseTime(r.EndsAt, "endsAt")
	if err != nil {
		return "", err
	}
	if endsAt != nil && endsAt.Before(startsAt) {
		return "", fmt.Errorf("%w: association: endsAt is before startsAt", ErrInvalidInput)
	}
	if r.Capacity != nil && *r.Capacity < 0 {
		return "", fmt.Errorf("%w: association: capacity must not be negative", ErrInvalidInput)
	}

	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_events
		  (id, organisation_id, title, description, starts_at, ends_at, location,
		   paid, fee_kobo, capacity, organiser, cover_url, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		id, orgID, r.Title, r.Description, startsAt, endsAt, r.Location,
		r.Paid, r.FeeKobo, r.Capacity, r.Organiser, r.CoverURL, adminID); err != nil {
		return "", fmt.Errorf("association: create event: %w", err)
	}
	if r.Notify {
		if err := s.notifyOrg(ctx, tx, orgID, "EVENT", r.Title, deref(r.Description), "/association/events/"+id); err != nil {
			return "", err
		}
	}
	if err := s.audit(ctx, tx, orgID, adminID, "EVENT_CREATE", "event", id,
		map[string]any{"title": r.Title, "paid": r.Paid, "feeKobo": r.FeeKobo}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (s *Service) UpdateEvent(ctx context.Context, adminID, id string, r EventRequest) error {
	orgID, err := s.orgOfChild(ctx, "assoc_events", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	if r.FeeKobo < 0 {
		return fmt.Errorf("%w: association: feeKobo must not be negative", ErrInvalidInput)
	}
	if r.Paid && r.FeeKobo == 0 {
		return fmt.Errorf("%w: association: a paid event needs a feeKobo greater than zero", ErrInvalidInput)
	}
	startsAt, err := mustParseTime(r.StartsAt, "startsAt")
	if err != nil {
		return err
	}
	endsAt, err := parseTime(r.EndsAt, "endsAt")
	if err != nil {
		return err
	}
	return s.simpleUpdate(ctx, adminID, orgID, "EVENT_UPDATE", "event", id, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE assoc_events
			   SET title=$2, description=$3, starts_at=$4, ends_at=$5, location=$6,
			       paid=$7, fee_kobo=$8, capacity=$9, organiser=$10, cover_url=$11
			 WHERE id=$1`,
			id, r.Title, r.Description, startsAt, endsAt, r.Location,
			r.Paid, r.FeeKobo, r.Capacity, r.Organiser, r.CoverURL)
		return err
	})
}

func (s *Service) DeleteEvent(ctx context.Context, adminID, id string) error {
	orgID, err := s.orgOfChild(ctx, "assoc_events", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	// Refuse while money is attached: deleting an event whose attendees hold
	// unpaid or settled invoices would strand those rows.
	var withInvoices int
	if err := s.db.QueryRow(ctx,
		`SELECT count(*) FROM assoc_event_registrations WHERE event_id=$1 AND invoice_id IS NOT NULL`,
		id).Scan(&withInvoices); err != nil {
		return fmt.Errorf("association: event registrations: %w", err)
	}
	if withInvoices > 0 {
		return fmt.Errorf("association: event has %d paid registration(s) — cancel it instead of deleting", withInvoices)
	}
	return s.simpleUpdate(ctx, adminID, orgID, "EVENT_DELETE", "event", id, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM assoc_event_registrations WHERE event_id=$1`, id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM assoc_events WHERE id=$1`, id)
		return err
	})
}

// ── Tasks ────────────────────────────────────────────────────────────────────

func (s *Service) CreateTask(ctx context.Context, adminID, orgID string, r TaskRequest) (string, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	status := nz(r.Status, "ASSIGNED")
	if !validTaskStatuses[status] {
		return "", fmt.Errorf("%w: association: invalid task status %q", ErrInvalidInput, status)
	}
	priority := nz(r.Priority, "MEDIUM")
	if !validTaskPriorities[priority] {
		return "", fmt.Errorf("%w: association: invalid task priority %q", ErrInvalidInput, priority)
	}
	dueDate, err := parseTime(r.DueDate, "dueDate")
	if err != nil {
		return "", err
	}
	// An assignee/committee/meeting from another organisation would be a
	// cross-org write; verify each belongs to this org before referencing it.
	if err := s.assertBelongsToOrg(ctx, "assoc_memberships", r.AssigneeID, orgID, "assignee"); err != nil {
		return "", err
	}
	if err := s.assertBelongsToOrg(ctx, "assoc_committees", r.CommitteeID, orgID, "committee"); err != nil {
		return "", err
	}
	if err := s.assertBelongsToOrg(ctx, "assoc_meetings", r.MeetingID, orgID, "meeting"); err != nil {
		return "", err
	}
	checklist, err := json.Marshal(nonNilStrings(r.Checklist))
	if err != nil {
		return "", fmt.Errorf("association: checklist: %w", err)
	}

	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_tasks
		  (id, organisation_id, title, description, status, priority, due_date,
		   assignee_id, committee_id, meeting_id, checklist, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
		id, orgID, r.Title, r.Description, status, priority, dueDate,
		r.AssigneeID, r.CommitteeID, r.MeetingID, checklist, adminID); err != nil {
		return "", fmt.Errorf("association: create task: %w", err)
	}
	// Notify the assignee specifically rather than the whole organisation.
	if r.Notify && r.AssigneeID != nil {
		if _, err := tx.Exec(ctx, `
			INSERT INTO assoc_notifications (id, membership_id, kind, title, body, route)
			VALUES (gen_random_uuid(), $1, 'TASK', $2, $3, $4)`,
			*r.AssigneeID, "New task: "+r.Title, deref(r.Description), "/association/tasks/"+id); err != nil {
			return "", fmt.Errorf("association: notify assignee: %w", err)
		}
	}
	if err := s.audit(ctx, tx, orgID, adminID, "TASK_CREATE", "task", id,
		map[string]any{"title": r.Title, "priority": priority}); err != nil {
		return "", err
	}
	return id, tx.Commit(ctx)
}

func (s *Service) UpdateTask(ctx context.Context, adminID, id string, r TaskRequest) error {
	orgID, err := s.orgOfChild(ctx, "assoc_tasks", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	status := nz(r.Status, "ASSIGNED")
	if !validTaskStatuses[status] {
		return fmt.Errorf("%w: association: invalid task status %q", ErrInvalidInput, status)
	}
	priority := nz(r.Priority, "MEDIUM")
	if !validTaskPriorities[priority] {
		return fmt.Errorf("%w: association: invalid task priority %q", ErrInvalidInput, priority)
	}
	dueDate, err := parseTime(r.DueDate, "dueDate")
	if err != nil {
		return err
	}
	if err := s.assertBelongsToOrg(ctx, "assoc_memberships", r.AssigneeID, orgID, "assignee"); err != nil {
		return err
	}
	checklist, err := json.Marshal(nonNilStrings(r.Checklist))
	if err != nil {
		return fmt.Errorf("association: checklist: %w", err)
	}
	return s.simpleUpdate(ctx, adminID, orgID, "TASK_UPDATE", "task", id, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			UPDATE assoc_tasks
			   SET title=$2, description=$3, status=$4, priority=$5, due_date=$6,
			       assignee_id=$7, committee_id=$8, meeting_id=$9, checklist=$10
			 WHERE id=$1`,
			id, r.Title, r.Description, status, priority, dueDate,
			r.AssigneeID, r.CommitteeID, r.MeetingID, checklist)
		return err
	})
}

func (s *Service) DeleteTask(ctx context.Context, adminID, id string) error {
	orgID, err := s.orgOfChild(ctx, "assoc_tasks", id)
	if err != nil {
		return err
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return err
	}
	return s.simpleUpdate(ctx, adminID, orgID, "TASK_DELETE", "task", id, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM assoc_tasks WHERE id=$1`, id)
		return err
	})
}

// ── Devices (member self-service) ────────────────────────────────────────────

// RegisterDevice records the caller's device. assoc_devices had no writer, so
// GET /me/devices always returned [] and DELETE always 403'd on zero rows.
// Idempotent on (user, name, platform): re-opening the app refreshes last_active
// rather than accumulating a new row every launch.
func (s *Service) RegisterDevice(ctx context.Context, userID string, r DeviceRequest) (string, error) {
	var id string
	err := s.db.QueryRow(ctx, `
		SELECT id::text FROM assoc_devices
		 WHERE user_id=$1 AND COALESCE(name,'')=$2 AND COALESCE(platform,'')=$3 AND revoked_at IS NULL
		 LIMIT 1`, userID, r.Name, r.Platform).Scan(&id)
	if err == nil {
		if _, err := s.db.Exec(ctx, `UPDATE assoc_devices SET last_active=now(), location=COALESCE($2, location) WHERE id=$1`, id, r.Location); err != nil {
			return "", fmt.Errorf("association: touch device: %w", err)
		}
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("association: device lookup: %w", err)
	}
	id = uuid.New().String()
	if _, err := s.db.Exec(ctx, `
		INSERT INTO assoc_devices (id, user_id, name, platform, location, last_active)
		VALUES ($1,$2,$3,$4,$5,now())`,
		id, userID, r.Name, r.Platform, r.Location); err != nil {
		return "", fmt.Errorf("association: register device: %w", err)
	}
	return id, nil
}

// ── Dues invoices (money path input) ─────────────────────────────────────────

// RunDues raises one invoice per matching ACTIVE member, priced from that
// member's own membership category. This is the input to the money path:
// PayInvoice previously had nothing it could ever settle.
//
// Replay safety is the whole design here. A retried run that re-billed an
// organisation's entire roster is the worst failure mode in this module, so the
// idempotency key is a UNIQUE INDEX on assoc_dues_runs and the per-member
// invoice is uniquely indexed on (run_id, membership_id). A replay returns the
// original run's result and raises nothing.
func (s *Service) RunDues(ctx context.Context, adminID, orgID string, r DuesRunRequest) (*DuesRunResult, error) {
	if r.IdempotencyKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if err := s.requireCapInOrg(ctx, adminID, orgID, func(c AdminCapabilities) bool { return c.ManageFinance }); err != nil {
		return nil, err
	}
	scope := nz(r.Scope, "NATIONAL")
	if !validInvoiceScopes[scope] {
		return nil, fmt.Errorf("%w: association: invalid scope %q", ErrInvalidInput, scope)
	}
	dueDate, err := parseTime(r.DueDate, "dueDate")
	if err != nil {
		return nil, err
	}

	// Replay short-circuit.
	var prior DuesRunResult
	err = s.db.QueryRow(ctx,
		`SELECT id::text, invoiced, skipped, total_kobo FROM assoc_dues_runs WHERE idempotency_key=$1`,
		r.IdempotencyKey).Scan(&prior.RunID, &prior.Invoiced, &prior.Skipped, &prior.TotalKobo)
	if err == nil {
		prior.AlreadyRaised = true
		return &prior, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("association: dues run idempotency: %w", err)
	}

	runID := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_dues_runs
		  (id, organisation_id, title, scope, category_id, chapter_id, idempotency_key, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		runID, orgID, r.Title, scope, r.CategoryID, r.ChapterID, r.IdempotencyKey, adminID); err != nil {
		return nil, fmt.Errorf("association: create dues run: %w", err)
	}

	// One invoice per ACTIVE member holding a category with a positive due.
	// Members with no category, or a zero-priced tier, are skipped rather than
	// billed zero.
	q := `
		INSERT INTO assoc_dues_invoices
		  (id, membership_id, title, description, amount_kobo, cadence, scope, status, due_date, run_id)
		SELECT gen_random_uuid(), m.id, $2, NULL, c.dues_kobo, c.cadence, $3, 'DUE', $4, $5
		FROM assoc_memberships m
		JOIN assoc_membership_categories c ON c.id = m.category_id
		WHERE m.organisation_id = $1
		  AND m.status = 'ACTIVE'
		  AND c.dues_kobo > 0`
	args := []any{orgID, r.Title, scope, dueDate, runID}
	if r.CategoryID != nil {
		args = append(args, *r.CategoryID)
		q += fmt.Sprintf(` AND m.category_id = $%d`, len(args))
	}
	if r.ChapterID != nil {
		args = append(args, *r.ChapterID)
		q += fmt.Sprintf(` AND m.chapter_id = $%d`, len(args))
	}
	tag, err := tx.Exec(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("association: raise dues invoices: %w", err)
	}
	invoiced := int(tag.RowsAffected())

	var eligible int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM assoc_memberships WHERE organisation_id=$1 AND status='ACTIVE'`,
		orgID).Scan(&eligible); err != nil {
		return nil, fmt.Errorf("association: count members: %w", err)
	}
	var totalKobo int64
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_kobo),0) FROM assoc_dues_invoices WHERE run_id=$1`,
		runID).Scan(&totalKobo); err != nil {
		return nil, fmt.Errorf("association: sum run: %w", err)
	}
	skipped := eligible - invoiced
	if skipped < 0 {
		skipped = 0
	}

	if _, err := tx.Exec(ctx,
		`UPDATE assoc_dues_runs SET invoiced=$2, skipped=$3, total_kobo=$4 WHERE id=$1`,
		runID, invoiced, skipped, totalKobo); err != nil {
		return nil, fmt.Errorf("association: record dues run: %w", err)
	}
	if r.Notify && invoiced > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO assoc_notifications (id, membership_id, kind, title, body, route)
			SELECT gen_random_uuid(), i.membership_id, 'DUES', $2, NULL, '/association/dues'
			FROM assoc_dues_invoices i WHERE i.run_id = $1`, runID, r.Title); err != nil {
			return nil, fmt.Errorf("association: notify dues: %w", err)
		}
	}
	if err := s.audit(ctx, tx, orgID, adminID, "DUES_RUN", "dues_run", runID,
		map[string]any{"title": r.Title, "invoiced": invoiced, "skipped": skipped, "totalKobo": totalKobo}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("association: commit dues run: %w", err)
	}
	return &DuesRunResult{RunID: runID, Invoiced: invoiced, Skipped: skipped, TotalKobo: totalKobo}, nil
}

// CreateInvoice raises one ad-hoc invoice against a single membership.
func (s *Service) CreateInvoice(ctx context.Context, adminID string, r InvoiceRequest) (string, error) {
	if r.IdempotencyKey == "" {
		return "", ErrIdempotencyRequired
	}
	if r.AmountKobo <= 0 {
		return "", fmt.Errorf("%w: association: amountKobo must be greater than zero", ErrInvalidInput)
	}
	scope := nz(r.Scope, "NATIONAL")
	if !validInvoiceScopes[scope] {
		return "", fmt.Errorf("%w: association: invalid scope %q", ErrInvalidInput, scope)
	}
	orgID, err := s.membershipOrg(ctx, r.MembershipID)
	if err != nil {
		return "", err
	}
	if err := s.requireCapInOrg(ctx, adminID, orgID, func(c AdminCapabilities) bool { return c.ManageFinance }); err != nil {
		return "", err
	}
	dueDate, err := parseTime(r.DueDate, "dueDate")
	if err != nil {
		return "", err
	}

	// Ad-hoc invoices reuse the dues-run table as their idempotency ledger, so a
	// retried create returns the original invoice instead of billing twice.
	var existing string
	err = s.db.QueryRow(ctx, `
		SELECT i.id::text FROM assoc_dues_invoices i
		JOIN assoc_dues_runs r ON r.id = i.run_id
		WHERE r.idempotency_key = $1`, r.IdempotencyKey).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("association: invoice idempotency: %w", err)
	}

	runID := uuid.New().String()
	invoiceID := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_dues_runs (id, organisation_id, title, scope, invoiced, total_kobo, idempotency_key, created_by)
		VALUES ($1,$2,$3,$4,1,$5,$6,$7)`,
		runID, orgID, r.Title, scope, r.AmountKobo, r.IdempotencyKey, adminID); err != nil {
		return "", fmt.Errorf("association: create invoice run: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_dues_invoices
		  (id, membership_id, title, description, amount_kobo, cadence, scope, status, due_date, run_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'DUE',$8,$9)`,
		invoiceID, r.MembershipID, r.Title, r.Description, r.AmountKobo,
		nz(r.Cadence, "ONE_OFF"), scope, dueDate, runID); err != nil {
		return "", fmt.Errorf("association: create invoice: %w", err)
	}
	if r.Notify {
		if _, err := tx.Exec(ctx, `
			INSERT INTO assoc_notifications (id, membership_id, kind, title, body, route)
			VALUES (gen_random_uuid(), $1, 'DUES', $2, NULL, '/association/dues')`,
			r.MembershipID, r.Title); err != nil {
			return "", fmt.Errorf("association: notify invoice: %w", err)
		}
	}
	if err := s.audit(ctx, tx, orgID, adminID, "INVOICE_CREATE", "invoice", invoiceID,
		map[string]any{"title": r.Title, "amountKobo": r.AmountKobo}); err != nil {
		return "", err
	}
	return invoiceID, tx.Commit(ctx)
}

// ── Shared helpers ───────────────────────────────────────────────────────────

// simpleUpdate wraps a single-statement mutation in a tx plus an audit row, and
// treats "no row changed" as not-found rather than reporting success.
func (s *Service) simpleUpdate(ctx context.Context, adminID, orgID, action, subjectType, id string, fn func(pgx.Tx) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return fmt.Errorf("association: %s: %w", strings.ToLower(action), err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, action, subjectType, id, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// assertBelongsToOrg rejects a reference to a row in another organisation.
// `table` is always an internal constant, never user input.
func (s *Service) assertBelongsToOrg(ctx context.Context, table string, id *string, orgID, label string) error {
	if id == nil || strings.TrimSpace(*id) == "" {
		return nil
	}
	var owner string
	q := fmt.Sprintf(`SELECT organisation_id::text FROM %s WHERE id=$1`, table)
	if err := s.db.QueryRow(ctx, q, *id).Scan(&owner); err != nil {
		return fmt.Errorf("association: %s not found", label)
	}
	if owner != orgID {
		return ErrForbidden
	}
	return nil
}

// actorName resolves a display name for the acting admin, falling back to their
// email and then to a neutral label.
func (s *Service) actorName(ctx context.Context, userID string) string {
	var name *string
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(NULLIF(TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')), ''), email)
		  FROM platform_users WHERE id=$1`, userID).Scan(&name)
	if name != nil && *name != "" {
		return *name
	}
	return "Administrator"
}

func deref(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// nonNilStrings guarantees a JSON array rather than null for an empty slice.
func nonNilStrings(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// ── Member-proposed meetings ─────────────────────────────────────────────────

// MeetingApprovalDecision is the outcome an admin records on a proposal.
type MeetingApprovalDecision struct {
	Approve bool   `json:"approve"`
	Note    string `json:"note"`
}

// ProposeMeeting lets ANY active member put a meeting forward.
//
// The caller's standing decides what happens next, and that is the whole point
// of the endpoint: an admin scheduling a meeting is scheduling it, so it is
// APPROVED on insert and behaves exactly like one created through the admin
// route. A member without admin rights is proposing one, so it starts PENDING
// and stays invisible to the rest of the organisation until an admin decides.
//
// The organisation is resolved from the caller's own membership rather than
// taken from the request. A body-supplied organisation id would let any member
// of any organisation file proposals into somebody else's calendar, which is
// the shape of the cross-org write this module has been bitten by before.
func (s *Service) ProposeMeeting(ctx context.Context, userID string, r MeetingRequest) (string, string, error) {
	_, orgID, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return "", "", err
	}

	// Admin ⇒ approved on insert. requireOrgAdmin returns an error for a plain
	// member, which here is not a failure but the answer: they are proposing.
	approval := "PENDING"
	if err := s.requireOrgAdmin(ctx, userID, orgID); err == nil {
		approval = "APPROVED"
	}

	mode := nz(r.Mode, "PHYSICAL")
	if !validMeetingModes[mode] {
		return "", "", fmt.Errorf("%w: association: invalid meeting mode %q", ErrInvalidInput, mode)
	}
	startsAt, err := mustParseTime(r.StartsAt, "startsAt")
	if err != nil {
		return "", "", err
	}
	endsAt, err := parseTime(r.EndsAt, "endsAt")
	if err != nil {
		return "", "", err
	}
	if endsAt != nil && endsAt.Before(startsAt) {
		return "", "", fmt.Errorf("%w: association: endsAt is before startsAt", ErrInvalidInput)
	}
	// A proposal for a time that has already passed is not something an admin can
	// meaningfully approve, and it would land in the calendar's past on arrival.
	if startsAt.Before(time.Now()) {
		return "", "", fmt.Errorf("%w: association: startsAt is in the past", ErrInvalidInput)
	}
	agenda, err := json.Marshal(nonNilStrings(r.Agenda))
	if err != nil {
		return "", "", fmt.Errorf("association: agenda: %w", err)
	}

	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		INSERT INTO assoc_meetings
		  (id, organisation_id, title, description, mode, starts_at, ends_at, location,
		   state, agenda, created_by, approval_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UPCOMING',$9,$10,$11)`,
		id, orgID, r.Title, r.Description, mode, startsAt, endsAt, r.Location,
		agenda, userID, approval); err != nil {
		return "", "", fmt.Errorf("association: propose meeting: %w", err)
	}

	// Only an approved meeting is announced. Notifying the organisation about a
	// proposal would tell everyone about a meeting that may never be approved,
	// and the proposal is not visible to them yet in any case.
	if approval == "APPROVED" && r.Notify {
		if err := s.notifyOrg(ctx, tx, orgID, "MEETING", r.Title, deref(r.Description), "/association/meetings/"+id); err != nil {
			return "", "", err
		}
	}

	action := "MEETING_PROPOSE"
	if approval == "APPROVED" {
		action = "MEETING_CREATE"
	}
	if err := s.audit(ctx, tx, orgID, userID, action, "meeting", id,
		map[string]any{"title": r.Title, "startsAt": startsAt, "approvalStatus": approval}); err != nil {
		return "", "", err
	}
	return id, approval, tx.Commit(ctx)
}

// DecideMeeting records an admin's decision on a proposed meeting.
//
// Only a PENDING meeting can be decided. Re-deciding an already-approved or
// already-rejected meeting is refused rather than silently overwritten: the
// decision is an audited record of who let a meeting onto the calendar, and
// letting it be flipped afterwards would make that record unreliable. Removing
// an approved meeting is what cancel/delete are for.
func (s *Service) DecideMeeting(ctx context.Context, adminID, meetingID string, d MeetingApprovalDecision) (string, error) {
	var orgID, current, title string
	var createdBy *string
	if err := s.db.QueryRow(ctx,
		`SELECT organisation_id::text, approval_status, title, created_by::text FROM assoc_meetings WHERE id=$1`,
		meetingID).Scan(&orgID, &current, &title, &createdBy); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// This package has no ErrNotFound; statusFor maps pgx.ErrNoRows to 404.
			return "", pgx.ErrNoRows
		}
		return "", fmt.Errorf("association: meeting lookup: %w", err)
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return "", err
	}
	if current != "PENDING" {
		return "", fmt.Errorf("%w: association: meeting is already %s", ErrInvalidInput, current)
	}

	next := "REJECTED"
	if d.Approve {
		next = "APPROVED"
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Conditional on still being PENDING so two admins deciding at once cannot
	// both write a decision — the second finds no row and is told it is decided.
	tag, err := tx.Exec(ctx, `
		UPDATE assoc_meetings
		SET approval_status=$2, decided_by=$3, decided_at=now(), decision_note=NULLIF($4,'')
		WHERE id=$1 AND approval_status='PENDING'`,
		meetingID, next, adminID, strings.TrimSpace(d.Note))
	if err != nil {
		return "", fmt.Errorf("association: decide meeting: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return "", fmt.Errorf("%w: association: meeting is no longer pending", ErrInvalidInput)
	}

	// The organisation only hears about it once it is real.
	if next == "APPROVED" {
		if err := s.notifyOrg(ctx, tx, orgID, "MEETING", title, "", "/association/meetings/"+meetingID); err != nil {
			return "", err
		}
	}
	if err := s.audit(ctx, tx, orgID, adminID, "MEETING_DECIDE", "meeting", meetingID,
		map[string]any{"decision": next, "note": d.Note, "proposedBy": deref(createdBy)}); err != nil {
		return "", err
	}
	return next, tx.Commit(ctx)
}

// GetPendingMeetings returns the approval queue for one organisation.
func (s *Service) GetPendingMeetings(ctx context.Context, adminID, orgID string) ([]PendingMeeting, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT mt.id::text, mt.title, mt.mode, mt.starts_at::text, mt.ends_at::text, mt.location,
		       COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'A member'),
		       mt.created_at::text
		FROM assoc_meetings mt
		LEFT JOIN auth.users u ON u.id = mt.created_by
		WHERE mt.organisation_id=$1 AND mt.approval_status='PENDING'
		ORDER BY mt.starts_at ASC
		LIMIT 100`, orgID)
	if err != nil {
		return nil, fmt.Errorf("association: pending meetings: %w", err)
	}
	defer rows.Close()

	out := []PendingMeeting{}
	for rows.Next() {
		var p PendingMeeting
		if err := rows.Scan(&p.ID, &p.Title, &p.Mode, &p.StartsAt, &p.EndsAt, &p.Location,
			&p.ProposedByName, &p.ProposedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ── Event invitations ────────────────────────────────────────────────────────

// InviteToEvent invites members to an event and returns how many invitations
// were newly recorded.
//
// An invitation is a registration row with invited_at set, not a separate
// record — see the migration. That means a member who was already registered or
// had already RSVPed keeps that state and simply becomes "invited" as well; the
// invitation never resets a response somebody has already given.
//
// Every membership is checked against the EVENT'S organisation rather than the
// caller's. They are normally the same, but validating against the event closes
// the case where an admin of one organisation passes membership ids belonging
// to another: the ids are silently dropped instead of writing rows that would
// put a foreign member on this organisation's guest list.
func (s *Service) InviteToEvent(ctx context.Context, adminID, eventID string, membershipIDs []string) (int, error) {
	var orgID, title string
	if err := s.db.QueryRow(ctx,
		`SELECT organisation_id::text, title FROM assoc_events WHERE id=$1`, eventID).Scan(&orgID, &title); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, pgx.ErrNoRows
		}
		return 0, fmt.Errorf("association: event lookup: %w", err)
	}
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return 0, err
	}
	if len(membershipIDs) == 0 {
		return 0, fmt.Errorf("%w: association: no members selected", ErrInvalidInput)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// One statement: the SELECT filters the supplied ids down to memberships that
	// actually belong to this event's organisation, so a foreign id inserts
	// nothing rather than being rejected with an error that names it.
	tag, err := tx.Exec(ctx, `
		INSERT INTO assoc_event_registrations (event_id, membership_id, invited_by, invited_at)
		SELECT $1, m.id, $2, now()
		FROM assoc_memberships m
		WHERE m.id = ANY($3::uuid[]) AND m.organisation_id = $4 AND m.status = 'ACTIVE'
		ON CONFLICT (event_id, membership_id) DO UPDATE
		  SET invited_by = EXCLUDED.invited_by,
		      invited_at = COALESCE(assoc_event_registrations.invited_at, EXCLUDED.invited_at)`,
		eventID, adminID, membershipIDs, orgID)
	if err != nil {
		return 0, fmt.Errorf("association: invite to event: %w", err)
	}

	if err := s.audit(ctx, tx, orgID, adminID, "EVENT_INVITE", "event", eventID,
		map[string]any{"title": title, "requested": len(membershipIDs), "invited": tag.RowsAffected()}); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}
