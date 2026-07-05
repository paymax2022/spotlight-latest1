package marketplace

import (
	"context"
	"errors"
	"fmt"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// service_order.go implements the §2.2 Escrow Order FSM — the critical path.
//
// Ledger accounts used (all reuse the existing finance ledger; NO second ledger):
//   - buyer wallet          : ledger user_wallet (GetOrCreateUserWallet(buyerID))
//   - seller wallet         : ledger user_wallet (GetOrCreateUserWallet(sellerID))
//   - escrow sub-account    : ledger standing account ledger.AccountEscrow
//   - platform commission   : ledger standing account ledger.AccountCommission
//
// Ledger references / idempotency keys (deterministic, replay-safe):
//   - fund    : ref "mkt:order:<id>:fund"    idem "mkt:order:<id>:fund"
//   - refund  : ref "mkt:order:<id>:refund"  idem "mkt:order:<id>:refund"
//   - release : ref "mkt:order:<id>:release" idem "mkt:order:<id>:release" (escrow→seller)
//   - fee     : same journal leg, idem "mkt:order:<id>:fee" (escrow→commission)
//
// INVARIANT (§2.2): every terminal state corresponds to exactly ONE balanced ledger
// posting. Funds never rest in escrow with no forward path.

// escrowFeeBps is the platform escrow fee in basis points (2% default; category
// commission can override per §1 mkt_categories.commission_bps — used at release).
const escrowFeeBps int64 = 200

// fundingWindow is the 30-min funding window (§2.2 fund_timeout / §3.1 expires_at).
const fundingWindow = 30 * time.Minute

// ─── CreateOrder (§2.2 create_order) ─────────────────────────────────────────

// CreateOrder creates an escrow order in `initiated`. Guards (§2.2):
//   - listing.status = active
//   - listing.escrow_eligible
//   - buyer.kyc_tier >= tier1
//   - not a self-purchase
//
// Idempotent on the buyer-supplied Idempotency-Key: a replay returns the original
// order (the DB UNIQUE on idempotency_key is the durable backstop).
func (s *Service) CreateOrder(ctx context.Context, buyerID string, idemKey string, in CreateOrderInput) (*Order, error) {
	if buyerID == "" {
		return nil, ErrUnauthenticated
	}
	if idemKey == "" {
		return nil, ErrIdemMissing
	}
	if in.DeliveryOption != "pickup" && in.DeliveryOption != "rider_delivery" {
		return nil, newErr(400, CodeInvalidDeliveryOption, "delivery_option must be pickup or rider_delivery")
	}

	// Fast replay via Redis cache (cheap common case).
	if sr, hit, _ := checkIdempotent(ctx, s.redis, idemKey); hit {
		return nil, replayError{Stored: sr}
	}

	l, err := s.repo.GetListing(ctx, in.ListingID)
	if err != nil {
		return nil, err
	}
	if l.Status != ListingActive {
		return nil, newErr(422, CodeListingNotActive, "listing is not active")
	}
	if !l.EscrowEligible {
		return nil, newErr(422, CodeListingNotEscrowElig, "this listing does not support escrow checkout")
	}
	if l.SellerID == buyerID {
		return nil, newErr(422, CodeSelfPurchaseNotAllowed, "you cannot buy your own listing")
	}
	tier, err := s.repo.GetBuyerKYCTier(ctx, buyerID)
	if err != nil {
		return nil, err
	}
	if kycRank(tier) < kycRank(KYCTier1Buy) {
		return nil, newErr(403, CodeBuyerKYCInsufficient, "buyer must be at least KYC tier1 to purchase")
	}

	amount := l.PriceKobo
	if in.OfferID != nil {
		off, err := s.repo.GetOffer(ctx, *in.OfferID)
		if err != nil {
			return nil, err
		}
		if off.Status == "accepted" {
			amount = off.OfferPriceKobo
		}
	}
	escrowFee := amount * escrowFeeBps / 10000
	deliveryFee := int64(0) // logistics quote is out-of-module; rider fee computed at dispatch

	o := &Order{
		MarketID:        orStr(l.MarketID, DefaultMarketID),
		ListingID:       l.ID,
		BuyerID:         buyerID,
		SellerID:        l.SellerID,
		OfferID:         in.OfferID,
		AmountKobo:      amount,
		EscrowFeeKobo:   escrowFee,
		DeliveryFeeKobo: deliveryFee,
		IdempotencyKey:  idemKey,
	}
	// §8 CreateOrder race: InsertOrderAtomic re-checks listing.status='active' and the
	// single-quantity invariant UNDER a SELECT … FOR UPDATE row lock, so two buyers
	// racing on the same listing cannot both create an order — the loser gets a clean
	// 422 LISTING_NOT_ACTIVE instead of a read-then-write TOCTOU.
	created, err := s.repo.InsertOrderAtomic(ctx, o)
	if err != nil {
		// A UNIQUE-violation on idempotency_key ⇒ a prior identical create; replay it.
		if errors.Is(err, ErrConflict) {
			if prior, perr := s.repo.GetOrderByIdempotencyKey(ctx, idemKey); perr == nil {
				return prior, nil
			}
		}
		// Race-loser (listing flipped / already claimed) ⇒ 422 LISTING_NOT_ACTIVE.
		if errors.Is(err, ErrListingNotActiveRace) {
			return nil, ErrListingNotActiveRace
		}
		return nil, err
	}
	saveIdempotent(ctx, s.redis, idemKey, 201, created)
	s.notifySafe(ctx, l.SellerID, "mkt.order.created", "You have a new escrow order awaiting funding.")
	return created, nil
}

// ─── FundOrder (§2.2 fund) ───────────────────────────────────────────────────

// FundOrder funds the order into escrow. Guards (§2.2):
//   - status = initiated
//   - not past the 30-min funding window
//   - buyer wallet balance >= amount+fee (ledger Debit enforces fail-closed)
//
// Money leg: ledger.Debit(buyer → AccountEscrow) for total (amount+escrowFee). The
// delivery fee, when present, is included in the escrow hold. Stores ledger_fund_ref
// and transitions initiated → funded. Idempotent 24h on idemKey (Redis) plus the
// deterministic ledger idempotency key (durable backstop).
func (s *Service) FundOrder(ctx context.Context, orderID, buyerID, idemKey string, in FundInput) (*Order, error) {
	if idemKey == "" {
		return nil, ErrIdemMissing
	}
	if sr, hit, _ := checkIdempotent(ctx, s.redis, idemKey); hit {
		return nil, replayError{Stored: sr}
	}
	o, err := s.repo.GetOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.BuyerID != buyerID {
		return nil, newErr(403, CodeNotOrderBuyer, "only the buyer may fund this order")
	}
	if o.Status == OrderFunded {
		// Idempotent replay of an already-funded order.
		saveIdempotent(ctx, s.redis, idemKey, 200, o)
		return o, nil
	}
	if o.Status != OrderInitiated {
		return nil, newErr(422, CodeOrderNotInitiated, "order is not in the initiated state")
	}
	if time.Since(o.CreatedAt) > fundingWindow {
		return nil, newErr(409, CodeOrderExpired, "funding window has elapsed")
	}
	if in.PaymentMethod == "" {
		in.PaymentMethod = "wallet"
	}

	escrow, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, wrapInternal("escrow account", err)
	}
	total := o.TotalPayableKobo()
	fundRef := s.ref(o.ID, "fund")
	// Debit buyer wallet → credit escrow standing account. Fail-closed on balance.
	if err := s.ledger.Debit(ctx, buyerID, fundRef, s.idem(o.ID, "fund"), escrow.ID, total); err != nil {
		switch {
		case errors.Is(err, ledger.ErrInsufficientFunds):
			return nil, newErr(402, CodeInsufficientWallet, "insufficient wallet balance")
		case errors.Is(err, ledger.ErrDuplicate):
			// The debit already happened (retry) — proceed to record funded state.
		default:
			return nil, wrapInternal("fund debit", err)
		}
	}

	patch := OrderPatch{LedgerFundRef: &fundRef}
	if err := s.repo.SetOrderStatus(ctx, o.ID, OrderInitiated, OrderFunded, patch); err != nil {
		return nil, err
	}
	o.Status = OrderFunded
	o.LedgerFundRef = &fundRef
	saveIdempotent(ctx, s.redis, idemKey, 200, o)
	s.notifySafe(ctx, o.SellerID, "mkt.order.funded", "An order has been funded — accept within 24h.")
	return o, nil
}

