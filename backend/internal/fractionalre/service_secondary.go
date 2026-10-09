package fractionalre

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
)

// secondaryOrderStatus* are the fre_secondary_orders lifecycle values. The
// 'transferred' checkpoint exists so a crash between the unit leg and the
// settlement Settle is resumable: replay converges from wherever it stopped.
const (
	orderEscrowed    = "escrowed"
	orderTransferred = "transferred"
	orderSettled     = "settled"
	orderRefunded    = "refunded"
	orderCancelled   = "cancelled"
)

// ListFractionRequest lists units a holder owns for resale on the secondary
// market. The unit price is NAV-anchored: if the caller does not supply one, the
// asset's current NAV is used (NAV / total units approximation via NAV anchor).
type ListFractionRequest struct {
	AssetID       string `json:"asset_id" binding:"required"`
	Units         int64  `json:"units" binding:"required"`
	UnitPriceKobo int64  `json:"unit_price_kobo"`
}

// ListFraction creates a NAV-anchored secondary listing. The seller must own
// enough units. Units remain on the seller's cap-table row until a buy settles.
// The client's Idempotency-Key is scoped to this module + seller before it
// touches the UNIQUE index: the same scoped key replays the existing listing,
// and the same key on a different asset/units/price conflicts rather than
// aliasing the earlier listing.
func (s *Service) ListFraction(ctx context.Context, sellerID, idempotencyKey string, req ListFractionRequest) (*SecondaryListing, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyKey
	}
	key := scopedIdemKey(sellerID, idempotencyKey)
	if existing, replay, err := fetchReplay(func() (*SecondaryListing, error) {
		return s.repo.GetListingByKey(ctx, key)
	}); err != nil {
		return nil, err
	} else if replay {
		if listingConflicts(existing, req) {
			return nil, ErrIdempotencyConflict
		}
		return existing, nil
	}
	mc, err := s.repo.GetMarketControls(ctx)
	if err != nil {
		return nil, err
	}
	if !mc.TradingEnabled {
		return nil, ErrMarketHalted
	}
	if req.Units <= 0 {
		return nil, errors.New("fractionalre: units must be positive")
	}
	holding, err := s.repo.GetHolding(ctx, req.AssetID, sellerID)
	if err != nil {
		return nil, err
	}
	if holding.Units < req.Units {
		return nil, ErrInsufficientUnits
	}
	asset, err := s.repo.GetAsset(ctx, req.AssetID)
	if err != nil {
		return nil, err
	}
	unitPrice := req.UnitPriceKobo
	navAnchor := asset.NAVKobo
	if unitPrice <= 0 {
		// NAV-anchored default: derive a per-unit NAV from the holder's avg cost
		// when no live NAV per-unit is configured, else fall back to cost basis.
		if holding.Units > 0 && holding.CostKobo > 0 {
			unitPrice = holding.CostKobo / holding.Units
		}
		if unitPrice <= 0 {
			return nil, errors.New("fractionalre: unable to derive NAV-anchored unit price; supply unit_price_kobo")
		}
	}
	l := &SecondaryListing{
		AssetID:        req.AssetID,
		SellerID:       sellerID,
		Units:          req.Units,
		UnitPriceKobo:  unitPrice,
		NAVAtListKobo:  navAnchor,
		IdempotencyKey: &key,
	}
	if err := s.repo.InsertListing(ctx, l); err != nil {
		// Unique-violation on idempotency_key under a race → return the winner.
		if isUniqueViolation(err) {
			if existing, gerr := s.repo.GetListingByKey(ctx, key); gerr == nil {
				if listingConflicts(existing, req) {
					return nil, ErrIdempotencyConflict
				}
				return existing, nil
			}
		}
		return nil, err
	}
	_ = s.audit.log(ctx, sellerID, "secondary.list", "listing", l.ID, "", nil,
		map[string]any{"asset_id": req.AssetID, "units": req.Units, "unit_price_kobo": unitPrice})
	return l, nil
}

