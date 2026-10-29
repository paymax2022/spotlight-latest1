package top5events

// Support desk — disputes and help requests (migration 20271400000000).
//
// UAT treats a dispute as a first-class customer-protection control, not a mailto
// link: a case has a kind, a priority, an owner, a status, and a thread that both
// sides can read. Two rules shape this file:
//
//  1. A customer may only open a case about their OWN purchase (or about an event
//     that is actually public). The event/order/ticket ids are references into other
//     people's rows, so each one is checked against the opener before it is stored —
//     otherwise the case queue would be an IDOR read primitive.
//  2. Status changes are made by the desk (route-guarded events.support), never by
//     whoever holds the thread. The opener can write and read their own case; they
//     cannot resolve it.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Support case states, kinds and priorities (event_support_cases CHECKs).
const (
	SupportOpen       = "OPEN"
	SupportInProgress = "IN_PROGRESS"
	SupportResolved   = "RESOLVED"
	SupportClosed     = "CLOSED"

	SupportLow    = "low"
	SupportNormal = "normal"
	SupportHigh   = "high"
	SupportUrgent = "urgent"

	maxSupportSubjectLen = 200
	maxSupportBodyLen    = 4000
)

var (
	ErrCaseNotYours = fmt.Errorf("%w: events: this support case belongs to another customer", ErrForbidden)
	// A closed case is the row's state, not a malformed request: the client's
	// next move is to re-read, so this is a 409-family sentinel, matching
	// ErrRefundWindow / ErrAlreadyCheckedIn rather than ErrValidation.
	ErrCaseTerminal  = errors.New("events: the case is closed")
	ErrUnknownRef    = fmt.Errorf("%w: events: the order or ticket referenced is not yours", ErrValidation)
	ErrBadSupportArg = fmt.Errorf("%w: events: unknown support kind, status or priority", ErrValidation)
)

var supportKinds = map[string]bool{
	"REFUND": true, "TICKET": true, "CHECKIN": true, "PAYMENT": true, "CONDUCT": true, "OTHER": true,
}

// SupportCase is one desk ticket plus, on a detail read, its thread.
type SupportCase struct {
	ID         string     `json:"id"`
	EventID    string     `json:"event_id,omitempty"`
	EventTitle string     `json:"event_title,omitempty"`
	OrderID    string     `json:"order_id,omitempty"`
	TicketID   string     `json:"ticket_id,omitempty"`
	OpenedBy   string     `json:"opened_by"`
	Kind       string     `json:"kind"`
	Subject    string     `json:"subject"`
	Body       string     `json:"body"`
	Status     string     `json:"status"`
	Priority   string     `json:"priority"`
	AssignedTo string     `json:"assigned_to,omitempty"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`

	ReplyCount  int              `json:"reply_count"`
	Messages    []SupportMessage `json:"messages,omitempty"`
	LastMessage *SupportMessage  `json:"last_message,omitempty"`
}

