package reservation

// refund_ops.go — shared stays cancel-refund machinery. Every stays
// money-unwind (guest Cancel, extranet hotel cancel, supplier-webhook
// CANCELLED_BY_HOTEL) funnels through RefundOps so all paths allocate against
// the same ledger-backed residual map and converge identically on retry.

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"spotlight/backend/internal/finance/ledger"
)

// RefundOps carries the shared cancel-refund machinery. Construct it with the
// same repository + ledger pair the reservation saga wires.
type RefundOps struct {
	repo   *Repository
	ledger *ledger.Service
}

// NewRefundOps constructs the shared refund operator.
func NewRefundOps(repo *Repository, ledgerSvc *ledger.Service) *RefundOps {
	return &RefundOps{repo: repo, ledger: ledgerSvc}
}

// CancelByHotel performs the hotel-side cancel money unwind: kill queued
// payouts, refund everything still parked (hotel-initiated cancels are always
// full refunds — no policy penalty), record the cancellation, and land the
// reservation in CANCELLED_BY_HOTEL. Shared by the extranet and supplier-webhook
// paths; both post under the same idempotency/reference families so retries
// across initiators converge. Every failure leaves the reservation non-terminal.
func (o *RefundOps) CancelByHotel(ctx context.Context, reservationID, reason string) (*Reservation, error) {
	lockTx, lErr := o.repo.LockReservation(ctx, reservationID)
	if lErr != nil {
		return nil, fmt.Errorf("reservation: hotel cancel lock: %w", lErr)
	}
	defer func() { _ = lockTx.Rollback(ctx) }()
	res, err := o.repo.Get(ctx, reservationID)
	if err != nil {
		return nil, err
	}
	if !canTransition(res.State, StateCancelledByHotel) {
		return nil, fmt.Errorf("%w: cannot hotel-cancel from %s", ErrBadState, res.State)
	}
	if err := o.killPayouts(ctx, res.ID); err != nil {
		return nil, err
	}
	refunded, rErr := o.postFullRefund(ctx, res, "stays:refund:"+res.ID,
		"stays:hotelcancel:"+res.ID+":refund")
	if rErr != nil {
		return nil, fmt.Errorf("reservation: hotel cancel refund posting failed (retryable): %w", rErr)
	}
	// refunded is the ledger-truth total across all cancel-refund initiators,
	// not just this attempt's legs — a crashed partial would be underreported.
	if err := o.repo.RecordCancellation(ctx, res.ID, reason, refunded, 0,
		res.CancellationPolicy, "stays:refund:"+res.ID); err != nil {
		return nil, fmt.Errorf("reservation: record hotel cancellation: %w", err)
	}
	if err := o.transition(ctx, res, StateCancelledByHotel); err != nil {
		return nil, err
	}
	return o.repo.Get(ctx, res.ID)
}

// transition applies a guarded optimistic-locked state change and refreshes res.
func (o *RefundOps) transition(ctx context.Context, res *Reservation, to State) error {
	if !canTransition(res.State, to) {
		return fmt.Errorf("%w: %s → %s", ErrBadState, res.State, to)
	}
	if err := o.repo.SetState(ctx, res.ID, to, res.Version); err != nil {
		return err
	}
	res.State = to
	res.Version++
	return nil
}

// killPayouts cancels queued-but-unpaid hotel payouts before the refund legs
// post — the refund unwinds the parked provider net, so a queued payout must
// never release it.
func (o *RefundOps) killPayouts(ctx context.Context, reservationID string) error {
	if _, err := o.repo.CancelPendingPayouts(ctx, reservationID); err != nil {
		return fmt.Errorf("reservation: cancel pending payouts: %w", err)
	}
	return nil
}

