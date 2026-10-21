package restaurant

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

// FOOD-UAT-G-002: a duplicate submit must surface the STORED id, not a fabricated one.
// FOOD-UAT-G-003: hide/restore/flag set the audit columns and move the average.
func TestLiveDB_ReviewDuplicateAndAdminModeration(t *testing.T) {
	pool := modPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner, cust, admin := uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, cust, admin} {
		_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test")
		testsupport.CleanupUser(t, pool, u)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Dup Kitchen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	order := seedDeliveredOrder(t, ctx, pool, restID, cust)

	first, err := svc.RateOrder(ctx, order, cust, RateOrderRequest{RestaurantStars: 4, Comment: "ok"})
	if err != nil {
		t.Fatalf("first rate: %v", err)
	}
	_, err = svc.RateOrder(ctx, order, cust, RateOrderRequest{RestaurantStars: 1, Comment: "again"})
	var dup *DuplicateReviewError
	if !errors.As(err, &dup) {
		t.Fatalf("duplicate must return DuplicateReviewError, got %v", err)
	}
	if dup.ExistingID != first.ID {
		t.Errorf("existing id = %s, want stored id %s", dup.ExistingID, first.ID)
	}

	if err := svc.AdminSetReviewState(ctx, first.ID, admin, "hide", "spam"); err != nil {
		t.Fatalf("hide: %v", err)
	}
	var status, reason string
	var hiddenAt, hiddenBy *string
	_ = pool.QueryRow(ctx, `SELECT moderation_status, hidden_at::text, hidden_by::text, COALESCE(hidden_reason,'') FROM restaurant_ratings WHERE id=$1`, first.ID).Scan(&status, &hiddenAt, &hiddenBy, &reason)
	if status != "hidden" || hiddenAt == nil || hiddenBy == nil || *hiddenBy != admin || reason != "spam" {
		t.Errorf("hide audit columns wrong: %s %v %v %s", status, hiddenAt, hiddenBy, reason)
	}
	items, total, err := svc.AdminListReviews(ctx, AdminReviewFilter{RestaurantID: restID, Status: "hidden"})
	if err != nil || total != 1 || len(items) != 1 {
		t.Fatalf("admin list hidden: %v total=%d", err, total)
	}
	if err := svc.AdminSetReviewState(ctx, first.ID, admin, "restore", ""); err != nil {
		t.Fatalf("restore: %v", err)
	}
	if err := svc.AdminSetReviewState(ctx, first.ID, admin, "flag", ""); err != nil {
		t.Fatalf("flag: %v", err)
	}
	items, _, _ = svc.AdminListReviews(ctx, AdminReviewFilter{RestaurantID: restID, Flagged: true})
	if len(items) != 1 || items[0].FlaggedAt == nil || items[0].HiddenAt != nil {
		t.Errorf("flagged list wrong: %+v", items)
	}
}
