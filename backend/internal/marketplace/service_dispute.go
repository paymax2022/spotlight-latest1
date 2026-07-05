package marketplace

import (
	"context"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// service_dispute.go implements the §2.3 Dispute FSM admin resolution, including the
// §6.3 dual-approval path for orders > ₦500k.

// GetDispute returns a dispute (party or admin). OLA is enforced by the handler
// layer for member reads; admin reads bypass ownership.
func (s *Service) GetDispute(ctx context.Context, id string) (*Dispute, error) {
	return s.repo.GetDispute(ctx, id)
}

// SubmitEvidence appends evidence to a dispute in the evidence window. OLA: caller
// must be a party to the underlying order.
func (s *Service) SubmitEvidence(ctx context.Context, actorID, disputeID, evType, urlOrText string) error {
	d, err := s.repo.GetDispute(ctx, disputeID)
	if err != nil {
		return err
	}
	o, err := s.repo.GetOrder(ctx, d.OrderID)
	if err != nil {
		return err
	}
	if actorID != o.BuyerID && actorID != o.SellerID {
		return ErrForbidden
	}
	return s.repo.InsertDisputeEvidence(ctx, disputeID, actorID, evType, urlOrText)
}

// AppealDispute reopens a closed dispute exactly once (§2.3 appeal): closed →
// appealed → under_review with requires_dual_approval forced true regardless of
// amount. OLA: a party to the order.
func (s *Service) AppealDispute(ctx context.Context, actorID, disputeID string) (*Dispute, error) {
	d, err := s.repo.GetDispute(ctx, disputeID)
	if err != nil {
		return nil, err
	}
	o, err := s.repo.GetOrder(ctx, d.OrderID)
	if err != nil {
		return nil, err
	}
	if actorID != o.BuyerID && actorID != o.SellerID {
		return nil, ErrForbidden
	}
	if err := guardDisputeTransition(d.Status, DisputeAppealed); err != nil {
		return nil, err
	}
	dual := true
	if err := s.repo.SetDisputeStatus(ctx, disputeID, DisputeClosed, DisputeAppealed, DisputePatch{RequiresDualApproval: &dual}); err != nil {
		return nil, err
	}
	// appealed → under_review (routes back to the admin workbench).
	_ = s.repo.SetDisputeStatus(ctx, disputeID, DisputeAppealed, DisputeUnderReview, DisputePatch{})
	d.Status = DisputeUnderReview
	d.RequiresDualApproval = true
	return d, nil
}

// ─── Admin: queue + decide + second-approval ─────────────────────────────────

// DisputeQueue returns the admin dispute workbench (optionally filtered by status).
func (s *Service) DisputeQueue(ctx context.Context, status string, limit, offset int) ([]Dispute, error) {
	return s.repo.DisputeQueue(ctx, status, limit, offset)
}

// DecideDispute records an admin decision (§2.3 decide). reason_code MANDATORY.
// For orders > ₦500k the decision is recorded as `decided` awaiting a SECOND
// approver (§6.3) and NO money moves yet — ApproveDispute executes it. For orders
// ≤ ₦500k the ledger tx executes immediately and the dispute goes decided → executed.
func (s *Service) DecideDispute(ctx context.Context, adminID, disputeID string, in DecideDisputeInput) (*Dispute, error) {
	if err := requireReason(in.ReasonCode); err != nil {
		return nil, err
	}
	if _, ok := disputeDecisionToOrderState(in.Decision); !ok {
		return nil, newErr(400, CodeValidation, "decision must be refund_buyer, release_seller, or split")
	}
	d, err := s.repo.GetDispute(ctx, disputeID)
	if err != nil {
		return nil, err
	}
	if d.Status != DisputeUnderReview {
		return nil, guardDisputeTransition(d.Status, DisputeDecided)
	}
	o, err := s.repo.GetOrder(ctx, d.OrderID)
	if err != nil {
		return nil, err
	}

	// Record the decision (decided). decided_by = this admin.
	patch := DisputePatch{
		Decision:      &in.Decision,
		DecisionNotes: strPtr(in.Notes),
		DecidedBy:     &adminID,
	}
	if err := s.repo.SetDisputeStatus(ctx, disputeID, DisputeUnderReview, DisputeDecided, patch); err != nil {
		return nil, err
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.dispute.decide", TargetType: "dispute", TargetID: disputeID, ReasonCode: in.ReasonCode,
		BeforeState: map[string]any{"status": string(DisputeUnderReview)},
		AfterState:  map[string]any{"status": string(DisputeDecided), "decision": in.Decision},
	})

	if d.RequiresDualApproval || o.AmountKobo > DualApprovalThresholdKobo {
		// Awaiting a second approver — return 202-semantics via a coded signal the
		// handler renders; NO money has moved.
		d.Status = DisputeDecided
		dcopy := in.Decision
		d.Decision = &dcopy
		return d, newErr(202, CodeAwaitingSecondApproval, "decision recorded; awaiting second approver")
	}

	// Single-approval path: execute immediately.
	return s.executeDispute(ctx, adminID, d, o, in)
}

