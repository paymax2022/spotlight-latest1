package transport

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// Parcel insurance paid AT BOOKING (FEATURE_PARCEL_PREPAID_INSURANCE).
//
// Insurance is optional: the sender ticks "insure" (ParcelBookRequest.Insure).
// Ticked, the wallet pays fare + premium together at booking. The premium —
// the estimate's figure (catalog rate × declared value, floored at the
// insurer's minimum) — goes to ledger.AccountInsurancePremiumHold, NEVER into
// the fare escrow, so it can never reach the courier settlement. At courier
// accept the policy is bound from that hold (policy.BindFromQuotePrepaid): the
// insurer's real quote needs the vehicle plate, which only exists then. The
// customer pays exactly what was shown; the platform absorbs any difference to
// the insurer's real premium. If cover cannot be bound, or the parcel is
// cancelled before it is, the premium goes back to the wallet.
//
// parcels.insurance_status tracks where the premium is:
//   none → held (paid at booking) → binding → bound | refunded | refund_failed
// Every money move is a balanced ledger journal, idempotent on its key; where
// the money is after a failed bind is read from the LEDGER, never guessed from
// an error.
//
// Off: the tick is ignored and parcels keep the legacy flow (indicative
// premium shown, cover bound and debited separately at courier accept).

const (
	CodeInsuranceProfileIncomplete     = "INSURANCE_PROFILE_INCOMPLETE"
	CodeInsuranceDeclaredValueRequired = "INSURANCE_DECLARED_VALUE_REQUIRED"
	CodeInsuranceUnavailable           = "INSURANCE_UNAVAILABLE"
	CodeInsuranceCardNotSupported      = "INSURANCE_CARD_NOT_SUPPORTED"
)

const (
	insuranceStatusNone         = "none"
	insuranceStatusHeld         = "held"
	insuranceStatusBinding      = "binding"
	insuranceStatusBound        = "bound"
	insuranceStatusRefunded     = "refunded"
	insuranceStatusRefundFailed = "refund_failed"
)

// WithPrepaidInsurance turns on parcel insurance paid at booking.
func (s *Service) WithPrepaidInsurance(on bool) *Service {
	s.prepaidInsuranceOn = on
	return s
}

// prepaidInsurance reports whether this booking buys cover at booking.
func (s *Service) prepaidInsurance(req ParcelBookRequest) bool {
	return s.prepaidInsuranceOn && req.Insure
}

// checkPrepaidInsurance refuses an insured booking that could never be
// covered, BEFORE any money moves: no declared value, insurer or ledger not
// wired, or a sender profile missing what the insurer's form requires (so they
// are not charged for cover that would be refunded at courier accept).
func (s *Service) checkPrepaidInsurance(ctx context.Context, senderID string, req ParcelBookRequest, premiumKobo int64) error {
	if req.DeclaredValueKobo <= 0 {
		return codedErr(http.StatusUnprocessableEntity, CodeInsuranceDeclaredValueRequired, "enter the value of the item to insure it")
	}
	if s.insurance == nil || s.ledger == nil || premiumKobo <= 0 {
		return codedErr(http.StatusUnprocessableEntity, CodeInsuranceUnavailable, "parcel insurance is not available right now; book without it")
	}
	if missing := senderMissingProfileFields(s.loadParcelSenderProfile(ctx, senderID)); len(missing) > 0 {
		ce := codedErr(http.StatusUnprocessableEntity, CodeInsuranceProfileIncomplete, "complete your profile to insure this parcel")
		ce.Details = map[string]any{"missing": missing}
		return ce
	}
	return nil
}

// checkExpectedParcelInsurance is checkExpectedParcelFare for the premium: a
// catalog rate change between estimate and booking is refused before charging.
func checkExpectedParcelInsurance(expectedKobo *int64, premiumKobo int64) error {
	if expectedKobo == nil || *expectedKobo == premiumKobo {
		return nil
	}
	ce := codedErr(http.StatusConflict, CodeFareChanged, "the insurance price changed since your estimate; please review the new price")
	ce.Details = map[string]any{"insurance_kobo": premiumKobo, "expected_insurance_kobo": *expectedKobo}
	return ce
}

