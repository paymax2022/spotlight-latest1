package restaurant

// LIVE-DB regression tests for the Wave-10 sign-off gaps: B-006 (optimistic concurrency),
// B-008 (per-item max quantity), B-009 (hours / closures / timed pause reachable and
// enforced), C-004 (unapproved listing not orderable) and E-013 (retention window).
// Skipped unless TEST_DATABASE_URL is set.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func intp(i int) *int { return &i }

func w10PlaceOne(f promoOrderFixture, qty int) error {
	_, err := f.svc.PlaceOrder(context.Background(), f.restID, f.customer, PlaceOrderRequest{
		Items:           []OrderItemInput{{MenuItemID: f.itemID, Quantity: qty}},
		DeliveryAddress: "Victoria Island",
		IdempotencyKey:  "w10-" + uuid.New().String(),
	})
	return err
}

// B-006: two PATCHes carrying the same expected_version — exactly one wins, the other 409s.
func TestLiveDB_W10_MenuItemOptimisticConcurrency(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "CAS Kitchen", 100_000)

	it, err := f.svc.UpdateItem(ctx, f.restID, f.owner, f.itemID, UpdateItemRequest{PriceKobo: func() *int64 { v := int64(110_000); return &v }()})
	if err != nil || it.Version != 2 {
		t.Fatalf("legacy (no expected_version) edit: err=%v version=%d, want version 2", err, it.Version)
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	start := make(chan struct{})
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			price := int64(120_000 + i)
			_, errs[i] = f.svc.UpdateItem(ctx, f.restID, f.owner, f.itemID, UpdateItemRequest{PriceKobo: &price, ExpectedVersion: intp(2)})
		}(i)
	}
	close(start)
	wg.Wait()
	ok, conflict := 0, 0
	for _, e := range errs {
		switch {
		case e == nil:
			ok++
		case errors.Is(e, ErrMenuItemVersionConflict):
			conflict++
			if menuErrStatus(e) != http.StatusConflict || statusCodeFor(e) != http.StatusConflict {
				t.Errorf("conflict must map to 409")
			}
		default:
			t.Fatalf("unexpected error: %v", e)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("ok=%d conflict=%d, want exactly 1 and 1", ok, conflict)
	}
	var v int
	_ = pool.QueryRow(ctx, `SELECT version FROM menu_items WHERE id=$1`, f.itemID).Scan(&v)
	if v != 3 {
		t.Errorf("version=%d, want 3 (one winner bumped it once)", v)
	}
	// A refused edit must change nothing.
	price := int64(1)
	if _, err := f.svc.UpdateItem(ctx, f.restID, f.owner, f.itemID, UpdateItemRequest{PriceKobo: &price, ExpectedVersion: intp(2)}); !errors.Is(err, ErrMenuItemVersionConflict) {
		t.Fatalf("stale edit: %v", err)
	}
	var p int64
	_ = pool.QueryRow(ctx, `SELECT price_kobo FROM menu_items WHERE id=$1`, f.itemID).Scan(&p)
	if p == 1 {
		t.Error("a conflicting PATCH still wrote its price")
	}
}

// B-008: a seller-set cap rejects larger lines with 400 and names the cap.
func TestLiveDB_W10_PerItemMaxQty(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Cap Kitchen", 100_000)

	if _, err := f.svc.UpdateItem(ctx, f.restID, f.owner, f.itemID, UpdateItemRequest{MaxQtyPerOrder: intp(3)}); err != nil {
		t.Fatalf("set cap: %v", err)
	}
	err := w10PlaceOne(f, 4)
	if !errors.Is(err, ErrOrderInvalid) || !strings.Contains(err.Error(), "maximum of 3") {
		t.Fatalf("qty 4 over cap 3: %v, want ErrOrderInvalid naming 3", err)
	}
	if st, _ := escrowErrStatus(err); st != http.StatusBadRequest {
		t.Errorf("status=%d, want 400", st)
	}
	if err := w10PlaceOne(f, 3); err != nil {
		t.Fatalf("qty 3 at cap: %v", err)
	}
	if _, err := f.svc.UpdateItem(ctx, f.restID, f.owner, f.itemID, UpdateItemRequest{MaxQtyPerOrder: intp(1001)}); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("cap 1001 must be invalid, got %v", err)
	}
	if _, err := f.svc.UpdateItem(ctx, f.restID, f.owner, f.itemID, UpdateItemRequest{MaxQtyPerOrder: intp(0)}); err != nil {
		t.Fatalf("clear cap: %v", err)
	}
	if err := w10PlaceOne(f, 4); err != nil {
		t.Fatalf("after clearing the cap qty 4 must pass: %v", err)
	}
}