// ApproveDispute is the §6.3 second-approval that executes a dual-approval decision.
// The second approver MUST differ from the first (decided_by). reason_code is not
// required again (the decision already carries one) but the approval is audited.
func (s *Service) ApproveDispute(ctx context.Context, adminID, disputeID string) (*Dispute, error) {
	d, err := s.repo.GetDispute(ctx, disputeID)
	if err != nil {
		return nil, err
	}
	if d.Status != DisputeDecided {
		return nil, newErr(422, CodeInvalidDisputeTransition, "dispute is not awaiting second approval")
	}
	if d.DecidedBy != nil && *d.DecidedBy == adminID {
		return nil, newErr(403, CodeSameApproverNotAllowed, "second approver must differ from the first")
	}
	if d.Decision == nil {
		return nil, newErr(422, CodeValidation, "dispute has no recorded decision")
	}
	o, err := s.repo.GetOrder(ctx, d.OrderID)
	if err != nil {
		return nil, err
	}
	// Record the second approver, then execute.
	_ = s.repo.SetDisputeStatus(ctx, disputeID, DisputeDecided, DisputeDecided, DisputePatch{SecondApproverID: &adminID})
	in := DecideDisputeInput{Decision: *d.Decision}
	if d.DecisionNotes != nil {
		in.Notes = *d.DecisionNotes
	}
	return s.executeDispute(ctx, adminID, d, o, in)
}

// executeDispute performs the money leg for a decided dispute and moves it decided →
// executed → closed, plus the order to its resolved terminal state. Every path is one
// balanced ledger posting (§2.2 invariant).
func (s *Service) executeDispute(ctx context.Context, adminID string, d *Dispute, o *Order, in DecideDisputeInput) (*Dispute, error) {
	orderTo, _ := disputeDecisionToOrderState(in.Decision)

	switch in.Decision {
	case DecisionRefundBuyer:
		if _, err := s.refundToBuyer(ctx, o, OrderRefunded, "dispute_refund"); err != nil {
			return nil, err
		}
	case DecisionReleaseSeller:
		if _, err := s.releaseToSeller(ctx, o, "dispute_release"); err != nil {
			return nil, err
		}
	case DecisionSplit:
		if err := s.splitSettle(ctx, o, in.SplitBuyerKobo); err != nil {
			return nil, err
		}
	}
	_ = orderTo // order state is set inside the money helpers / splitSettle

	// dispute decided → executed → closed.
	_ = s.repo.SetDisputeStatus(ctx, d.ID, DisputeDecided, DisputeExecuted, DisputePatch{})
	_ = s.repo.SetDisputeStatus(ctx, d.ID, DisputeExecuted, DisputeClosed, DisputePatch{})
	d.Status = DisputeClosed
	now := time.Now()
	d.ExecutedAt = &now

	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.dispute.execute", TargetType: "dispute", TargetID: d.ID,
		ReasonCode: orStr(in.ReasonCode, d.ReasonCode),
		AfterState: map[string]any{"status": string(DisputeClosed), "decision": in.Decision},
	})
	// Both parties are notified IDENTICALLY (§6.3: never asymmetric).
	msg := "Your dispute was resolved: " + in.Decision
	s.notifySafe(ctx, o.BuyerID, "mkt.dispute.resolved", msg)
	s.notifySafe(ctx, o.SellerID, "mkt.dispute.resolved", msg)
	return d, nil
}

// splitSettle posts TWO balanced ledger legs (§2.2 resolve_split): splitBuyer → buyer
// wallet, remainder → seller wallet; the platform fee is drained to commission so the
// escrow hold nets to zero. Moves the order disputed → split_settled.
func (s *Service) splitSettle(ctx context.Context, o *Order, splitBuyerKobo int64) error {
	if err := guardOrderTransition(o.Status, OrderSplitSettled); err != nil {
		return err
	}
	if splitBuyerKobo < 0 || splitBuyerKobo > o.AmountKobo {
		return newErr(400, CodeValidation, "split_buyer_kobo must be within [0, amount]")
	}
	escrow, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return wrapInternal("escrow account", err)
	}
	buyerWallet, err := s.ledger.GetOrCreateUserWallet(ctx, o.BuyerID)
	if err != nil {
		return wrapInternal("buyer wallet", err)
	}
	sellerWallet, err := s.ledger.GetOrCreateUserWallet(ctx, o.SellerID)
	if err != nil {
		return wrapInternal("seller wallet", err)
	}
	commission, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return wrapInternal("commission account", err)
	}

	sellerShare := o.AmountKobo - splitBuyerKobo
	feeTotal := o.EscrowFeeKobo + o.DeliveryFeeKobo

	// Leg A: escrow → buyer (refund portion).
	if splitBuyerKobo > 0 {
		if err := s.ledger.PostReversal(ctx, buyerWallet.ID, escrow.ID, splitBuyerKobo, s.ref(o.ID, "split_buyer"), s.idem(o.ID, "split_buyer")); err != nil && err != ledger.ErrDuplicate {
			return wrapInternal("split refund buyer", err)
		}
	}
	// Leg B: escrow → seller (release portion).
	if sellerShare > 0 {
		if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference: s.ref(o.ID, "split_seller"), IdempotencyKey: s.idem(o.ID, "split_seller"),
			AmountKobo: sellerShare, DebitAccountID: escrow.ID, CreditAccountID: sellerWallet.ID,
		}); err != nil && err != ledger.ErrDuplicate {
			return wrapInternal("split release seller", err)
		}
	}
	// Leg C: escrow → commission (fee).
	if feeTotal > 0 {
		if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference: s.ref(o.ID, "split_fee"), IdempotencyKey: s.idem(o.ID, "split_fee"),
			AmountKobo: feeTotal, DebitAccountID: escrow.ID, CreditAccountID: commission.ID,
		}); err != nil && err != ledger.ErrDuplicate {
			return wrapInternal("split fee", err)
		}
	}

	releaseRef := s.ref(o.ID, "split")
	if err := s.repo.SetOrderStatus(ctx, o.ID, OrderDisputed, OrderSplitSettled, OrderPatch{LedgerReleaseRef: &releaseRef}); err != nil {
		return err
	}
	return nil
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
