package marketplace

// LIVE-DB tests for the alert producers (new listing from a followed seller;
// saved-item price drop). TEST_DATABASE_URL-gated. Needs migration
// 20271025000000_mkt_alert_producers.sql.
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/marketplace/ -run TestLiveDB_Alerts -v

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func alertCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, uid, typ string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mkt_notifications WHERE user_id=$1 AND type=$2::mkt_notification_type`, uid, typ).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func alertFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, users ...string) {
	t.Helper()
	t.Cleanup(func() {
		bg := context.WithoutCancel(ctx)
		for _, u := range users {
			_, _ = pool.Exec(bg, `DELETE FROM mkt_notifications WHERE user_id=$1`, u)
			_, _ = pool.Exec(bg, `DELETE FROM mkt_seller_follows WHERE follower_id=$1 OR seller_id=$1`, u)
			_, _ = pool.Exec(bg, `DELETE FROM mkt_blocks WHERE user_id=$1 OR blocked_user_id=$1`, u)
			_, _ = pool.Exec(bg, `DELETE FROM mkt_saved_items WHERE user_id=$1`, u)
			_, _ = pool.Exec(bg, `DELETE FROM mkt_notification_prefs WHERE user_id=$1`, u)
		}
	})
}

func TestLiveDB_Alerts_NewListingFanOut(t *testing.T) {
	ctx := context.Background()
	pool := makercheckTestPool(t)
	svc := NewService(pool, nil, nil).WithListingAlerts(true)

	seller := seedBoostSeller(t, ctx, pool, 3)
	plain := seedBoostSeller(t, ctx, pool, 1)
	blockedByFollower := seedBoostSeller(t, ctx, pool, 1)
	blockedBySeller := seedBoostSeller(t, ctx, pool, 1)
	optedOut := seedBoostSeller(t, ctx, pool, 1)
	nonFollower := seedBoostSeller(t, ctx, pool, 1)
	alertFixture(t, ctx, pool, seller, plain, blockedByFollower, blockedBySeller, optedOut, nonFollower)

	for _, f := range []string{plain, blockedByFollower, blockedBySeller, optedOut} {
		if _, err := pool.Exec(ctx, `INSERT INTO mkt_seller_follows (follower_id, seller_id) VALUES ($1,$2)`, f, seller); err != nil {
			t.Fatal(err)
		}
	}
	mustExec := func(q string, a ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, a...); err != nil {
			t.Fatal(err)
		}
	}
	mustExec(`INSERT INTO mkt_blocks (user_id, blocked_user_id) VALUES ($1,$2)`, blockedByFollower, seller)
	mustExec(`INSERT INTO mkt_blocks (user_id, blocked_user_id) VALUES ($1,$2)`, seller, blockedBySeller)
	mustExec(`INSERT INTO mkt_notification_prefs (user_id, new_listing) VALUES ($1,false)`, optedOut)

	cat := seedBoostCategory(t, ctx, pool)
	lid := seedActiveListing(t, ctx, pool, seller, cat)
	l := &Listing{ID: lid, SellerID: seller, Title: "Fresh fridge", PriceKobo: 25000000}

	svc.fanOutNewListing(ctx, l)
	for name, tc := range map[string]struct {
		uid  string
		want int
	}{
		"follower gets it":            {plain, 1},
		"follower who blocked seller": {blockedByFollower, 0},
		"follower seller blocked":     {blockedBySeller, 0},
		"prefs opt-out":               {optedOut, 0},
		"non-follower":                {nonFollower, 0},
	} {
		if got := alertCount(t, ctx, pool, tc.uid, "new_listing"); got != tc.want {
			t.Errorf("%s: want %d, got %d", name, tc.want, got)
		}
	}

	// Replay (retry / double-approve) adds nothing.
	svc.fanOutNewListing(ctx, l)
	if got := alertCount(t, ctx, pool, plain, "new_listing"); got != 1 {
		t.Fatalf("replay must be idempotent, got %d rows", got)
	}

	// A different listing from the same seller is a new alert.
	l2 := &Listing{ID: seedActiveListing(t, ctx, pool, seller, cat), SellerID: seller, Title: "Sofa", PriceKobo: 9000000}
	svc.fanOutNewListing(ctx, l2)
	if got := alertCount(t, ctx, pool, plain, "new_listing"); got != 2 {
		t.Fatalf("second listing should notify, got %d", got)
	}
}

func TestLiveDB_Alerts_NewListingBoundedPaging(t *testing.T) {
	ctx := context.Background()
	pool := makercheckTestPool(t)
	svc := NewService(pool, nil, nil).WithListingAlerts(true)
	seller := seedBoostSeller(t, ctx, pool, 3)
	cat := seedBoostCategory(t, ctx, pool)
	lid := seedActiveListing(t, ctx, pool, seller, cat)

	// More followers than one page, so the keyset cursor must advance.
	n := alertBatchSize + 25
	ids := make([]string, n)
	for i := range ids {
		ids[i] = uuid.NewString()
	}
	alertFixture(t, ctx, pool, append(ids, seller)...)
	if _, err := pool.Exec(ctx, `INSERT INTO mkt_seller_follows (follower_id, seller_id) SELECT unnest($1::uuid[]), $2::uuid`, ids, seller); err != nil {
		t.Fatal(err)
	}
	svc.fanOutNewListing(ctx, &Listing{ID: lid, SellerID: seller, Title: "Bulk", PriceKobo: 100})
	var got int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM mkt_notifications WHERE related_id=$1 AND type='new_listing'`, lid).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != n {
		t.Fatalf("want %d notified across pages, got %d", n, got)
	}
}

