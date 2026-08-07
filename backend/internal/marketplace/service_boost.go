package marketplace

import (
	"context"
	"errors"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// service_boost.go implements the §2.4 Boost FSM: wallet-direct charge on purchase
// (no separate ad-balance) and an automatic refund on admin/system reject.
//
// Ledger refs / idem keys:
//   - charge : ref "mkt:boost:<id>:charge" idem "mkt:boost:<id>:charge"
//   - refund : ref "mkt:boost:<id>:refund" idem "mkt:boost:<id>:refund"
// The boost charge is a wallet debit → ledger.AccountCommission (ad revenue). The
// auto-refund reverses it back to the seller wallet.

// ListBoostTiers returns the boost catalog (§3.3 GET /boosts/tiers).
func (s *Service) ListBoostTiers() []BoostTier { return BoostTiers }

// GetBoost returns a boost (OLA enforced in the handler for member reads).
func (s *Service) GetBoost(ctx context.Context, id string) (*Boost, error) {
	return s.repo.GetBoost(ctx, id)
}

// PurchaseBoost charges the seller wallet directly (§2.4 purchase) and creates an
// ACTIVE boost (purchase auto-activates). Guards:
//   - caller owns the listing
//   - tier is a known catalog entry
//   - wallet balance ≥ price (ledger Debit fail-closed)
//
// Idempotent 24h on idemKey (Redis) + the deterministic ledger charge key.
func (s *Service) PurchaseBoost(ctx context.Context, sellerID, idemKey string, in CreateBoostInput) (*Boost, error) {
	if idemKey == "" {
		return nil, ErrIdemMissing
	}
	if sr, hit, _ := checkIdempotent(ctx, s.redis, idemKey); hit {
		return nil, replayError{Stored: sr}
	}
	tier, ok := lookupBoostTier(in.Tier)
	if !ok {
		return nil, newErr(400, CodeInvalidBoostTier, "unknown boost tier")
	}
	l, err := s.repo.GetListing(ctx, in.ListingID)
	if err != nil {
		return nil, err
	}
	if l.SellerID != sellerID {
		return nil, ErrForbidden
	}

	// Wallet-direct charge into the commission (ad-revenue) account. Fail-closed on
	// insufficient balance, idempotent on the deterministic charge key. Extracted into
	// postBoostCharge so the ledger effect has a DB-free unit test (service_boost_test.go).
	chargeRef, err := s.postBoostCharge(ctx, sellerID, in.ListingID, tier)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	ends := now.Add(time.Duration(tier.DurationDays) * 24 * time.Hour)
	b := &Boost{
		ListingID:       in.ListingID,
		SellerID:        sellerID,
		Tier:            tier.Tier,
		DurationDays:    tier.DurationDays,
		PriceKobo:       tier.PriceKobo,
		LedgerChargeRef: chargeRef,
		Status:          BoostActive, // §2.4 purchase auto-activates
		StartsAt:        &now,
		EndsAt:          &ends,
	}
	created, err := s.repo.InsertBoost(ctx, b)
	if err != nil {
		return nil, err
	}
	// Re-index so the boost actually affects ranking (§4 boost_weight). Only a live
	// listing is in search; a boost on a non-active listing takes effect when the
	// listing next goes active. searchPayload recomputes boost_weight from the now-
	// active boost.
	if l.Status == ListingActive {
		_ = s.repo.InsertOutbox(ctx, nil, in.ListingID, OutboxUpsert, s.searchPayload(ctx, l))
	}

	// Record realized Spotlight profit into the central Commission & Profit registry.
	// This is the marketplace's live revenue-capture point (the escrow order-settlement
	// path was retired in ADR-023; the boost purchase is the realized ad/commission
	// revenue). Best-effort + idempotent (boost id doubles as source ref + idempotency
	// key): a recorder failure is logged and swallowed — it must NEVER fail or reverse
	// the boost the seller already paid for. The recorder is wired WITHOUT a ledger, so
	// this records the earning row only and never re-posts the wallet charge above.
	sellerRef := sellerID
	// Boost is a 100%-platform ad sale (not a marketplace order), so it resolves the
	// dedicated 'boost' subtype config (100% platform charge) rather than the generic
	// Lifestyle/Marketplace 10% take-rate. Falls back to service-level if unseeded.
	s.recordCommissionSafe(ctx, "Lifestyle", "Marketplace", "boost", created.PriceKobo, created.ID, &sellerRef)

	saveIdempotent(ctx, s.redis, idemKey, 201, created)
	s.notifySafe(ctx, sellerID, "mkt.boost.active", "Your boost is live.")
	return created, nil
}

// CompleteDueBoosts is the §2.4 cron helper: active boosts whose ends_at has passed
// transition active → completed, and each affected listing is re-indexed so its
// boost_weight drops. Returns the number completed.
func (s *Service) CompleteDueBoosts(ctx context.Context) (int, error) {
	listingIDs, err := s.repo.CompleteDueBoosts(ctx, time.Now(), 500)
	if err != nil {
		return 0, err
	}
	// Re-index each affected listing so search recomputes boost_weight (now lower/zero).
	for _, lid := range listingIDs {
		if l, gerr := s.repo.GetListing(ctx, lid); gerr == nil && l.Status == ListingActive {
			_ = s.repo.InsertOutbox(ctx, nil, lid, OutboxUpsert, s.searchPayload(ctx, l))
		}
	}
	return len(listingIDs), nil
}

// RejectBoost (admin/system) rejects an active/purchased boost for a policy
// violation and AUTO-REFUNDS in the same flow (§2.4 reject → rejected_with_reason →
// auto_refunded). reason_code MANDATORY.
func (s *Service) RejectBoost(ctx context.Context, adminID, boostID, reasonCode string) (*Boost, error) {
	if err := requireReason(reasonCode); err != nil {
		return nil, err
	}
	b, err := s.repo.GetBoost(ctx, boostID)
	if err != nil {
		return nil, err
	}
	if err := guardBoostTransition(b.Status, BoostRejectedWithReason); err != nil {
		return nil, err
	}
	from := b.Status
	if err := s.repo.SetBoostStatus(ctx, boostID, from, BoostRejectedWithReason, &reasonCode, nil); err != nil {
		return nil, err
	}

	// Automatic refund: reverse the wallet charge back to the seller. The refund_ref
	// is stamped on the row even for a zero-price boost (which never posts a reversal).
	refundRef := "mkt:boost:" + boostID + ":refund"
	if b.PriceKobo > 0 {
		if _, err := s.postBoostRefund(ctx, b.SellerID, boostID, b.PriceKobo); err != nil {
			return nil, err
		}
	}
	if err := s.repo.SetBoostStatus(ctx, boostID, BoostRejectedWithReason, BoostAutoRefunded, nil, &refundRef); err != nil {
		return nil, err
	}
	b.Status = BoostAutoRefunded
	b.RefundRef = &refundRef

	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.boost.reject", TargetType: "boost", TargetID: boostID, ReasonCode: reasonCode,
		BeforeState: map[string]any{"status": string(from)},
		AfterState:  map[string]any{"status": string(BoostAutoRefunded), "reason_code": reasonCode},
	})
	s.notifySafe(ctx, b.SellerID, "mkt.boost.refunded", "Your boost was rejected and refunded: "+reasonCode)
	return b, nil
}

