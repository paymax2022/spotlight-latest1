package healthpharmacy

import (
	"net/http"
	"testing"
)

// An unknown ?category= must be rejected before the catalog query runs (nil-db
// Service would panic on fallthrough).
func TestListProducts_UnknownCategory_Is400(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/products", h.ListProducts)
	w := get(t, r, "/products?category=narcotics")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (got %s)", w.Code, w.Body.String())
	}
}

func TestValidProductCategory(t *testing.T) {
	for _, c := range []string{"", "otc", "prescription", "first_aid", "vitamins"} {
		if !ValidProductCategory(c) {
			t.Errorf("%q should be valid", c)
		}
	}
	for _, c := range []string{"OTC", "wellness", "x'; drop"} {
		if ValidProductCategory(c) {
			t.Errorf("%q should be rejected", c)
		}
	}
}
