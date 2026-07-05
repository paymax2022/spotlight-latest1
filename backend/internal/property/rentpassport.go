package property

import (
	"context"
	"fmt"
	"time"
)

// RecentPayment is one normalized rent/dues payment in the passport history.
// AmountKobo is an integer in minor units (kobo) — never a float. OnTime is true
// when the payment landed on/before the invoice due date. Category is e.g. rent,
// service_charge, or lease.
type RecentPayment struct {
	Source     string    `json:"source"` // estate | realtor
	AmountKobo int64     `json:"amountKobo"`
	Category   string    `json:"category"`
	OnTime     bool      `json:"onTime"`
	PaidAt     time.Time `json:"paidAt"`
}

// RentPassport is a portable, read-only trust profile derived from a user's
// historical rent/dues payment behaviour. It is shareable to a prospective
// landlord/agency for tenant screening.
//
// Score is 0-100 (see the scoring formula on GetRentPassport). OnTimeRate is the
// 0.0-1.0 ratio of on-time payments. TotalPaidKobo is lifetime successful payments
// in kobo.
type RentPassport struct {
	UserID         string          `json:"userId"`
	Score          int             `json:"score"`
	OnTimeRate     float64         `json:"onTimeRate"`
	TotalPaidKobo  int64           `json:"totalPaidKobo"`
	PaymentsCount  int             `json:"paymentsCount"`
	OldestTenancy  *time.Time      `json:"oldestTenancy,omitempty"`
	RecentPayments []RecentPayment `json:"recentPayments"`
}

// rentPassportRecentLimit caps the recentPayments slice (most recent first).
const rentPassportRecentLimit = 20

// GetRentPassport builds the portable trust profile for userID from successful
// rent/dues payments across the estate dues money path (estate_payments +
// estate_dues_invoices) and the realtor lease money path (realtor_payments +
// realtor_invoices + realtor_leases). It is a pure read + computed score — it
// performs no writes and touches no money path.
//
// ── Scoring formula (documented; deterministic) ───────────────────────────────
// Let R = on-time ratio = (# payments made on/before the invoice due date) /
//
//	(# payments that had a due date to compare against).
//
// Payments with no comparable due date are excluded from R (neither help nor hurt)
// but still count toward TotalPaidKobo / PaymentsCount.
//
//	base   = round(R * 90)                      // up to 90 pts for punctuality
//	tenure = min(10, floor(months_since_oldest_tenancy / 6) * 2)
//	                                             // up to 10 pts for a longer track record
//	score  = clamp(base + tenure, 0, 100)
//
// A brand-new user with no comparable payments scores 0 (fail-closed: absence of a
// positive track record is NOT treated as good credit). The formula is intentionally
// simple, transparent, and explainable to the user being screened.
func (s *Service) GetRentPassport(ctx context.Context, userID string) (*RentPassport, error) {
	rp := &RentPassport{UserID: userID, RecentPayments: []RecentPayment{}}

	var onTimeComparable, onTimeMet int

	// ── Estate dues payments ──────────────────────────────────────────────────
	// estate_payments(status='successful') joined to its invoice for due-date and
	// category. invoice_id may be NULL → no comparable due date.
	estRows, err := s.db.Query(ctx, `
		SELECT p.amount_kobo, p.created_at,
		       COALESCE(i.category,'other') AS category,
		       i.due_date
		FROM estate_payments p
		LEFT JOIN estate_dues_invoices i ON i.id = p.invoice_id
		WHERE p.payer_id = $1 AND p.status = 'successful'
		ORDER BY p.created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("property: estate payments: %w", err)
	}
	for estRows.Next() {
		var amount int64
		var paidAt time.Time
		var category string
		var due *time.Time
		if err := estRows.Scan(&amount, &paidAt, &category, &due); err != nil {
			estRows.Close()
			return nil, err
		}
		rp.TotalPaidKobo += amount
		rp.PaymentsCount++
		onTime := false
		if due != nil {
			onTimeComparable++
			if !paidAt.After(*due) {
				onTimeMet++
				onTime = true
			}
		}
		if len(rp.RecentPayments) < rentPassportRecentLimit {
			rp.RecentPayments = append(rp.RecentPayments, RecentPayment{
				Source: "estate", AmountKobo: amount, Category: category, OnTime: onTime, PaidAt: paidAt,
			})
		}
		if rp.OldestTenancy == nil || paidAt.Before(*rp.OldestTenancy) {
			t := paidAt
			rp.OldestTenancy = &t
		}
	}
	estRows.Close()
	if err := estRows.Err(); err != nil {
		return nil, err
	}

	// ── Realtor lease payments ─────────────────────────────────────────────────
	// realtor_payments(status='paid') → realtor_invoices(due_date) → realtor_leases
	// (start_date as a tenancy anchor). Tolerant of a missing realtor schema: a
	// query error here is treated as "no realtor history" rather than fatal, so the
	// passport still works on estate-only deployments.
	relRows, err := s.db.Query(ctx, `
		SELECT pay.amount_kobo, COALESCE(pay.paid_at, pay.created_at) AS paid_at,
		       inv.due_date, l.start_date
		FROM realtor_payments pay
		JOIN realtor_invoices inv ON inv.id = pay.invoice_id
		JOIN realtor_leases   l   ON l.id   = inv.lease_id
		WHERE pay.user_id = $1 AND pay.status = 'paid'
		ORDER BY paid_at DESC`, userID)
	if err == nil {
		for relRows.Next() {
			var amount int64
			var paidAt time.Time
			var due *time.Time
			var startDate *time.Time
			if err := relRows.Scan(&amount, &paidAt, &due, &startDate); err != nil {
				relRows.Close()
				return nil, err
			}
			rp.TotalPaidKobo += amount
			rp.PaymentsCount++
			onTime := false
			if due != nil {
				onTimeComparable++
				if !paidAt.After(*due) {
					onTimeMet++
					onTime = true
				}
			}
			if len(rp.RecentPayments) < rentPassportRecentLimit {
				rp.RecentPayments = append(rp.RecentPayments, RecentPayment{
					Source: "realtor", AmountKobo: amount, Category: "lease", OnTime: onTime, PaidAt: paidAt,
				})
			}
			anchor := paidAt
			if startDate != nil {
				anchor = *startDate
			}
			if rp.OldestTenancy == nil || anchor.Before(*rp.OldestTenancy) {
				t := anchor
				rp.OldestTenancy = &t
			}
		}
		relRows.Close()
		if err := relRows.Err(); err != nil {
			return nil, err
		}
	}

	// On-time ratio (excludes payments with no comparable due date).
	if onTimeComparable > 0 {
		rp.OnTimeRate = float64(onTimeMet) / float64(onTimeComparable)
	}

	rp.Score = computeRentScore(rp.OnTimeRate, onTimeComparable, rp.OldestTenancy)
	return rp, nil
}

// computeRentScore implements the documented scoring formula.
func computeRentScore(onTimeRate float64, comparable int, oldest *time.Time) int {
	if comparable == 0 {
		return 0 // no positive track record → fail-closed.
	}
	base := int(onTimeRate*90 + 0.5) // round
	tenure := 0
	if oldest != nil {
		months := int(time.Since(*oldest).Hours() / (24 * 30))
		tenure = (months / 6) * 2
		if tenure > 10 {
			tenure = 10
		}
	}
	score := base + tenure
	if score < 0 {
		score = 0
	}
	if score > 100 {
		score = 100
	}
	return score
}
