package doctor

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// repository_tail2.go — pgx reads for the Wave-3 "coverage close-out" endpoints
// (the 26 contract GETs that were specified but never wired). Style mirrors the
// rest of the repository layer:
//   - every read is scoped to the owning doctor's user_id (defence-in-depth on RLS);
//   - list reads always return a non-nil slice (empty, never null) so the JSON
//     surface is a stable [] for the mobile clients;
//   - NONE of these post to the money ledger. The money-shaped reads here
//     (invoices / earnings breakdown) are pure projections; the wallet balance
//     itself is computed by the service from the ledger (Service.ledger.GetBalance),
//     never read from a stored column.

// ── Call disputes ─────────────────────────────────────────────────────────────

// ListCallDisputes returns the doctor's call disputes (newest first).
// Source: public.doctor_call_disputes (migration 20260625000000_doctor_module.sql).
func (r *Repository) ListCallDisputes(ctx context.Context, userID string) ([]CallDispute, error) {
	const q = `
		SELECT id, user_id, call_session_id, appointment_id, status, reason, detail,
		       created_at, updated_at
		FROM doctor_call_disputes WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CallDispute{}
	for rows.Next() {
		var d CallDispute
		if err := rows.Scan(&d.ID, &d.UserID, &d.CallSessionID, &d.AppointmentID,
			&d.Status, &d.Reason, &d.Detail, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ── Settlement (payout) disputes ──────────────────────────────────────────────

// ListSettlementDisputes returns the doctor's settlement/payout disputes (newest
// first). Source: public.doctor_settlement_disputes.
func (r *Repository) ListSettlementDisputes(ctx context.Context, userID string) ([]SettlementDispute, error) {
	const q = `
		SELECT id, user_id, payout_id, status, reason, detail, created_at, updated_at
		FROM doctor_settlement_disputes WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SettlementDispute{}
	for rows.Next() {
		var d SettlementDispute
		if err := rows.Scan(&d.ID, &d.UserID, &d.PayoutID, &d.Status, &d.Reason,
			&d.Detail, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ── Emergency: cases / escalations / facilities ───────────────────────────────

// ListEmergencyCases returns the doctor's emergency case records (newest first).
// Source: public.doctor_emergency_cases.
func (r *Repository) ListEmergencyCases(ctx context.Context, userID string) ([]EmergencyCase, error) {
	const q = `
		SELECT id, user_id, patient_id, status, summary, detail, created_at, updated_at
		FROM doctor_emergency_cases WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EmergencyCase{}
	for rows.Next() {
		var e EmergencyCase
		if err := rows.Scan(&e.ID, &e.UserID, &e.PatientID, &e.Status, &e.Summary,
			&e.Detail, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListEmergencyEscalations returns the doctor's emergency escalations (newest
// first). Source: public.doctor_emergency_escalations. When typeFilter is
// non-empty the result is restricted to that escalation_type.
func (r *Repository) ListEmergencyEscalations(ctx context.Context, userID, typeFilter string) ([]EmergencyEscalation, error) {
	q := `
		SELECT id, user_id, patient_id, escalation_type, facility_id, status, detail, created_at
		FROM doctor_emergency_escalations WHERE user_id = $1`
	args := []any{userID}
	if typeFilter != "" {
		q += ` AND escalation_type = $2`
		args = append(args, typeFilter)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EmergencyEscalation{}
	for rows.Next() {
		var e EmergencyEscalation
		if err := rows.Scan(&e.ID, &e.UserID, &e.PatientID, &e.EscalationType,
			&e.FacilityID, &e.Status, &e.Detail, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ListEmergencyFacilities returns the doctor's saved emergency facilities.
// Source: public.doctor_emergency_facilities.
func (r *Repository) ListEmergencyFacilities(ctx context.Context, userID string) ([]EmergencyFacility, error) {
	const q = `
		SELECT id, user_id, name, facility_type, location, contact, created_at
		FROM doctor_emergency_facilities WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EmergencyFacility{}
	for rows.Next() {
		var f EmergencyFacility
		if err := rows.Scan(&f.ID, &f.UserID, &f.Name, &f.FacilityType,
			&f.Location, &f.Contact, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ── Invoices + money projections ──────────────────────────────────────────────

// ListInvoices returns the doctor's invoices (newest first). All money columns are
// int64 kobo (minor units). Source: public.doctor_invoices.
func (r *Repository) ListInvoices(ctx context.Context, userID string) ([]Invoice, error) {
	const q = `
		SELECT id, user_id, ref, appointment_id, gross_kobo, commission_kobo, vat_kobo,
		       net_kobo, currency, status, ledger_ref, issued_at, detail, created_at, updated_at
		FROM doctor_invoices WHERE user_id = $1 ORDER BY issued_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Invoice{}
	for rows.Next() {
		var iv Invoice
		if err := rows.Scan(&iv.ID, &iv.UserID, &iv.Ref, &iv.AppointmentID, &iv.GrossKobo,
			&iv.CommissionKobo, &iv.VATKobo, &iv.NetKobo, &iv.Currency, &iv.Status,
			&iv.LedgerRef, &iv.IssuedAt, &iv.Detail, &iv.CreatedAt, &iv.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, iv)
	}
	return out, rows.Err()
}

// invoiceTotals aggregates the doctor's invoice money columns into kobo sums.
// Pure read — all sums are int64 kobo. Used to build the earnings breakdown /
// commission / tax-vat projections. COALESCE keeps the result a clean zero when
// the doctor has no invoices yet.
func (r *Repository) invoiceTotals(ctx context.Context, userID string) (gross, commission, vat, net, count int64, err error) {
	const q = `
		SELECT COALESCE(SUM(gross_kobo),0)::bigint,
		       COALESCE(SUM(commission_kobo),0)::bigint,
		       COALESCE(SUM(vat_kobo),0)::bigint,
		       COALESCE(SUM(net_kobo),0)::bigint,
		       COUNT(*)::bigint
		FROM doctor_invoices WHERE user_id = $1`
	err = r.db.QueryRow(ctx, q, userID).Scan(&gross, &commission, &vat, &net, &count)
	return
}

// GetCommissionConfig returns the doctor's commission/VAT configuration if present.
// Returns ErrNotFound when no row exists (the service derives a zeroed default).
// Source: public.doctor_commission_config (one row per doctor, UNIQUE user_id).
func (r *Repository) GetCommissionConfig(ctx context.Context, userID string) (*CommissionConfig, error) {
	const q = `
		SELECT id, user_id, commission_bps, vat_bps, payout_cycle, detail, created_at, updated_at
		FROM doctor_commission_config WHERE user_id = $1`
	cfg := &CommissionConfig{}
	err := r.db.QueryRow(ctx, q, userID).Scan(&cfg.ID, &cfg.UserID, &cfg.CommissionBps,
		&cfg.VATBps, &cfg.PayoutCycle, &cfg.Detail, &cfg.CreatedAt, &cfg.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return cfg, err
}

// ── Dashboard counts ──────────────────────────────────────────────────────────

// appointmentStatusCounts returns the doctor's appointment counts grouped by
// status, used to compose the dashboard projection. Pure read.
func (r *Repository) appointmentStatusCounts(ctx context.Context, userID string) (map[string]int64, error) {
	const q = `
		SELECT status, COUNT(*)::bigint
		FROM doctor_appointments WHERE user_id = $1 GROUP BY status`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var st string
		var n int64
		if err := rows.Scan(&st, &n); err != nil {
			return nil, err
		}
		out[st] = n
	}
	return out, rows.Err()
}

// unreadNotificationCount returns the number of unread notifications for the
// dashboard badge. Pure read against public.doctor_notifications.
func (r *Repository) unreadNotificationCount(ctx context.Context, userID string) (int64, error) {
	const q = `SELECT COUNT(*)::bigint FROM doctor_notifications WHERE user_id = $1 AND read = false`
	var n int64
	err := r.db.QueryRow(ctx, q, userID).Scan(&n)
	return n, err
}

// ── Vet profile reads ─────────────────────────────────────────────────────────

// ListVetProfileDocuments returns the document slots attached to the doctor's vet
// verification. Reuses public.doctor_verification_documents (filtered to vet doc
// types) — there is no separate vet-document table, so non-vet rows are excluded
// by a doc_type prefix. Always returns a non-nil slice.
func (r *Repository) ListVetProfileDocuments(ctx context.Context, userID string) ([]VerificationDocument, error) {
	const q = `
		SELECT id, verification_id, user_id, doc_type, label, file_name, file_url,
		       mime_type, size_bytes, required, uploaded_at, created_at
		FROM doctor_verification_documents
		WHERE user_id = $1 AND doc_type LIKE 'vet%'
		ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []VerificationDocument{}
	for rows.Next() {
		var d VerificationDocument
		if err := rows.Scan(&d.ID, &d.VerificationID, &d.UserID, &d.DocType, &d.Label,
			&d.FileName, &d.FileURL, &d.MimeType, &d.SizeBytes, &d.Required,
			&d.UploadedAt, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