// parkedMoney maps where a reservation's captured kobo sit right now.
// Settlement rows record where money was parked but are never decremented by a
// draw, so the residual is row totals minus prior ledger draws — refunding
// against stale totals would over-draw the pooled accounts.
type parkedMoney struct {
	providerKobo int64    // residual claim on AccountProviderClearing
	feeKobo      int64    // residual claim on AccountCommission
	heldKobo     int64    // residual claim on AccountEscrow
	refundedKobo int64    // Σ total_kobo over 'refunded' rows (already returned to the guest)
	escrowedIDs  []string // settlement ids still 'escrowed' (for the release flip)
}

// total returns the residual sum across all parked legs.
func (p parkedMoney) total() int64 { return p.providerKobo + p.feeKobo + p.heldKobo }

// loadParkedMoney reads the settlement rows into a parkedMoney residual map.
// excludeIdemPrefix excludes this op's own prior draws — only for callers whose
// retry must re-derive identical legs from the pre-own-draw residual
// (postModifyRefund). Cancel paths pass "": their remaining already nets own
// draws via CancelRefundDraws, so excluding them would double-count.
// Lookup errors fail closed.
func (o *RefundOps) loadParkedMoney(ctx context.Context, reservationID, excludeIdemPrefix string) (parkedMoney, error) {
	shares, err := o.repo.StaysSettlements(ctx, reservationID)
	if err != nil {
		return parkedMoney{}, fmt.Errorf("reservation: refund source lookup: %w", err)
	}
	var p parkedMoney
	for _, sh := range shares {
		switch sh.Status {
		case "settled":
			p.providerKobo += sh.ProviderKobo
			p.feeKobo += sh.FeeKobo
		case "escrowed":
			p.heldKobo += sh.TotalKobo
			p.escrowedIDs = append(p.escrowedIDs, sh.ID)
		case "refunded":
			p.refundedKobo += sh.TotalKobo
		}
	}
	// Net the ledger draws off the row totals (see RefundDraws).
	draws, err := o.repo.RefundDraws(ctx, reservationID, excludeIdemPrefix)
	if err != nil {
		return parkedMoney{}, fmt.Errorf("reservation: refund draws lookup: %w", err)
	}
	p.providerKobo = max(p.providerKobo-draws[string(ledger.AccountProviderClearing)], 0)
	p.feeKobo = max(p.feeKobo-draws[string(ledger.AccountCommission)], 0)
	// 'refunded' rows' releases are escrow draws — adding their totals back
	// cancels them, leaving still-escrowed claims minus partial draws.
	p.heldKobo = max(p.heldKobo-draws[string(ledger.AccountEscrow)]+p.refundedKobo, 0)
	return p, nil
}

// allocateCancelRefund splits a guest-cancel refund across the parked legs
// proportionally to what each parked — the commission share is reversed too.
// Whatever the settled legs can't cover falls to still-escrowed money; a refund
// exceeding everything captured fails closed.
func allocateCancelRefund(refundKobo int64, p parkedMoney) (int64, int64, int64, error) {
	settled := p.providerKobo + p.feeKobo
	var provider, fee int64
	if settled > 0 {
		provider = min(refundKobo*p.providerKobo/settled, p.providerKobo) // floor split ≤ parked
		fee = refundKobo - provider
		if fee > p.feeKobo {
			// Push the gap back onto the provider leg (capped by what parked).
			fee = p.feeKobo
			provider = min(refundKobo-fee, p.providerKobo)
		}
	}
	held := min(refundKobo-provider-fee, p.heldKobo)
	if rem := refundKobo - provider - fee - held; rem > 0 {
		return 0, 0, 0, fmt.Errorf(
			"reservation: refund %d exceeds captured funds (provider %d + commission %d + escrow %d) — refusing to refund money never held",
			refundKobo, p.providerKobo, p.feeKobo, p.heldKobo)
	}
	return provider, fee, held, nil
}

