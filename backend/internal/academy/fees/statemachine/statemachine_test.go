package feesstatemachine

import (
	"errors"
	"testing"
)

// ─────────────────────────────────────────────────────────────────────────────
// Invoice (§3.1, SF-2)
// ─────────────────────────────────────────────────────────────────────────────

func TestInvoiceLegalTransitions(t *testing.T) {
	cases := []struct {
		name  string
		from  InvoiceState
		event Event
		want  InvoiceState
	}{
		{"draft→issued", InvoiceDraft, EvInvoiceIssue, InvoiceIssued},
		{"issued→partially_paid", InvoiceIssued, EvInvoicePayPartial, InvoicePartiallyPaid},
		{"issued→paid", InvoiceIssued, EvInvoicePayFull, InvoicePaid},
		{"issued→overdue", InvoiceIssued, EvInvoiceMarkOverdue, InvoiceOverdue},
		{"partially_paid→partially_paid (more payments)", InvoicePartiallyPaid, EvInvoicePayPartial, InvoicePartiallyPaid},
		{"partially_paid→paid", InvoicePartiallyPaid, EvInvoicePayFull, InvoicePaid},
		{"partially_paid→overdue", InvoicePartiallyPaid, EvInvoiceMarkOverdue, InvoiceOverdue},
		{"overdue→partially_paid", InvoiceOverdue, EvInvoicePayPartial, InvoicePartiallyPaid},
		{"overdue→paid", InvoiceOverdue, EvInvoicePayFull, InvoicePaid},
		{"overdue→frozen", InvoiceOverdue, EvInvoiceFreeze, InvoiceFrozen},
		{"draft→waived", InvoiceDraft, EvInvoiceWaive, InvoiceWaived},
		{"issued→waived", InvoiceIssued, EvInvoiceWaive, InvoiceWaived},
		{"partially_paid→waived", InvoicePartiallyPaid, EvInvoiceWaive, InvoiceWaived},
		{"overdue→waived", InvoiceOverdue, EvInvoiceWaive, InvoiceWaived},
		{"frozen→waived", InvoiceFrozen, EvInvoiceWaive, InvoiceWaived},
		{"draft→written_off", InvoiceDraft, EvInvoiceWriteOff, InvoiceWrittenOff},
		{"issued→written_off", InvoiceIssued, EvInvoiceWriteOff, InvoiceWrittenOff},
		{"partially_paid→written_off", InvoicePartiallyPaid, EvInvoiceWriteOff, InvoiceWrittenOff},
		{"overdue→written_off", InvoiceOverdue, EvInvoiceWriteOff, InvoiceWrittenOff},
		{"frozen→written_off", InvoiceFrozen, EvInvoiceWriteOff, InvoiceWrittenOff},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := InvoiceTransition(tc.from, tc.event)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			if !InvoiceCanTransition(tc.from, tc.want) {
				t.Fatalf("InvoiceCanTransition(%q,%q) = false, want true", tc.from, tc.want)
			}
		})
	}
}

func TestInvoiceIllegalTransitions(t *testing.T) {
	// Representative illegal moves — each must be ErrIllegalTransition (or
	// ErrTerminal for terminal-state departures).
	cases := []struct {
		name  string
		from  InvoiceState
		event Event
	}{
		{"draft→paid directly", InvoiceDraft, EvInvoicePayFull},
		{"draft→overdue", InvoiceDraft, EvInvoiceMarkOverdue},
		{"issued→frozen (freeze only from overdue)", InvoiceIssued, EvInvoiceFreeze},
		{"draft→frozen", InvoiceDraft, EvInvoiceFreeze},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := InvoiceTransition(tc.from, tc.event)
			if !errors.Is(err, ErrIllegalTransition) {
				t.Fatalf("got err %v, want ErrIllegalTransition", err)
			}
		})
	}
}

func TestInvoicePaidIssuedIsIllegal(t *testing.T) {
	// Explicit spec-named case: paid → issued must fail (terminal).
	_, err := InvoiceTransition(InvoicePaid, EvInvoiceIssue)
	if !errors.Is(err, ErrTerminal) {
		t.Fatalf("paid→issued: got %v, want ErrTerminal", err)
	}
	if InvoiceCanTransition(InvoicePaid, InvoiceIssued) {
		t.Fatal("InvoiceCanTransition(paid,issued) = true, want false")
	}
}

