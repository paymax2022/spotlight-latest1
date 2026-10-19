package marketplace

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"spotlight/backend/go-common/fsm"
	"spotlight/backend/internal/finance/ledger"
	"strings"
	"time"
)

// minBoostDays/maxBoostDays bound how long a boost can run. Min 1 prevents a
// same-minute end from pricing at ₦0; max 90 caps how much a single fat-fingered
// end date can charge a wallet (at the seeded ₦100/day rate that is ₦9,000).
const (
	minBoostDays = 1
	maxBoostDays = 90
)

// boostSellerCancelReason is the rejection_reason_code CancelBoost stamps when
// a seller stops their own boost. It is what separates a seller-chosen
// cancellation from an admin policy rejection on the shared auto_refunded
// terminal status — FileAppeal's standing-action gate reads it to refuse
// appeals against boosts the seller cancelled themself.
const boostSellerCancelReason = "seller_cancelled"

// service_boost.go implements the §2.4 Boost FSM: wallet-direct charge on purchase
// (no separate ad-balance) and an automatic refund on admin/system reject.
// Ledger refs / idem keys:
//   - charge : ref "mkt:boost:<id>:charge" idem "mkt:boost:<id>:charge"
//   - refund : ref "mkt:boost:<id>:refund" idem "mkt:boost:<id>:refund"
// The boost charge is a wallet debit → ledger.AccountCommission (ad revenue). The
// auto-refund reverses it back to the seller wallet.

// BoostPricing returns the public boost price catalog (§3.3 GET /boosts/pricing)
// — the admin's ₦/day rate plus the durations the app offers. The rate lives in
// mkt_boost_daily_rate and the admin pricing console can change it at any moment,
// so this is read live on every request rather than cached in the binary: an
// admin repricing today is what a seller sees opening the boost screen now.
func (s *Service) BoostPricing(ctx context.Context) (*BoostPricing, error) {
	rate, err := s.repo.GetBoostDailyRate(ctx)
	if err != nil {
		return nil, err
	}
	return &BoostPricing{
		DailyRateKobo:      rate.DailyRateKobo,
		PresetDurationDays: boostPresetDays,
		MinDurationDays:    minBoostDays,
		MaxDurationDays:    maxBoostDays,
	}, nil
}

// boostPresetDays are the durations the purchase screen offers as one tap. Each
// is priced exactly like a custom range — duration × the ₦/day rate — so the
// list is a shortcut, not a second price list.
var boostPresetDays = []int{1, 3, 7, 14, 30}

// GetBoost returns a boost (OLA enforced in the handler for member reads).
func (s *Service) GetBoost(ctx context.Context, id string) (*Boost, error) {
	return s.repo.GetBoost(ctx, id)
}

// ComputeBoostQuote is the SOLE pricing authority for a boost purchase — used
// by both the read-only GET /boosts/quote preview and PurchaseBoost itself, so
// a quote shown to a buyer and what they're actually charged can never drift.
// Never trusts a client-sent price.
//
// One formula for every boost: duration × the admin-set ₦/day rate
// (mkt_boost_daily_rate). Pass either duration_days (a whole-day boost starting
// now) or ends_at (a boost ending at a chosen moment). A boost always activates
// immediately on purchase — there is no scheduler to promote a future-dated
// "purchased" boost to "active" later — and an ends_at range is billed in whole
// days rounded UP (a part-day still costs a full day; CLAUDE.md money rule:
// integers, never fractional kobo).
//
// Weight is flat (baseBoostWeight) regardless of duration: deliberately not a
// formula, so a longer range cannot buy outsized search rank.
func (s *Service) ComputeBoostQuote(ctx context.Context, durationDays int, endsAt *time.Time) (*BoostQuote, error) {
	if durationDays > 0 && endsAt != nil {
		return nil, fieldErr(CodeValidation, "send duration_days or ends_at, not both", "duration_days")
	}
	now := time.Now()

	days := durationDays
	ends := now.Add(time.Duration(days) * 24 * time.Hour)
	switch {
	case days > 0:
		if days < minBoostDays || days > maxBoostDays {
			return nil, fieldErr(CodeInvalidBoostRange,
				fmt.Sprintf("duration_days must be between %d and %d", minBoostDays, maxBoostDays), "duration_days")
		}
	case endsAt != nil:
		var err error
		days, err = boostDaysFromRange(now, *endsAt)
		if err != nil {
			return nil, err
		}
		ends = *endsAt
	default:
		return nil, fieldErr(CodeValidation, "duration_days or ends_at is required", "duration_days")
	}

	rate, err := s.repo.GetBoostDailyRate(ctx)
	if err != nil {
		return nil, err
	}
	return &BoostQuote{
		DurationDays: days, DailyRateKobo: rate.DailyRateKobo,
		PriceKobo: int64(days) * rate.DailyRateKobo, Weight: baseBoostWeight,
		StartsAt: now, EndsAt: ends,
	}, nil
}

