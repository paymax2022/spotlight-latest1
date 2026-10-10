package fractionalre

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

const (
	keyMaker = "maker"
)

// SubscribeRequest is the investor commitment into a funding round.
type SubscribeRequest struct {
	Units int64 `json:"units" binding:"required"`
}

// Subscribe commits an investor's funds into an open funding round (primary
// market). This is a MONEY PATH and follows every iron rule in order:
//  1. Idempotency-Key required (passed by handler), scoped to
//     "fractionalre:<user>:<client key>" before it touches any shared UNIQUE
//     index — a key another user or module already used can never alias this
//     operation, and a key replayed with a different offering/units conflicts
//     rather than returning the earlier subscription.
//  2. Fail-closed KYC gate (investor must be KYC-verified, tier >= 1).
//  3. Fail-closed per-offer risk acknowledgement required.
//  4. Fail-closed 10%-of-income retail cap check (compliance engine) BEFORE money.
//  5. Fail-closed tier wallet-debit limit (reused finance primitive).
//  6. settlement.Escrow debits the investor wallet → escrow (balanced ledger).
//     The resolved settlement is re-validated against this request (status and
//     total): a scoped-key row left by an abandoned attempt with a different
//     payload is refunded and conflicts.
//  7. The subscription row is inserted under the offering row lock — still
//     'open' and within share_count — and a refused insert unwinds the escrow
//     back to the wallet (money is never stranded without a row).
//  8. Audit event emitted.
func (s *Service) Subscribe(ctx context.Context, userID, idempotencyKey, offeringID string, req SubscribeRequest) (*Subscription, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyKey
	}
	key := scopedIdemKey(userID, idempotencyKey)
	// 1. Idempotency: replay of the SAME payload returns the existing row; the
	//    same key on a different offering or different units conflicts.
	if existing, replay, err := fetchReplay(func() (*Subscription, error) {
		return s.repo.GetSubscriptionByKey(ctx, key)
	}); err != nil {
		return nil, err
	} else if replay {
		if existing.OfferingID != offeringID || existing.Units != req.Units {
			return nil, ErrIdempotencyConflict
		}
		return existing, nil
	}

	if req.Units <= 0 {
		return nil, errors.New("fractionalre: units must be positive")
	}

	o, err := s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return nil, err
	}
	if o.Status != OfferingOpen {
		return nil, ErrOfferingNotOpen
	}
	amountKobo, err := mulKobo(req.Units, o.UnitPriceKobo)
	if err != nil {
		return nil, err
	}

	// Ticket-range gate.
	if amountKobo < o.TicketMinKobo {
		return nil, ErrTicketRange
	}
	if o.TicketMaxKobo > 0 && amountKobo > o.TicketMaxKobo {
		return nil, ErrTicketRange
	}
	// Capacity is NOT pre-checked here: the only safe check runs under the
	// offering row lock inside InsertSubscriptionIfCapacity, after escrow, with
	// the escrow unwound on refusal — a pre-check could never be authoritative
	// anyway, and skipping it means every refused attempt exercises (and leaves
	// an audit trail of) the same escrow+refund unwind.

	// 2. KYC gate (fail-closed): must be verified tier >= 1.
	prof, err := s.kyc.GetProfile(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("fractionalre: kyc lookup (fail closed): %w", err)
	}
	if prof.Status != kyc.StatusVerified || int(prof.Tier) < 1 {
		return nil, ErrKYCRequired
	}

	// 3. Per-offer risk acknowledgement required.
	ackID, ok, err := s.repo.GetOfferRiskAck(ctx, userID, offeringID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrRiskAckRequired
	}

	// 4. Compliance: 10%-income retail cap (fail-closed hard block).
	if err := s.enforceLimit(ctx, userID, amountKobo); err != nil {
		return nil, err
	}

	// 5. Tier wallet-debit limit (reused finance primitive, fail-closed).
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, amountKobo); err != nil {
		return nil, err
	}

	// 6. Escrow: debit investor wallet → escrow standing account (balanced
	//    ledger) under the SCOPED key.
	ref := fmt.Sprintf("fre-sub:%s:%s", offeringID, userID)
	settlementRef := ptr.Deref(o.EscrowReference, "fre-round:"+offeringID)
	// EscrowGated re-runs the strict cap check inside the debit tx under the
	// wallet lock (F7) — the pooled gate at step 5 is advisory only.
	sett, err := s.settlement.EscrowGated(ctx, userID, settlementRef+":"+ref, key, moduleType, amountKobo)
	if err != nil {
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return nil, ledger.ErrInsufficientFunds
		}
		return nil, fmt.Errorf("fractionalre: escrow: %w", err)
	}
	// The escrow row under our scoped key can only be ours — from THIS attempt
	// or an abandoned earlier one. Its recorded total must equal this request's
	// amount (a different total means the key was already consumed by a
	// different payload: refund the parked escrow and conflict). A row already
	// refunded or settled likewise conflicts — never proceed to insert.
	if sett.TotalKobo != amountKobo || sett.Status != settlement.StatusEscrowed {
		if sett.Status == settlement.StatusEscrowed {
			_ = s.settlement.Refund(ctx, sett.ID, "idempotency-key replayed with a different payload")
		}
		return nil, ErrIdempotencyConflict
	}

	sub := &Subscription{
		OfferingID:     offeringID,
		UserID:         userID,
		Units:          req.Units,
		AmountKobo:     amountKobo,
		Status:         SubEscrowed,
		SettlementID:   &sett.ID,
		IdempotencyKey: key,
		RiskAckID:      &ackID,
	}
	// 7. Capacity + still-open enforced under the offering row lock. ANY
	//    non-duplicate failure here leaves escrowed money with no row — refund
	//    it so the wallet is made whole and the key can be retried cleanly
	//    (the refund is itself idempotent on the settlement row).
	if err := s.repo.InsertSubscriptionIfCapacity(ctx, sub); err != nil {
		if isUniqueViolation(err) {
			if existing, gerr := s.repo.GetSubscriptionByKey(ctx, key); gerr == nil {
				if existing.OfferingID != offeringID || existing.Units != req.Units {
					return nil, ErrIdempotencyConflict
				}
				return existing, nil
			}
			// A live row owns the escrow but we cannot resolve it — do NOT
			// refund out from under it. Leave the escrow parked; a retry
			// converges through the replay lookup above.
			return nil, fmt.Errorf("fractionalre: subscription key collided but winner lookup failed: %w", err)
		}
		// Genuinely refused (capacity / not-open / other) — unwind the escrow so
		// the wallet is made whole and the key can be retried cleanly.
		if rerr := s.settlement.Refund(ctx, sett.ID, "subscription insert failed after escrow"); rerr != nil {
			return nil, fmt.Errorf("fractionalre: insert failed (%w) and escrow unwind failed: %w", err, rerr)
		}
		return nil, err
	}

	// Refresh projections + cache YTD.
	_ = s.repo.RecomputeOfferingProjections(ctx, offeringID)
	if ytd, err := s.repo.SumYTDInvested(ctx, userID, s.now().UTC().Year()); err == nil {
		_ = s.repo.CacheYTD(ctx, userID, s.now().UTC().Year(), ytd)
	}

	// 8. Audit.
	_ = s.audit.log(ctx, userID, "offering.subscribe", "subscription", sub.ID, "", nil,
		map[string]any{"offering_id": offeringID, "units": req.Units, "amount_kobo": amountKobo})
	s.notify(ctx, userID, "Investment confirmed", "Your investment is held in escrow pending round close.")
	return sub, nil
}

