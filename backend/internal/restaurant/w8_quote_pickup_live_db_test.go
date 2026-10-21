package restaurant

// LIVE-DB tests for Wave 8: quote_id consumption in PlaceOrder (C-007), the
// merchant pickup-code / table-close verify endpoints (D-007) and the
// stuck-settlement sweeper's pickup / dine-in coverage. Skipped without
// TEST_DATABASE_URL.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func w8Req(f promoOrderFixture, quoteID string) PlaceOrderRequest {
	return PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		DeliveryAddress: "1 St", DeliveryLat: ptrF(6.5244), DeliveryLng: ptrF(3.3792), QuoteID: quoteID, IdempotencyKey: "w8-" + uuid.New().String(),
	}
}

func TestLiveDB_W8_PlaceOrderConsumesQuote(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "W8 Quote Kitchen", 200_000)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM order_quotes WHERE user_id=$1`, f.customer)
	})

	quote := func() *OrderQuote {
		q, err := f.svc.QuoteBreakdown(ctx, f.restID, f.customer, w8Req(f, ""))
		if err != nil {
			t.Fatalf("quote: %v", err)
		}
		return q
	}

	// Fresh quote succeeds and is marked consumed.
	q := quote()
	req := w8Req(f, q.QuoteID)
	order, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req)
	if err != nil || order.TotalKobo != q.TotalKobo {
		t.Fatalf("fresh quote: order=%v err=%v", order, err)
	}
	var consumed bool
	if err := pool.QueryRow(ctx, `SELECT consumed_at IS NOT NULL FROM order_quotes WHERE id=$1`, q.QuoteID).Scan(&consumed); err != nil || !consumed {
		t.Fatalf("consumed_at not set: %v %v", consumed, err)
	}

	// Retry of the SAME placement (same Idempotency-Key) returns the existing order.
	again, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, req)
	if err != nil || again.ID != order.ID {
		t.Fatalf("idempotent retry: %v %v", again, err)
	}
	// Replay under a NEW key is refused.
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, w8Req(f, q.QuoteID)); !errors.Is(err, ErrQuoteInvalid) {
		t.Fatalf("replayed quote err = %v, want ErrQuoteInvalid", err)
	}

	// Stale quote: price moves between quote and placement -> ErrPriceChanged w/ old/new.
	q2 := quote()
	if _, err := pool.Exec(ctx, `UPDATE menu_items SET price_kobo=250000 WHERE id=$1`, f.itemID); err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.PlaceOrder(ctx, f.restID, f.customer, w8Req(f, q2.QuoteID))
	var pc *PriceChangedError
	if !errors.Is(err, ErrPriceChanged) || !errors.As(err, &pc) || pc.OldTotalKobo != q2.TotalKobo || pc.NewTotalKobo <= pc.OldTotalKobo {
		t.Fatalf("stale quote err = %v (%+v)", err, pc)
	}
	// ...and that quote stays burned.
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, w8Req(f, q2.QuoteID)); !errors.Is(err, ErrQuoteInvalid) {
		t.Fatalf("stale quote reuse err = %v", err)
	}
	// Over HTTP: 409 + structured body.
	q3 := quote()
	if _, err := pool.Exec(ctx, `UPDATE menu_items SET price_kobo=300000 WHERE id=$1`, f.itemID); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", f.customer); c.Next() })
	r.POST("/:id/orders", NewHandler(f.svc).PlaceOrder)
	body, _ := json.Marshal(map[string]any{"items": []map[string]any{{"menu_item_id": f.itemID, "quantity": 1}},
		"delivery_address": "1 St", "delivery_lat": 6.5244, "delivery_lng": 3.3792, "quote_id": q3.QuoteID, "idempotency_key": "w8h-" + uuid.New().String()})
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/"+f.restID+"/orders", bytes.NewReader(body)))
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if w.Code != http.StatusConflict || out["code"] != "price_changed" ||
		int64(out["old_total_kobo"].(float64)) != q3.TotalKobo || int64(out["new_total_kobo"].(float64)) <= q3.TotalKobo {
		t.Fatalf("http stale: %d %v", w.Code, out)
	}

	// Signature mismatch: tamper with the stored payload.
	q4 := quote()
	if _, err := pool.Exec(ctx, `UPDATE order_quotes SET payload_jsonb = jsonb_set(payload_jsonb,'{total_kobo}','1') WHERE id=$1`, q4.QuoteID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, w8Req(f, q4.QuoteID)); !errors.Is(err, ErrQuoteInvalid) {
		t.Fatalf("tampered err = %v", err)
	}

	// Expired and foreign quotes.
	q5 := quote()
	if _, err := pool.Exec(ctx, `UPDATE order_quotes SET expires_at = now() - interval '1 minute' WHERE id=$1`, q5.QuoteID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, w8Req(f, q5.QuoteID)); !errors.Is(err, ErrQuoteInvalid) {
		t.Fatalf("expired err = %v", err)
	}
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, w8Req(f, "not-a-uuid")); !errors.Is(err, ErrQuoteInvalid) {
		t.Fatalf("garbage err = %v", err)
	}
	q6 := quote()
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.owner, w8Req(f, q6.QuoteID)); !errors.Is(err, ErrQuoteInvalid) {
		t.Fatalf("foreign-user err = %v", err)
	}

	// No quote_id: the unchanged path still works.
	if _, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, w8Req(f, "")); err != nil {
		t.Fatalf("no-quote path: %v", err)
	}
}

func w8PickupReady(t *testing.T, ctx context.Context, f promoOrderFixture, orderType, table string) *Order {
	t.Helper()
	o, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
		OrderType: orderType, TableNumber: table,
		Items:          []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
		IdempotencyKey: "w8p-" + uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("place %s: %v", orderType, err)
	}
	steps := []OrderStatus{OrderConfirmed, OrderPreparing, OrderReady}
	if orderType == "dine_in" {
		steps = []OrderStatus{OrderConfirmed, OrderPreparing, OrderServed}
	}
	for _, st := range steps {
		if err := f.svc.UpdateStatus(ctx, o.ID, f.owner, st); err != nil {
			t.Fatalf("-> %s: %v", st, err)
		}
	}
	return o
}

func TestLiveDB_W8_VerifyCustomerPickup(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "W8 Pickup Kitchen", 400_000)
	o := w8PickupReady(t, ctx, f, "pickup_now", "")
	var code string
	if err := pool.QueryRow(ctx, `SELECT pickup_code FROM orders WHERE id=$1`, o.ID).Scan(&code); err != nil || code == "" {
		t.Fatalf("pickup code: %q %v", code, err)
	}
	wrong := "0000"
	if code == wrong {
		wrong = "1111"
	}
	attempts := func() (n int) {
		_ = pool.QueryRow(ctx, `SELECT pickup_attempts FROM orders WHERE id=$1`, o.ID).Scan(&n)
		return
	}

	// Authorization: customer / stranger refused; no attempt burned.
	if err := f.svc.VerifyCustomerPickup(ctx, o.ID, f.customer, code); !errors.Is(err, ErrForbidden) {
		t.Fatalf("customer err = %v", err)
	}
	// Wrong code -> counter increments (HTTP 400).
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", f.owner); c.Next() })
	h := NewHandler(f.svc)
	r.POST("/orders/:orderId/verify-customer-pickup", h.VerifyCustomerPickup)
	r.POST("/orders/:orderId/verify-table-close", h.VerifyTableClose)
	post := func(path string, body map[string]any) int {
		b, _ := json.Marshal(body)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b)))
		return w.Code
	}
	path := "/orders/" + o.ID + "/verify-customer-pickup"
	if c := post(path, map[string]any{"code": wrong}); c != 400 || attempts() != 1 {
		t.Fatalf("wrong code: http %d attempts %d", c, attempts())
	}
	for i := 0; i < 3; i++ {
		post(path, map[string]any{"code": wrong})
	}
	if c := post(path, map[string]any{"code": wrong}); c != 429 { // 5th wrong arms the lock
		t.Fatalf("5th wrong: http %d, want 429", c)
	}
	if c := post(path, map[string]any{"code": code}); c != 429 { // correct code refused while locked
		t.Fatalf("correct while locked: http %d, want 429", c)
	}
	// Admin unlock resets the counter; correct code now succeeds.
	if err := f.svc.UnlockOrderCodes(ctx, o.ID); err != nil || attempts() != 0 {
		t.Fatalf("unlock: %v attempts=%d", err, attempts())
	}
	if c := post(path, map[string]any{"code": code}); c != 200 {
		t.Fatalf("correct code: http %d", c)
	}
	var st string
	_ = pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, o.ID).Scan(&st)
	prov, plat, rider := legs(t, ctx, pool, o.ID)
	if st != "picked_up" || prov <= 0 || plat <= 0 || rider != 0 || prov+plat != 400_000 {
		t.Fatalf("after verify: status=%s legs=%d/%d/%d", st, prov, plat, rider)
	}
	// Second verify: order no longer ready -> 409.
	if c := post(path, map[string]any{"code": code}); c != 409 {
		t.Fatalf("re-verify: http %d, want 409", c)
	}
	// A delivery order is not verifiable here -> 400.
	d, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, w8Req(f, ""))
	if err != nil {
		t.Fatal(err)
	}
	if c := post("/orders/"+d.ID+"/verify-customer-pickup", map[string]any{"code": "1234"}); c != 400 {
		t.Fatalf("delivery order: http %d, want 400", c)
	}

	// Dine-in: served -> closed via verify-table-close.
	di := w8PickupReady(t, ctx, f, "dine_in", "T7")
	dpath := "/orders/" + di.ID + "/verify-table-close"
	if c := post(dpath, map[string]any{"table_number": "T9"}); c != 400 {
		t.Fatalf("wrong table: http %d", c)
	}
	if c := post(dpath, map[string]any{"table_number": "t7"}); c != 200 {
		t.Fatalf("close table: http %d", c)
	}
	_ = pool.QueryRow(ctx, `SELECT status FROM orders WHERE id=$1`, di.ID).Scan(&st)
	if st != "closed" {
		t.Fatalf("dine-in status = %s", st)
	}
}

func TestLiveDB_W8_SweeperCoversPickupAndDineIn(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "W8 Sweep Kitchen", 400_000)

	place := func(orderType, table string) *Order {
		o, err := f.svc.PlaceOrder(ctx, f.restID, f.customer, PlaceOrderRequest{
			OrderType: orderType, TableNumber: table, DeliveryAddress: "1 St",
			Items:          []OrderItemInput{{MenuItemID: f.itemID, Quantity: 1}},
			IdempotencyKey: "w8s-" + uuid.New().String()})
		if err != nil {
			t.Fatal(err)
		}
		return o
	}
	crash := func(o *Order, status string) { // the state a crash between flip and settle leaves
		if _, err := pool.Exec(ctx, `UPDATE orders SET status=$2 WHERE id=$1`, o.ID, status); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE settlements SET escrowed_at = now() - interval '1 hour' WHERE id=$1`, o.SettlementID); err != nil {
			t.Fatal(err)
		}
	}
	pickup, dine, deliv := place("pickup_now", ""), place("dine_in", "T1"), place("delivery", "")
	crash(pickup, "picked_up")
	crash(dine, "served")
	crash(deliv, "picked_up") // rider still carrying it: must NOT be swept

	n, err := f.svc.ReconcileStuckSettlements(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if n < 2 {
		t.Fatalf("reconciled %d, want >=2", n)
	}
	status := func(o *Order) (s string) {
		_ = pool.QueryRow(ctx, `SELECT status FROM settlements WHERE id=$1`, o.SettlementID).Scan(&s)
		return
	}
	if status(pickup) != "settled" || status(dine) != "settled" || status(deliv) != "escrowed" {
		t.Fatalf("settlement states pickup=%s dine=%s delivery=%s", status(pickup), status(dine), status(deliv))
	}
	// Replay: no double pay.
	p1, c1, _ := legs(t, ctx, pool, pickup.ID)
	if _, err := f.svc.ReconcileStuckSettlements(ctx, 0); err != nil {
		t.Fatal(err)
	}
	p2, c2, _ := legs(t, ctx, pool, pickup.ID)
	if p1 != p2 || c1 != c2 || p1+c1 != 400_000 {
		t.Fatalf("pickup legs changed on replay: %d/%d -> %d/%d", p1, c1, p2, c2)
	}
}
