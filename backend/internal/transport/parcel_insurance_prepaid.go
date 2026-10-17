package transport

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
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
// cancelled (before or after the bind), the premium goes back to the wallet.
//
// parcels.insurance_status tracks where the premium is:
//   declined (not ticked) · none (legacy, booked before the flag)
//   held (paid) → binding → bound | refunded | refund_failed
//
// Money keys are deterministic so every move is idempotent and findable:
//   hold         <bookingKey>:insurance          wallet → hold   (ref parcel:insurance_hold:<bookingKey>)
//   hold refund  <bookingKey>:insurance_refund   hold → wallet   (ONE key for every refund from the hold)
//   bind         parcel:insurance:<id>:premium   hold → clearing (policy saga)
//   saga refund  parcel:insurance:<id>:reversal  clearing → wallet
//   cancel after bind  parcel:insurance:<id>:cancel_refund  paymax_revenue → wallet (platform absorbs)
// Where the money is after a failed bind is read from the LEDGER, never
// guessed from an error. ReconcileParcelInsurance resolves anything a crash
// leaves in between.
//
// Off: the tick is ignored; bookings get status 'none' and the legacy flow
// (indicative premium shown, cover bound and debited at courier accept).

const (
	CodeInsuranceProfileIncomplete     = "INSURANCE_PROFILE_INCOMPLETE"
	CodeInsuranceDeclaredValueRequired = "INSURANCE_DECLARED_VALUE_REQUIRED"
	CodeInsuranceUnavailable           = "INSURANCE_UNAVAILABLE"
	CodeInsuranceCardNotSupported      = "INSURANCE_CARD_NOT_SUPPORTED"
	CodeInsufficientFunds              = "INSUFFICIENT_FUNDS"
)

const (
	insuranceStatusNone         = "none"
	insuranceStatusDeclined     = "declined"
	insuranceStatusHeld         = "held"
	insuranceStatusBinding      = "binding"
	insuranceStatusBound        = "bound"
	insuranceStatusRefunded     = "refunded"
	insuranceStatusRefundFailed = "refund_failed"
)

// ErrInsuranceBindUnconfirmed: the insurer bound the policy but it could not
// be recorded locally. Cover may exist, so the premium is NOT refunded; the
// parcel stays 'binding' for reconciliation. The app-wiring adapter maps the
// insurance saga's equivalent error onto this one.
var ErrInsuranceBindUnconfirmed = errors.New("transport: insurance bind outcome unconfirmed")

// WithPrepaidInsurance turns on parcel insurance paid at booking.
func (s *Service) WithPrepaidInsurance(on bool) *Service {
	s.prepaidInsuranceOn = on
	return s
}

// prepaidInsurance reports whether this booking buys cover at booking.
func (s *Service) prepaidInsurance(req ParcelBookRequest) bool {
	return s.prepaidInsuranceOn && req.Insure
}

// bookingInsuranceStatus is the status a new booking is stored with.
func (s *Service) bookingInsuranceStatus(insured bool, req ParcelBookRequest) string {
	switch {
	case insured:
		return insuranceStatusHeld
	case s.prepaidInsuranceOn && req.DeclaredValueKobo > 0:
		return insuranceStatusDeclined // could have ticked, did not
	default:
		return insuranceStatusNone
	}
}

