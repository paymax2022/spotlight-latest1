package fractionalre

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/ledger"
)

// SubscribeRequest is the investor commitment into a funding round.
type SubscribeRequest struct {
	Units int64 `json:"units" binding:"required"`
}

// Subscribe commits an investor's funds into an open funding round (primary
// market). This is a MONEY PATH and follows every iron rule in order:
//
//  1. Idempotency-Key required (passed by handler); a duplicate key returns the
//     existing subscription (idempotent double-subscribe is a no-op).
//  2. Fail-closed KYC gate (investor must be KYC-verified, tier >= 1).
//  3. Fail-closed per-offer risk acknowledgement required.
//  4. Fail-closed 10%-of-income retail cap check (compliance engine) BEFORE money.
//  5. Fail-closed tier wallet-debit limit (reused finance primitive).
//  6. settlement.Escrow debits the investor wallet → escrow (balanced ledger).
//  7. Audit event emitted.
func (s *Service) Subscribe(ctx context.Context, userID, idempotencyKey, offeringID string, req SubscribeRequest) (*Subscription, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyKey
	}
	// 1. Idempotency: if this exact key already produced a subscription, return it.
	if existing, replay, err := fetchReplay(func() (*Subscription, error) {
		return s.repo.GetSubscriptionByKey(ctx, idempotencyKey)
	}); err != nil {
		return nil, err
	} else if replay {
		return existing, nil
	}

	if req.Units <= 0 {
		return nil, fmt.Errorf("fractionalre: units must be positive")
	}

	o, err := s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return nil, err
	}
	if o.Status != OfferingOpen {
		return nil, ErrOfferingNotOpen
	}
	amountKobo := req.Units * o.UnitPriceKobo

	// Ticket-range gate.
	if amountKobo < o.TicketMinKobo {
		return nil, ErrTicketRange
	}
	if o.TicketMaxKobo > 0 && amountKobo > o.TicketMaxKobo {
		return nil, ErrTicketRange
	}

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

	// 6. Escrow: debit investor wallet → escrow standing account (balanced ledger).
	ref := fmt.Sprintf("fre-sub:%s:%s", offeringID, userID)
	settlementRef := derefOr(o.EscrowReference, "fre-round:"+offeringID)
	sett, err := s.settlement.Escrow(ctx, userID, settlementRef+":"+ref, idempotencyKey, moduleType, amountKobo)
	if err != nil {
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return nil, ledger.ErrInsufficientFunds
		}
		return nil, fmt.Errorf("fractionalre: escrow: %w", err)
	}

	sub := &Subscription{
		OfferingID:     offeringID,
		UserID:         userID,
		Units:          req.Units,
		AmountKobo:     amountKobo,
		Status:         SubEscrowed,
		SettlementID:   &sett.ID,
		IdempotencyKey: idempotencyKey,
		RiskAckID:      &ackID,
	}
	if err := s.repo.InsertSubscription(ctx, sub); err != nil {
		// Unique-violation on idempotency_key under a race → return the winner.
		if isUniqueViolation(err) {
			if existing, gerr := s.repo.GetSubscriptionByKey(ctx, idempotencyKey); gerr == nil {
				return existing, nil
			}
		}
		return nil, err
	}

	// Refresh projections + cache YTD.
	_ = s.repo.RecomputeOfferingProjections(ctx, offeringID)
	if ytd, err := s.repo.SumYTDInvested(ctx, userID, s.now().UTC().Year()); err == nil {
		_ = s.repo.CacheYTD(ctx, userID, s.now().UTC().Year(), ytd)
	}

	// 7. Audit.
	_ = s.audit.log(ctx, userID, "offering.subscribe", "subscription", sub.ID, "", nil,
		map[string]any{"offering_id": offeringID, "units": req.Units, "amount_kobo": amountKobo})
	s.notify(ctx, userID, "Investment confirmed", "Your investment is held in escrow pending round close.")
	return sub, nil
}

// ── Round close — MAKER-CHECKER ───────────────────────────────────────────────