// ─── SellerAccept (§2.2 seller_accept) ───────────────────────────────────────

// SellerAccept moves funded → seller_accepted (dispatch request to logistics is a
// side effect handled out-of-module). OLA: caller must be the seller.
func (s *Service) SellerAccept(ctx context.Context, orderID, sellerID string) (*Order, error) {
	o, err := s.repo.GetOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.SellerID != sellerID {
		return nil, newErr(403, CodeNotOrderSeller, "only the seller may accept this order")
	}
	if err := guardOrderTransition(o.Status, OrderSellerAccepted); err != nil {
		return nil, err
	}
	if err := s.repo.SetOrderStatus(ctx, o.ID, OrderFunded, OrderSellerAccepted, OrderPatch{}); err != nil {
		return nil, err
	}
	o.Status = OrderSellerAccepted
	s.notifySafe(ctx, o.BuyerID, "mkt.order.accepted", "The seller accepted your order.")
	return o, nil
}

// ─── ConfirmDelivery (§2.2 buyer_confirm) ────────────────────────────────────

// ConfirmDelivery is the buyer-initiated escrow release. Guards (§2.2):
//   - status = inspection_window
//   - before inspection_deadline (else it already auto-released)
//
// Money leg (the release): escrow → seller wallet minus platform fee. Implemented as
// two balanced ledger postings that together drain the escrow hold exactly:
//  1. PostJournal escrow → seller wallet   for (amount − commission)   [release]
//  2. PostJournal escrow → commission acct for commission              [fee]
//
// The escrow fee held at funding + the delivery fee are recognized to platform
// revenue as part of the fee leg so escrow nets to zero for this order.
func (s *Service) ConfirmDelivery(ctx context.Context, orderID, buyerID string) (*Order, error) {
	o, err := s.repo.GetOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if o.BuyerID != buyerID {
		return nil, newErr(403, CodeNotOrderBuyer, "only the buyer may confirm delivery")
	}
	if o.Status != OrderInspectionWindow {
		return nil, newErr(422, CodeOrderNotInspection, "order is not in the inspection window")
	}
	if o.InspectionDeadline != nil && time.Now().After(*o.InspectionDeadline) {
		return nil, newErr(422, CodeInspectionDeadlinePast, "inspection deadline passed; order already auto-released")
	}
	return s.releaseToSeller(ctx, o, "buyer_confirm")
}