// checkPrepaidInsurance refuses an insured booking that could never be
// covered or paid for, BEFORE any money moves: no declared value, insurer or
// ledger not wired, a sender profile missing what the insurer's form requires,
// or a wallet that cannot cover fare + premium (checked up front so a booking
// is never left with the premium taken and the fare refused).
func (s *Service) checkPrepaidInsurance(ctx context.Context, senderID, bookingKey string, req ParcelBookRequest, fareKobo, premiumKobo int64) error {
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
	balance, err := s.ledger.GetBalance(ctx, senderID)
	if err != nil {
		return err
	}
	need := fareKobo + premiumKobo
	if held, hErr := s.entryPosted(ctx, bookingKey+":insurance:credit"); hErr != nil {
		return hErr
	} else if held {
		need = fareKobo // a same-key retry: the premium is already in the hold
	}
	if balance < need {
		return codedErr(http.StatusPaymentRequired, CodeInsufficientFunds, "your wallet balance does not cover the delivery fee and insurance")
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

func holdRefundKey(bookingKey string) string { return bookingKey + ":insurance_refund" }
func cancelRefundKey(parcelID string) string {
	return "parcel:insurance:" + parcelID + ":cancel_refund"
}

// markCoverIfPremiumRefunded runs after an insured parcel row is written: if
// the orphan sweep refunded this booking's premium in the meantime (a retry
// racing the grace boundary), the parcel has no paid cover — record that,
// so the bind never runs on a premium that is no longer held.
func (s *Service) markCoverIfPremiumRefunded(ctx context.Context, parcelID, bookingKey string) {
	refunded, err := s.entryPosted(ctx, holdRefundKey(bookingKey)+":rev_debit")
	if err != nil || !refunded {
		return
	}
	if s.claimInsuranceStatus(ctx, parcelID, insuranceStatusHeld, insuranceStatusRefunded) {
		log.Printf("[transport] parcel %s: premium was refunded before the booking completed — shipping without cover", parcelID)
	}
}

// entryPosted reports whether a ledger entry with this exact key exists (the
// ledger of record, not the Redis fast path).
func (s *Service) entryPosted(ctx context.Context, key string) (bool, error) {
	_, found, err := s.ledger.EntryByKey(ctx, key)
	return found, err
}

// holdParcelPremium moves the premium from the sender's wallet into the
// insurance hold, under the same checkout tier guard as the fare escrow. Keyed
// and referenced by the booking key, so a same-key retry (crash before the
// parcel row was written) is a no-op that reuses the held premium. A key whose
// premium was already refunded is refused: re-using it would book cover with
// no money behind it.
func (s *Service) holdParcelPremium(ctx context.Context, senderID, bookingKey string, premiumKobo int64) error {
	refunded, err := s.entryPosted(ctx, holdRefundKey(bookingKey)+":rev_debit")
	if err != nil {
		return err
	}
	if refunded {
		return codedErr(http.StatusConflict, CodeKeyConflict, "this booking attempt was not completed and its payment was returned; please book again")
	}
	wallet, err := s.ledger.GetOrCreateUserWallet(ctx, senderID)
	if err != nil {
		return err
	}
	hold, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountInsurancePremiumHold)
	if err != nil {
		return err
	}
	err = s.ledger.PostJournalWithGuard(ctx, ledger.JournalEntry{
		Reference:       "parcel:insurance_hold:" + bookingKey,
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
// wallet. Every refund from the hold — a failed booking, a failed bind, a
// cancel, the reconciler — uses the ONE key holdRefundKey(bookingKey), so a
// premium can never be refunded twice. Runs on a detached, bounded context
// (the caller's may be the thing that failed) and verifies the refund is on
// the ledger rather than trusting an ErrDuplicate from the Redis fast path.
func (s *Service) refundHeldPremium(ctx context.Context, senderID, bookingKey string, premiumKobo int64) error {
	if premiumKobo <= 0 {
		return nil
	}
	cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	wallet, err := s.ledger.GetOrCreateUserWallet(cctx, senderID)
	if err != nil {
		return err
	}
	hold, err := s.ledger.GetOrCreateStandingAccount(cctx, ledger.AccountInsurancePremiumHold)
	if err != nil {
		return err
	}
	key := holdRefundKey(bookingKey)
	err = s.ledger.PostReversal(cctx, wallet.ID, hold.ID, premiumKobo, "parcel:insurance_refund:"+bookingKey, key)
	if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return err
	}
	if ok, vErr := s.entryPosted(cctx, key+":rev_debit"); vErr != nil || !ok {
		return fmt.Errorf("transport: premium refund %s not on the ledger (err=%v)", key, vErr)
	}
	return nil
}

// refundBoundPremium refunds a premium whose cover was already bound, after
// the parcel was cancelled. The premium itself sits in provider_clearing, owed
// to the insurer, so the refund is a platform cost (paymax_revenue → wallet);
// whatever the insurer returns on the policy cancel comes back through
// clearing in the normal remittance.
func (s *Service) refundBoundPremium(ctx context.Context, p *parcelRow) error {
	cctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	wallet, err := s.ledger.GetOrCreateUserWallet(cctx, p.SenderID)
	if err != nil {
		return err
	}
	revenue, err := s.ledger.GetOrCreateStandingAccount(cctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return err
	}
	key := cancelRefundKey(p.ID)
	err = s.ledger.PostReversal(cctx, wallet.ID, revenue.ID, p.InsurancePaidKobo, "parcel:insurance_cancel_refund:"+p.ID, key)
	if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return err
	}
	if ok, vErr := s.entryPosted(cctx, key+":rev_debit"); vErr != nil || !ok {
		return fmt.Errorf("transport: cancel refund %s not on the ledger (err=%v)", key, vErr)
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

func (s *Service) notifyPremiumRefunded(ctx context.Context, p *parcelRow, why string) {
	s.notifyUser(ctx, p.SenderID, "parcel.insurance_refunded", p.ID,
		"Your parcel insurance payment has been refunded to your wallet: "+why)
	s.recordModeEvent(ctx, p.SenderID, "parcel.insurance_refunded", "parcel", p.ID, "", "",
		map[string]any{"paid_kobo": p.InsurancePaidKobo, "reason": why})
}

// insureParcelAtAccept handles cover once a courier is assigned: a premium
// paid at booking is bound (or refunded); a parcel booked before prepaid
// insurance existed ('none' with a declared value) keeps the legacy
// bind-and-debit; a 'declined' parcel gets nothing.
func (s *Service) insureParcelAtAccept(ctx context.Context, p *parcelRow, sender parcelSenderProfile, vehicle parcelDriverVehicle, driverUserID string) {
	switch {
	case p.InsuranceStatus == insuranceStatusHeld:
		s.settleParcelInsuranceAtAccept(ctx, p, sender, vehicle)
	case p.InsuranceStatus == insuranceStatusNone && p.DeclaredValueKobo > 0:
		// Legacy: only now do we know the vehicle the insurer's form requires.
		// Best-effort — a declined/failed bind just means this parcel ships uninsured.
		if policyID, premiumKobo, ok := s.bindParcelInsurance(ctx, p, p.PickupAddress, p.DropoffAddress, p.Category, sender, vehicle); ok {
			if _, err := s.db.Exec(ctx,
				`UPDATE parcels SET insurance_policy_id=$1, insurance_kobo=$2, updated_at=NOW() WHERE id=$3`,
				policyID, premiumKobo, p.ID,
			); err != nil {
				log.Printf("[transport] parcel %s: insurance bound (policy %s) but failed to persist the reference: %v", p.ID, policyID, err)
			} else {
				s.recordModeEvent(ctx, driverUserID, "parcel.insured", "parcel", p.ID, "courier_assigned", "courier_assigned",
					map[string]any{"insurance_policy_id": policyID, "premium_kobo": premiumKobo})
			}
		}
	}
}

// settleParcelInsuranceAtAccept binds the prepaid cover, or refunds the
// premium when it cannot. Never blocks the courier assignment it runs from.
func (s *Service) settleParcelInsuranceAtAccept(ctx context.Context, p *parcelRow, sender parcelSenderProfile, vehicle parcelDriverVehicle) {
	if p.InsuranceStatus != insuranceStatusHeld || !s.claimInsuranceStatus(ctx, p.ID, insuranceStatusHeld, insuranceStatusBinding) {
		return
	}
	// The courier's request may end mid-bind; the bind and whatever follows it
	// (record, refund) must not die with it and strand the premium.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
	defer cancel()
	bindKey := "parcel:insurance:" + p.ID
	policyID, err := s.bindPrepaidParcelInsurance(ctx, p, sender, vehicle, bindKey)
	switch {
	case err == nil:
		s.recordBoundCover(ctx, p, policyID)
	case errors.Is(err, ErrInsuranceBindUnconfirmed):
		// Cover may exist: never refund on a guess. Stays 'binding'.
		log.Printf("[transport] parcel %s: CRITICAL insurance bind outcome unconfirmed, left for reconciliation: %v", p.ID, err)
	default:
		log.Printf("[transport] parcel %s: prepaid cover not bound, refunding the premium: %v", p.ID, err)
		s.finishPrepaidRefund(ctx, p, bindKey)
	}
}

// recordBoundCover marks the cover bound — unless the parcel was cancelled
// while the bind was in flight, in which case the policy is cancelled and the
// premium refunded (cancel before bind → refund, whatever the timing).
func (s *Service) recordBoundCover(ctx context.Context, p *parcelRow, policyID string) {
	tag, err := s.db.Exec(ctx,
		`UPDATE parcels SET insurance_status='bound', insurance_policy_id=$2, updated_at=NOW() WHERE id=$1 AND insurance_status='binding'`,
		p.ID, policyID)
	if err != nil || tag.RowsAffected() != 1 {
		// Left 'binding' (or moved by someone else): the reconciler settles it
		// from the insurer's recorded outcome.
		log.Printf("[transport] parcel %s: CRITICAL insurance bound (policy %s) but the parcel was not updated (err=%v)", p.ID, policyID, err)
		return
	}
	var parcelStatus string
	if err := s.db.QueryRow(ctx, `SELECT status FROM parcels WHERE id=$1`, p.ID).Scan(&parcelStatus); err == nil && parcelStatus == "cancelled" {
		p.InsurancePolicyID = &policyID
		s.cancelBoundCover(ctx, p, "parcel cancelled while the cover was being arranged")
		return
	}
	s.recordModeEvent(ctx, p.SenderID, "parcel.insured", "parcel", p.ID, "", "",
		map[string]any{"insurance_policy_id": policyID, "paid_kobo": p.InsurancePaidKobo})
}

// cancelBoundCover cancels a bound policy and refunds the premium the sender
// paid. Claimed bound → refunded atomically so it runs once.
func (s *Service) cancelBoundCover(ctx context.Context, p *parcelRow, why string) {
	if !s.claimInsuranceStatus(ctx, p.ID, insuranceStatusBound, insuranceStatusRefunded) {
		return
	}
	if p.InsurancePolicyID != nil && *p.InsurancePolicyID != "" {
		s.cancelParcelInsurance(ctx, p.SenderID, *p.InsurancePolicyID)
	}
	if err := s.refundBoundPremium(ctx, p); err != nil {
		log.Printf("[transport] parcel %s: CRITICAL refund of a cancelled bound premium failed: %v", p.ID, err)
		s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefundFailed)
		return
	}
	s.notifyPremiumRefunded(ctx, p, why)
}

// finishPrepaidRefund puts the premium back after a bind that did not happen.
// If the saga never moved it out of the hold, refund it from the hold here; if
// it did, the saga's auto-reverse refunded it (and already notified the
// sender), or — if that failed — it needs reconciliation.
func (s *Service) finishPrepaidRefund(ctx context.Context, p *parcelRow, bindKey string) {
	moved, err := s.ledger.Posted(ctx, bindKey+":premium")
	if err != nil {
		log.Printf("[transport] parcel %s: CRITICAL cannot read where the insurance premium is: %v", p.ID, err)
		s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefundFailed)
		return
	}
	if !moved {
		if rErr := s.refundHeldPremium(ctx, p.SenderID, p.IdempotencyKey, p.InsurancePaidKobo); rErr != nil {
			log.Printf("[transport] parcel %s: CRITICAL premium refund from hold failed: %v", p.ID, rErr)
			s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefundFailed)
			return
		}
		s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefunded)
		s.notifyPremiumRefunded(ctx, p, "we couldn't arrange cover for this delivery. Your delivery continues as normal.")
		return
	}
	if reversed, rErr := s.entryPosted(ctx, bindKey+":reversal:rev_debit"); rErr != nil || !reversed {
		log.Printf("[transport] parcel %s: CRITICAL premium left the hold but no refund is on the ledger (err=%v)", p.ID, rErr)
		s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefundFailed)
		return
	}
	s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefunded) // the saga already notified the sender
}

