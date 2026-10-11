package taxonomy

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// unlabelled groups items that have no legacy category at all.
const unlabelled = "(no category)"

// synonyms maps a common owner-typed label, already slugified, to a default slug.
// The target is either a top-level or a sub-category slug from the seed.
var synonyms = map[string]string{
	"rice":       "rice-dishes",
	"drinks":     "soft-drinks",
	"drink":      "soft-drinks",
	"beverages":  "soft-drinks",
	"beverage":   "soft-drinks",
	"swallow":    "swallows-and-soups",
	"swallows":   "swallows-and-soups",
	"soup":       "swallows-and-soups",
	"soups":      "swallows-and-soups",
	"dessert":    "desserts",
	"starters":   "starters-and-appetizers",
	"appetizers": "starters-and-appetizers",
	"starter":    "starters-and-appetizers",
	"grills":     "grills-and-bbq",
	"grill":      "grills-and-bbq",
	"bbq":        "grills-and-bbq",
	"snacks":     "street-food-and-snacks",
	"salads":     "salads-and-sides",
	"sides":      "salads-and-sides",
	"pizza":      "pizza-and-italian",
	"burgers":    "burgers-sandwiches-and-wraps",
	"noodles":    "noodles-and-pasta",
	"pasta":      "noodles-and-pasta",
	"combos":     "combos-and-meal-deals",
	"juice":      "juices-and-smoothies",
	"juices":     "juices-and-smoothies",
	"smoothies":  "juices-and-smoothies",
	"coffee":     "hot-beverages",
	"tea":        "hot-beverages",
	"cakes":      "bakery-and-pastries",
	"pastries":   "bakery-and-pastries",
	"wine":       "wine-and-champagne",
	"beer":       "beer-and-ciders",
	"spirits":    "spirits-and-cocktails",
	"cocktails":  "spirits-and-cocktails",
	"vegan":      "healthy-vegan-and-vegetarian",
	"vegetarian": "healthy-vegan-and-vegetarian",
	"kids":       "kids-menu",
	"breakfast":  "breakfast",
	"seafood":    "seafood",
}

// BackfillGroup is one legacy label and what happened to its items.
type BackfillGroup struct {
	Label    string `json:"label"`
	Items    int    `json:"items"`
	MappedTo string `json:"mapped_to"` // target slug, or "" when it needs review
}

// BackfillReport is the result of one run. A dry run and a real run report the same
// numbers; the dry run writes nothing.
type BackfillReport struct {
	DryRun   bool            `json:"dry_run"`
	Total    int             `json:"total"`
	Mapped   int             `json:"mapped"`
	Unmapped int             `json:"unmapped"`
	Groups   []BackfillGroup `json:"groups"`
}

type legacyItem struct {
	id    string
	label string
}

// Backfill maps legacy item categories onto the taxonomy. Items that match a default
// by name or synonym get the taxonomy category (and sub-category). Everything else
// keeps its legacy label and joins the needs-review queue. Items are never deleted,
// and an item that already has a taxonomy category is left alone, so a second run
// changes nothing.
func Backfill(ctx context.Context, db *pgxpool.Pool, dryRun bool) (BackfillReport, error) {
	rep := BackfillReport{DryRun: dryRun}
	nodes, err := activeNodesBySlug(ctx, db)
	if err != nil {
		return rep, err
	}
	items, err := unmappedItems(ctx, db)
	if err != nil {
		return rep, err
	}

	byLabel := map[string][]string{}
	for _, it := range items {
		byLabel[it.label] = append(byLabel[it.label], it.id)
	}
	labels := make([]string, 0, len(byLabel))
	for l := range byLabel {
		labels = append(labels, l)
	}
	sort.Strings(labels)

	tx, err := db.Begin(ctx)
	if err != nil {
		return rep, err
	}
	defer tx.Rollback(ctx)

	for _, label := range labels {
		ids := byLabel[label]
		rep.Total += len(ids)
		target, cat, sub := resolve(label, nodes)
		g := BackfillGroup{Label: label, Items: len(ids), MappedTo: target}
		if target != "" {
			rep.Mapped += len(ids)
			if !dryRun {
				if _, err := tx.Exec(ctx, `
					UPDATE menu_items SET taxonomy_category_id=$2, taxonomy_subcategory_id=$3
					 WHERE id = ANY($1::uuid[]) AND taxonomy_category_id IS NULL`, ids, cat, sub); err != nil {
					return rep, fmt.Errorf("taxonomy: map %q: %w", label, err)
				}
			}
		} else {
			rep.Unmapped += len(ids)
			if !dryRun && label != unlabelled {
				if _, err := tx.Exec(ctx, `
					UPDATE menu_items SET legacy_category_label=$2
					 WHERE id = ANY($1::uuid[]) AND taxonomy_category_id IS NULL AND legacy_category_label IS NULL`, ids, label); err != nil {
					return rep, fmt.Errorf("taxonomy: label %q: %w", label, err)
				}
			}
		}
		rep.Groups = append(rep.Groups, g)
	}

	if dryRun {
		return rep, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return rep, err
	}
	log.Printf("[taxonomy] backfill: total=%d mapped=%d unmapped=%d", rep.Total, rep.Mapped, rep.Unmapped)
	return rep, nil
}

