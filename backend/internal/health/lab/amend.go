package healthlab

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// LR-006 — versioned lab-result amendment.
//
// A result released to the patient/clinician and later found to be wrong is not
// edited in place: it is re-issued as a NEW version. The prior row is retained
// unchanged and marked superseded; a fresh row at version+1 carries the correction.
// This mirrors the never-destructive clinical-content amendment pattern in
// health/triage/governance and keeps the full audit chain intact (HL-12).

var (
	// ErrNotAmendable — the order's result has not been released yet, so there is
	// nothing published to "amend": pre-release corrections go through result entry.
	ErrNotAmendable = errors.New("lab: only a released result can be amended (correct pre-release results via result entry)")
	// ErrResultNotFound — no current (non-superseded) result exists for the test.
	ErrResultNotFound = errors.New("lab: no current result for that test to amend")
	// ErrNoAmendmentReason — an amendment must state why the prior result was wrong.
	ErrNoAmendmentReason = errors.New("lab: an amendment reason is required")
)

// canAmendResult reports whether an order is in a state where a published result
// may be re-issued as a versioned correction (LR-006). Amendment applies only AFTER
// the result was released — RELEASED, or the post-release terminal CLOSED. Before
// release the result is still a working entry and is corrected in place via result
// entry, not versioned.
func canAmendResult(state OrderState) bool {
	return state == StateReleased || state == StateClosed
}

// AmendResultInput is a corrected value for a single already-released test result.
type AmendResultInput struct {
	TestID   string
	Value    string
	Unit     string
	RefRange string
	Status   ResultStatus
	Reason   string // why the prior result was wrong (audit/clinical governance)
}

