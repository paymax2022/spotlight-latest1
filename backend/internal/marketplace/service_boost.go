package marketplace

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"spotlight/backend/internal/finance/ledger"
)

// minCustomBoostDays/maxCustomBoostDays bound a "custom" date-range boost.
// Min 1 prevents a same-minute end from pricing at ₦0; max 90 caps how much a
// single fat-fingered end date can charge a wallet (the largest preset
// package, "enterprise", is 60 days — 90 gives custom headroom above every
// preset without being unbounded).
const (
	minCustomBoostDays = 1
	maxCustomBoostDays = 90
)

// service_boost.go implements the §2.4 Boost FSM: wallet-direct charge on purchase
// (no separate ad-balance) and an automatic refund on admin/system reject.
//
// Ledger refs / idem keys:
//   - charge : ref "mkt:boost:<id>:charge" idem "mkt:boost:<id>:charge"
//   - refund : ref "mkt:boost:<id>:refund" idem "mkt:boost:<id>:refund"
// The boost charge is a wallet debit → ledger.AccountCommission (ad revenue). The
// auto-refund reverses it back to the seller wallet.

// ListBoostTiers returns the boost catalog (§3.3 GET /boosts/tiers) —
// admin-editable packages (ADM-002), active only (an admin-disabled package
// must disappear from what a buyer can pick, even though it stays in the
// admin console for re-enabling). Falls back to nothing gracefully; the
// migration seed guarantees the table is never actually empty.
func (s *Service) ListBoostTiers(ctx context.Context) ([]BoostTier, error) {
	pkgs, err := s.repo.ListBoostPackages(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]BoostTier, 0, len(pkgs))
	for _, p := range pkgs {
		if !p.IsActive {
			continue
		}
		out = append(out, BoostTier{Tier: p.Tier, DurationDays: p.DurationDays, PriceKobo: p.PriceKobo, Weight: p.Weight})
	}
	return out, nil
}

// GetBoost returns a boost (OLA enforced in the handler for member reads).
func (s *Service) GetBoost(ctx context.Context, id string) (*Boost, error) {
	return s.repo.GetBoost(ctx, id)
}

// ComputeBoostQuote is the SOLE pricing authority for a boost purchase — used
// by both the read-only GET /boosts/quote preview and PurchaseBoost itself, so
// a quote shown to a buyer and what they're actually charged can never drift.
// Never trusts a client-sent price.
//
// Package mode (tier set, and not "custom"): tier must name an ACTIVE row in
// mkt_boost_packages; price/duration/weight come from that row.
//
// Custom mode (tier empty or "custom", endsAt set): starts now (a boost always
// activates immediately on purchase — there is no scheduler to promote a
// future-dated "purchased" boost to "active" later), duration rounds UP to the
// next full day (a part-day still costs a full day — CLAUDE.md money rule:
// integers, never fractional kobo), price = days × the admin-set ₦/day rate
// (mkt_boost_daily_rate). Custom boosts get the base/"start" package's search
// weight (1.0) regardless of chosen duration — deliberately flat rather than a
// guessed formula, so a longer custom range cannot buy outsized search rank.
func (s *Service) ComputeBoostQuote(ctx context.Context, tier string, endsAt *time.Time) (*BoostQuote, error) {
	now := time.Now()

	if tier != "" && tier != "custom" {
		pkg, err := s.repo.GetBoostPackage(ctx, tier)
		if err != nil {
			return nil, err // ErrBoostPackageNotFound is already the right 400
		}
		if !pkg.IsActive {
			return nil, newErr(400, CodeInvalidBoostTier, "this boost package is no longer available")
		}
		ends := now.Add(time.Duration(pkg.DurationDays) * 24 * time.Hour)
		return &BoostQuote{
			Mode: "package", Tier: pkg.Tier, DurationDays: pkg.DurationDays,
			PriceKobo: pkg.PriceKobo, Weight: pkg.Weight, StartsAt: now, EndsAt: ends,
		}, nil
	}

	if endsAt == nil {
		return nil, fieldErr(CodeValidation, "tier or ends_at is required", "ends_at")
	}
	days, err := customBoostDuration(now, *endsAt)
	if err != nil {
		return nil, err
	}
	rate, err := s.repo.GetBoostDailyRate(ctx)
	if err != nil {
		return nil, err
	}
	return &BoostQuote{
		Mode: "custom", DurationDays: days, PriceKobo: int64(days) * rate.DailyRateKobo,
		Weight: baseBoostWeight, StartsAt: now, EndsAt: *endsAt,
	}, nil
}

// customBoostDuration validates a custom boost's [now, endsAt) range and
// returns its billed duration in whole days, rounded UP — a part-day still
// costs a full day (CLAUDE.md money rule: integers, never fractional kobo).
// Pure and DB-free so the rounding/bounds math has an executed unit test
// independent of ComputeBoostQuote's repo dependency (service_boost_test.go).
func customBoostDuration(now, endsAt time.Time) (int, error) {
	if !endsAt.After(now) {
		return 0, fieldErr(CodeInvalidBoostRange, "ends_at must be in the future", "ends_at")
	}
	days := int(math.Ceil(endsAt.Sub(now).Hours() / 24))
	if days < minCustomBoostDays {
		days = minCustomBoostDays
	}
	if days > maxCustomBoostDays {
		return 0, fieldErr(CodeInvalidBoostRange, fmt.Sprintf("a custom boost cannot exceed %d days", maxCustomBoostDays), "ends_at")
	}
	return days, nil
}

