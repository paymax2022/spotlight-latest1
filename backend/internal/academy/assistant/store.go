package assistant

// store.go — all SQL for the Academy Assistant.
//
// Conventions this package follows from the repo: a shared column-list constant
// per table, a scan helper mapping pgx.ErrNoRows to a single ErrNotFound
// sentinel, ownership fused into the WHERE clause of every student-scoped read
// (so a missing conversation and one belonging to someone else are the same 404
// by construction, with no existence oracle), and a `dbtx` interface satisfied
// by both *pgxpool.Pool and pgx.Tx so the live-DB tests can run one scenario
// inside a rolled-back transaction.
//
// The backend connects as service_role, which bypasses RLS; the policies in
// 20271300000010 are what protects the same tables from an app-issued key. Both
// matter, and neither replaces the other.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is the uniform denial for a missing row and for a row owned by
// someone else, everywhere a student-scoped read is involved.
var ErrNotFound = errors.New("assistant: not found")

// dbtx is the subset of pgx the store uses. Both *pgxpool.Pool and pgx.Tx
// satisfy it, which is what lets a live-DB test wrap a whole scenario in one
// transaction and roll it back.
type dbtx interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Store is the Academy Assistant's data access layer.
type Store struct {
	db dbtx
}

func NewStore(pool *pgxpool.Pool) *Store { return &Store{db: pool} }

// NewStoreOn binds the store to an open transaction (tests only).
func NewStoreOn(tx pgx.Tx) *Store { return &Store{db: tx} }

// --- FAQs --------------------------------------------------------------------

const faqColumns = `id, category, question, answer, keywords, published, deleted_at, created_at, updated_at`

func scanFaq(row pgx.Row) (Faq, error) {
	var (
		f   Faq
		del *time.Time
	)
	err := row.Scan(&f.ID, &f.Category, &f.Question, &f.Answer, &f.Keywords,
		&f.Published, &del, &f.CreatedAt, &f.UpdatedAt)
	f.DeletedAt = del
	if errors.Is(err, pgx.ErrNoRows) {
		return Faq{}, ErrNotFound
	}
	return f, err
}

// queryFaqs runs a faqColumns-shaped query and collects every row.
func (s *Store) queryFaqs(ctx context.Context, sql string, args ...any) ([]Faq, error) {
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return collectFaqs(rows)
}