// bindPrepaidParcelInsurance is bindParcelInsurance for a premium already
// held: the same insurer form, but the saga takes the premium from the hold.
func (s *Service) bindPrepaidParcelInsurance(ctx context.Context, p *parcelRow, sender parcelSenderProfile, vehicle parcelDriverVehicle, bindKey string) (string, error) {
	if s.insurance == nil {
		return "", errors.New("insurance not wired")
	}
	if refunded, err := s.entryPosted(ctx, holdRefundKey(p.IdempotencyKey)+":rev_debit"); err != nil || refunded {
		return "", fmt.Errorf("premium no longer held (refunded=%t err=%v)", refunded, err)
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

// refundPrepaidOnCancel refunds the premium when a parcel is cancelled: from
// the hold if cover was not bound yet, or by cancelling the bound policy. A
// bind still in flight ('binding') finishes in recordBoundCover, which sees
// the cancellation and refunds then.
func (s *Service) refundPrepaidOnCancel(ctx context.Context, p *parcelRow) {
	switch p.InsuranceStatus {
	case insuranceStatusHeld:
		if !s.claimInsuranceStatus(ctx, p.ID, insuranceStatusHeld, insuranceStatusRefunded) {
			return
		}
		if err := s.refundHeldPremium(ctx, p.SenderID, p.IdempotencyKey, p.InsurancePaidKobo); err != nil {
			log.Printf("[transport] parcel %s: CRITICAL premium refund on cancel failed: %v", p.ID, err)
			s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefundFailed)
			return
		}
		s.notifyPremiumRefunded(ctx, p, "your delivery was cancelled.")
	case insuranceStatusBound:
		s.cancelBoundCover(ctx, p, "your delivery was cancelled.")
	}
}

// ReconcileParcelInsurance resolves premiums a crash or a failure left in
// between (run from the stuck-settlement reconciler). Only rows untouched for
// grace are swept, so it never races a live booking, bind or cancel:
//   - binding with the premium still in the hold → refund it
//   - binding whose saga already refunded it → mark refunded
//   - binding with the premium moved and NOT refunded → left alone (cover may
//     exist: needs the insurer's word), logged
//   - refund_failed → retry the refund from wherever the premium is
//   - held past courier accept (the bind never ran), or on a cancelled parcel
//     whose cancel was interrupted before refunding → refund
//   - a held premium with no parcel row (crash before the INSERT) → refund
func (s *Service) ReconcileParcelInsurance(ctx context.Context, grace time.Duration) (int, error) {
	if s.ledger == nil || s.db == nil {
		return 0, nil
	}
	resolved := 0
	rows, err := s.db.Query(ctx, `
		SELECT id FROM parcels
		WHERE (insurance_status IN ('binding','refund_failed')
		       OR (insurance_status='held' AND status <> 'created'))
		  AND updated_at < NOW() - make_interval(secs => $1)
		LIMIT 200`, grace.Seconds())
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		var p parcelRow
		if err := s.loadParcel(ctx, id, &p); err != nil {
			continue
		}
		if s.reconcileParcelPremium(ctx, &p) {
			resolved++
		}
	}
	n, err := s.reconcileOrphanPremiums(ctx, grace)
	return resolved + n, err
}

