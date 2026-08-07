package marketplace_test

// ---------------------------------------------------------------------------
// Agent F (QA) — API-contract / frozen-shape tests.
//
// These lock the FROZEN interface from SWARM_INTEGRATION_CONTRACT.md: enum
// string values (mirror SQL ENUMs exactly — a typo here breaks the DB CHECK/
// ENUM round-trip AND every other agent's switch-on-string-value code), the
// error code taxonomy (§3, rendered verbatim by mobile/admin), and the money
// math helper Order.TotalPayableKobo (§3.1 checkout total).
//
// All assertions here run with NO DB, NO Redis, and NO network — pure Go value
// checks against the exported package surface, so this file always runs in CI.
//
// ADR-023 SCOPE NOTE: the OrderStatus / DisputeStatus enum subtests and
// Order.TotalPayableKobo below lock RETAINED-BUT-UNUSED types. The escrow order /
// dispute money-path was removed in the listings-and-connect pivot (ADR-023), but
// per that ADR the enums, the Order struct + its TotalPayableKobo helper, and the
// mkt_orders/mkt_disputes tables are kept (additive-only; not physically dropped).
// So these remain valid shape-locks for the retained code — they are NOT testing
// live behavior. The FSM-behavior mirrors for order/dispute (which DID test deleted
// code) live in fsm_invariant_test.go and are now t.Skip'd (see ADR-023 there).
// ---------------------------------------------------------------------------

import (
	"testing"

	mkt "spotlight/backend/internal/marketplace"
)

// TestEnumValues_MirrorSQLExactly locks every enum's string values against the
// SQL ENUM literal lists in Paymax_Marketplace_CLAUDE_BUILD_CONTRACT.md §1 and
// SWARM_INTEGRATION_CONTRACT.md's frozen Go interface comment. Any drift here
// breaks the Postgres ENUM round-trip silently at INSERT time (a runtime error
// far from this test, hard to diagnose) — this test converts that into an
// immediate, obvious CI failure.
func TestEnumValues_MirrorSQLExactly(t *testing.T) {
	t.Run("ListingStatus", func(t *testing.T) {
		want := []mkt.ListingStatus{
			mkt.ListingDraft, mkt.ListingPendingReview, mkt.ListingActive, mkt.ListingPaused,
			mkt.ListingExpired, mkt.ListingSold, mkt.ListingRemovedPolicy, mkt.ListingRemovedUser,
		}
		wantStr := []string{"draft", "pending_review", "active", "paused", "expired", "sold", "removed_policy", "removed_user"}
		assertEnumStrings(t, "ListingStatus", want, wantStr)
	})
	t.Run("OrderStatus", func(t *testing.T) {
		want := []mkt.OrderStatus{
			mkt.OrderInitiated, mkt.OrderFunded, mkt.OrderSellerAccepted, mkt.OrderInDelivery,
			mkt.OrderDelivered, mkt.OrderInspectionWindow, mkt.OrderReleased, mkt.OrderCancelled,
			mkt.OrderDisputed, mkt.OrderRefunded, mkt.OrderSplitSettled,
		}
		wantStr := []string{
			"initiated", "funded", "seller_accepted", "in_delivery", "delivered", "inspection_window",
			"released", "cancelled", "disputed", "refunded", "split_settled",
		}
		assertEnumStrings(t, "OrderStatus", want, wantStr)
	})
	t.Run("DisputeStatus", func(t *testing.T) {
		want := []mkt.DisputeStatus{
			mkt.DisputeOpened, mkt.DisputeEvidenceWindow, mkt.DisputeUnderReview,
			mkt.DisputeDecided, mkt.DisputeExecuted, mkt.DisputeClosed, mkt.DisputeAppealed,
		}
		wantStr := []string{"opened", "evidence_window", "under_review", "decided", "executed", "closed", "appealed"}
		assertEnumStrings(t, "DisputeStatus", want, wantStr)
	})
	t.Run("BoostStatus", func(t *testing.T) {
		want := []mkt.BoostStatus{
			mkt.BoostPurchased, mkt.BoostActive, mkt.BoostCompleted, mkt.BoostRejectedWithReason, mkt.BoostAutoRefunded,
		}
		wantStr := []string{"purchased", "active", "completed", "rejected_with_reason", "auto_refunded"}
		assertEnumStrings(t, "BoostStatus", want, wantStr)
	})
	t.Run("KYCTier", func(t *testing.T) {
		want := []mkt.KYCTier{mkt.KYCTier0Browse, mkt.KYCTier1Buy, mkt.KYCTier2Sell, mkt.KYCTier3Business}
		wantStr := []string{"tier0_browse", "tier1_buy", "tier2_sell", "tier3_business"}
		assertEnumStrings(t, "KYCTier", want, wantStr)
	})
}

