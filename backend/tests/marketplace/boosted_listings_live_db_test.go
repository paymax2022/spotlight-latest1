package marketplace_test

// LIVE-DB tests for the two boost promises the seller-facing screens rest on:
//   1. a boost is priced ONLY by duration × the admin's ₦/day rate
//      (mkt_boost_daily_rate), and a rate change is picked up immediately;
//   2. GET /marketplace/boosted returns currently-boosted listings ordered by the
//      MONEY STILL LEFT in the boost (undelivered value), not by what the seller
//      paid — and it leaks no coordinates.
// Both are SQL/ledger behaviours a query-builder unit test cannot prove.
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./tests/marketplace/... -run 'Boosted|BoostQuote' -v

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	mkt "spotlight/backend/internal/marketplace"
)

// seedBoostOn files one boost row with an explicit price, window and status,
// bypassing the wallet charge. Unlike seedActiveBoost — which hardcodes 7 days /
// 50,000 kobo and copies the weight out of mkt_boost_packages — the ordering
// assertions here need price and elapsed fraction controlled independently.
func seedBoostOn(t *testing.T, ctx context.Context, pool *pgxpool.Pool, listingID, sellerID string,
	priceKobo int64, status string, startsAt, endsAt time.Time) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.mkt_boosts
			(id, market_id, listing_id, seller_id, tier, duration_days, price_kobo, weight,
			 ledger_charge_ref, status, starts_at, ends_at, created_at)
		VALUES ($1::uuid,'NG',$2::uuid,$3::uuid,'daily-rate',30,$4::bigint,1.0,
			'test:'||$1::text,$5::boost_status,$6,$7,now())`,
		id, listingID, sellerID, priceKobo, status, startsAt, endsAt); err != nil {
		t.Fatalf("seed %s boost: %v", status, err)
	}
	return id
}

// seedListingWithStatus files a listing directly. activate() can only produce an
// ACTIVE listing, and the exclusion cases need a non-active one.
func seedListingWithStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, catID, title, status string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.mkt_listings
			(id, market_id, seller_id, category_id, title, description, price_kobo, state, status, geo)
		VALUES ($1::uuid,'NG',$2::uuid,$3::uuid,$4,
			'This is a valid listing description with more than eight words present.',
			500000,'Lagos',$5::listing_status,NULL)`,
		id, uuid.NewString(), catID, title, status); err != nil {
		t.Fatalf("seed %s listing: %v", status, err)
	}
	return id
}

func boostedTitlesIn(rows []mkt.BoostedListing, want ...string) []string {
	wanted := map[string]bool{}
	for _, w := range want {
		wanted[w] = true
	}
	var out []string
	for _, r := range rows {
		if wanted[r.Title] {
			out = append(out, r.Title)
		}
	}
	return out
}

// activeListing files an ACTIVE listing through the service and returns it, so
// the boost rows can be attributed to its real owner.
func activeListing(t *testing.T, ctx context.Context, svc *mkt.Service, pool *pgxpool.Pool, cat, title string) *mkt.Listing {
	t.Helper()
	return activate(t, ctx, svc, uuid.New().String(), uuid.New().String(), cat, title, 500000)
}

