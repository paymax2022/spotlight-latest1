package doctor

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// repository_clinical.go — pgx data access for the Wave 3a (human-side CLINICAL)
// endpoint groups: pharmacy, labs (extended), referrals/collaboration, follow-up
// care, HMO, medical records.
//
// Every read is scoped to the owning doctor's user_id (defence in depth on top of
// RLS). Mutations on tables carrying a UNIQUE idempotency_key create rows with
// ON CONFLICT (idempotency_key) DO NOTHING + replay (exactly like the Wave 2 repo,
// e.g. InsertMerchantUpgrade); state-transition mutations on pre-existing rows are
// status-guarded scoped UPDATEs (naturally idempotent, mirroring the MVP
// UpdateAppointmentStatus / ReviewLabResult). None of these post ledger entries —
// they are clinical state transitions / document writes, not value movements.
//
// Reference directories with no backing table in the migration (pharmacies,
// pharmacies/preferred, pharmacy stock, delivery alerts, lab catalogue / packages /
// providers, specialists, lab value comparisons) return an empty projection.

// ══ PHARMACY ════════════════════════════════════════════════════════════════

// ── Fulfilments ──────────────────────────────────────────────────────────────

func (r *Repository) ListPharmacyFulfilments(ctx context.Context, userID string) ([]PharmacyFulfilment, error) {
	const q = `
		SELECT id, user_id, prescription_id, pharmacy_id, pharmacy, status, total_kobo, detail, created_at, updated_at
		FROM doctor_pharmacy_fulfilments WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PharmacyFulfilment{}
	for rows.Next() {
		f := PharmacyFulfilment{}
		if err := rows.Scan(&f.ID, &f.UserID, &f.PrescriptionID, &f.PharmacyID, &f.Pharmacy,
			&f.Status, &f.TotalKobo, &f.Detail, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *Repository) GetPharmacyFulfilment(ctx context.Context, userID, id string) (*PharmacyFulfilment, error) {
	const q = `
		SELECT id, user_id, prescription_id, pharmacy_id, pharmacy, status, total_kobo, detail, created_at, updated_at
		FROM doctor_pharmacy_fulfilments WHERE id = $1 AND user_id = $2`
	f := &PharmacyFulfilment{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&f.ID, &f.UserID, &f.PrescriptionID, &f.PharmacyID,
		&f.Pharmacy, &f.Status, &f.TotalKobo, &f.Detail, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return f, err
}

// ConfirmFulfilmentReceived marks the fulfilment received (scoped, status-guarded → idempotent).
func (r *Repository) ConfirmFulfilmentReceived(ctx context.Context, userID, fulfilmentID string, detail []byte) (*PharmacyFulfilment, error) {
	const q = `
		UPDATE doctor_pharmacy_fulfilments
		SET status = 'received', detail = detail || $3::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, fulfilmentID, userID, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetPharmacyFulfilment(ctx, userID, fulfilmentID)
}

// ── Substitutes ──────────────────────────────────────────────────────────────

// ReviewSubstitute approves/rejects the latest proposed substitute on a fulfilment.
// status is 'approved' | 'rejected'. Scoped to the fulfilment's owner; status-guarded.
func (r *Repository) ReviewSubstitute(ctx context.Context, userID, fulfilmentID, status string, detail []byte) (*PharmacySubstitute, error) {
	const q = `
		UPDATE doctor_pharmacy_substitutes
		SET status = $3, reviewed_at = now(), detail = detail || $4::jsonb
		WHERE fulfilment_id = $1 AND user_id = $2 AND status = 'proposed'`
	tag, err := r.db.Exec(ctx, q, fulfilmentID, userID, status, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// No pending substitute — return the latest one (idempotent replay) or 404.
		return r.latestSubstitute(ctx, userID, fulfilmentID)
	}
	return r.latestSubstitute(ctx, userID, fulfilmentID)
}

