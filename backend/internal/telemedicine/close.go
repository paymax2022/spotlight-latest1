package telemedicine

// Closing an appointment: claim, then pay, then reconcile (ADR-PR879).
//
// Settle and Refund (finance/settlement) each run their own transaction and
// lock the settlement row, so they are idempotent and can never both apply to
// one settlement. What they cannot do is keep the appointment's own status in
// step: the old code moved the money and THEN flipped the appointment in a
// separate, unconditional UPDATE, so a crash or a dropped request in between
// left the two disagreeing for good, and a patient cancel could slip past a
// consult that had just started.
//
// So every close is:
//  1. claim — one conditional UPDATE moves the appointment to its terminal
//     state only from an open state the actor may close from, and stamps
//     closed_at. Complete and cancel race to that row; exactly one wins.
//  2. pay   — settle (completed) or refund (cancelled) the escrow, then audit.
//     It runs on a context the caller cannot cancel, so a dropped request
//     does not stop it halfway.
//  3. reconcile — a claim whose payment did not land (crash, timeout, a
//     provider error) is finished by ReconcileConsults, which is idempotent.
//
// The claim is never held while the money moves (no transaction spans the
// settlement call): settlement takes its own pool connections, and holding a
// transaction connection while acquiring another starves the pool under load.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/settlement"
)

const (
	// StuckConsultAfter is how long a consult may sit in_progress before the
	// reconciler queues it for an admin decision. The patient cannot cancel a
	// started consult, so without this the escrow would have no exit.
	StuckConsultAfter = 12 * time.Hour
	// closeClaimGrace leaves a fresh claim to the request that made it before
	// the reconciler steps in.
	closeClaimGrace = 2 * time.Minute
	payTimeout      = 30 * time.Second
	// MaxReconcileAttempts is how many failed sweeps an unpaid close gets before
	// it is handed to the admin review queue instead of being retried forever.
	MaxReconcileAttempts = 5
	// auditRecoveryWindow bounds the lost-audit sweep to recent closes.
	auditRecoveryWindow = 7 * 24 * time.Hour
)

// permanentError marks a refusal that retrying cannot change. The doctor
// console's sync retry loop checks for it (through the Permanent method, so the
// doctor package does not import this one).
type permanentError struct{ msg string }

func (e permanentError) Error() string   { return e.msg }
func (e permanentError) Permanent() bool { return true }

// ErrNotClosable refuses a close from a state the actor may not close from.
var ErrNotClosable = permanentError{"telemedicine: appointment is not in a closable state"}

// CompleteAppointment closes the appointment as completed and settles the fee
// to the assigned doctor (85/15 plus the platform booking fee, ADR-044).
func (s *Service) CompleteAppointment(ctx context.Context, appointmentID, doctorUserID string) error {
	return s.closeAppointment(ctx, appointmentID, doctorUserID, ApptCompleted, false, "")
}

// CancelAppointment closes the appointment as cancelled and refunds the patient.
// The patient or the assigned doctor may cancel; the patient only until the
// consult has started.
func (s *Service) CancelAppointment(ctx context.Context, appointmentID, actorID string) error {
	return s.closeAppointment(ctx, appointmentID, actorID, ApptCancelled, false, "")
}

type closeFacts struct {
	patientID, doctorUserID, status, settlementID string
	platformFeeKobo                               int64
}

func (s *Service) loadCloseFacts(ctx context.Context, appointmentID string) (*closeFacts, error) {
	f := &closeFacts{}
	err := s.db.QueryRow(ctx, `
		SELECT a.patient_id::text, COALESCE(d.user_id::text,''), a.status,
		       COALESCE(a.settlement_id::text,''), COALESCE(a.platform_fee_kobo,0)
		FROM appointments a LEFT JOIN doctors d ON d.id = a.doctor_id
		WHERE a.id = $1`, appointmentID).
		Scan(&f.patientID, &f.doctorUserID, &f.status, &f.settlementID, &f.platformFeeKobo)
	if err != nil {
		return nil, ErrAppointmentNotFound
	}
	return f, nil
}

