package association

import (
	"context"
	"fmt"
)

// Admin content listings, scoped by organisation.
//
// The member-facing reads (GetAnnouncements, GetMeetings, GetDocuments,
// GetEvents, GetTasks) all join through the CALLER's own memberships, which is
// correct for a member but returns nothing for a platform admin — they hold no
// association membership of their own. The admin console therefore had no way
// to see the content it can now author. These listings take an explicit org and
// authorize against it instead.

// AdminContentRow is one row of any admin content listing. The shape is
// deliberately uniform so the console can render one table component for all
// five content types; type-specific detail lives in Meta.
type AdminContentRow struct {
	ID        string         `json:"id"`
	Title     string         `json:"title"`
	Subtitle  string         `json:"subtitle"`
	Status    string         `json:"status"`
	At        *string        `json:"at"`
	CreatedAt *string        `json:"createdAt"`
	Meta      map[string]any `json:"meta"`
}

// listContent runs a uniform admin listing against one content table.
// `query` is an internal constant, never user input.
func (s *Service) listContent(ctx context.Context, adminID, orgID, query string, limit, offset int) ([]AdminContentRow, error) {
	if err := s.requireOrgAdmin(ctx, adminID, orgID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.Query(ctx, query, orgID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("association: admin content list: %w", err)
	}
	defer rows.Close()
	out := []AdminContentRow{}
	for rows.Next() {
		var r AdminContentRow
		var meta []byte
		if err := rows.Scan(&r.ID, &r.Title, &r.Subtitle, &r.Status, &r.At, &r.CreatedAt, &meta); err != nil {
			// Surfaced rather than swallowed: a silently skipped row here would
			// make content the admin just created look like it never saved.
			return nil, fmt.Errorf("association: admin content list: scan: %w", err)
		}
		scanJSONB(meta, &r.Meta)
		if r.Meta == nil {
			r.Meta = map[string]any{}
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Service) ListAdminAnnouncements(ctx context.Context, adminID, orgID string, limit, offset int) ([]AdminContentRow, error) {
	const q = `
		SELECT a.id::text, a.title, COALESCE(a.audience,''),
		       CASE WHEN a.urgent THEN 'URGENT' ELSE 'POSTED' END,
		       a.posted_at::text, a.posted_at::text,
		       jsonb_build_object(
		         'body', a.body, 'audience', a.audience, 'author', a.author,
		         'urgent', a.urgent, 'requiresAck', a.requires_ack,
		         'readCount', (SELECT count(*) FROM assoc_announcement_reads r
		                        WHERE r.announcement_id=a.id AND r.read_at IS NOT NULL),
		         'ackCount',  (SELECT count(*) FROM assoc_announcement_reads r
		                        WHERE r.announcement_id=a.id AND r.acknowledged_at IS NOT NULL))
		FROM assoc_announcements a
		WHERE a.organisation_id=$1
		ORDER BY a.posted_at DESC, a.id DESC
		LIMIT $2 OFFSET $3`
	return s.listContent(ctx, adminID, orgID, q, limit, offset)
}

func (s *Service) ListAdminMeetings(ctx context.Context, adminID, orgID string, limit, offset int) ([]AdminContentRow, error) {
	const q = `
		SELECT m.id::text, m.title, COALESCE(m.location,''), m.state,
		       m.starts_at::text, m.created_at::text,
		       jsonb_build_object(
		         'description', m.description, 'mode', m.mode,
		         'startsAt', m.starts_at, 'endsAt', m.ends_at,
		         'location', m.location, 'agenda', m.agenda,
		         'minutesPublished', m.minutes_published,
		         'attendanceCode', m.attendance_code,
		         'rsvpCount',      (SELECT count(*) FROM assoc_meeting_attendance a
		                             WHERE a.meeting_id=m.id AND a.rsvp='YES'),
		         'checkedInCount', (SELECT count(*) FROM assoc_meeting_attendance a
		                             WHERE a.meeting_id=m.id AND a.checked_in_at IS NOT NULL))
		FROM assoc_meetings m
		WHERE m.organisation_id=$1
		ORDER BY m.starts_at DESC, m.id DESC
		LIMIT $2 OFFSET $3`
	return s.listContent(ctx, adminID, orgID, q, limit, offset)
}

func (s *Service) ListAdminDocuments(ctx context.Context, adminID, orgID string, limit, offset int) ([]AdminContentRow, error) {
	const q = `
		SELECT d.id::text, d.title, d.category,
		       CASE WHEN d.restricted THEN 'RESTRICTED' ELSE 'OPEN' END,
		       d.updated_at::text, d.updated_at::text,
		       jsonb_build_object(
		         'kind', d.kind, 'storageKey', d.storage_key, 'sizeLabel', d.size_label,
		         'version', d.version, 'restricted', d.restricted,
		         'requiresAck', d.requires_ack, 'aiSummary', d.ai_summary,
		         'uploadedBy', d.uploaded_by,
		         'ackCount', (SELECT count(*) FROM assoc_document_acks k WHERE k.document_id=d.id))
		FROM assoc_documents d
		WHERE d.organisation_id=$1
		ORDER BY d.updated_at DESC, d.id DESC
		LIMIT $2 OFFSET $3`
	return s.listContent(ctx, adminID, orgID, q, limit, offset)
}

func (s *Service) ListAdminEvents(ctx context.Context, adminID, orgID string, limit, offset int) ([]AdminContentRow, error) {
	const q = `
		SELECT e.id::text, e.title, COALESCE(e.location,''),
		       CASE WHEN e.starts_at > now() THEN 'UPCOMING' ELSE 'PAST' END,
		       e.starts_at::text, e.created_at::text,
		       jsonb_build_object(
		         'description', e.description, 'startsAt', e.starts_at, 'endsAt', e.ends_at,
		         'location', e.location, 'paid', e.paid, 'feeKobo', e.fee_kobo,
		         'capacity', e.capacity, 'organiser', e.organiser, 'coverUrl', e.cover_url,
		         'registeredCount', (SELECT count(*) FROM assoc_event_registrations r
		                              WHERE r.event_id=e.id AND r.registered=true),
		         'awaitingPayment', (SELECT count(*) FROM assoc_event_registrations r
		                              WHERE r.event_id=e.id AND r.registered=false AND r.invoice_id IS NOT NULL))
		FROM assoc_events e
		WHERE e.organisation_id=$1
		ORDER BY e.starts_at DESC, e.id DESC
		LIMIT $2 OFFSET $3`
	return s.listContent(ctx, adminID, orgID, q, limit, offset)
}

func (s *Service) ListAdminTasks(ctx context.Context, adminID, orgID string, limit, offset int) ([]AdminContentRow, error) {
	const q = `
		SELECT t.id::text, t.title, COALESCE(mp.full_name, ''), t.status,
		       t.due_date::text, t.created_at::text,
		       jsonb_build_object(
		         'description', t.description, 'priority', t.priority,
		         'dueDate', t.due_date, 'assigneeId', t.assignee_id,
		         'assigneeName', mp.full_name, 'committeeId', t.committee_id,
		         'meetingId', t.meeting_id, 'checklist', t.checklist)
		FROM assoc_tasks t
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id = t.assignee_id
		WHERE t.organisation_id=$1
		ORDER BY t.created_at DESC, t.id DESC
		LIMIT $2 OFFSET $3`
	return s.listContent(ctx, adminID, orgID, q, limit, offset)
}

// ListAdminDuesRuns shows the dues runs raised for an organisation, so an admin
// can see what has already been billed before raising more.
func (s *Service) ListAdminDuesRuns(ctx context.Context, adminID, orgID string, limit, offset int) ([]AdminContentRow, error) {
	const q = `
		SELECT r.id::text, r.title, r.scope, 'RAISED',
		       r.created_at::text, r.created_at::text,
		       jsonb_build_object(
		         'invoiced', r.invoiced, 'skipped', r.skipped, 'totalKobo', r.total_kobo,
		         'categoryId', r.category_id, 'chapterId', r.chapter_id,
		         'paidCount', (SELECT count(*) FROM assoc_dues_invoices i
		                        WHERE i.run_id=r.id AND i.status='PAID'),
		         'outstandingKobo', (SELECT COALESCE(SUM(i.amount_kobo),0) FROM assoc_dues_invoices i
		                              WHERE i.run_id=r.id AND i.status IN ('DUE','OVERDUE')))
		FROM assoc_dues_runs r
		WHERE r.organisation_id=$1
		ORDER BY r.created_at DESC, r.id DESC
		LIMIT $2 OFFSET $3`
	return s.listContent(ctx, adminID, orgID, q, limit, offset)
}
