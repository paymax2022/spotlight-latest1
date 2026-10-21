package restaurant

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// availableNow is an item's availability at read time: the owner's flag, or a restock
// time that has passed. A timed restock needs no job, because it is decided on read.
const availableNow = "(is_available OR (unavailable_until IS NOT NULL AND unavailable_until <= now()))"

// menuItemCols is the item read shared by the menu and the single-item read. prep_minutes
// is the effective prep time: the item's own, or the restaurant's default.
const menuItemCols = `id, category_id, restaurant_id, name, COALESCE(description,''), price_kobo, image_url, ` + availableNow + ` AS is_available, dietary_tags,
	prep_time_minutes,
	COALESCE(prep_time_minutes, (SELECT r.prep_time_minutes FROM restaurants r WHERE r.id = menu_items.restaurant_id)) AS prep_minutes`

// menuItemColsV adds the optimistic-concurrency version and the seller's per-order cap
// (FOOD-UAT-B-006/008) for the reads that return them to clients.
const menuItemColsV = menuItemCols + `, version, max_qty_per_order`

// maxBulkAvailabilityIDs bounds one bulk toggle, so one request cannot touch an
// unbounded number of rows.
const maxBulkAvailabilityIDs = 200

// SetItemsAvailable flips many of a restaurant's items at once. Every id must belong to
// that restaurant; ids from another restaurant are ignored, not changed. Turning items
// back on clears any restock time, and turning them off clears it too, since a manual
// flip supersedes a timed one.
func (s *Service) SetItemsAvailable(ctx context.Context, restaurantID, userID string, ids []string, available bool) (int64, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageMenu); err != nil {
		return 0, err
	}
	return setItemsAvailable(ctx, s.db, restaurantID, ids, available)
}

func setItemsAvailable(ctx context.Context, db *pgxpool.Pool, restaurantID string, ids []string, available bool) (int64, error) {
	if len(ids) == 0 {
		return 0, errors.New("restaurant: choose at least one item")
	}
	if len(ids) > maxBulkAvailabilityIDs {
		return 0, fmt.Errorf("restaurant: at most %d items per change", maxBulkAvailabilityIDs)
	}
	tag, err := db.Exec(ctx, `
		UPDATE menu_items SET is_available=$1, unavailable_until=NULL
		 WHERE restaurant_id=$2 AND id = ANY($3::uuid[])`, available, restaurantID, ids)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// restockAt validates an owner-supplied restock time: it must be in the future, since a
// past time would make the item available straight away and read as a mistake.
func restockAt(raw *string, now time.Time) (*time.Time, error) {
	if raw == nil || *raw == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, *raw)
	if err != nil {
		return nil, errors.New("restaurant: unavailable_until must be an RFC 3339 time")
	}
	if !t.After(now) {
		return nil, errors.New("restaurant: unavailable_until must be in the future")
	}
	return &t, nil
}