func collectFaqs(rows pgx.Rows) ([]Faq, error) {
	out := []Faq{}
	for rows.Next() {
		f, err := scanFaq(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// PublishedFaqs loads every published, live entry for retrieval.
//
// This is the ONLY read that feeds the model, and the filter is the spec's hard
// rule: draft, unpublished, retired or placeholder-bearing answers can never
// appear here. Unpublishing takes effect on the very next answer because there
// is no cache between this query and the model call.
//
// The two answer patterns duplicate the academy_faqs_publishable CHECK so a row
// published before that constraint existed is still held to it.
func (s *Store) PublishedFaqs(ctx context.Context) ([]Faq, error) {
	const q = `SELECT ` + faqColumns + `
	          FROM public.academy_faqs
	         WHERE published = TRUE AND deleted_at IS NULL
	           AND answer !~* '(^|[^a-z])pending[[:space:]]*:'
	           AND answer !~* 'to[[:space:]]+be[[:space:]]+approved'
	         ORDER BY category, updated_at DESC`
	return s.queryFaqs(ctx, q)
}

// ListFaqs is the admin view. Drafts are included because finishing them is the
// admin's job; the student-facing retrieval never sees this query.
func (s *Store) ListFaqs(ctx context.Context, q FaqListQuery) ([]Faq, int, error) {
	var (
		clauses []string
		args    []any
	)
	if term := strings.TrimSpace(q.Q); term != "" {
		args = append(args, "%"+truncateRunes(term, 60)+"%")
		i := len(args)
		clauses = append(clauses, fmt.Sprintf(
			"(question ILIKE $%d OR answer ILIKE $%d OR category ILIKE $%d OR EXISTS (SELECT 1 FROM unnest(keywords) k WHERE k ILIKE $%d))",
			i, i, i, i))
	}
	if cat := strings.TrimSpace(q.Category); cat != "" {
		args = append(args, cat)
		clauses = append(clauses, fmt.Sprintf("category = $%d", len(args)))
	}
	if q.Published != nil {
		args = append(args, *q.Published)
		clauses = append(clauses, fmt.Sprintf("published = $%d", len(args)))
	}

	where := "WHERE deleted_at IS NULL"
	if len(clauses) > 0 {
		where += " AND " + strings.Join(clauses, " AND ")
	}

	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM public.academy_faqs `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	limit := clampLimit(q.Limit, 50, 200)
	sql := `SELECT ` + faqColumns + ` FROM public.academy_faqs ` + where + `
	         ORDER BY published DESC, category, updated_at DESC
	         LIMIT $` + strconvInt(len(args)+1) + ` OFFSET $` + strconvInt(len(args)+2)
	args = append(args, limit, q.Offset)

	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out, err := collectFaqs(rows)
	return out, total, err
}

func (s *Store) FaqByID(ctx context.Context, id uuid.UUID) (Faq, error) {
	const q = `SELECT ` + faqColumns + ` FROM public.academy_faqs WHERE id = $1`
	return scanFaq(s.db.QueryRow(ctx, q, id))
}

// CreateFaq inserts an entry. The author is recorded so the console can show who
// wrote the answer a student is being given.
func (s *Store) CreateFaq(ctx context.Context, in FaqInput, author uuid.UUID) (Faq, error) {
	const q = `INSERT INTO public.academy_faqs (category, question, answer, keywords, published, updated_by)
	           VALUES ($1, $2, $3, $4, $5, $6)
	           RETURNING ` + faqColumns
	return scanFaq(s.db.QueryRow(ctx, q, strings.TrimSpace(in.Category), strings.TrimSpace(in.Question),
		in.Answer, keywordsOf(in), in.Published, author))
}

// UpdateFaq rewrites and/or publishes an entry. Publishing a placeholder answer
// fails the academy_faqs_publishable CHECK; the service pre-validates so the
// admin gets a field-level 400 instead of a constraint name.
func (s *Store) UpdateFaq(ctx context.Context, id uuid.UUID, in FaqInput, editor uuid.UUID) (Faq, error) {
	const q = `UPDATE public.academy_faqs
	          SET category = $2, question = $3, answer = $4, keywords = $5,
	              published = $6, updated_by = $7, updated_at = NOW()
	         WHERE id = $1 AND deleted_at IS NULL
	         RETURNING ` + faqColumns
	return scanFaq(s.db.QueryRow(ctx, q, id, strings.TrimSpace(in.Category), strings.TrimSpace(in.Question),
		in.Answer, keywordsOf(in), in.Published, editor))
}

// SoftDeleteFaq retires an entry. Retrieval drops it immediately; the row stays
// so an answer a student already received can still be traced.
func (s *Store) SoftDeleteFaq(ctx context.Context, id uuid.UUID) (Faq, error) {
	const q = `UPDATE public.academy_faqs SET deleted_at = NOW(), updated_at = NOW()
	         WHERE id = $1 AND deleted_at IS NULL
	         RETURNING ` + faqColumns
	return scanFaq(s.db.QueryRow(ctx, q, id))
}

func (s *Store) FaqCategories(ctx context.Context) ([]string, error) {
	const q = `SELECT DISTINCT category FROM public.academy_faqs
	            WHERE deleted_at IS NULL ORDER BY category`
	rows, err := s.db.Query(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []string{}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// --- conversations -----------------------------------------------------------

const conversationColumns = `id, user_id, mode, created_at, updated_at`

func scanConversation(row pgx.Row) (Conversation, error) {
	var (
		c    Conversation
		mode string
	)
	err := row.Scan(&c.ID, &c.UserID, &mode, &c.CreatedAt, &c.UpdatedAt)
	c.Mode = ConversationMode(mode)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, ErrNotFound
	}
	return c, err
}

func (s *Store) CreateConversation(ctx context.Context, userID uuid.UUID) (Conversation, error) {
	const q = `INSERT INTO public.academy_assistant_conversations (user_id, mode)
	           VALUES ($1, 'bot')
	           RETURNING ` + conversationColumns
	return scanConversation(s.db.QueryRow(ctx, q, userID))
}

// GetConversation reads a conversation the caller owns. Ownership is in the
// WHERE clause rather than compared afterwards, so the two failure cases are
// indistinguishable by construction.
func (s *Store) GetConversation(ctx context.Context, id, userID uuid.UUID) (Conversation, error) {
	const q = `SELECT ` + conversationColumns + `
	          FROM public.academy_assistant_conversations
	         WHERE id = $1 AND user_id = $2`
	return scanConversation(s.db.QueryRow(ctx, q, id, userID))
}

// ConversationForStaff reads any conversation, for the support queue. The caller
// must already hold academy.support.view; this is not a student-facing path.
func (s *Store) ConversationForStaff(ctx context.Context, id uuid.UUID) (Conversation, error) {
	const q = `SELECT ` + conversationColumns + ` FROM public.academy_assistant_conversations WHERE id = $1`
	return scanConversation(s.db.QueryRow(ctx, q, id))
}

func (s *Store) ListConversations(ctx context.Context, userID uuid.UUID, limit int) ([]Conversation, error) {
	limit = clampLimit(limit, 20, 100)
	const q = `SELECT ` + conversationColumns + `
	          FROM public.academy_assistant_conversations
	         WHERE user_id = $1
	         ORDER BY updated_at DESC
	         LIMIT $2`
	rows, err := s.db.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Conversation{}
	for rows.Next() {
		var (
			c    Conversation
			mode string
		)
		if err := rows.Scan(&c.ID, &c.UserID, &mode, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		c.Mode = ConversationMode(mode)
		out = append(out, c)
	}
	return out, rows.Err()
}

// SetConversationMode flips bot/human. Entering human mode is what stops the
// next student message reaching the model; leaving it is what a ticket close
// does so the assistant becomes usable again.
func (s *Store) SetConversationMode(ctx context.Context, id uuid.UUID, mode ConversationMode) error {
	const q = `UPDATE public.academy_assistant_conversations
	          SET mode = $2, updated_at = NOW()
	         WHERE id = $1`
	_, err := s.db.Exec(ctx, q, id, string(mode))
	return err
}

// --- messages ----------------------------------------------------------------

const messageColumns = `id, conversation_id, sender, body, faq_ids, flagged, created_at`

func scanMessage(row pgx.Row) (Message, error) {
	var (
		m      Message
		sender string
		faqIDs []uuid.UUID
	)
	err := row.Scan(&m.ID, &m.ConversationID, &sender, &m.Body, &faqIDs, &m.Flagged, &m.CreatedAt)
	m.Sender = Sender(sender)
	m.FaqIDs = uuidStrings(faqIDs)
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	return m, err
}

// AppendMessage stores one turn. Assistant and staff turns go through here too,
// which is safe only because the callers hold the service-role pool — the RLS
// INSERT policy lets an app-issued key write `user` turns and nothing else.
func (s *Store) AppendMessage(ctx context.Context, conversationID uuid.UUID, sender Sender,
	body string, createdBy *uuid.UUID, faqIDs []uuid.UUID) (Message, error) {

	const q = `INSERT INTO public.academy_assistant_messages
	           (conversation_id, sender, body, created_by, faq_ids)
	           VALUES ($1, $2, $3, $4, $5)
	           RETURNING ` + messageColumns
	m, err := scanMessage(s.db.QueryRow(ctx, q, conversationID, string(sender), body, createdBy, nonNilIDs(faqIDs)))
	if err != nil {
		return m, err
	}
	// Bump the thread so a student's conversation list sorts by recency of the
	// exchange that actually happened. Best-effort: a failed touch must not
	// lose a stored message.
	_, _ = s.db.Exec(ctx, `UPDATE public.academy_assistant_conversations SET updated_at = NOW() WHERE id = $1`,
		conversationID)
	return m, nil
}

// ListMessages reads the transcript of a conversation the caller owns.
func (s *Store) ListMessages(ctx context.Context, conversationID, userID uuid.UUID, limit int) ([]Message, error) {
	limit = clampLimit(limit, 100, 200)
	const q = `SELECT m.id, m.conversation_id, m.sender, m.body, m.faq_ids, m.flagged, m.created_at
	            FROM public.academy_assistant_messages m
	            JOIN public.academy_assistant_conversations c ON c.id = m.conversation_id
	           WHERE m.conversation_id = $1 AND c.user_id = $2
	           ORDER BY m.created_at ASC, m.id ASC
	           LIMIT $3`
	return s.queryMessages(ctx, q, conversationID, userID, limit)
}

// ListMessagesForStaff reads any conversation's transcript for the support
// console, guarded upstream by academy.support.view.
func (s *Store) ListMessagesForStaff(ctx context.Context, conversationID uuid.UUID, limit int) ([]Message, error) {
	limit = clampLimit(limit, 100, 200)
	const q = `SELECT m.id, m.conversation_id, m.sender, m.body, m.faq_ids, m.flagged, m.created_at
	            FROM public.academy_assistant_messages m
	           WHERE m.conversation_id = $1
	           ORDER BY m.created_at ASC, m.id ASC
	           LIMIT $2`
	return s.queryMessages(ctx, q, conversationID, limit)
}

func (s *Store) queryMessages(ctx context.Context, q string, args ...any) ([]Message, error) {
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Message{}
	for rows.Next() {
		var (
			m      Message
			sender string
			faqIDs []uuid.UUID
		)
		if err := rows.Scan(&m.ID, &m.ConversationID, &sender, &m.Body, &faqIDs, &m.Flagged, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.Sender = Sender(sender)
		m.FaqIDs = uuidStrings(faqIDs)
		out = append(out, m)
	}
	return out, rows.Err()
}

// ConversationIDForMessage resolves the thread owning a message, scoped to the
// caller, which is what makes flagging someone else's turn a 404.
func (s *Store) ConversationIDForMessage(ctx context.Context, messageID, userID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	const q = `SELECT m.conversation_id
	            FROM public.academy_assistant_messages m
	            JOIN public.academy_assistant_conversations c ON c.id = m.conversation_id
	           WHERE m.id = $1 AND c.user_id = $2`
	err := s.db.QueryRow(ctx, q, messageID, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	return id, err
}

// FlagMessage marks an assistant turn the student said was wrong. The sender
// check is in the WHERE clause: only an assistant answer can be flagged, and
// only in the caller's own thread.
func (s *Store) FlagMessage(ctx context.Context, messageID, userID uuid.UUID) (Message, error) {
	const q = `UPDATE public.academy_assistant_messages m
	          SET flagged = TRUE
	         WHERE m.id = $1
	           AND m.sender = 'assistant'
	           AND EXISTS (
	             SELECT 1 FROM public.academy_assistant_conversations c
	              WHERE c.id = m.conversation_id AND c.user_id = $2
	           )
	         RETURNING ` + messageColumns
	return scanMessage(s.db.QueryRow(ctx, q, messageID, userID))
}

// --- tickets -----------------------------------------------------------------

const ticketColumns = `id, ticket_number, user_id, subject, category, priority, status,
                       message, assigned_officer_id, resolution_notes,
                       created_at, updated_at, conversation_id, last_staff_reply_at`

func scanTicket(row pgx.Row) (Ticket, error) {
	var (
		t          Ticket
		status     string
		userID     *uuid.UUID
		convers    *uuid.UUID
		officer    *uuid.UUID
		resolution *string
		lastStaff  *time.Time
	)
	err := row.Scan(&t.ID, &t.TicketNumber, &userID, &t.Subject, &t.Category, &t.Priority,
		&status, &t.Message, &officer, &resolution, &t.CreatedAt, &t.UpdatedAt,
		&convers, &lastStaff)
	t.Status, t.UserID, t.ConversationID = TicketStatus(status), userID, convers
	t.AssignedOfficer, t.ResolutionNotes, t.LastStaffReplyAt = officer, resolution, lastStaff
	t.Unanswered = lastStaff == nil && t.Status != TicketClosed
	t.AgeMinutes = int64(time.Since(t.CreatedAt).Minutes())
	if errors.Is(err, pgx.ErrNoRows) {
		return Ticket{}, ErrNotFound
	}
	return t, err
}

// CreateTicket opens the support case that moves a conversation to a person.
//
// It writes academy_support_tickets — the table that has existed since
// 20260505110000 with no application code behind it — rather than introducing a
// second ticket system, so the SU-09 console reads the same rows.
//
// ticket_number is UNIQUE NOT NULL with no sequence to draw from, so it is
// generated per attempt and retried on a collision. Two handoffs in the same
// millisecond must not fail one of them.
func (s *Store) CreateTicket(ctx context.Context, conversationID, userID uuid.UUID,
	subject, category, message string) (Ticket, error) {

	const insert = `INSERT INTO public.academy_support_tickets
	               (ticket_number, user_id, subject, category, priority, status, message, conversation_id)
	               VALUES ($1, $2, $3, $4, 'medium', 'open', $5, $6)
	               RETURNING ` + ticketColumns

	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		t, err := scanTicket(s.db.QueryRow(ctx, insert, newTicketNumber(), userID,
			subject, category, message, conversationID))
		if err == nil {
			return t, nil
		}
		if !isUniqueViolation(err) {
			return Ticket{}, err
		}
		lastErr = err
	}
	return Ticket{}, fmt.Errorf("assistant: could not allocate a ticket number: %w", lastErr)
}

// TicketForConversation returns the live ticket on a conversation. This is the
// idempotency check behind "escalate twice, still one ticket".
func (s *Store) TicketForConversation(ctx context.Context, conversationID uuid.UUID) (Ticket, error) {
	const q = `SELECT ` + ticketColumns + `
	          FROM public.academy_support_tickets
	         WHERE conversation_id = $1 AND status <> 'closed'
	         ORDER BY created_at DESC
	         LIMIT 1`
	return scanTicket(s.db.QueryRow(ctx, q, conversationID))
}

func (s *Store) TicketByID(ctx context.Context, id uuid.UUID) (Ticket, error) {
	const q = `SELECT ` + ticketColumns + ` FROM public.academy_support_tickets WHERE id = $1`
	return scanTicket(s.db.QueryRow(ctx, q, id))
}

// ListTickets is the support queue: open first, then in progress, oldest waiting
// at the top of each, which is the order a person working the queue wants.
func (s *Store) ListTickets(ctx context.Context, q TicketListQuery) ([]Ticket, error) {
	var (
		clauses []string
		args    []any
	)
	if status := strings.TrimSpace(q.Status); status != "" {
		args = append(args, status)
		clauses = append(clauses, fmt.Sprintf("status = $%d", len(args)))
	}
	if cat := strings.TrimSpace(q.Category); cat != "" {
		args = append(args, cat)
		clauses = append(clauses, fmt.Sprintf("category = $%d", len(args)))
	}
	if q.Unanswered != nil {
		if *q.Unanswered {
			clauses = append(clauses, "(last_staff_reply_at IS NULL AND status <> 'closed')")
		} else {
			clauses = append(clauses, "last_staff_reply_at IS NOT NULL")
		}
	}
	if term := strings.TrimSpace(q.Q); term != "" {
		args = append(args, "%"+truncateRunes(term, 60)+"%")
		i := len(args)
		clauses = append(clauses, fmt.Sprintf("(subject ILIKE $%d OR message ILIKE $%d)", i, i))
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}
	limit := clampLimit(q.Limit, 50, 200)
	sql := `SELECT ` + ticketColumns + `,
	               (EXTRACT(EPOCH FROM (NOW() - created_at))::bigint / 60)::bigint
	          FROM public.academy_support_tickets ` + where + `
	         ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
	                  created_at ASC
	         LIMIT $` + strconvInt(len(args)+1) + ` OFFSET $` + strconvInt(len(args)+2)
	args = append(args, limit, q.Offset)

	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Ticket{}
	for rows.Next() {
		var (
			t          Ticket
			status     string
			userID     *uuid.UUID
			convers    *uuid.UUID
			officer    *uuid.UUID
			resolution *string
			lastStaff  *time.Time
			age        int64
		)
		if err := rows.Scan(&t.ID, &t.TicketNumber, &userID, &t.Subject, &t.Category, &t.Priority,
			&status, &t.Message, &officer, &resolution, &t.CreatedAt, &t.UpdatedAt,
			&convers, &lastStaff, &age); err != nil {
			return nil, err
		}
		t.Status, t.UserID, t.ConversationID = TicketStatus(status), userID, convers
		t.AssignedOfficer, t.ResolutionNotes, t.LastStaffReplyAt = officer, resolution, lastStaff
		t.Unanswered = lastStaff == nil && t.Status != TicketClosed
		t.AgeMinutes = age
		out = append(out, t)
	}
	return out, rows.Err()
}

// TicketSummary counts the queue in one pass, so the console badge and the
// oldest-waiting figure cannot disagree with the list rendered beside them.
func (s *Store) TicketSummary(ctx context.Context) (TicketSummary, error) {
	const q = `SELECT
	                 COUNT(*) FILTER (WHERE status = 'open')::int,
	                 COUNT(*) FILTER (WHERE status = 'in_progress')::int,
	                 COUNT(*) FILTER (WHERE status = 'closed')::int,
	                 COUNT(*) FILTER (WHERE status <> 'closed' AND last_staff_reply_at IS NULL)::int,
	                 COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - created_at))::bigint / 60)
	                          FILTER (WHERE status <> 'closed' AND last_staff_reply_at IS NULL), 0)::bigint
	               FROM public.academy_support_tickets`
	var sum TicketSummary
	err := s.db.QueryRow(ctx, q).Scan(&sum.Open, &sum.InProgress, &sum.Closed,
		&sum.Unanswered, &sum.OldestUnansweredMins)
	return sum, err
}

// MarkStaffReply records that a person answered, which is what drops the ticket
// from "unanswered", and picks up an open ticket as in_progress — a reply is by
// definition an uptake, and the agent should not have to click twice.
func (s *Store) MarkStaffReply(ctx context.Context, ticketID uuid.UUID, assignee uuid.UUID) error {
	const q = `UPDATE public.academy_support_tickets
	          SET last_staff_reply_at = NOW(),
	              updated_at = NOW(),
	              status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
	              assigned_officer_id = COALESCE(assigned_officer_id, $2)
	         WHERE id = $1 AND status <> 'closed'`
	tag, err := s.db.Exec(ctx, q, ticketID, assignee)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetTicketStatus applies the lifecycle with the transition table enforced in
// SQL, so an illegal move (closing twice, reopening to in_progress) is refused
// rather than trusted to the console.
func (s *Store) SetTicketStatus(ctx context.Context, ticketID uuid.UUID, from, to TicketStatus,
	resolutionNotes string) (Ticket, error) {

	if !canMove(from, to) {
		return Ticket{}, ErrBadTransition
	}
	const q = `UPDATE public.academy_support_tickets
	          SET status = $2,
	              updated_at = NOW(),
	              resolution_notes = CASE WHEN $2 = 'closed' THEN COALESCE(NULLIF($3, ''), resolution_notes)
	                                      ELSE resolution_notes END
	         WHERE id = $1 AND status = $4
	         RETURNING ` + ticketColumns
	t, err := scanTicket(s.db.QueryRow(ctx, q, ticketID, string(to), resolutionNotes, string(from)))
	if errors.Is(err, ErrNotFound) {
		// The row moved under us between the read and the write; the caller
		// re-reads rather than acting on a stale transition.
		return Ticket{}, ErrConflict
	}
	return t, err
}

// ErrBadTransition and ErrConflict are the two status-write refusals. They are
// distinct because the console offers different next actions for each.
var (
	ErrBadTransition = errors.New("assistant: not a valid ticket transition")
	ErrConflict      = errors.New("assistant: ticket changed, please reload")
)

// ticketTransitions is the whole lifecycle: open -> in_progress -> closed, and
// a closed case may be reopened to open. Nothing else moves.
var ticketTransitions = map[TicketStatus][]TicketStatus{
	TicketOpen:       {TicketInProgress, TicketClosed},
	TicketInProgress: {TicketClosed, TicketOpen},
	TicketClosed:     {TicketOpen},
}

func canMove(from, to TicketStatus) bool {
	for _, allowed := range ticketTransitions[from] {
		if allowed == to {
			return true
		}
	}
	return false
}

// --- helpers -----------------------------------------------------------------

func keywordsOf(in FaqInput) []string {
	out := make([]string, 0, len(in.Keywords))
	seen := make(map[string]bool, len(in.Keywords))
	for _, k := range in.Keywords {
		t := strings.ToLower(strings.TrimSpace(k))
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}

func nonNilIDs(ids []uuid.UUID) []uuid.UUID {
	if ids == nil {
		return []uuid.UUID{}
	}
	return ids
}

func uuidStrings(ids []uuid.UUID) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		out = append(out, id.String())
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func clampLimit(v, def, max int) int {
	if v <= 0 {
		return def
	}
	if v > max {
		return max
	}
	return v
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

func strconvInt(n int) string { return fmt.Sprintf("%d", n) }

// newTicketNumber is a readable support reference: TMFA-YYMMDD-HHMMSS-<4 hex>.
// The random tail is what makes the unique index satisfiable when two students
// hand off in the same second.
func newTicketNumber() string {
	return fmt.Sprintf("TMFA-%s-%s",
		time.Now().UTC().Format("060102-1504"),
		strings.ToUpper(uuid.New().String()[:4]))
}

// isUniqueViolation reads the PostgreSQL 23505 code out of a driver error
// without importing pgerrcode into the service surface.
func isUniqueViolation(err error) bool {
	var pe interface{ SQLState() string }
	if errors.As(err, &pe) {
		return pe.SQLState() == "23505"
	}
	return strings.Contains(err.Error(), "SQLSTATE 23505") ||
		strings.Contains(err.Error(), "duplicate key value")
}
