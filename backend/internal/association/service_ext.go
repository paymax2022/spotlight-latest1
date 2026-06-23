package association

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
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
	_, orgID, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return nil, err
	}
	const q = `
		SELECT t.id, t.title, t.scope, t.posting_block,
		       COALESCE((SELECT body FROM assoc_chat_messages m WHERE m.thread_id=t.id ORDER BY created_at DESC LIMIT 1), ''),
		       COALESCE((SELECT to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM assoc_chat_messages m WHERE m.thread_id=t.id ORDER BY created_at DESC LIMIT 1), to_char(t.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
		FROM assoc_chat_threads t WHERE t.organisation_id=$1 ORDER BY 6 DESC`
	rows, err := s.db.Query(ctx, q, orgID)
	if err != nil {
		return nil, fmt.Errorf("association: list threads: %w", err)
	}
	defer rows.Close()
	out := []ChatThreadSummary{}
	for rows.Next() {
		var t ChatThreadSummary
		if err := rows.Scan(&t.ID, &t.Title, &t.Scope, &t.PostingBlock, &t.LastMessage, &t.LastAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Service) GetChatThread(ctx context.Context, userID, threadID string) (*ChatThread, error) {
	t := &ChatThread{}
	const q = `SELECT id, title, scope, posting_block, description FROM assoc_chat_threads WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, threadID).Scan(&t.ID, &t.Title, &t.Scope, &t.PostingBlock, &t.Description); err != nil {
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
	return t, rows.Err()
}

func (s *Service) SendChatMessage(ctx context.Context, userID, threadID, body string) (*ChatMessage, error) {
	m := &ChatMessage{ID: uuid.New().String(), ThreadID: threadID, AuthorID: userID, AuthorName: "You", Body: body, Mine: true}
	const q = `INSERT INTO assoc_chat_messages (id, thread_id, author_id, body)
	           VALUES ($1,$2,$3,$4) RETURNING to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')`
	if err := s.db.QueryRow(ctx, q, m.ID, threadID, userID, body).Scan(&m.CreatedAt); err != nil {
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

func (s *Service) GetAiNote(ctx context.Context, noteID string) (*AiNote, error) {
	n := &AiNote{}
	var decisions, actionItems, attendees []byte
	const q = `
		SELECT id, meeting_title, status, source, to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       COALESCE(summary,''), COALESCE(minutes,''), decisions, action_items, attendees, meeting_id
		FROM assoc_ai_notes WHERE id=$1`
	if err := s.db.QueryRow(ctx, q, noteID).Scan(
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

func (s *Service) GetAiNoteStatus(ctx context.Context, noteID string) (string, error) {
	var status string
	if err := s.db.QueryRow(ctx, `SELECT status FROM assoc_ai_notes WHERE id=$1`, noteID).Scan(&status); err != nil {
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
	const q = `INSERT INTO assoc_tasks (id, organisation_id, title, status, priority, meeting_id, created_by)
	           SELECT $1, $2, 'From minutes: ' || COALESCE(meeting_title,'action item'), 'ASSIGNED', 'MEDIUM', meeting_id, $4
	           FROM assoc_ai_notes WHERE id=$3`
	if _, err := s.db.Exec(ctx, q, taskID, orgID, noteID, userID); err != nil {
		return "", fmt.Errorf("association: convert action item: %w", err)
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

func (s *Service) ImportPreview(ctx context.Context, adminID string) (*ImportPreview, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	// Real implementation parses the uploaded file; this wave returns an empty
	// preview (the client supplies rows during the column-mapping step).
	return &ImportPreview{Rows: []ImportRow{}}, nil
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
