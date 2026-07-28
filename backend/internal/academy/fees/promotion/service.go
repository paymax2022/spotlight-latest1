package feespromotion

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	feesstatemachine "spotlight/backend/internal/academy/fees/statemachine"
)

// Service orchestrates the Promotion engine. It NEVER writes a promotion state with a
// raw update — every state change goes through feesstatemachine.PromotionTransition and
// then the guarded Store.SetPromotionState / RecordXxxApproval. No money moves here;
// every mutation is audit-logged (module 'academy.fees').
//
// SF-3 (release blocker) is enforced in FOUR layers, all active on the apply path:
//   1. feesstatemachine has no computed→applied / reviewed→applied edge; an attempt
//      returns ErrApprovalRequired (surfaced to callers/tests unchanged).
//   2. Apply computes the transition via EvAdminApply, which is legal ONLY from
//      promotion_approved — reached only after two ordered approval events.
//   3. Apply additionally ASSERTS both approver columns are non-empty AND distinct
//      before it touches the rollover (ErrApprovalsIncomplete / ErrApproversMustDiffer).
//   4. The DB CHECK academy_promotion_records_two_approvals_check is the final backstop.
type Service struct {
	store    Store
	rollover *Rollover
}

// NewService builds the service over the pgx-backed Repository.
func NewService(db *pgxpool.Pool) *Service {
	repo := NewRepository(db)
	return &Service{store: repo, rollover: NewRollover(repo)}
}

// NewServiceWithStore injects a custom Store (tests).
func NewServiceWithStore(store Store) *Service {
	return &Service{store: store, rollover: NewRollover(store)}
}

// ── 1. Score import → results_finalized ───────────────────────────────────────

// ImportScores accepts per-student exam scores for a class+session and, once EVERY
// rostered student has a score, advances that class's promotion records
// session_active → results_finalized. It is idempotent: re-importing overwrites the
// staged score; finalizing an already-finalized class is a no-op.
func (s *Service) ImportScores(ctx context.Context, actorID string, req ImportScoresRequest) error {
	if actorID == "" {
		return ErrUnauthenticated
	}
	if req.SchoolID == "" || req.ClassID == "" || req.SessionID == "" || len(req.Scores) == 0 {
		return ErrInvalidInput
	}
	for _, sc := range req.Scores {
		if sc.StudentID == "" {
			return ErrInvalidInput
		}
		if err := s.store.UpsertScore(ctx, req.SchoolID, req.ClassID, req.SessionID, sc.StudentID, sc.Score); err != nil {
			return err
		}
	}
	_ = s.store.WriteAudit(ctx, actorID, "scores_imported", "academy_fee_class", req.ClassID, "", "",
		map[string]any{"sessionId": req.SessionID, "count": len(req.Scores)})

	// Finalize only when every rostered student has a score present.
	roster, err := s.store.ListClassStudentIDs(ctx, req.SchoolID, req.ClassID)
	if err != nil {
		return err
	}
	scores, err := s.store.ListScores(ctx, req.SchoolID, req.ClassID, req.SessionID)
	if err != nil {
		return err
	}
	for _, sid := range roster {
		if _, ok := scores[sid]; !ok {
			return ErrScoresIncomplete
		}
	}
	if len(roster) == 0 {
		return ErrScoresIncomplete
	}
	// Advance each staged record session_active → results_finalized (guarded).
	recs, err := s.store.ListPromotionsByClass(ctx, req.SessionID, req.ClassID)
	if err != nil {
		return err
	}
	for _, rec := range recs {
		if rec.State != StateSessionActive {
			continue // already finalized/beyond — idempotent skip
		}
		if err := s.guardedAdvance(ctx, actorID, rec.ID, rec.State, feesstatemachine.EvFinalizeResults); err != nil {
			return err
		}
	}
	return nil
}

// ── 2. Promotion computation (PROPOSAL ONLY) → promotion_computed ──────────────