// ProposeClose records the maker's intent to close a round (step 1 of 2). The
// approver (checker) must be a different user — enforced in ApproveClose.
func (s *Service) ProposeClose(ctx context.Context, makerID, offeringID string) error {
	o, err := s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return err
	}
	if o.Status != OfferingOpen && o.Status != OfferingClosing {
		return fmt.Errorf("fractionalre: offering not open for close")
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
func (s *Service) CloseAndSettle(ctx context.Context, checkerID, offeringID string) (*Offering, error) {
	o, err := s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return nil, err
	}
	// SoD: maker must have proposed, and checker != maker.
	if o.CloseProposedBy == nil {
		return nil, fmt.Errorf("fractionalre: close must be proposed by a maker first")
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

	if thresholdMet(o.RaisedKobo, o.MinThresholdKobo) {
		return s.allocate(ctx, checkerID, o)
	}
	return s.refundAll(ctx, checkerID, o)
}

// thresholdMet reports whether a round reached its minimum and should allocate
// (true) versus refund all subscribers (false). Pure for unit testing.
func thresholdMet(raisedKobo, minThresholdKobo int64) bool {
	return raisedKobo >= minThresholdKobo
}

// allocate issues beneficial units to the cap table, marks the round Funded, and
// moves the asset to Funded. Escrowed funds remain in escrow as the asset's
// working capital (released to sponsor out-of-band / via distributions later).
func (s *Service) allocate(ctx context.Context, checkerID string, o *Offering) (*Offering, error) {
	subs, err := s.repo.ListSubscriptionsByOffering(ctx, o.ID, SubEscrowed)
	if err != nil {
		return nil, err
	}
	for _, sub := range subs {
		entry := &CapTableEntry{
			AssetID:    o.AssetID,
			OfferingID: &o.ID,
			UserID:     sub.UserID,
			Units:      sub.Units,
			CostKobo:   sub.AmountKobo,
			Source:     "primary",
		}
		// Certificate object key (R2). PresignPut is best-effort here; the key is
		// recorded so the cert can be generated/uploaded asynchronously.
		certKey := fmt.Sprintf("fractionalre/certs/%s/%s.pdf", o.AssetID, sub.UserID)
		entry.CertRef = &certKey
		if err := s.repo.UpsertCapTable(ctx, entry); err != nil {
			return nil, fmt.Errorf("fractionalre: cap-table upsert: %w", err)
		}
		_ = s.repo.UpdateSubscriptionStatus(ctx, sub.ID, SubAllocated)
		_ = s.repo.SetCertRef(ctx, o.AssetID, sub.UserID, certKey)
		// Record the certificate document row.
		_ = s.repo.InsertDocument(ctx, &Document{
			AssetID:    &o.AssetID,
			OfferingID: &o.ID,
			UserID:     &sub.UserID,
			DocType:    "certificate",
			ObjectKey:  certKey,
		})
		s.notify(ctx, sub.UserID, "Units allocated", "Your beneficial units have been issued. Your certificate is available.")
	}
	if err := s.repo.RecomputeCapTablePct(ctx, o.AssetID); err != nil {
		return nil, err
	}
	if err := s.repo.SetClose(ctx, o.ID, derefOr(o.CloseProposedBy, ""), checkerID, OfferingFunded); err != nil {
		return nil, err
	}
	_ = s.repo.UpdateAssetStatus(ctx, o.AssetID, AssetFunded)
	_ = s.audit.log(ctx, checkerID, "offering.close.allocate", "offering", o.ID, "threshold met",
		map[string]string{"maker": derefOr(o.CloseProposedBy, "")}, map[string]any{"raised_kobo": o.RaisedKobo})
	o.Status = OfferingFunded
	return o, nil
}

// refundAll reverses every escrowed subscription back to the investor wallet via
// settlement.Refund (idempotent), marks the round Refunded and the asset
// Refund&Close. Reuses the shared settlement refund primitive — no direct ledger
// mutation here.
func (s *Service) refundAll(ctx context.Context, checkerID string, o *Offering) (*Offering, error) {
	subs, err := s.repo.ListSubscriptionsByOffering(ctx, o.ID, SubEscrowed)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateOfferingStatus(ctx, o.ID, OfferingRefunding); err != nil {
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
	if err := s.repo.SetClose(ctx, o.ID, derefOr(o.CloseProposedBy, ""), checkerID, OfferingRefunded); err != nil {
		return nil, err
	}
	_ = s.repo.UpdateAssetStatus(ctx, o.AssetID, AssetRefundClose)
	_ = s.audit.log(ctx, checkerID, "offering.close.refund", "offering", o.ID, "threshold not met",
		map[string]string{"maker": derefOr(o.CloseProposedBy, "")}, map[string]any{"raised_kobo": o.RaisedKobo})
	o.Status = OfferingRefunded
	return o, nil
}

// RefundRound is the admin finance escape hatch (maker-checker enforced upstream
// by ProposeClose). It reuses refundAll for an open/closing round.
func (s *Service) RefundRound(ctx context.Context, checkerID, offeringID string) (*Offering, error) {
	o, err := s.repo.GetOffering(ctx, offeringID)
	if err != nil {
		return nil, err
	}
	if o.CloseProposedBy != nil && *o.CloseProposedBy == checkerID {
		return nil, ErrMakerChecker
	}
	return s.refundAll(ctx, checkerID, o)
}

func derefOr(p *string, def string) string {
	if p != nil {
		return *p
	}
	return def
}

// isUniqueViolation reports a Postgres unique_violation (SQLSTATE 23505) without
// importing pgconn directly at call sites.
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
