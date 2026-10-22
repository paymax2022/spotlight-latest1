package restaurant

// LIVE-DB tests for FOOD-UAT-C-007 (POST /orders/quote). Skipped without TEST_DATABASE_URL.

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestLiveDB_Quote(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Quote Kitchen", 200_000)
	if _, err := pool.Exec(ctx, `UPDATE restaurants SET service_fee_bp=500 WHERE id=$1`, f.restID); err != nil {
		t.Fatal(err)
	}
	seedPromo(t, ctx, pool, f.restID, "Q500", FunderRestaurant, PromoFixed, 0, 50_000, nil, nil)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM order_quotes WHERE user_id=$1`, f.customer)
		_, _ = pool.Exec(context.Background(), `DELETE FROM restaurant_promos WHERE restaurant_id=$1`, f.restID)
	})

	r := previewRouter(NewHandler(f.svc), f.customer)
	body := func(code string) map[string]any {
		return map[string]any{
			"restaurant_id": f.restID, "promo_code": code, "delivery_address": "1 St", "delivery_lat": 6.5244, "delivery_lng": 3.3792,
			"items": []map[string]any{{"menu_item_id": f.itemID, "quantity": 1}},
		}
	}
	num := func(m map[string]any, k string) int64 { v, _ := m[k].(float64); return int64(v) }

	// Happy path.
	code, q := postJSON(t, r, "/orders/quote", body(""))
	if code != 200 {
		t.Fatalf("happy: %d %v", code, q)
	}
	lat, lng := 6.5244, 3.3792
	want, err := f.svc.QuoteOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		Items: []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}}, DeliveryAddress: "1 St", DeliveryLat: &lat, DeliveryLng: &lng})
	if err != nil {
		t.Fatal(err)
	}
	if num(q, "total_kobo") != want || num(q, "subtotal_kobo") != 200_000 || num(q, "service_fee_bp") != 500 ||
		num(q, "service_fee_kobo") != 10_000 || q["currency"] != "NGN" || num(q, "promo_discount_kobo") != 0 {
		t.Fatalf("happy shape: %v want total %d", q, want)
	}
	qid, _ := q["quote_id"].(string)
	var sig string
	var exp, created bool
	if err := pool.QueryRow(ctx, `SELECT signature, expires_at > now() + interval '14 minutes' AND expires_at <= now() + interval '16 minutes', payload_jsonb->>'quote_id' = id::text
	  FROM order_quotes WHERE id=$1 AND user_id=$2`, qid, f.customer).Scan(&sig, &exp, &created); err != nil || sig == "" || !exp || !created {
		t.Fatalf("stored quote: sig=%q ttl=%v payload=%v err=%v", sig, exp, created, err)
	}

	// Promo applied.
	code, qp := postJSON(t, r, "/orders/quote", body("q500"))
	if code != 200 || num(qp, "promo_discount_kobo") != 50_000 || num(qp, "total_kobo") != want-50_000 {
		t.Fatalf("promo: %d %v", code, qp)
	}

	// Invalid promo → quote still returned, undiscounted, with rejection.
	code, qi := postJSON(t, r, "/orders/quote", body("NOPE-XYZ"))
	if code != 200 || num(qi, "promo_discount_kobo") != 0 || qi["promo_rejection"] != "invalid" || num(qi, "total_kobo") != want {
		t.Fatalf("invalid promo: %d %v", code, qi)
	}

	// Unknown restaurant → 404.
	b := body("")
	b["restaurant_id"] = uuid.New().String()
	if code, _ := postJSON(t, r, "/orders/quote", b); code != http.StatusNotFound {
		t.Fatalf("unknown restaurant: want 404, got %d", code)
	}
}