// Compute proposes a decision per student per the school's own pass-mark policy and
// advances results_finalized → promotion_computed. It PROPOSES ONLY — it sets no
// student class and never advances past promotion_computed. Auto-apply is impossible
// here by construction (SF-3).
func (s *Service) Compute(ctx context.Context, actorID, sessionID, classID string, req ComputeRequest) ([]PromotionRecord, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	if req.SchoolID == "" || req.ToClassID == "" || sessionID == "" || classID == "" {
		return nil, ErrInvalidInput
	}
	recs, err := s.store.ListPromotionsByClass(ctx, sessionID, classID)
	if err != nil {
		return nil, err
	}
	out := []PromotionRecord{}
	for _, rec := range recs {
		if rec.State != StateResultsFinalized {
			continue // only finalized records are computable — idempotent skip
		}
		decision := s.decide(rec.ExamScore, req)
		if !validDecision(decision) {
			return nil, ErrInvalidDecision
		}
		// Repeated students keep their class (no to_class); others target ToClassID.
		var toClass *string
		if decision == DecisionRepeated {
			toClass = rec.FromClassID
		} else {
			toClass = ptrOrNil(req.ToClassID)
		}
		if err := s.store.WriteAudit(ctx, actorID, "promotion_decision_proposed", "academy_promotion_record", rec.ID,
			string(rec.State), string(StateComputed),
			map[string]any{"decision": string(decision), "score": derefF(rec.ExamScore)}); err != nil {
			return nil, err
		}
		// Persist proposed decision + destination, then guarded-advance to computed.
		updated, err := s.setProposalAndAdvance(ctx, actorID, rec, decision, toClass)
		if err != nil {
			return nil, err
		}
		out = append(out, *updated)
	}
	return out, nil
}

// decide applies the school's configurable pass-mark policy. Pure.
//
//	score >= PassMark                                    ⇒ promoted
//	ConditionalFloor > 0 && PassMark > score >= floor    ⇒ conditional
//	otherwise                                            ⇒ repeated
func (s *Service) decide(score *float64, req ComputeRequest) Decision {
	sc := derefF(score)
	if sc >= req.PassMark {
		return DecisionPromoted
	}
	if req.ConditionalFloor > 0 && sc >= req.ConditionalFloor {
		return DecisionConditional
	}
	return DecisionRepeated
}

// setProposalAndAdvance persists the PROPOSED decision + destination class on the
// results_finalized record (SetProposal — a proposal write, no state change), then
// advances results_finalized → promotion_computed via the guarded state machine. The
// proposal is stamped BEFORE the advance, so a record in promotion_computed always
// carries its decision. Nothing is applied here (SF-3): no student is moved, no class is
// changed — that only happens in Apply after two approvals.
func (s *Service) setProposalAndAdvance(ctx context.Context, actorID string, rec PromotionRecord, decision Decision, toClass *string) (*PromotionRecord, error) {
	if err := s.store.SetProposal(ctx, rec.ID, decision, toClass); err != nil {
		return nil, err
	}
	if err := s.guardedAdvance(ctx, actorID, rec.ID, rec.State, feesstatemachine.EvComputePromotion); err != nil {
		return nil, err
	}
	return s.store.GetPromotion(ctx, rec.ID)
}

// ── 3. SF-3 two-step approval ─────────────────────────────────────────────────

// TeacherApprove is approval #1 (promotion_computed → promotion_reviewed). It stamps
// teacher_approved_by/at in the SAME guarded update as the state change.
func (s *Service) TeacherApprove(ctx context.Context, teacherID, promotionID string) (*PromotionRecord, error) {
	if teacherID == "" {
		return nil, ErrUnauthenticated
	}
	cur, err := s.store.GetPromotion(ctx, promotionID)
	if err != nil {
		return nil, err
	}
	to, err := feesstatemachine.PromotionTransition(cur.State, feesstatemachine.EvTeacherApproval)
	if err != nil {
		_ = s.store.WriteAudit(ctx, teacherID, "promotion_teacher_approval_rejected", "academy_promotion_record",
			promotionID, string(cur.State), "", map[string]any{"reason": err.Error()})
		return nil, err
	}
	out, err := s.store.RecordTeacherApproval(ctx, promotionID, teacherID, time.Now(), cur.State, to)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, teacherID, "promotion_teacher_approved", "academy_promotion_record",
		promotionID, string(cur.State), string(to), map[string]any{})
	return out, nil
}

// AdminApprove is approval #2 (promotion_reviewed → promotion_approved). It enforces
// the stronger SF-3 reading: the admin approver MUST differ from the teacher approver.
func (s *Service) AdminApprove(ctx context.Context, adminID, promotionID string) (*PromotionRecord, error) {
	if adminID == "" {
		return nil, ErrUnauthenticated
	}
	cur, err := s.store.GetPromotion(ctx, promotionID)
	if err != nil {
		return nil, err
	}
	// Distinct-approver guard (SF-3, stronger reading): a single human cannot be both
	// the teacher and the admin approval. Checked BEFORE the transition so the state is
	// untouched on rejection.
	if cur.TeacherApprovedBy != nil && *cur.TeacherApprovedBy == adminID {
		_ = s.store.WriteAudit(ctx, adminID, "promotion_admin_approval_rejected", "academy_promotion_record",
			promotionID, string(cur.State), "", map[string]any{"reason": "approvers_must_differ"})
		return nil, ErrApproversMustDiffer
	}
	to, err := feesstatemachine.PromotionTransition(cur.State, feesstatemachine.EvAdminApproval)
	if err != nil {
		_ = s.store.WriteAudit(ctx, adminID, "promotion_admin_approval_rejected", "academy_promotion_record",
			promotionID, string(cur.State), "", map[string]any{"reason": err.Error()})
		return nil, err
	}
	out, err := s.store.RecordAdminApproval(ctx, promotionID, adminID, time.Now(), cur.State, to)
	if err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, adminID, "promotion_admin_approved", "academy_promotion_record",
		promotionID, string(cur.State), string(to), map[string]any{})
	return out, nil
}