func TestInvoiceTerminalStatesRejectAll(t *testing.T) {
	terminals := []InvoiceState{InvoicePaid, InvoiceWaived, InvoiceWrittenOff}
	events := []Event{
		EvInvoiceIssue, EvInvoicePayPartial, EvInvoicePayFull, EvInvoiceMarkOverdue,
		EvInvoiceFreeze, EvInvoiceWaive, EvInvoiceWriteOff,
	}
	for _, term := range terminals {
		for _, ev := range events {
			got, err := InvoiceTransition(term, ev)
			if err == nil {
				t.Fatalf("terminal %q accepted event %q → %q", term, ev, got)
			}
			if got != term {
				t.Fatalf("terminal %q mutated to %q on event %q", term, got, ev)
			}
		}
	}
}

func TestInvoiceIdempotentPartiallyPaid(t *testing.T) {
	// partially_paid + pay_partial is an explicit legal self-loop (further
	// installment) → returns partially_paid with NO error (chosen convention:
	// this specific self-loop is real, not a no-op signal).
	got, err := InvoiceTransition(InvoicePartiallyPaid, EvInvoicePayPartial)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != InvoicePartiallyPaid {
		t.Fatalf("got %q, want partially_paid", got)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// FeesVault (§3.2)
// ─────────────────────────────────────────────────────────────────────────────

func TestVaultLegalTransitions(t *testing.T) {
	cases := []struct {
		name  string
		from  VaultState
		event Event
		want  VaultState
	}{
		{"active→target_reached", VaultActive, EvVaultReachTarget, VaultTargetReached},
		{"target_reached→applied_to_invoice", VaultTargetReached, EvVaultApplyToInvoice, VaultAppliedToInvoice},
		{"active→withdrawn", VaultActive, EvVaultWithdraw, VaultWithdrawn},
		{"target_reached→withdrawn", VaultTargetReached, EvVaultWithdraw, VaultWithdrawn},
		{"active→locked", VaultActive, EvVaultLock, VaultLocked},
		{"locked→active", VaultLocked, EvVaultUnlock, VaultActive},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := VaultTransition(tc.from, tc.event)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
			if !VaultCanTransition(tc.from, tc.want) {
				t.Fatalf("VaultCanTransition(%q,%q) = false", tc.from, tc.want)
			}
		})
	}
}

func TestVaultWithdrawnActiveIsIllegal(t *testing.T) {
	// Spec-named case: withdrawn → active must fail (terminal).
	_, err := VaultTransition(VaultWithdrawn, EvVaultUnlock)
	if !errors.Is(err, ErrTerminal) {
		t.Fatalf("withdrawn→active: got %v, want ErrTerminal", err)
	}
	if VaultCanTransition(VaultWithdrawn, VaultActive) {
		t.Fatal("VaultCanTransition(withdrawn,active) = true, want false")
	}
}

func TestVaultTerminalStatesRejectAll(t *testing.T) {
	terminals := []VaultState{VaultAppliedToInvoice, VaultWithdrawn, VaultClosed}
	events := []Event{
		EvVaultReachTarget, EvVaultApplyToInvoice, EvVaultWithdraw, EvVaultLock, EvVaultUnlock,
	}
	for _, term := range terminals {
		for _, ev := range events {
			_, err := VaultTransition(term, ev)
			if err == nil {
				t.Fatalf("terminal %q accepted event %q", term, ev)
			}
		}
	}
}

func TestVaultLegacyClosedTolerated(t *testing.T) {
	// 'closed' is a known (legacy terminal) state, not an unknown one.
	if !validVaultState(VaultClosed) {
		t.Fatal("VaultClosed should be a valid known state")
	}
	if _, err := VaultTransition(VaultClosed, EvVaultUnlock); !errors.Is(err, ErrTerminal) {
		t.Fatalf("closed is terminal: got %v, want ErrTerminal", err)
	}
}

