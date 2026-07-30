package settlement

import (
	"context"
	"errors"
	"fmt"

	"spotlight/backend/internal/finance/ledger"
)

// Service owns the stays money-back-office: Naira hotel payouts (direct rail),
// supplier remittance reconciliation (Rail A), and the commission ledger. It REUSES
// the finance ledger primitives — commission posts to the SEPARATE AccountCommission
// account; payouts credit the hotelier wallet from AccountProviderClearing (where the
// confirm-time settle parked the net rate). No balance column is ever written.
//
// Invariants:
//   - Payout HELD until the property has a first confirmed+completed stay (fraud).
//   - Payouts + commission entries are idempotent (idempotency_key UNIQUE).
//   - Commission lives on its own ledger account; a refund reverses it.
//   - Reconciliation breaks are recorded + surfaced to the admin workbench.
type Service struct {
	repo   *Repository
	ledger *ledger.Service
}

// NewService constructs the stays settlement service.
func NewService(repo *Repository, ledgerSvc *ledger.Service) *Service {
	return &Service{repo: repo, ledger: ledgerSvc}
}

// --- commission ledger ---

// AccrueCommission posts a commission ACCRUAL to AccountCommission (separate from
// the net-rate/hotel-payable) and records the domain entry. Idempotent on the key.
// The double-entry is: DEBIT AccountProviderClearing (commission slice of the gross
// already escrow-settled there) → CREDIT AccountCommission.
func (s *Service) AccrueCommission(ctx context.Context, reservationID string, amountKobo int64, idempotencyKey string) (string, error) {
	if amountKobo <= 0 {
		return "", ErrBadAmount
	}
	propertyID, _ := s.repo.PropertyOfReservation(ctx, reservationID)
	ref := "stays:commission:" + reservationID
	if err := s.postCommissionJournal(ctx, amountKobo, ref, idempotencyKey, false); err != nil {
		return "", err
	}
	return s.repo.CreateCommission(ctx, CommissionEntry{
		ReservationID:  reservationID,
		PropertyID:     propertyID,
		AmountKobo:     amountKobo,
		Kind:           "ACCRUAL",
		LedgerRef:      ref,
		IdempotencyKey: idempotencyKey,
	})
}

// ReverseCommission posts a commission REVERSAL when a reservation is refunded: it
// reverses the net commission accrued for the reservation (CREDIT back
// AccountProviderClearing ← DEBIT AccountCommission) and records a negative domain
// entry. Idempotent on the key. A no-op when nothing was accrued.
func (s *Service) ReverseCommission(ctx context.Context, reservationID, idempotencyKey string) (string, error) {
	net, err := s.repo.CommissionNetForReservation(ctx, reservationID)
	if err != nil {
		return "", err
	}
	if net <= 0 {
		return "", nil // nothing to reverse
	}
	propertyID, _ := s.repo.PropertyOfReservation(ctx, reservationID)
	ref := "stays:commission:reversal:" + reservationID
	if err := s.postCommissionJournal(ctx, net, ref, idempotencyKey, true); err != nil {
		return "", err
	}
	return s.repo.CreateCommission(ctx, CommissionEntry{
		ReservationID:  reservationID,
		PropertyID:     propertyID,
		AmountKobo:     -net,
		Kind:           "REVERSAL",
		LedgerRef:      ref,
		IdempotencyKey: idempotencyKey,
	})
}

// postCommissionJournal posts the balanced commission journal. reverse=false accrues
// (clearing → commission); reverse=true reverses (commission → clearing). Uses
// PostJournal so both legs are between standing accounts (no user wallet involved).
// A duplicate idempotency key is a safe no-op.
func (s *Service) postCommissionJournal(ctx context.Context, amountKobo int64, ref, idempotencyKey string, reverse bool) error {
	commissionAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return err
	}
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return err
	}
	j := ledger.JournalEntry{
		Reference:       ref,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  clearingAcc.ID,
		CreditAccountID: commissionAcc.ID,
	}
	if reverse {
		j.DebitAccountID = commissionAcc.ID
		j.CreditAccountID = clearingAcc.ID
	}
	if err := s.ledger.PostJournal(ctx, j); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("settlement: post commission journal: %w", err)
	}
	return nil
}

// ListCommission returns commission entries (admin).
func (s *Service) ListCommission(ctx context.Context, limit int) ([]CommissionEntry, error) {
	return s.repo.ListCommission(ctx, limit)
}

// --- hotel payouts (Naira, direct rail) ---

