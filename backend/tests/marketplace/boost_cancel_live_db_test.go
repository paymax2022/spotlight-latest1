package marketplace_test

// ---------------------------------------------------------------------------
// CancelBoost (seller-initiated) — the seller-facing counterpart to admin-only
// RejectBoost (see TestLiveDB_BoostOnRejectedListing_AutoRefundsSeller in
// chaos_live_db_test.go). Same "stop it, refund the ledger, never leave the
// listing looking boosted with money already collected" shape, but PRORATED
// (only the unused days) rather than a full refund, and reachable by the
// seller themselves without a policy-violation reason code.
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"

	"github.com/google/uuid"

	mkt "spotlight/backend/internal/marketplace"
)

func TestLiveDB_CancelBoost_ProratedRefund(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedLedgerCapableSeller(t, ctx, pool) // must hold a wallet: the refund is a real ledger posting
	admin := seedTrustedSeller(t, ctx, pool)
	cat := seedRiskTier0Category(t, ctx, pool)
	listing := activate(t, ctx, svc, seller, admin, cat, "Boosted then cancelled by seller", 500000)

	// 7-day total window (starts_at is frozen at now()-1day by seedActiveBoost),
	// ends 6 days from now — so roughly 6/7 of the price should come back.
	boostID := seedActiveBoost(t, ctx, pool, listing.ID, seller, "vip", "now()+interval '6 days'")

	before, err := svc.GetBoost(ctx, boostID)
	if err != nil {
		t.Fatalf("get boost: %v", err)
	}
	if before.Status != mkt.BoostActive {
		t.Fatalf("precondition: boost should start active, got %s", before.Status)
	}
	if before.PriceKobo <= 0 {
		t.Fatalf("precondition: a zero-price boost would post no reversal and prove nothing")
	}
	balBefore := walletBalanceKobo(t, ctx, pool, seller)

	after, err := svc.CancelBoost(ctx, seller, boostID)
	if err != nil {
		t.Fatalf("cancel boost: %v", err)
	}
	if after.Status != mkt.BoostAutoRefunded {
		t.Errorf("boost status = %s, want %s — a cancelled boost must not keep charging or stay live", after.Status, mkt.BoostAutoRefunded)
	}
	if after.RefundRef == nil || *after.RefundRef == "" {
		t.Error("RefundRef is empty — the refund must be traceable to a ledger reference")
	}
	if after.RefundedKobo == nil {
		t.Fatal("RefundedKobo is nil — the client has no way to know the ACTUAL (prorated) amount without it")
	}
	if *after.RefundedKobo == before.PriceKobo {
		t.Errorf("RefundedKobo = %d, want LESS than PriceKobo %d — a client trusting RefundedKobo over PriceKobo must see the real prorated figure", *after.RefundedKobo, before.PriceKobo)
	}

	balAfter := walletBalanceKobo(t, ctx, pool, seller)
	refunded := balAfter - balBefore
	if refunded != *after.RefundedKobo {
		t.Errorf("wallet moved %d kobo but RefundedKobo says %d — these must always match exactly", refunded, *after.RefundedKobo)
	}

	// Prorated, not full: strictly between 0 and the full price, since we
	// cancelled partway through (1 of 7 days elapsed).
	if refunded <= 0 {
		t.Fatalf("wallet moved %d kobo, want a POSITIVE prorated refund", refunded)
	}
	if refunded >= before.PriceKobo {
		t.Fatalf("wallet moved %d kobo, want LESS than the full price %d — a seller-cancel must not refund the days already delivered", refunded, before.PriceKobo)
	}
	// Loose bound around 6/7 of the price (~85.7%) rather than an exact value:
	// SQL now() (starts_at/ends_at) and Go time.Now() (CancelBoost's clock) are
	// two different clock reads a few milliseconds apart, so asserting the
	// precise kobo value here would be flaky. This still proves REAL
	// proportional math ran, not just "some nonzero amount got refunded".
	wantApprox := before.PriceKobo * 6 / 7
	tolerance := before.PriceKobo / 20 // 5% slack
	if diff := refunded - wantApprox; diff < -tolerance || diff > tolerance {
		t.Errorf("refunded %d kobo, want approximately %d (~6/7 of %d) within %d — proration math looks wrong, not just clock drift",
			refunded, wantApprox, before.PriceKobo, tolerance)
	}
}

// A non-owner may not cancel someone else's boost.
func TestLiveDB_CancelBoost_RejectsNonOwner(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedLedgerCapableSeller(t, ctx, pool)
	admin := seedTrustedSeller(t, ctx, pool)
	cat := seedRiskTier0Category(t, ctx, pool)
	listing := activate(t, ctx, svc, seller, admin, cat, "Boosted, stranger tries to cancel", 500000)
	boostID := seedActiveBoost(t, ctx, pool, listing.ID, seller, "vip", "now()+interval '3 days'")

	if _, err := svc.CancelBoost(ctx, uuid.New().String(), boostID); err == nil {
		t.Fatal("a stranger cancelled someone else's boost")
	}

	// And it must still be active/refundable afterwards — a rejected attempt
	// must not have partially applied.
	after, err := svc.GetBoost(ctx, boostID)
	if err != nil {
		t.Fatalf("get boost: %v", err)
	}
	if after.Status != mkt.BoostActive {
		t.Errorf("boost status = %s after a rejected non-owner cancel attempt, want unchanged %s", after.Status, mkt.BoostActive)
	}
}

// A boost that's already terminal (auto_refunded from a prior cancel/reject)
// must not be cancellable again — no double refund.
func TestLiveDB_CancelBoost_RejectsAlreadyRefunded(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	seller := seedLedgerCapableSeller(t, ctx, pool)
	admin := seedTrustedSeller(t, ctx, pool)
	cat := seedRiskTier0Category(t, ctx, pool)
	listing := activate(t, ctx, svc, seller, admin, cat, "Boosted, cancelled twice", 500000)
	boostID := seedActiveBoost(t, ctx, pool, listing.ID, seller, "vip", "now()+interval '4 days'")

	if _, err := svc.CancelBoost(ctx, seller, boostID); err != nil {
		t.Fatalf("first cancel: %v", err)
	}
	balAfterFirst := walletBalanceKobo(t, ctx, pool, seller)

	if _, err := svc.CancelBoost(ctx, seller, boostID); err == nil {
		t.Fatal("cancelling an already-refunded boost a second time was accepted")
	}
	balAfterSecond := walletBalanceKobo(t, ctx, pool, seller)
	if balAfterSecond != balAfterFirst {
		t.Errorf("a rejected second cancel must not move money: balance went from %d to %d", balAfterFirst, balAfterSecond)
	}
}