// ProposeClose records the maker's intent to close a round (step 1 of 2). The
// approver (checker) must be a different user — enforced in ApproveClose.
func (s *Service) ProposeClose(ctx context.Context, makerID, offeringID string) error {
	o, err := s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return err
	}
	if o.Status != OfferingOpen && o.Status != OfferingClosing {
		return errors.New("fractionalre: offering not open for close")
	}
	if err := s.repo.SetCloseProposer(ctx, offeringID, makerID); err != nil {
		return err
	}
	_ = s.audit.log(ctx, makerID, "offering.close.propose", "offering", offeringID, "", nil, nil)
	return nil
}

// CloseAndSettle is the checker step: it evaluates the threshold and either
// allocates the cap table (raised >= min_threshold → Funded) or refunds all
// subscribers (Refund&Close). SEPARATION OF DUTIES: checkerID MUST differ from
// the maker (close_proposed_by). This is a money path: allocation issues units +
// certificates; refund reverses every escrow via settlement.Refund (idempotent).
// Replay converges: a round already funded/refunded returns its terminal state,
// a crashed close is resumable by the SAME checker via the close_approved_by
// claim, and a second checker loses the claim atomically.
func (s *Service) CloseAndSettle(ctx context.Context, checkerID, offeringID string) (*Offering, error) {
	o, err := s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return nil, err
	}
	// SoD: maker must have proposed, and checker != maker.
	if o.CloseProposedBy == nil {
		return nil, errors.New("fractionalre: close must be proposed by a maker first")
	}
	if *o.CloseProposedBy == checkerID {
		return nil, ErrMakerChecker
	}

	// Recompute the raised projection from source rows before deciding.
	if err := s.repo.RecomputeOfferingProjections(ctx, offeringID); err != nil {
		return nil, err
	}
	o, err = s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return nil, err
	}

	// Terminal replay: the close already ran — return the converged state
	// instead of re-running allocate or refund on a closed round.
	if o.Status == OfferingFunded || o.Status == OfferingRefunded || o.Status == OfferingClosed {
		return o, nil
	}

	if thresholdMet(o.RaisedKobo, o.MinThresholdKobo) {
		if claimed, err := s.repo.ClaimClose(ctx, o.ID, checkerID, OfferingClosing); err != nil {
			return nil, err
		} else if !claimed {
			return nil, s.closeClaimLost(ctx, o.ID)
		}
		return s.allocate(ctx, checkerID, o)
	}
	return s.refundAll(ctx, checkerID, o)
}