// postCancelRefund posts the policy-target refund legs from the parked
// sources: DR provider_clearing + DR commission → CR guest wallet, plus an
// escrow release for any never-settled remainder.
// Converges on retry: the amount posted is the policy target minus what prior
// cancel-refund legs already returned (all initiators share the
// 'stays:refund:<id>:*' family), and amount-bound keys make a shifted residual
// post fresh legs rather than no-op at the stale amount. remaining < 0 means
// over-refunded — fail closed.
//
// The residual is net of ALL draws including this op's own — remaining already
// subtracts prior legs via CancelRefundDraws, so the buckets must too, or a
// retry over-draws the pooled standing accounts.
func (o *RefundOps) postCancelRefund(ctx context.Context, res *Reservation, refundKobo int64, refPrefix, idemPrefix string) error {
	parked, err := o.loadParkedMoney(ctx, res.ID, "")
	if err != nil {
		return err
	}
	draws, err := o.repo.CancelRefundDraws(ctx, res.ID)
	if err != nil {
		return fmt.Errorf("reservation: cancel refund draws lookup: %w", err)
	}
	refunded := draws[string(ledger.AccountProviderClearing)] +
		draws[string(ledger.AccountCommission)] + draws[string(ledger.AccountEscrow)]
	remaining := refundKobo - refunded
	if remaining < 0 {
		return fmt.Errorf(
			"reservation: cancel-refund legs already returned %d against a %d policy refund — over-refunded, refusing (needs reconciliation)",
			refunded, refundKobo)
	}
	if remaining == 0 {
		// Already fully refunded — reconcile a crashed escrow flip and any
		// dropped commission-delta records.
		if err := o.reconcileEscrowFlip(ctx, res.ID, parked); err != nil {
			return err
		}
		return o.ensureCommissionDeltas(ctx, res)
	}
	provider, fee, held, err := allocateCancelRefund(remaining, parked)
	if err != nil {
		return err
	}
	if err := o.postRefundLegs(ctx, res, refundLegs{
		providerKobo: provider,
		feeKobo:      fee,
		heldKobo:     held,
		escrowedIDs:  parked.escrowedIDs,
		heldCovers:   held == parked.heldKobo,
	}, refPrefix, idemPrefix); err != nil {
		return err
	}
	// Backstop: an orphan leg whose commission-delta record was lost to a crash
	// still needs its REVERSAL row — idempotent per leg key.
	return o.ensureCommissionDeltas(ctx, res)
}

// postFullRefund refunds everything still parked — hotel-cancel semantics
// (guest made whole, no policy penalty). Same residual semantics as
// postCancelRefund; returns the ledger-truth total across all initiators.
func (o *RefundOps) postFullRefund(ctx context.Context, res *Reservation, refPrefix, idemPrefix string) (int64, error) {
	parked, err := o.loadParkedMoney(ctx, res.ID, "")
	if err != nil {
		return 0, err
	}
	remaining := parked.total()
	if remaining <= 0 {
		// A prior attempt already drained the residual — reconcile.
		if err := o.reconcileEscrowFlip(ctx, res.ID, parked); err != nil {
			return 0, err
		}
		if err := o.ensureCommissionDeltas(ctx, res); err != nil {
			return 0, err
		}
		return o.cancelRefundTotal(ctx, res.ID)
	}
	provider, fee, held, err := allocateCancelRefund(remaining, parked)
	if err != nil {
		return 0, err
	}
	if err := o.postRefundLegs(ctx, res, refundLegs{
		providerKobo: provider,
		feeKobo:      fee,
		heldKobo:     held,
		escrowedIDs:  parked.escrowedIDs,
		heldCovers:   held == parked.heldKobo,
	}, refPrefix, idemPrefix); err != nil {
		return 0, err
	}
	if err := o.ensureCommissionDeltas(ctx, res); err != nil {
		return 0, err
	}
	return o.cancelRefundTotal(ctx, res.ID)
}