// B-009: hours, closures and pause are enforced on the order path and via /is-open.
func TestLiveDB_W10_HoursClosuresPause(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Hours Kitchen", 100_000)
	now := time.Now()
	today := int(now.In(lagosTZ).Weekday())
	other := (today + 1) % 7

	// Hours only on another weekday -> closed now; order refused.
	if _, err := f.svc.SetBusinessHours(ctx, f.restID, f.owner, []BusinessHourInput{{DayOfWeek: other, Open: "09:00", Close: "17:00"}}); err != nil {
		t.Fatal(err)
	}
	if open, _ := f.svc.IsOpenNow(ctx, f.restID, now); open {
		t.Fatal("store with hours only on another day must be closed")
	}
	if err := w10PlaceOne(f, 1); !errors.Is(err, ErrRestaurantClosed) {
		t.Fatalf("order outside hours: %v, want ErrRestaurantClosed", err)
	}
	// All-day hours today -> open.
	if _, err := f.svc.SetBusinessHours(ctx, f.restID, f.owner, []BusinessHourInput{{DayOfWeek: today, Open: "00:00", Close: "24:00"}}); err != nil {
		t.Fatal(err)
	}
	if open, _ := f.svc.IsOpenNow(ctx, f.restID, now); !open {
		t.Fatal("all-day hours today must be open")
	}
	// Holiday closure today -> closed; removing it reopens.
	date := now.In(lagosTZ).Format("2006-01-02")
	if err := f.svc.SetHoliday(ctx, f.restID, f.owner, HolidayHour{Date: date, IsClosed: true}); err != nil {
		t.Fatal(err)
	}
	if open, _ := f.svc.IsOpenNow(ctx, f.restID, now); open {
		t.Fatal("holiday closure today must close the store")
	}
	if err := w10PlaceOne(f, 1); !errors.Is(err, ErrRestaurantClosed) {
		t.Fatalf("order on closure day: %v", err)
	}
	if err := f.svc.DeleteHoliday(ctx, f.restID, f.owner, date); err != nil {
		t.Fatal(err)
	}
	// Timed pause: closed for 2h; an ended pause is open again and the sweep clears it.
	until, err := f.svc.TimedPause(ctx, f.restID, f.owner, 120)
	if err != nil || time.Until(until) < 115*time.Minute {
		t.Fatalf("pause: until=%v err=%v", until, err)
	}
	if open, _ := f.svc.IsOpenNow(ctx, f.restID, now); open {
		t.Fatal("paused store must be closed")
	}
	if err := w10PlaceOne(f, 1); !errors.Is(err, ErrRestaurantClosed) {
		t.Fatalf("order while paused: %v", err)
	}
	if _, err := f.svc.TimedPause(ctx, f.restID, f.owner, 0); !errors.Is(err, ErrInvalidInput) {
		t.Errorf("0-minute pause must be invalid: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE restaurants SET paused_until = now() - interval '1 minute' WHERE id=$1`, f.restID); err != nil {
		t.Fatal(err)
	}
	if open, _ := f.svc.IsOpenNow(ctx, f.restID, time.Now()); !open {
		t.Fatal("an ended pause must reopen the store")
	}
	if n, err := f.svc.SweepTimedPauses(ctx, time.Now()); err != nil || n < 1 {
		t.Fatalf("sweep: n=%d err=%v", n, err)
	}
	var left *time.Time
	_ = pool.QueryRow(ctx, `SELECT paused_until FROM restaurants WHERE id=$1`, f.restID).Scan(&left)
	if left != nil {
		t.Error("sweep must clear paused_until")
	}
	if err := w10PlaceOne(f, 1); err != nil {
		t.Fatalf("order after pause ended: %v", err)
	}
}

// B-009: the HTTP surface — owner routes work, a stranger is refused, /is-open reflects a pause.
func TestLiveDB_W10_HoursRoutes(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Routes Kitchen", 100_000)
	h := NewHandler(f.svc)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	as := func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-User")) }
	g := r.Group("/restaurant", as)
	h.RegisterOwnerHoursRoutes(g)

	do := func(method, path, user, body string) (int, map[string]any) {
		req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		req.Header.Set("X-User", user)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var m map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &m)
		return w.Code, m
	}
	base := "/restaurant/" + f.restID
	if code, _ := do("PUT", base+"/hours", f.owner, `{"windows":[{"day_of_week":1,"open":"09:00","close":"17:00"}]}`); code != 200 {
		t.Fatalf("owner PUT hours: %d", code)
	}
	if code, m := do("GET", base+"/hours", f.owner, ""); code != 200 || len(m["windows"].([]any)) != 1 {
		t.Fatalf("owner GET hours: %d %v", code, m)
	}
	if code, _ := do("PUT", base+"/hours", f.customer, `{"windows":[]}`); code != 403 {
		t.Fatalf("customer PUT hours: %d, want 403", code)
	}
	if code, _ := do("PUT", base+"/hours", f.owner, `{"windows":[{"day_of_week":9,"open":"09:00","close":"17:00"}]}`); code != 400 {
		t.Fatalf("bad day: %d, want 400", code)
	}
	if code, _ := do("PUT", base+"/hours", f.owner, `{"windows":[]}`); code != 200 {
		t.Fatalf("clear hours: %d", code)
	}
	if code, _ := do("POST", base+"/hours/pause", f.owner, `{"minutes":120}`); code != 200 {
		t.Fatalf("pause: %d", code)
	}
	if _, m := do("GET", base+"/is-open", f.customer, ""); m["is_open"] != false {
		t.Fatalf("is-open while paused: %v", m)
	}
	if code, _ := do("DELETE", base+"/hours/pause", f.owner, ""); code != 200 {
		t.Fatalf("resume: %d", code)
	}
	if _, m := do("GET", base+"/is-open", f.customer, ""); m["is_open"] != true {
		t.Fatalf("is-open after resume: %v", m)
	}
	today := time.Now().In(lagosTZ).Format("2006-01-02")
	if code, _ := do("POST", base+"/hours/closures", f.owner, `{"date":"`+today+`","is_closed":true}`); code != 201 {
		t.Fatalf("closure: %d", code)
	}
	if _, m := do("GET", base+"/is-open", f.customer, ""); m["is_open"] != false {
		t.Fatalf("is-open on closure day: %v", m)
	}
}