func (s *Service) closeAppointment(ctx context.Context, appointmentID, actorID string, target AppointmentStatus, asAdmin bool, reason string) error {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), payTimeout)
	defer cancel()

	f, err := s.loadCloseFacts(ctx, appointmentID)
	if err != nil {
		return err
	}
	if !asAdmin {
		switch target {
		case ApptCompleted:
			if f.doctorUserID == "" || actorID != f.doctorUserID {
				return errors.New("telemedicine: only the assigned doctor can complete this appointment")
			}
		case ApptCancelled:
			if actorID != f.patientID && (f.doctorUserID == "" || actorID != f.doctorUserID) {
				return errors.New("telemedicine: not permitted to cancel this appointment")
			}
		}
	}

	// 1. Claim. A patient may only cancel before the consult starts; the doctor
	// and an admin may close from any open state.
	from := []string{string(ApptBooked), string(ApptConfirmed), string(ApptInProgress)}
	if target == ApptCancelled && !asAdmin && actorID == f.patientID {
		from = []string{string(ApptBooked), string(ApptConfirmed)}
	}
	// The claim only commits when the payment that follows can actually happen:
	// the escrow must still be payable in the target direction. A close that
	// cannot pay (no settlement on a legacy row, or money already moved under the
	// old code) leaves the appointment open and fixable instead of terminal with
	// the escrow stuck behind it.
	payable := []string{string(settlement.StatusEscrowed)}
	if target == ApptCancelled {
		payable = append(payable, string(settlement.StatusDisputed))
	}
	if target == ApptCompleted && f.doctorUserID == "" {
		return permanentError{"telemedicine: doctor record has no linked account to settle to"}
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE appointments SET status = $2, closed_at = now(), review_required_at = NULL
		WHERE id = $1 AND status = ANY($3)
		  AND EXISTS (SELECT 1 FROM settlements st
		              WHERE st.id = appointments.settlement_id AND st.status = ANY($4))
		  AND (NOT $5::boolean OR review_required_at IS NOT NULL)`,
		appointmentID, string(target), from, payable, asAdmin)
	if err != nil {
		return fmt.Errorf("telemedicine: claim %s: %w", target, err)
	}
	if tag.RowsAffected() == 0 {
		var cur string
		if err := s.db.QueryRow(ctx, `SELECT status FROM appointments WHERE id=$1`, appointmentID).Scan(&cur); err != nil {
			return ErrAppointmentNotFound
		}
		var flagged bool
		_ = s.db.QueryRow(ctx, `SELECT review_required_at IS NOT NULL FROM appointments WHERE id=$1`, appointmentID).Scan(&flagged)
		switch {
		case cur == string(target):
			// Already closed this way: finish the money if it never landed.
		case asAdmin && !flagged:
			return permanentError{"telemedicine: only appointments in the review queue can be resolved by an admin"}
		case f.settlementID == "":
			return permanentError{"telemedicine: appointment has no settlement to close against"}
		case cur == string(ApptInProgress) && target == ApptCancelled && !asAdmin && actorID == f.patientID:
			return ErrConsultInProgress
		case cur == string(ApptBooked) || cur == string(ApptConfirmed) || cur == string(ApptInProgress):
			// Open, but the escrow is no longer payable this way (moved under the old code).
			sett, gerr := s.settlement.GetByID(ctx, f.settlementID)
			if gerr != nil {
				return fmt.Errorf("telemedicine: load settlement: %w", gerr)
			}
			return permanentError{fmt.Sprintf("telemedicine: cannot %s, settlement is %s", map[AppointmentStatus]string{ApptCompleted: "settle", ApptCancelled: "refund"}[target], sett.Status)}
		case cur == string(ApptInProgress) && target == ApptCancelled:
			return ErrConsultInProgress
		case cur == string(ApptCompleted) && target == ApptCancelled:
			return permanentError{"telemedicine: cannot cancel a completed appointment"}
		default:
			return ErrNotClosable
		}
	}

	// 2. Pay.
	by := "party"
	if asAdmin {
		by = "admin"
		// The decision itself is the auditable act: record it now, so it survives
		// even if the payment lands later through the reconciler.
		if tag.RowsAffected() == 1 && s.audit != nil {
			if err := s.audit.InsertAudit(ctx, actorID, "telemedicine.appointment.resolved_by_admin", "appointment", appointmentID, "",
				map[string]any{"decision": string(target), "reason": reason, "settlement_id": f.settlementID}); err != nil {
				log.Printf("[telemedicine][audit] admin decision %s: %v", appointmentID, err)
			}
		}
	}
	if err := s.payClosure(ctx, appointmentID, actorID, target, f, by, reason); err != nil {
		return err
	}
	if target == ApptCancelled {
		s.mirrorConsoleCancel(ctx, appointmentID)
	}
	return nil
}

// payClosure moves the escrow for a claimed close. Idempotent: an escrow
// already settled/refunded the matching way is a no-op.
func (s *Service) payClosure(ctx context.Context, appointmentID, actorID string, target AppointmentStatus, f *closeFacts, by, reason string) error {
	sett, err := s.settlement.GetByID(ctx, f.settlementID)
	if err != nil {
		return fmt.Errorf("telemedicine: load settlement: %w", err)
	}
	switch target {
	case ApptCompleted:
		if sett.Status == settlement.StatusSettled {
			return nil
		}
		if sett.Status != settlement.StatusEscrowed {
			return permanentError{fmt.Sprintf("telemedicine: cannot settle, settlement is %s", sett.Status)}
		}
		if f.doctorUserID == "" {
			return permanentError{"telemedicine: doctor record has no linked account to settle to"}
		}
		// The platform booking fee rides on TOP of the 85/15 split as a
		// 100%-platform leg (ServiceFeeKobo), so it does not dilute the doctor:
		// provider = 0.85·consult, platform = 0.15·consult + fee (ADR-044).
		split := settlement.Split{
			ProviderID:     f.doctorUserID,
			ProviderPct:    0.85,
			PlatformPct:    0.15,
			ServiceFeeKobo: f.platformFeeKobo,
		}
		if err := s.settlement.Settle(ctx, f.settlementID, split); err != nil {
			if again, gerr := s.settlement.GetByID(ctx, f.settlementID); gerr == nil && again.Status == settlement.StatusSettled {
				return nil // a concurrent payer finished it
			}
			return fmt.Errorf("telemedicine: settle fee: %w", err)
		}
		s.auditMoney(ctx, actorID, f.doctorUserID, "telemedicine.appointment.settled", appointmentID, sett, f.platformFeeKobo, by, reason)
	case ApptCancelled:
		if sett.Status == settlement.StatusRefunded {
			return nil
		}
		if sett.Status != settlement.StatusEscrowed && sett.Status != settlement.StatusDisputed {
			return permanentError{fmt.Sprintf("telemedicine: cannot refund, settlement is %s", sett.Status)}
		}
		if err := s.settlement.Refund(ctx, f.settlementID, "appointment_cancelled"); err != nil {
			if again, gerr := s.settlement.GetByID(ctx, f.settlementID); gerr == nil && again.Status == settlement.StatusRefunded {
				return nil
			}
			return fmt.Errorf("telemedicine: refund fee: %w", err)
		}
		s.auditMoney(ctx, actorID, f.patientID, "telemedicine.appointment.refunded", appointmentID, sett, f.platformFeeKobo, by, reason)
	}
	return nil
}

// auditMoney records who moved an appointment's escrow and how much. The audit
// sink needs an account id; a system actor (the reconciler) is recorded against
// the party whose money moved, with by="reconciler" in the detail.
func (s *Service) auditMoney(ctx context.Context, actorID, partyID, action, appointmentID string, sett *settlement.Settlement, platformFeeKobo int64, by, reason string) {
	if s.audit == nil {
		log.Printf("[telemedicine][audit] %s %s: audit sink not wired", action, appointmentID)
		return
	}
	userID := actorID
	if userID == "" {
		userID = partyID
	}
	detail := map[string]any{
		"settlement_id": sett.ID, "total_kobo": sett.TotalKobo,
		"platform_fee_kobo": platformFeeKobo, "by": by,
	}
	if reason != "" {
		detail["reason"] = reason
	}
	// Deterministic key + a partial unique index: one row per settlement and
	// action, however many writers (request, reconciler replicas) race to it.
	idem := "tm:" + action + ":" + sett.ID
	if err := s.audit.InsertAudit(ctx, userID, action, "appointment", appointmentID, idem, detail); err != nil {
		if strings.Contains(err.Error(), "doctor_compliance_audit_tm_money_uniq") {
			return // already recorded
		}
		log.Printf("[telemedicine][audit] %s %s: %v", action, appointmentID, err)
	}
}

// mirrorConsoleCancel closes the bridged doctor-console row when the
// telemedicine side is cancelled, so the doctor is not left a consult to run
// (and End, and be credited for) on money already refunded.
func (s *Service) mirrorConsoleCancel(ctx context.Context, appointmentID string) {
	if !s.consoleBridge {
		return
	}
	if _, err := s.db.Exec(ctx, `
		UPDATE doctor_appointments SET status = 'cancelled', updated_at = now()
		WHERE id = $1::uuid AND status NOT IN ('completed','cancelled','no_show')`, appointmentID); err != nil {
		log.Printf("[telemedicine][bridge] mirror cancel %s: %v", appointmentID, err)
	}
}

// ConsultSettled reports whether an appointment id is a telemedicine booking
// and, if so, whether its escrow has settled. The doctor console uses it to
// record commission only for a consult that was actually paid.
func (s *Service) ConsultSettled(ctx context.Context, appointmentID string) (bridged, settled bool, err error) {
	var status *string
	err = s.db.QueryRow(ctx, `
		SELECT s.status FROM appointments a LEFT JOIN settlements s ON s.id = a.settlement_id
		WHERE a.id::text = $1`, appointmentID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	return true, status != nil && *status == string(settlement.StatusSettled), nil
}

// ReconcileReport counts what one sweep did.
type ReconcileReport struct {
	Settled, Refunded, Flagged, Failed, AuditsRecovered int
}

// recoverLostAudits writes the settle/refund audit row for recent closes whose
// money moved but whose row never landed (the audit write runs after the
// settlement commits, so a crash in between loses it, and a replay sees the
// money already moved and writes nothing). Idempotent: it only selects closes
// with no matching row. The sink is the doctor module's compliance audit
// (doctor_compliance_audit, wired via WithAudit).
func (s *Service) recoverLostAudits(ctx context.Context, now time.Time) int {
	if s.audit == nil {
		return 0
	}
	rows, err := s.db.Query(ctx, `
		SELECT a.id::text, a.status
		FROM appointments a JOIN settlements st ON st.id = a.settlement_id
		WHERE a.closed_at IS NOT NULL AND a.closed_at < $1 AND a.closed_at > $2
		  AND ((a.status = 'completed' AND st.status = 'settled')
		    OR (a.status = 'cancelled' AND st.status = 'refunded'))
		  AND NOT EXISTS (
		      SELECT 1 FROM doctor_compliance_audit au
		      WHERE au.entity_type = 'appointment' AND au.entity_id = a.id::text
		        AND au.action = CASE a.status WHEN 'completed' THEN 'telemedicine.appointment.settled'
		                                      ELSE 'telemedicine.appointment.refunded' END)
		ORDER BY a.closed_at LIMIT 100`, now.Add(-closeClaimGrace), now.Add(-auditRecoveryWindow))
	if err != nil {
		log.Printf("[telemedicine][reconcile] lost-audit scan: %v", err)
		return 0
	}
	type lost struct{ id, status string }
	var todo []lost
	for rows.Next() {
		var l lost
		if err := rows.Scan(&l.id, &l.status); err == nil {
			todo = append(todo, l)
		}
	}
	rows.Close()
	n := 0
	for _, l := range todo {
		f, err := s.loadCloseFacts(ctx, l.id)
		if err != nil {
			continue
		}
		sett, err := s.settlement.GetByID(ctx, f.settlementID)
		if err != nil {
			continue
		}
		action, party := "telemedicine.appointment.settled", f.doctorUserID
		if l.status == string(ApptCancelled) {
			action, party = "telemedicine.appointment.refunded", f.patientID
		}
		s.auditMoney(ctx, "", party, action, l.id, sett, f.platformFeeKobo, "reconciler (recovered)", "audit row was missing")
		n++
	}
	return n
}

// ReconcileConsults finishes claims whose payment did not land and queues
// consults stuck in_progress for an admin decision. Idempotent; safe to run on
// a ticker and from more than one replica (Settle/Refund serialize on the
// settlement row).
func (s *Service) ReconcileConsults(ctx context.Context, now time.Time) (ReconcileReport, error) {
	var rep ReconcileReport
	rows, err := s.db.Query(ctx, `
		SELECT a.id::text, a.status
		FROM appointments a JOIN settlements st ON st.id = a.settlement_id
		WHERE a.closed_at IS NOT NULL AND a.closed_at < $1 AND a.review_required_at IS NULL
		  AND ((a.status = 'completed' AND st.status = 'escrowed')
		    OR (a.status = 'cancelled' AND st.status IN ('escrowed','disputed')))
		ORDER BY a.closed_at LIMIT 100`, now.Add(-closeClaimGrace))
	if err != nil {
		return rep, fmt.Errorf("telemedicine: reconcile scan: %w", err)
	}
	type pending struct{ id, status string }
	var todo []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.status); err != nil {
			rows.Close()
			return rep, err
		}
		todo = append(todo, p)
	}
	rows.Close()
	for _, p := range todo {
		f, err := s.loadCloseFacts(ctx, p.id)
		if err != nil {
			rep.Failed++
			continue
		}
		target := AppointmentStatus(p.status)
		if err := s.payClosure(ctx, p.id, "", target, f, "reconciler", "unpaid claim"); err != nil {
			log.Printf("[telemedicine][reconcile] %s %s: %v", p.id, p.status, err)
			rep.Failed++
			// Count the failure. A refusal retrying cannot fix, or one that has failed
			// MaxReconcileAttempts sweeps, goes to the admin review queue so it is not
			// swept forever and cannot starve newer claims.
			var perm interface{ Permanent() bool }
			permanent := errors.As(err, &perm) && perm.Permanent()
			_, _ = s.db.Exec(ctx, `
				UPDATE appointments
				SET reconcile_attempts = reconcile_attempts + 1,
				    review_required_at = CASE WHEN $2 OR reconcile_attempts + 1 >= $3 THEN now() ELSE review_required_at END,
				    review_reason      = CASE WHEN $2 OR reconcile_attempts + 1 >= $3 THEN 'reconcile: payment did not complete' ELSE review_reason END
				WHERE id = $1 AND review_required_at IS NULL`, p.id, permanent, MaxReconcileAttempts)
			continue
		}
		if target == ApptCompleted {
			rep.Settled++
		} else {
			rep.Refunded++
			s.mirrorConsoleCancel(ctx, p.id)
		}
	}

	rep.AuditsRecovered = s.recoverLostAudits(ctx, now)

	tag, err := s.db.Exec(ctx, `
		UPDATE appointments SET review_required_at = $1, review_reason = 'stuck_in_progress'
		WHERE status = 'in_progress' AND review_required_at IS NULL
		  AND COALESCE(starts_at, scheduled_at) < $2`, now, now.Add(-StuckConsultAfter))
	if err != nil {
		return rep, fmt.Errorf("telemedicine: flag stuck consults: %w", err)
	}
	rep.Flagged = int(tag.RowsAffected())
	return rep, nil
}

// StartConsultReconciler runs ReconcileConsults every interval until ctx ends.
func StartConsultReconciler(ctx context.Context, s *Service, interval time.Duration) {
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if rep, err := s.ReconcileConsults(ctx, time.Now()); err != nil {
					log.Printf("[telemedicine][reconcile] sweep: %v", err)
				} else if rep != (ReconcileReport{}) {
					log.Printf("[telemedicine][reconcile] settled=%d refunded=%d flagged=%d failed=%d audits_recovered=%d",
						rep.Settled, rep.Refunded, rep.Flagged, rep.Failed, rep.AuditsRecovered)
				}
			}
		}
	}()
}

// ReportConsultProblem lets the patient queue a consult that has started for an
// admin decision (the doctor vanished, the call never connected). Before the
// consult starts the patient can simply cancel, so only in_progress qualifies.
func (s *Service) ReportConsultProblem(ctx context.Context, appointmentID, patientID, note string) error {
	note = strings.TrimSpace(note)
	if r := []rune(note); len(r) > 500 {
		note = string(r[:500])
	}
	tag, err := s.db.Exec(ctx, `
		UPDATE appointments SET review_required_at = now(), review_reason = 'patient: ' || $3
		WHERE id = $1 AND patient_id = $2 AND status = 'in_progress' AND review_required_at IS NULL`,
		appointmentID, patientID, note)
	if err != nil {
		return fmt.Errorf("telemedicine: report problem: %w", err)
	}
	if tag.RowsAffected() == 1 {
		return nil
	}
	var status string
	var flagged bool
	if err := s.db.QueryRow(ctx, `
		SELECT status, review_required_at IS NOT NULL FROM appointments WHERE id=$1 AND patient_id=$2`,
		appointmentID, patientID).Scan(&status, &flagged); err != nil {
		return ErrAppointmentNotFound
	}
	if status == string(ApptInProgress) && flagged {
		return nil // already queued
	}
	return permanentError{"telemedicine: only a consult in progress can be reported; cancel it instead"}
}

// ReviewItem is one entry in the admin review queue.
type ReviewItem struct {
	Appointment
	ReviewReason     string    `json:"review_reason"`
	ReviewRequiredAt time.Time `json:"review_required_at"`
}

// ListAppointmentsNeedingReview is the admin queue: open appointments flagged by
// the reconciler or the patient, plus closed ones whose payment the reconciler
// could not complete, oldest first.
func (s *Service) ListAppointmentsNeedingReview(ctx context.Context) ([]ReviewItem, error) {
	appts, err := s.reviewAppointments(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ReviewItem, 0, len(appts))
	for _, a := range appts {
		it := ReviewItem{Appointment: a}
		_ = s.db.QueryRow(ctx, `SELECT COALESCE(review_reason,''), review_required_at FROM appointments WHERE id=$1`, a.ID).
			Scan(&it.ReviewReason, &it.ReviewRequiredAt)
		out = append(out, it)
	}
	return out, nil
}

func (s *Service) reviewAppointments(ctx context.Context) ([]Appointment, error) {
	rows, err := s.db.Query(ctx, `
		SELECT a.id, a.patient_id, a.doctor_id,
		       COALESCE(a.doctor_name,''), COALESCE(a.doctor_specialty,''),
		       COALESCE(a.consultation_type,'video'),
		       a.scheduled_at, a.status, COALESCE(a.notes,''),
		       a.fee_kobo, COALESCE(a.platform_fee_kobo,0), COALESCE(NULLIF(a.total_kobo, 0), a.fee_kobo),
		       a.idempotency_key, COALESCE(a.settlement_id::text,''), a.created_at
		FROM appointments a
		WHERE a.review_required_at IS NOT NULL
		  AND (a.status IN ('booked','confirmed','in_progress') OR a.closed_at IS NOT NULL)
		ORDER BY a.review_required_at ASC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanAppointments(rows)
}

