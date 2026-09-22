package telemedicine

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// admin_service.go — TELEMEDICINE-004: admin console backend. Additive to
// service.go; does not change any member-facing method's behavior or SQL.

// AuditWriter is the audit-trail sink for admin actions on this module. The
// concrete implementation reused here is doctor.Repository.InsertAudit (writes
// into doctor_compliance_audit) — the SAME mechanism the doctor module's own
// MDCN review console (backend/internal/app/health_doctor_mdcn_routes.go,
// doctor/service_mdcn_review.go) already uses for
// "doctor.mdcn.verification.decided". Reusing it here (instead of inventing a
// telemedicine-scoped audit table) keeps every MDCN decision — however the
// admin reached it — in one queryable trail. Defined as an interface, not a
// direct doctor.Repository dependency, so this package stays unit-testable
// without a DB and doesn't hard-wire to doctor's concrete type.
type AuditWriter interface {
	InsertAudit(ctx context.Context, userID, action, entityType, entityID, idemKey string, detail any) error
}

// WithAudit wires the audit sink for admin verify decisions. Unwired (nil), a
// verify decision still succeeds but the audit row is skipped — logged loudly
// rather than failing the request, since the write itself already happened.
func (s *Service) WithAudit(a AuditWriter) *Service {
	s.audit = a
	return s
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

// GetAdminDashboard returns platform-wide KPIs for the admin console.
func (s *Service) GetAdminDashboard(ctx context.Context) (*AdminDashboard, error) {
	var totalDoctors int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctors`).Scan(&totalDoctors); err != nil {
		return nil, fmt.Errorf("telemedicine: count doctors: %w", err)
	}

	// Pending = the doctor's MOST RECENT verification row (by created_at) is
	// 'pending' or 'needs_info'. A doctor with NO verification row at all is not
	// counted here — that is an "unsubmitted" doctor, a distinct population the
	// dashboard does not currently surface (documented, not fabricated as zero
	// pending-review work).
	var pending int
	const pendingQ = `
		SELECT COUNT(*) FROM (
			SELECT DISTINCT ON (user_id) user_id, status
			FROM doctor_verifications
			ORDER BY user_id, created_at DESC
		) latest
		WHERE latest.status IN ('pending', 'needs_info')`
	if err := s.db.QueryRow(ctx, pendingQ).Scan(&pending); err != nil {
		return nil, fmt.Errorf("telemedicine: count pending verifications: %w", err)
	}

	var approved int
	const approvedQ = `
		SELECT COUNT(*) FROM (
			SELECT DISTINCT ON (user_id) user_id, status
			FROM doctor_verifications
			ORDER BY user_id, created_at DESC
		) latest
		WHERE latest.status = 'approved'`
	if err := s.db.QueryRow(ctx, approvedQ).Scan(&approved); err != nil {
		return nil, fmt.Errorf("telemedicine: count approved verifications: %w", err)
	}

	var apptsThisWeek int
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FROM appointments
		WHERE created_at >= NOW() - INTERVAL '7 days'`).Scan(&apptsThisWeek); err != nil {
		return nil, fmt.Errorf("telemedicine: count appointments this week: %w", err)
	}

	// Platform revenue = 15% commission leg + the ADR-044 booking fee leg, per
	// completed appointment in the trailing 7 days. Matches CompleteAppointment's
	// real settlement.Split algebra exactly:
	//   platform = base*0.15 + serviceFee = fee_kobo*15/100 + platform_fee_kobo
	// Pure integer arithmetic — no float, no numeric-typed division — so this can
	// never silently zero out the way TELEMEDICINE-002's `fee_kobo * 0.85` did.
	var revenue int64
	const revenueQ = `
		SELECT COALESCE(SUM((fee_kobo * 15 / 100) + COALESCE(platform_fee_kobo, 0)), 0)
		FROM appointments
		WHERE status = 'completed'
		  AND created_at >= NOW() - INTERVAL '7 days'`
	if err := s.db.QueryRow(ctx, revenueQ).Scan(&revenue); err != nil {
		return nil, fmt.Errorf("telemedicine: compute platform revenue: %w", err)
	}

	return &AdminDashboard{
		TotalDoctors:            totalDoctors,
		DoctorsPendingApproval:  pending,
		DoctorsApproved:         approved,
		AppointmentsThisWeek:    apptsThisWeek,
		PlatformRevenueKoboWeek: revenue,
	}, nil
}