// AmendResult re-issues a corrected version of an already-released lab result
// (LR-006). It is NON-DESTRUCTIVE: the prior version row is retained unchanged and
// marked superseded; a NEW row is inserted at version+1 carrying the correction.
//
// The fail-safe interpretation backstop is re-run on the corrected value (a wrong
// unit is rejected; a mis-entered status is UPGRADED, never downgraded — the same
// guard as result entry). If the corrected result is critical/abnormal the patient
// + ordering clinician are re-notified (HL-7, never a silent change) and the vault
// copy is refreshed (HL-8). Only a verified scientist of the lab may amend.
//
// The authoritative version bump (insert new + supersede prior) is one atomic tx
// with the current row locked FOR UPDATE, so concurrent amendments serialize into a
// linear version chain. The notification + vault refresh are downstream copies and
// are best-effort (recorded to audit on failure), exactly as on release.
func (s *Service) AmendResult(ctx context.Context, scientistID, orderID string, in AmendResultInput) (*Result, error) {
	if strings.TrimSpace(in.Reason) == "" {
		return nil, ErrNoAmendmentReason
	}
	if in.Status != ResultNormal && in.Status != ResultAbnormal && in.Status != ResultCritical {
		return nil, fmt.Errorf("lab: result status must be NORMAL, ABNORMAL or CRITICAL")
	}
	o, err := s.load(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if !canAmendResult(o.State) {
		return nil, ErrNotAmendable
	}
	// HL-2: only a verified scientist of this lab may re-validate/amend a result.
	if s.prov != nil {
		ok, perr := s.prov.IsVerifiedScientist(ctx, scientistID, o.LabProviderID)
		if perr != nil {
			return nil, perr
		}
		if !ok {
			return nil, fmt.Errorf("lab: only a verified lab scientist may amend results (HL-2)")
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("lab: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the current (non-superseded) version of the test's result so two
	// concurrent amendments serialize and the version chain stays linear.
	var priorID, testName string
	var priorVersion int
	const sel = `SELECT id, test_name, version FROM lab_results
	             WHERE order_id=$1 AND test_id=$2 AND superseded_by IS NULL
	             FOR UPDATE`
	if err := tx.QueryRow(ctx, sel, orderID, in.TestID).Scan(&priorID, &testName, &priorVersion); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrResultNotFound
		}
		return nil, err
	}

	// Fail-safe interpretation backstop on the corrected value (LR-002/003/008): a
	// wrong unit is rejected, a mis-entered status is UPGRADED. Never downgrades.
	effStatus, unitMismatch := deriveEffectiveStatus(in.Status, testName, in.Value, in.Unit, in.RefRange)
	if unitMismatch {
		return nil, fmt.Errorf("lab: amended unit %q for %s disagrees with the reference-range/expected unit (possible transposition) — rejected (EC-002)", in.Unit, testName)
	}

	newID := uuid.New().String()
	// The corrected version re-publishes the result, so it is itself released
	// immediately (released_by = the amending scientist) — the latest version the
	// patient/vault sees is always a released one.
	const ins = `
		INSERT INTO lab_results
		  (id, order_id, test_id, test_name, value, unit, ref_range, status,
		   validated_by, version, amended_by, amended_at, amendment_reason,
		   released_by, released_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,now(),$11,$9,now())`
	if _, err := tx.Exec(ctx, ins, newID, orderID, in.TestID, testName,
		in.Value, in.Unit, in.RefRange, string(effStatus),
		scientistID, priorVersion+1, in.Reason); err != nil {
		return nil, fmt.Errorf("lab: insert amended result: %w", err)
	}
	// Retain the prior version immutably; point it at the version that replaced it.
	if _, err := tx.Exec(ctx, `UPDATE lab_results SET superseded_by=$2 WHERE id=$1`, priorID, newID); err != nil {
		return nil, fmt.Errorf("lab: supersede prior result: %w", err)
	}
	if needsEscalation(effStatus) {
		if _, err := tx.Exec(ctx, `UPDATE lab_results SET escalated_at=now() WHERE id=$1`, newID); err != nil {
			return nil, fmt.Errorf("lab: mark amended escalation: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("lab: commit amendment: %w", err)
	}

	// Provenance (HL-12): who corrected what, from which version, and why.
	s.audited(scientistID, o.PatientID, "health.lab.result.amend", orderID,
		map[string]any{"test": testName, "prior_version": priorVersion, "prior_result_id": priorID},
		map[string]any{"version": priorVersion + 1, "result_id": newID, "status": string(effStatus), "reason": in.Reason})

	// HL-7: a corrected critical/abnormal result must re-notify the patient + ordering
	// clinician — never a silent change. Best-effort; the amendment + audit are the
	// durable record.
	if needsEscalation(effStatus) && s.notify != nil {
		if nerr := s.notify.NotifyCriticalResult(ctx, o.PatientID, orderID, "CRITICAL"); nerr != nil {
			s.audited(scientistID, o.PatientID, "health.lab.result.amend.notify_failed", orderID, nil,
				map[string]any{"error": nerr.Error()})
		}
	}

	// HL-8: refresh the patient's vault with the corrected result set as a NEW
	// versioned record (the prior vault copy is retained). Best-effort — lab_results
	// is the authoritative store; a vault hiccup is recorded, not fatal to the fix.
	if s.vault != nil {
		latest, lerr := s.loadResults(ctx, orderID)
		if lerr != nil {
			s.audited(scientistID, o.PatientID, "health.lab.result.amend.vault_failed", orderID, nil,
				map[string]any{"error": lerr.Error()})
		} else {
			title := fmt.Sprintf("Laboratory result (amended v%d)", priorVersion+1)
			if rid, verr := s.vault.Create(ctx, o.PatientID, scientistID, "PATIENT", "LAB_RESULT", title, summariseResults(latest), nil); verr != nil {
				s.audited(scientistID, o.PatientID, "health.lab.result.amend.vault_failed", orderID, nil,
					map[string]any{"error": verr.Error()})
			} else {
				_, _ = s.db.Exec(ctx, `UPDATE lab_orders SET result_record_id=$2 WHERE id=$1`, orderID, rid)
			}
		}
	}

	return &Result{
		ID:          newID,
		OrderID:     orderID,
		TestID:      in.TestID,
		TestName:    testName,
		Value:       in.Value,
		Unit:        in.Unit,
		RefRange:    in.RefRange,
		Status:      effStatus,
		ValidatedBy: scientistID,
		Version:     priorVersion + 1,
	}, nil
}
