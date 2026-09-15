package tuition

import (
	"testing"
	"time"
)

// ── CalculateInstallmentAmount ──────────────────────────────────────────

func TestCalculateInstallmentAmount_EvenSplit(t *testing.T) {
	// 5000 NGN / 4 = 1250 each
	got, err := CalculateInstallmentAmount(5000, 4)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 1250 {
		t.Errorf("expected 1250, got %d", got)
	}
}

func TestCalculateInstallmentAmount_WithRemainder(t *testing.T) {
	// 5000 NGN / 3 = 1666 base (remainder 2 goes to last via manual slice)
	got, err := CalculateInstallmentAmount(5000, 3)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != 1666 {
		t.Errorf("expected 1666, got %d", got)
	}
}

func TestCalculateInstallmentAmount_ZeroTuition(t *testing.T) {
	_, err := CalculateInstallmentAmount(0, 4)
	if err != ErrZeroTuition {
		t.Errorf("expected ErrZeroTuition, got %v", err)
	}
}

func TestCalculateInstallmentAmount_NegativeTuition(t *testing.T) {
	_, err := CalculateInstallmentAmount(-1000, 4)
	if err != ErrZeroTuition {
		t.Errorf("expected ErrZeroTuition, got %v", err)
	}
}

func TestCalculateInstallmentAmount_ZeroCount(t *testing.T) {
	_, err := CalculateInstallmentAmount(5000, 0)
	if err != ErrInvalidAmount {
		t.Errorf("expected ErrInvalidAmount, got %v", err)
	}
}

func TestCalculateInstallmentAmount_NegativeCount(t *testing.T) {
	_, err := CalculateInstallmentAmount(5000, -1)
	if err != ErrInvalidAmount {
		t.Errorf("expected ErrInvalidAmount, got %v", err)
	}
}

// ── CalculateLumpSumDiscount ────────────────────────────────────────────

func TestCalculateLumpSumDiscount_10Percent(t *testing.T) {
	// 5000 with 10% discount = 4500
	got := CalculateLumpSumDiscount(5000, 10)
	if got != 4500 {
		t.Errorf("expected 4500, got %d", got)
	}
}

func TestCalculateLumpSumDiscount_25Percent(t *testing.T) {
	// 4000 with 25% discount = 3000
	got := CalculateLumpSumDiscount(4000, 25)
	if got != 3000 {
		t.Errorf("expected 3000, got %d", got)
	}
}

func TestCalculateLumpSumDiscount_ZeroDiscount(t *testing.T) {
	// 0% discount returns original
	got := CalculateLumpSumDiscount(5000, 0)
	if got != 5000 {
		t.Errorf("expected 5000, got %d", got)
	}
}

