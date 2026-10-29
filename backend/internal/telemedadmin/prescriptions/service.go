package prescriptions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

var (
	ErrNotFound   = errors.New("prescriptions: not found")
	ErrValidation = errors.New("prescriptions: validation")
)

// DB is the slice of *pgxpool.Pool the service needs.
type DB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Service reads prescription oversight data.
type Service struct{ db DB }

func NewService(db DB) *Service { return &Service{db: db} }

var (
	uuidRe       = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	statusWordRe = regexp.MustCompile(`^[a-z_]{1,32}$`)
	rxStatuses   = map[string]bool{"draft": true, "issued": true, "dispensed": true, "cancelled": true}
	refillStates = map[string]bool{"pending": true, "approved": true, "rejected": true, "consultation_required": true}
)

// rxCTE unions doctor-issued prescriptions with the legacy telemedicine-booking
// prescriptions into one shape. "flagged" is derived from the latest admin_flagged /
// admin_unflagged row in doctor_prescription_audit (legacy rows have no audit table).
const rxCTE = `
WITH rx AS (
  SELECT p.id::text AS id, 'doctor'::text AS source, COALESCE(p.ref,'') AS ref,
         COALESCE(d.id::text,'') AS doctor_id, COALESCE(d.name,'') AS doctor_name,
         COALESCE(p.patient_id,'') AS patient_id,
         COALESCE(NULLIF(p.patient->>'name',''), NULLIF(p.patient->>'full_name',''), '') AS patient_name,
         COALESCE(p.diagnosis,'') AS diagnosis, p.status::text AS status,
         p.issued_at AS issued_at, p.created_at AS created_at,
         (SELECT count(*) FROM doctor_prescription_items i WHERE i.prescription_id = p.id)::int AS item_count,
         COALESCE((SELECT a.action = 'admin_flagged' FROM doctor_prescription_audit a
                   WHERE a.prescription_id = p.id AND a.action IN ('admin_flagged','admin_unflagged')
                   ORDER BY a.created_at DESC, a.id DESC LIMIT 1), false) AS flagged,
         p.patient AS patient_json, ''::text AS meds, ''::text AS instr
  FROM doctor_prescriptions p
  LEFT JOIN doctors d ON d.user_id = p.user_id
  UNION ALL
  SELECT l.id::text, 'telemedicine', '', COALESCE(l.doctor_id::text,''), COALESCE(d.name,''),
         COALESCE(l.patient_id::text,''), '', '', 'issued', l.issued_at, l.issued_at, 1, false,
         '{}'::jsonb, COALESCE(l.medications,''), COALESCE(l.instructions,'')
  FROM prescriptions l
  LEFT JOIN doctors d ON d.id = l.doctor_id
)`