// holdParcelPremium moves the premium from the sender's wallet into the
// insurance hold, under the same checkout tier guard as the fare escrow.
// Idempotent on the booking key: a replay with identical legs is a no-op.
func (s *Service) holdParcelPremium(ctx context.Context, senderID, parcelID, bookingKey string, premiumKobo int64) error {
	wallet, err := s.ledger.GetOrCreateUserWallet(ctx, senderID)
	if err != nil {
		return err
	}
	hold, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountInsurancePremiumHold)
	if err != nil {
		return err
	}
	err = s.ledger.PostJournalWithGuard(ctx, ledger.JournalEntry{
		Reference:       "parcel:insurance:" + parcelID,
		IdempotencyKey:  bookingKey + ":insurance",
		AmountKobo:      premiumKobo,
		DebitAccountID:  wallet.ID,
		CreditAccountID: hold.ID,
		Description:     "parcel insurance premium (held until the policy binds)",
	}, senderID, s.tiers.EnforceCheckoutDebitLimitTx)
	if err != nil {
		return fmt.Errorf("transport: hold parcel insurance premium: %w", err)
	}
	return nil
}

// refundHeldPremium returns a premium still in the hold to the sender's
// wallet. Idempotent on the parcel (a second call is a ledger no-op).
func (s *Service) refundHeldPremium(ctx context.Context, senderID, parcelID string, premiumKobo int64) error {
	if premiumKobo <= 0 {
		return nil
	}
	wallet, err := s.ledger.GetOrCreateUserWallet(ctx, senderID)
	if err != nil {
		return err
	}
	hold, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountInsurancePremiumHold)
	if err != nil {
		return err
	}
	err = s.ledger.PostReversal(ctx, wallet.ID, hold.ID, premiumKobo,
		"parcel:insurance_refund:"+parcelID, "parcel:insurance:"+parcelID+":hold_refund")
	if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return err
	}
	return nil
}

// claimInsuranceStatus moves insurance_status from → to atomically; false
// means another path (a concurrent accept or cancel) already owns the premium.
func (s *Service) claimInsuranceStatus(ctx context.Context, parcelID, from, to string) bool {
	tag, err := s.db.Exec(ctx,
		`UPDATE parcels SET insurance_status=$3, updated_at=NOW() WHERE id=$1 AND insurance_status=$2`,
		parcelID, from, to)
	return err == nil && tag.RowsAffected() == 1
}

func (s *Service) setInsuranceStatus(ctx context.Context, parcelID, status string) {
	if _, err := s.db.Exec(ctx, `UPDATE parcels SET insurance_status=$2, updated_at=NOW() WHERE id=$1`, parcelID, status); err != nil {
		log.Printf("[transport] parcel %s: CRITICAL set insurance_status=%s failed: %v", parcelID, status, err)
	}
}

// settleParcelInsuranceAtAccept binds the prepaid cover once a courier and
// vehicle are known, or refunds the premium when it cannot. Never blocks the
// courier assignment it runs from.
func (s *Service) settleParcelInsuranceAtAccept(ctx context.Context, p *parcelRow, sender parcelSenderProfile, vehicle parcelDriverVehicle) {
	if p.InsuranceStatus != insuranceStatusHeld || !s.claimInsuranceStatus(ctx, p.ID, insuranceStatusHeld, insuranceStatusBinding) {
		return
	}
	bindKey := "parcel:insurance:" + p.ID
	policyID, err := s.bindPrepaidParcelInsurance(ctx, p, sender, vehicle, bindKey)
	if err == nil {
		if _, uErr := s.db.Exec(ctx,
			`UPDATE parcels SET insurance_status='bound', insurance_policy_id=$2, updated_at=NOW() WHERE id=$1`,
			p.ID, policyID); uErr != nil {
			log.Printf("[transport] parcel %s: insurance bound (policy %s) but the parcel was not updated: %v", p.ID, policyID, uErr)
		}
		s.recordModeEvent(ctx, p.SenderID, "parcel.insured", "parcel", p.ID, "", "",
			map[string]any{"insurance_policy_id": policyID, "paid_kobo": p.InsurancePaidKobo})
		return
	}
	log.Printf("[transport] parcel %s: prepaid cover not bound, refunding the premium: %v", p.ID, err)
	s.finishPrepaidRefund(ctx, p, bindKey)
}