func TestLiveDB_Alerts_FlagOffIsSilent(t *testing.T) {
	ctx := context.Background()
	pool := makercheckTestPool(t)
	svc := NewService(pool, nil, nil) // alerts off
	seller := seedBoostSeller(t, ctx, pool, 3)
	f := seedBoostSeller(t, ctx, pool, 1)
	alertFixture(t, ctx, pool, seller, f)
	if _, err := pool.Exec(ctx, `INSERT INTO mkt_seller_follows (follower_id, seller_id) VALUES ($1,$2)`, f, seller); err != nil {
		t.Fatal(err)
	}
	svc.notifyFollowersOfListing(&Listing{ID: uuid.NewString(), SellerID: seller, Title: "x"})
	if got := alertCount(t, ctx, pool, f, "new_listing"); got != 0 {
		t.Fatalf("flag off must not notify, got %d", got)
	}
}

func TestLiveDB_Alerts_SavedPriceDrop(t *testing.T) {
	ctx := context.Background()
	pool := makercheckTestPool(t)
	svc := NewService(pool, nil, nil).WithListingAlerts(true)

	seller := seedBoostSeller(t, ctx, pool, 3)
	saver := seedBoostSeller(t, ctx, pool, 1)
	cheapSaver := seedBoostSeller(t, ctx, pool, 1) // saved at a price already below the new one
	optedOut := seedBoostSeller(t, ctx, pool, 1)
	blocked := seedBoostSeller(t, ctx, pool, 1)
	alertFixture(t, ctx, pool, seller, saver, cheapSaver, optedOut, blocked)

	cat := seedBoostCategory(t, ctx, pool)
	lid := seedActiveListing(t, ctx, pool, seller, cat)
	for u, saved := range map[string]int64{saver: 500000, cheapSaver: 350000, optedOut: 500000, blocked: 500000} {
		if _, err := pool.Exec(ctx, `INSERT INTO mkt_saved_items (user_id, listing_id, saved_price_kobo) VALUES ($1,$2,$3)`, u, lid, saved); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO mkt_notification_prefs (user_id, price_drop) VALUES ($1,false)`, optedOut); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO mkt_blocks (user_id, blocked_user_id) VALUES ($1,$2)`, seller, blocked); err != nil {
		t.Fatal(err)
	}
	l := &Listing{ID: lid, SellerID: seller, Title: "Phone", Status: ListingActive}

	svc.fanOutPriceDrop(ctx, l, 500000, 400000)
	want := map[string]int{saver: 1, cheapSaver: 0, optedOut: 0, blocked: 0}
	for u, w := range want {
		if got := alertCount(t, ctx, pool, u, "price_dropped"); got != w {
			t.Errorf("user %s: want %d, got %d", u, w, got)
		}
	}

	// Same drop replayed: still one.
	svc.fanOutPriceDrop(ctx, l, 500000, 400000)
	if got := alertCount(t, ctx, pool, saver, "price_dropped"); got != 1 {
		t.Fatalf("replay must be idempotent, got %d", got)
	}
	// A further drop is a new alert; a rise is not a drop.
	svc.fanOutPriceDrop(ctx, l, 400000, 300000)
	if got := alertCount(t, ctx, pool, saver, "price_dropped"); got != 2 {
		t.Fatalf("further drop should notify, got %d", got)
	}
	svc.fanOutPriceDrop(ctx, l, 300000, 320000)
	if got := alertCount(t, ctx, pool, saver, "price_dropped"); got != 2 {
		t.Fatalf("rise must not notify, got %d", got)
	}
}
