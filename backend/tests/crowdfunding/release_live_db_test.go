package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB regression: Release() used to report a bare {"ok": true} regardless
// of how many contributions it actually settled — same defect class as
// RefundAll (see withdrawal_and_refund_live_db_test.go's CF-002 comment).
// Since Contribute() instant-settles nearly every contribution on arrival,
// a funded campaign's contributions are typically already 'released' by the
// time Release() is called — it finds nothing 'escrowed' left to process,
// but the old handler couldn't tell "this call just paid everyone" apart
// from "this call did nothing, it had already happened at contribute-time".
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL. See
// campaign_analytics_live_db_test.go in this package for the pattern.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Release -v
// ---------------------------------------------------------------------------

import (
	"context"
	"testing"
)

// TestLiveDB_Release_ReportsZeroWhenContributionsAlreadySettled pins the fix:
// calling Release() on a campaign whose contribution(s) already instant-
// settled to 'released' must honestly report zero released, not a bare
// success — and must not attempt to re-settle (which would double-pay).
func TestLiveDB_Release_ReportsZeroWhenContributionsAlreadySettled(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	// Fund exactly the goal so Contribute()'s own checkAndMarkFunded flips the
	// campaign to 'funded' in the same call that already instant-settled the
	// contribution to 'released' — the real-world sequence this pins.
	const goalKobo = 200_000
	campaignID, creatorID, cfSvc, _ := seedFundedContribution(t, ctx, pool, goalKobo, goalKobo)

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM campaigns WHERE id = $1`, campaignID).Scan(&status); err != nil {
		t.Fatalf("read campaign status: %v", err)
	}
	if status != "funded" {
		t.Fatalf("test setup: campaign status = %q, want 'funded' — fixture assumption broken", status)
	}

	result, err := cfSvc.Release(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("release: %v", err)
	}
	if result.ReleasedCount != 0 {
		t.Errorf("ReleasedCount = %d, want 0 — the contribution had already instant-settled, nothing was left in escrow to release", result.ReleasedCount)
	}
	if result.ReleasedKobo != 0 {
		t.Errorf("ReleasedKobo = %d, want 0", result.ReleasedKobo)
	}

	// Calling Release() again is safe (idempotent no-op) — confirms this
	// doesn't accidentally re-process or double-pay on a second call either.
	result2, err := cfSvc.Release(ctx, campaignID, creatorID)
	if err != nil {
		t.Fatalf("second release: %v", err)
	}
	if result2.ReleasedCount != 0 {
		t.Errorf("second call ReleasedCount = %d, want 0", result2.ReleasedCount)
	}

	var contribStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM contributions WHERE campaign_id = $1`, campaignID).Scan(&contribStatus); err != nil {
		t.Fatalf("read contribution status: %v", err)
	}
	if contribStatus != "released" {
		t.Errorf("contribution status = %q, want 'released' (unchanged)", contribStatus)
	}
}

// TestLiveDB_Release_DeniedForNonOwner pins AUTHZ-002: a user who does not
// own the campaign cannot release its funds.
func TestLiveDB_Release_DeniedForNonOwner(t *testing.T) {
	ctx := context.Background()
	pool := moneyPathPool(t)

	const goalKobo = 150_000
	campaignID, _, cfSvc, _ := seedFundedContribution(t, ctx, pool, goalKobo, goalKobo)

	impostorID := "00000000-0000-0000-0000-000000000000"
	if _, err := cfSvc.Release(ctx, campaignID, impostorID); err == nil {
		t.Fatalf("Release succeeded for a non-owner — IDOR")
	}
}
