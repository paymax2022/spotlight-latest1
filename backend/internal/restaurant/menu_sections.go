package restaurant

import (
	"context"
	"sort"
	"strings"
)

// Taxonomy-driven customer menu sections and restaurant cuisines. Everything here
// is behind Service.taxonomyOn (FEATURE_RESTAURANT_ADMIN_CATEGORIES); with the flag
// off none of it runs and the responses are byte-for-byte what they were.

// CuisineRef is the slim cuisine tag a customer sees on a restaurant.
type CuisineRef struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// MenuSection is one headed group of a restaurant's menu. ID is the taxonomy
// category id, or nil for the legacy-label and "Other" fallback sections.
type MenuSection struct {
	ID        *string    `json:"id"`
	Name      string     `json:"name"`
	Slug      string     `json:"slug"`
	SortOrder int        `json:"sort_order"`
	Items     []MenuItem `json:"items"`
}

// sectionCategory is an active taxonomy category as groupMenuSections needs it.
type sectionCategory struct {
	ID, Name, Slug string
	SortOrder      int
}

// WithTaxonomy turns on cuisines on restaurants and taxonomy sections on the menu
// detail. Off leaves both responses unchanged.
func (s *Service) WithTaxonomy(on bool) *Service {
	s.taxonomyOn = on
	return s
}

// groupMenuSections is PURE. Items are grouped under their taxonomy category
// (categories ordered by sort_order then name; empty ones omitted), then items with
// no active taxonomy category fall into trailing legacy sections keyed by
// legacyLabel (ordered by label, nil id), and items with neither into a final
// "Other". Every item appears exactly once, available or not; within a section the
// input order is kept.
func groupMenuSections(items []MenuItem, itemCat map[string]string, cats []sectionCategory, legacyLabel map[string]string) []MenuSection {
	ordered := append([]sectionCategory(nil), cats...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].SortOrder != ordered[j].SortOrder {
			return ordered[i].SortOrder < ordered[j].SortOrder
		}
		return ordered[i].Name < ordered[j].Name
	})
	byCat := make(map[string][]MenuItem, len(ordered))
	known := make(map[string]bool, len(ordered))
	for _, c := range ordered {
		known[c.ID] = true
	}
	byLabel := map[string][]MenuItem{}
	var other []MenuItem
	for _, it := range items {
		if cid := itemCat[it.ID]; cid != "" && known[cid] {
			byCat[cid] = append(byCat[cid], it)
		} else if label := strings.TrimSpace(legacyLabel[it.ID]); label != "" {
			byLabel[label] = append(byLabel[label], it)
		} else {
			other = append(other, it)
		}
	}

	var out []MenuSection
	for _, c := range ordered {
		if len(byCat[c.ID]) == 0 {
			continue
		}
		id := c.ID
		out = append(out, MenuSection{ID: &id, Name: c.Name, Slug: c.Slug, SortOrder: len(out), Items: byCat[c.ID]})
	}
	labels := make([]string, 0, len(byLabel))
	for l := range byLabel {
		labels = append(labels, l)
	}
	sort.Strings(labels)
	for _, l := range labels {
		out = append(out, MenuSection{Name: l, Slug: legacySlug(l), SortOrder: len(out), Items: byLabel[l]})
	}
	if len(other) > 0 {
		out = append(out, MenuSection{Name: "Other", Slug: "other", SortOrder: len(out), Items: other})
	}
	return out
}

// legacySlug lower-cases a label to [a-z0-9-].
func legacySlug(label string) string {
	var b strings.Builder
	dash := false
	for _, r := range strings.ToLower(label) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimRight(b.String(), "-")
}

// loadItemSectionPlacement returns each item's taxonomy category id and legacy
// label for one restaurant (independent of the discounts flag).
func (s *Service) loadItemSectionPlacement(ctx context.Context, restaurantID string) (itemCat, legacy map[string]string, err error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, COALESCE(taxonomy_category_id::text,''), COALESCE(legacy_category_label,'')
		  FROM menu_items WHERE restaurant_id=$1`, restaurantID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	itemCat, legacy = map[string]string{}, map[string]string{}
	for rows.Next() {
		var id, cat, label string
		if err := rows.Scan(&id, &cat, &label); err != nil {
			return nil, nil, err
		}
		if cat != "" {
			itemCat[id] = cat
		}
		if label != "" {
			legacy[id] = label
		}
	}
	return itemCat, legacy, rows.Err()
}

// loadActiveSectionCategories returns the active taxonomy categories.
func (s *Service) loadActiveSectionCategories(ctx context.Context) ([]sectionCategory, error) {
	rows, err := s.db.Query(ctx, `SELECT id::text, name, slug, sort_order FROM restaurant_taxonomy_categories WHERE is_active`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []sectionCategory
	for rows.Next() {
		var c sectionCategory
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// menuSections builds the taxonomy sections for a restaurant's items.
func (s *Service) menuSections(ctx context.Context, restaurantID string, items []MenuItem) ([]MenuSection, error) {
	itemCat, legacy, err := s.loadItemSectionPlacement(ctx, restaurantID)
	if err != nil {
		return nil, err
	}
	cats, err := s.loadActiveSectionCategories(ctx)
	if err != nil {
		return nil, err
	}
	return groupMenuSections(items, itemCat, cats, legacy), nil
}

// attachCuisines sets Cuisines on each restaurant from active cuisines, with ONE
// query for the whole page (no per-row lookups). No-op for an empty page.
func (s *Service) attachCuisines(ctx context.Context, restaurants []Restaurant) error {
	if len(restaurants) == 0 {
		return nil
	}
	ids := make([]string, len(restaurants))
	for i, r := range restaurants {
		ids[i] = r.ID
	}
	rows, err := s.db.Query(ctx, `SELECT rc.restaurant_id::text, c.id::text, c.slug, c.name
		  FROM restaurant_cuisines rc JOIN cuisines c ON c.id = rc.cuisine_id
		 WHERE c.is_active AND rc.restaurant_id = ANY($1::uuid[])
		 ORDER BY c.sort_order, c.name`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	by := make(map[string][]CuisineRef, len(restaurants))
	for rows.Next() {
		var rid string
		var c CuisineRef
		if err := rows.Scan(&rid, &c.ID, &c.Slug, &c.Name); err != nil {
			return err
		}
		by[rid] = append(by[rid], c)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range restaurants {
		restaurants[i].Cuisines = by[restaurants[i].ID]
	}
	return nil
}
