package restaurant

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrDiscountNotFound = errors.New("restaurant: discount not found")
	ErrDiscountInvalid  = errors.New("restaurant: discount invalid")
)

// DiscountInput is an owner's create request.
type DiscountInput struct {
	Name            string    `json:"name" binding:"required,min=1,max=80"`
	Kind            string    `json:"kind" binding:"required"`
	Value           int64     `json:"value" binding:"required"`
	Scope           string    `json:"scope" binding:"required"`
	StartsAt        time.Time `json:"starts_at" binding:"required"`
	EndsAt          time.Time `json:"ends_at" binding:"required"`
	MaxDiscountKobo *int64    `json:"max_discount_kobo,omitempty"`
	ItemIDs         []string  `json:"item_ids,omitempty"`
	CategoryIDs     []string  `json:"taxonomy_category_ids,omitempty"`
}

// DiscountRow is one discount as the owner sees it.
type DiscountRow struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	Kind            string    `json:"kind"`
	Value           int64     `json:"value"`
	Scope           string    `json:"scope"`
	StartsAt        time.Time `json:"starts_at"`
	EndsAt          time.Time `json:"ends_at"`
	IsActive        bool      `json:"is_active"`
	MaxDiscountKobo *int64    `json:"max_discount_kobo,omitempty"`
	ItemIDs         []string  `json:"item_ids"`
	CategoryIDs     []string  `json:"taxonomy_category_ids"`
}

// ValidateDiscount checks the rules that do not need the database.
func ValidateDiscount(in DiscountInput) error {
	if strings.TrimSpace(in.Name) == "" || len(in.Name) > 80 {
		return fmt.Errorf("%w: name must be 1 to 80 characters", ErrDiscountInvalid)
	}
	switch in.Kind {
	case discountPercent:
		if in.Value < 1 || in.Value > 90 {
			return fmt.Errorf("%w: a percentage must be 1 to 90", ErrDiscountInvalid)
		}
	case discountFixed:
		if in.Value <= 0 || in.Value > maxItemPriceKobo {
			return fmt.Errorf("%w: a fixed amount must be more than zero and within the item price limit", ErrDiscountInvalid)
		}
	default:
		return fmt.Errorf("%w: kind must be PERCENT or FIXED", ErrDiscountInvalid)
	}
	switch in.Scope {
	case scopeItem:
		if len(in.ItemIDs) == 0 {
			return fmt.Errorf("%w: an item discount needs at least one item", ErrDiscountInvalid)
		}
	case scopeCategory:
		if len(in.CategoryIDs) == 0 {
			return fmt.Errorf("%w: a category discount needs at least one category", ErrDiscountInvalid)
		}
	case scopeRestaurant:
	default:
		return fmt.Errorf("%w: scope must be ITEM, CATEGORY or RESTAURANT", ErrDiscountInvalid)
	}
	if !in.EndsAt.After(in.StartsAt) {
		return fmt.Errorf("%w: the end must be after the start", ErrDiscountInvalid)
	}
	if in.MaxDiscountKobo != nil && *in.MaxDiscountKobo <= 0 {
		return fmt.Errorf("%w: the cap must be more than zero", ErrDiscountInvalid)
	}
	return nil
}