// boostDaysFromRange validates a chosen end moment and returns its billed
// duration in whole days, rounded UP — a part-day still costs a full day
// (CLAUDE.md money rule: integers, never fractional kobo). Pure and DB-free so
// the rounding/bounds math has an executed unit test independent of
// ComputeBoostQuote's repo dependency (service_boost_test.go).
func boostDaysFromRange(now, endsAt time.Time) (int, error) {
	if !endsAt.After(now) {
		return 0, fieldErr(CodeInvalidBoostRange, "ends_at must be in the future", "ends_at")
	}
	days := max(int(math.Ceil(endsAt.Sub(now).Hours()/24)), minBoostDays)
	if days > maxBoostDays {
		return 0, fieldErr(CodeInvalidBoostRange, fmt.Sprintf("a boost cannot exceed %d days", maxBoostDays), "ends_at")
	}
	return days, nil
}

// baseBoostWeight is the flat search-rank weight every boost gets — see
// ComputeBoostQuote.
const baseBoostWeight = 1.0

// boostRowTier is what mkt_boosts.tier records for a day-rate purchase. The
// column predates the pricing model (it named package tiers, and the admin
// boost console still reads it); every boost bought now costs duration × the
// ₦/day rate, so they all carry this one label and duration_days/price_kobo on
// the row say what was actually bought.
const boostRowTier = "daily-rate"

