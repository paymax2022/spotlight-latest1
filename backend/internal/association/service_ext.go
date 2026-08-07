package association

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Service methods for the remaining endpoint groups (settings, support, chat,
// AI notes, join, bulk import, org publish). SQL-backed against the assoc_*
// schema (+ 20260629000000 settings columns). Separate file to limit merge
// surface. NOT compiled in-sandbox — see STATUS.md.

// profileMembershipID resolves the member_profiles row key for the caller.
func (s *Service) profileMembershipID(ctx context.Context, userID string) (string, error) {
	mid, _, err := s.primaryMembership(ctx, userID)
	return mid, err
}

// ─── Settings: notification prefs / security / preferences ────────────────────

func scanJSONB(raw []byte, into any) {
	if len(raw) == 0 || string(raw) == "{}" || string(raw) == "null" {
		return
	}
	_ = json.Unmarshal(raw, into)
}

func (s *Service) getProfileJSON(ctx context.Context, userID, column string, into any) error {
	mid, err := s.profileMembershipID(ctx, userID)
	if err != nil {
		return err
	}
	var raw []byte
	// #nosec G201 — column is a fixed internal literal, never user input.
	q := fmt.Sprintf(`SELECT %s FROM assoc_member_profiles WHERE membership_id=$1`, column)
	if err := s.db.QueryRow(ctx, q, mid).Scan(&raw); err != nil {
		return fmt.Errorf("association: read %s: %w", column, err)
	}
	scanJSONB(raw, into)
	return nil
}

func (s *Service) setProfileJSON(ctx context.Context, userID, column string, value any) error {
	mid, err := s.profileMembershipID(ctx, userID)
	if err != nil {
		return err
	}
	b, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("association: marshal %s: %w", column, err)
	}
	// #nosec G201 — column is a fixed internal literal, never user input.
	q := fmt.Sprintf(`UPDATE assoc_member_profiles SET %s=$2 WHERE membership_id=$1`, column)
	if _, err := s.db.Exec(ctx, q, mid, b); err != nil {
		return fmt.Errorf("association: write %s: %w", column, err)
	}
	return nil
}