// listingConflicts reports whether a replayed listing key was consumed by a
// different request payload. A caller-supplied price is compared exactly; a
// NAV-derived price is not (it is recomputed from the holding at call time).
func listingConflicts(existing *SecondaryListing, req ListFractionRequest) bool {
	if existing.AssetID != req.AssetID || existing.Units != req.Units {
		return true
	}
	if req.UnitPriceKobo > 0 && existing.UnitPriceKobo != req.UnitPriceKobo {
		return true
	}
	return false
}

func (s *Service) ListActiveListings(ctx context.Context, limit, offset int) ([]SecondaryListing, error) {
	return s.repo.ListActiveListings(ctx, limit, offset)
}

// BuyFractionRequest buys units from an active secondary listing.
type BuyFractionRequest struct {
	Units int64 `json:"units" binding:"required"`
}

// BuyFraction is a MONEY PATH on the secondary market. Order of operations
// (every iron rule, fail-closed before money):
//  1. Idempotency-Key required, scoped to "fractionalre:<buyer>:<key>"; a same-
//     payload replay RESUMES the order (a crash between escrow, unit transfer
//     and settle converges instead of stranding a half-finished trade) and a
//     different listing/units under the same key conflicts.
//  2. Market not halted; listing active with enough units.
//  3. Buyer 10%-income cap check (compliance engine reused server-side).
//  4. Buyer tier wallet-debit limit (reused finance primitive).
//  5. settlement.Escrow debits buyer wallet → escrow (re-validated: total must
//     match this request's amount and the row must still be escrowed).
//  6. Unit transfer seller→buyer + listing decrement + order flip to
//     'transferred', all in one tx (CompleteSecondaryTransfer).
//  7. settlement.Settle releases escrow → seller (net) + platform revenue
//     (fixed fee leg) and flips the settlement row to 'settled' in the same tx.
//  8. Order marked 'settled'; audit.
func (s *Service) BuyFraction(ctx context.Context, buyerID, idempotencyKey, listingID string, req BuyFractionRequest) (*SecondaryOrder, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyKey
	}
	key := scopedIdemKey(buyerID, idempotencyKey)
	if existing, replay, err := fetchReplay(func() (*SecondaryOrder, error) {
		return s.repo.GetSecondaryOrderByKey(ctx, key)
	}); err != nil {
		return nil, err
	} else if replay {
		if existing.ListingID != listingID || existing.Units != req.Units {
			return nil, ErrIdempotencyConflict
		}
		// Same payload: converge — finish a half-completed buy or return the
		// terminal order untouched.
		return s.resumeSecondaryOrder(ctx, existing)
	}
	if req.Units <= 0 {
		return nil, errors.New("fractionalre: units must be positive")
	}

	mc, err := s.repo.GetMarketControls(ctx)
	if err != nil {
		return nil, err
	}
	if !mc.TradingEnabled {
		return nil, ErrMarketHalted
	}

	l, err := s.repo.GetListing(ctx, listingID)
	if err != nil {
		return nil, err
	}
	if l.Status != "active" || l.UnitsRemaining < req.Units {
		return nil, ErrInsufficientUnits
	}
	if l.SellerID == buyerID {
		return nil, errors.New("fractionalre: cannot buy your own listing")
	}

	amountKobo, err := mulKobo(req.Units, l.UnitPriceKobo)
	if err != nil {
		return nil, err
	}
	feeKobo, err := mulDivKobo(amountKobo, int64(mc.FeeBps), 10000)
	if err != nil {
		return nil, err
	}

	// 3. Compliance cap (fail-closed hard block). Secondary buys count toward YTD.
	if err := s.enforceLimit(ctx, buyerID, amountKobo); err != nil {
		return nil, err
	}
	// 4. Tier wallet-debit limit (fail-closed).
	if err := s.tiers.EnforceWalletDebitLimit(ctx, buyerID, amountKobo); err != nil {
		return nil, err
	}

	// 5. Escrow buyer funds under the SCOPED key.
	ref := fmt.Sprintf("fre-secondary:%s:%s", listingID, buyerID)
	sett, err := s.settlement.Escrow(ctx, buyerID, ref, key, moduleType, amountKobo)
	if err != nil {
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return nil, ledger.ErrInsufficientFunds
		}
		return nil, fmt.Errorf("fractionalre: secondary escrow: %w", err)
	}
	// Same contract as Subscribe: the row under our scoped key is ours alone,
	// but its recorded total must equal this request's amount and it must still
	// be escrowed. A mismatched abandoned escrow is unwound before conflicting.
	if sett.TotalKobo != amountKobo || sett.Status != settlement.StatusEscrowed {
		if sett.Status == settlement.StatusEscrowed {
			_ = s.settlement.Refund(ctx, sett.ID, "idempotency-key replayed with a different payload")
		}
		return nil, ErrIdempotencyConflict
	}

	order := &SecondaryOrder{
		ListingID:      listingID,
		AssetID:        l.AssetID,
		BuyerID:        buyerID,
		SellerID:       l.SellerID,
		Units:          req.Units,
		AmountKobo:     amountKobo,
		FeeKobo:        feeKobo,
		Status:         orderEscrowed,
		SettlementID:   &sett.ID,
		IdempotencyKey: key,
	}
	if err := s.repo.InsertSecondaryOrder(ctx, order); err != nil {
		if isUniqueViolation(err) {
			if existing, gerr := s.repo.GetSecondaryOrderByKey(ctx, key); gerr == nil {
				if existing.ListingID != listingID || existing.Units != req.Units {
					return nil, ErrIdempotencyConflict
				}
				return s.resumeSecondaryOrder(ctx, existing)
			}
			// A live order owns the escrow but we cannot resolve it — leave the
			// escrow parked rather than refund under a row that may reference it.
			return nil, fmt.Errorf("fractionalre: order key collided but winner lookup failed: %w", err)
		}
		if rerr := s.settlement.Refund(ctx, sett.ID, "order insert failed after escrow"); rerr != nil {
			return nil, fmt.Errorf("fractionalre: insert failed (%w) and escrow unwind failed: %w", err, rerr)
		}
		return nil, err
	}

	// 6+7. Transfer units then settle — the same convergent path a replay takes.
	finished, err := s.resumeSecondaryOrder(ctx, order)
	if err != nil {
		return nil, err
	}
	order = finished

	// Cache YTD for the buyer.
	if ytd, err := s.repo.SumYTDInvested(ctx, buyerID, s.now().UTC().Year()); err == nil {
		_ = s.repo.CacheYTD(ctx, buyerID, s.now().UTC().Year(), ytd)
	}

	// 8. Audit.
	_ = s.audit.log(ctx, buyerID, "secondary.buy", "order", order.ID, "", nil,
		map[string]any{"listing_id": listingID, "units": req.Units, "amount_kobo": amountKobo, "fee_kobo": feeKobo})
	s.notify(ctx, l.SellerID, "Units sold", "Your fractional units were sold on the secondary market.")
	s.notify(ctx, buyerID, "Units purchased", "Your fractional units have been added to your portfolio.")
	return order, nil
}

