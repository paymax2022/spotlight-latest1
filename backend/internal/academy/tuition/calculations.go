package tuition

import "time"

// CalculateInstallmentAmount splits tuition evenly across installments, with
// remainder distributed to the last payment. Returns per-installment amount
// and any error (e.g., zero tuition, negative count).
//
// Example: 5000 NGN / 4 = 1250 per payment, no remainder.
// Example: 5000 NGN / 3 = 1666, 1666, 1668 (remainder to last).
func CalculateInstallmentAmount(tuitionNGN int64, count int32) (int64, error) {
	if tuitionNGN <= 0 {
		return 0, ErrZeroTuition
	}
	if count <= 0 {
		return 0, ErrInvalidAmount
	}
	return tuitionNGN / int64(count), nil
}

// CalculateLumpSumDiscount applies a percentage discount to a tuition amount.
// Returns the discounted amount (original - discount).
//
// Example: CalculateLumpSumDiscount(5000, 10) = 4500 (10% off).
// If discountPct is 0, returns the original amount unchanged.
func CalculateLumpSumDiscount(tuitionNGN int64, discountPct int32) int64 {
	if discountPct <= 0 {
		return tuitionNGN
	}
	if discountPct >= 100 {
		return 0 // full discount
	}
	// Discount = original * (discount% / 100)
	// Discounted = original - discount
	discount := (tuitionNGN * int64(discountPct)) / 100
	return tuitionNGN - discount
}

// CalculateTotalPaidSoFar sums the amounts of all paid and waived payments
// in the installment plan. Pending and overdue payments are excluded.
func CalculateTotalPaidSoFar(payments []InstallmentPayment) int64 {
	var total int64
	for _, p := range payments {
		if p.Status == PaymentStatusPaid || p.Status == PaymentStatusWaived {
			total += p.AmountNGN
		}
	}
	return total
}

// IsDueAndUnpaid returns true if the payment is past its due date and not
// yet paid or waived. Used to flag installments for overdue processing.
func IsDueAndUnpaid(payment InstallmentPayment, now time.Time) bool {
	return now.After(payment.DueDate) &&
		payment.Status != PaymentStatusPaid &&
		payment.Status != PaymentStatusWaived
}

// IsApplicationReadyForEnrollment returns true if the application has at
// least one paid or waived installment. Used to gate learning access.
func IsApplicationReadyForEnrollment(payments []InstallmentPayment) bool {
	for _, p := range payments {
		if p.Status == PaymentStatusPaid || p.Status == PaymentStatusWaived {
			return true
		}
	}
	return false
}

// CalculateDueDate calculates the due date for an installment given its
// index (0-based) and the start date. Frequency must be one of the valid
// constants; panics otherwise (should be validated upstream).
//
// Example: index=0, start=2025-01-01, freq="biweekly" → 2025-01-15.
func CalculateDueDate(startDate time.Time, index int32, frequency string) time.Time {
	switch frequency {
	case "upfront":
		return startDate
	case "weekly":
		return startDate.AddDate(0, 0, int(index+1)*7)
	case "biweekly":
		return startDate.AddDate(0, 0, int(index+1)*14)
	case "monthly":
		return startDate.AddDate(0, int(index+1), 0)
	default:
		// Should never happen if validated upstream
		panic("invalid frequency: " + frequency)
	}
}

// HasCompletePayment returns true if all installments are either paid or
// waived (i.e., no pending/overdue payments remain).
func HasCompletePayment(payments []InstallmentPayment) bool {
	for _, p := range payments {
		if p.Status != PaymentStatusPaid && p.Status != PaymentStatusWaived {
			return false
		}
	}
	return true
}
