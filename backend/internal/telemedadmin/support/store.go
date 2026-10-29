package support

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// querier is the read surface shared by the pool and a transaction.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// database is what the store needs: reads plus Begin, which on a pgx.Tx opens a
// savepoint — so a test can run the whole surface inside one rolled-back tx.
type database interface {
	querier
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Store is the data layer of the support/safety admin surface.
type Store struct{ db database }

// NewStore wraps the money-path pgx pool.
func NewStore(db *pgxpool.Pool) *Store { return &Store{db: db} }

// NewStoreOn builds a store over any database, e.g. an open pgx.Tx in tests.
func NewStoreOn(db database) *Store { return &Store{db: db} }

// assigneeJoin resolves the current assignee as the latest admin.assign audit
// row for the entity ($1 = entity_type). An empty admin_id means unassigned.
const assigneeJoin = `
	LEFT JOIN LATERAL (
		SELECT NULLIF(a.detail->>'admin_id', '') AS admin_id
		FROM doctor_compliance_audit a
		WHERE a.entity_type = $1 AND a.entity_id = t.id::text AND a.action = 'admin.assign'
		ORDER BY a.created_at DESC LIMIT 1
	) aa ON true`

const doctorJoin = `
	LEFT JOIN LATERAL (
		SELECT d.name FROM doctors d WHERE d.user_id = t.user_id ORDER BY d.created_at LIMIT 1
	) dn ON true`

func (sp spec) itemSelect() string {
	return fmt.Sprintf(`
		SELECT t.id::text, t.user_id::text, COALESCE(dn.name, ''), %s, %s, %s, %s, t.status, %s,
		       aa.admin_id, t.created_at, %s
		FROM %s t %s %s`,
		sp.ref, sp.subject, sp.category, sp.severity, sp.patient, sp.updated, sp.table, doctorJoin, assigneeJoin)
}

func scanItem(sp spec, row pgx.Row) (Item, error) {
	var it Item
	var patient string
	err := row.Scan(&it.ID, &it.DoctorUserID, &it.DoctorName, &it.Ref, &it.Subject, &it.Category,
		&it.Severity, &it.Status, &patient, &it.AssigneeID, &it.CreatedAt, &it.UpdatedAt)
	it.Kind = sp.kind
	it.PatientRef = maskRef(patient)
	if it.DoctorName == "" {
		it.DoctorName = "Clinician " + maskRef(it.DoctorUserID)
	}
	return it, err
}

// listWhere is the shared filter clause; $1 is the entity type, $2.. filters.
func (sp spec) listWhere() string {
	return fmt.Sprintf(`
		WHERE ($2::text = '' OR t.status = $2)
		  AND ($3::text = '' OR %s = $3)
		  AND ($4::text = '' OR %s = $4)
		  AND ($5::text = '' OR %s ILIKE $5 OR %s ILIKE $5 OR COALESCE(dn.name, '') ILIKE $5)
		  AND ($6::text = '' OR ($6 = 'unassigned' AND aa.admin_id IS NULL) OR aa.admin_id = $6)`,
		sp.severity, sp.category, sp.ref, sp.subject)
}

func likePattern(q string) string {
	q = strings.TrimSpace(q)
	if q == "" {
		return ""
	}
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(q) + "%"
}

// List returns one page of a queue plus the unpaged total. adminID resolves
// the "me" assignment filter.
func (s *Store) List(ctx context.Context, kind Kind, q ListQuery, adminID string) ([]Item, int, error) {
	sp, ok := specs[kind]
	if !ok {
		return nil, 0, ErrValidation
	}
	assigned := q.Assigned
	if assigned == "me" {
		assigned = adminID
	}
	args := []any{sp.entityType, q.Status, q.Severity, q.Category, likePattern(q.Q), assigned}

	var total int
	countSQL := fmt.Sprintf(`SELECT count(*) FROM %s t %s %s %s`, sp.table, doctorJoin, assigneeJoin, sp.listWhere())
	if err := s.db.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("support: count %s: %w", kind, err)
	}

	listSQL := sp.itemSelect() + sp.listWhere() + ` ORDER BY t.created_at DESC LIMIT $7 OFFSET $8`
	rows, err := s.db.Query(ctx, listSQL, append(args, q.Limit, q.Offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("support: list %s: %w", kind, err)
	}
	defer rows.Close()
	items := make([]Item, 0, q.Limit)
	for rows.Next() {
		it, err := scanItem(sp, rows)
		if err != nil {
			return nil, 0, fmt.Errorf("support: scan %s: %w", kind, err)
		}
		items = append(items, it)
	}
	return items, total, rows.Err()
}

func getItem(ctx context.Context, db querier, sp spec, id string) (Item, error) {
	it, err := scanItem(sp, db.QueryRow(ctx, sp.itemSelect()+` WHERE t.id = $2::uuid`, sp.entityType, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	return it, err
}

// Get returns one item with its kind-specific body, thread and admin history.
func (s *Store) Get(ctx context.Context, kind Kind, id string) (*ItemDetail, error) {
	sp, ok := specs[kind]
	if !ok {
		return nil, ErrValidation
	}
	return getDetail(ctx, s.db, sp, id)
}

func getDetail(ctx context.Context, db querier, sp spec, id string) (*ItemDetail, error) {
	it, err := getItem(ctx, db, sp, id)
	if err != nil {
		return nil, err
	}
	d := &ItemDetail{Item: it, AllowedStatuses: sp.allowed(it.Status), History: []HistoryEntry{}}

	var raw []byte
	switch sp.kind {
	case KindTicket:
		if err := db.QueryRow(ctx, `SELECT COALESCE(last_reply,'') FROM doctor_support_tickets WHERE id=$1::uuid`, id).Scan(&d.Body); err != nil {
			return nil, err
		}
	case KindDispute:
		var evidence []byte
		if err := db.QueryRow(ctx, `SELECT detail, evidence FROM doctor_support_disputes WHERE id=$1::uuid`, id).Scan(&raw, &evidence); err != nil {
			return nil, err
		}
		d.Detail = scrubDetail(raw)
		_ = json.Unmarshal(evidence, &d.Evidence)
	case KindCall:
		var appt, sess *string
		var reason *string
		if err := db.QueryRow(ctx, `SELECT detail, reason, appointment_id::text, call_session_id::text FROM doctor_call_disputes WHERE id=$1::uuid`, id).
			Scan(&raw, &reason, &appt, &sess); err != nil {
			return nil, err
		}
		d.Detail = scrubDetail(raw)
		if reason != nil {
			d.Body = *reason
		}
		if d.Detail == nil {
			d.Detail = map[string]any{}
		}
		if appt != nil {
			d.Detail["appointment_id"] = *appt
		}
		if sess != nil {
			d.Detail["call_session_id"] = *sess
		}
	case KindSafety:
		if err := db.QueryRow(ctx, `SELECT detail FROM doctor_safety_issues WHERE id=$1::uuid`, id).Scan(&raw); err != nil {
			return nil, err
		}
		d.Detail = scrubDetail(raw)
	case KindCase:
		if err := db.QueryRow(ctx, `SELECT detail, COALESCE(summary,'') FROM doctor_emergency_cases WHERE id=$1::uuid`, id).Scan(&raw, &d.Body); err != nil {
			return nil, err
		}
		d.Detail = scrubDetail(raw)
		esc := specs[KindEscalation]
		rows, err := db.Query(ctx, esc.itemSelect()+
			` WHERE t.user_id = $2::uuid AND t.patient_id IS NOT DISTINCT FROM (SELECT patient_id FROM doctor_emergency_cases WHERE id = $3::uuid)
			  ORDER BY t.created_at DESC LIMIT 20`, esc.entityType, it.DoctorUserID, id)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			e, err := scanItem(esc, rows)
			if err != nil {
				rows.Close()
				return nil, err
			}
			d.Escalations = append(d.Escalations, e)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	case KindEscalation:
		var facility *string
		if err := db.QueryRow(ctx, `
			SELECT e.detail, f.name FROM doctor_emergency_escalations e
			LEFT JOIN doctor_emergency_facilities f ON f.id = e.facility_id
			WHERE e.id=$1::uuid`, id).Scan(&raw, &facility); err != nil {
			return nil, err
		}
		d.Detail = scrubDetail(raw)
		if facility != nil {
			if d.Detail == nil {
				d.Detail = map[string]any{}
			}
			d.Detail["facility_name"] = *facility
		}
	}

	if sp.hasMessages {
		rows, err := db.Query(ctx, `
			SELECT id::text, author, COALESCE(body,''), created_at
			FROM doctor_support_messages WHERE user_id = $1::uuid AND thread_id = $2
			ORDER BY created_at ASC LIMIT 500`, it.DoctorUserID, id)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var m Message
			if err := rows.Scan(&m.ID, &m.Author, &m.Body, &m.CreatedAt); err != nil {
				return nil, err
			}
			d.Messages = append(d.Messages, m)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}

	hist, err := db.Query(ctx, `
		SELECT action, COALESCE(detail->>'admin_id',''), COALESCE(detail->>'from',''), COALESCE(detail->>'to',''), created_at
		FROM doctor_compliance_audit
		WHERE entity_type = $1 AND entity_id = $2 AND action LIKE 'admin.%'
		ORDER BY created_at DESC LIMIT 50`, sp.entityType, id)
	if err != nil {
		return nil, err
	}
	defer hist.Close()
	for hist.Next() {
		var h HistoryEntry
		if err := hist.Scan(&h.Action, &h.AdminID, &h.From, &h.To, &h.CreatedAt); err != nil {
			return nil, err
		}
		d.History = append(d.History, h)
	}
	return d, hist.Err()
}

// Summary counts every queue by status for the KPI strip.
func (s *Store) Summary(ctx context.Context) (map[string]KindSummary, error) {
	out := make(map[string]KindSummary, len(specs))
	for kind, sp := range specs {
		rows, err := s.db.Query(ctx, fmt.Sprintf(
			`SELECT t.status, (aa.admin_id IS NULL), count(*) FROM %s t %s GROUP BY 1, 2`, sp.table, assigneeJoin), sp.entityType)
		if err != nil {
			return nil, fmt.Errorf("support: summary %s: %w", kind, err)
		}
		ks := KindSummary{ByStatus: map[string]int{}}
		for rows.Next() {
			var status string
			var unassigned bool
			var n int
			if err := rows.Scan(&status, &unassigned, &n); err != nil {
				rows.Close()
				return nil, err
			}
			status = sp.normalise(status)
			ks.Total += n
			ks.ByStatus[status] += n
			if unassigned && sp.isOpenStatus(status) {
				ks.UnassignedOpen += n
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
		out[string(kind)] = ks
	}
	return out, nil
}

// Facilities lists doctor-saved emergency facilities (read-only reference).
func (s *Store) Facilities(ctx context.Context, q string, limit, offset int) ([]Facility, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id::text, user_id::text, COALESCE(name,''), COALESCE(facility_type,''), location, created_at
		FROM doctor_emergency_facilities
		WHERE $1::text = '' OR name ILIKE $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, likePattern(q), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Facility{}
	for rows.Next() {
		var f Facility
		var loc []byte
		if err := rows.Scan(&f.ID, &f.DoctorUserID, &f.Name, &f.FacilityType, &loc, &f.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(loc, &f.Location)
		out = append(out, f)
	}
	return out, rows.Err()
}

// ── mutations ───────────────────────────────────────────────────────────────

func (s *Store) inTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// lock takes the row lock that serialises concurrent admin actions on one item.
func lock(ctx context.Context, tx pgx.Tx, sp spec, id string) (userID, status string, err error) {
	err = tx.QueryRow(ctx, fmt.Sprintf(`SELECT user_id::text, status FROM %s WHERE id = $1::uuid FOR UPDATE`, sp.table), id).Scan(&userID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrNotFound
	}
	return userID, sp.normalise(status), err
}

// audit appends the immutable trail row. created_at uses clock_timestamp() so two
// actions in one transaction still order deterministically (assignee = latest row).
// The doctor owns the row (user_id) so it
// shows in their compliance trail; the acting admin is recorded in detail.
func audit(ctx context.Context, tx pgx.Tx, sp spec, doctorID, id, action string, detail map[string]any) error {
	raw, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO doctor_compliance_audit (user_id, action, entity_type, entity_id, detail, created_at)
		VALUES ($1::uuid, $2, $3, $4, $5::jsonb, clock_timestamp())`, doctorID, action, sp.entityType, id, raw)
	return err
}

func notify(ctx context.Context, tx pgx.Tx, sp spec, doctorID, id, title, body string) error {
	raw, _ := json.Marshal(map[string]any{"entity_type": sp.entityType, "entity_id": id})
	_, err := tx.Exec(ctx, `
		INSERT INTO doctor_notifications (user_id, notif_type, title, body, group_key, detail)
		VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb)`, doctorID, sp.notifType, title, body, sp.entityType, raw)
	return err
}

func insertAgentMessage(ctx context.Context, tx pgx.Tx, sp spec, doctorID, id, body, idemKey string) (inserted bool, msgID string, err error) {
	msgID = uuid.NewString()
	var ticketID *string
	if sp.kind == KindTicket {
		ticketID = &id
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO doctor_support_messages (id, user_id, thread_id, ticket_id, author, body, idempotency_key)
		VALUES ($1::uuid, $2::uuid, $3, $4::uuid, 'agent', $5, $6)
		ON CONFLICT (idempotency_key) DO NOTHING`, msgID, doctorID, id, ticketID, body, idemKey)
	if err != nil {
		return false, "", err
	}
	return tag.RowsAffected() == 1, msgID, nil
}

func snippet(s string, n int) string {
	r := []rune(strings.TrimSpace(s))
	if len(r) <= n {
		return string(r)
	}
	return string(r[:n]) + "…"
}

// SetStatus moves an item along its state machine. note is shown to the doctor
// (thread message for tickets and disputes, stored resolution otherwise).
func (s *Store) SetStatus(ctx context.Context, kind Kind, id, adminID, to, note string) (*ItemDetail, error) {
	sp, ok := specs[kind]
	if !ok || !sp.knownStatus(to) {
		return nil, ErrValidation
	}
	note = strings.TrimSpace(note)
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		doctorID, from, err := lock(ctx, tx, sp, id)
		if err != nil {
			return err
		}
		if !sp.canMove(from, to) {
			return fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, from, to)
		}

		sets := []string{"status = $2"}
		args := []any{id, to}
		if sp.hasUpdated {
			sets = append(sets, "updated_at = now()")
		}
		if sp.kind == KindTicket && note != "" {
			args = append(args, note)
			sets = append(sets, fmt.Sprintf("last_reply = $%d", len(args)))
		}
		if sp.hasDetail && note != "" {
			resolution, _ := json.Marshal(map[string]any{"admin_resolution": map[string]any{
				"status": to, "note": note, "at": time.Now().UTC().Format(time.RFC3339),
			}})
			args = append(args, resolution)
			sets = append(sets, fmt.Sprintf("detail = detail || $%d::jsonb", len(args)))
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET %s WHERE id = $1::uuid`, sp.table, strings.Join(sets, ", ")), args...); err != nil {
			return err
		}
		if sp.hasMessages && note != "" {
			if _, _, err := insertAgentMessage(ctx, tx, sp, doctorID, id, note, "admin-status:"+uuid.NewString()); err != nil {
				return err
			}
		}
		if err := audit(ctx, tx, sp, doctorID, id, "admin.status", map[string]any{
			"admin_id": adminID, "from": from, "to": to, "has_note": note != "",
		}); err != nil {
			return err
		}
		body := fmt.Sprintf("Your %s is now %s.", sp.noun, strings.ReplaceAll(to, "_", " "))
		if note != "" {
			body += " " + snippet(note, 140)
		}
		return notify(ctx, tx, sp, doctorID, id, "Update on your "+sp.noun, body)
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, kind, id)
}

// Reply posts an agent message to a ticket/dispute thread. idemKey makes a
// retried POST a no-op that returns the current thread.
func (s *Store) Reply(ctx context.Context, kind Kind, id, adminID, body, idemKey string) (*ItemDetail, error) {
	sp, ok := specs[kind]
	if !ok || !sp.hasMessages {
		return nil, ErrValidation
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return nil, ErrValidation
	}
	if idemKey == "" {
		idemKey = "admin-reply:" + uuid.NewString()
	} else {
		idemKey = "admin-reply:" + id + ":" + idemKey
	}
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		doctorID, status, err := lock(ctx, tx, sp, id)
		if err != nil {
			return err
		}
		if len(sp.transitions[status]) == 0 {
			return ErrClosed
		}
		inserted, msgID, err := insertAgentMessage(ctx, tx, sp, doctorID, id, body, idemKey)
		if err != nil {
			return err
		}
		if !inserted {
			return nil // replayed request: the first attempt already did everything
		}

		next := ""
		switch {
		case sp.kind == KindTicket && status == "open":
			next = "in_progress"
		case sp.kind == KindDispute && status == "open":
			next = "under_review"
		}
		sets := "updated_at = now()"
		args := []any{id}
		if next != "" {
			args = append(args, next)
			sets += fmt.Sprintf(", status = $%d", len(args))
		}
		if sp.kind == KindTicket {
			args = append(args, body)
			sets += fmt.Sprintf(", last_reply = $%d", len(args))
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`UPDATE %s SET %s WHERE id = $1::uuid`, sp.table, sets), args...); err != nil {
			return err
		}
		detail := map[string]any{"admin_id": adminID, "message_id": msgID}
		if next != "" {
			detail["from"], detail["to"] = status, next
		}
		if err := audit(ctx, tx, sp, doctorID, id, "admin.reply", detail); err != nil {
			return err
		}
		return notify(ctx, tx, sp, doctorID, id, "New reply on your "+sp.noun, snippet(body, 140))
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, kind, id)
}

// Assign sets (or with assignee == "" clears) the owner of an item.
func (s *Store) Assign(ctx context.Context, kind Kind, id, adminID, assignee string) (*ItemDetail, error) {
	sp, ok := specs[kind]
	if !ok {
		return nil, ErrValidation
	}
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		doctorID, _, err := lock(ctx, tx, sp, id)
		if err != nil {
			return err
		}
		var current *string
		if err := tx.QueryRow(ctx, `
			SELECT NULLIF(detail->>'admin_id','') FROM doctor_compliance_audit
			WHERE entity_type = $1 AND entity_id = $2 AND action = 'admin.assign'
			ORDER BY created_at DESC LIMIT 1`, sp.entityType, id).Scan(&current); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		have := ""
		if current != nil {
			have = *current
		}
		if have == assignee {
			return nil
		}
		if assignee != "" {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid)`, assignee).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				return fmt.Errorf("%w: unknown assignee", ErrValidation)
			}
		}
		return audit(ctx, tx, sp, doctorID, id, "admin.assign", map[string]any{
			"admin_id": assignee, "by": adminID, "from": have, "to": assignee,
		})
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, kind, id)
}