// boostChargeTierKey derives the string PurchaseBoost's postBoostCharge keys its
// idempotent charge on: deterministic per request, so two DIFFERENT purchases
// never collide while a RETRY of the same one does. The billed END DATE identifies
// the purchase — at ₦/day pricing, same listing + same end date = the same buy.
//
// The DATE, not the instant, is load-bearing: the segment is computed from a
// quote whose ends_at comes from time.Now(), so a per-second format would give two
// genuinely concurrent calls (a double-tap carrying two different Idempotency-Keys,
// racing inside Redis' non-atomic check-then-set) two different keys and debit the
// wallet twice. The ledger's unique idempotency key is the durable backstop behind
// the 24h Redis window, and a backstop only holds if it is reproducible.
func boostChargeTierKey(q *BoostQuote) string {
	return "until:" + q.EndsAt.UTC().Format("2006-01-02")
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
	// listing_id arrives in the request BODY, outside UUIDParams' path-param
	// reach — an absent or malformed value would reach GetListing's uuid
	// compare and surface as a 500 rather than a caller-correctable 400.
	if strings.TrimSpace(in.ListingID) == "" {
		return nil, fieldErr(CodeValidation, "listing_id is required", "listing_id")
	}
	if err := requireUUIDField(in.ListingID, "listing_id"); err != nil {
		return nil, err
	}
	quote, err := s.ComputeBoostQuote(ctx, in.DurationDays, in.EndsAt)
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

	// Tier-limit gate, fail-closed, BEFORE any money moves (§6 FINDING fix: the
	// boost charge used to call s.ledger.Debit directly with no tier-limit/KYC gate
	// at all — unlike every sibling wallet-debit money path). A missing gate is a
	// deployment misconfiguration, not a bypass: refuse rather than silently skip.
	// SKIPPED when this deterministic charge key already committed (F2): a retry
	// whose debit legs posted but whose boost row never recorded must reach
	// DebitGated's in-tx replay (ErrDuplicate → safe), not refuse at-cap.
	if s.tiers == nil {
		return nil, ErrTierGateUnwired
	}
	if posted, perr := s.ledger.Posted(ctx, boostChargeKey(sellerID, in.ListingID, chargeTier.Tier)); perr != nil {
		return nil, wrapInternal("boost replay probe", perr)
	} else if !posted {
		if err := s.tiers.EnforceWalletDebitLimit(ctx, sellerID, quote.PriceKobo); err != nil {
			return nil, newErr(403, CodeTierLimitExceeded, "boost purchase blocked by tier limit: "+err.Error())
		}
	}
	chargeRef, err := s.postBoostCharge(ctx, sellerID, in.ListingID, chargeTier)
	if err != nil {
		return nil, err
	}

	rowTier := boostRowTier
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
// Ordering is load-bearing (ledger-first, status-last — the same partial-
// completion precedent as estate's RequestPayout/PayDues): the refund posts
// FIRST, before mkt_boosts.status is touched, and only on success does the row
// transition in ONE UPDATE straight to terminal auto_refunded (reason code +
// refund ref + refunded_kobo stamped together). A committed intermediate
// rejected_with_reason row would wedge every retry on the FSM's illegal
// self-edge with no path to complete the refund.
func (s *Service) RejectBoost(ctx context.Context, adminID, boostID, reasonCode string) (*Boost, error) {
	if err := requireReason(reasonCode); err != nil {
		return nil, err
	}
	b, err := s.repo.GetBoost(ctx, boostID)
	if err != nil {
		return nil, err
	}

	// MKT-FSM-015: re-rejecting an already-terminal auto_refunded boost is an
	// idempotent 200 no-op per docs/qa/modules/marketplace.md §5b, not a 409 —
	// guardBoostTransition has no terminal short-circuit, so handle it here
	// before the guard ever runs.
	if b.Status == BoostAutoRefunded {
		return b, nil
	}

	from := b.Status
	// RESUMABLE for boosts stranded by the OLD pre-fix code path (or any future
	// unexpected failure between the refund and the final UPDATE below): a row
	// already sitting at rejected_with_reason with no refund posted just resumes
	// the refund + final transition — rejected_with_reason → auto_refunded IS a
	// legal FSM edge (fsm_boost.go), so this is not a bypass, only a shortcut
	// around re-running the FIRST guard (which checks eligibility to become
	// rejected_with_reason, not to leave it).
	if from != BoostRejectedWithReason {
		if err := guardBoostTransition(from, BoostRejectedWithReason); err != nil {
			return nil, err
		}
	}

	// Automatic refund: reverse the wallet charge back to the seller. Idempotent
	// on the deterministic refund key (postBoostRefund tolerates ledger.ErrDuplicate),
	// so re-entering this function after a prior successful-refund-but-failed-status-
	// write is also safe.
	refundRef := boostRefundKey(boostID)
	if b.PriceKobo > 0 {
		if _, err := s.postBoostRefund(ctx, b.SellerID, boostID, b.PriceKobo); err != nil {
			return nil, err
		}
	}
	if err := s.repo.setBoostStatusWithRefund(ctx, boostID, from, BoostAutoRefunded, &reasonCode, &refundRef, &b.PriceKobo); err != nil {
		return nil, err
	}
	b.Status = BoostAutoRefunded
	b.RejectionReasonCode = &reasonCode
	b.RefundRef = &refundRef
	b.RefundedKobo = &b.PriceKobo

	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: adminID, Action: "mkt.boost.reject", TargetType: "boost", TargetID: boostID, ReasonCode: reasonCode,
		BeforeState: map[string]any{"status": string(from)},
		AfterState:  map[string]any{"status": string(BoostAutoRefunded), colReasonCode: reasonCode},
	})
	s.notifySafe(ctx, b.SellerID, "mkt.boost.refunded", "Your boost was rejected and refunded: "+reasonCode)
	return b, nil
}

