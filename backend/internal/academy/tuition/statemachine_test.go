package tuition

import "testing"

// ── CanPayInstallment ──────────────────────────────────────────────────

func TestCanPayInstallment_Pending(t *testing.T) {
	if !CanPayInstallment(PaymentStatusPending) {
		t.Error("expected true for pending")
	}
}

func TestCanPayInstallment_Overdue(t *testing.T) {
	if !CanPayInstallment(PaymentStatusOverdue) {
		t.Error("expected true for overdue")
	}
}

func TestCanPayInstallment_AlreadyPaid(t *testing.T) {
	if CanPayInstallment(PaymentStatusPaid) {
		t.Error("expected false for paid")
	}
}

func TestCanPayInstallment_Waived(t *testing.T) {
	if CanPayInstallment(PaymentStatusWaived) {
		t.Error("expected false for waived")
	}
}

// ── CanWaiveInstallment ────────────────────────────────────────────────

func TestCanWaiveInstallment_Pending(t *testing.T) {
	if !CanWaiveInstallment(PaymentStatusPending) {
		t.Error("expected true for pending")
	}
}

func TestCanWaiveInstallment_Overdue(t *testing.T) {
	if !CanWaiveInstallment(PaymentStatusOverdue) {
		t.Error("expected true for overdue")
	}
}

func TestCanWaiveInstallment_AlreadyPaid(t *testing.T) {
	if CanWaiveInstallment(PaymentStatusPaid) {
		t.Error("expected false for paid")
	}
}

func TestCanWaiveInstallment_AlreadyWaived(t *testing.T) {
	if CanWaiveInstallment(PaymentStatusWaived) {
		t.Error("expected false for waived")
	}
}

// ── NextStatusAfterPayment ────────────────────────────────────────────

func TestNextStatusAfterPayment_Pending(t *testing.T) {
	got := NextStatusAfterPayment(PaymentStatusPending)
	if got != PaymentStatusPaid {
		t.Errorf("expected %s, got %s", PaymentStatusPaid, got)
	}
}

func TestNextStatusAfterPayment_Overdue(t *testing.T) {
	got := NextStatusAfterPayment(PaymentStatusOverdue)
	if got != PaymentStatusPaid {
		t.Errorf("expected %s, got %s", PaymentStatusPaid, got)
	}
}

func TestNextStatusAfterPayment_AlreadyPaid(t *testing.T) {
	// Should return unchanged (no transition possible)
	got := NextStatusAfterPayment(PaymentStatusPaid)
	if got != PaymentStatusPaid {
		t.Errorf("expected %s, got %s", PaymentStatusPaid, got)
	}
}

// ── NextStatusAfterWaiver ────────────────────────────────────────────

func TestNextStatusAfterWaiver_Pending(t *testing.T) {
	got := NextStatusAfterWaiver(PaymentStatusPending)
	if got != PaymentStatusWaived {
		t.Errorf("expected %s, got %s", PaymentStatusWaived, got)
	}
}

func TestNextStatusAfterWaiver_Overdue(t *testing.T) {
	got := NextStatusAfterWaiver(PaymentStatusOverdue)
	if got != PaymentStatusWaived {
		t.Errorf("expected %s, got %s", PaymentStatusWaived, got)
	}
}

// ── CanTransition ──────────────────────────────────────────────────────

func TestCanTransition_PendingToPaid(t *testing.T) {
	if !CanTransition(PaymentStatusPending, PaymentStatusPaid) {
		t.Error("expected true for pending → paid")
	}
}

func TestCanTransition_PendingToWaived(t *testing.T) {
	if !CanTransition(PaymentStatusPending, PaymentStatusWaived) {
		t.Error("expected true for pending → waived")
	}
}

func TestCanTransition_OverdueToPaid(t *testing.T) {
	if !CanTransition(PaymentStatusOverdue, PaymentStatusPaid) {
		t.Error("expected true for overdue → paid")
	}
}

func TestCanTransition_OverdueToWaived(t *testing.T) {
	if !CanTransition(PaymentStatusOverdue, PaymentStatusWaived) {
		t.Error("expected true for overdue → waived")
	}
}

func TestCanTransition_PaidTerminal(t *testing.T) {
	if CanTransition(PaymentStatusPaid, PaymentStatusPending) {
		t.Error("expected false for paid → pending (terminal)")
	}
	if CanTransition(PaymentStatusPaid, PaymentStatusWaived) {
		t.Error("expected false for paid → waived (terminal)")
	}
}

func TestCanTransition_WaivedTerminal(t *testing.T) {
	if CanTransition(PaymentStatusWaived, PaymentStatusPending) {
		t.Error("expected false for waived → pending (terminal)")
	}
	if CanTransition(PaymentStatusWaived, PaymentStatusPaid) {
		t.Error("expected false for waived → paid (terminal)")
	}
}

func TestCanTransition_InvalidFrom(t *testing.T) {
	if CanTransition("invalid_status", PaymentStatusPaid) {
		t.Error("expected false for invalid from-status")
	}
}

func TestCanTransition_InvalidTo(t *testing.T) {
	if CanTransition(PaymentStatusPending, "invalid_status") {
		t.Error("expected false for invalid to-status")
	}
}

// ── CanCancelPlan ──────────────────────────────────────────────────────

func TestCanCancelPlan_Active(t *testing.T) {
	if !CanCancelPlan(PlanStatusActive) {
		t.Error("expected true for active plan")
	}
}

func TestCanCancelPlan_Completed(t *testing.T) {
	if CanCancelPlan(PlanStatusCompleted) {
		t.Error("expected false for completed plan")
	}
}

func TestCanCancelPlan_Cancelled(t *testing.T) {
	if CanCancelPlan(PlanStatusCancelled) {
		t.Error("expected false for already cancelled plan")
	}
}

// ── CanCompletePlan ────────────────────────────────────────────────────

func TestCanCompletePlan_Active(t *testing.T) {
	if !CanCompletePlan(PlanStatusActive) {
		t.Error("expected true for active plan")
	}
}

func TestCanCompletePlan_Completed(t *testing.T) {
	if CanCompletePlan(PlanStatusCompleted) {
		t.Error("expected false for already completed plan")
	}
}

func TestCanCompletePlan_Cancelled(t *testing.T) {
	if CanCompletePlan(PlanStatusCancelled) {
		t.Error("expected false for cancelled plan")
	}
}