// AdminResolveAppointment is the admin's exit for an appointment that cannot
// close itself: action "settle" pays the doctor, "refund" returns the patient's
// money. Same claim-then-pay path as a party close, audited with the admin as
// actor and the reason given.
func (s *Service) AdminResolveAppointment(ctx context.Context, adminID, appointmentID, action, reason string) error {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return errors.New("telemedicine: a reason is required")
	}
	var target AppointmentStatus
	switch action {
	case "settle":
		target = ApptCompleted
	case "refund":
		target = ApptCancelled
	default:
		return errors.New(`telemedicine: action must be "settle" or "refund"`)
	}
	return s.closeAppointment(ctx, appointmentID, adminID, target, true, reason)
}

// ---------- HTTP handlers ----------

// ReportConsultProblem: POST /appointments/:id/report-problem {note}. Patient only.
func (h *Handler) ReportConsultProblem(c *gin.Context) {
	var req struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req)
	err := h.svc.ReportConsultProblem(c.Request.Context(), c.Param("id"), ginutil.UserID(c), req.Note)
	switch {
	case errors.Is(err, ErrAppointmentNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
	case err != nil:
		c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"queued_for_review": true}})
	}
}

// AdminListReviewQueue: GET /admin/appointments/review.
func (h *Handler) AdminListReviewQueue(c *gin.Context) {
	out, err := h.svc.ListAppointmentsNeedingReview(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminResolveAppointment: POST /admin/appointments/:id/resolve {action, reason}.
func (h *Handler) AdminResolveAppointment(c *gin.Context) {
	var req struct {
		Action string `json:"action"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	err := h.svc.AdminResolveAppointment(c.Request.Context(), ginutil.UserID(c), c.Param("id"), req.Action, req.Reason)
	var p interface{ Permanent() bool }
	switch {
	case errors.Is(err, ErrAppointmentNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: httperr.Msg(c, http.StatusNotFound, err)})
	case errors.As(err, &p):
		c.JSON(http.StatusConflict, gin.H{keyError: httperr.Msg(c, http.StatusConflict, err)})
	case err != nil && (strings.Contains(err.Error(), "reason is required") || strings.Contains(err.Error(), "action must be")):
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	default:
		c.JSON(http.StatusOK, gin.H{"data": gin.H{"resolved": req.Action}})
	}
}
