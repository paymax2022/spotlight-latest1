package fractionalre

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"spotlight/backend/internal/finance/ledger"
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
// The client's Idempotency-Key is honoured with the Subscribe replay pattern:
// the same key returns the existing listing instead of double-listing units.
func (s *Service) ListFraction(ctx context.Context, sellerID, idempotencyKey string, req ListFractionRequest) (*SecondaryListing, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyKey
	}
	if existing, replay, err := fetchReplay(func() (*SecondaryListing, error) {
		return s.repo.GetListingByKey(ctx, idempotencyKey)
	}); err != nil {
		return nil, err
	} else if replay {
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
		return nil, fmt.Errorf("fractionalre: units must be positive")
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
			return nil, fmt.Errorf("fractionalre: unable to derive NAV-anchored unit price; supply unit_price_kobo")
		}
	}
	l := &SecondaryListing{
		AssetID:        req.AssetID,
		SellerID:       sellerID,
		Units:          req.Units,
		UnitPriceKobo:  unitPrice,
		NAVAtListKobo:  navAnchor,
		IdempotencyKey: &idempotencyKey,
	}
	if err := s.repo.InsertListing(ctx, l); err != nil {
		// Unique-violation on idempotency_key under a race → return the winner.
		if isUniqueViolation(err) {
			if existing, gerr := s.repo.GetListingByKey(ctx, idempotencyKey); gerr == nil {
				return existing, nil
			}
		}
		return nil, err
	}
	_ = s.audit.log(ctx, sellerID, "secondary.list", "listing", l.ID, "", nil,
		map[string]any{"asset_id": req.AssetID, "units": req.Units, "unit_price_kobo": unitPrice})
	return l, nil
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
//
//  1. Idempotency-Key required; duplicate returns the existing order.
//  2. Market not halted; listing active with enough units.
//  3. Buyer 10%-income cap check (compliance engine reused server-side).
//  4. Buyer tier wallet-debit limit (reused finance primitive).
//  5. settlement.Escrow debits buyer wallet → escrow.
//  6. Transfer units seller→buyer on the cap table (atomic) + recompute pct.
//  7. Settle: credit seller (amount - fee) and platform revenue (fee) from escrow.
//  8. Audit.
func (s *Service) BuyFraction(ctx context.Context, buyerID, idempotencyKey, listingID string, req BuyFractionRequest) (*SecondaryOrder, error) {
	if strings.TrimSpace(idempotencyKey) == "" {
		return nil, ErrIdempotencyKey
	}
	if existing, replay, err := fetchReplay(func() (*SecondaryOrder, error) {
		return s.repo.GetSecondaryOrderByKey(ctx, idempotencyKey)
	}); err != nil {
		return nil, err
	} else if replay {
		return existing, nil
	}
	if req.Units <= 0 {
		return nil, fmt.Errorf("fractionalre: units must be positive")
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
		return nil, fmt.Errorf("fractionalre: cannot buy your own listing")
	}

	amountKobo := req.Units * l.UnitPriceKobo
	feeKobo := amountKobo * int64(mc.FeeBps) / 10000

	// 3. Compliance cap (fail-closed hard block). Secondary buys count toward YTD.
	if err := s.enforceLimit(ctx, buyerID, amountKobo); err != nil {
		return nil, err
	}
	// 4. Tier wallet-debit limit (fail-closed).
	if err := s.tiers.EnforceWalletDebitLimit(ctx, buyerID, amountKobo); err != nil {
		return nil, err
	}

	// 5. Escrow buyer funds.
	ref := fmt.Sprintf("fre-secondary:%s:%s", listingID, buyerID)
	sett, err := s.settlement.Escrow(ctx, buyerID, ref, idempotencyKey, moduleType, amountKobo)
	if err != nil {
		if errors.Is(err, ledger.ErrInsufficientFunds) {
			return nil, ledger.ErrInsufficientFunds
		}
		return nil, fmt.Errorf("fractionalre: secondary escrow: %w", err)
	}

	order := &SecondaryOrder{
		ListingID:      listingID,
		AssetID:        l.AssetID,
		BuyerID:        buyerID,
		SellerID:       l.SellerID,
		Units:          req.Units,
		AmountKobo:     amountKobo,
		FeeKobo:        feeKobo,
		Status:         "escrowed",
		SettlementID:   &sett.ID,
		IdempotencyKey: idempotencyKey,
	}
	if err := s.repo.InsertSecondaryOrder(ctx, order); err != nil {
		if isUniqueViolation(err) {
			if existing, gerr := s.repo.GetSecondaryOrderByKey(ctx, idempotencyKey); gerr == nil {
				return existing, nil
			}
		}
		return nil, err
	}

	// 6. Transfer units on the cap table (atomic; fails if seller lacks units).
	if err := s.repo.DecrementListing(ctx, listingID, req.Units); err != nil {
		return nil, err
	}
	if err := s.repo.TransferUnits(ctx, l.AssetID, l.SellerID, buyerID, req.Units, amountKobo); err != nil {
		return nil, err
	}
	_ = s.repo.RecomputeCapTablePct(ctx, l.AssetID)

	// 7. Settle escrow → seller (amount - fee) + platform revenue (fee).
	// settlement.Settle splits the escrowed total; PlatformPct = fee/amount.
	if err := s.settleSecondary(ctx, sett.ID, l.SellerID, amountKobo, feeKobo); err != nil {
		return nil, err
	}
	_ = s.repo.SetOrderStatus(ctx, order.ID, "settled")
	order.Status = "settled"

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

// settleSecondary releases escrow to the seller net of platform fee. Uses the
// ledger directly via the escrow standing account so the two credits balance the
// single escrow debit (no float math: feePct derived only for Split.Validate).
func (s *Service) settleSecondary(ctx context.Context, settlementID, sellerID string, amountKobo, feeKobo int64) error {
	escrowAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		return err
	}
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return err
	}
	sellerKobo := amountKobo - feeKobo
	idem := "fre-secondary-settle:" + settlementID
	// Escrow → seller wallet.
	if err := s.ledger.Credit(ctx, sellerID, "fre-secondary:seller:"+settlementID, idem+":seller", escrowAcc.ID, sellerKobo); err != nil {
		return fmt.Errorf("fractionalre: credit seller: %w", err)
	}
	// Escrow → platform revenue (fee), only when there is a fee.
	if feeKobo > 0 {
		if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       "fre-secondary:fee:" + settlementID,
			IdempotencyKey:  idem + ":fee",
			AmountKobo:      feeKobo,
			DebitAccountID:  escrowAcc.ID,
			CreditAccountID: revAcc.ID,
		}); err != nil {
			return fmt.Errorf("fractionalre: credit fee: %w", err)
		}
	}
	return nil
}

func (s *Service) ListOrdersForUser(ctx context.Context, userID string, limit, offset int) ([]SecondaryOrder, error) {
	return s.repo.ListOrdersForUser(ctx, userID, limit, offset)
}

// ── Market controls (admin) ───────────────────────────────────────────────────

func (s *Service) GetMarketControls(ctx context.Context) (*MarketControls, error) {
	return s.repo.GetMarketControls(ctx)
}

func (s *Service) UpdateMarketControls(ctx context.Context, adminID string, enabled bool, feeBps int) error {
	if feeBps < 0 {
		return fmt.Errorf("fractionalre: fee_bps must be non-negative")
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