// TestLiveDB_BoostedListings_OrdersByMoneyLeft is the requirement "boosted activity
// with the highest money left stays on top of the rest". A seller who paid 9× more
// but has already consumed almost all of it must sit BELOW the cheap boost that
// barely started: the ranking rewards undelivered value, not past payment.
func TestLiveDB_BoostedListings_OrdersByMoneyLeft(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)

	// Most of its money is still unused: 100k over a 217-hour window, 1h elapsed.
	cheapFresh := activeListing(t, ctx, svc, pool, cat, "bl-cheap-fresh")
	seedBoostOn(t, ctx, pool, cheapFresh.ID, cheapFresh.SellerID, 100_000, "active",
		time.Now().Add(-time.Hour), time.Now().Add(9*24*time.Hour))

	// Paid 9× more but has spent 9/10 of its window: 900k over 10 days, 1 day left.
	expensiveDying := activeListing(t, ctx, svc, pool, cat, "bl-expensive-dying")
	seedBoostOn(t, ctx, pool, expensiveDying.ID, expensiveDying.SellerID, 900_000, "active",
		time.Now().Add(-9*24*time.Hour), time.Now().Add(24*time.Hour))

	// Two stacked boosts on one listing: must appear ONCE with the SUM (120k),
	// which also puts it on top of the ordering.
	stacked := activeListing(t, ctx, svc, pool, cat, "bl-stacked")
	seedBoostOn(t, ctx, pool, stacked.ID, stacked.SellerID, 60_000, "active",
		time.Now(), time.Now().Add(5*24*time.Hour))
	seedBoostOn(t, ctx, pool, stacked.ID, stacked.SellerID, 60_000, "active",
		time.Now(), time.Now().Add(3*24*time.Hour))

	rows, err := svc.BoostedListings(ctx, 500)
	if err != nil {
		t.Fatalf("boosted listings: %v", err)
	}
	// Only the seeded titles are compared — the local database can hold boosts from
	// other fixtures, and their position is not what this test claims anything about.
	got := boostedTitlesIn(rows, "bl-stacked", "bl-cheap-fresh", "bl-expensive-dying")
	want := []string{"bl-stacked", "bl-cheap-fresh", "bl-expensive-dying"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("order of seeded listings = %v, want %v — ranking must follow money left, not price paid", got, want)
	}

	byTitle := map[string]mkt.BoostedListing{}
	for _, r := range rows {
		byTitle[r.Title] = r
	}

	// 60k each over unelapsed 5-day/3-day windows → the summed remainder.
	if s := byTitle["bl-stacked"]; s.BoostRemainingKobo < 119_000 || s.BoostRemainingKobo > 120_000 {
		t.Errorf("stacked remainder = %d, want ~120000 (two 60,000-kobo boosts summed into the one row)", s.BoostRemainingKobo)
	}
	if n := len(boostedTitlesIn(rows, "bl-stacked")); n != 1 {
		t.Errorf("bl-stacked appears %d times, want once — a listing with two live boosts must not occupy two slots", n)
	}
	if c := byTitle["bl-cheap-fresh"]; c.BoostRemainingKobo < 90_000 || c.BoostRemainingKobo > 100_000 {
		t.Errorf("cheap-fresh remainder = %d, want ~99,500 of 100,000 (1h of a 217h window used)", c.BoostRemainingKobo)
	}
	// 1 of 10 days left on 900k ≈ 90,000. The RANGE is the point: it must land near
	// 90k (pro-rated), never near 900k (un-prorated), and never above cheap-fresh.
	if e := byTitle["bl-expensive-dying"]; e.BoostRemainingKobo < 80_000 || e.BoostRemainingKobo > 95_000 {
		t.Errorf("expensive-dying remainder = %d, want ~90,000 of 900,000 — pro-rating looks absent or wrong", e.BoostRemainingKobo)
	}

	for _, title := range want {
		r := byTitle[title]
		if !r.Boosted {
			t.Errorf("%s came back with boosted=false — the card badge reads this flag", title)
		}
		if r.BoostEndsAt.IsZero() {
			t.Errorf("%s came back with a zero boost_ends_at — the client cannot show an expiry without it", title)
		}
	}

	// The promoted read is a public surface. It reuses listingCols (no geo), and
	// this is the tripwire if that ever stops being true.
	blob, err := json.Marshal(rows)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if s := string(blob); strings.Contains(s, `"lat"`) || strings.Contains(s, `"lng"`) {
		t.Errorf("boosted listings leaked coordinates to a public read: %.200s", s)
	}
}