// resolve returns the target slug and the category and sub-category ids for a label,
// or "" when the label does not match anything. It tries an exact slug match, then a
// synonym, and it never guesses from a partial match.
func resolve(label string, nodes map[string]taxNode) (string, string, *string) {
	if label == unlabelled {
		return "", "", nil
	}
	key := Slugify(label)
	if key == "" {
		return "", "", nil
	}
	slug := key
	if _, ok := nodes[slug]; !ok {
		target, ok := synonyms[key]
		if !ok {
			return "", "", nil
		}
		slug = target
	}
	n, ok := nodes[slug]
	if !ok {
		return "", "", nil
	}
	if n.parentID == nil {
		return slug, n.id, nil
	}
	sub := n.id
	return slug, *n.parentID, &sub
}

type taxNode struct {
	id       string
	parentID *string
}

func activeNodesBySlug(ctx context.Context, db *pgxpool.Pool) (map[string]taxNode, error) {
	rows, err := db.Query(ctx, `SELECT id, slug, parent_id FROM restaurant_taxonomy_categories WHERE is_active`)
	if err != nil {
		return nil, fmt.Errorf("taxonomy: load nodes: %w", err)
	}
	defer rows.Close()
	out := map[string]taxNode{}
	for rows.Next() {
		var id, slug string
		var parent *string
		if err := rows.Scan(&id, &slug, &parent); err != nil {
			return nil, err
		}
		out[slug] = taxNode{id: id, parentID: parent}
	}
	return out, rows.Err()
}

// unmappedItems returns every item with no taxonomy category, labelled by its legacy
// category name, or unlabelled when it never had one.
func unmappedItems(ctx context.Context, db *pgxpool.Pool) ([]legacyItem, error) {
	rows, err := db.Query(ctx, `
		SELECT m.id::text,
		       COALESCE(NULLIF(m.legacy_category_label, ''), c.name, $1)
		  FROM menu_items m
		  LEFT JOIN menu_categories c ON c.id = m.category_id
		 WHERE m.taxonomy_category_id IS NULL`, unlabelled)
	if err != nil {
		return nil, fmt.Errorf("taxonomy: load items: %w", err)
	}
	defer rows.Close()
	var out []legacyItem
	for rows.Next() {
		var it legacyItem
		if err := rows.Scan(&it.id, &it.label); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// ReviewGroup is one queue entry: a label and how many items carry it.
type ReviewGroup struct {
	Label string `json:"label"`
	Items int    `json:"items"`
}

// NeedsReview lists labels whose items still have no taxonomy category.
func NeedsReview(ctx context.Context, db *pgxpool.Pool) ([]ReviewGroup, error) {
	items, err := unmappedItems(ctx, db)
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, it := range items {
		counts[it.label]++
	}
	out := make([]ReviewGroup, 0, len(counts))
	for l, n := range counts {
		out = append(out, ReviewGroup{Label: l, Items: n})
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Items > out[j].Items || (out[i].Items == out[j].Items && out[i].Label < out[j].Label)
	})
	return out, nil
}

// RemapLabel points every unmapped item carrying a label at a chosen category. The
// target must be an active top-level category; a sub-category, if given, must sit
// under it. Returns how many items changed.
func RemapLabel(ctx context.Context, db *pgxpool.Pool, actorID, label, categoryID string, subcategoryID *string) (int64, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		return 0, fmt.Errorf("%w: label is required", ErrInvalid)
	}
	var kind string
	var parent *string
	err := db.QueryRow(ctx, `SELECT parent_id, kind FROM restaurant_taxonomy_categories WHERE id=$1 AND is_active`, categoryID).Scan(&parent, &kind)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, err
	}
	if parent != nil {
		return 0, fmt.Errorf("%w: category must be top-level; pick its sub-category instead", ErrInvalid)
	}
	if subcategoryID != nil {
		var subParent *string
		err := db.QueryRow(ctx, `SELECT parent_id FROM restaurant_taxonomy_categories WHERE id=$1 AND is_active`, *subcategoryID).Scan(&subParent)
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrNotFound
		}
		if err != nil {
			return 0, err
		}
		if subParent == nil || *subParent != categoryID {
			return 0, fmt.Errorf("%w: sub-category does not belong to the chosen category", ErrInvalid)
		}
	}

	tag, err := db.Exec(ctx, `
		UPDATE menu_items m SET taxonomy_category_id=$3, taxonomy_subcategory_id=$4
		 WHERE m.taxonomy_category_id IS NULL
		   AND COALESCE(NULLIF(m.legacy_category_label,''),
		                (SELECT c.name FROM menu_categories c WHERE c.id = m.category_id),
		                $2) = $1`,
		label, unlabelled, categoryID, subcategoryID)
	if err != nil {
		return 0, mapWriteErr(err)
	}
	log.Printf("[taxonomy] admin %s remapped %d item(s) from %q", actorID, tag.RowsAffected(), label)
	return tag.RowsAffected(), nil
}