// CreateDiscount stores a discount. Every item must be this restaurant's own, and every
// category must be an active node in the taxonomy; anything else is refused, so an owner
// cannot discount another shop's menu.
func (s *Service) CreateDiscount(ctx context.Context, restaurantID, userID string, in DiscountInput) (DiscountRow, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageMenu); err != nil {
		return DiscountRow{}, err
	}
	if err := ValidateDiscount(in); err != nil {
		return DiscountRow{}, err
	}
	if err := checkDiscountTargets(ctx, s.db, restaurantID, in); err != nil {
		return DiscountRow{}, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return DiscountRow{}, err
	}
	defer tx.Rollback(ctx)
	id := uuid.New().String()
	if _, err := tx.Exec(ctx, `
		INSERT INTO restaurant_discounts (id, restaurant_id, name, kind, value, scope, starts_at, ends_at, max_discount_kobo)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		id, restaurantID, strings.TrimSpace(in.Name), in.Kind, in.Value, in.Scope, in.StartsAt, in.EndsAt, in.MaxDiscountKobo); err != nil {
		return DiscountRow{}, err
	}
	for _, item := range uniq(in.ItemIDs) {
		if _, err := tx.Exec(ctx, `INSERT INTO restaurant_discount_items (discount_id, menu_item_id) VALUES ($1,$2)`, id, item); err != nil {
			return DiscountRow{}, err
		}
	}
	for _, cat := range uniq(in.CategoryIDs) {
		if _, err := tx.Exec(ctx, `INSERT INTO restaurant_discount_categories (discount_id, taxonomy_category_id) VALUES ($1,$2)`, id, cat); err != nil {
			return DiscountRow{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return DiscountRow{}, err
	}
	return s.getDiscount(ctx, restaurantID, id)
}

// checkDiscountTargets confirms the items belong to the restaurant and the categories
// exist and are active.
func checkDiscountTargets(ctx context.Context, db *pgxpool.Pool, restaurantID string, in DiscountInput) error {
	if in.Scope == scopeItem {
		var n int
		if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM menu_items WHERE restaurant_id=$1 AND id = ANY($2::uuid[])`,
			restaurantID, uniq(in.ItemIDs)).Scan(&n); err != nil {
			return err
		}
		if n != len(uniq(in.ItemIDs)) {
			return fmt.Errorf("%w: every item must be on this restaurant's menu", ErrDiscountInvalid)
		}
	}
	if in.Scope == scopeCategory {
		var n int
		if err := db.QueryRow(ctx, `SELECT COUNT(*) FROM restaurant_taxonomy_categories WHERE is_active AND id = ANY($1::uuid[])`,
			uniq(in.CategoryIDs)).Scan(&n); err != nil {
			return err
		}
		if n != len(uniq(in.CategoryIDs)) {
			return fmt.Errorf("%w: every category must exist and be active", ErrDiscountInvalid)
		}
	}
	return nil
}

// SetDiscountActive pauses or resumes a discount. Pausing takes effect at the next read.
func (s *Service) SetDiscountActive(ctx context.Context, restaurantID, userID, id string, active bool) (DiscountRow, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageMenu); err != nil {
		return DiscountRow{}, err
	}
	tag, err := s.db.Exec(ctx, `UPDATE restaurant_discounts SET is_active=$3, updated_at=NOW() WHERE id=$1 AND restaurant_id=$2`,
		id, restaurantID, active)
	if err != nil {
		return DiscountRow{}, err
	}
	if tag.RowsAffected() == 0 {
		return DiscountRow{}, ErrDiscountNotFound
	}
	return s.getDiscount(ctx, restaurantID, id)
}

// DeleteDiscount removes a discount. Orders keep their recorded discount amount, since
// order_items.discount_id is set to NULL and the kobo is kept on the line.
func (s *Service) DeleteDiscount(ctx context.Context, restaurantID, userID, id string) error {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageMenu); err != nil {
		return err
	}
	tag, err := s.db.Exec(ctx, `DELETE FROM restaurant_discounts WHERE id=$1 AND restaurant_id=$2`, id, restaurantID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrDiscountNotFound
	}
	return nil
}