// closeClaimLost reports the outcome when another checker already owns (or
// finished) the close: the terminal state when it exists, else a transition
// error naming the in-flight close.
func (s *Service) closeClaimLost(ctx context.Context, offeringID string) error {
	cur, err := s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return err
	}
	if cur.Status == OfferingFunded || cur.Status == OfferingRefunded || cur.Status == OfferingClosed {
		return fmt.Errorf("%w: offering already %s", ErrInvalidTransition, cur.Status)
	}
	return fmt.Errorf("%w: close already claimed by another checker", ErrInvalidTransition)
}

// thresholdMet reports whether a round reached its minimum and should allocate
// (true) versus refund all subscribers (false). Pure for unit testing.
func thresholdMet(raisedKobo, minThresholdKobo int64) bool {
	return raisedKobo >= minThresholdKobo
}

// allocate issues beneficial units to the cap table, marks the round Funded, and
// moves the asset to Funded. Escrowed funds remain in escrow as the asset's
// working capital (released to sponsor out-of-band / via distributions later).
// Each subscription flips escrowed→allocated and posts its cap-table units
// atomically, so a crash mid-allocation resumes without re-issuing units.
func (s *Service) allocate(ctx context.Context, checkerID string, o *Offering) (*Offering, error) {
	subs, err := s.repo.ListSubscriptionsByOffering(ctx, o.ID, SubEscrowed)
	if err != nil {
		return nil, err
	}
	for _, sub := range subs {
		certKey := fmt.Sprintf("fractionalre/certs/%s/%s.pdf", o.AssetID, sub.UserID)
		entry := &CapTableEntry{
			AssetID:    o.AssetID,
			OfferingID: &o.ID,
			UserID:     sub.UserID,
			Units:      sub.Units,
			CostKobo:   sub.AmountKobo,
			Source:     "primary",
			CertRef:    &certKey,
		}
		doc := &Document{
			AssetID:    &o.AssetID,
			OfferingID: &o.ID,
			UserID:     &sub.UserID,
			DocType:    "certificate",
			ObjectKey:  certKey,
		}
		if _, err := s.repo.AllocateSubscription(ctx, &sub, entry, doc); err != nil {
			return nil, fmt.Errorf("fractionalre: allocate subscription %s: %w", sub.ID, err)
		}
		s.notify(ctx, sub.UserID, "Units allocated", "Your beneficial units have been issued. Your certificate is available.")
	}
	if err := s.repo.RecomputeCapTablePct(ctx, o.AssetID); err != nil {
		return nil, err
	}
	if err := s.repo.SetClose(ctx, o.ID, ptr.Deref(o.CloseProposedBy, ""), checkerID, OfferingFunded); err != nil {
		return nil, err
	}
	_ = s.repo.UpdateAssetStatus(ctx, o.AssetID, AssetFunded)
	_ = s.audit.log(ctx, checkerID, "offering.close.allocate", "offering", o.ID, "threshold met",
		map[string]string{keyMaker: ptr.Deref(o.CloseProposedBy, "")}, map[string]any{"raised_kobo": o.RaisedKobo})
	o.Status = OfferingFunded
	return o, nil
}