// QueuePayout records a Naira payout in HELD status (fraud control: held until the
// property has a first confirmed+completed stay). Idempotent on the key. The actual
// money leg only moves on ReleasePayout.
func (s *Service) QueuePayout(ctx context.Context, propertyID, hotelierUserID, reservationID string, amountKobo int64, idempotencyKey string) (string, error) {
	if amountKobo <= 0 {
		return "", ErrBadAmount
	}
	return s.repo.CreatePayout(ctx, Payout{
		PropertyID:     propertyID,
		HotelierUserID: hotelierUserID,
		ReservationID:  reservationID,
		AmountKobo:     amountKobo,
		Status:         "HELD",
		HoldReason:     "awaiting first confirmed+completed stay",
		IdempotencyKey: idempotencyKey,
	})
}

// ReleasePayout moves a HELD/PENDING payout to PAID, crediting the hotelier wallet in
// Naira from AccountProviderClearing (where the net rate was parked at confirm). It
// FAILS CLOSED with ErrPayoutHeld unless the property has at least one COMPLETED
// stay. Idempotent: a re-release of a PAID payout is a no-op.
func (s *Service) ReleasePayout(ctx context.Context, payoutID string) (Payout, error) {
	p, err := s.repo.GetPayout(ctx, payoutID)
	if err != nil {
		return Payout{}, ErrNotFound
	}
	if p.Status == "PAID" {
		return p, nil // idempotent
	}
	if p.Status == "CANCELLED" || p.Status == "FAILED" {
		return p, fmt.Errorf("settlement: payout %s is %s", payoutID, p.Status)
	}
	// Fraud gate — release only after a confirmed+completed stay.
	ok, err := s.repo.HasCompletedStay(ctx, p.PropertyID)
	if err != nil {
		return p, err
	}
	if !ok {
		_ = s.repo.SetPayoutStatus(ctx, payoutID, "HELD", "", "", false)
		return p, ErrPayoutHeld
	}
	if p.HotelierUserID == "" {
		return p, fmt.Errorf("settlement: payout %s has no hotelier wallet target", payoutID)
	}
	// Credit the hotelier wallet in Naira from provider-clearing. Idempotency key
	// threads the ledger posting so a retried release does not double-credit.
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return p, err
	}
	ref := "stays:payout:" + payoutID
	if err := s.ledger.Credit(ctx, p.HotelierUserID, ref, "stays:payout:"+payoutID, clearingAcc.ID, p.AmountKobo); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		_ = s.repo.SetPayoutStatus(ctx, payoutID, "FAILED", "", "", false)
		return p, fmt.Errorf("settlement: payout credit: %w", err)
	}
	if err := s.repo.SetPayoutStatus(ctx, payoutID, "PAID", ref, "", true); err != nil {
		return p, err
	}
	return s.repo.GetPayout(ctx, payoutID)
}

// ListPayouts returns payouts by status (admin workbench).
func (s *Service) ListPayouts(ctx context.Context, status string, limit int) ([]Payout, error) {
	return s.repo.ListPayoutsByStatus(ctx, status, limit)
}

// --- supplier remittance reconciliation (Rail A) ---

// reconToleranceKobo is the absolute kobo tolerance below which expected vs remitted
// is treated as MATCHED (rounding noise). Above it → BREAK.
const reconToleranceKobo = 100

// IngestRemittance records a supplier remittance line and matches it against the
// expected net-rate for the reservation. A mismatch beyond tolerance is recorded as
// a BREAK (surfaced to the admin workbench). Idempotent on the key.
func (s *Service) IngestRemittance(ctx context.Context, supplierCode, reservationID, externalRef string, remittedKobo int64, idempotencyKey string) (string, string, error) {
	expected := int64(0)
	supplierRef := ""
	if reservationID != "" {
		e, sr, err := s.repo.ExpectedNetForReservation(ctx, reservationID)
		if err == nil {
			expected = e
			supplierRef = sr
		}
	}
	status := "MATCHED"
	reason := ""
	if reservationID == "" {
		status = "UNMATCHED"
		reason = "no reservation reference"
	} else if abs64(expected-remittedKobo) > reconToleranceKobo {
		status = "BREAK"
		reason = fmt.Sprintf("expected %d, remitted %d (delta %d)", expected, remittedKobo, remittedKobo-expected)
	}
	id, err := s.repo.UpsertRemittance(ctx, Remittance{
		SupplierCode:   supplierCode,
		ReservationID:  reservationID,
		SupplierRef:    supplierRef,
		ExpectedKobo:   expected,
		RemittedKobo:   remittedKobo,
		Status:         status,
		BreakReason:    reason,
		ExternalRef:    externalRef,
		IdempotencyKey: idempotencyKey,
	})
	return id, status, err
}

// ResolveRemittance marks a remittance break RESOLVED (admin).
func (s *Service) ResolveRemittance(ctx context.Context, id, reason string) error {
	return s.repo.SetRemittanceStatus(ctx, id, "RESOLVED", reason)
}

// ListRemittances returns remittance lines by status (admin workbench / breaks feed).
func (s *Service) ListRemittances(ctx context.Context, status string, limit int) ([]Remittance, error) {
	return s.repo.ListRemittances(ctx, status, limit)
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
