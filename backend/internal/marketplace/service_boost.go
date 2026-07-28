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

	commission, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
	if err != nil {
		return nil, wrapInternal("commission account", err)
	}

	// We need the boost id for a deterministic charge ref, but the id is generated on
	// insert. Use a listing+idem-scoped charge key so the wallet debit is idempotent
	// even before the row exists, then persist the ref on the created row.
	chargeIdem := "mkt:boost:" + sellerID + ":" + in.ListingID + ":" + in.Tier + ":charge"
	chargeRef := chargeIdem
	if err := s.ledger.Debit(ctx, sellerID, chargeRef, chargeIdem, commission.ID, tier.PriceKobo); err != nil {
		switch {
		case errors.Is(err, ledger.ErrInsufficientFunds):
			return nil, newErr(402, CodeInsufficientWallet, "insufficient wallet balance for boost")
		case errors.Is(err, ledger.ErrDuplicate):
			// already charged (retry) — proceed to record the boost row
		default:
			return nil, wrapInternal("boost charge", err)
		}
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

	// Automatic refund: reverse the wallet charge back to the seller.
	refundRef := "mkt:boost:" + boostID + ":refund"
	if b.PriceKobo > 0 {
		sellerWallet, werr := s.ledger.GetOrCreateUserWallet(ctx, b.SellerID)
		if werr != nil {
			return nil, wrapInternal("seller wallet", werr)
		}
		commission, cerr := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountCommission)
		if cerr != nil {
			return nil, wrapInternal("commission account", cerr)
		}
		if err := s.ledger.PostReversal(ctx, sellerWallet.ID, commission.ID, b.PriceKobo, refundRef, refundRef); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return nil, wrapInternal("boost auto-refund", err)
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
