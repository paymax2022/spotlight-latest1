// Package taxonomy owns the admin-managed restaurant menu taxonomy and cuisines.
package taxonomy

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed seed/menu-taxonomy.v1.json
var menuSeedJSON []byte

//go:embed seed/cuisines.v1.json
var cuisineSeedJSON []byte

type seedCategory struct {
	Name      string         `json:"name"`
	Slug      string         `json:"slug"`
	Kind      string         `json:"kind"`
	SortOrder int            `json:"sort_order"`
	IsActive  bool           `json:"is_active"`
	Children  []seedCategory `json:"children"`
}

type seedCuisine struct {
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	SortOrder int    `json:"sort_order"`
}

// SeedReport counts what one seed run did. Re-running reports Inserted == 0.
type SeedReport struct {
	Inserted   int      `json:"inserted"`
	Skipped    int      `json:"skipped"`
	Duplicates []string `json:"duplicates,omitempty"`
}

func (r *SeedReport) add(o SeedReport) {
	r.Inserted += o.Inserted
	r.Skipped += o.Skipped
	r.Duplicates = append(r.Duplicates, o.Duplicates...)
}

// SeedDefaults inserts any default category or cuisine whose slug is missing. It
// never updates an existing row, so admin edits to name, icon, order or active
// state survive every re-run.
func SeedDefaults(ctx context.Context, db *pgxpool.Pool) (SeedReport, error) {
	var menu struct {
		Categories []seedCategory `json:"categories"`
	}
	if err := json.Unmarshal(menuSeedJSON, &menu); err != nil {
		return SeedReport{}, fmt.Errorf("taxonomy: parse menu seed: %w", err)
	}
	var cus struct {
		Cuisines []seedCuisine `json:"cuisines"`
	}
	if err := json.Unmarshal(cuisineSeedJSON, &cus); err != nil {
		return SeedReport{}, fmt.Errorf("taxonomy: parse cuisine seed: %w", err)
	}

	var total SeedReport
	for _, c := range menu.Categories {
		rep, err := seedTopLevel(ctx, db, c)
		if err != nil {
			return total, err
		}
		total.add(rep)
	}
	for _, c := range cus.Cuisines {
		ins, err := db.Exec(ctx, `
			INSERT INTO cuisines (name, slug, sort_order, is_system_seeded)
			VALUES ($1,$2,$3,TRUE)
			ON CONFLICT (slug) DO NOTHING`, c.Name, c.Slug, c.SortOrder)
		if err != nil {
			return total, fmt.Errorf("taxonomy: seed cuisine %s: %w", c.Slug, err)
		}
		if ins.RowsAffected() == 1 {
			total.Inserted++
		} else {
			total.Skipped++
		}
	}
	log.Printf("[taxonomy] seed defaults: inserted=%d skipped=%d duplicates=%d",
		total.Inserted, total.Skipped, len(total.Duplicates))
	return total, nil
}

func seedTopLevel(ctx context.Context, db *pgxpool.Pool, c seedCategory) (SeedReport, error) {
	var rep SeedReport
	parentID, inserted, err := insertCategory(ctx, db, nil, c)
	if err != nil {
		return rep, err
	}
	if parentID == "" {
		rep.Duplicates = append(rep.Duplicates, c.Name)
		return rep, nil
	}
	if inserted {
		rep.Inserted++
	} else {
		rep.Skipped++
	}
	for _, sub := range c.Children {
		id, ins, err := insertCategory(ctx, db, &parentID, sub)
		if err != nil {
			return rep, err
		}
		switch {
		case id == "":
			rep.Duplicates = append(rep.Duplicates, sub.Name)
		case ins:
			rep.Inserted++
		default:
			rep.Skipped++
		}
	}
	return rep, nil
}

// insertCategory returns the row's id whether it was just inserted or already there.
// An empty id means a sibling already uses this name under a different slug, which
// is reported as a duplicate rather than failing the whole seed.
func insertCategory(ctx context.Context, db *pgxpool.Pool, parentID *string, c seedCategory) (string, bool, error) {
	var id string
	err := db.QueryRow(ctx, `
		INSERT INTO restaurant_taxonomy_categories
		  (parent_id, name, slug, kind, sort_order, is_active, is_system_seeded)
		VALUES ($1,$2,$3,$4,$5,$6,TRUE)
		ON CONFLICT DO NOTHING
		RETURNING id`,
		parentID, c.Name, c.Slug, c.Kind, c.SortOrder, c.IsActive).Scan(&id)
	if err == nil {
		return id, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", false, fmt.Errorf("taxonomy: seed %s: %w", c.Slug, err)
	}
	err = db.QueryRow(ctx, `SELECT id FROM restaurant_taxonomy_categories WHERE slug=$1`, c.Slug).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("taxonomy: look up %s: %w", c.Slug, err)
	}
	return id, false, nil
}
