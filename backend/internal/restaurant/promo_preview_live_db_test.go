package restaurant

// LIVE-DB tests for FOOD-UAT-C-011 (POST /orders/preview-promo). Skipped without
// TEST_DATABASE_URL. Also holds the shared HTTP helpers used by quote_live_db_test.go.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func previewRouter(h *Handler, userID string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	r.POST("/orders/preview-promo", h.PreviewPromo)
	r.POST("/orders/quote", h.Quote)
	return r
}

func postJSON(t *testing.T, r *gin.Engine, path string, body any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b)))
	out := map[string]any{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func TestLiveDB_PreviewPromo(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Preview Kitchen", 200_000) // ₦2,000 item
	other := newPromoOrderFixture(t, ctx, pool, "Other Kitchen", 100_000)

	seedPromo(t, ctx, pool, f.restID, "PV500", FunderRestaurant, PromoFixed, 0, 50_000, nil, nil)
	seedPromo(t, ctx, pool, other.restID, "OTHERONLY", FunderRestaurant, PromoFixed, 0, 10_000, nil, nil)
	expID := seedPromo(t, ctx, pool, f.restID, "PVOLD", FunderRestaurant, PromoFixed, 0, 10_000, nil, nil)
	if _, err := pool.Exec(ctx, `UPDATE restaurant_promos SET ends_at=$2 WHERE id=$1`, expID, time.Now().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM restaurant_promos WHERE restaurant_id IN ($1,$2)`, f.restID, other.restID)
	})

	r := previewRouter(NewHandler(f.svc), f.customer)
	body := func(code string) map[string]any {
		return map[string]any{
			"restaurant_id": f.restID, "promo_code": code, "delivery_address": "1 St", "delivery_lat": 6.5244, "delivery_lng": 3.3792,
			"items": []map[string]any{{"menu_item_id": f.itemID, "quantity": 1}},
		}
	}

	lat, lng := 6.5244, 3.3792
	base, _ := f.svc.QuoteOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items: []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}}, DeliveryAddress: "1 St", DeliveryLat: &lat, DeliveryLng: &lng})

	code, out := postJSON(t, r, "/orders/preview-promo", body("pv500"))
	if code != 200 || out["valid"] != true || int64(out["discount_kobo"].(float64)) != 50_000 ||
		int64(out["effective_total_kobo"].(float64)) != base-50_000 || out["funder"] != "merchant" {
		t.Fatalf("valid: code=%d out=%v base=%d", code, out, base)
	}
	for _, tc := range []struct{ code, reason string }{
		{"PVOLD", "expired"}, {"NOPE-XYZ", "invalid"}, {"OTHERONLY", "not_eligible"},
	} {
		code, out := postJSON(t, r, "/orders/preview-promo", body(tc.code))
		if code != 200 || out["valid"] != false || out["reason"] != tc.reason ||
			int64(out["effective_total_kobo"].(float64)) != base {
			t.Fatalf("%s: code=%d out=%v", tc.code, code, out)
		}
	}
	// Nothing committed: no redemption rows for the previewed code.
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM restaurant_promo_redemptions r JOIN restaurant_promos p ON p.id=r.promo_id WHERE p.restaurant_id=$1`, f.restID).Scan(&n)
	if n != 0 {
		t.Fatalf("preview must not reserve a redemption, found %d", n)
	}
	// Unknown restaurant → 404.
	b := body("PV500")
	b["restaurant_id"] = uuid.New().String()
	if code, _ := postJSON(t, r, "/orders/preview-promo", b); code != http.StatusNotFound {
		t.Fatalf("unknown restaurant: want 404, got %d", code)
	}
}