func (s *Service) GetNotificationPrefs(ctx context.Context, userID string) (*NotificationPrefs, error) {
	// Sensible defaults (on) before the member customises them.
	p := NotificationPrefs{Announcements: true, DuesReminders: true, Meetings: true, Tasks: true, Chat: false, Events: true}
	if err := s.getProfileJSON(ctx, userID, "notification_prefs", &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Service) UpdateNotificationPrefs(ctx context.Context, userID string, p NotificationPrefs) (*NotificationPrefs, error) {
	if err := s.setProfileJSON(ctx, userID, "notification_prefs", p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Service) GetSecuritySettings(ctx context.Context, userID string) (*SecuritySettings, error) {
	sec := SecuritySettings{}
	if err := s.getProfileJSON(ctx, userID, "security", &sec); err != nil {
		return nil, err
	}
	return &sec, nil
}

func (s *Service) UpdateSecuritySettings(ctx context.Context, userID string, sec SecuritySettings) (*SecuritySettings, error) {
	if err := s.setProfileJSON(ctx, userID, "security", sec); err != nil {
		return nil, err
	}
	return &sec, nil
}

func (s *Service) GetPreferences(ctx context.Context, userID string) (*Preferences, error) {
	p := Preferences{Language: "English", Theme: "SYSTEM"}
	if err := s.getProfileJSON(ctx, userID, "preferences", &p); err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Service) UpdatePreferences(ctx context.Context, userID string, p Preferences) (*Preferences, error) {
	if err := s.setProfileJSON(ctx, userID, "preferences", p); err != nil {
		return nil, err
	}
	return &p, nil
}

// ─── Settings: devices ────────────────────────────────────────────────────────

func (s *Service) GetDevices(ctx context.Context, userID string) ([]Device, error) {
	const q = `
		SELECT id, COALESCE(name,''), COALESCE(platform,''), COALESCE(to_char(last_active,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),''), location
		FROM assoc_devices WHERE user_id=$1 AND revoked_at IS NULL ORDER BY last_active DESC NULLS LAST`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("association: list devices: %w", err)
	}
	defer rows.Close()
	out := []Device{}
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.Name, &d.Platform, &d.LastActive, &d.Location); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Service) RevokeDevice(ctx context.Context, userID, deviceID string) error {
	const q = `UPDATE assoc_devices SET revoked_at = now() WHERE id=$1 AND user_id=$2`
	tag, err := s.db.Exec(ctx, q, deviceID, userID)
	if err != nil {
		return fmt.Errorf("association: revoke device: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrForbidden
	}
	return nil
}

// ─── Support ──────────────────────────────────────────────────────────────────

func (s *Service) GetFaqs(ctx context.Context) ([]FaqItem, error) {
	// Static help content (no table needed).
	return []FaqItem{
		{ID: "f1", Question: "How do I pay my dues?", Answer: "Open Dues, choose the invoice, and pay with your wallet or card. Confirmation is instant and your card updates automatically."},
		{ID: "f2", Question: "Why is my membership card restricted?", Answer: "Cards are restricted when dues are outstanding beyond the grace period. Settle the balance under Dues to restore access."},
		{ID: "f3", Question: "How do I join a committee?", Answer: "Open Committees, select one, and tap Request to join. A committee admin will review your request."},
		{ID: "f4", Question: "How are meeting minutes generated?", Answer: "Secretaries record or upload a meeting under AI notes; the AI drafts minutes which a human approves before publishing."},
	}, nil
}

func (s *Service) GetTickets(ctx context.Context, userID string) ([]SupportTicketSummary, error) {
	mid, err := s.profileMembershipID(ctx, userID)
	if err != nil {
		return nil, err
	}
	const q = `
		SELECT id, subject, category, status, to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM assoc_support_tickets WHERE membership_id=$1 ORDER BY updated_at DESC`
	rows, err := s.db.Query(ctx, q, mid)
	if err != nil {
		return nil, fmt.Errorf("association: list tickets: %w", err)
	}
	defer rows.Close()
	out := []SupportTicketSummary{}
	for rows.Next() {
		var t SupportTicketSummary
		if err := rows.Scan(&t.ID, &t.Subject, &t.Category, &t.Status, &t.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) GetTicket(ctx context.Context, userID, ticketID string) (*SupportTicket, error) {
	mid, err := s.profileMembershipID(ctx, userID)
	if err != nil {
		return nil, err
	}
	t := &SupportTicket{}
	const q = `
		SELECT id, subject, category, status, to_char(updated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM assoc_support_tickets WHERE id=$1 AND membership_id=$2`
	if err := s.db.QueryRow(ctx, q, ticketID, mid).Scan(&t.ID, &t.Subject, &t.Category, &t.Status, &t.UpdatedAt); err != nil {
		return nil, fmt.Errorf("association: ticket not found: %w", err)
	}
	const qm = `
		SELECT id, author, from_support, body, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM assoc_support_messages WHERE ticket_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, qm, ticketID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	t.Messages = []TicketMessage{}
	for rows.Next() {
		var m TicketMessage
		if err := rows.Scan(&m.ID, &m.Author, &m.FromSupport, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		t.Messages = append(t.Messages, m)
	}
	return t, rows.Err()
}

func (s *Service) CreateTicket(ctx context.Context, userID string, in CreateTicketInput) (string, error) {
	mid, err := s.profileMembershipID(ctx, userID)
	if err != nil {
		return "", err
	}
	id := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO assoc_support_tickets (id, membership_id, subject, category, status) VALUES ($1,$2,$3,$4,'OPEN')`,
		id, mid, in.Subject, in.Category); err != nil {
		return "", fmt.Errorf("association: create ticket: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO assoc_support_messages (id, ticket_id, author, from_support, body) VALUES ($1,$2,'You',false,$3)`,
		uuid.New().String(), id, in.Message); err != nil {
		return "", fmt.Errorf("association: create ticket message: %w", err)
	}
	return id, tx.Commit(ctx)
}

func (s *Service) ReplyTicket(ctx context.Context, userID, ticketID, body string) (*TicketMessage, error) {
	mid, err := s.profileMembershipID(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Ensure the ticket belongs to the caller.
	var owner string
	if err := s.db.QueryRow(ctx, `SELECT membership_id FROM assoc_support_tickets WHERE id=$1`, ticketID).Scan(&owner); err != nil {
		return nil, fmt.Errorf("association: ticket not found: %w", err)
	}
	if owner != mid {
		return nil, ErrForbidden
	}
	m := &TicketMessage{ID: uuid.New().String(), Author: "You", FromSupport: false, Body: body}
	const q = `INSERT INTO assoc_support_messages (id, ticket_id, author, from_support, body)
	           VALUES ($1,$2,'You',false,$3) RETURNING to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
	if err := s.db.QueryRow(ctx, q, m.ID, ticketID, body).Scan(&m.CreatedAt); err != nil {
		return nil, fmt.Errorf("association: reply ticket: %w", err)
	}
	_, _ = s.db.Exec(ctx, `UPDATE assoc_support_tickets SET updated_at=now() WHERE id=$1`, ticketID)
	return m, nil
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

func (s *Service) GetChatThreads(ctx context.Context, userID string) ([]ChatThreadSummary, error) {
	mid, orgID, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Threads are organisation-scoped, so memberCount is the org's active
	// membership count. unreadCount = messages after the caller's last_read_at
	// (default 'epoch' → all messages unread until first viewed). muted comes
	// from the per-member thread-state row (absent → false).
	const q = `
		SELECT t.id, t.title, t.scope, t.posting_block,
		       COALESCE((SELECT body FROM assoc_chat_messages m WHERE m.thread_id=t.id ORDER BY created_at DESC LIMIT 1), ''),
		       COALESCE((SELECT to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM assoc_chat_messages m WHERE m.thread_id=t.id ORDER BY created_at DESC LIMIT 1), to_char(t.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
		       COALESCE(st.muted, false),
		       (SELECT count(*) FROM assoc_chat_messages m
		          WHERE m.thread_id=t.id
		            AND m.created_at > COALESCE(st.last_read_at, 'epoch'::timestamptz)
		            AND m.author_id IS DISTINCT FROM $2::uuid),
		       (SELECT count(*) FROM assoc_memberships mm WHERE mm.organisation_id=$1 AND mm.status='ACTIVE')
		FROM assoc_chat_threads t
		LEFT JOIN assoc_chat_thread_state st ON st.thread_id=t.id AND st.membership_id=$3
		WHERE t.organisation_id=$1
		ORDER BY 6 DESC`
	rows, err := s.db.Query(ctx, q, orgID, userID, mid)
	if err != nil {
		return nil, fmt.Errorf("association: list threads: %w", err)
	}
	defer rows.Close()
	out := []ChatThreadSummary{}
	for rows.Next() {
		var t ChatThreadSummary
		if err := rows.Scan(&t.ID, &t.Title, &t.Scope, &t.PostingBlock, &t.LastMessage, &t.LastAt,
			&t.Muted, &t.UnreadCount, &t.MemberCount); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) GetChatThread(ctx context.Context, userID, threadID string) (*ChatThread, error) {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	t := &ChatThread{}
	// Cross-group isolation (CH-005 / §4.9): only serve the thread when the caller
	// holds an ACTIVE membership in the THREAD'S organisation. A foreign-org caller
	// gets "thread not found" (fail-closed, no existence leak). memberCount is
	// derived from the thread's own org. NB: assoc_chat_threads has no `description`
	// column — selecting a literal '' fixes a latent broken-query bug uncovered here.
	const q = `
		SELECT t.id, t.title, t.scope, t.posting_block, '',
		       COALESCE(st.muted, false),
		       (SELECT count(*) FROM assoc_memberships mm WHERE mm.organisation_id=t.organisation_id AND mm.status='ACTIVE')
		FROM assoc_chat_threads t
		LEFT JOIN assoc_chat_thread_state st ON st.thread_id=t.id AND st.membership_id=$2
		WHERE t.id=$1
		  AND EXISTS (SELECT 1 FROM assoc_memberships v
		              WHERE v.user_id=$3 AND v.status='ACTIVE'
		                AND v.organisation_id = t.organisation_id)`
	if err := s.db.QueryRow(ctx, q, threadID, mid, userID).Scan(
		&t.ID, &t.Title, &t.Scope, &t.PostingBlock, &t.Description, &t.Muted, &t.MemberCount,
	); err != nil {
		return nil, fmt.Errorf("association: thread not found: %w", err)
	}
	const qm = `
		SELECT id, thread_id, COALESCE(author_id::text,''), body, pinned, system,
		       to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM assoc_chat_messages WHERE thread_id=$1 ORDER BY created_at`
	rows, err := s.db.Query(ctx, qm, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	t.Messages = []ChatMessage{}
	for rows.Next() {
		var m ChatMessage
		if err := rows.Scan(&m.ID, &m.ThreadID, &m.AuthorID, &m.Body, &m.Pinned, &m.System, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.Mine = m.AuthorID == userID
		m.AuthorName = "Member"
		t.Messages = append(t.Messages, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Viewing the thread marks it read: upsert last_read_at=now() so subsequent
	// unread counts reset. Best-effort — a write failure must not block the read.
	_ = s.markThreadRead(ctx, mid, threadID)
	t.UnreadCount = 0
	return t, nil
}

// markThreadRead upserts the caller's thread-state row with last_read_at=now(),
// preserving any existing mute preference.
func (s *Service) markThreadRead(ctx context.Context, membershipID, threadID string) error {
	const q = `
		INSERT INTO assoc_chat_thread_state (thread_id, membership_id, last_read_at, updated_at)
		VALUES ($1, $2, now(), now())
		ON CONFLICT (thread_id, membership_id)
		DO UPDATE SET last_read_at = now(), updated_at = now()`
	_, err := s.db.Exec(ctx, q, threadID, membershipID)
	return err
}

// MuteThread persists the caller's per-thread mute preference. Idempotent.
func (s *Service) MuteThread(ctx context.Context, userID, threadID string, muted bool) error {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return err
	}
	// Cross-group check (CH-005): only mute a thread in an org the caller is an
	// ACTIVE member of — fail-closed otherwise (no writing state for foreign threads).
	var ok bool
	if err := s.db.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM assoc_chat_threads t
		   JOIN assoc_memberships v ON v.organisation_id = t.organisation_id
		   WHERE t.id=$1 AND v.user_id=$2 AND v.status='ACTIVE')`,
		threadID, userID).Scan(&ok); err != nil || !ok {
		return ErrForbidden
	}
	const q = `
		INSERT INTO assoc_chat_thread_state (thread_id, membership_id, muted, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (thread_id, membership_id)
		DO UPDATE SET muted = $3, updated_at = now()`
	if _, err := s.db.Exec(ctx, q, threadID, mid, muted); err != nil {
		return fmt.Errorf("association: mute thread: %w", err)
	}
	return nil
}

func (s *Service) SendChatMessage(ctx context.Context, userID, threadID, body string) (*ChatMessage, error) {
	m := &ChatMessage{ID: uuid.New().String(), ThreadID: threadID, AuthorID: userID, AuthorName: "You", Body: body, Mine: true}
	// Cross-group write isolation (CH-005 / §4.9): the INSERT is conditional on the
	// caller holding an ACTIVE membership in the thread's organisation. If not, no
	// row is written and QueryRow returns ErrNoRows → ErrForbidden (fail-closed).
	const q = `
		INSERT INTO assoc_chat_messages (id, thread_id, author_id, body)
		SELECT $1, $2, $3, $4
		WHERE EXISTS (
			SELECT 1 FROM assoc_chat_threads t
			JOIN assoc_memberships v ON v.organisation_id = t.organisation_id
			WHERE t.id = $2 AND v.user_id = $3 AND v.status = 'ACTIVE')
		RETURNING to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
	if err := s.db.QueryRow(ctx, q, m.ID, threadID, userID, body).Scan(&m.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrForbidden
		}
		return nil, fmt.Errorf("association: send message: %w", err)
	}
	return m, nil
}

// ─── AI notes ─────────────────────────────────────────────────────────────────

func (s *Service) GetAiNotes(ctx context.Context, userID string) ([]AiNoteSummary, error) {
	_, orgID, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	const q = `
		SELECT id, meeting_title, status, source, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''
		FROM assoc_ai_notes WHERE organisation_id=$1 ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("association: list ai notes: %w", err)
	}
	defer rows.Close()
	out := []AiNoteSummary{}
	for rows.Next() {
		var n AiNoteSummary
		if err := rows.Scan(&n.ID, &n.MeetingTitle, &n.Status, &n.Source, &n.CreatedAt, &n.DurationLabel); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (s *Service) GetAiNote(ctx context.Context, userID, noteID string) (*AiNote, error) {
	n := &AiNote{}
	var decisions, actionItems, attendees []byte
	// Access-scoped (AI-007 / §4.9): only readable by an ACTIVE member of the
	// note's organisation. A foreign-org caller gets "not found" (fail-closed).
	const q = `
		SELECT id, meeting_title, status, source, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       COALESCE(summary,''), COALESCE(minutes,''), decisions, action_items, attendees, meeting_id
		FROM assoc_ai_notes n
		WHERE n.id=$1
		  AND EXISTS (SELECT 1 FROM assoc_memberships v
		              WHERE v.user_id=$2 AND v.status='ACTIVE'
		                AND v.organisation_id = n.organisation_id)`
	if err := s.db.QueryRow(ctx, q, noteID, userID).Scan(
		&n.ID, &n.MeetingTitle, &n.Status, &n.Source, &n.CreatedAt,
		&n.Summary, &n.Minutes, &decisions, &actionItems, &attendees, &n.MeetingID,
	); err != nil {
		return nil, fmt.Errorf("association: ai note not found: %w", err)
	}
	scanJSONB(decisions, &n.Decisions)
	scanJSONB(actionItems, &n.ActionItems)
	scanJSONB(attendees, &n.Attendees)
	n.Unresolved = []string{}
	return n, nil
}

func (s *Service) GetAiNoteStatus(ctx context.Context, userID, noteID string) (string, error) {
	var status string
	// Access-scoped (AI-007): status only readable by an ACTIVE member of the org.
	const q = `
		SELECT status FROM assoc_ai_notes n
		WHERE n.id=$1
		  AND EXISTS (SELECT 1 FROM assoc_memberships v
		              WHERE v.user_id=$2 AND v.status='ACTIVE'
		                AND v.organisation_id = n.organisation_id)`
	if err := s.db.QueryRow(ctx, q, noteID, userID).Scan(&status); err != nil {
		return "", fmt.Errorf("association: ai note not found: %w", err)
	}
	return status, nil
}

func (s *Service) CreateAiNote(ctx context.Context, userID string, in CreateAiNoteInput) (string, string, error) {
	_, orgID, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return "", "", err
	}
	id := uuid.New().String()
	const q = `INSERT INTO assoc_ai_notes (id, organisation_id, meeting_id, meeting_title, source, status)
	           VALUES ($1,$2,$3,$4,$5,'PROCESSING')`
	if _, err := s.db.Exec(ctx, q, id, orgID, in.MeetingID, in.MeetingTitle, in.Source); err != nil {
		return "", "", fmt.Errorf("association: create ai note: %w", err)
	}
	return id, "PROCESSING", nil
}

func (s *Service) SetAiNoteStatus(ctx context.Context, adminID, noteID, status, action string) error {
	// Authorization: approving/publishing meeting minutes is an admin-style
	// mutation reserved for an admin OF THE NOTE'S organisation (any admin role,
	// SECRETARY-or-above — the intended minutes reviewer). Org-scoped so an admin
	// of another org cannot publish this org's minutes (cross-org IDOR). A missing
	// note yields "not found"; a non-admin (or foreign-org admin) gets ErrForbidden
	// and no row is written (fail-closed).
	var noteOrg string
	if err := s.db.QueryRow(ctx, `SELECT organisation_id FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&noteOrg); err != nil {
		return fmt.Errorf("association: ai note not found: %w", err)
	}
	if err := s.requireAdminInOrg(ctx, adminID, noteOrg); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE assoc_ai_notes SET status=$2 WHERE id=$1`, noteID, status); err != nil {
		return fmt.Errorf("association: ai note status: %w", err)
	}
	if err := s.audit(ctx, tx, "", adminID, action, "ai_note", noteID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) ConvertActionItem(ctx context.Context, userID, noteID, itemID string) (string, error) {
	_, orgID, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return "", err
	}
	taskID := uuid.New().String()
	// Source note must belong to the caller's organisation (AI-007 scope): the
	// SELECT is gated on organisation_id=$2 so a cross-org note yields no row and
	// no task is created (fail-closed via RowsAffected).
	const q = `INSERT INTO assoc_tasks (id, organisation_id, title, status, priority, meeting_id, created_by)
	           SELECT $1, $2, 'From minutes: ' || COALESCE(meeting_title,'action item'), 'ASSIGNED', 'MEDIUM', meeting_id, $4
	           FROM assoc_ai_notes WHERE id=$3 AND organisation_id=$2`
	tag, err := s.db.Exec(ctx, q, taskID, orgID, noteID, userID)
	if err != nil {
		return "", fmt.Errorf("association: convert action item: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return "", ErrForbidden
	}
	_ = itemID // item granularity tracked in the note's action_items jsonb
	return taskID, nil
}

// ─── Join: code validation + apply ────────────────────────────────────────────

func (s *Service) ValidateCode(ctx context.Context, kind, code string) (*CodeValidation, error) {
	// No dedicated codes table yet: the organisation acronym doubles as the
	// invite/access code for this wave. Unknown codes are reported invalid.
	res := &CodeValidation{Kind: kind, Valid: false, Message: "Code not recognised."}
	var id, name string
	var acronym *string
	err := s.db.QueryRow(ctx,
		`SELECT id, name, acronym FROM assoc_organisations WHERE upper(COALESCE(acronym,''))=upper($1) AND published=true LIMIT 1`,
		strings.TrimSpace(code),
	).Scan(&id, &name, &acronym)
	if err != nil {
		return res, nil // not found → invalid (not an error)
	}
	res.Valid = true
	res.OrganisationID = &id
	res.OrganisationName = &name
	res.OrganisationAcronym = acronym
	res.Message = fmt.Sprintf("Code accepted for %s.", name)
	return res, nil
}

func (s *Service) SubmitApplication(ctx context.Context, userID string, d JoinDraft) (*ApplicationResult, error) {
	var groupType, orgName string
	if err := s.db.QueryRow(ctx, `SELECT group_type, name FROM assoc_organisations WHERE id=$1`, d.OrganisationID).Scan(&groupType, &orgName); err != nil {
		return nil, fmt.Errorf("association: organisation not found: %w", err)
	}
	status := "PENDING_CHAPTER"
	switch groupType {
	case "OPEN":
		status = "APPROVED"
	case "PAID":
		status = "PENDING_PAYMENT"
	}
	id := uuid.New().String()
	const q = `INSERT INTO assoc_applications (id, organisation_id, user_id, category_id, chapter_id, sponsor_name, status)
	           VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := s.db.Exec(ctx, q, id, d.OrganisationID, userID, d.CategoryID, d.ChapterID, d.SponsorName, status); err != nil {
		return nil, fmt.Errorf("association: submit application: %w", err)
	}
	res := &ApplicationResult{
		ApplicationID: id, Status: status, OrganisationName: orgName,
	}
	switch status {
	case "APPROVED":
		res.Message = "You are now a member. Welcome aboard!"
	case "PENDING_PAYMENT":
		res.Message = "Almost there — complete your registration payment to activate membership."
		next := "Pay registration fee"
		res.NextStep = &next
	default:
		res.Message = "Your application has been sent to your chapter admin for review."
		next := "Awaiting chapter approval"
		res.NextStep = &next
	}
	return res, nil
}

// ─── Bulk import (admin) ──────────────────────────────────────────────────────

func (s *Service) ImportPreview(ctx context.Context, adminID, orgID, fileName string, r io.Reader) (*ImportPreview, error) {
	// Org-scope: caller must hold ImportMembers IN the target org. The old
	// org-agnostic requireCap let an admin of any org preview membership against a
	// foreign org — a per-email cross-org membership-existence oracle.
	if err := s.requireCapInOrg(ctx, adminID, orgID, func(c AdminCapabilities) bool { return c.ImportMembers }); err != nil {
		return nil, err
	}
	// Resolve the target organisation: explicit org_id wins, else the caller's
	// primary membership. Duplicate detection is scoped to this org.
	if orgID == "" {
		_, oid, err := s.primaryMembership(ctx, adminID)
		if err != nil {
			return nil, err
		}
		orgID = oid
	}

	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1 // tolerate ragged rows

	// Skip the header row (same shape as BulkImportMembers:
	// name,email,phone,member_code,category_label,chapter_label).
	if _, err := cr.Read(); err != nil {
		if err == io.EOF {
			return &ImportPreview{FileName: fileName, Rows: []ImportRow{}}, nil
		}
		return nil, fmt.Errorf("association: preview: read header: %w", err)
	}

	preview := &ImportPreview{FileName: fileName, Rows: []ImportRow{}}
	seen := map[string]bool{} // in-file dedupe by lowercased email
	rowNum := 0
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		rowNum++
		if err != nil {
			issue := "Malformed row"
			preview.Invalid++
			preview.Rows = append(preview.Rows, ImportRow{RowNum: rowNum, Issue: &issue})
			continue
		}
		parsed := parseImportRow(rec)
		row := ImportRow{
			RowNum:  rowNum,
			Name:    parsed.Name,
			Email:   parsed.Email,
			Phone:   parsed.Phone,
			Chapter: parsed.ChapterLabel,
		}

		// Invalid: missing/!looks-like email.
		email := strings.ToLower(strings.TrimSpace(parsed.Email))
		if email == "" || !strings.Contains(email, "@") {
			issue := "Missing or invalid email"
			row.Issue = &issue
			preview.Invalid++
			preview.Rows = append(preview.Rows, row)
			continue
		}

		// Duplicate: repeated within the file, or already an active member of org.
		dup := seen[email]
		if !dup {
			var existing int
			_ = s.db.QueryRow(ctx, `
				SELECT count(*) FROM assoc_memberships m
				JOIN auth.users u ON u.id = m.user_id
				WHERE m.organisation_id=$1 AND lower(u.email)=$2`,
				orgID, email).Scan(&existing)
			dup = existing > 0
		}
		seen[email] = true
		if dup {
			issue := "Already a member"
			row.Issue = &issue
			preview.Duplicates++
			preview.Rows = append(preview.Rows, row)
			continue
		}

		preview.Valid++
		preview.Rows = append(preview.Rows, row)
	}
	preview.Total = rowNum
	return preview, nil
}

func (s *Service) ConfirmImport(ctx context.Context, adminID string, sendInvites bool, preview ImportPreview) (*ImportResult, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	_, orgID, err := s.primaryMembership(ctx, adminID)
	if err != nil {
		return nil, err
	}
	batchID := uuid.New().String()
	imported := preview.Valid
	skipped := preview.Duplicates + preview.Invalid
	invited := 0
	if sendInvites {
		invited = imported
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	const q = `INSERT INTO assoc_import_batches (id, organisation_id, file_name, total, imported, skipped, invited, uploaded_by)
	           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`
	if _, err := tx.Exec(ctx, q, batchID, orgID, preview.FileName, preview.Total, imported, skipped, invited, adminID); err != nil {
		return nil, fmt.Errorf("association: record import: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, adminID, "IMPORT", "import_batch", batchID, map[string]any{"imported": imported, "skipped": skipped}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &ImportResult{Imported: imported, Skipped: skipped, Invited: invited, BatchID: batchID}, nil
}

// ─── Organisation publish (founder) ───────────────────────────────────────────

func (s *Service) PublishOrganisation(ctx context.Context, userID string, d OrgDraft) (*PublishResult, error) {
	if !d.AcceptedTerms {
		return nil, fmt.Errorf("association: terms must be accepted")
	}
	orgID := uuid.New().String()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const insOrg = `
		INSERT INTO assoc_organisations
		  (id, name, acronym, category, description, group_type, approval_rule, registration_fee_kobo, requires_payment, created_by, published)
		VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,true)`
	if _, err := tx.Exec(ctx, insOrg, orgID, d.Name, d.Acronym, d.Category, d.Description, d.GroupType, nz(d.ApprovalRule, "ADMIN"),
		d.RegistrationFeeKobo, d.RegistrationFeeKobo > 0, userID); err != nil {
		return nil, fmt.Errorf("association: insert organisation: %w", err)
	}
	for _, ch := range d.Chapters {
		if _, err := tx.Exec(ctx, `INSERT INTO assoc_chapters (id, organisation_id, name, level) VALUES ($1,$2,$3,$4)`,
			uuid.New().String(), orgID, ch.Name, nz(ch.Level, "STATE")); err != nil {
			return nil, fmt.Errorf("association: insert chapter: %w", err)
		}
	}
	for _, cm := range d.Committees {
		if _, err := tx.Exec(ctx, `INSERT INTO assoc_committees (id, organisation_id, name) VALUES ($1,$2,$3)`,
			uuid.New().String(), orgID, cm.Name); err != nil {
			return nil, fmt.Errorf("association: insert committee: %w", err)
		}
	}
	for _, cat := range d.Categories {
		if _, err := tx.Exec(ctx, `INSERT INTO assoc_membership_categories (id, organisation_id, label, dues_kobo, cadence) VALUES ($1,$2,$3,$4,$5)`,
			uuid.New().String(), orgID, cat.Label, cat.DuesKobo, nz(cat.Cadence, "ANNUAL")); err != nil {
			return nil, fmt.Errorf("association: insert category: %w", err)
		}
	}
	if err := s.audit(ctx, tx, orgID, userID, "ORG_PUBLISH", "organisation", orgID, map[string]any{"name": d.Name}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &PublishResult{OrganisationID: orgID, Name: d.Name}, nil
}

// nz returns def when v is empty.
func nz(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}