// ─── OpenDispute (§2.2 open_dispute / §2.3 open) ─────────────────────────────

// OpenDispute freezes auto-release and creates a dispute. Guards:
//   - status = inspection_window (§8: race with auto-release ⇒ 422 ORDER_NOT_DISPUTABLE)
//   - caller is a party to the order
//   - no dispute already open for the order
//
// Idempotent on idemKey. Sets requires_dual_approval when amount > ₦500k.
func (s *Service) OpenDispute(ctx context.Context, orderID, actorID, idemKey string, in DisputeInput) (*Dispute, error) {
	if idemKey == "" {
		return nil, ErrIdemMissing
	}
	if in.ReasonCode == "" {
		return nil, ErrReasonRequired
	}
	if sr, hit, _ := checkIdempotent(ctx, s.redis, idemKey); hit {
		return nil, replayError{Stored: sr}
	}
	o, err := s.repo.GetOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if actorID != o.BuyerID && actorID != o.SellerID {
		return nil, newErr(403, CodeNotOrderParty, "only a party to the order may open a dispute")
	}
	if o.Status != OrderInspectionWindow {
		return nil, newErr(422, CodeOrderNotDisputable, "order is no longer disputable")
	}
	if existing, derr := s.repo.OpenDisputeForOrder(ctx, orderID); derr == nil && existing != nil {
		return nil, newErr(409, CodeDisputeAlreadyOpen, "a dispute is already open for this order")
	}

	dispute := &Dispute{
		OrderID:              orderID,
		OpenedBy:             actorID,
		ReasonCode:           in.ReasonCode,
		RequiresDualApproval: o.AmountKobo > DualApprovalThresholdKobo,
		EvidenceDeadline:     time.Now().Add(EvidenceWindow),
	}
	created, err := s.repo.InsertDispute(ctx, dispute)
	if err != nil {
		return nil, err
	}
	// Move order inspection_window → disputed (freezes the auto-release clock).
	if err := s.repo.SetOrderStatus(ctx, o.ID, OrderInspectionWindow, OrderDisputed, OrderPatch{}); err != nil {
		return nil, err
	}
	// Attach any supplied evidence.
	for _, ev := range in.Evidence {
		_ = s.repo.InsertDisputeEvidence(ctx, created.ID, actorID, ev.Type, ev.URLOrText)
	}
	// Auto start_evidence_window (§2.3 opened → evidence_window).
	if err := s.repo.SetDisputeStatus(ctx, created.ID, DisputeOpened, DisputeEvidenceWindow, DisputePatch{}); err == nil {
		created.Status = DisputeEvidenceWindow
	}
	saveIdempotent(ctx, s.redis, idemKey, 201, created)
	s.notifySafe(ctx, o.BuyerID, "mkt.dispute.opened", "A dispute has been opened for your order.")
	s.notifySafe(ctx, o.SellerID, "mkt.dispute.opened", "A dispute has been opened for your order.")
	return created, nil
}