// cancelRefundTotal returns the ledger-truth total the cancel-refund family
// ('stays:refund:<id>:*') drew back to the guest across every initiator —
// what a cancellation row must record as refund_kobo.
func (o *RefundOps) cancelRefundTotal(ctx context.Context, reservationID string) (int64, error) {
	draws, err := o.repo.CancelRefundDraws(ctx, reservationID)
	if err != nil {
		return 0, fmt.Errorf("reservation: refund total lookup: %w", err)
	}
	return draws[string(ledger.AccountProviderClearing)] +
		draws[string(ledger.AccountCommission)] +
		draws[string(ledger.AccountEscrow)], nil
}

// ensureCommissionDeltas back-fills the stays_commission_entry REVERSAL row
// for every commission-draw leg posted without a matching domain record —
// otherwise a crash between journal and record leaves the commission net
// overstated and a later admin ReverseCommission re-reverses kobo the guest
// already got back. Delta keys derive deterministically from the leg's own
// amount-bound key, so the ON CONFLICT makes a second write a no-op.
func (o *RefundOps) ensureCommissionDeltas(ctx context.Context, res *Reservation) error {
	legs, err := o.repo.CommissionRefundLegs(ctx, res.ID)
	if err != nil {
		return fmt.Errorf("reservation: commission delta reconcile lookup: %w", err)
	}
	for _, leg := range legs {
		base := strings.TrimSuffix(leg.IdempotencyKey, ":debit")
		deltaKey := strings.Replace(base, ":commission:", ":commission:entry:", 1)
		if deltaKey == base {
			continue // unrecognised key shape — never write an unkeyable delta
		}
		if err := o.repo.RecordCommissionDelta(ctx, res.ID, res.PropertyID, -leg.AmountKobo,
			leg.Reference, deltaKey); err != nil {
			return fmt.Errorf("reservation: commission delta reconcile: %w", err)
		}
	}
	return nil
}

// reconcileEscrowFlip catches up the settlement-row flip a crashed refund left
// behind — the reversal posted but the rows never moved to 'refunded'. Fires
// only when escrow draws cover the whole still-escrowed remainder.
func (o *RefundOps) reconcileEscrowFlip(ctx context.Context, reservationID string, parked parkedMoney) error {
	if len(parked.escrowedIDs) == 0 {
		return nil
	}
	draws, err := o.repo.CancelRefundDraws(ctx, reservationID)
	if err != nil {
		return fmt.Errorf("reservation: escrow flip reconcile lookup: %w", err)
	}
	if draws[string(ledger.AccountEscrow)] >= parked.heldKobo {
		return o.repo.MarkSettlementsRefunded(ctx, parked.escrowedIDs)
	}
	return nil
}

// refundLegs is one guest refund decomposed by money source.
type refundLegs struct {
	providerKobo int64    // DR provider_clearing → CR guest wallet
	feeKobo      int64    // DR commission → CR guest wallet (+ domain REVERSAL entry)
	heldKobo     int64    // escrow release → guest wallet
	escrowedIDs  []string // 'escrowed' settlement ids behind heldKobo
	heldCovers   bool     // heldKobo covers the whole still-escrowed remainder
}