func assertEnumStrings[T ~string](t *testing.T, name string, values []T, want []string) {
	t.Helper()
	if len(values) != len(want) {
		t.Fatalf("%s: got %d values, want %d — enum cardinality drifted from the SQL ENUM", name, len(values), len(want))
	}
	seen := map[string]bool{}
	for i, v := range values {
		s := string(v)
		if s != want[i] {
			t.Errorf("%s[%d] = %q, want %q", name, i, s, want[i])
		}
		if seen[s] {
			t.Errorf("%s: duplicate value %q", name, s)
		}
		seen[s] = true
	}
}

// TestErrorCodes_AreNonEmptyAndDistinct walks every exported Code* constant used
// across the file's declared list and confirms none are blank/duplicated —
// duplicated codes would make a client's `switch err.code` ambiguous between two
// semantically different failures.
func TestErrorCodes_AreNonEmptyAndDistinct(t *testing.T) {
	codes := []string{
		mkt.CodeInternal, mkt.CodeUnauthenticated, mkt.CodeValidation,
		mkt.CodeListingNotFound, mkt.CodeListingNotActive, mkt.CodeListingNotEscrowElig,
		mkt.CodeDescriptionTooShort, mkt.CodeInsufficientPhotos, mkt.CodePriceOutOfBand,
		mkt.CodeDuplicatePhotoDetected, mkt.CodeListingHasActiveOrder, mkt.CodeInvalidListingTransition,
		mkt.CodeInvalidDeliveryOption, mkt.CodeBuyerKYCInsufficient, mkt.CodeSelfPurchaseNotAllowed,
		mkt.CodeOrderNotFound, mkt.CodeOrderNotInitiated, mkt.CodeOrderAlreadyFunded, mkt.CodeOrderExpired,
		mkt.CodeInsufficientWallet, mkt.CodeOrderNotInspection, mkt.CodeInspectionDeadlinePast,
		mkt.CodeOrderNotAcceptable, mkt.CodeOrderNotCancellable, mkt.CodeOrderNotDisputable,
		mkt.CodeInvalidOrderTransition, mkt.CodeNotOrderBuyer, mkt.CodeNotOrderSeller, mkt.CodeNotOrderParty,
		mkt.CodeDisputeNotFound, mkt.CodeDisputeAlreadyOpen, mkt.CodeInvalidDisputeTransition,
		mkt.CodeReasonCodeRequired, mkt.CodeAwaitingSecondApproval, mkt.CodeSameApproverNotAllowed,
		mkt.CodeBoostNotFound, mkt.CodeInvalidBoostTransition, mkt.CodeInvalidBoostTier,
		mkt.CodeOfferNotFound, mkt.CodeReviewNotFound, mkt.CodeReviewExists, mkt.CodeNotFound,
		mkt.CodeForbidden, mkt.CodeIdempotencyReplay, mkt.CodeIdempotencyMissing, mkt.CodeConflict,
		mkt.CodeWebhookBadSignature, mkt.CodeSearchNotWired, mkt.CodeNotImplemented,
	}
	seen := map[string]int{}
	for i, c := range codes {
		if c == "" {
			t.Errorf("error code at index %d is empty", i)
		}
		if prior, dup := seen[c]; dup {
			t.Errorf("error code %q declared at both index %d and %d — must be distinct", c, prior, i)
		}
		seen[c] = i
	}
	if len(seen) < 40 {
		t.Errorf("expected the full §3 taxonomy (40+ distinct codes), got %d distinct", len(seen))
	}
}