func (s *Service) reconcileParcelPremium(ctx context.Context, p *parcelRow) bool {
	bindKey := "parcel:insurance:" + p.ID
	moved, err := s.ledger.Posted(ctx, bindKey+":premium")
	if err != nil {
		return false
	}
	// A refund posted under any of the three refund keys settles it.
	for _, k := range []string{holdRefundKey(p.IdempotencyKey), bindKey + ":reversal", cancelRefundKey(p.ID)} {
		if done, err := s.entryPosted(ctx, k+":rev_debit"); err != nil {
			return false
		} else if done {
			s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefunded)
			return true
		}
	}
	if p.InsuranceStatus == insuranceStatusHeld {
		// Past courier accept without a bind (the claim never happened).
		if !s.claimInsuranceStatus(ctx, p.ID, insuranceStatusHeld, insuranceStatusBinding) {
			return false
		}
		p.InsuranceStatus = insuranceStatusBinding
	}
	if !moved {
		// The premium never left the hold: refund it from there.
		if err := s.refundHeldPremium(ctx, p.SenderID, p.IdempotencyKey, p.InsurancePaidKobo); err != nil {
			log.Printf("[transport] reconcile parcel %s: premium refund from hold failed: %v", p.ID, err)
			s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefundFailed)
			return false
		}
		s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefunded)
		s.notifyPremiumRefunded(ctx, p, "we couldn't arrange cover for this delivery.")
		return true
	}
	// The premium is with the insurer side (provider_clearing) and no refund is
	// on the ledger. A cover that was bound and then cancelled retries its own
	// refund; otherwise the insurer's recorded bind outcome decides.
	if p.InsurancePolicyID != nil && *p.InsurancePolicyID != "" && p.InsuranceStatus == insuranceStatusRefundFailed {
		if err := s.refundBoundPremium(ctx, p); err != nil {
			return false
		}
		s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefunded)
		s.notifyPremiumRefunded(ctx, p, "your delivery was cancelled.")
		return true
	}
	if s.insurance == nil {
		return false
	}
	state, policyID, err := s.insurance.BindOutcome(ctx, bindKey)
	if err != nil {
		return false
	}
	switch state {
	case "succeeded":
		// Cover exists: record it (a cancelled parcel then gets it refunded).
		if p.InsuranceStatus == insuranceStatusRefundFailed {
			s.setInsuranceStatus(ctx, p.ID, insuranceStatusBinding)
		}
		p.InsuranceStatus = insuranceStatusBinding
		s.recordBoundCover(ctx, p, policyID)
		return true
	case "failed", "":
		// The insurer definitely refused — or no purchase was ever sent ("": the
		// saga records its claim BEFORE calling the insurer, so no record means
		// it died between taking the premium and the claim). Either way there is
		// no cover; the saga's own refund did not land. Post it under the saga's
		// key so it can never double up.
		wallet, wErr := s.ledger.GetOrCreateUserWallet(ctx, p.SenderID)
		clearing, cErr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
		if wErr != nil || cErr != nil {
			return false
		}
		if err := s.ledger.PostReversal(ctx, wallet.ID, clearing.ID, p.InsurancePaidKobo, "parcel:insurance_refund:"+p.ID, bindKey+":reversal"); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			log.Printf("[transport] reconcile parcel %s: premium refund from clearing failed: %v", p.ID, err)
			return false
		}
		if ok, _ := s.entryPosted(ctx, bindKey+":reversal:rev_debit"); !ok {
			return false
		}
		s.setInsuranceStatus(ctx, p.ID, insuranceStatusRefunded)
		s.notifyPremiumRefunded(ctx, p, "we couldn't arrange cover for this delivery.")
		return true
	default:
		// in_flight / unknown / none recorded: cover may exist. Never guess.
		log.Printf("[transport] reconcile parcel %s: CRITICAL premium with the insurer, bind outcome %q — needs the insurer's word", p.ID, state)
		return false
	}
}

