package taxonomy

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ValidatePlacement checks that an item's category is an active top-level category
// and, if given, its sub-category is an active child of that category. It returns
// the category's name, which the caller uses to mirror the item into a legacy
// category so the existing menu views keep listing it.
func ValidatePlacement(ctx context.Context, db *pgxpool.Pool, categoryID string, subcategoryID *string) (string, error) {
	var name string
	var parent *string
	err := db.QueryRow(ctx,
		`SELECT name, parent_id FROM restaurant_taxonomy_categories WHERE id=$1 AND is_active`, categoryID).Scan(&name, &parent)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if parent != nil {
		return "", fmt.Errorf("%w: pick a top-level category, then its sub-category", ErrInvalid)
	}
	if subcategoryID == nil {
		return name, nil
	}
	var subParent *string
	err = db.QueryRow(ctx,
		`SELECT parent_id FROM restaurant_taxonomy_categories WHERE id=$1 AND is_active`, *subcategoryID).Scan(&subParent)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if subParent == nil || *subParent != categoryID {
		return "", fmt.Errorf("%w: that sub-category is not under the chosen category", ErrInvalid)
	}
	return name, nil
}