// ─── AutoReleaseDue (§2.2 auto_release; §6.2 cron path) ──────────────────────

// AutoReleaseDue is the cron helper: for each inspection_window order past its
// deadline with no open dispute, release escrow → seller (same money leg as buyer
// confirm) and insert a placeholder review. Returns the count released.
func (s *Service) AutoReleaseDue(ctx context.Context) (int, error) {
	due, err := s.repo.DueForAutoRelease(ctx, time.Now(), 200)
	if err != nil {
		return 0, err
	}
	n := 0
	for i := range due {
		o := due[i]
		if _, err := s.releaseToSeller(ctx, &o, "auto_release"); err != nil {
			// Best-effort per-order; a conflict means another worker won the race.
			continue
		}
		n++
	}
	return n, nil
}

// ─── shared release leg (buyer_confirm + auto_release + dispute resolve_release) ─

// releaseToSeller performs the balanced escrow→seller (minus fee) release and moves
// the order to `released`. It is the single implementation of the release money leg
// so buyer-confirm, auto-release, and a dispute release decision all post identically.
func (s *Service) releaseToSeller(ctx context.Context, o *Order, cause string) (*Order, error) {
	escrow, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, wrapInternal("escrow account", err)
	}
	sellerWallet, err := s.ledger.GetOrCreateUserWallet(ctx, o.SellerID)
	if err != nil {
		return nil, wrapInternal("seller wallet", err)
	}
	commission, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return nil, wrapInternal("commission account", err)
	}

	// Platform fee = escrow fee held at funding + delivery fee (recognized to
	// commission). Seller receives the item amount.
	feeTotal := o.EscrowFeeKobo + o.DeliveryFeeKobo
	sellerNet := o.AmountKobo

	releaseRef := s.ref(o.ID, "release")
	// Leg 1: escrow → seller wallet for the item amount.
	if sellerNet > 0 {
		if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       releaseRef,
			IdempotencyKey:  s.idem(o.ID, "release"),
			AmountKobo:      sellerNet,
			DebitAccountID:  escrow.ID,
			CreditAccountID: sellerWallet.ID,
		}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return nil, wrapInternal("release to seller", err)
		}
	}
	// Leg 2: escrow → commission for the platform fee (nets escrow to zero).
	if feeTotal > 0 {
		if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       s.ref(o.ID, "fee"),
			IdempotencyKey:  s.idem(o.ID, "fee"),
			AmountKobo:      feeTotal,
			DebitAccountID:  escrow.ID,
			CreditAccountID: commission.ID,
		}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return nil, wrapInternal("release fee", err)
		}
	}

	if err := s.repo.SetOrderStatus(ctx, o.ID, o.Status, OrderReleased, OrderPatch{LedgerReleaseRef: &releaseRef}); err != nil {
		return nil, err
	}
	o.Status = OrderReleased
	o.LedgerReleaseRef = &releaseRef

	// Direct Referral Rewards emit REMOVED in the listings-and-connect pivot (ADR-023):
	// there is no more escrow release to settle a reward against. This whole function
	// is now unreachable dead code (the order routes are unregistered).

	// Mark the listing sold via escrow (best-effort; §2.1 mark_sold_via_escrow) and
	// emit a search-delete outbox row.
	s.markListingSold(ctx, o.ListingID)
	// Insert a placeholder review if the buyer never submitted one (§6.2).
	_ = s.repo.InsertReview(ctx, &Review{OrderID: o.ID, ReviewerID: o.BuyerID, RevieweeID: o.SellerID, IsPlaceholder: true})

	s.notifySafe(ctx, o.SellerID, "mkt.order.released", "Funds have been released to your wallet.")
	return o, nil
}