// resumeSecondaryOrder converges a secondary buy to its terminal 'settled'
// state. It is the single path taken by a fresh buy AND by a replay/crash
// resume: each step is guarded (the order row is locked FOR UPDATE and only
// flips from 'escrowed'; settlement.Settle posts its legs and the status flip
// atomically and refuses on an already-settled row, which a concurrent
// resumer treats as converged). Terminal orders return untouched.
func (s *Service) resumeSecondaryOrder(ctx context.Context, o *SecondaryOrder) (*SecondaryOrder, error) {
	switch o.Status {
	case orderSettled, orderRefunded, orderCancelled:
		return o, nil
	}
	if o.Status == orderEscrowed {
		if _, err := s.repo.CompleteSecondaryTransfer(ctx, o); err != nil {
			return nil, err
		}
		o.Status = orderTransferred
	}
	if o.Status == orderTransferred {
		if o.SettlementID == nil {
			return nil, fmt.Errorf("fractionalre: order %s has no settlement to settle", o.ID)
		}
		if err := s.settleSecondary(ctx, *o.SettlementID, o.SellerID, o.FeeKobo); err != nil {
			return nil, err
		}
		if err := s.repo.SetOrderStatus(ctx, o.ID, orderSettled); err != nil {
			return nil, err
		}
		o.Status = orderSettled
	}
	_ = s.repo.RecomputeCapTablePct(ctx, o.AssetID)
	return o, nil
}

