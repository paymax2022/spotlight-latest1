package marketplace

// LIVE-DB tests for follow / saved / block behaviour behind the mobile Account hub.
// TEST_DATABASE_URL-gated; reuses the boost-test seed helpers.

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func listingOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, owner, cat string) string {
	return seedActiveListing(t, ctx, pool, owner, cat)
}

func TestLiveDB_FollowTrust(t *testing.T) {
	pool := makercheckTestPool(t)
	ctx := context.Background()
	svc := NewService(pool, nil, nil)

	seller := seedBoostSeller(t, ctx, pool, 3)
	buyer := seedBoostSeller(t, ctx, pool, 1)
	if _, err := pool.Exec(ctx, `UPDATE user_profiles SET full_name='Tunde Adeyemi' WHERE id=$1`, seller); err != nil {
		t.Fatal(err)
	}
	cat := seedBoostCategory(t, ctx, pool)
	listing := seedActiveListing(t, ctx, pool, seller, cat)
	t.Cleanup(func() {
		bg := context.WithoutCancel(ctx)
		_, _ = pool.Exec(bg, `DELETE FROM mkt_seller_follows WHERE follower_id IN ($1,$2) OR seller_id IN ($1,$2)`, seller, buyer)
		_, _ = pool.Exec(bg, `DELETE FROM mkt_blocks WHERE user_id IN ($1,$2)`, seller, buyer)
		_, _ = pool.Exec(bg, `DELETE FROM mkt_saved_items WHERE user_id IN ($1,$2)`, seller, buyer)
		_, _ = pool.Exec(bg, `DELETE FROM mkt_threads WHERE buyer_id IN ($1,$2)`, seller, buyer)
	})

	t.Run("profile has privacy-safe name and counts", func(t *testing.T) {
		v, err := svc.SellerProfile(ctx, seller)
		if err != nil {
			t.Fatal(err)
		}
		if v.Name != "Tunde A." || v.ID != seller || v.ActiveListings != 1 {
			t.Fatalf("unexpected view %+v", v)
		}
	})

	t.Run("unknown seller is 404, bad id is 400", func(t *testing.T) {
		if _, err := svc.SellerProfile(ctx, uuid.NewString()); !errors.Is(err, ErrSellerNotFound) {
			t.Fatalf("want ErrSellerNotFound, got %v", err)
		}
		if _, err := svc.SellerProfile(ctx, "nope"); err == nil {
			t.Fatal("want validation error")
		}
		if _, err := svc.FollowSeller(ctx, buyer, uuid.NewString()); !errors.Is(err, ErrSellerNotFound) {
			t.Fatalf("follow unknown: %v", err)
		}
		if _, err := svc.FollowSeller(ctx, buyer, buyer); !errors.Is(err, ErrCannotFollowSelf) {
			t.Fatalf("follow self: %v", err)
		}
	})

	t.Run("follow is idempotent and counted and listed", func(t *testing.T) {
		for i := 0; i < 2; i++ {
			f, err := svc.FollowSeller(ctx, buyer, seller)
			if err != nil {
				t.Fatalf("follow #%d: %v", i, err)
			}
			if f.SellerID != seller || f.SellerName != "Tunde A." {
				t.Fatalf("bad follow %+v", f)
			}
		}
		v, _ := svc.SellerProfile(ctx, seller)
		if v.FollowerCount != 1 {
			t.Fatalf("followers = %d, want 1", v.FollowerCount)
		}
		list, err := svc.ListFollowedSellers(ctx, buyer)
		if err != nil || len(list) != 1 {
			t.Fatalf("list = %v, %v", list, err)
		}
		if err := svc.UnfollowSeller(ctx, buyer, seller); err != nil {
			t.Fatal(err)
		}
		if list, _ := svc.ListFollowedSellers(ctx, buyer); len(list) != 0 {
			t.Fatalf("still following: %v", list)
		}
	})

	t.Run("blocking stops contact in both directions and hides nothing else", func(t *testing.T) {
		if _, err := svc.BlockUser(ctx, buyer, seller); err != nil {
			t.Fatalf("block: %v", err)
		}
		bl, err := svc.ListBlocks(ctx, buyer)
		if err != nil || len(bl) != 1 || bl[0].BlockedUserName != "Tunde A." {
			t.Fatalf("blocks = %+v, %v", bl, err)
		}
		if _, err := svc.StartOrGetThread(ctx, buyer, listing, "hello"); !errors.Is(err, ErrUserBlocked) {
			t.Fatalf("blocker->blocked thread: %v", err)
		}
		if _, err := svc.CreateOffer(ctx, buyer, listing, 5000, ""); !errors.Is(err, ErrUserBlocked) {
			t.Fatalf("offer: %v", err)
		}
		if _, err := svc.RevealSellerContact(ctx, buyer, listing); !errors.Is(err, ErrUserBlocked) {
			t.Fatalf("reveal: %v", err)
		}
		if _, err := svc.FollowSeller(ctx, buyer, seller); !errors.Is(err, ErrUserBlocked) {
			t.Fatalf("follow: %v", err)
		}
		// Reverse direction: the blocked seller cannot start contact with the blocker either.
		if _, err := svc.StartOrGetThread(ctx, seller, listingOf(t, ctx, pool, buyer, cat), "hi"); !errors.Is(err, ErrUserBlocked) {
			t.Fatalf("blocked->blocker thread: %v", err)
		}
		if err := svc.UnblockUser(ctx, buyer, bl[0].ID); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.StartOrGetThread(ctx, buyer, listing, "hello"); err != nil {
			t.Fatalf("after unblock: %v", err)
		}
	})
}
