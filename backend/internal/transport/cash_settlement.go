package transport

import (
	"context"
	"fmt"
	"math"

	"spotlight/backend/internal/finance/ledger"
)

// isCashPayment reports whether a trip's payment_method is the cash rail —
// the rider pays the driver directly, out of band, so no fare is ever
// escrowed through the app. Instead the platform collects its commission by
// debiting the driver's own wallet once the trip completes (settleCashTrip),
// and a driver who can't cover that fee never sees or can accept the ride
// (see driverCanCoverCashFee).
func isCashPayment(paymentMethod string) bool {
	return paymentMethod == "cash"
}

// platformFeeKobo computes the platform's commission on a cash trip's fare
// using the SAME commission split (commissionForTier) instant/wallet trips
// settle with, so a cash rider and a wallet rider on the same driver tier
// cost the platform — and thus the driver — an identical percentage.
func (s *Service) platformFeeKobo(ctx context.Context, driverTier string, fareKobo int64) (int64, error) {
	comm, err := s.commissionForTier(ctx, driverTier)
	if err != nil {
		return 0, err
	}
	return int64(math.Round(float64(fareKobo) * comm.PlatformPct)), nil
}

// driverCanCoverCashFee reports whether driverUserID's own wallet balance
// covers the platform fee a cash trip at fareKobo would owe at THEIR
// commission tier. Fails closed: any lookup error is treated as "cannot
// afford" so a driver is never let onto (or kept on) a cash ride they can't
// pay the platform's cut for. This is the gate applied to the open-requests
// feed (OpenRequests) and re-checked at accept time (DriverAccept).
func (s *Service) driverCanCoverCashFee(ctx context.Context, driverUserID string, fareKobo int64) (bool, error) {
	if s.ledger == nil {
		return false, fmt.Errorf("transport: ledger not wired")
	}
	var tier string
	if err := s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE user_id=$1`, driverUserID).Scan(&tier); err != nil {
		return false, fmt.Errorf("transport: resolve driver tier: %w", err)
	}
	fee, err := s.platformFeeKobo(ctx, tier, fareKobo)
	if err != nil {
		return false, err
	}
	if fee <= 0 {
		return true, nil
	}
	balance, err := s.ledger.GetBalance(ctx, driverUserID)
	if err != nil {
		return false, fmt.Errorf("transport: driver balance: %w", err)
	}
	return balance >= fee, nil
}

// CompletionSummary returns what a driver's app needs to show after
// CompleteTrip: the fare, payment method, and — for cash trips only — the
// platform fee that was just debited from the driver's own wallet (so the UI
// can say "you collected ₦X in cash, ₦Y was deducted as the platform fee"
// instead of the wallet/card-trip "your share has been added to your
// wallet" copy, which is wrong for cash).
func (s *Service) CompletionSummary(ctx context.Context, tripID string) (map[string]any, error) {
	var driverID *string
	var paymentMethod string
	var fareKobo int64
	var finalFare *int64
	if err := s.db.QueryRow(ctx, `SELECT driver_id, payment_method, fare_kobo, final_fare_kobo FROM trips WHERE id=$1`, tripID).
		Scan(&driverID, &paymentMethod, &fareKobo, &finalFare); err != nil {
		return nil, fmt.Errorf("transport: load trip for summary: %w", err)
	}
	if finalFare != nil {
		fareKobo = *finalFare
	}
	out := map[string]any{"paymentMethod": paymentMethod, "fareKobo": fareKobo}
	if isCashPayment(paymentMethod) && driverID != nil {
		var tier string
		s.db.QueryRow(ctx, `SELECT commission_tier FROM drivers WHERE id=$1`, *driverID).Scan(&tier)
		if fee, err := s.platformFeeKobo(ctx, tier, fareKobo); err == nil {
			out["platformFeeKobo"] = fee
		}
	}
	return out, nil
}

// settleCashTrip collects the platform's commission on a cash-paid, completed
// trip by debiting the driver's own wallet directly and crediting the
// standing platform-revenue account — there is no escrow to split, since the
// rider paid the driver in cash, out of band. Idempotent (keyed on the trip
// id, safe to re-drive). A failure here (e.g. the driver's balance dropped
// between accept and completion, despite the accept-time gate) is treated by
// the caller (settleTrip / CompleteTrip) exactly like an escrow-settlement
// failure: the trip stays completed and the debt is flagged for
// reconciliation rather than blocking a ride that has already happened.
func (s *Service) settleCashTrip(ctx context.Context, t *tripRow) error {
	if s.ledger == nil {
		return fmt.Errorf("transport: ledger not wired")
	}
	if t.DriverID == nil {
		return nil // no driver was ever assigned — nothing owed
	}
	var driverUserID, tier string
	if err := s.db.QueryRow(ctx, `SELECT user_id, commission_tier FROM drivers WHERE id=$1`, *t.DriverID).Scan(&driverUserID, &tier); err != nil {
		return fmt.Errorf("transport: resolve driver: %w", err)
	}
	fare := int64(0)
	if t.FinalFare != nil {
		fare = *t.FinalFare
	} else if t.FareEstimate != nil {
		fare = *t.FareEstimate
	}
	fee, err := s.platformFeeKobo(ctx, tier, fare)
	if err != nil {
		return err
	}
	if fee <= 0 {
		return nil
	}
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return fmt.Errorf("transport: resolve platform revenue account: %w", err)
	}
	ref := "trip:" + t.ID + ":cash_fee"
	idem := "cash_fee:" + t.ID
	if err := s.ledger.Debit(ctx, driverUserID, ref, idem, revAcc.ID, fee); err != nil {
		return fmt.Errorf("transport: debit driver cash fee: %w", err)
	}
	return nil
}