// settleSecondary releases escrow to the seller net of the platform fee via the
// shared settlement primitive: Settle posts the provider (seller) and platform
// legs as balanced pairs and flips the settlement row to 'settled' in one tx.
// The fee is expressed as the fixed ServiceFeeKobo leg, so no float percentage
// is involved in the arithmetic. A settle that lost the row-lock race to
// another resumer converges by observing the row already 'settled'.
func (s *Service) settleSecondary(ctx context.Context, settlementID, sellerID string, feeKobo int64) error {
	sett, err := s.settlement.GetByID(ctx, settlementID)
	if err != nil {
		return err
	}
	switch sett.Status {
	case settlement.StatusSettled:
		return nil // a previous attempt already finished — converged
	case settlement.StatusEscrowed:
		// proceeds to Settle below
	case settlement.StatusReleasing, settlement.StatusDisputed, settlement.StatusRefunded:
		return fmt.Errorf("fractionalre: settlement %s in unexpected status %s", sett.ID, sett.Status)
	}
	err = s.settlement.Settle(ctx, settlementID, settlement.Split{
		ProviderID:     sellerID,
		ProviderPct:    1.0,
		PlatformPct:    0.0,
		ServiceFeeKobo: feeKobo,
	})
	if err != nil {
		// A concurrent resumer can flip the row to 'settled' between our
		// pre-check and Settle's FOR UPDATE — converge instead of erroring.
		if cur, gerr := s.settlement.GetByID(ctx, settlementID); gerr == nil && cur.Status == settlement.StatusSettled {
			return nil
		}
		return fmt.Errorf("fractionalre: settle secondary: %w", err)
	}
	return nil
}

func (s *Service) ListOrdersForUser(ctx context.Context, userID string, limit, offset int) ([]SecondaryOrder, error) {
	return s.repo.ListOrdersForUser(ctx, userID, limit, offset)
}

func (s *Service) GetMarketControls(ctx context.Context) (*MarketControls, error) {
	return s.repo.GetMarketControls(ctx)
}

func (s *Service) UpdateMarketControls(ctx context.Context, adminID string, enabled bool, feeBps int) error {
	// fee_bps is a fraction of the trade amount in basis points: 10000 = 100%.
	// Anything above silently makes the platform leg exceed the escrowed total
	// (ComputeLegs then refuses at settle time — after the buyer already paid).
	if feeBps < 0 || feeBps > 10000 {
		return fmt.Errorf("%w: fee_bps must be between 0 and 10000", ErrValidation)
	}
	if err := s.repo.UpdateMarketControls(ctx, enabled, feeBps, adminID); err != nil {
		return err
	}
	_ = s.audit.log(ctx, adminID, "market.controls", "market", "1", "",
		nil, map[string]any{"trading_enabled": enabled, "fee_bps": feeBps})
	return nil
}

func (s *Service) HaltListing(ctx context.Context, adminID, listingID, reason string) error {
	if err := s.repo.SetListingStatus(ctx, listingID, "halted", reason); err != nil {
		return err
	}
	_ = s.audit.log(ctx, adminID, "secondary.halt", "listing", listingID, reason, nil, nil)
	return nil
}