// refundAll reverses every escrowed subscription back to the investor wallet via
// settlement.Refund (idempotent), marks the round Refunded and the asset
// Refund&Close. Reuses the shared settlement refund primitive — no direct ledger
// mutation here. The caller claims the close under 'refunding' first, so a
// funded round can never reach this path and a second checker cannot race it.
func (s *Service) refundAll(ctx context.Context, checkerID string, o *Offering) (*Offering, error) {
	if claimed, err := s.repo.ClaimClose(ctx, o.ID, checkerID, OfferingRefunding); err != nil {
		return nil, err
	} else if !claimed {
		return nil, s.closeClaimLost(ctx, o.ID)
	}
	subs, err := s.repo.ListSubscriptionsByOffering(ctx, o.ID, SubEscrowed)
	if err != nil {
		return nil, err
	}
	for _, sub := range subs {
		if sub.SettlementID == nil {
			continue
		}
		if err := s.settlement.Refund(ctx, *sub.SettlementID, "round threshold not met"); err != nil {
			// Leave the round in 'refunding'; a retry will pick up the rest. Do not
			// flip a subscription to refunded unless its escrow actually reversed.
			return nil, fmt.Errorf("fractionalre: refund settlement %s: %w", *sub.SettlementID, err)
		}
		_ = s.repo.UpdateSubscriptionStatus(ctx, sub.ID, SubRefunded)
		s.notify(ctx, sub.UserID, "Investment refunded", "The round did not reach its minimum; your funds were returned to your wallet.")
	}
	if err := s.repo.SetClose(ctx, o.ID, ptr.Deref(o.CloseProposedBy, ""), checkerID, OfferingRefunded); err != nil {
		return nil, err
	}
	_ = s.repo.RecomputeOfferingProjections(ctx, o.ID)
	_ = s.repo.UpdateAssetStatus(ctx, o.AssetID, AssetRefundClose)
	_ = s.audit.log(ctx, checkerID, "offering.close.refund", "offering", o.ID, "threshold not met",
		map[string]string{keyMaker: ptr.Deref(o.CloseProposedBy, "")}, map[string]any{"raised_kobo": o.RaisedKobo})
	o.Status = OfferingRefunded
	return o, nil
}

// RefundRound is the admin finance escape hatch (maker-checker enforced upstream
// by ProposeClose). It reuses refundAll for an open/closing round; a funded or
// already-refunded round refuses — a claimed close can only be resumed by the
// checker who owns it.
func (s *Service) RefundRound(ctx context.Context, checkerID, offeringID string) (*Offering, error) {
	o, err := s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return nil, err
	}
	if o.CloseProposedBy != nil && *o.CloseProposedBy == checkerID {
		return nil, ErrMakerChecker
	}
	if o.Status == OfferingFunded || o.Status == OfferingClosed {
		return nil, fmt.Errorf("%w: offering already %s", ErrInvalidTransition, o.Status)
	}
	if o.Status == OfferingRefunded {
		return o, nil // converged — a previous refund already completed
	}
	return s.refundAll(ctx, checkerID, o)
}

// isUniqueViolation reports a Postgres unique_violation (SQLSTATE 23505) without
// importing pgconn directly at call sites. Deliberately a message scan, not
// dbutil.IsUniqueViolation: callers here can wrap the driver error such that
// the SQLState interface is lost while the code remains in the message.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "23505")
}

// fetchReplay is the shared idempotent-replay gate used by every keyed money /
// mutation path (Subscribe, BuyFraction, ListFraction). It resolves the row a
// key previously produced: (row, true) on a replay, (nil, false) when the key
// is fresh, or the underlying error when the lookup itself failed (fail-closed
// — never proceed to move money on an indeterminate replay check).
func fetchReplay[T any](get func() (*T, error)) (*T, bool, error) {
	existing, err := get()
	if err == nil {
		return existing, true, nil
	}
	if errors.Is(err, ErrNotFound) {
		return nil, false, nil
	}
	return nil, false, err
}