// baseBoostWeight is the flat search-rank weight a custom-range boost gets,
// matching the cheapest preset package ("start") — see ComputeBoostQuote.
const baseBoostWeight = 1.0

// boostChargeTierKey derives the string PurchaseBoost's postBoostCharge keys
// its idempotent charge on: the package tier verbatim (unchanged from before
// custom boosts existed, so already-issued idempotency keys keep meaning the
// same thing), or a deterministic per-request key for a custom range so two
// DIFFERENT custom purchases never collide while a RETRY of the same one does.
func boostChargeTierKey(q *BoostQuote) string {
	if q.Mode == "package" {
		return q.Tier
	}
	return "custom:" + q.EndsAt.UTC().Format(time.RFC3339)
}

// PurchaseBoost charges the seller wallet directly (§2.4 purchase) and creates an
// ACTIVE boost (purchase auto-activates). Guards:
//   - caller owns the listing
//   - tier/date-range resolves to a valid, priced quote (ComputeBoostQuote)
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
	quote, err := s.ComputeBoostQuote(ctx, in.Tier, in.EndsAt)
	if err != nil {
		return nil, err
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
	chargeTier := BoostTier{Tier: boostChargeTierKey(quote), DurationDays: quote.DurationDays, PriceKobo: quote.PriceKobo, Weight: quote.Weight}
	chargeRef, err := s.postBoostCharge(ctx, sellerID, in.ListingID, chargeTier)
	if err != nil {
		return nil, err
	}

	rowTier := quote.Tier
	if rowTier == "" {
		rowTier = "custom"
	}
	startsAt, endsAt := quote.StartsAt, quote.EndsAt
	b := &Boost{
		ListingID:       in.ListingID,
		SellerID:        sellerID,
		Tier:            rowTier,
		DurationDays:    quote.DurationDays,
		PriceKobo:       quote.PriceKobo,
		Weight:          quote.Weight,
		LedgerChargeRef: chargeRef,
		Status:          BoostActive, // §2.4 purchase auto-activates
		StartsAt:        &startsAt,
		EndsAt:          &endsAt,
	}
	created, err := s.repo.InsertBoost(ctx, b)
	if err != nil {
		return nil, err
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

// UpsertBoostPackage creates or edits a boost package's price/duration/weight/
// active state (ADM-002 admin pricing console). reason_code is MANDATORY and
// every change is audited — mirrors RejectBoost's audit shape. This is config,
// not a money movement: it never touches the ledger, and per the console's own
// disclosure only affects boosts purchased AFTER the change.
func (s *Service) UpsertBoostPackage(ctx context.Context, adminID string, in BoostPackage, reasonCode string) (*BoostPackage, error) {
	if err := requireReason(reasonCode); err != nil {
		return nil, err
	}
	before, _ := s.repo.GetBoostPackage(ctx, in.Tier) // nil (new package) is fine — BeforeState stays nil
	after, err := s.repo.UpsertBoostPackage(ctx, in, adminID)
	if err != nil {
		return nil, err
	}
	var beforeState map[string]any
	if before != nil {
		beforeState = map[string]any{"price_kobo": before.PriceKobo, "duration_days": before.DurationDays, "weight": before.Weight, "is_active": before.IsActive}
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.pricing.boost_package.upsert", TargetType: "boost_package", TargetID: in.Tier, ReasonCode: reasonCode,
		BeforeState: beforeState,
		AfterState:  map[string]any{"price_kobo": after.PriceKobo, "duration_days": after.DurationDays, "weight": after.Weight, "is_active": after.IsActive},
	})
	return after, nil
}

// SetBoostDailyRate updates the admin-set ₦/day rate used to price a custom
// date-range boost (ADM-002). reason_code MANDATORY, audited. Config-only —
// an already-purchased custom boost keeps the rate frozen on its row.
func (s *Service) SetBoostDailyRate(ctx context.Context, adminID string, dailyRateKobo int64, reasonCode string) (*BoostDailyRate, error) {
	if err := requireReason(reasonCode); err != nil {
		return nil, err
	}
	if dailyRateKobo < 0 {
		return nil, fieldErr(CodeValidation, "daily_rate_kobo must be >= 0", "daily_rate_kobo")
	}
	before, err := s.repo.GetBoostDailyRate(ctx)
	if err != nil {
		return nil, err
	}
	after, err := s.repo.SetBoostDailyRate(ctx, dailyRateKobo, adminID)
	if err != nil {
		return nil, err
	}
	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.pricing.boost_daily_rate.set", TargetType: "boost_daily_rate", TargetID: "default", ReasonCode: reasonCode,
		BeforeState: map[string]any{"daily_rate_kobo": before.DailyRateKobo},
		AfterState:  map[string]any{"daily_rate_kobo": after.DailyRateKobo},
	})
	return after, nil
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