// finishPrepaidRefund puts the premium back in the wallet after a bind that
// did not happen. Where the money is comes from the ledger: if the saga never
// moved it out of the hold, refund from the hold here; if it did, the saga's
// auto-reverse refunded it (or, if that failed, it needs reconciliation).
func (s *Service) finishPrepaidRefund(ctx context.Context, p *parcelRow, bindKey string) {
	moved, err := s.ledger.Posted(ctx, bindKey+":premium")
	if err != nil {
		log.Printf("[transport] parcel %s: CRITICAL cannot read where the insurance premium is: %v", p.ID, err)
		s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefundFailed)
		return
	}
	status := insuranceStatusRefunded
	if !moved {
		if rErr := s.refundHeldPremium(ctx, p.SenderID, p.ID, p.InsurancePaidKobo); rErr != nil {
			log.Printf("[transport] parcel %s: CRITICAL premium refund from hold failed: %v", p.ID, rErr)
			status = insuranceStatusRefundFailed
		}
	} else if _, reversed, rErr := s.ledger.EntryByKey(ctx, bindKey+":reversal:rev_debit"); rErr != nil || !reversed {
		log.Printf("[transport] parcel %s: CRITICAL premium left the hold but no refund is on the ledger (err=%v)", p.ID, rErr)
		status = insuranceStatusRefundFailed
	}
	s.setInsuranceStatus(ctx, p.ID, status)
	s.notifyUser(ctx, p.SenderID, "parcel.insurance_refunded", p.ID,
		"We couldn't arrange insurance for your parcel, so your insurance payment has been refunded to your wallet. Your delivery continues as normal.")
	s.recordModeEvent(ctx, p.SenderID, "parcel.insurance_refunded", "parcel", p.ID, "", "",
		map[string]any{"paid_kobo": p.InsurancePaidKobo, "status": status})
}

// bindPrepaidParcelInsurance is bindParcelInsurance for a premium already
// held: the same insurer form, but the saga takes the premium from the hold.
func (s *Service) bindPrepaidParcelInsurance(ctx context.Context, p *parcelRow, sender parcelSenderProfile, vehicle parcelDriverVehicle, bindKey string) (string, error) {
	if s.insurance == nil {
		return "", errors.New("insurance not wired")
	}
	if missing := senderMissingProfileFields(sender); len(missing) > 0 {
		return "", fmt.Errorf("sender profile missing %v", missing)
	}
	if vehicle.PlateNumber == "" {
		return "", errors.New("courier has no vehicle plate on file")
	}
	if err := s.insurance.GrantConsent(ctx, p.SenderID, parcelInsuranceProductCode); err != nil {
		return "", fmt.Errorf("consent: %w", err)
	}
	inputs := buildParcelInsuranceInputs(p, p.PickupAddress, p.DropoffAddress, p.Category, p.DeclaredValueKobo, sender, vehicle, time.Now())
	quoteID, _, err := s.insurance.CreateQuote(ctx, p.SenderID, parcelInsuranceProductCode, p.DeclaredValueKobo, inputs)
	if err != nil {
		return "", fmt.Errorf("quote: %w", err)
	}
	policyID, _, err := s.insurance.BindFromQuotePrepaid(ctx, p.SenderID, quoteID, p.InsurancePaidKobo, bindKey)
	if err != nil {
		return "", fmt.Errorf("bind: %w", err)
	}
	return policyID, nil
}

// refundPrepaidOnCancel returns a premium that is still held when the parcel
// is cancelled before its cover was bound. Cover that is already bound is
// cancelled with the insurer by the existing path (cancelParcelInsurance).
func (s *Service) refundPrepaidOnCancel(ctx context.Context, p *parcelRow) {
	if p.InsuranceStatus != insuranceStatusHeld || !s.claimInsuranceStatus(ctx, p.ID, insuranceStatusHeld, insuranceStatusRefunded) {
		return
	}
	if err := s.refundHeldPremium(ctx, p.SenderID, p.ID, p.InsurancePaidKobo); err != nil {
		log.Printf("[transport] parcel %s: CRITICAL premium refund on cancel failed: %v", p.ID, err)
		s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefundFailed)
	}
}
