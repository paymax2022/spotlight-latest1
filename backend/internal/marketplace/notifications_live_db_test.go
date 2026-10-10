package marketplace

// LIVE-DB tests for the marketplace notifications inbox and saved-search alert
// frequency. TEST_DATABASE_URL-gated (pool via t.Cleanup, never defer).
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/marketplace/... -run TestLiveDB_Notif -v

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func notifSeedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, id+"@seed.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM mkt_notifications WHERE user_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM mkt_saved_searches WHERE user_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM auth.users WHERE id=$1`, id)
	})
	return id
}

// A row whose body and related_id are NULL used to make the whole list 500,
// because both were scanned into plain strings.
func TestLiveDB_Notif_ListSurvivesNullBodyAndRelatedID(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	uid := notifSeedUser(t, ctx, pool)

	if _, err := pool.Exec(ctx,
		`INSERT INTO mkt_notifications (user_id, type, title) VALUES ($1, 'new_offer', 'Bare row')`, uid); err != nil {
		t.Fatalf("seed null-column row: %v", err)
	}
	if _, err := svc.CreateNotification(ctx, uid, "price_dropped", "With body", "body text", map[string]any{"k": "v"}, ""); err != nil {
		t.Fatalf("CreateNotification with empty related id: %v", err)
	}

	got, err := svc.ListNotifications(ctx, uid, 20, 0)
	if err != nil {
		t.Fatalf("ListNotifications: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 notifications, got %d", len(got))
	}
}

func TestLiveDB_Notif_MarkReadAndUnknownID(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	uid := notifSeedUser(t, ctx, pool)

	n, err := svc.CreateNotification(ctx, uid, "new_offer", "Offer", "", nil, "")
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	read, err := svc.MarkNotificationRead(ctx, uid, n.ID)
	if err != nil || !read.IsRead {
		t.Fatalf("mark read: %v / %+v", err, read)
	}
	// Unknown id must be a clean 404, not a 500 from comparing the wrong ErrNoRows.
	_, err = svc.MarkNotificationRead(ctx, uid, uuid.New().String())
	ce, ok := err.(*CodedError)
	if !ok || ce.Status != 404 {
		t.Fatalf("want 404 CodedError for unknown notification, got %v", err)
	}
	if err := svc.MarkAllNotificationsRead(ctx, uid); err != nil {
		t.Fatalf("mark all: %v", err)
	}
	if c, _ := svc.GetUnreadNotificationCount(ctx, uid); c != 0 {
		t.Fatalf("want 0 unread, got %d", c)
	}
}

// A price drop must reach people who saved the listing, and nobody else.
func TestLiveDB_Notif_PriceDropReachesSavers(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	saver := notifSeedUser(t, ctx, pool)
	other := notifSeedUser(t, ctx, pool)
	seller := notifSeedUser(t, ctx, pool)

	cat := cmsSeedCategory(t, ctx, pool)
	listingID := uuid.New().String()
	if _, err := pool.Exec(ctx, `
		INSERT INTO mkt_listings (id, market_id, seller_id, category_id, title, description, price_kobo, currency, condition, status, state)
		VALUES ($1,'NG',$2,$3,'Test listing','a clean used phone in very good working condition',500000,'NGN','used','active','Lagos')`, listingID, seller, cat); err != nil {
		t.Fatalf("seed listing: %v", err)
	}
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM mkt_saved_items WHERE listing_id=$1`, listingID)
		_, _ = pool.Exec(c, `DELETE FROM mkt_listings WHERE id=$1`, listingID)
	})
	if _, err := pool.Exec(ctx, `INSERT INTO mkt_saved_items (user_id, listing_id, saved_price_kobo) VALUES ($1,$2,500000)`, saver, listingID); err != nil {
		t.Fatalf("seed saved item: %v", err)
	}

	l := &Listing{ID: listingID, SellerID: seller, Title: "Test listing"}
	svc.emitPriceDropNotifications(ctx, l, 500000, 400000)

	if got, _ := svc.ListNotifications(ctx, saver, 20, 0); len(got) != 1 || got[0].Type != "price_dropped" {
		t.Fatalf("saver should get one price_dropped, got %+v", got)
	}
	if got, _ := svc.ListNotifications(ctx, other, 20, 0); len(got) != 0 {
		t.Fatalf("non-saver must get nothing, got %+v", got)
	}
	// A price RISE is not a drop.
	svc.emitPriceDropNotifications(ctx, l, 400000, 450000)
	if got, _ := svc.ListNotifications(ctx, saver, 20, 0); len(got) != 1 {
		t.Fatalf("price rise must not notify, got %d", len(got))
	}
}

func TestLiveDB_Notif_SavedSearchAlertFrequencyPersists(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	uid := notifSeedUser(t, ctx, pool)

	q := "iphone"
	ss, err := svc.CreateSavedSearch(ctx, uid, SavedSearch{Query: &q, AlertEnabled: true})
	if err != nil || ss.AlertFrequency != "instant" {
		t.Fatalf("create: %v / freq=%q", err, ss.AlertFrequency)
	}
	if err := svc.ToggleSavedSearchAlert(ctx, uid, ss.ID, true, "daily"); err != nil {
		t.Fatalf("toggle daily: %v", err)
	}
	list, _ := svc.ListSavedSearches(ctx, uid)
	if len(list) != 1 || list[0].AlertFrequency != "daily" || !list[0].AlertEnabled {
		t.Fatalf("daily should persist, got %+v", list)
	}
	if err := svc.ToggleSavedSearchAlert(ctx, uid, ss.ID, true, "off"); err != nil {
		t.Fatalf("toggle off: %v", err)
	}
	list, _ = svc.ListSavedSearches(ctx, uid)
	if list[0].AlertFrequency != "off" || list[0].AlertEnabled {
		t.Fatalf("off must clear alert_enabled too, got %+v", list[0])
	}
	// Another user cannot touch it.
	if err := svc.ToggleSavedSearchAlert(ctx, uuid.New().String(), ss.ID, true, "instant"); err != ErrForbidden {
		t.Fatalf("want ErrForbidden for non-owner, got %v", err)
	}
}

// Two quick messages in one thread must be ONE unread inbox row, not two.
func TestLiveDB_Notif_MessageNotificationDedupesPerThread(t *testing.T) {
	ctx := context.Background()
	pool := cmsTestPool(t)
	svc := NewService(pool, nil, nil)
	uid := notifSeedUser(t, ctx, pool)
	thread := uuid.New().String()

	for i := 0; i < 2; i++ {
		if err := svc.insertMessageNotification(ctx, uid, thread); err != nil {
			t.Fatalf("insert #%d: %v", i, err)
		}
	}
	got, err := svc.ListNotifications(ctx, uid, 20, 0)
	if err != nil || len(got) != 1 || got[0].Type != "message_new" {
		t.Fatalf("want exactly one message_new, got %+v (err %v)", got, err)
	}
	if got[0].RelatedID != thread {
		t.Fatalf("related_id should be the thread, got %q", got[0].RelatedID)
	}
	// Once read, the next message creates a fresh row.
	if _, err := svc.MarkNotificationRead(ctx, uid, got[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.insertMessageNotification(ctx, uid, thread); err != nil {
		t.Fatal(err)
	}
	if got, _ = svc.ListNotifications(ctx, uid, 20, 0); len(got) != 2 {
		t.Fatalf("after read, a new message should add a row; got %d", len(got))
	}
}