// boostChargeKey is the deterministic wallet-charge idempotency key AND ledger
// reference for a boost purchase (§2.4). It is derived from seller+listing+tier —
// NOT the boost id, which does not exist until AFTER the charge — so a retried
// PurchaseBoost collides on the SAME key and can never double-charge the wallet.
func boostChargeKey(sellerID, listingID, tier string) string {
	return "mkt:boost:" + sellerID + ":" + listingID + ":" + tier + ":charge"
}

// boostRefundKey is the deterministic refund idempotency key + ledger reference for
// a boost auto-refund (§2.4). Keyed by boost id (which exists by refund time), so a
// retried reject reverses the charge exactly once.
func boostRefundKey(boostID string) string { return "mkt:boost:" + boostID + ":refund" }

// postBoostCharge debits the seller wallet by the tier price into the commission
// (ad-revenue) standing account — the marketplace's sole live revenue posting after
// ADR-023 retired escrow settlement. It is:
//   - FAIL-CLOSED: an insufficient balance maps to 402 INSUFFICIENT_WALLET_BALANCE
//     and no boost row is created by the caller.
//   - IDEMPOTENT: the deterministic charge key means a retry re-posts nothing; a
//     ledger.ErrDuplicate is tolerated (the caller still (re)records the boost row).
//
// Returns the deterministic charge reference the caller persists on the boost row.
// Split out from PurchaseBoost so this ledger effect is unit-testable without a DB
// (service_boost_test.go injects a fake boostLedger).
func (s *Service) postBoostCharge(ctx context.Context, sellerID, listingID string, tier BoostTier) (string, error) {
	commission, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return "", wrapInternal("commission account", err)
	}
	key := boostChargeKey(sellerID, listingID, tier.Tier)
	if derr := s.ledger.Debit(ctx, sellerID, key, key, commission.ID, tier.PriceKobo); derr != nil {
		switch {
		case errors.Is(derr, ledger.ErrInsufficientFunds):
			return "", newErr(402, CodeInsufficientWallet, "insufficient wallet balance for boost")
		case errors.Is(derr, ledger.ErrDuplicate):
			// already charged (retry) — safe to proceed to record the boost row
		default:
			return "", wrapInternal("boost charge", derr)
		}
	}
	return key, nil
}

// postBoostRefund reverses a boost's wallet charge back to the seller (§2.4 auto-
// refund on reject). It posts a balanced PostReversal (REVERSAL_DEBIT restoring the
// seller wallet, REVERSAL_CREDIT draining the commission account) and is idempotent
// on the deterministic refund key — a ledger.ErrDuplicate (retried reject) is a
// tolerated no-op. Returns the refund reference. Split out from RejectBoost for the
// same DB-free unit-test reason as postBoostCharge.
func (s *Service) postBoostRefund(ctx context.Context, sellerID, boostID string, priceKobo int64) (string, error) {
	refundRef := boostRefundKey(boostID)
	sellerWallet, werr := s.ledger.GetOrCreateUserWallet(ctx, sellerID)
	if werr != nil {
		return "", wrapInternal("seller wallet", werr)
	}
	commission, cerr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if cerr != nil {
		return "", wrapInternal("commission account", cerr)
	}
	if err := s.ledger.PostReversal(ctx, sellerWallet.ID, commission.ID, priceKobo, refundRef, refundRef); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return "", wrapInternal("boost auto-refund", err)
	}
	return refundRef, nil
}