// ── 4. Apply (promotion_approved → applied) + rollover ─────────────────────────

// Apply executes the final promotion_approved → applied transition and runs the
// rollover (class + fee-schedule reassignment). SF-3 is enforced here in depth:
//   - PromotionTransition(cur, EvAdminApply) returns ErrApprovalRequired unless
//     cur == promotion_approved (structural, from the state machine);
//   - Apply ADDITIONALLY asserts both approver columns are set and are distinct.
// There is NO code path in this service that reaches `applied` without both.
func (s *Service) Apply(ctx context.Context, actorID, promotionID string) (*PromotionRecord, error) {
	if actorID == "" {
		return nil, ErrUnauthenticated
	}
	cur, err := s.store.GetPromotion(ctx, promotionID)
	if err != nil {
		return nil, err
	}
	// (a) Structural gate: the state machine forbids reaching applied from anything
	//     other than promotion_approved (ErrApprovalRequired on a bypass attempt).
	to, err := feesstatemachine.PromotionTransition(cur.State, feesstatemachine.EvAdminApply)
	if err != nil {
		_ = s.store.WriteAudit(ctx, actorID, "promotion_apply_rejected", "academy_promotion_record",
			promotionID, string(cur.State), "", map[string]any{"reason": err.Error()})
		return nil, err
	}
	// (b) Defence in depth: both approvals must be present AND distinct even though (a)
	//     already guarantees we came through both approval events. Structurally
	//     unreachable failures — but SF-3 is a release blocker, so we assert anyway.
	if cur.TeacherApprovedBy == nil || cur.AdminApprovedBy == nil ||
		*cur.TeacherApprovedBy == "" || *cur.AdminApprovedBy == "" {
		_ = s.store.WriteAudit(ctx, actorID, "promotion_apply_rejected", "academy_promotion_record",
			promotionID, string(cur.State), "", map[string]any{"reason": "approvals_incomplete"})
		return nil, ErrApprovalsIncomplete
	}
	if *cur.TeacherApprovedBy == *cur.AdminApprovedBy {
		_ = s.store.WriteAudit(ctx, actorID, "promotion_apply_rejected", "academy_promotion_record",
			promotionID, string(cur.State), "", map[string]any{"reason": "approvers_must_differ"})
		return nil, ErrApproversMustDiffer
	}
	// (c) Run the rollover FIRST (idempotent) then commit the terminal state.
	if err := s.rollover.Execute(ctx, actorID, *cur); err != nil {
		return nil, err
	}
	if err := s.guardedAdvance(ctx, actorID, promotionID, cur.State, feesstatemachine.EvAdminApply); err != nil {
		return nil, err
	}
	_ = s.store.WriteAudit(ctx, actorID, "promotion_applied", "academy_promotion_record",
		promotionID, string(cur.State), string(to), map[string]any{"decision": decStr(cur.Decision)})
	return s.store.GetPromotion(ctx, promotionID)
}

// ── shared guarded advance ─────────────────────────────────────────────────────

// guardedAdvance runs event → target through the pure state machine, then applies the
// guarded DB update. It is the ONLY way this package changes promotion state.
func (s *Service) guardedAdvance(ctx context.Context, actorID, id string, from State, event feesstatemachine.Event) error {
	to, err := feesstatemachine.PromotionTransition(from, event)
	if err != nil {
		_ = s.store.WriteAudit(ctx, actorID, "promotion_transition_rejected", "academy_promotion_record",
			id, string(from), "", map[string]any{"event": string(event), "reason": err.Error()})
		return err
	}
	if _, err := s.store.SetPromotionState(ctx, id, from, to); err != nil {
		return err
	}
	return nil
}

// Get returns a promotion record.
func (s *Service) Get(ctx context.Context, id string) (*PromotionRecord, error) {
	return s.store.GetPromotion(ctx, id)
}

// ── tiny helpers ────────────────────────────────────────────────────────────

func derefF(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

func decStr(d *Decision) string {
	if d == nil {
		return ""
	}
	return string(*d)
}