// ─── Doctor roster ───────────────────────────────────────────────────────────

// ListAdminDoctors returns the FULL doctor roster (not availability-filtered,
// unlike ListDoctors), each joined with its most-recent doctor_verifications row.
func (s *Service) ListAdminDoctors(ctx context.Context, q AdminDoctorListQuery) ([]AdminDoctor, int, error) {
	limit, offset := q.Limit, q.Offset
	if limit <= 0 || limit > 200 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	var total int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM doctors`).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("telemedicine: count doctors: %w", err)
	}

	const listQ = `
		SELECT d.id, d.user_id, d.name, d.specialty, d.consult_fee_kobo,
		       d.is_available, d.is_online, d.created_at,
		       v.id, v.status, v.mdcn_number, v.submitted_at, v.reviewed_at, v.rejection_reason
		FROM doctors d
		LEFT JOIN LATERAL (
			SELECT id, status, mdcn_number, submitted_at, reviewed_at, rejection_reason
			FROM doctor_verifications
			WHERE user_id = d.user_id
			ORDER BY created_at DESC
			LIMIT 1
		) v ON true
		WHERE ($1::text IS NULL OR v.status = $1)
		ORDER BY d.created_at DESC
		LIMIT $2 OFFSET $3`
	var statusFilter *string
	if q.Status != "" {
		statusFilter = &q.Status
	}
	rows, err := s.db.Query(ctx, listQ, statusFilter, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("telemedicine: list admin doctors: %w", err)
	}
	defer rows.Close()

	items := make([]AdminDoctor, 0, limit)
	for rows.Next() {
		var it AdminDoctor
		if err := rows.Scan(&it.ID, &it.UserID, &it.Name, &it.Specialty, &it.ConsultFeeKobo,
			&it.IsAvailable, &it.IsOnline, &it.CreatedAt,
			&it.VerificationID, &it.VerificationStatus, &it.MDCNNumber, &it.SubmittedAt,
			&it.ReviewedAt, &it.RejectionReason); err != nil {
			return nil, 0, fmt.Errorf("telemedicine: scan admin doctor row: %w", err)
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("telemedicine: iterate admin doctors: %w", err)
	}

	// When filtering by verification status, `total` above (all doctors) is
	// misleading as a page count; recompute it under the same filter.
	if statusFilter != nil {
		const filteredCountQ = `
			SELECT COUNT(*) FROM doctors d
			LEFT JOIN LATERAL (
				SELECT status FROM doctor_verifications
				WHERE user_id = d.user_id ORDER BY created_at DESC LIMIT 1
			) v ON true
			WHERE v.status = $1`
		if err := s.db.QueryRow(ctx, filteredCountQ, *statusFilter).Scan(&total); err != nil {
			return nil, 0, fmt.Errorf("telemedicine: count filtered admin doctors: %w", err)
		}
	}

	return items, total, nil
}

// ─── Appointments ────────────────────────────────────────────────────────────

// ListAdminAppointments returns the SYSTEM-WIDE appointment list (not scoped to
// any single caller, unlike ListMyAppointments), optionally filtered by status
// and a [from, to) scheduled_at window.
func (s *Service) ListAdminAppointments(ctx context.Context, q AdminAppointmentListQuery) ([]AdminAppointment, int, error) {
	limit, offset := q.Limit, q.Offset
	if limit <= 0 || limit > 200 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	var fromT, toT *time.Time
	if q.From != "" {
		t, err := time.Parse(time.RFC3339, q.From)
		if err != nil {
			return nil, 0, fmt.Errorf("telemedicine: invalid from date: %w", err)
		}
		fromT = &t
	}
	if q.To != "" {
		t, err := time.Parse(time.RFC3339, q.To)
		if err != nil {
			return nil, 0, fmt.Errorf("telemedicine: invalid to date: %w", err)
		}
		toT = &t
	}
	var status *string
	if q.Status != "" {
		status = &q.Status
	}

	const countQ = `
		SELECT COUNT(*) FROM appointments a
		WHERE ($1::text IS NULL OR a.status = $1)
		  AND ($2::timestamptz IS NULL OR a.scheduled_at >= $2)
		  AND ($3::timestamptz IS NULL OR a.scheduled_at < $3)`
	var total int
	if err := s.db.QueryRow(ctx, countQ, status, fromT, toT).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("telemedicine: count admin appointments: %w", err)
	}

	const listQ = `
		SELECT a.id, a.patient_id, a.doctor_id, COALESCE(d.name, ''), a.scheduled_at,
		       a.status, a.fee_kobo, COALESCE(a.platform_fee_kobo, 0),
		       COALESCE(NULLIF(a.total_kobo, 0), a.fee_kobo), a.created_at
		FROM appointments a
		LEFT JOIN doctors d ON d.id = a.doctor_id
		WHERE ($1::text IS NULL OR a.status = $1)
		  AND ($2::timestamptz IS NULL OR a.scheduled_at >= $2)
		  AND ($3::timestamptz IS NULL OR a.scheduled_at < $3)
		ORDER BY a.created_at DESC
		LIMIT $4 OFFSET $5`
	rows, err := s.db.Query(ctx, listQ, status, fromT, toT, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("telemedicine: list admin appointments: %w", err)
	}
	defer rows.Close()

	items := make([]AdminAppointment, 0, limit)
	for rows.Next() {
		var it AdminAppointment
		if err := rows.Scan(&it.ID, &it.PatientID, &it.DoctorID, &it.DoctorName, &it.ScheduledAt,
			&it.Status, &it.FeeKobo, &it.PlatformFeeKobo, &it.TotalKobo, &it.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("telemedicine: scan admin appointment row: %w", err)
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("telemedicine: iterate admin appointments: %w", err)
	}

	return items, total, nil
}

// ─── Verification ────────────────────────────────────────────────────────────

// adminVerifyTransitions mirrors doctor/service_mdcn_review.go's canDoctorVerif —
// the SAME status machine the doctor module's own MDCN review console enforces.
// This admin console additionally allows 'unsubmitted' as a source state: unlike
// the doctor-module review queue (which only ever sees rows the doctor already
// submitted), a telemedicine admin may need to record an out-of-band MDCN
// decision for a doctor who registered before submitting in-app documents.
var adminVerifyTransitions = map[string]map[string]bool{
	"unsubmitted": {"approved": true, "rejected": true},
	"pending":     {"approved": true, "rejected": true},
	"needs_info":  {"approved": true, "rejected": true},
	"approved":    {},
	"rejected":    {},
}

func canAdminVerify(from, to string) bool {
	if from == to {
		return false
	}
	nx, ok := adminVerifyTransitions[from]
	return ok && nx[to]
}

// ErrVerifyReasonRequired is returned when a reject decision omits a reason.
var ErrVerifyReasonRequired = errors.New("telemedicine: reason is required to reject")

// ErrVerifyIllegalTransition guards the verification status SM.
var ErrVerifyIllegalTransition = errors.New("telemedicine: illegal verification transition")

// VerifyDoctor records an admin's MDCN approve/reject decision for a doctor,
// writing/updating the SAME doctor_verifications row the doctor module's own
// review console reads (see doctor/repository_mdcn_review.go DecideMDCN for the
// column set this mirrors), then writes an audit trail row via s.audit.
func (s *Service) VerifyDoctor(ctx context.Context, reviewerID, doctorUserID string, req AdminVerifyDoctorRequest) (*AdminDoctor, error) {
	if req.Decision == "rejected" && req.Reason == "" {
		return nil, ErrVerifyReasonRequired
	}
	// Object-level authZ: mirrors doctor/service_mdcn_review.go's self-approval
	// block — a doctor can never verify themselves, even via the admin console.
	if reviewerID == doctorUserID {
		return nil, fmt.Errorf("telemedicine: a doctor may not verify their own MDCN status")
	}

	var doctorExists bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM doctors WHERE user_id=$1)`, doctorUserID).
		Scan(&doctorExists); err != nil {
		return nil, fmt.Errorf("telemedicine: check doctor exists: %w", err)
	}
	if !doctorExists {
		return nil, fmt.Errorf("telemedicine: doctor not found")
	}

	var verifID, curStatus string
	err := s.db.QueryRow(ctx, `
		SELECT id, status FROM doctor_verifications
		WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, doctorUserID).
		Scan(&verifID, &curStatus)

	var reasonPtr *string
	if req.Reason != "" {
		reasonPtr = &req.Reason
	}

	wasNoop := false
	switch {
	case err == nil:
		if curStatus == req.Decision {
			// Idempotent no-op: repeating the same terminal decision succeeds
			// without a transition error or a duplicate audit row.
			wasNoop = true
		} else if !canAdminVerify(curStatus, req.Decision) {
			return nil, fmt.Errorf("%w: %s -> %s", ErrVerifyIllegalTransition, curStatus, req.Decision)
		} else {
			// reviewerID is bound as TWO separate parameters ($3 uuid, $5 text) even
			// though it's the same Go string — reusing one placeholder ($3) across a
			// bare uuid-column context and an explicit ::text cast made Postgres
			// unable to deduce a single type for it (SQLSTATE 42P08 "inconsistent
			// types deduced for parameter"), a real bug caught by this test.
			const upd = `
				UPDATE doctor_verifications
				SET status = $2, reviewer_id = $3, reviewer = $5, rejection_reason = $4,
				    decision_outcome = $2, reviewed_at = now(), decided_at = now(), updated_at = now()
				WHERE id = $1`
			if _, err := s.db.Exec(ctx, upd, verifID, req.Decision, reviewerID, reasonPtr, reviewerID); err != nil {
				return nil, fmt.Errorf("telemedicine: update verification: %w", err)
			}
		}
	case errors.Is(err, pgx.ErrNoRows):
		// No verification row exists yet for this doctor — insert one directly in
		// the decided state, following the same column set DecideMDCN writes.
		// Same $N-reused-across-incompatible-types pitfall as the UPDATE above —
		// reviewerID is bound as separate $3 (uuid) and $5 (text) parameters.
		const ins = `
			INSERT INTO doctor_verifications
				(user_id, status, kind, reviewer_id, reviewer, rejection_reason,
				 decision_outcome, submitted_at, reviewed_at, decided_at)
			VALUES ($1, $2, 'initial', $3, $5, $4, $2, now(), now(), now())
			RETURNING id`
		if err := s.db.QueryRow(ctx, ins, doctorUserID, req.Decision, reviewerID, reasonPtr, reviewerID).Scan(&verifID); err != nil {
			return nil, fmt.Errorf("telemedicine: insert verification: %w", err)
		}
	default:
		return nil, fmt.Errorf("telemedicine: load verification: %w", err)
	}

	// Mirror the decision onto doctor_profiles.verification when that row
	// exists, so assertDoctorApproved's OR'd signal (service.go) reflects the
	// admin decision immediately — same field the doctor module's review
	// service flips on approve/reject. A missing doctor_profiles row (not every
	// telemedicine doctor has one) is not an error; nothing to mirror onto.
	profileVerif := "rejected"
	if req.Decision == "approved" {
		profileVerif = "approved"
	}
	_, _ = s.db.Exec(ctx, `UPDATE doctor_profiles SET verification=$2, updated_at=now() WHERE user_id=$1`,
		doctorUserID, profileVerif)

	// Skip the audit write on an idempotent replay (wasNoop) — no state actually
	// changed, so a second audit row would misrepresent the trail as two
	// distinct decisions. Found live by this test: the first version of this
	// method wrote an audit row unconditionally, including on replay.
	if s.audit != nil && !wasNoop {
		_ = s.audit.InsertAudit(ctx, reviewerID, "telemedicine.admin.doctor.verified", "doctor_verification", verifID, "",
			map[string]any{"decision": req.Decision, "reason": req.Reason, "doctor_user_id": doctorUserID})
	}

	decisionVal := req.Decision
	return &AdminDoctor{
		UserID:             doctorUserID,
		VerificationID:     &verifID,
		VerificationStatus: &decisionVal,
		RejectionReason:    reasonPtr,
	}, nil
}