// TestOrder_TotalPayableKobo locks the §3.1 checkout total formula: item price +
// escrow fee + delivery fee. This is the number rendered to the buyer as
// total_payable_kobo before they fund escrow — an off-by-one-fee-leg bug here
// either undercharges (platform loses the fee) or overcharges (buyer is billed
// wrong, a direct trust/compliance issue).
func TestOrder_TotalPayableKobo(t *testing.T) {
	cases := []struct {
		name                                      string
		amount, escrowFee, deliveryFee, wantTotal int64
	}{
		{"no delivery fee (pickup)", 100_000, 2_000, 0, 102_000},
		{"with delivery fee (rider)", 100_000, 2_000, 1_500, 103_500},
		{"zero amount edge (should not occur in practice, but must not panic/negative)", 0, 0, 0, 0},
		{"large order", 999_999_999, 19_999_999, 5_000, 1_020_004_998},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			o := mkt.Order{AmountKobo: tc.amount, EscrowFeeKobo: tc.escrowFee, DeliveryFeeKobo: tc.deliveryFee}
			if got := o.TotalPayableKobo(); got != tc.wantTotal {
				t.Errorf("TotalPayableKobo() = %d, want %d", got, tc.wantTotal)
			}
		})
	}
}

// TestBoostTiers_CatalogIsWellFormed locks the §2.4 boost catalog: every tier has
// a positive price/duration and STRICTLY increasing weight as tier price
// increases (the additive boost_weight that feeds the ES function_score
// boost_mode:sum — a mis-ordered weight would let a cheaper tier out-rank a
// pricier one, breaking the commercial model).
func TestBoostTiers_CatalogIsWellFormed(t *testing.T) {
	tiers := mkt.BoostTiers
	if len(tiers) == 0 {
		t.Fatal("BoostTiers must not be empty")
	}
	seenTier := map[string]bool{}
	for i, tier := range tiers {
		if tier.Tier == "" {
			t.Errorf("tier[%d] has empty Tier name", i)
		}
		if seenTier[tier.Tier] {
			t.Errorf("duplicate tier name %q", tier.Tier)
		}
		seenTier[tier.Tier] = true
		if tier.PriceKobo <= 0 {
			t.Errorf("tier %q: PriceKobo must be positive, got %d", tier.Tier, tier.PriceKobo)
		}
		if tier.DurationDays <= 0 {
			t.Errorf("tier %q: DurationDays must be positive, got %d", tier.Tier, tier.DurationDays)
		}
		if tier.Weight <= 0 {
			t.Errorf("tier %q: Weight must be positive (additive boost, never zero/negative)", tier.Tier)
		}
		if i > 0 {
			prev := tiers[i-1]
			if tier.PriceKobo > prev.PriceKobo && tier.Weight <= prev.Weight {
				t.Errorf("tier %q (price %d) must have a strictly higher Weight than %q (price %d); got %v <= %v",
					tier.Tier, tier.PriceKobo, prev.Tier, prev.PriceKobo, tier.Weight, prev.Weight)
			}
		}
	}
}

// TestDualApprovalThreshold_MatchesQuotedNairaFigure is a redundant-by-design
// cross-check against fsm_invariant_test.go's dedicated threshold test — kept
// here too because this is also, independently, a FROZEN CONTRACT NUMBER (§6.3,
// §2.2, §2.3 all quote "₦500k" consistently) and a single source of truth
// mismatch between the contract prose and the Go constant is exactly the kind of
// drift a contract test should catch even if it duplicates coverage.
func TestDualApprovalThreshold_MatchesQuotedNairaFigure(t *testing.T) {
	const nairaToKobo = 100
	const quotedNaira = 500_000
	if mkt.DualApprovalThresholdKobo != quotedNaira*nairaToKobo {
		t.Fatalf("DualApprovalThresholdKobo = %d kobo, want %d kobo (₦%d)",
			mkt.DualApprovalThresholdKobo, quotedNaira*nairaToKobo, quotedNaira)
	}
}

// TestDefaultMarketID_IsNG locks the day-one market default (§1: market_id
// default 'NG') that every table/index in the schema keys off.
func TestDefaultMarketID_IsNG(t *testing.T) {
	if mkt.DefaultMarketID != "NG" {
		t.Fatalf("DefaultMarketID = %q, want %q", mkt.DefaultMarketID, "NG")
	}
}
