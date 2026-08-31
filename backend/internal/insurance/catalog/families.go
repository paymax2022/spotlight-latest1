package catalog

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
)

// ════════════════════════════════════════════════════════════════════════════
// PURCHASE FAMILY MAP
// ════════════════════════════════════════════════════════════════════════════
//
// MyCover's purchase endpoints are per product FAMILY
// (`POST /products/{family}/buy-{family-slug}`), with the individual product
// chosen by a `product_id` UUID in the request body. Family names are their own
// namespace and cannot be derived from any product field — the mapping must be
// discovered and recorded.
//
// This file loads that mapping as DATA. Adding a family, or moving a product
// between families, is an edit to mycover_families.json (or to an override file
// pointed at by INSURANCE_MYCOVER_FAMILIES_FILE) — never a code change. Nothing
// here branches on a product identity.

//go:embed mycover_families.json
var embeddedFamiliesJSON []byte

// FamilyMatch is the inferred matcher for products a family entry does not list
// explicitly.
type FamilyMatch struct {
	Prefix   string `json:"prefix"`
	Category string `json:"category"`
}

// Family is one purchase family: a verified endpoint plus the schema it
// validates against, and the rule for which products it serves.
type Family struct {
	Family string `json:"family"`
	// BuyPath is the FULL provider-relative family purchase path.
	BuyPath string `json:"buy_path"`
	// PathVerified records that the path was proved to exist by a live probe
	// (400/403 rather than 404). Only verified paths are trusted for binding.
	PathVerified bool `json:"path_verified"`
	// Membership is "verified" (real purchases have gone through) or "inferred"
	// (the path is real; which products it accepts is an assumption).
	Membership string `json:"membership"`
	// ProductCodes lists provider route_names this family definitely serves.
	// Authoritative — it wins over Match.
	ProductCodes []string       `json:"product_codes"`
	Match        FamilyMatch    `json:"match"`
	Notes        string         `json:"notes"`
	FormSchema   map[string]any `json:"form_schema"`
}

type familiesFile struct {
	Families []Family `json:"families"`
}

// FamilyMap resolves a provider product to its purchase family. It implements
// SchemaSource, so the catalog sync consumes it without knowing it exists.
type FamilyMap struct {
	families []Family
	byCode   map[string]*Family // explicit product_codes, lower-cased
}

// LoadFamilyMap builds the family map from the embedded data, optionally
// overridden by a JSON file at path (INSURANCE_MYCOVER_FAMILIES_FILE). An
// override that fails to load is reported and IGNORED — a broken override must
// not silently strip every product of its buy path, which would take the whole
// module offline.
func LoadFamilyMap(path string) *FamilyMap {
	raw := embeddedFamiliesJSON
	if path != "" {
		b, err := os.ReadFile(path)
		switch {
		case err != nil:
			log.Printf("[insurance] family map %q unreadable (%v) — using the built-in map", path, err)
		case !json.Valid(b):
			log.Printf("[insurance] family map %q is not valid JSON — using the built-in map", path)
		default:
			raw = b
			log.Printf("[insurance] family map loaded from %s", path)
		}
	}

	var ff familiesFile
	if err := json.Unmarshal(raw, &ff); err != nil {
		log.Printf("[insurance] family map could not be parsed: %v — no product will have a buy path", err)
		return &FamilyMap{byCode: map[string]*Family{}}
	}

	fm := &FamilyMap{families: ff.Families, byCode: make(map[string]*Family, 16)}
	for i := range fm.families {
		f := &fm.families[i]
		for _, code := range f.ProductCodes {
			fm.byCode[strings.ToLower(strings.TrimSpace(code))] = f
		}
	}
	return fm
}

// Len reports how many families are known (admin provider-health reporting).
func (m *FamilyMap) Len() int {
	if m == nil {
		return 0
	}
	return len(m.families)
}

// Families returns the loaded families for admin display.
func (m *FamilyMap) Families() []Family {
	if m == nil {
		return nil
	}
	return m.families
}

// Resolve returns the family serving a provider product, or nil.
//
// Explicit product_codes win; otherwise a family claims the product when its
// prefix matches and, where the entry states one, its category matches too.
func (m *FamilyMap) Resolve(providerCode, prefix, category string) *Family {
	if m == nil {
		return nil
	}
	if f, ok := m.byCode[strings.ToLower(strings.TrimSpace(providerCode))]; ok {
		return f
	}
	prefix = strings.ToLower(strings.TrimSpace(prefix))
	category = strings.ToLower(strings.TrimSpace(category))
	for i := range m.families {
		f := &m.families[i]
		if f.Match.Prefix == "" {
			continue
		}
		if !strings.EqualFold(f.Match.Prefix, prefix) {
			continue
		}
		if f.Match.Category != "" && !strings.EqualFold(f.Match.Category, category) {
			continue
		}
		return f
	}
	return nil
}

// SchemaFor implements SchemaSource for the catalog sync.
//
// A family is only handed over when its path is VERIFIED. An unverified path is
// worse than none: bind would post to an endpoint that either 404s or belongs to
// another family, and the second case sells the wrong cover.
func (m *FamilyMap) SchemaFor(providerCode, prefix, category string) (string, map[string]any, bool) {
	f := m.Resolve(providerCode, prefix, category)
	if f == nil || !f.PathVerified || f.BuyPath == "" {
		return "", nil, false
	}
	return f.BuyPath, f.FormSchema, true
}

// Validate reports structural problems in the loaded map so a bad edit is caught
// at startup rather than at a member's purchase.
func (m *FamilyMap) Validate() []string {
	if m == nil {
		return []string{"family map is nil"}
	}
	var problems []string
	seen := map[string]bool{}
	for _, f := range m.families {
		switch {
		case f.Family == "":
			problems = append(problems, "a family entry has no name")
		case seen[f.Family]:
			problems = append(problems, fmt.Sprintf("duplicate family %q", f.Family))
		}
		seen[f.Family] = true
		if f.BuyPath == "" {
			problems = append(problems, fmt.Sprintf("family %q has no buy_path", f.Family))
		} else if !strings.HasPrefix(f.BuyPath, "/products/") {
			problems = append(problems, fmt.Sprintf("family %q buy_path %q is not a /products/… path", f.Family, f.BuyPath))
		}
		if f.PathVerified && len(f.FormSchema) == 0 {
			problems = append(problems, fmt.Sprintf("family %q is verified but carries no form schema", f.Family))
		}
		// A family with no matcher is only a problem when it claims to be usable.
		// Unverified entries are the discovery backlog: a probed path recorded so
		// the next person does not re-probe it, with its membership still unknown.
		if f.PathVerified && len(f.ProductCodes) == 0 && f.Match.Prefix == "" {
			problems = append(problems, fmt.Sprintf("family %q is verified but matches nothing (no product_codes, no match.prefix)", f.Family))
		}
	}
	return problems
}