func (r *Repository) latestSubstitute(ctx context.Context, userID, fulfilmentID string) (*PharmacySubstitute, error) {
	const q = `
		SELECT id, fulfilment_id, user_id, original_drug, substitute_drug, status, price_kobo, reviewed_at, detail, created_at
		FROM doctor_pharmacy_substitutes WHERE fulfilment_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`
	s := &PharmacySubstitute{}
	err := r.db.QueryRow(ctx, q, fulfilmentID, userID).Scan(&s.ID, &s.FulfilmentID, &s.UserID,
		&s.OriginalDrug, &s.SubstituteDrug, &s.Status, &s.PriceKobo, &s.ReviewedAt, &s.Detail, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// ── Drug deliveries ──────────────────────────────────────────────────────────

func (r *Repository) ListDrugDeliveries(ctx context.Context, userID string) ([]DrugDelivery, error) {
	const q = `
		SELECT id, fulfilment_id, user_id, status, courier, tracking_ref, eta, delivered_at, detail, created_at, updated_at
		FROM doctor_drug_deliveries WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DrugDelivery{}
	for rows.Next() {
		d := DrugDelivery{}
		if err := rows.Scan(&d.ID, &d.FulfilmentID, &d.UserID, &d.Status, &d.Courier,
			&d.TrackingRef, &d.ETA, &d.DeliveredAt, &d.Detail, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// GetDeliveryForFulfilment returns the delivery row for a fulfilment (scoped).
func (r *Repository) GetDeliveryForFulfilment(ctx context.Context, userID, fulfilmentID string) (*DrugDelivery, error) {
	const q = `
		SELECT id, fulfilment_id, user_id, status, courier, tracking_ref, eta, delivered_at, detail, created_at, updated_at
		FROM doctor_drug_deliveries WHERE fulfilment_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`
	d := &DrugDelivery{}
	err := r.db.QueryRow(ctx, q, fulfilmentID, userID).Scan(&d.ID, &d.FulfilmentID, &d.UserID,
		&d.Status, &d.Courier, &d.TrackingRef, &d.ETA, &d.DeliveredAt, &d.Detail, &d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

// ── Refill requests ──────────────────────────────────────────────────────────

func (r *Repository) ListRefillRequests(ctx context.Context, userID string) ([]RefillRequest, error) {
	const q = `
		SELECT id, user_id, prescription_id, patient, status, reviewed_at, detail, created_at, updated_at
		FROM doctor_refill_requests WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RefillRequest{}
	for rows.Next() {
		rr := RefillRequest{}
		if err := rows.Scan(&rr.ID, &rr.UserID, &rr.PrescriptionID, &rr.Patient, &rr.Status,
			&rr.ReviewedAt, &rr.Detail, &rr.CreatedAt, &rr.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

func (r *Repository) GetRefillRequest(ctx context.Context, userID, id string) (*RefillRequest, error) {
	const q = `
		SELECT id, user_id, prescription_id, patient, status, reviewed_at, detail, created_at, updated_at
		FROM doctor_refill_requests WHERE id = $1 AND user_id = $2`
	rr := &RefillRequest{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&rr.ID, &rr.UserID, &rr.PrescriptionID, &rr.Patient,
		&rr.Status, &rr.ReviewedAt, &rr.Detail, &rr.CreatedAt, &rr.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return rr, err
}

// ReviewRefill transitions a refill request. status is approved|rejected|consultation_required.
// Scoped + status-guarded (only the pending row transitions → idempotent replay).
func (r *Repository) ReviewRefill(ctx context.Context, userID, refillID, status string, detail []byte) (*RefillRequest, error) {
	const q = `
		UPDATE doctor_refill_requests
		SET status = $3, reviewed_at = now(), detail = detail || $4::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'pending'`
	if _, err := r.db.Exec(ctx, q, refillID, userID, status, jsonOrEmptyObject(detail)); err != nil {
		return nil, err
	}
	return r.GetRefillRequest(ctx, userID, refillID)
}

// ── Pharmacy messages (per fulfilment thread) ────────────────────────────────

func (r *Repository) ListPharmacyMessages(ctx context.Context, userID, fulfilmentID string) ([]PharmacyMessage, error) {
	const q = `
		SELECT id, fulfilment_id, user_id, author, body, created_at
		FROM doctor_pharmacy_messages WHERE user_id = $1 AND fulfilment_id = $2 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, userID, fulfilmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PharmacyMessage{}
	for rows.Next() {
		m := PharmacyMessage{}
		if err := rows.Scan(&m.ID, &m.FulfilmentID, &m.UserID, &m.Author, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertPharmacyMessage posts a message to a fulfilment thread idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertPharmacyMessage(ctx context.Context, userID, fulfilmentID, author string, body *string, idemKey string) (*PharmacyMessage, error) {
	id := uuid.New().String()
	if author == "" {
		author = "doctor"
	}
	const q = `
		INSERT INTO doctor_pharmacy_messages (id, user_id, fulfilment_id, author, body, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, fulfilmentID, author, body, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getPharmacyMessageByIdem(ctx, userID, idemKey)
	}
	return r.getPharmacyMessageByID(ctx, userID, id)
}

func (r *Repository) getPharmacyMessageByID(ctx context.Context, userID, id string) (*PharmacyMessage, error) {
	const q = `
		SELECT id, fulfilment_id, user_id, author, body, created_at
		FROM doctor_pharmacy_messages WHERE id = $1 AND user_id = $2`
	m := &PharmacyMessage{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&m.ID, &m.FulfilmentID, &m.UserID, &m.Author, &m.Body, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

func (r *Repository) getPharmacyMessageByIdem(ctx context.Context, userID, idemKey string) (*PharmacyMessage, error) {
	const q = `
		SELECT id, fulfilment_id, user_id, author, body, created_at
		FROM doctor_pharmacy_messages WHERE user_id = $1 AND idempotency_key = $2`
	m := &PharmacyMessage{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&m.ID, &m.FulfilmentID, &m.UserID, &m.Author, &m.Body, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// ══ LABS (extended) ═════════════════════════════════════════════════════════

// ListLabResultInbox returns the doctor's lab results for the inbox view.
func (r *Repository) ListLabResultInbox(ctx context.Context, userID string) ([]LabResultInbox, error) {
	const q = `
		SELECT id, user_id, order_id, ref, patient, lab_name, reported_at, reviewed, reviewed_at, created_at, updated_at
		FROM doctor_lab_results WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []LabResultInbox{}
	for rows.Next() {
		v := LabResultInbox{}
		if err := rows.Scan(&v.ID, &v.UserID, &v.OrderID, &v.Ref, &v.Patient, &v.LabName,
			&v.ReportedAt, &v.Reviewed, &v.ReviewedAt, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// GetLabResultRich returns the full lab result (values) by result id (scoped).
// Reuses the MVP getLabResultByID + listLabResultValues for the rich projection.
func (r *Repository) GetLabResultRich(ctx context.Context, userID, resultID string) (*LabResult, error) {
	res, err := r.getLabResultByID(ctx, userID, resultID)
	if err != nil {
		return nil, err
	}
	values, err := r.listLabResultValues(ctx, userID, resultID)
	if err != nil {
		return nil, err
	}
	res.Values = values
	return res, nil
}

// CancelLabOrder cancels an order (scoped, status-guarded → idempotent).
func (r *Repository) CancelLabOrder(ctx context.Context, userID, orderID string) (*LabOrder, error) {
	const q = `
		UPDATE doctor_lab_orders SET status = 'cancelled', updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status <> 'cancelled'`
	if _, err := r.db.Exec(ctx, q, orderID, userID); err != nil {
		return nil, err
	}
	return r.getLabOrder(ctx, userID, orderID)
}

// AddLabInterpretation upserts a free-text interpretation for a result idempotently
// (UNIQUE idempotency_key). Mirrors the MVP ReviewLabResult interpretation insert.
func (r *Repository) AddLabInterpretation(ctx context.Context, userID, resultID, interpretation string, detail []byte, idemKey string) (*LabInterpretation, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_lab_interpretations (id, result_id, user_id, interpretation, detail, idempotency_key, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6, now())
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, resultID, userID, interpretation, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getLabInterpretationByIdem(ctx, userID, idemKey)
	}
	return r.getLabInterpretationByID(ctx, userID, id)
}

func (r *Repository) getLabInterpretationByID(ctx context.Context, userID, id string) (*LabInterpretation, error) {
	const q = `
		SELECT id, result_id, user_id, interpretation, detail, created_at, updated_at
		FROM doctor_lab_interpretations WHERE id = $1 AND user_id = $2`
	li := &LabInterpretation{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&li.ID, &li.ResultID, &li.UserID,
		&li.Interpretation, &li.Detail, &li.CreatedAt, &li.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return li, err
}

func (r *Repository) getLabInterpretationByIdem(ctx context.Context, userID, idemKey string) (*LabInterpretation, error) {
	const q = `
		SELECT id, result_id, user_id, interpretation, detail, created_at, updated_at
		FROM doctor_lab_interpretations WHERE user_id = $1 AND idempotency_key = $2`
	li := &LabInterpretation{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&li.ID, &li.ResultID, &li.UserID,
		&li.Interpretation, &li.Detail, &li.CreatedAt, &li.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return li, err
}

// MarkLabResultShared / MarkLabResultReported are scoped no-op-safe state touches on
// the result row (used by share-explanation / suspicious-report). They confirm
// ownership (404 if absent) and stamp the detail-free reviewed/updated timestamps;
// the share/report payload is recorded via the access log where applicable.
func (r *Repository) TouchLabResult(ctx context.Context, userID, resultID string) (*LabResult, error) {
	const q = `UPDATE doctor_lab_results SET updated_at = now() WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, resultID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetLabResultRich(ctx, userID, resultID)
}

// TouchLabOrder confirms ownership of an order (used by lab-order share). 404 if absent.
func (r *Repository) TouchLabOrder(ctx context.Context, userID, orderID string) (*LabOrder, error) {
	const q = `UPDATE doctor_lab_orders SET updated_at = now() WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, orderID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getLabOrder(ctx, userID, orderID)
}

// ══ REFERRALS & COLLABORATION ═══════════════════════════════════════════════

// ── Outgoing referrals ───────────────────────────────────────────────────────

func (r *Repository) ListReferrals(ctx context.Context, userID string) ([]Referral, error) {
	const q = `
		SELECT id, user_id, specialist_id, patient_id, direction, status, reason, detail, created_at, updated_at
		FROM doctor_referrals WHERE user_id = $1 AND direction = 'outgoing' ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Referral{}
	for rows.Next() {
		rf := Referral{}
		if err := rows.Scan(&rf.ID, &rf.UserID, &rf.SpecialistID, &rf.PatientID, &rf.Direction,
			&rf.Status, &rf.Reason, &rf.Detail, &rf.CreatedAt, &rf.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, rf)
	}
	return out, rows.Err()
}

func (r *Repository) GetReferral(ctx context.Context, userID, id string) (*Referral, error) {
	const q = `
		SELECT id, user_id, specialist_id, patient_id, direction, status, reason, detail, created_at, updated_at
		FROM doctor_referrals WHERE id = $1 AND user_id = $2`
	rf := &Referral{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&rf.ID, &rf.UserID, &rf.SpecialistID, &rf.PatientID,
		&rf.Direction, &rf.Status, &rf.Reason, &rf.Detail, &rf.CreatedAt, &rf.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return rf, err
}

// InsertReferral creates an outgoing referral idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertReferral(ctx context.Context, userID string, specialistID, patientID, reason *string, detail []byte, idemKey string) (*Referral, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_referrals (id, user_id, specialist_id, patient_id, direction, status, reason, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,'outgoing','pending',$5,$6,$7)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, specialistID, patientID, reason, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getReferralByIdem(ctx, userID, idemKey)
	}
	return r.GetReferral(ctx, userID, id)
}

func (r *Repository) getReferralByIdem(ctx context.Context, userID, idemKey string) (*Referral, error) {
	const q = `
		SELECT id, user_id, specialist_id, patient_id, direction, status, reason, detail, created_at, updated_at
		FROM doctor_referrals WHERE user_id = $1 AND idempotency_key = $2`
	rf := &Referral{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&rf.ID, &rf.UserID, &rf.SpecialistID, &rf.PatientID,
		&rf.Direction, &rf.Status, &rf.Reason, &rf.Detail, &rf.CreatedAt, &rf.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return rf, err
}

// ── Incoming referrals ───────────────────────────────────────────────────────

func (r *Repository) ListIncomingReferrals(ctx context.Context, userID string) ([]IncomingReferral, error) {
	const q = `
		SELECT id, user_id, referring_doctor, patient_id, status, reason, detail, created_at, updated_at
		FROM doctor_incoming_referrals WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []IncomingReferral{}
	for rows.Next() {
		ir := IncomingReferral{}
		if err := rows.Scan(&ir.ID, &ir.UserID, &ir.ReferringDoctor, &ir.PatientID, &ir.Status,
			&ir.Reason, &ir.Detail, &ir.CreatedAt, &ir.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, ir)
	}
	return out, rows.Err()
}

func (r *Repository) GetIncomingReferral(ctx context.Context, userID, id string) (*IncomingReferral, error) {
	const q = `
		SELECT id, user_id, referring_doctor, patient_id, status, reason, detail, created_at, updated_at
		FROM doctor_incoming_referrals WHERE id = $1 AND user_id = $2`
	ir := &IncomingReferral{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&ir.ID, &ir.UserID, &ir.ReferringDoctor, &ir.PatientID,
		&ir.Status, &ir.Reason, &ir.Detail, &ir.CreatedAt, &ir.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return ir, err
}

// ReviewIncomingReferral accepts/rejects an incoming referral (scoped, status-guarded).
func (r *Repository) ReviewIncomingReferral(ctx context.Context, userID, referralID, status string, detail []byte) (*IncomingReferral, error) {
	const q = `
		UPDATE doctor_incoming_referrals
		SET status = $3, detail = detail || $4::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'pending'`
	if _, err := r.db.Exec(ctx, q, referralID, userID, status, jsonOrEmptyObject(detail)); err != nil {
		return nil, err
	}
	return r.GetIncomingReferral(ctx, userID, referralID)
}

// ── Opinion requests ─────────────────────────────────────────────────────────

func (r *Repository) ListOpinionRequests(ctx context.Context, userID string) ([]OpinionRequest, error) {
	const q = `
		SELECT id, user_id, patient_id, status, question, detail, created_at, updated_at
		FROM doctor_opinion_requests WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OpinionRequest{}
	for rows.Next() {
		o := OpinionRequest{}
		if err := rows.Scan(&o.ID, &o.UserID, &o.PatientID, &o.Status, &o.Question,
			&o.Detail, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (r *Repository) GetOpinionRequest(ctx context.Context, userID, id string) (*OpinionRequest, error) {
	const q = `
		SELECT id, user_id, patient_id, status, question, detail, created_at, updated_at
		FROM doctor_opinion_requests WHERE id = $1 AND user_id = $2`
	o := &OpinionRequest{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&o.ID, &o.UserID, &o.PatientID, &o.Status,
		&o.Question, &o.Detail, &o.CreatedAt, &o.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

// InsertOpinionRequest creates an opinion request idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertOpinionRequest(ctx context.Context, userID string, patientID, question *string, detail []byte, idemKey string) (*OpinionRequest, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_opinion_requests (id, user_id, patient_id, status, question, detail, idempotency_key)
		VALUES ($1,$2,$3,'pending',$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, patientID, question, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getOpinionByIdem(ctx, userID, idemKey)
	}
	return r.GetOpinionRequest(ctx, userID, id)
}

func (r *Repository) getOpinionByIdem(ctx context.Context, userID, idemKey string) (*OpinionRequest, error) {
	const q = `
		SELECT id, user_id, patient_id, status, question, detail, created_at, updated_at
		FROM doctor_opinion_requests WHERE user_id = $1 AND idempotency_key = $2`
	o := &OpinionRequest{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&o.ID, &o.UserID, &o.PatientID, &o.Status,
		&o.Question, &o.Detail, &o.CreatedAt, &o.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return o, err
}

// ── Care-team messages (per thread) ──────────────────────────────────────────

func (r *Repository) ListCareTeamMessages(ctx context.Context, userID, threadID string) ([]CareTeamMessage, error) {
	const q = `
		SELECT id, user_id, thread_id, author, body, created_at
		FROM doctor_care_team_messages WHERE user_id = $1 AND thread_id = $2 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, userID, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CareTeamMessage{}
	for rows.Next() {
		m := CareTeamMessage{}
		if err := rows.Scan(&m.ID, &m.UserID, &m.ThreadID, &m.Author, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertCareTeamMessage posts a message to a care-team thread idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertCareTeamMessage(ctx context.Context, userID, threadID, author string, body *string, idemKey string) (*CareTeamMessage, error) {
	id := uuid.New().String()
	if author == "" {
		author = "doctor"
	}
	const q = `
		INSERT INTO doctor_care_team_messages (id, user_id, thread_id, author, body, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, threadID, author, body, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getCareTeamMessageByIdem(ctx, userID, idemKey)
	}
	return r.getCareTeamMessageByID(ctx, userID, id)
}

func (r *Repository) getCareTeamMessageByID(ctx context.Context, userID, id string) (*CareTeamMessage, error) {
	const q = `
		SELECT id, user_id, thread_id, author, body, created_at
		FROM doctor_care_team_messages WHERE id = $1 AND user_id = $2`
	m := &CareTeamMessage{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&m.ID, &m.UserID, &m.ThreadID, &m.Author, &m.Body, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

func (r *Repository) getCareTeamMessageByIdem(ctx context.Context, userID, idemKey string) (*CareTeamMessage, error) {
	const q = `
		SELECT id, user_id, thread_id, author, body, created_at
		FROM doctor_care_team_messages WHERE user_id = $1 AND idempotency_key = $2`
	m := &CareTeamMessage{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&m.ID, &m.UserID, &m.ThreadID, &m.Author, &m.Body, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// ══ FOLLOW-UP CARE ══════════════════════════════════════════════════════════

func (r *Repository) ListFollowUps(ctx context.Context, userID string) ([]FollowUpPlan, error) {
	const q = `
		SELECT id, user_id, patient_id, appointment_id, status, kind, due_at, reminder_set, completed_at, detail, created_at, updated_at
		FROM doctor_follow_up_plans WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FollowUpPlan{}
	for rows.Next() {
		f := FollowUpPlan{}
		if err := rows.Scan(&f.ID, &f.UserID, &f.PatientID, &f.AppointmentID, &f.Status, &f.Kind,
			&f.DueAt, &f.ReminderSet, &f.CompletedAt, &f.Detail, &f.CreatedAt, &f.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (r *Repository) GetFollowUp(ctx context.Context, userID, id string) (*FollowUpPlan, error) {
	const q = `
		SELECT id, user_id, patient_id, appointment_id, status, kind, due_at, reminder_set, completed_at, detail, created_at, updated_at
		FROM doctor_follow_up_plans WHERE id = $1 AND user_id = $2`
	f := &FollowUpPlan{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&f.ID, &f.UserID, &f.PatientID, &f.AppointmentID,
		&f.Status, &f.Kind, &f.DueAt, &f.ReminderSet, &f.CompletedAt, &f.Detail, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return f, err
}

// InsertFollowUp creates a follow-up plan idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertFollowUp(ctx context.Context, userID string, patientID, appointmentID *string, kind string, detail []byte, idemKey string) (*FollowUpPlan, error) {
	id := uuid.New().String()
	if kind == "" {
		kind = "standard"
	}
	const q = `
		INSERT INTO doctor_follow_up_plans (id, user_id, patient_id, appointment_id, status, kind, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,'scheduled',$5,$6,$7)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, patientID, appointmentID, kind, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getFollowUpByIdem(ctx, userID, idemKey)
	}
	return r.GetFollowUp(ctx, userID, id)
}

func (r *Repository) getFollowUpByIdem(ctx context.Context, userID, idemKey string) (*FollowUpPlan, error) {
	const q = `
		SELECT id, user_id, patient_id, appointment_id, status, kind, due_at, reminder_set, completed_at, detail, created_at, updated_at
		FROM doctor_follow_up_plans WHERE user_id = $1 AND idempotency_key = $2`
	f := &FollowUpPlan{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&f.ID, &f.UserID, &f.PatientID, &f.AppointmentID,
		&f.Status, &f.Kind, &f.DueAt, &f.ReminderSet, &f.CompletedAt, &f.Detail, &f.CreatedAt, &f.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return f, err
}

// ReviewFollowUp approves/rejects a follow-up request (scoped, status-guarded).
func (r *Repository) ReviewFollowUp(ctx context.Context, userID, followUpID, status string, detail []byte) (*FollowUpPlan, error) {
	const q = `
		UPDATE doctor_follow_up_plans
		SET status = $3, detail = detail || $4::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'scheduled'`
	if _, err := r.db.Exec(ctx, q, followUpID, userID, status, jsonOrEmptyObject(detail)); err != nil {
		return nil, err
	}
	return r.GetFollowUp(ctx, userID, followUpID)
}

// CompleteFollowUp marks a follow-up complete (scoped, idempotent).
func (r *Repository) CompleteFollowUp(ctx context.Context, userID, followUpID string, detail []byte) (*FollowUpPlan, error) {
	const q = `
		UPDATE doctor_follow_up_plans
		SET status = 'completed', completed_at = now(), detail = detail || $3::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, followUpID, userID, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetFollowUp(ctx, userID, followUpID)
}

// SetFollowUpReminder flags a reminder on the plan (scoped, idempotent).
func (r *Repository) SetFollowUpReminder(ctx context.Context, userID, followUpID string, detail []byte) (*FollowUpPlan, error) {
	const q = `
		UPDATE doctor_follow_up_plans
		SET reminder_set = true, detail = detail || $3::jsonb, updated_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, followUpID, userID, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetFollowUp(ctx, userID, followUpID)
}

// ── Care plans ───────────────────────────────────────────────────────────────

func (r *Repository) ListCarePlans(ctx context.Context, userID string) ([]CarePlan, error) {
	const q = `
		SELECT id, user_id, patient_id, title, status, plan, created_at, updated_at
		FROM doctor_care_plans WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CarePlan{}
	for rows.Next() {
		cp := CarePlan{}
		if err := rows.Scan(&cp.ID, &cp.UserID, &cp.PatientID, &cp.Title, &cp.Status,
			&cp.Plan, &cp.CreatedAt, &cp.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, cp)
	}
	return out, rows.Err()
}

func (r *Repository) GetCarePlan(ctx context.Context, userID, id string) (*CarePlan, error) {
	const q = `
		SELECT id, user_id, patient_id, title, status, plan, created_at, updated_at
		FROM doctor_care_plans WHERE id = $1 AND user_id = $2`
	cp := &CarePlan{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&cp.ID, &cp.UserID, &cp.PatientID, &cp.Title,
		&cp.Status, &cp.Plan, &cp.CreatedAt, &cp.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return cp, err
}

// InsertCarePlan saves a care plan idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertCarePlan(ctx context.Context, userID string, patientID, title *string, plan []byte, idemKey string) (*CarePlan, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_care_plans (id, user_id, patient_id, title, status, plan, idempotency_key)
		VALUES ($1,$2,$3,$4,'active',$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, patientID, title, jsonOrEmptyObject(plan), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getCarePlanByIdem(ctx, userID, idemKey)
	}
	return r.GetCarePlan(ctx, userID, id)
}

func (r *Repository) getCarePlanByIdem(ctx context.Context, userID, idemKey string) (*CarePlan, error) {
	const q = `
		SELECT id, user_id, patient_id, title, status, plan, created_at, updated_at
		FROM doctor_care_plans WHERE user_id = $1 AND idempotency_key = $2`
	cp := &CarePlan{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&cp.ID, &cp.UserID, &cp.PatientID, &cp.Title,
		&cp.Status, &cp.Plan, &cp.CreatedAt, &cp.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return cp, err
}

// ── Chronic monitoring ───────────────────────────────────────────────────────

func (r *Repository) ListChronicMonitoring(ctx context.Context, userID string) ([]ChronicMonitoringEntry, error) {
	const q = `
		SELECT id, user_id, patient_id, condition, readings, detail, created_at, updated_at
		FROM doctor_chronic_monitoring WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChronicMonitoringEntry{}
	for rows.Next() {
		c := ChronicMonitoringEntry{}
		if err := rows.Scan(&c.ID, &c.UserID, &c.PatientID, &c.Condition, &c.Readings,
			&c.Detail, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// InsertChronicMonitoring saves a chronic-monitoring entry. doctor_chronic_monitoring
// has NO idempotency_key column → plain insert (matches the SCAFFOLD vacation example).
func (r *Repository) InsertChronicMonitoring(ctx context.Context, userID string, patientID, condition *string, readings, detail []byte) (*ChronicMonitoringEntry, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_chronic_monitoring (id, user_id, patient_id, condition, readings, detail)
		VALUES ($1,$2,$3,$4,$5,$6)`
	if _, err := r.db.Exec(ctx, q, id, userID, patientID, condition, jsonOrEmptyArray(readings), jsonOrEmptyObject(detail)); err != nil {
		return nil, err
	}
	const sel = `
		SELECT id, user_id, patient_id, condition, readings, detail, created_at, updated_at
		FROM doctor_chronic_monitoring WHERE id = $1 AND user_id = $2`
	c := &ChronicMonitoringEntry{}
	err := r.db.QueryRow(ctx, sel, id, userID).Scan(&c.ID, &c.UserID, &c.PatientID, &c.Condition,
		&c.Readings, &c.Detail, &c.CreatedAt, &c.UpdatedAt)
	return c, err
}

// ── Adherence checks ─────────────────────────────────────────────────────────

func (r *Repository) ListAdherenceChecks(ctx context.Context, userID string) ([]AdherenceCheck, error) {
	const q = `
		SELECT id, user_id, patient_id, prescription_id, status, detail, created_at
		FROM doctor_adherence_checks WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdherenceCheck{}
	for rows.Next() {
		a := AdherenceCheck{}
		if err := rows.Scan(&a.ID, &a.UserID, &a.PatientID, &a.PrescriptionID, &a.Status,
			&a.Detail, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// InsertAdherenceCheck records an adherence check idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertAdherenceCheck(ctx context.Context, userID string, patientID, prescriptionID *string, status string, detail []byte, idemKey string) (*AdherenceCheck, error) {
	id := uuid.New().String()
	if status == "" {
		status = "pending"
	}
	const q = `
		INSERT INTO doctor_adherence_checks (id, user_id, patient_id, prescription_id, status, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, patientID, prescriptionID, status, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getAdherenceByIdem(ctx, userID, idemKey)
	}
	return r.getAdherenceByID(ctx, userID, id)
}

func (r *Repository) getAdherenceByID(ctx context.Context, userID, id string) (*AdherenceCheck, error) {
	const q = `
		SELECT id, user_id, patient_id, prescription_id, status, detail, created_at
		FROM doctor_adherence_checks WHERE id = $1 AND user_id = $2`
	a := &AdherenceCheck{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&a.ID, &a.UserID, &a.PatientID, &a.PrescriptionID,
		&a.Status, &a.Detail, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

func (r *Repository) getAdherenceByIdem(ctx context.Context, userID, idemKey string) (*AdherenceCheck, error) {
	const q = `
		SELECT id, user_id, patient_id, prescription_id, status, detail, created_at
		FROM doctor_adherence_checks WHERE user_id = $1 AND idempotency_key = $2`
	a := &AdherenceCheck{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&a.ID, &a.UserID, &a.PatientID, &a.PrescriptionID,
		&a.Status, &a.Detail, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return a, err
}

// ══ HMO ═════════════════════════════════════════════════════════════════════

// GetHMOCoverageForPatient returns the latest plan-coverage row for a patient (scoped).
func (r *Repository) GetHMOCoverageForPatient(ctx context.Context, userID, patientID string) (*HMOPlanCoverage, error) {
	const q = `
		SELECT id, user_id, patient_id, provider, plan_name, member_id, valid_until, copay_kobo, coverage, created_at, updated_at
		FROM doctor_hmo_plan_coverage WHERE user_id = $1 AND patient_id = $2 ORDER BY created_at DESC LIMIT 1`
	c := &HMOPlanCoverage{}
	err := r.db.QueryRow(ctx, q, userID, patientID).Scan(&c.ID, &c.UserID, &c.PatientID, &c.Provider,
		&c.PlanName, &c.MemberID, &c.ValidUntil, &c.CopayKobo, &c.Coverage, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// ── Pre-auth ─────────────────────────────────────────────────────────────────

func (r *Repository) ListPreAuthRequests(ctx context.Context, userID string) ([]HMOPreAuthRequest, error) {
	const q = `
		SELECT id, user_id, patient_id, appointment_id, status, auth_code, amount_kobo, detail, created_at, updated_at
		FROM doctor_hmo_preauth_requests WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HMOPreAuthRequest{}
	for rows.Next() {
		p := HMOPreAuthRequest{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.PatientID, &p.AppointmentID, &p.Status, &p.AuthCode,
			&p.AmountKobo, &p.Detail, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *Repository) GetPreAuthRequest(ctx context.Context, userID, id string) (*HMOPreAuthRequest, error) {
	const q = `
		SELECT id, user_id, patient_id, appointment_id, status, auth_code, amount_kobo, detail, created_at, updated_at
		FROM doctor_hmo_preauth_requests WHERE id = $1 AND user_id = $2`
	p := &HMOPreAuthRequest{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&p.ID, &p.UserID, &p.PatientID, &p.AppointmentID,
		&p.Status, &p.AuthCode, &p.AmountKobo, &p.Detail, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// InsertPreAuthRequest requests a pre-authorisation idempotently (UNIQUE idempotency_key).
// amount_kobo is recorded for context only; this endpoint does NOT move money (no ledger).
func (r *Repository) InsertPreAuthRequest(ctx context.Context, userID string, patientID, appointmentID *string, amountKobo int64, detail []byte, idemKey string) (*HMOPreAuthRequest, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_hmo_preauth_requests (id, user_id, patient_id, appointment_id, status, amount_kobo, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,'pending',$5,$6,$7)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, patientID, appointmentID, amountKobo, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getPreAuthByIdem(ctx, userID, idemKey)
	}
	return r.GetPreAuthRequest(ctx, userID, id)
}

func (r *Repository) getPreAuthByIdem(ctx context.Context, userID, idemKey string) (*HMOPreAuthRequest, error) {
	const q = `
		SELECT id, user_id, patient_id, appointment_id, status, auth_code, amount_kobo, detail, created_at, updated_at
		FROM doctor_hmo_preauth_requests WHERE user_id = $1 AND idempotency_key = $2`
	p := &HMOPreAuthRequest{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&p.ID, &p.UserID, &p.PatientID, &p.AppointmentID,
		&p.Status, &p.AuthCode, &p.AmountKobo, &p.Detail, &p.CreatedAt, &p.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// ── Covered services ─────────────────────────────────────────────────────────

func (r *Repository) ListCoveredServices(ctx context.Context, userID string) ([]HMOCoveredService, error) {
	const q = `
		SELECT id, user_id, service_name, provider, covered, detail, created_at
		FROM doctor_hmo_covered_services WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HMOCoveredService{}
	for rows.Next() {
		s := HMOCoveredService{}
		if err := rows.Scan(&s.ID, &s.UserID, &s.ServiceName, &s.Provider, &s.Covered,
			&s.Detail, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ── Claims (read/get only; submit/dispute are handled by the existing Wave-2/phase2
//    HMO claim routes — Wave 3a does not re-register them) ──────────────────────

func (r *Repository) ListHMOClaims(ctx context.Context, userID string) ([]HMOClaim, error) {
	const q = `
		SELECT id, user_id, ref, patient_id, appointment_id, status, amount_kobo, detail, created_at, updated_at
		FROM doctor_hmo_claims WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HMOClaim{}
	for rows.Next() {
		c := HMOClaim{}
		if err := rows.Scan(&c.ID, &c.UserID, &c.Ref, &c.PatientID, &c.AppointmentID, &c.Status,
			&c.AmountKobo, &c.Detail, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repository) GetHMOClaim(ctx context.Context, userID, id string) (*HMOClaim, error) {
	const q = `
		SELECT id, user_id, ref, patient_id, appointment_id, status, amount_kobo, detail, created_at, updated_at
		FROM doctor_hmo_claims WHERE id = $1 AND user_id = $2`
	c := &HMOClaim{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&c.ID, &c.UserID, &c.Ref, &c.PatientID, &c.AppointmentID,
		&c.Status, &c.AmountKobo, &c.Detail, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return c, err
}

// ── HMO support thread ───────────────────────────────────────────────────────

func (r *Repository) ListHMOSupportMessages(ctx context.Context, userID, threadID string) ([]HMOSupportMessage, error) {
	const q = `
		SELECT id, user_id, thread_id, author, body, created_at
		FROM doctor_hmo_support_messages WHERE user_id = $1 AND thread_id = $2 ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, q, userID, threadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HMOSupportMessage{}
	for rows.Next() {
		m := HMOSupportMessage{}
		if err := rows.Scan(&m.ID, &m.UserID, &m.ThreadID, &m.Author, &m.Body, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// InsertHMOSupportMessage posts to an HMO support thread idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertHMOSupportMessage(ctx context.Context, userID, threadID, author string, body *string, idemKey string) (*HMOSupportMessage, error) {
	id := uuid.New().String()
	if author == "" {
		author = "doctor"
	}
	const q = `
		INSERT INTO doctor_hmo_support_messages (id, user_id, thread_id, author, body, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, threadID, author, body, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getHMOSupportMessageByIdem(ctx, userID, idemKey)
	}
	return r.getHMOSupportMessageByID(ctx, userID, id)
}

func (r *Repository) getHMOSupportMessageByID(ctx context.Context, userID, id string) (*HMOSupportMessage, error) {
	const q = `
		SELECT id, user_id, thread_id, author, body, created_at
		FROM doctor_hmo_support_messages WHERE id = $1 AND user_id = $2`
	m := &HMOSupportMessage{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&m.ID, &m.UserID, &m.ThreadID, &m.Author, &m.Body, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

func (r *Repository) getHMOSupportMessageByIdem(ctx context.Context, userID, idemKey string) (*HMOSupportMessage, error) {
	const q = `
		SELECT id, user_id, thread_id, author, body, created_at
		FROM doctor_hmo_support_messages WHERE user_id = $1 AND idempotency_key = $2`
	m := &HMOSupportMessage{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&m.ID, &m.UserID, &m.ThreadID, &m.Author, &m.Body, &m.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// ── Fraud warnings ───────────────────────────────────────────────────────────

func (r *Repository) ListFraudWarnings(ctx context.Context, userID string) ([]HMOFraudWarning, error) {
	const q = `
		SELECT id, user_id, severity, acknowledged, acknowledged_at, detail, created_at
		FROM doctor_hmo_fraud_warnings WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []HMOFraudWarning{}
	for rows.Next() {
		w := HMOFraudWarning{}
		if err := rows.Scan(&w.ID, &w.UserID, &w.Severity, &w.Acknowledged, &w.AcknowledgedAt,
			&w.Detail, &w.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// AckFraudWarning acknowledges a fraud warning (scoped, idempotent).
func (r *Repository) AckFraudWarning(ctx context.Context, userID, warningID string) (*HMOFraudWarning, error) {
	const q = `
		UPDATE doctor_hmo_fraud_warnings SET acknowledged = true, acknowledged_at = now()
		WHERE id = $1 AND user_id = $2`
	tag, err := r.db.Exec(ctx, q, warningID, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Already acked or absent — return the row (idempotent) or 404.
		const sel = `
			SELECT id, user_id, severity, acknowledged, acknowledged_at, detail, created_at
			FROM doctor_hmo_fraud_warnings WHERE id = $1 AND user_id = $2`
		w := &HMOFraudWarning{}
		serr := r.db.QueryRow(ctx, sel, warningID, userID).Scan(&w.ID, &w.UserID, &w.Severity,
			&w.Acknowledged, &w.AcknowledgedAt, &w.Detail, &w.CreatedAt)
		if errors.Is(serr, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return w, serr
	}
	const sel = `
		SELECT id, user_id, severity, acknowledged, acknowledged_at, detail, created_at
		FROM doctor_hmo_fraud_warnings WHERE id = $1 AND user_id = $2`
	w := &HMOFraudWarning{}
	err = r.db.QueryRow(ctx, sel, warningID, userID).Scan(&w.ID, &w.UserID, &w.Severity,
		&w.Acknowledged, &w.AcknowledgedAt, &w.Detail, &w.CreatedAt)
	return w, err
}

// ══ MEDICAL RECORDS ═════════════════════════════════════════════════════════

// ListRecordRestrictions returns the patient's record restrictions (scoped).
func (r *Repository) ListRecordRestrictions(ctx context.Context, userID, patientID string) ([]RecordRestriction, error) {
	const q = `
		SELECT id, user_id, patient_id, scope, restricted, reason, detail, created_at
		FROM doctor_record_restrictions WHERE user_id = $1 AND patient_id = $2 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RecordRestriction{}
	for rows.Next() {
		rr := RecordRestriction{}
		if err := rows.Scan(&rr.ID, &rr.UserID, &rr.PatientID, &rr.Scope, &rr.Restricted,
			&rr.Reason, &rr.Detail, &rr.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ListRecordShares returns the doctor's record shares (scoped).
func (r *Repository) ListRecordShares(ctx context.Context, userID string) ([]RecordShare, error) {
	const q = `
		SELECT id, user_id, patient_id, shared_with, status, expires_at, detail, created_at
		FROM doctor_record_shares WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RecordShare{}
	for rows.Next() {
		s := RecordShare{}
		if err := rows.Scan(&s.ID, &s.UserID, &s.PatientID, &s.SharedWith, &s.Status,
			&s.ExpiresAt, &s.Detail, &s.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// InsertRecordShare creates a record share idempotently (UNIQUE idempotency_key).
func (r *Repository) InsertRecordShare(ctx context.Context, userID, patientID string, sharedWith *string, detail []byte, idemKey string) (*RecordShare, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_record_shares (id, user_id, patient_id, shared_with, status, detail, idempotency_key)
		VALUES ($1,$2,$3,$4,'active',$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, patientID, sharedWith, jsonOrEmptyObject(detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getRecordShareByIdem(ctx, userID, idemKey)
	}
	return r.getRecordShareByID(ctx, userID, id)
}

func (r *Repository) getRecordShareByID(ctx context.Context, userID, id string) (*RecordShare, error) {
	const q = `
		SELECT id, user_id, patient_id, shared_with, status, expires_at, detail, created_at
		FROM doctor_record_shares WHERE id = $1 AND user_id = $2`
	s := &RecordShare{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&s.ID, &s.UserID, &s.PatientID, &s.SharedWith,
		&s.Status, &s.ExpiresAt, &s.Detail, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

func (r *Repository) getRecordShareByIdem(ctx context.Context, userID, idemKey string) (*RecordShare, error) {
	const q = `
		SELECT id, user_id, patient_id, shared_with, status, expires_at, detail, created_at
		FROM doctor_record_shares WHERE user_id = $1 AND idempotency_key = $2`
	s := &RecordShare{}
	err := r.db.QueryRow(ctx, q, userID, idemKey).Scan(&s.ID, &s.UserID, &s.PatientID, &s.SharedWith,
		&s.Status, &s.ExpiresAt, &s.Detail, &s.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return s, err
}

// ListRecordAccessLog returns the patient's record access log entries (scoped).
func (r *Repository) ListRecordAccessLog(ctx context.Context, userID, patientID string) ([]RecordAccessEntry, error) {
	const q = `
		SELECT id, user_id, patient_id, action, detail, created_at
		FROM doctor_record_access_log WHERE user_id = $1 AND patient_id = $2 ORDER BY created_at DESC LIMIT 500`
	rows, err := r.db.Query(ctx, q, userID, patientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RecordAccessEntry{}
	for rows.Next() {
		a := RecordAccessEntry{}
		if err := rows.Scan(&a.ID, &a.UserID, &a.PatientID, &a.Action, &a.Detail, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// InsertRecordAccess appends an append-only access-log entry (view|export|share|access_request).
func (r *Repository) InsertRecordAccess(ctx context.Context, userID, patientID, action string, detail []byte) (*RecordAccessEntry, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_record_access_log (id, user_id, patient_id, action, detail)
		VALUES ($1,$2,$3,$4,$5)`
	if _, err := r.db.Exec(ctx, q, id, userID, patientID, action, jsonOrEmptyObject(detail)); err != nil {
		return nil, err
	}
	return &RecordAccessEntry{ID: id, UserID: userID, PatientID: &patientID, Action: action,
		Detail: jsonOrEmptyObject(detail), CreatedAt: time.Now()}, nil
}
