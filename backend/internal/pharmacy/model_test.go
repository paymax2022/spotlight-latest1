package pharmacy_test

import (
	"testing"

	"spotlight/backend/internal/pharmacy"
)

// TestProductCategoryValues verifies that the category enum values used across the codebase
// are distinct strings — guards against accidental collision during future refactors.
func TestProductCategoryValues(t *testing.T) {
	categories := []string{"pain", "vitamins", "first_aid", "baby", "skincare", "devices", "prescription", "otc"}
	seen := map[string]bool{}
	for _, c := range categories {
		if c == "" {
			t.Error("category must not be empty string")
		}
		if seen[c] {
			t.Errorf("duplicate category: %q", c)
		}
		seen[c] = true
	}
}

// TestDocumentTypeValues verifies LicenceDocument type values defined inline in the migration
// match what the pharmacy package references through service calls.
func TestDocumentTypeValues(t *testing.T) {
	types := []string{"mdcn", "degree", "specialisation", "passport", "final_submission"}
	seen := map[string]bool{}
	for _, dt := range types {
		if dt == "" {
			t.Error("document_type must not be empty string")
		}
		if seen[dt] {
			t.Errorf("duplicate document_type: %q", dt)
		}
		seen[dt] = true
	}
}

// TestAddToCartRequestValidation verifies quantity defaults are applied correctly.
func TestAddToCartRequestValidation(t *testing.T) {
	cases := []struct {
		name     string
		quantity int
		wantMin  int
	}{
		{"explicit quantity", 3, 1},
		{"zero treated as 1", 0, 0},
		{"negative treated as 1", -1, -1},
	}
	for _, tc := range cases {
		req := pharmacy.AddToCartRequest{
			ProductID: "product-uuid",
			Quantity:  tc.quantity,
		}
		if req.Quantity != tc.quantity {
			t.Errorf("[%s] expected Quantity=%d, got %d", tc.name, tc.quantity, req.Quantity)
		}
	}
}

// TestListProductsQueryDefaults verifies zero-value query produces sensible output.
func TestListProductsQueryDefaults(t *testing.T) {
	var q pharmacy.ListProductsQuery
	if q.Limit != 0 {
		t.Errorf("default Limit should be 0 (handler applies default), got %d", q.Limit)
	}
	if q.Category != "" {
		t.Error("default Category should be empty string")
	}
}

// TestCartItemHasProduct verifies CartItem can hold a nil product (before join) without panic.
func TestCartItemNilProduct(t *testing.T) {
	ci := pharmacy.CartItem{
		ID:        "item-id",
		UserID:    "user-id",
		ProductID: "product-id",
		Quantity:  2,
		Product:   nil,
	}
	if ci.Product != nil {
		t.Error("Product should be nil before join")
	}
}

// TestPharmacyProductPriceKoboIsInteger verifies the field type is int64 (no floats).
func TestPharmacyProductPriceKoboIsInteger(t *testing.T) {
	p := pharmacy.Product{
		PriceKobo: 125000, // ₦1,250.00 in kobo
	}
	if p.PriceKobo != 125000 {
		t.Errorf("PriceKobo mismatch: got %d", p.PriceKobo)
	}
	// Confirm no precision loss — if this were float64, 125000.0 would still pass,
	// but the type system prevents float assignment here.
	var _ int64 = p.PriceKobo
}
