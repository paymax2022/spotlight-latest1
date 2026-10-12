package top5events_test

// Handler-level tests for the ticketing-depth PATCH routes (tier/promo edit).
// Live-DB tests skip unless TEST_DATABASE_URL is set.

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/top5events"
)

func ticketingRouter(userID string, h *top5events.Handler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/events", func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	h.RegisterTicketing(g)
	return r
}

func TestTicketingRoutes_NotRegisteredByRegister(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/events")
	top5events.NewHandler(nil).Register(g, r.Group("/admin"), func(string) gin.HandlerFunc { return func(*gin.Context) {} })
	for _, rt := range [][2]string{{"PATCH", "/events/x/tiers/y"}, {"PATCH", "/events/x/promos/y"}} {
		if w := lifecycleDo(r, rt[0], rt[1], "{}", nil); w.Code != http.StatusNotFound {
			t.Fatalf("%s %s = %d, want 404", rt[0], rt[1], w.Code)
		}
	}
}

func TestLiveDB_TicketingHandlers(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	h := top5events.NewHandler(ticketTokenService(pool))
	owner := seedTicketTokenUser(t, ctx, pool)
	other := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	freshTier := seedTier(t, ctx, pool, ev, 1000, 10, 0)
	soldTier := seedTier(t, ctx, pool, ev, 1000, 10, 3)
	ro, rx := ticketingRouter(owner, h), ticketingRouter(other, h)

	tp := "/events/" + ev + "/tiers/"
	if w := lifecycleDo(ro, "PATCH", tp+freshTier, `{"name":"VIP","price_kobo":2500}`, nil); w.Code != 200 {
		t.Fatalf("PATCH tier = %d %s", w.Code, w.Body)
	}
	var name string
	var price int64
	_ = pool.QueryRow(ctx, `SELECT name, price_kobo FROM event_ticket_tiers WHERE id=$1`, freshTier).Scan(&name, &price)
	if name != "VIP" || price != 2500 {
		t.Fatalf("persisted = %q %d", name, price)
	}
	if w := lifecycleDo(ro, "PATCH", tp+freshTier, `{"sales_start_at":"2099-01-02T00:00:00Z","sales_end_at":"2099-01-01T00:00:00Z"}`, nil); w.Code != 400 {
		t.Fatalf("bad window = %d %s, want 400", w.Code, w.Body)
	}
	if w := lifecycleDo(ro, "PATCH", tp+soldTier, `{"price_kobo":1}`, nil); w.Code != 409 {
		t.Fatalf("locked price = %d %s, want 409", w.Code, w.Body)
	}
	if w := lifecycleDo(rx, "PATCH", tp+freshTier, `{"name":"hax"}`, nil); w.Code != 403 {
		t.Fatalf("non-owner = %d, want 403", w.Code)
	}

	promo := seedUsedPromo(t, ctx, pool, ev, 2, 10)
	pp := "/events/" + ev + "/promos/"
	if w := lifecycleDo(ro, "PATCH", pp+promo, `{"max_uses":20}`, nil); w.Code != 200 {
		t.Fatalf("PATCH promo = %d %s", w.Code, w.Body)
	}
	if w := lifecycleDo(ro, "PATCH", pp+promo, `{"percent_off":5}`, nil); w.Code != 409 {
		t.Fatalf("locked promo = %d %s, want 409", w.Code, w.Body)
	}
	if w := lifecycleDo(rx, "PATCH", pp+promo, `{"active":false}`, nil); w.Code != 403 {
		t.Fatalf("non-owner promo = %d, want 403", w.Code)
	}
}