func TestVaultUnknownStateIllegal(t *testing.T) {
	_, err := VaultTransition(VaultState("bogus"), EvVaultReachTarget)
	if !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("unknown state: got %v, want ErrIllegalTransition", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Promotion (§3.3, SF-3 — RELEASE BLOCKER)
// ─────────────────────────────────────────────────────────────────────────────

func TestPromotionFullPathWithBothApprovalsSucceeds(t *testing.T) {
	// The full six-step path with both approvals must succeed end-to-end.
	steps := []struct {
		event Event
		want  PromotionState
	}{
		{EvFinalizeResults, PromotionResultsFinalized},
		{EvComputePromotion, PromotionComputed},
		{EvTeacherApproval, PromotionReviewed}, // approval #1
		{EvAdminApproval, PromotionApproved},   // approval #2
		{EvAdminApply, PromotionApplied},
	}
	state := PromotionSessionActive
	for _, s := range steps {
		got, err := PromotionTransition(state, s.event)
		if err != nil {
			t.Fatalf("event %q from %q: unexpected error %v", s.event, state, err)
		}
		if got != s.want {
			t.Fatalf("event %q from %q: got %q, want %q", s.event, state, got, s.want)
		}
		state = got
	}
	if state != PromotionApplied {
		t.Fatalf("final state %q, want applied", state)
	}
}

// SF-3 BYPASS ATTEMPTS — these are the load-bearing tests. They actively TRY to
// short-circuit to `applied` and assert failure with ErrApprovalRequired.
func TestPromotionBypassComputedToAppliedFails(t *testing.T) {
	got, err := PromotionTransition(PromotionComputed, EvAdminApply)
	if !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("promotion_computed→applied: got err %v (state %q), want ErrApprovalRequired", err, got)
	}
	if got != PromotionComputed {
		t.Fatalf("bypass mutated state to %q", got)
	}
	// And there is no adjacency edge for it either.
	if PromotionCanTransition(PromotionComputed, PromotionApplied) {
		t.Fatal("PromotionCanTransition(computed,applied) = true — SF-3 VIOLATED")
	}
}

func TestPromotionBypassReviewedToAppliedFails(t *testing.T) {
	got, err := PromotionTransition(PromotionReviewed, EvAdminApply)
	if !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("promotion_reviewed→applied: got err %v (state %q), want ErrApprovalRequired", err, got)
	}
	if PromotionCanTransition(PromotionReviewed, PromotionApplied) {
		t.Fatal("PromotionCanTransition(reviewed,applied) = true — SF-3 VIOLATED")
	}
}

func TestPromotionBypassComputedToApprovedFails(t *testing.T) {
	// Trying to skip the teacher approval and jump straight to admin approval.
	got, err := PromotionTransition(PromotionComputed, EvAdminApproval)
	if !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("promotion_computed→promotion_approved: got err %v (state %q), want ErrApprovalRequired", err, got)
	}
	if PromotionCanTransition(PromotionComputed, PromotionApproved) {
		t.Fatal("PromotionCanTransition(computed,approved) = true — SF-3 VIOLATED")
	}
}

func TestPromotionAppliedIsOnlyReachableFromApproved(t *testing.T) {
	// Exhaustive proof: applied is adjacency-reachable from EXACTLY one state.
	predecessors := 0
	var from PromotionState
	for _, s := range []PromotionState{
		PromotionSessionActive, PromotionResultsFinalized, PromotionComputed,
		PromotionReviewed, PromotionApproved, PromotionApplied,
	} {
		if PromotionCanTransition(s, PromotionApplied) {
			predecessors++
			from = s
		}
	}
	if predecessors != 1 || from != PromotionApproved {
		t.Fatalf("applied has %d predecessor(s) (last=%q); want exactly 1 == promotion_approved", predecessors, from)
	}
	if !RequiresTwoApprovals() {
		t.Fatal("RequiresTwoApprovals() must be true (SF-3)")
	}
}

func TestPromotionLegalForwardSteps(t *testing.T) {
	cases := []struct {
		from  PromotionState
		event Event
		want  PromotionState
	}{
		{PromotionSessionActive, EvFinalizeResults, PromotionResultsFinalized},
		{PromotionResultsFinalized, EvComputePromotion, PromotionComputed},
		{PromotionComputed, EvTeacherApproval, PromotionReviewed},
		{PromotionReviewed, EvAdminApproval, PromotionApproved},
		{PromotionApproved, EvAdminApply, PromotionApplied},
	}
	for _, tc := range cases {
		got, err := PromotionTransition(tc.from, tc.event)
		if err != nil {
			t.Fatalf("%q via %q: unexpected error %v", tc.from, tc.event, err)
		}
		if got != tc.want {
			t.Fatalf("%q via %q: got %q, want %q", tc.from, tc.event, got, tc.want)
		}
	}
}

