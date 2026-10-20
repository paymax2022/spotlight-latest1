package restaurant

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"
)

func TestPriceValidationIs400(t *testing.T) {
	for _, k := range []int64{-1, maxItemPriceKobo + 1} {
		err := validateItemPriceKobo(k)
		if !errors.Is(err, ErrInvalidInput) || menuErrStatus(err) != http.StatusBadRequest {
			t.Fatalf("price %d: want 400, got %v / %d", k, err, menuErrStatus(err))
		}
	}
	if menuErrStatus(errors.New("restaurant: only the owner may manage the menu")) != http.StatusForbidden {
		t.Fatal("permission failure must stay 403")
	}
}

func TestEmptyMenuShape(t *testing.T) {
	b, _ := json.Marshal(withEmptyMenuShape(&RestaurantDetail{}))
	var m map[string]json.RawMessage
	_ = json.Unmarshal(b, &m)
	if string(m["categories"]) != "[]" {
		t.Fatalf("categories = %s", m["categories"])
	}
	b, _ = json.Marshal(MenuItem{})
	if !json.Valid(b) || string(b) == "" {
		t.Fatal("bad json")
	}
}
