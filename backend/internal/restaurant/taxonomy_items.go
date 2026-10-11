package restaurant

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/restaurant/taxonomy"
)

// ErrItemNameTaken: a restaurant may not have two items with the same name (ignoring
// case) in one category.
var ErrItemNameTaken = errors.New("restaurant: an item with this name already exists in that category")

// CreateTaxonomyItemRequest is the owner's add-item body once categories are
// admin-managed. The owner picks the category and sub-category; the legacy
// category_id is not used.
type CreateTaxonomyItemRequest struct {
	Name                  string  `json:"name" binding:"required,min=1,max=200"`
	Description           string  `json:"description"`
	PriceKobo             int64   `json:"price_kobo" binding:"required"`
	ImageURL              *string `json:"image_url,omitempty"`
	TaxonomyCategoryID    string  `json:"taxonomy_category_id" binding:"required"`
	TaxonomySubcategoryID *string `json:"taxonomy_subcategory_id,omitempty"`
}

// CreateTaxonomyItem adds an item under a taxonomy category. Owners and staff with
// the menu permission only.
func (s *Service) CreateTaxonomyItem(ctx context.Context, restaurantID, userID string, req CreateTaxonomyItemRequest) (*MenuItem, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageMenu); err != nil {
		return nil, err
	}
	if req.PriceKobo <= 0 {
		return nil, errors.New("restaurant: price must be more than zero")
	}
	if err := validateItemPriceKobo(req.PriceKobo); err != nil {
		return nil, err
	}
	return createTaxonomyItem(ctx, s.db, restaurantID, req)
}

func createTaxonomyItem(ctx context.Context, db *pgxpool.Pool, restaurantID string, req CreateTaxonomyItemRequest) (*MenuItem, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errors.New("restaurant: item name is required")
	}
	topName, err := taxonomy.ValidatePlacement(ctx, db, req.TaxonomyCategoryID, req.TaxonomySubcategoryID)
	if err != nil {
		return nil, err
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var dup bool
	if err := tx.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM menu_items
		                 WHERE restaurant_id=$1 AND taxonomy_category_id=$2 AND lower(name)=lower($3))`,
		restaurantID, req.TaxonomyCategoryID, name).Scan(&dup); err != nil {
		return nil, err
	}
	if dup {
		return nil, ErrItemNameTaken
	}

	// The owner and customer menu views group items by menu_categories, so mirror the
	// item into a legacy category named after its taxonomy category. Without this the
	// new item would be saved but never shown.
	var legacyID string
	err = tx.QueryRow(ctx,
		`SELECT id FROM menu_categories WHERE restaurant_id=$1 AND name=$2 ORDER BY created_at LIMIT 1`,
		restaurantID, topName).Scan(&legacyID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx,
			`INSERT INTO menu_categories (restaurant_id, name) VALUES ($1,$2) RETURNING id`,
			restaurantID, topName).Scan(&legacyID)
	}
	if err != nil {
		return nil, err
	}

	it := &MenuItem{
		ID:           uuid.New().String(),
		CategoryID:   legacyID,
		RestaurantID: restaurantID,
		Name:         name,
		Description:  req.Description,
		PriceKobo:    req.PriceKobo,
		ImageURL:     req.ImageURL,
		IsAvailable:  true,
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO menu_items (id, restaurant_id, category_id, name, description, price_kobo, image_url,
		                         is_available, taxonomy_category_id, taxonomy_subcategory_id)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9)`,
		it.ID, it.RestaurantID, it.CategoryID, it.Name, it.Description, it.PriceKobo, it.ImageURL,
		req.TaxonomyCategoryID, req.TaxonomySubcategoryID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return it, nil
}