// reconcileOrphanPremiums refunds premiums held for a booking that never wrote
// its parcel row (crash between the hold and the INSERT, never retried).
func (s *Service) reconcileOrphanPremiums(ctx context.Context, grace time.Duration) (int, error) {
	rows, err := s.db.Query(ctx, `
		SELECT d.idempotency_key, w.user_id::text, d.amount_kobo
		FROM ledger_entries d
		JOIN ledger_accounts w ON w.id = d.account_id
		WHERE d.idempotency_key LIKE '%:insurance:debit'
		  AND d.reference LIKE 'parcel:insurance_hold:%'
		  AND d.created_at < NOW() - make_interval(secs => $1)
		  AND NOT EXISTS (SELECT 1 FROM parcels p
		                  WHERE p.idempotency_key = left(d.idempotency_key, length(d.idempotency_key) - length(':insurance:debit')))
		  AND NOT EXISTS (SELECT 1 FROM ledger_entries r
		                  WHERE r.idempotency_key = left(d.idempotency_key, length(d.idempotency_key) - length(':debit')) || '_refund:rev_debit')
		LIMIT 200`, grace.Seconds())
	if err != nil {
		return 0, err
	}
	type orphan struct {
		bookingKey, senderID string
		amount               int64
	}
	var orphans []orphan
	for rows.Next() {
		var key, sender string
		var amt int64
		if err := rows.Scan(&key, &sender, &amt); err == nil {
			orphans = append(orphans, orphan{strings.TrimSuffix(key, ":insurance:debit"), sender, amt})
		}
	}
	rows.Close()
	n := 0
	for _, o := range orphans {
		// Re-check right before refunding: a same-key retry may have written the
		// parcel since the select (narrows, not closes, that window — the bind
		// also refuses a premium whose hold refund exists).
		var exists bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM parcels WHERE idempotency_key=$1)`, o.bookingKey).Scan(&exists); err != nil || exists {
			continue
		}
		if err := s.refundHeldPremium(ctx, o.senderID, o.bookingKey, o.amount); err != nil {
			log.Printf("[transport] reconcile orphan premium %s: refund failed: %v", o.bookingKey, err)
			continue
		}
		s.notifyUser(ctx, o.senderID, "parcel.insurance_refunded", "",
			"A parcel booking did not complete, so its insurance payment has been refunded to your wallet.")
		n++
	}
	return n, nil
}