// CancelBoost (seller) stops their own active boost early: active →
// cancelled_by_seller → auto_refunded, with a PRORATED refund for the unused
// remainder of the period. The seller-facing counterpart to RejectBoost
// (admin, mandatory reason code, FULL refund, policy violation) — same
// "stop it and pay back the ledger" shape, but the seller chose this, not a
// moderator, so no reason code is required and the refund reflects only the
// days not yet delivered.
// CancelBoost applies the same atomicity/resumability fix as RejectBoost (see
// its doc comment for the full incident writeup): the OLD code committed
// status -> cancelled_by_seller in its own standalone UPDATE BEFORE calling
// postBoostRefund, so a refund failure (e.g. the seller has no ledger_accounts
// row — the identical FK-violation condition RejectBoost hit) stranded the
// boost at cancelled_by_seller with no refund and no legal way to retry
// (cancelled_by_seller -> cancelled_by_seller is not a valid FSM edge).
func (s *Service) CancelBoost(ctx context.Context, sellerID, boostID string) (*Boost, error) {
	b, err := s.repo.GetBoost(ctx, boostID)
	if err != nil {
		return nil, err
	}
	if b.SellerID != sellerID {
		return nil, ErrForbidden
	}

	// NOTE: unlike RejectBoost's MKT-FSM-015 idempotent no-op, CancelBoost does
	// NOT special-case an already-terminal auto_refunded boost — a pre-existing
	// test (tests/marketplace/boost_cancel_live_db_test.go
	// TestLiveDB_CancelBoost_RejectsAlreadyRefunded) deliberately requires a
	// second cancel to be REJECTED, not silently accepted, since CancelBoost has
	// no mandatory admin reason code to make a repeat call auditable the way
	// RejectBoost's does. The guard below already produces exactly that: from
	// auto_refunded (terminal, no outgoing edges in the FSM), guardBoostTransition
	// correctly returns 409 INVALID_BOOST_TRANSITION.

	from := b.Status
	// RESUMABLE, same pattern as RejectBoost: a boost already stranded at
	// cancelled_by_seller (by a prior failed attempt, or any future partial
	// failure between the refund and the final write below) resumes the
	// refund + final transition directly, instead of re-running the guard
	// against BoostCancelledBySeller as a TARGET (which the FSM correctly
	// refuses as an illegal self-edge).
	if from != BoostCancelledBySeller {
		if err := guardBoostTransition(from, BoostCancelledBySeller); err != nil {
			return nil, err
		}
	}
	cancelReason := boostSellerCancelReason

	// proratedBoostRefund reads only the ORIGINAL boost row already loaded above
	// (b.StartsAt/b.EndsAt/b.PriceKobo) plus the current time — computed here, in
	// the same place in the flow as before (before the refund posts, before any
	// status write), so this reordering changes neither what is computed nor when.
	refundKobo := proratedBoostRefund(b, time.Now())
	refundRef := boostRefundKey(boostID)

	// Ledger-first, status-last (mirrors RejectBoost's fix and the estate
	// RequestPayout/PayDues precedent): post the refund BEFORE touching
	// mkt_boosts.status at all, so a refund failure leaves the row UNCHANGED at
	// its original status instead of stranding it at cancelled_by_seller. The
	// final transition then goes straight from the ORIGINAL status to the
	// terminal auto_refunded in ONE UPDATE (reason + refund ref + refunded_kobo
	// stamped together) rather than the old two-step dance.
	if refundKobo > 0 {
		if _, err := s.postBoostRefund(ctx, b.SellerID, boostID, refundKobo); err != nil {
			return nil, err
		}
	}
	if err := s.repo.setBoostStatusWithRefund(ctx, boostID, from, BoostAutoRefunded, &cancelReason, &refundRef, &refundKobo); err != nil {
		return nil, err
	}
	b.Status = BoostAutoRefunded
	b.RejectionReasonCode = &cancelReason
	b.RefundRef = &refundRef
	b.RefundedKobo = &refundKobo

	_ = s.writeAudit(ctx, AuditEntry{
		AdminID: sellerID, Action: "mkt.boost.cancel", TargetType: "boost", TargetID: boostID, ReasonCode: cancelReason,
		BeforeState: map[string]any{"status": string(from)},
		AfterState:  map[string]any{"status": string(BoostAutoRefunded), "refund_kobo": refundKobo},
	})
	s.notifySafe(ctx, b.SellerID, "mkt.boost.cancelled", fmt.Sprintf("Your boost was cancelled and ₦%.2f refunded for the unused days.", float64(refundKobo)/100))
	return b, nil
}