func TestCalculateLumpSumDiscount_FullDiscount(t *testing.T) {
	// 100% discount returns 0
	got := CalculateLumpSumDiscount(5000, 100)
	if got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

func TestCalculateLumpSumDiscount_MoreThanFull(t *testing.T) {
	// > 100% discount is clamped to 0
	got := CalculateLumpSumDiscount(5000, 150)
	if got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

// ── CalculateTotalPaidSoFar ────────────────────────────────────────────

func TestCalculateTotalPaidSoFar_AllPaid(t *testing.T) {
	payments := []InstallmentPayment{
		{AmountNGN: 1000, Status: PaymentStatusPaid},
		{AmountNGN: 1000, Status: PaymentStatusPaid},
		{AmountNGN: 1000, Status: PaymentStatusPaid},
	}
	got := CalculateTotalPaidSoFar(payments)
	if got != 3000 {
		t.Errorf("expected 3000, got %d", got)
	}
}

func TestCalculateTotalPaidSoFar_Mixed(t *testing.T) {
	payments := []InstallmentPayment{
		{AmountNGN: 1000, Status: PaymentStatusPaid},
		{AmountNGN: 1000, Status: PaymentStatusPending},
		{AmountNGN: 1000, Status: PaymentStatusWaived},
		{AmountNGN: 1000, Status: PaymentStatusOverdue},
	}
	// Only paid + waived count: 2000
	got := CalculateTotalPaidSoFar(payments)
	if got != 2000 {
		t.Errorf("expected 2000, got %d", got)
	}
}

func TestCalculateTotalPaidSoFar_Empty(t *testing.T) {
	payments := []InstallmentPayment{}
	got := CalculateTotalPaidSoFar(payments)
	if got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

func TestCalculateTotalPaidSoFar_NoPaid(t *testing.T) {
	payments := []InstallmentPayment{
		{AmountNGN: 1000, Status: PaymentStatusPending},
		{AmountNGN: 1000, Status: PaymentStatusOverdue},
	}
	got := CalculateTotalPaidSoFar(payments)
	if got != 0 {
		t.Errorf("expected 0, got %d", got)
	}
}

// ── IsDueAndUnpaid ──────────────────────────────────────────────────────

func TestIsDueAndUnpaid_True(t *testing.T) {
	now := time.Date(2025, 2, 15, 12, 0, 0, 0, time.UTC)
	payment := InstallmentPayment{
		DueDate: time.Date(2025, 2, 14, 12, 0, 0, 0, time.UTC),
		Status:  PaymentStatusPending,
	}
	if !IsDueAndUnpaid(payment, now) {
		t.Error("expected true (payment is overdue and unpaid)")
	}
}

func TestIsDueAndUnpaid_FutureDate(t *testing.T) {
	now := time.Date(2025, 2, 15, 12, 0, 0, 0, time.UTC)
	payment := InstallmentPayment{
		DueDate: time.Date(2025, 2, 16, 12, 0, 0, 0, time.UTC),
		Status:  PaymentStatusPending,
	}
	if IsDueAndUnpaid(payment, now) {
		t.Error("expected false (payment not yet due)")
	}
}

func TestIsDueAndUnpaid_AlreadyPaid(t *testing.T) {
	now := time.Date(2025, 2, 15, 12, 0, 0, 0, time.UTC)
	payment := InstallmentPayment{
		DueDate: time.Date(2025, 2, 14, 12, 0, 0, 0, time.UTC),
		Status:  PaymentStatusPaid,
	}
	if IsDueAndUnpaid(payment, now) {
		t.Error("expected false (payment already paid)")
	}
}

func TestIsDueAndUnpaid_Waived(t *testing.T) {
	now := time.Date(2025, 2, 15, 12, 0, 0, 0, time.UTC)
	payment := InstallmentPayment{
		DueDate: time.Date(2025, 2, 14, 12, 0, 0, 0, time.UTC),
		Status:  PaymentStatusWaived,
	}
	if IsDueAndUnpaid(payment, now) {
		t.Error("expected false (payment waived)")
	}
}

// ── IsApplicationReadyForEnrollment ────────────────────────────────────

func TestIsApplicationReadyForEnrollment_OnePaid(t *testing.T) {
	payments := []InstallmentPayment{
		{Status: PaymentStatusPaid},
		{Status: PaymentStatusPending},
		{Status: PaymentStatusPending},
	}
	if !IsApplicationReadyForEnrollment(payments) {
		t.Error("expected true (at least one paid)")
	}
}

func TestIsApplicationReadyForEnrollment_OneWaived(t *testing.T) {
	payments := []InstallmentPayment{
		{Status: PaymentStatusWaived},
		{Status: PaymentStatusPending},
	}
	if !IsApplicationReadyForEnrollment(payments) {
		t.Error("expected true (at least one waived)")
	}
}

func TestIsApplicationReadyForEnrollment_NoPaidOrWaived(t *testing.T) {
	payments := []InstallmentPayment{
		{Status: PaymentStatusPending},
		{Status: PaymentStatusPending},
		{Status: PaymentStatusOverdue},
	}
	if IsApplicationReadyForEnrollment(payments) {
		t.Error("expected false (no paid or waived)")
	}
}

func TestIsApplicationReadyForEnrollment_Empty(t *testing.T) {
	payments := []InstallmentPayment{}
	if IsApplicationReadyForEnrollment(payments) {
		t.Error("expected false (no payments)")
	}
}

// ── CalculateDueDate ────────────────────────────────────────────────────

func TestCalculateDueDate_Weekly(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	// Index 0 (first) = 7 days later
	got := CalculateDueDate(start, 0, "weekly")
	expected := time.Date(2025, 1, 8, 0, 0, 0, 0, time.UTC)
	if !got.Equal(expected) {
		t.Errorf("expected %v, got %v", expected, got)
	}
}

func TestCalculateDueDate_Biweekly(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	// Index 0 (first) = 14 days later
	got := CalculateDueDate(start, 0, "biweekly")
	expected := time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC)
	if !got.Equal(expected) {
		t.Errorf("expected %v, got %v", expected, got)
	}
}

func TestCalculateDueDate_Monthly(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	// Index 0 (first) = 1 month later
	got := CalculateDueDate(start, 0, "monthly")
	expected := time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC)
	if !got.Equal(expected) {
		t.Errorf("expected %v, got %v", expected, got)
	}
}

func TestCalculateDueDate_MonthlyIndex2(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	// Index 2 (third) = 3 months later
	got := CalculateDueDate(start, 2, "monthly")
	expected := time.Date(2025, 4, 1, 0, 0, 0, 0, time.UTC)
	if !got.Equal(expected) {
		t.Errorf("expected %v, got %v", expected, got)
	}
}

// ── HasCompletePayment ──────────────────────────────────────────────────

func TestHasCompletePayment_AllPaidOrWaived(t *testing.T) {
	payments := []InstallmentPayment{
		{Status: PaymentStatusPaid},
		{Status: PaymentStatusWaived},
		{Status: PaymentStatusPaid},
	}
	if !HasCompletePayment(payments) {
		t.Error("expected true (all terminal)")
	}
}

func TestHasCompletePayment_OnePending(t *testing.T) {
	payments := []InstallmentPayment{
		{Status: PaymentStatusPaid},
		{Status: PaymentStatusPending},
		{Status: PaymentStatusWaived},
	}
	if HasCompletePayment(payments) {
		t.Error("expected false (one pending)")
	}
}

func TestHasCompletePayment_OneOverdue(t *testing.T) {
	payments := []InstallmentPayment{
		{Status: PaymentStatusPaid},
		{Status: PaymentStatusOverdue},
		{Status: PaymentStatusWaived},
	}
	if HasCompletePayment(payments) {
		t.Error("expected false (one overdue)")
	}
}

func TestHasCompletePayment_Empty(t *testing.T) {
	payments := []InstallmentPayment{}
	if !HasCompletePayment(payments) {
		t.Error("expected true (no payments means all are terminal)")
	}
}