// TestLiveDB_BoostedListings_ExcludesWhatIsNotLiveBoosting: the section must be
// exactly "money currently working for this listing". A completed, expired,
// not-yet-started or refunded boost is not that — and neither is a boost attached
// to a listing that is no longer active (a paused listing must not be promoted).
func TestLiveDB_BoostedListings_ExcludesWhatIsNotLiveBoosting(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)

	done := activeListing(t, ctx, svc, pool, cat, "blx-completed")
	seedBoostOn(t, ctx, pool, done.ID, done.SellerID, 500_000, "completed",
		time.Now().Add(-9*24*time.Hour), time.Now().Add(24*time.Hour))

	expired := activeListing(t, ctx, svc, pool, cat, "blx-active-but-past")
	seedBoostOn(t, ctx, pool, expired.ID, expired.SellerID, 500_000, "active",
		time.Now().Add(-3*24*time.Hour), time.Now().Add(-time.Hour))

	future := activeListing(t, ctx, svc, pool, cat, "blx-not-started")
	seedBoostOn(t, ctx, pool, future.ID, future.SellerID, 500_000, "active",
		time.Now().Add(24*time.Hour), time.Now().Add(8*24*time.Hour))

	refunded := activeListing(t, ctx, svc, pool, cat, "blx-auto-refunded")
	seedBoostOn(t, ctx, pool, refunded.ID, refunded.SellerID, 500_000, "auto_refunded",
		time.Now().Add(-time.Hour), time.Now().Add(9*24*time.Hour))

	// A seller who paused their listing still has money riding on the boost — but
	// there is nothing on the other end of the promotion for a buyer to open.
	paused := seedListingWithStatus(t, ctx, pool, cat, "blx-paused-listing", "paused")
	seedBoostOn(t, ctx, pool, paused, uuid.NewString(), 500_000, "active",
		time.Now().Add(-time.Hour), time.Now().Add(9*24*time.Hour))

	// The control: same category, plainly live, and it must show up.
	live := activeListing(t, ctx, svc, pool, cat, "blx-live")
	seedBoostOn(t, ctx, pool, live.ID, live.SellerID, 500_000, "active",
		time.Now().Add(-time.Hour), time.Now().Add(9*24*time.Hour))

	rows, err := svc.BoostedListings(ctx, 500)
	if err != nil {
		t.Fatalf("boosted listings: %v", err)
	}
	for _, bad := range []string{"blx-completed", "blx-active-but-past", "blx-not-started", "blx-auto-refunded", "blx-paused-listing"} {
		if n := len(boostedTitlesIn(rows, bad)); n != 0 {
			t.Errorf("%q was promoted %d time(s) but is not live-boosting right now", bad, n)
		}
	}
	if n := len(boostedTitlesIn(rows, "blx-live")); n != 1 {
		t.Errorf("the live control listing appeared %d times, want exactly once", n)
	}
}

// TestLiveDB_BoostedListings_RespectsLimit is the mobile home rail's contract: the
// rail asks for 6 and the View More screen asks for more. The cap is honoured in
// SQL rather than sliced off client-side, and the rows it returns are the SAME
// leading rows the unbounded read would give.
func TestLiveDB_BoostedListings_RespectsLimit(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()
	cat := seedRiskTier0Category(t, ctx, pool)

	for _, price := range []int64{100_000, 200_000, 300_000} {
		l := activeListing(t, ctx, svc, pool, cat, "bll-"+uuid.NewString()[:8])
		// starts now() → the whole price is still unused, so price == remainder.
		seedBoostOn(t, ctx, pool, l.ID, l.SellerID, price, "active",
			time.Now(), time.Now().Add(9*24*time.Hour))
	}

	all, err := svc.BoostedListings(ctx, 500)
	if err != nil {
		t.Fatalf("unbounded read: %v", err)
	}
	if len(all) < 3 {
		t.Fatalf("seeded boosts did not all appear (rows = %d)", len(all))
	}

	rows, err := svc.BoostedListings(ctx, 2)
	if err != nil {
		t.Fatalf("limited read: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want exactly 2 — the limit must reach the SQL, not the client", len(rows))
	}
	for i := range rows {
		if rows[i].ID != all[i].ID {
			t.Errorf("row %d = %s (%d kobo left) in the limited read but %s (%d kobo left) unbounded — LIMIT cut the wrong end",
				i, rows[i].Title, rows[i].BoostRemainingKobo, all[i].Title, all[i].BoostRemainingKobo)
		}
	}
	if rows[0].BoostRemainingKobo < rows[1].BoostRemainingKobo {
		t.Errorf("clipped rows are out of order: %d then %d", rows[0].BoostRemainingKobo, rows[1].BoostRemainingKobo)
	}
}