// postRefundLegs posts the guest-refund legs. Each leg carries its own derived
// idempotency key and tolerates ErrDuplicate, so a crash mid-way leaves a retry
// to post exactly the missing legs. Keys bind the computed amount
// (':<leg>:<amount>') — a shifted residual re-derives a different key rather
// than no-op'ing at the stale amount.
func (o *RefundOps) postRefundLegs(ctx context.Context, res *Reservation, legs refundLegs, refPrefix, idemPrefix string) error {
	userWallet, err := o.ledger.GetOrCreateUserWallet(ctx, res.GuestUserID)
	if err != nil {
		return fmt.Errorf("reservation: refund wallet resolve: %w", err)
	}
	if legs.providerKobo > 0 {
		clearingAcc, err := o.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
		if err != nil {
			return fmt.Errorf("reservation: refund clearing resolve: %w", err)
		}
		if err := o.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       refPrefix + ":provider",
			IdempotencyKey:  fmt.Sprintf("%s:provider:%d", idemPrefix, legs.providerKobo),
			AmountKobo:      legs.providerKobo,
			DebitAccountID:  clearingAcc.ID,
			CreditAccountID: userWallet.ID,
			Description:     "stays guest refund — provider share drawdown",
		}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return fmt.Errorf("reservation: refund provider leg: %w", err)
		}
	}
	if legs.feeKobo > 0 {
		commissionAcc, err := o.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
		if err != nil {
			return fmt.Errorf("reservation: refund commission resolve: %w", err)
		}
		if err := o.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       refPrefix + ":commission",
			IdempotencyKey:  fmt.Sprintf("%s:commission:%d", idemPrefix, legs.feeKobo),
			AmountKobo:      legs.feeKobo,
			DebitAccountID:  commissionAcc.ID,
			CreditAccountID: userWallet.ID,
			Description:     "stays guest refund — reversed commission share",
		}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return fmt.Errorf("reservation: refund commission leg: %w", err)
		}
		// Keep the commission domain ledger aligned — a later ReverseCommission
		// must not re-reverse what this refund already returned.
		if err := o.repo.RecordCommissionDelta(ctx, res.ID, res.PropertyID, -legs.feeKobo,
			refPrefix+":commission",
			fmt.Sprintf("%s:commission:entry:%d", idemPrefix, legs.feeKobo)); err != nil {
			return fmt.Errorf("reservation: commission reversal record: %w", err)
		}
	}
	if legs.heldKobo > 0 {
		if err := o.releaseHeldRefund(ctx, userWallet.ID, legs, refPrefix, idemPrefix); err != nil {
			return err
		}
	}
	return nil
}

// releaseHeldRefund returns the never-settled portion to the guest: one
// reversing credit under this operation's ':escrow:<amount>' key. When the draw
// covers the whole still-escrowed remainder (heldCovers) the rows flip to
// 'refunded'; a partial draw leaves them 'escrowed'.
func (o *RefundOps) releaseHeldRefund(ctx context.Context, userWalletID string, legs refundLegs, refPrefix, idemPrefix string) error {
	escrowAcc, err := o.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return fmt.Errorf("reservation: refund escrow resolve: %w", err)
	}
	if err := o.ledger.PostReversal(ctx, userWalletID, escrowAcc.ID, legs.heldKobo,
		refPrefix+":escrow",
		fmt.Sprintf("%s:escrow:%d", idemPrefix, legs.heldKobo)); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("reservation: refund escrow leg: %w", err)
	}
	if legs.heldCovers && len(legs.escrowedIDs) > 0 {
		if err := o.repo.MarkSettlementsRefunded(ctx, legs.escrowedIDs); err != nil {
			return fmt.Errorf("reservation: escrow release flip: %w", err)
		}
	}
	return nil
}

// postParkedTransfer moves amountKobo between the parked standing accounts —
// the modify-decrease rebalance when one share's parking grew while the gross
// fell. Idempotent on idemKey.
func (o *RefundOps) postParkedTransfer(ctx context.Context, from, to ledger.AccountType, amountKobo int64, reference, idemKey string) error {
	fromAcc, err := o.ledger.GetOrCreateStandingAccount(ctx, from)
	if err != nil {
		return fmt.Errorf("reservation: rebalance resolve %s: %w", from, err)
	}
	toAcc, err := o.ledger.GetOrCreateStandingAccount(ctx, to)
	if err != nil {
		return fmt.Errorf("reservation: rebalance resolve %s: %w", to, err)
	}
	if err := o.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference:       reference,
		IdempotencyKey:  idemKey,
		AmountKobo:      amountKobo,
		DebitAccountID:  fromAcc.ID,
		CreditAccountID: toAcc.ID,
		Description:     "stays modify refund — parked-leg rebalance",
	}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("reservation: parked rebalance %s→%s: %w", from, to, err)
	}
	return nil
}

