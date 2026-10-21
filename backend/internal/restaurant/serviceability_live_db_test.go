package restaurant

// LIVE-DB regression for FOOD-UAT-C-001 (dish search in discovery) and
// FOOD-UAT-C-003 (serviceability zones). Needs migration 20271065000004.

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/internal/testsupport"
)

func TestLiveDB_DiscoveryDishSearch(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := t.Context()
	svc := NewService(pool, nil)
	owner := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test")
	testsupport.CleanupUser(t, pool, owner)
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Plain Canteen','1 St',TRUE)`, restID, owner); err != nil {
		t.Fatal(err)
	}
	dish := "Jollof" + uuid.New().String()[:8]
	cat, err := svc.CreateCategory(ctx, restID, owner, "Mains")
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range []string{dish + " Rice", dish + " Party", dish + " Special"} { // 3 matches -> still 1 row
		if _, err := svc.CreateItem(ctx, restID, owner, CreateItemRequest{CategoryID: cat.ID, Name: n, PriceKobo: 100000}); err != nil {
			t.Fatal(err)
		}
	}
	page, err := svc.ListOpenRestaurantsPage(ctx, DiscoveryParams{Query: dish}, "")
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Restaurants) != 1 || page.Restaurants[0].ID != restID {
		t.Fatalf("dish search: total=%d rows=%d", page.Total, len(page.Restaurants))
	}
	// Existing filters still compose: wrong cuisine excludes it.
	page, _ = svc.ListOpenRestaurantsPage(ctx, DiscoveryParams{Query: dish, Cuisine: "nonexistent-cuisine"}, "")
	if page.Total != 0 {
		t.Fatalf("cuisine filter lost: total=%d", page.Total)
	}
}

func TestLiveDB_Serviceability(t *testing.T) {
	pool := withdrawalPool(t)
	defer pool.Close()
	ctx := t.Context()
	svc := NewService(pool, nil)
	owner := uuid.New().String()
	_, _ = pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test")
	testsupport.CleanupUser(t, pool, owner)
	restID := uuid.New().String()
	// Lagos Island pin.
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open, geo_lat, geo_lng) VALUES ($1,$2,'Zone Kitchen','1 St',TRUE,6.4541,3.3947)`, restID, owner); err != nil {
		t.Fatal(err)
	}
	farLat, farLng := 12.0, 8.5 // Kano, ~800+ km

	// (c) no zone + no default -> permissive.
	if ok, _, err := svc.CheckServiceable(ctx, restID, farLat, farLng); !ok || err != nil {
		t.Fatalf("no-config must be permissive: ok=%v err=%v", ok, err)
	}
	if _, err := svc.CreateRadiusZone(ctx, restID, owner, 100000); err != nil { // 10 km
		t.Fatal(err)
	}
	// (a) inside radius.
	if ok, _, err := svc.CheckServiceable(ctx, restID, 6.4281, 3.4219); !ok || err != nil {
		t.Fatalf("nearby address must be serviceable: ok=%v err=%v", ok, err)
	}
	// (b) far away -> 400 not_serviceable via the route middleware.
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/:id/delivery-quote", NewHandler(svc).RequireServiceable(), func(c *gin.Context) { c.Status(http.StatusOK) })
	post := func(body string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/"+restID+"/delivery-quote", bytes.NewBufferString(body))
		r.ServeHTTP(w, req)
		return w
	}
	w := post(`{"lat":12.0,"lng":8.5}`)
	if w.Code != 400 || !strings.Contains(w.Body.String(), `"not_serviceable"`) || !strings.Contains(w.Body.String(), `"max_km_bps":100000`) {
		t.Fatalf("far quote: %d %s", w.Code, w.Body.String())
	}
	if w := post(`{"lat":6.4281,"lng":3.4219}`); w.Code != 200 {
		t.Fatalf("near quote: %d %s", w.Code, w.Body.String())
	}
	// Default column applies once zones are gone.
	zs, _ := svc.ListZones(ctx, restID)
	for _, z := range zs {
		_, _ = svc.DeleteZone(ctx, restID, z.ID, owner)
	}
	if _, err := pool.Exec(ctx, `UPDATE restaurants SET max_delivery_km_bps=50000 WHERE id=$1`, restID); err != nil {
		t.Fatal(err)
	}
	if ok, _, err := svc.CheckServiceable(ctx, restID, farLat, farLng); ok || err == nil {
		t.Fatalf("default max must refuse far address")
	}
}