// TestLiveDB_BoostQuote_PricedByDayRate is requirement 1 (duration × the admin's
// ₦/day rate, and nothing else) and requirement 2 (the admin can change that rate
// at any time, and the very next quote reflects it).
func TestLiveDB_BoostQuote_PricedByDayRate(t *testing.T) {
	svc, pool := liveMktService(t)
	ctx := context.Background()

	original, err := svc.BoostPricing(ctx)
	if err != nil {
		t.Fatalf("read pricing: %v", err)
	}
	// The rate row is a singleton shared with the running app — put it back
	// whatever the assertions below do to it.
	t.Cleanup(func() {
		if _, err := pool.Exec(context.WithoutCancel(ctx),
			`UPDATE public.mkt_boost_daily_rate SET daily_rate_kobo=$1 WHERE id='default'`,
			original.DailyRateKobo); err != nil {
			t.Errorf("restore daily rate to %d: %v", original.DailyRateKobo, err)
		}
	})

	q, err := svc.ComputeBoostQuote(ctx, 14, nil)
	if err != nil {
		t.Fatalf("quote 14 days: %v", err)
	}
	if q.DailyRateKobo != original.DailyRateKobo {
		t.Errorf("quote rate = %d, want %d (the live mkt_boost_daily_rate row)", q.DailyRateKobo, original.DailyRateKobo)
	}
	if want := 14 * original.DailyRateKobo; q.PriceKobo != want {
		t.Errorf("14-day price = %d kobo, want %d (duration × rate)", q.PriceKobo, want)
	}

	// Admin reprices to ₦150/day and the next quote must use it immediately — with
	// packages no longer sold, the boost screen has no other price source.
	const repriceKobo int64 = 15_000
	if _, err := svc.SetBoostDailyRate(ctx, uuid.NewString(), repriceKobo, "price_adjustment"); err != nil {
		t.Fatalf("set daily rate: %v", err)
	}
	after, err := svc.ComputeBoostQuote(ctx, 7, nil)
	if err != nil {
		t.Fatalf("quote 7 days after reprice: %v", err)
	}
	if after.PriceKobo != 7*repriceKobo {
		t.Errorf("7-day price after reprice = %d kobo, want %d — a cached rate would keep charging the old one",
			after.PriceKobo, 7*repriceKobo)
	}
	pricing, err := svc.BoostPricing(ctx)
	if err != nil {
		t.Fatalf("pricing after reprice: %v", err)
	}
	if pricing.DailyRateKobo != repriceKobo {
		t.Errorf("GET /boosts/pricing rate = %d, want %d", pricing.DailyRateKobo, repriceKobo)
	}
	if len(pricing.PresetDurationDays) == 0 {
		t.Error("pricing must publish the durations the purchase screen offers as one tap")
	}
	if pricing.MinDurationDays != 1 || pricing.MaxDurationDays != 90 {
		t.Errorf("pricing bounds = [%d,%d], want [1,90]", pricing.MinDurationDays, pricing.MaxDurationDays)
	}

	// A part-day range bills a whole day UP (money rule: integers, and never a
	// fraction of kobo in the payer's favour).
	ends := time.Now().Add(24*time.Hour + 10*time.Minute)
	partDay, err := svc.ComputeBoostQuote(ctx, 0, &ends)
	if err != nil {
		t.Fatalf("quote a 1-day-10-minute range: %v", err)
	}
	if partDay.DurationDays != 2 {
		t.Errorf("1 day + 10 minutes billed as %d days, want 2 (round UP)", partDay.DurationDays)
	}
	if want := 2 * repriceKobo; partDay.PriceKobo != want {
		t.Errorf("price = %d kobo, want %d", partDay.PriceKobo, want)
	}

	// Rejects: neither param, both params, and past the cap.
	if _, err := svc.ComputeBoostQuote(ctx, 0, nil); err == nil {
		t.Error("a quote with neither duration_days nor ends_at was accepted")
	}
	if _, err := svc.ComputeBoostQuote(ctx, 7, &ends); err == nil {
		t.Error("a quote with BOTH duration_days and ends_at was accepted")
	}
	var ce *mkt.CodedError
	far := time.Now().Add(200 * 24 * time.Hour)
	if _, err := svc.ComputeBoostQuote(ctx, 0, &far); !errors.As(err, &ce) || ce.Code != mkt.CodeInvalidBoostRange {
		t.Errorf("a 200-day range err = %v, want %s", err, mkt.CodeInvalidBoostRange)
	}
	if _, err := svc.ComputeBoostQuote(ctx, 91, nil); !errors.As(err, &ce) || ce.Code != mkt.CodeInvalidBoostRange {
		t.Errorf("duration_days=91 err = %v, want %s", err, mkt.CodeInvalidBoostRange)
	}

	// The rate prices every boost, so a 0 row would sell promotion for nothing —
	// the setter must refuse it, and the live row must survive the attempt.
	if _, err := svc.SetBoostDailyRate(ctx, uuid.NewString(), 0, "price_adjustment"); !errors.As(err, &ce) || ce.Code != mkt.CodeValidation {
		t.Errorf("zero daily rate err = %v, want %s (a 0 rate makes every boost free)", err, mkt.CodeValidation)
	}
	if still, err := svc.BoostPricing(ctx); err != nil || still.DailyRateKobo != repriceKobo {
		t.Errorf("rate after the refused zero write = %+v/%v, want %d", still, err, repriceKobo)
	}
}