// markListingSold flips an active listing → sold and writes a delete outbox row.
// Best-effort: a listing already in a terminal state is a no-op.
func (s *Service) markListingSold(ctx context.Context, listingID string) {
	l, err := s.repo.GetListing(ctx, listingID)
	if err != nil {
		return
	}
	if l.Status != ListingActive {
		return
	}
	if err := s.repo.SetListingStatus(ctx, listingID, ListingActive, ListingSold, nil); err == nil {
		_ = s.repo.InsertOutbox(ctx, nil, listingID, OutboxDelete, map[string]any{"listing_id": listingID})
	}
}

// ─── seller reject / fund-timeout refund (§2.2 seller_reject_or_timeout) ─────

// RefundToBuyer reverses the escrow hold back to the buyer wallet and moves the
// order to `cancelled` (funded→cancelled) or `refunded` (disputed→refunded). Used by
// seller-reject/timeout (cancelled) and dispute refund (refunded).
func (s *Service) refundToBuyer(ctx context.Context, o *Order, to OrderStatus, cause string) (*Order, error) {
	if err := guardOrderTransition(o.Status, to); err != nil {
		return nil, err
	}
	escrow, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return nil, wrapInternal("escrow account", err)
	}
	buyerWallet, err := s.ledger.GetOrCreateUserWallet(ctx, o.BuyerID)
	if err != nil {
		return nil, wrapInternal("buyer wallet", err)
	}
	refundRef := s.ref(o.ID, "refund")
	total := o.TotalPayableKobo()
	if total > 0 {
		// PostReversal restores the buyer wallet (+balance) and drains the escrow hold.
		if err := s.ledger.PostReversal(ctx, buyerWallet.ID, escrow.ID, total, refundRef, s.idem(o.ID, "refund")); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return nil, wrapInternal("refund to buyer", err)
		}
	}
	if err := s.repo.SetOrderStatus(ctx, o.ID, o.Status, to, OrderPatch{LedgerReleaseRef: &refundRef}); err != nil {
		return nil, err
	}
	o.Status = to

	// Direct Referral Rewards refund emit REMOVED in the listings-and-connect pivot
	// (ADR-023): no escrow settlement means no reward to reverse. Dead code path.

	s.notifySafe(ctx, o.BuyerID, "mkt.order.refunded", "Your escrow funds have been refunded.")
	return o, nil
}

// Referral emit helpers REMOVED in the listings-and-connect pivot (ADR-023).

// CancelOrder handles buyer/seller cancellation of a funded-but-not-delivered order
// (funded → cancelled with a refund) or an unfunded order (initiated → cancelled, no
// money moved). OLA: a party to the order.
func (s *Service) CancelOrder(ctx context.Context, orderID, actorID string) (*Order, error) {
	o, err := s.repo.GetOrder(ctx, orderID)
	if err != nil {
		return nil, err
	}
	if actorID != o.BuyerID && actorID != o.SellerID {
		return nil, newErr(403, CodeNotOrderParty, "only a party to the order may cancel it")
	}
	switch o.Status {
	case OrderInitiated:
		if err := s.repo.SetOrderStatus(ctx, o.ID, OrderInitiated, OrderCancelled, OrderPatch{}); err != nil {
			return nil, err
		}
		o.Status = OrderCancelled
		return o, nil
	case OrderFunded, OrderSellerAccepted:
		return s.refundToBuyer(ctx, o, OrderCancelled, "cancel")
	default:
		return nil, newErr(422, CodeOrderNotCancellable, "order can no longer be cancelled")
	}
}

// ─── deterministic ledger references / idempotency keys ──────────────────────

func (s *Service) ref(orderID, leg string) string {
	return fmt.Sprintf("mkt:order:%s:%s", orderID, leg)
}
func (s *Service) idem(orderID, leg string) string {
	return fmt.Sprintf("mkt:order:%s:%s", orderID, leg)
}