// C-004: with listing moderation on, an KYB-approved but listing-PENDING store is not orderable.
func TestLiveDB_W10_UnapprovedListingNotOrderable(t *testing.T) {
	pool := promoOrderPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	f := newPromoOrderFixture(t, ctx, pool, "Pending Listing", 100_000)
	f.svc.WithModeration(true)
	if _, err := pool.Exec(ctx, `UPDATE restaurants SET kyb_status='approved', listing_review_status='PENDING' WHERE id=$1`, f.restID); err != nil {
		t.Fatal(err)
	}
	if err := w10PlaceOne(f, 1); !errors.Is(err, ErrRestaurantNotFound) {
		t.Fatalf("order on PENDING listing: %v, want ErrRestaurantNotFound", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE restaurants SET listing_review_status='APPROVED' WHERE id=$1`, f.restID); err != nil {
		t.Fatal(err)
	}
	if err := w10PlaceOne(f, 1); err != nil {
		t.Fatalf("order on APPROVED listing: %v", err)
	}
}

// E-013: the retention window is configurable; default stays 30 days.
func TestW10_RiderLocationRetentionWindow(t *testing.T) {
	t.Setenv("FOOD_RIDER_LOCATION_RETENTION_DAYS", "")
	if riderLocationRetentionWindow() != 30*24*time.Hour {
		t.Error("default must be 30 days")
	}
	t.Setenv("FOOD_RIDER_LOCATION_RETENTION_DAYS", "7")
	if riderLocationRetentionWindow() != 7*24*time.Hour {
		t.Error("7 days not honoured")
	}
	t.Setenv("FOOD_RIDER_LOCATION_RETENTION_DAYS", "-3")
	if riderLocationRetentionWindow() != 30*24*time.Hour {
		t.Error("invalid value must fall back to 30 days")
	}
}
