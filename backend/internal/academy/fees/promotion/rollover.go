package feespromotion

import "context"

// Rollover executes the side effects of promotion_approved → applied: it reassigns the
// student's class and status and reassigns the applicable fee schedule for the new
// class/session. It is IDEMPOTENT — applying the same promotion twice does not
// double-reassign, because reassignment is expressed as a set-to-target write (SET
// class_id = to_class) rather than an increment, and the fee-schedule step is a
// side-effect-free verify against the immutable schedule (SF-1).
//
// The rollover moves NO money. Fee schedules are immutable once locked (SF-1), so the
// "reassignment" is a forward-looking association the invoice service reads at the next
// issuance cycle, never a destructive rewrite of an existing schedule.
//
// Decision semantics on apply:
//   - promoted / conditional ⇒ class_id = to_class_id, status = StudentPromoted
//   - repeated               ⇒ class_id = from_class_id (unchanged), status = StudentRepeated
type Rollover struct {
	store rolloverStore
}

// rolloverStore is the Store subset the rollover needs. Keeping it narrow makes the
// idempotency contract obvious and the executor unit-testable in isolation.
type rolloverStore interface {
	GetStudent(ctx context.Context, id string) (*Student, error)
	ReassignStudent(ctx context.Context, studentID string, classID *string, status StudentStatus) (*Student, error)
	ReassignFeeSchedule(ctx context.Context, schoolID, studentID, toClassID, sessionID string) error
	WriteAudit(ctx context.Context, actorID, action, entityType, entityID, from, to string, detail any) error
}

// NewRollover builds a rollover executor over the given store subset.
func NewRollover(store rolloverStore) *Rollover { return &Rollover{store: store} }

// Execute performs the (idempotent) class + fee-schedule reassignment for a promotion
// record. It is called by Service.Apply ONLY after both approvals are asserted, so it
// never runs on an unapproved promotion.
func (rl *Rollover) Execute(ctx context.Context, actorID string, rec PromotionRecord) error {
	if rec.Decision == nil {
		return ErrInvalidDecision
	}
	student, err := rl.store.GetStudent(ctx, rec.StudentID)
	if err != nil {
		return err
	}

	// Determine the target class + student status from the decision.
	var targetClass *string
	var status StudentStatus
	switch *rec.Decision {
	case DecisionPromoted, DecisionConditional:
		// Promoted/conditional advance to the destination class recorded at compute.
		targetClass = rec.ToClassID
		if targetClass == nil {
			targetClass = rec.FromClassID // defensive: no destination ⇒ stay put
		}
		status = StudentPromoted
	case DecisionRepeated:
		// Repeated students KEEP their current class (build-spec §3.3).
		targetClass = rec.FromClassID
		status = StudentRepeated
	default:
		return ErrInvalidDecision
	}

	// Idempotency: if the student is already in the target class with the target
	// status, this is a re-apply — skip the write entirely so double-apply is a no-op.
	if deref(student.ClassID) == deref(targetClass) && student.Status == status {
		_ = rl.store.WriteAudit(ctx, actorID, "promotion_rollover_noop", "academy_student",
			rec.StudentID, "", "", map[string]any{"reason": "already_reassigned"})
		return nil
	}

	if _, err := rl.store.ReassignStudent(ctx, rec.StudentID, targetClass, status); err != nil {
		return err
	}

	// Reassign the applicable fee schedule for the new class/session. Idempotent /
	// side-effect-free against the immutable schedule (SF-1).
	if targetClass != nil && rec.SessionID != nil {
		if err := rl.store.ReassignFeeSchedule(ctx, student.SchoolID, rec.StudentID, *targetClass, *rec.SessionID); err != nil {
			return err
		}
	}

	_ = rl.store.WriteAudit(ctx, actorID, "promotion_rollover_applied", "academy_student",
		rec.StudentID, deref(student.ClassID), deref(targetClass),
		map[string]any{"decision": string(*rec.Decision), "status": string(status)})
	return nil
}