// ListDiscounts returns every discount for the owner's view, newest first.
func (s *Service) ListDiscounts(ctx context.Context, restaurantID, userID string) ([]DiscountRow, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageMenu); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT id FROM restaurant_discounts WHERE restaurant_id=$1 ORDER BY created_at DESC`, restaurantID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	out := make([]DiscountRow, 0, len(ids))
	for _, id := range ids {
		d, err := s.getDiscount(ctx, restaurantID, id)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, nil
}

func (s *Service) getDiscount(ctx context.Context, restaurantID, id string) (DiscountRow, error) {
	var d DiscountRow
	err := s.db.QueryRow(ctx, `
		SELECT id, name, kind, value, scope, starts_at, ends_at, is_active, max_discount_kobo
		  FROM restaurant_discounts WHERE id=$1 AND restaurant_id=$2`, id, restaurantID).Scan(
		&d.ID, &d.Name, &d.Kind, &d.Value, &d.Scope, &d.StartsAt, &d.EndsAt, &d.IsActive, &d.MaxDiscountKobo)
	if errors.Is(err, pgx.ErrNoRows) {
		return DiscountRow{}, ErrDiscountNotFound
	}
	if err != nil {
		return DiscountRow{}, err
	}
	d.ItemIDs = []string{}
	d.CategoryIDs = []string{}
	if err := collectIDs(ctx, s.db, `SELECT menu_item_id::text FROM restaurant_discount_items WHERE discount_id=$1`, id, &d.ItemIDs); err != nil {
		return DiscountRow{}, err
	}
	if err := collectIDs(ctx, s.db, `SELECT taxonomy_category_id::text FROM restaurant_discount_categories WHERE discount_id=$1`, id, &d.CategoryIDs); err != nil {
		return DiscountRow{}, err
	}
	return d, nil
}

func collectIDs(ctx context.Context, db *pgxpool.Pool, q, id string, into *[]string) error {
	rows, err := db.Query(ctx, q, id)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return err
		}
		*into = append(*into, v)
	}
	return rows.Err()
}

func uniq(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range in {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

// loadLiveDiscounts returns the restaurant's discounts that are on at t, with the items
// and categories each one covers. Paused and out-of-window rows are left out here, so
// the pricing function never has to think about them.
func loadLiveDiscounts(ctx context.Context, db *pgxpool.Pool, restaurantID string, t time.Time) ([]PriceDiscount, error) {
	rows, err := db.Query(ctx, `
		SELECT id, name, kind, value, scope, starts_at, ends_at, is_active, max_discount_kobo
		  FROM restaurant_discounts
		 WHERE restaurant_id=$1 AND is_active AND starts_at <= $2 AND $2 < ends_at`, restaurantID, t)
	if err != nil {
		return nil, fmt.Errorf("restaurant: load discounts: %w", err)
	}
	var out []PriceDiscount
	for rows.Next() {
		var d PriceDiscount
		if err := rows.Scan(&d.ID, &d.Name, &d.Kind, &d.Value, &d.Scope, &d.StartsAt, &d.EndsAt, &d.Active, &d.MaxKobo); err != nil {
			rows.Close()
			return nil, err
		}
		d.ItemIDs = map[string]bool{}
		d.CategoryIDs = map[string]bool{}
		out = append(out, d)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	index := map[string]int{}
	for i := range out {
		index[out[i].ID] = i
	}
	itemRows, err := db.Query(ctx, `SELECT rdi.discount_id::text, rdi.menu_item_id::text
		  FROM restaurant_discount_items rdi JOIN restaurant_discounts rd ON rd.id = rdi.discount_id
		 WHERE rd.restaurant_id=$1`, restaurantID)
	if err != nil {
		return nil, err
	}
	for itemRows.Next() {
		var did, iid string
		if err := itemRows.Scan(&did, &iid); err != nil {
			itemRows.Close()
			return nil, err
		}
		if i, ok := index[did]; ok {
			out[i].ItemIDs[iid] = true
		}
	}
	itemRows.Close()
	catRows, err := db.Query(ctx, `SELECT rdc.discount_id::text, rdc.taxonomy_category_id::text
		  FROM restaurant_discount_categories rdc JOIN restaurant_discounts rd ON rd.id = rdc.discount_id
		 WHERE rd.restaurant_id=$1`, restaurantID)
	if err != nil {
		return nil, err
	}
	for catRows.Next() {
		var did, cid string
		if err := catRows.Scan(&did, &cid); err != nil {
			catRows.Close()
			return nil, err
		}
		if i, ok := index[did]; ok {
			out[i].CategoryIDs[cid] = true
		}
	}
	catRows.Close()
	return out, nil
}

// itemTaxonomy maps each item to its taxonomy category and sub-category ids, so category
// discounts can match. Items without a taxonomy placement map to empty strings.
func itemTaxonomy(ctx context.Context, db *pgxpool.Pool, restaurantID string) (map[string][2]string, error) {
	rows, err := db.Query(ctx, `SELECT id::text, COALESCE(taxonomy_category_id::text,''), COALESCE(taxonomy_subcategory_id::text,'')
		  FROM menu_items WHERE restaurant_id=$1`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][2]string{}
	for rows.Next() {
		var id, cat, sub string
		if err := rows.Scan(&id, &cat, &sub); err != nil {
			return nil, err
		}
		out[id] = [2]string{cat, sub}
	}
	return out, rows.Err()
}

// WithDiscounts turns on discounted prices in the menu read. Off leaves every price as
// the owner set it.
func (s *Service) WithDiscounts(on bool) *Service {
	s.discountsOn = on
	return s
}