func likeEscape(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

func parseDay(s, field string) (*time.Time, error) {
	if s == "" {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return nil, fmt.Errorf("%w: %s must be YYYY-MM-DD", ErrValidation, field)
	}
	return &t, nil
}

// Summary returns the KPI counters.
func (s *Service) Summary(ctx context.Context) (*Summary, error) {
	const q = rxCTE + `
SELECT
  (SELECT count(*) FROM rx WHERE status IN ('issued','dispensed') AND issued_at >= now() - interval '30 days')::int,
  (SELECT count(*) FROM doctor_pharmacy_fulfilments
     WHERE status NOT IN ('received','delivered','completed','cancelled','rejected','failed'))::int,
  (SELECT count(*) FROM rx WHERE flagged)::int,
  (SELECT count(*) FROM doctor_refill_requests WHERE status = 'pending')::int,
  (SELECT count(*) FROM doctor_pharmacy_substitutes WHERE status = 'proposed')::int`
	var out Summary
	if err := s.db.QueryRow(ctx, q).Scan(&out.Issued30d, &out.PendingFulfilment, &out.Flagged,
		&out.RefillsPending, &out.SubstitutionsPending); err != nil {
		return nil, fmt.Errorf("prescriptions: summary: %w", err)
	}
	return &out, nil
}

// List returns one page of prescriptions with the patient masked.
func (s *Service) List(ctx context.Context, q ListQuery) ([]PrescriptionRow, int, error) {
	if q.Status != "" && !rxStatuses[q.Status] {
		return nil, 0, fmt.Errorf("%w: unknown status", ErrValidation)
	}
	if q.DoctorID != "" && !uuidRe.MatchString(q.DoctorID) {
		return nil, 0, fmt.Errorf("%w: doctor_id must be a uuid", ErrValidation)
	}
	if len(q.Q) > maxQueryLen {
		return nil, 0, fmt.Errorf("%w: q too long", ErrValidation)
	}
	from, err := parseDay(q.From, "from")
	if err != nil {
		return nil, 0, err
	}
	to, err := parseDay(q.To, "to")
	if err != nil {
		return nil, 0, err
	}
	if from != nil && to != nil && to.Before(*from) {
		return nil, 0, fmt.Errorf("%w: to is before from", ErrValidation)
	}
	limit, offset := clampPage(q.Limit, q.Offset)
	needle := strings.TrimSpace(q.Q)
	like := "%" + likeEscape(needle) + "%"

	const sql = rxCTE + `
SELECT id, source, ref, doctor_id, doctor_name, patient_id, patient_name, diagnosis, status,
       item_count, flagged, issued_at, created_at, count(*) OVER()
FROM rx
WHERE ($1::text = '' OR status = $1::text)
  AND ($2::text = '' OR doctor_id = $2::text)
  AND ($3::date IS NULL OR COALESCE(issued_at, created_at) >= $3::date)
  AND ($4::date IS NULL OR COALESCE(issued_at, created_at) < $4::date + 1)
  AND ($5::boolean IS NULL OR flagged = $5::boolean)
  AND ($6::text = '' OR ref ILIKE $7::text OR doctor_name ILIKE $7::text OR diagnosis ILIKE $7::text OR id = $6::text)
ORDER BY COALESCE(issued_at, created_at) DESC, id
LIMIT $8 OFFSET $9`
	rows, err := s.db.Query(ctx, sql, q.Status, q.DoctorID, from, to, q.Flagged, needle, like, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("prescriptions: list: %w", err)
	}
	defer rows.Close()
	out := []PrescriptionRow{}
	total := 0
	for rows.Next() {
		var r PrescriptionRow
		var patientID, patientName string
		if err := rows.Scan(&r.ID, &r.Source, &r.Ref, &r.DoctorID, &r.DoctorName, &patientID, &patientName,
			&r.Diagnosis, &r.Status, &r.ItemCount, &r.Flagged, &r.IssuedAt, &r.CreatedAt, &total); err != nil {
			return nil, 0, fmt.Errorf("prescriptions: scan: %w", err)
		}
		r.PatientMasked = maskPatient(patientName, patientID)
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// ListFulfilments returns the pharmacy fulfilment queue.
func (s *Service) ListFulfilments(ctx context.Context, q PageQuery) ([]FulfilmentRow, int, error) {
	if q.Status != "" && !statusWordRe.MatchString(q.Status) {
		return nil, 0, fmt.Errorf("%w: invalid status", ErrValidation)
	}
	limit, offset := clampPage(q.Limit, q.Offset)
	const sql = `
SELECT f.id::text, f.prescription_id::text, COALESCE(p.ref,''),
       COALESCE(NULLIF(f.pharmacy->>'name',''), f.pharmacy_id, ''), f.status, f.total_kobo,
       (SELECT count(*) FROM doctor_pharmacy_substitutes s WHERE s.fulfilment_id = f.id AND s.status = 'proposed')::int,
       COALESCE((SELECT dd.status FROM doctor_drug_deliveries dd WHERE dd.fulfilment_id = f.id
                 ORDER BY dd.created_at DESC LIMIT 1), ''),
       f.created_at, count(*) OVER()
FROM doctor_pharmacy_fulfilments f
LEFT JOIN doctor_prescriptions p ON p.id = f.prescription_id
WHERE ($1::text = '' OR f.status = $1::text)
ORDER BY f.created_at DESC, f.id
LIMIT $2 OFFSET $3`
	rows, err := s.db.Query(ctx, sql, q.Status, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("prescriptions: list fulfilments: %w", err)
	}
	defer rows.Close()
	out := []FulfilmentRow{}
	total := 0
	for rows.Next() {
		var r FulfilmentRow
		if err := rows.Scan(&r.ID, &r.PrescriptionID, &r.PrescriptionRef, &r.PharmacyName, &r.Status,
			&r.TotalKobo, &r.PendingSubstitutions, &r.DeliveryStatus, &r.CreatedAt, &total); err != nil {
			return nil, 0, fmt.Errorf("prescriptions: scan fulfilment: %w", err)
		}
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// ListRefills returns the refill request queue with the patient masked.
func (s *Service) ListRefills(ctx context.Context, q PageQuery) ([]RefillRow, int, error) {
	if q.Status != "" && !refillStates[q.Status] {
		return nil, 0, fmt.Errorf("%w: unknown status", ErrValidation)
	}
	limit, offset := clampPage(q.Limit, q.Offset)
	const sql = `
SELECT r.id::text, r.prescription_id::text, COALESCE(p.ref,''), COALESCE(d.name,''),
       COALESCE(NULLIF(r.patient->>'name',''), NULLIF(r.patient->>'full_name',''), NULLIF(p.patient->>'name',''), ''),
       COALESCE(p.patient_id,''), r.status, r.created_at, r.reviewed_at, count(*) OVER()
FROM doctor_refill_requests r
LEFT JOIN doctor_prescriptions p ON p.id = r.prescription_id
LEFT JOIN doctors d ON d.user_id = r.user_id
WHERE ($1::text = '' OR r.status = $1::text)
ORDER BY r.created_at DESC, r.id
LIMIT $2 OFFSET $3`
	rows, err := s.db.Query(ctx, sql, q.Status, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("prescriptions: list refills: %w", err)
	}
	defer rows.Close()
	out := []RefillRow{}
	total := 0
	for rows.Next() {
		var r RefillRow
		var name, pid string
		if err := rows.Scan(&r.ID, &r.PrescriptionID, &r.PrescriptionRef, &r.DoctorName, &name, &pid,
			&r.Status, &r.CreatedAt, &r.ReviewedAt, &total); err != nil {
			return nil, 0, fmt.Errorf("prescriptions: scan refill: %w", err)
		}
		r.PatientMasked = maskPatient(name, pid)
		out = append(out, r)
	}
	return out, total, rows.Err()
}

// Get returns the unmasked detail. The access is recorded in doctor_record_access_log
// BEFORE any patient data is returned, and a failed log write aborts the call (fail closed).
func (s *Service) Get(ctx context.Context, adminID, id string) (*Detail, error) {
	if !uuidRe.MatchString(id) {
		return nil, ErrNotFound
	}
	const headQ = rxCTE + `
SELECT id, source, ref, doctor_id, doctor_name, patient_id, patient_name, diagnosis, status,
       item_count, flagged, issued_at, created_at, patient_json::text, meds, instr
FROM rx WHERE id = $1::text`
	var d Detail
	var patientName, patientJSON string
	err := s.db.QueryRow(ctx, headQ, id).Scan(&d.ID, &d.Source, &d.Ref, &d.DoctorID, &d.DoctorName, &d.PatientID,
		&patientName, &d.Diagnosis, &d.Status, &d.ItemCount, &d.Flagged, &d.IssuedAt, &d.CreatedAt,
		&patientJSON, &d.MedicationsText, &d.Instructions)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("prescriptions: get: %w", err)
	}

	logDetail, _ := json.Marshal(map[string]any{"source": "admin_console", "prescription_id": id})
	if _, err := s.db.Exec(ctx, `
INSERT INTO doctor_record_access_log (user_id, patient_id, action, detail) VALUES ($1, NULLIF($2::text,''), 'view', $3::jsonb)`,
		adminID, d.PatientID, string(logDetail)); err != nil {
		return nil, fmt.Errorf("prescriptions: access log: %w", err)
	}

	d.PatientMasked = maskPatient(patientName, d.PatientID)
	d.Patient = map[string]any{}
	_ = json.Unmarshal([]byte(patientJSON), &d.Patient)
	d.Items, d.Audit, d.Fulfilments, d.Refills = []Item{}, []AuditEntry{}, []FulfilmentDetail{}, []RefillDetail{}
	if d.Source != sourceDoctor {
		return &d, nil
	}

	irows, err := s.db.Query(ctx, `
SELECT name, COALESCE(dosage,''), COALESCE(route,''), COALESCE(frequency,''), COALESCE(duration,''), COALESCE(notes,'')
FROM doctor_prescription_items WHERE prescription_id = $1::uuid ORDER BY position, created_at`, id)
	if err != nil {
		return nil, fmt.Errorf("prescriptions: items: %w", err)
	}
	for irows.Next() {
		var it Item
		if err := irows.Scan(&it.Name, &it.Dosage, &it.Route, &it.Frequency, &it.Duration, &it.Notes); err != nil {
			irows.Close()
			return nil, err
		}
		d.Items = append(d.Items, it)
	}
	irows.Close()

	arows, err := s.db.Query(ctx, `
SELECT a.action, CASE WHEN a.user_id = p.user_id THEN 'doctor' ELSE 'admin' END,
       COALESCE(a.prev_status,''), COALESCE(a.new_status,''), a.detail::text, a.created_at
FROM doctor_prescription_audit a JOIN doctor_prescriptions p ON p.id = a.prescription_id
WHERE a.prescription_id = $1::uuid ORDER BY a.created_at, a.id`, id)
	if err != nil {
		return nil, fmt.Errorf("prescriptions: audit: %w", err)
	}
	for arows.Next() {
		var e AuditEntry
		var raw string
		if err := arows.Scan(&e.Action, &e.Actor, &e.PrevStatus, &e.NewStatus, &raw, &e.CreatedAt); err != nil {
			arows.Close()
			return nil, err
		}
		e.Detail = map[string]any{}
		_ = json.Unmarshal([]byte(raw), &e.Detail)
		d.Audit = append(d.Audit, e)
	}
	arows.Close()

	frows, err := s.db.Query(ctx, `
SELECT id::text, COALESCE(NULLIF(pharmacy->>'name',''), pharmacy_id, ''), status, total_kobo
FROM doctor_pharmacy_fulfilments WHERE prescription_id = $1::uuid ORDER BY created_at`, id)
	if err != nil {
		return nil, fmt.Errorf("prescriptions: fulfilments: %w", err)
	}
	for frows.Next() {
		var f FulfilmentDetail
		if err := frows.Scan(&f.ID, &f.PharmacyName, &f.Status, &f.TotalKobo); err != nil {
			frows.Close()
			return nil, err
		}
		f.Deliveries, f.Substitutes = []Delivery{}, []Substitute{}
		d.Fulfilments = append(d.Fulfilments, f)
	}
	frows.Close()
	for i := range d.Fulfilments {
		f := &d.Fulfilments[i]
		drows, err := s.db.Query(ctx, `
SELECT status, COALESCE(courier,''), COALESCE(tracking_ref,''), eta, delivered_at
FROM doctor_drug_deliveries WHERE fulfilment_id = $1::uuid ORDER BY created_at`, f.ID)
		if err != nil {
			return nil, fmt.Errorf("prescriptions: deliveries: %w", err)
		}
		for drows.Next() {
			var dl Delivery
			if err := drows.Scan(&dl.Status, &dl.Courier, &dl.TrackingRef, &dl.ETA, &dl.DeliveredAt); err != nil {
				drows.Close()
				return nil, err
			}
			f.Deliveries = append(f.Deliveries, dl)
		}
		drows.Close()
		srows, err := s.db.Query(ctx, `
SELECT COALESCE(original_drug,''), COALESCE(substitute_drug,''), status, price_kobo
FROM doctor_pharmacy_substitutes WHERE fulfilment_id = $1::uuid ORDER BY created_at`, f.ID)
		if err != nil {
			return nil, fmt.Errorf("prescriptions: substitutes: %w", err)
		}
		for srows.Next() {
			var sb Substitute
			if err := srows.Scan(&sb.OriginalDrug, &sb.SubstituteDrug, &sb.Status, &sb.PriceKobo); err != nil {
				srows.Close()
				return nil, err
			}
			f.Substitutes = append(f.Substitutes, sb)
		}
		srows.Close()
	}

	rrows, err := s.db.Query(ctx, `
SELECT id::text, status, created_at, reviewed_at FROM doctor_refill_requests
WHERE prescription_id = $1::uuid ORDER BY created_at`, id)
	if err != nil {
		return nil, fmt.Errorf("prescriptions: refills: %w", err)
	}
	for rrows.Next() {
		var r RefillDetail
		if err := rrows.Scan(&r.ID, &r.Status, &r.CreatedAt, &r.ReviewedAt); err != nil {
			rrows.Close()
			return nil, err
		}
		d.Refills = append(d.Refills, r)
	}
	rrows.Close()
	return &d, nil
}

// SetFlag flags or unflags a doctor-issued prescription. It is idempotent: a repeat of
// the current state writes nothing. The change is an append-only audit row.
func (s *Service) SetFlag(ctx context.Context, adminID, id string, flag bool, note string) (*FlagState, error) {
	if adminID == "" {
		return nil, fmt.Errorf("%w: missing actor", ErrValidation)
	}
	note = strings.TrimSpace(note)
	if flag && (len(note) < 3 || len(note) > 500) {
		return nil, fmt.Errorf("%w: reason must be 3-500 characters", ErrValidation)
	}
	if len(note) > 500 {
		return nil, fmt.Errorf("%w: note too long", ErrValidation)
	}
	if !uuidRe.MatchString(id) {
		return nil, ErrNotFound
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("prescriptions: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var status string
	err = tx.QueryRow(ctx, `SELECT status FROM doctor_prescriptions WHERE id = $1::uuid FOR UPDATE`, id).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("prescriptions: lock: %w", err)
	}
	var current bool
	if err := tx.QueryRow(ctx, `
SELECT COALESCE((SELECT a.action = 'admin_flagged' FROM doctor_prescription_audit a
                 WHERE a.prescription_id = $1::uuid AND a.action IN ('admin_flagged','admin_unflagged')
                 ORDER BY a.created_at DESC, a.id DESC LIMIT 1), false)`, id).Scan(&current); err != nil {
		return nil, fmt.Errorf("prescriptions: flag state: %w", err)
	}
	if current != flag {
		action, key := actionUnflag, "note"
		if flag {
			action, key = actionFlag, "reason"
		}
		detail, _ := json.Marshal(map[string]any{key: note, "source": "admin_console"})
		if _, err := tx.Exec(ctx, `
INSERT INTO doctor_prescription_audit (prescription_id, user_id, action, prev_status, new_status, detail, created_at)
VALUES ($1::uuid, $2::uuid, $3, $4, $4, $5::jsonb, clock_timestamp())`, id, adminID, action, status, string(detail)); err != nil {
			return nil, fmt.Errorf("prescriptions: audit insert: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("prescriptions: commit: %w", err)
	}
	return &FlagState{ID: id, Flagged: flag}, nil
}