// postModifyRefund posts a price-decrease refund: each parked leg unwinds by
// its own delta. A grown share is funded by a balancing top-up from the
// shrinking leg so the guest refund stays exactly abs(delta). Every draw is
// clamped to what this booking parked; a refund exceeding captured funds fails
// closed.
func (o *RefundOps) postModifyRefund(ctx context.Context, res *Reservation, refundKobo, oldRevenueKobo, newRevenueKobo int64, refPrefix, idemPrefix string) error {
	parked, err := o.loadParkedMoney(ctx, res.ID, idemPrefix)
	if err != nil {
		return err
	}
	oldProvider := res.GrossAmountKobo - oldRevenueKobo
	newGross := res.GrossAmountKobo - refundKobo
	newProvider := newGross - newRevenueKobo
	providerDelta := newProvider - oldProvider  // signed change in provider parking
	feeDelta := newRevenueKobo - oldRevenueKobo // signed change in commission parking

	// Guest-facing draws: a leg refunds only its own shrink; when the other
	// share grew, this leg also funds that growth.
	guestFromClearing := max(-providerDelta-max(feeDelta, int64(0)), 0)
	guestFromCommission := max(-feeDelta-max(providerDelta, int64(0)), 0)
	clearingToCommission := max(feeDelta, int64(0))
	commissionToClearing := max(providerDelta, int64(0))

	// Clamp pooled draws to what this booking parked — over-drawing the shared
	// accounts would spend another booking's money.
	guestFromClearing = min(guestFromClearing, parked.providerKobo)
	guestFromCommission = min(guestFromCommission, parked.feeKobo)
	clearingToCommission = min(clearingToCommission, parked.providerKobo-guestFromClearing)
	commissionToClearing = min(commissionToClearing, parked.feeKobo-guestFromCommission)

	held := max(refundKobo-guestFromClearing-guestFromCommission, 0)
	if held > parked.heldKobo {
		return fmt.Errorf(
			"reservation: modify refund %d exceeds captured funds (provider %d + commission %d + escrow %d) — refusing rather than mis-split",
			refundKobo, parked.providerKobo, parked.feeKobo, parked.heldKobo)
	}
	if err := o.postRefundLegs(ctx, res, refundLegs{
		providerKobo: guestFromClearing,
		feeKobo:      guestFromCommission,
		heldKobo:     held,
		escrowedIDs:  parked.escrowedIDs,
		heldCovers:   held == parked.heldKobo,
	}, refPrefix, idemPrefix); err != nil {
		return err
	}

	// Balancing legs between the parked accounts (at most one is non-zero);
	// amounts are bound into the keys like the refund legs.
	if clearingToCommission > 0 {
		if err := o.postParkedTransfer(ctx, ledger.AccountProviderClearing, ledger.AccountCommission,
			clearingToCommission, refPrefix+":rebalance:commission",
			fmt.Sprintf("%s:rebalance:commission:%d", idemPrefix, clearingToCommission)); err != nil {
			return err
		}
	}
	if commissionToClearing > 0 {
		if err := o.postParkedTransfer(ctx, ledger.AccountCommission, ledger.AccountProviderClearing,
			commissionToClearing, refPrefix+":rebalance:clearing",
			fmt.Sprintf("%s:rebalance:clearing:%d", idemPrefix, commissionToClearing)); err != nil {
			return err
		}
	}
	// Record the rebalance's net commission effect (the guest-leg reversal was
	// already recorded by postRefundLegs).
	return o.repo.RecordCommissionDelta(ctx, res.ID, res.PropertyID,
		clearingToCommission-commissionToClearing,
		refPrefix+":rebalance",
		fmt.Sprintf("%s:rebalance:entry:%d", idemPrefix, clearingToCommission-commissionToClearing))
}