func TestPromotionTerminalRejectsAll(t *testing.T) {
	events := []Event{EvFinalizeResults, EvComputePromotion, EvTeacherApproval, EvAdminApproval, EvAdminApply}
	for _, ev := range events {
		if _, err := PromotionTransition(PromotionApplied, ev); !errors.Is(err, ErrTerminal) {
			t.Fatalf("applied via %q: got %v, want ErrTerminal", ev, err)
		}
	}
}

func TestPromotionWrongOrderApprovalFails(t *testing.T) {
	// Admin approval before teacher approval (from session_active) must be
	// ErrApprovalRequired, not a silent success.
	if _, err := PromotionTransition(PromotionSessionActive, EvAdminApproval); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("session_active via admin_approval: got %v, want ErrApprovalRequired", err)
	}
	// Teacher approval from the wrong (results_finalized) state, before compute.
	if _, err := PromotionTransition(PromotionResultsFinalized, EvTeacherApproval); !errors.Is(err, ErrApprovalRequired) {
		t.Fatalf("results_finalized via teacher_approval: got %v, want ErrApprovalRequired", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Competition (§3.4)
// ─────────────────────────────────────────────────────────────────────────────

func TestCompetitionLinearForwardPath(t *testing.T) {
	steps := []struct {
		event Event
		want  CompetitionState
	}{
		{EvCompOpenRegistration, CompetitionOpenRegistration},
		{EvCompCloseRegistration, CompetitionRegistrationClosed},
		{EvCompStart, CompetitionInProgress},
		{EvCompPendResults, CompetitionResultsPending},
		{EvCompComplete, CompetitionCompleted},
		{EvCompArchive, CompetitionArchived},
	}
	state := CompetitionDraft
	for _, s := range steps {
		got, err := CompetitionTransition(state, s.event)
		if err != nil {
			t.Fatalf("event %q from %q: unexpected error %v", s.event, state, err)
		}
		if got != s.want {
			t.Fatalf("event %q from %q: got %q, want %q", s.event, state, got, s.want)
		}
		state = got
	}
}

func TestCompetitionSkipIsIllegal(t *testing.T) {
	// Spec-named case: draft → completed must fail (skip).
	_, err := CompetitionTransition(CompetitionDraft, EvCompComplete)
	if !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("draft→completed: got %v, want ErrIllegalTransition", err)
	}
	if CompetitionCanTransition(CompetitionDraft, CompetitionCompleted) {
		t.Fatal("CompetitionCanTransition(draft,completed) = true, want false")
	}
}

func TestCompetitionBackwardIsIllegal(t *testing.T) {
	// in_progress → open_registration (backward) must fail.
	if CompetitionCanTransition(CompetitionInProgress, CompetitionOpenRegistration) {
		t.Fatal("backward move accepted by CanTransition")
	}
	_, err := CompetitionTransition(CompetitionInProgress, EvCompOpenRegistration)
	if !errors.Is(err, ErrIllegalTransition) {
		t.Fatalf("in_progress→open_registration: got %v, want ErrIllegalTransition", err)
	}
}

func TestCompetitionTerminalRejectsAll(t *testing.T) {
	events := []Event{
		EvCompOpenRegistration, EvCompCloseRegistration, EvCompStart,
		EvCompPendResults, EvCompComplete, EvCompArchive,
	}
	for _, ev := range events {
		if _, err := CompetitionTransition(CompetitionArchived, ev); !errors.Is(err, ErrTerminal) {
			t.Fatalf("archived via %q: got %v, want ErrTerminal", ev, err)
		}
	}
}

func TestCompetitionScoringLockedBoundary(t *testing.T) {
	// False before results_pending.
	before := []CompetitionState{
		CompetitionDraft, CompetitionOpenRegistration,
		CompetitionRegistrationClosed, CompetitionInProgress,
	}
	for _, s := range before {
		if ScoringLocked(s) {
			t.Fatalf("ScoringLocked(%q) = true, want false (before results_pending)", s)
		}
	}
	// True at and after results_pending.
	atAndAfter := []CompetitionState{
		CompetitionResultsPending, CompetitionCompleted, CompetitionArchived,
	}
	for _, s := range atAndAfter {
		if !ScoringLocked(s) {
			t.Fatalf("ScoringLocked(%q) = false, want true (at/after results_pending)", s)
		}
	}
	// Unknown state defaults to not-locked (no crash).
	if ScoringLocked(CompetitionState("unknown")) {
		t.Fatal("ScoringLocked(unknown) = true, want false")
	}
}