// SupportMessage is one post in a case thread. AuthorName is filled for the desk
// view; the customer view only ever needs "support" versus their own words.
type SupportMessage struct {
	ID         string    `json:"id"`
	CaseID     string    `json:"case_id"`
	AuthorID   string    `json:"author_id"`
	AuthorName string    `json:"author_name,omitempty"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

const supportSelectBase = `c.id, COALESCE(c.event_id::text,''), COALESCE(e.title,''), COALESCE(c.order_id::text,''),
	COALESCE(c.ticket_id::text,''), c.opened_by::text, c.kind, c.subject, c.body, c.status, c.priority,
	COALESCE(c.assigned_to::text,''), c.resolved_at, c.created_at, c.updated_at`

const supportFrom = ` FROM event_support_cases c LEFT JOIN events e ON e.id = c.event_id `

func scanSupportCase(row rowScanner) (SupportCase, error) {
	var c SupportCase
	dests := []any{&c.ID, &c.EventID, &c.EventTitle, &c.OrderID, &c.TicketID, &c.OpenedBy, &c.Kind,
		&c.Subject, &c.Body, &c.Status, &c.Priority, &c.AssignedTo, &c.ResolvedAt, &c.CreatedAt, &c.UpdatedAt}
	if err := row.Scan(dests...); err != nil {
		return SupportCase{}, err
	}
	return c, nil
}

// OpenCase files a customer's request. The optional references are validated against
// the opener, so a case can never point at someone else's order.
func (s *Service) OpenCase(ctx context.Context, userID string, in SupportCase) (*SupportCase, error) {
	if userID == "" {
		return nil, ErrValidation
	}
	kind := in.Kind
	if kind == "" {
		kind = "OTHER"
	}
	if !supportKinds[kind] {
		return nil, ErrBadSupportArg
	}
	subject := clampTrim(in.Subject, maxSupportSubjectLen)
	if subject == "" {
		return nil, fmt.Errorf("%w: events: a support case needs a subject", ErrValidation)
	}
	body := clampTrim(in.Body, maxSupportBodyLen)
	if err := s.assertCaseRefsAreYours(ctx, userID, in.EventID, in.OrderID, in.TicketID); err != nil {
		return nil, err
	}

	id := uuid.New().String()
	if _, err := s.db.Exec(ctx,
		`INSERT INTO event_support_cases (id, event_id, order_id, ticket_id, opened_by, kind, subject, body, status, priority)
		 VALUES ($1,NULLIF($2,'')::uuid,NULLIF($3,'')::uuid,NULLIF($4,'')::uuid,$5,$6,$7,$8,$9,$10)`,
		id, in.EventID, in.OrderID, in.TicketID, userID, kind, subject, body, SupportOpen, supportPriority(in.Priority)); err != nil {
		return nil, fmt.Errorf("events: open support case: %w", err)
	}
	s.log(userID, "events.support.open", id, map[string]any{"kind": kind})
	out, err := s.getCaseByCols(ctx, `c.id=$1`, id)
	if err != nil {
		return nil, err
	}
	// The desk is notified by its own queue; the customer gets a confirmation in
	// their inbox so the case number is not only on screen for a second.
	s.notify(ctx, userID, NotifySupportReply, "Support request received", subject, out.EventID, out.OrderID, "")
	return &out, nil
}

func supportPriority(p string) string {
	switch p {
	case SupportLow, SupportHigh, SupportUrgent:
		return p
	}
	return SupportNormal
}

// assertCaseRefsAreYours is the tenant check. An order/ticket reference must belong
// to the opener; an event reference must be one they attended or one that is
// publicly listed, so "report this event" stays possible without letting the id be
// used to echo back a private event's title through the case row.
func (s *Service) assertCaseRefsAreYours(ctx context.Context, userID, eventID, orderID, ticketID string) error {
	if orderID != "" {
		var n int
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM event_orders WHERE id=$1 AND buyer_id=$2`, orderID, userID).Scan(&n); err != nil {
			return fmt.Errorf("events: support order check: %w", err)
		}
		if n == 0 {
			return ErrUnknownRef
		}
	}
	if ticketID != "" {
		var n int
		if err := s.db.QueryRow(ctx, `SELECT count(*) FROM event_tickets WHERE id=$1 AND owner_id=$2`, ticketID, userID).Scan(&n); err != nil {
			return fmt.Errorf("events: support ticket check: %w", err)
		}
		if n == 0 {
			return ErrUnknownRef
		}
	}
	if eventID != "" {
		var ok bool
		if err := s.db.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM events WHERE id=$1 AND state IN ('LIVE','APPROVED','SUBMITTED','CLOSED','CANCELLED','PAUSED','SUSPENDED'))
			   OR EXISTS(SELECT 1 FROM event_tickets WHERE event_id=$1 AND owner_id=$2)`, eventID, userID).Scan(&ok); err != nil {
			return fmt.Errorf("events: support event check: %w", err)
		}
		if !ok {
			return ErrUnknownRef
		}
	}
	return nil
}

func (s *Service) getCaseByCols(ctx context.Context, where string, args ...any) (SupportCase, error) {
	row := s.db.QueryRow(ctx, `SELECT `+supportSelectBase+supportFrom+`WHERE `+where, args...)
	c, err := scanSupportCase(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return SupportCase{}, ErrNotFound
	}
	if err != nil {
		return SupportCase{}, fmt.Errorf("events: support case: %w", err)
	}
	return c, nil
}

// Case reads one case with its thread. allowAdmin is set by the route's RBAC guard
// (events.support); without it only the opener may read.
func (s *Service) Case(ctx context.Context, actorID, caseID string, allowAdmin bool) (*SupportCase, error) {
	c, err := s.getCaseByCols(ctx, `c.id=$1`, caseID)
	if err != nil {
		return nil, err
	}
	if c.OpenedBy != actorID && !allowAdmin {
		return nil, ErrCaseNotYours
	}
	msgs, err := s.caseMessages(ctx, caseID, !allowAdmin)
	if err != nil {
		return nil, err
	}
	c.Messages = msgs
	c.ReplyCount = len(msgs)
	if len(msgs) > 0 {
		last := msgs[len(msgs)-1]
		c.LastMessage = &last
	}
	return &c, nil
}

// names tells a thread read whether to reveal who wrote each post. The desk view
// needs it; the customer already knows their own name, and an agent's identity is
// not something to publish into a customer thread.
func (s *Service) caseMessages(ctx context.Context, caseID string, hideAuthors bool) ([]SupportMessage, error) {
	cols := `m.id, m.case_id::text, m.author_id::text, `
	if hideAuthors {
		cols += `''`
	} else {
		cols += `COALESCE(up.full_name,'')`
	}
	rows, err := s.db.Query(ctx, cols+`, m.body, m.created_at
		FROM event_support_messages m LEFT JOIN user_profiles up ON up.id = m.author_id
		WHERE m.case_id=$1 ORDER BY m.created_at, m.id`, caseID)
	if err != nil {
		return nil, fmt.Errorf("events: support thread: %w", err)
	}
	defer rows.Close()

	out := []SupportMessage{}
	for rows.Next() {
		var m SupportMessage
		if err := rows.Scan(&m.ID, &m.CaseID, &m.AuthorID, &m.AuthorName, &m.Body, &m.CreatedAt); err != nil {
			return nil, fmt.Errorf("events: support thread scan: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Reply posts to a thread. The desk's reply also lands in the opener's inbox, which
// is what makes "the dispute has an answer" visible without polling the case screen.
func (s *Service) Reply(ctx context.Context, actorID, caseID, body string, allowAdmin bool) (*SupportMessage, error) {
	body = clampTrim(body, maxSupportBodyLen)
	if body == "" {
		return nil, fmt.Errorf("%w: events: a reply cannot be empty", ErrValidation)
	}
	c, err := s.getCaseByCols(ctx, `c.id=$1`, caseID)
	if err != nil {
		return nil, err
	}
	if c.OpenedBy != actorID && !allowAdmin {
		return nil, ErrCaseNotYours
	}
	if c.Status == SupportClosed {
		return nil, ErrCaseTerminal
	}
	m := SupportMessage{ID: uuid.New().String(), CaseID: c.ID, AuthorID: actorID, Body: body, CreatedAt: time.Now().UTC()}
	if _, err := s.db.Exec(ctx,
		`INSERT INTO event_support_messages (id, case_id, author_id, body, created_at) VALUES ($1,$2,$3,$4,now())`,
		m.ID, c.ID, actorID, body); err != nil {
		return nil, fmt.Errorf("events: support reply: %w", err)
	}
	// The case has moved out of "nobody has touched it" the moment the desk speaks.
	if allowAdmin && c.Status == SupportOpen {
		if _, err := s.db.Exec(ctx, `UPDATE event_support_cases SET status='IN_PROGRESS', updated_at=now() WHERE id=$1`, c.ID); err != nil {
			return nil, fmt.Errorf("events: support reply status: %w", err)
		}
	}
	s.log(actorID, "events.support.reply", c.ID, nil)
	if actorID != c.OpenedBy {
		s.notify(ctx, c.OpenedBy, NotifySupportReply, "New reply on your support request", c.Subject, c.EventID, c.OrderID, "")
	}
	return &m, nil
}

// MyCases is the customer's own list, newest first.
func (s *Service) MyCases(ctx context.Context, userID, status string, limit, offset int) ([]SupportCase, error) {
	return s.listCases(ctx, `c.opened_by=$1`+supportStatusFilter(status), userID, status, limit, offset)
}

// AdminListCases is the desk queue across every customer.
func (s *Service) AdminListCases(ctx context.Context, status, kind, q string, limit, offset int) ([]SupportCase, error) {
	where := `WHERE 1=1`
	args := []any{}
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(` AND c.status = $%d`, len(args))
	}
	if kind != "" {
		args = append(args, kind)
		where += fmt.Sprintf(` AND c.kind = $%d`, len(args))
	}
	if term := clampTrim(q, 100); term != "" {
		args = append(args, "%"+term+"%")
		where += fmt.Sprintf(` AND (c.subject ILIKE $%d OR c.body ILIKE $%d)`, len(args), len(args))
	}
	// The desk triages by what is urgent and then oldest-first: an unattended
	// urgent case must outrank a fresh low-priority one.
	rows, err := s.db.Query(ctx, `SELECT `+supportSelectBase+supportFrom+where+`
		 ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
		          c.created_at
		 LIMIT $`+fmt.Sprint(len(args)+1)+` OFFSET $`+fmt.Sprint(len(args)+2),
		append(args, boundCasesLimit(limit), nonNegative(offset))...)
	if err != nil {
		return nil, fmt.Errorf("events: support queue: %w", err)
	}
	return scanSupportCases(rows)
}

// listCases runs a customer-scoped case list over a WHERE fragment that already
// numbers its own $1.
func (s *Service) listCases(ctx context.Context, where, userID, status string, limit, offset int) ([]SupportCase, error) {
	args := []any{userID}
	if status != "" {
		args = append(args, status)
	}
	rows, err := s.db.Query(ctx, `SELECT `+supportSelectBase+supportFrom+`WHERE `+where+`
		 ORDER BY c.created_at DESC LIMIT $`+fmt.Sprint(len(args)+1)+` OFFSET $`+fmt.Sprint(len(args)+2),
		append(args, boundCasesLimit(limit), nonNegative(offset))...)
	if err != nil {
		return nil, fmt.Errorf("events: support list: %w", err)
	}
	return scanSupportCases(rows)
}

// supportStatusFilter appends the optional status predicate for a list whose caller
// has already placed the opener at $1.
func supportStatusFilter(status string) string {
	if status == "" {
		return ""
	}
	return ` AND c.status = $2`
}

func boundCasesLimit(limit int) int {
	if limit <= 0 || limit > 200 {
		return 50
	}
	return limit
}

func nonNegative(n int) int {
	if n < 0 {
		return 0
	}
	return n
}

func scanSupportCases(rows caseRows) ([]SupportCase, error) {
	defer rows.Close()
	out := []SupportCase{}
	for rows.Next() {
		c, err := scanSupportCase(rows)
		if err != nil {
			return nil, fmt.Errorf("events: support scan: %w", err)
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// caseRows is the slice of pgx.Rows this file needs, so the helper above can be
// tested without a database.
type caseRows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
	Err() error
}

// UpdateCase is the desk's triage action: status, priority, and who owns it. A
// resolve stamps resolved_at; reopening clears it, so "how long did this take"
// stays answerable from the row.
func (s *Service) UpdateCase(ctx context.Context, adminID, caseID, status, priority, assignee, note string) (*SupportCase, error) {
	if adminID == "" {
		return nil, ErrValidation
	}
	c, err := s.getCaseByCols(ctx, `c.id=$1`, caseID)
	if err != nil {
		return nil, err
	}
	if status != "" && !validSupportStatus(status) {
		return nil, ErrBadSupportArg
	}
	if priority != "" && !validSupportPriority(priority) {
		return nil, ErrBadSupportArg
	}
	if c.Status == SupportClosed && status != "" && status != SupportClosed {
		// Reopening a closed case is a deliberate act, not a side effect of
		// re-triaging: the desk has to say so.
		return nil, ErrCaseTerminal
	}
	next := status
	if next == "" {
		next = c.Status
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE event_support_cases
		    SET status=$2, priority=$3, assigned_to=NULLIF($4,'')::uuid,
		        resolved_at = CASE WHEN $2 = 'RESOLVED' AND $5 <> 'RESOLVED' THEN now()
		                           WHEN $2 IN ('OPEN','IN_PROGRESS') THEN NULL
		                           ELSE resolved_at END,
		        updated_at = now()
		  WHERE id=$1`,
		caseID, next, supportPriority(firstNonEmpty(priority, c.Priority)), assignee, c.Status); err != nil {
		return nil, fmt.Errorf("events: update support case: %w", err)
	}
	if note = clampTrim(note, maxSupportBodyLen); note != "" {
		if _, err := s.db.Exec(ctx,
			`INSERT INTO event_support_messages (id, case_id, author_id, body, created_at) VALUES ($1,$2,$3,$4,now())`,
			uuid.New().String(), caseID, adminID, note); err != nil {
			return nil, fmt.Errorf("events: support decision note: %w", err)
		}
	}
	s.log(adminID, "events.support.update", caseID,
		map[string]any{"from": c.Status, "to": next, "priority": supportPriority(firstNonEmpty(priority, c.Priority)), "assigned_to": assignee})
	if next != c.Status && next != SupportInProgress {
		s.notify(ctx, c.OpenedBy, NotifySupportReply, supportStatusTitle(next), c.Subject, c.EventID, c.OrderID, "")
	}
	out, err := s.getCaseByCols(ctx, `c.id=$1`, caseID)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func supportStatusTitle(status string) string {
	switch status {
	case SupportResolved:
		return "Support request resolved"
	case SupportClosed:
		return "Support request closed"
	}
	return "Support request updated"
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func validSupportStatus(s string) bool {
	return s == SupportOpen || s == SupportInProgress || s == SupportResolved || s == SupportClosed
}

func validSupportPriority(p string) bool {
	return p == SupportLow || p == SupportNormal || p == SupportHigh || p == SupportUrgent
}

// SupportQueueStats is the badge count on the desk tab: what is open, split by
// priority, plus how long the oldest one has been waiting.
type SupportQueueStats struct {
	Open          int            `json:"open"`
	InProgress    int            `json:"in_progress"`
	ResolvedToday int            `json:"resolved_today"`
	ByPriority    map[string]int `json:"by_priority"`
	OldestOpenAt  *time.Time     `json:"oldest_open_at,omitempty"`
}

func (s *Service) SupportQueueStats(ctx context.Context) (*SupportQueueStats, error) {
	out := &SupportQueueStats{ByPriority: map[string]int{}}
	rows, err := s.db.Query(ctx, `
		SELECT status, priority, COUNT(*), MIN(created_at) FILTER (WHERE status IN ('OPEN','IN_PROGRESS'))
		FROM event_support_cases GROUP BY status, priority`)
	if err != nil {
		return nil, fmt.Errorf("events: support stats: %w", err)
	}
	defer rows.Close()
	var oldest *time.Time
	for rows.Next() {
		var status, priority string
		var n int
		var minAt *time.Time
		if err := rows.Scan(&status, &priority, &n, &minAt); err != nil {
			return nil, fmt.Errorf("events: support stats scan: %w", err)
		}
		switch status {
		case SupportOpen:
			out.Open += n
		case SupportInProgress:
			out.InProgress += n
		}
		if status == SupportOpen || status == SupportInProgress {
			out.ByPriority[priority] += n
			if minAt != nil && (oldest == nil || minAt.Before(*oldest)) {
				oldest = minAt
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out.OldestOpenAt = oldest
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM event_support_cases WHERE status='RESOLVED' AND resolved_at::date = current_date`).
		Scan(&out.ResolvedToday); err != nil {
		return nil, fmt.Errorf("events: support stats resolved today: %w", err)
	}
	return out, nil
}