// proratedBoostRefund computes what a seller gets back for cancelling an
// active boost early: the fraction of the ORIGINAL price corresponding to the
// time between now and ends_at, out of the boost's total starts_at→ends_at
// window. Pure and DB-free so the money math itself has an executed test
// independent of CancelBoost's DB/ledger plumbing (mirrors customBoostDuration
// above).
// Rounds DOWN (integer division truncates) — a platform financial calculation
// must never round in the payer's favor by accident. Clamped to [0, PriceKobo]
// so clock skew or a boost already past ends_at can never refund more than
// was paid or go negative.
func proratedBoostRefund(b *Boost, now time.Time) int64 {
	if b == nil || b.StartsAt == nil || b.EndsAt == nil || b.PriceKobo <= 0 {
		return 0
	}
	total := b.EndsAt.Sub(*b.StartsAt)
	if total <= 0 {
		return 0
	}
	remaining := b.EndsAt.Sub(now)
	if remaining <= 0 {
		return 0
	}
	if remaining > total {
		remaining = total
	}
	refund := min(int64(float64(b.PriceKobo)*(float64(remaining)/float64(total))), b.PriceKobo)
	return refund
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
	if dailyRateKobo <= 0 {
		// Zero is rejected, not just negative: the rate prices EVERY boost, so a
		// 0 row would sell unlimited promotion for nothing and post a 0-kobo
		// charge to the ad-revenue ledger.
		return nil, fieldErr(CodeValidation, "daily_rate_kobo must be greater than 0", "daily_rate_kobo")
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
	if derr := s.ledger.DebitGated(ctx, sellerID, key, key, commission.ID, tier.PriceKobo); derr != nil {
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

// Boost FSM (§2.4). Explicit guarded transitions only.
//	purchased             → active (auto on purchase) | rejected_with_reason
//	active                → completed (ends_at passed) | rejected_with_reason | cancelled_by_seller
//	rejected_with_reason  → auto_refunded (automatic refund ledger tx)
//	cancelled_by_seller   → auto_refunded (automatic PRORATED refund ledger tx)
//	(terminal: completed, auto_refunded)

var boostTransitions = fsm.Table[BoostStatus]{
	BoostPurchased: fsm.Set(
		BoostActive,
		BoostRejectedWithReason,
	),
	BoostActive: fsm.Set(
		BoostCompleted,
		BoostRejectedWithReason,
		BoostCancelledBySeller,
	),
	BoostRejectedWithReason: fsm.Set(
		BoostAutoRefunded,
	),
	BoostCancelledBySeller: fsm.Set(
		BoostAutoRefunded,
	),
}

// guardBoostTransition returns a typed error when from → to is illegal.
func guardBoostTransition(from, to BoostStatus) error {
	if !boostTransitions.Can(from, to) {
		return &CodedError{
			Status:  http.StatusConflict,
			Code:    CodeInvalidBoostTransition,
			Message: "illegal boost transition " + string(from) + " → " + string(to),
		}
	}
	return nil
}

// BoostTier is the resolved, priced purchase handed to postBoostCharge —
// duration, kobo and the search weight that froze onto the mkt_boosts row at
// purchase time. ComputeBoostQuote is the only producer.
type BoostTier struct {
	Tier         string  `json:"tier"`
	DurationDays int     `json:"duration_days"`
	PriceKobo    int64   `json:"price_kobo"`
	Weight       float64 `json:"weight"` // additive boost_weight in ES function_score (§4)
}
