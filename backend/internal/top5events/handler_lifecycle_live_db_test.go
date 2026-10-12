package top5events_test

// Handler-level tests for the organiser lifecycle routes (PATCH/duplicate/
// pause/resume/cancel). Live-DB tests skip unless TEST_DATABASE_URL is set.

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/top5events"
)

func lifecycleRouter(userID string, h *top5events.Handler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/events", func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	h.RegisterLifecycle(g)
	return r
}

func lifecycleDo(r *gin.Engine, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	r.ServeHTTP(w, req)
	return w
}

func TestLifecycleRoutes_NotRegisteredByRegister(t *testing.T) {
	// Register() alone (what runs with the sub-flag off) must not expose them.
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/events")
	top5events.NewHandler(nil).Register(g, r.Group("/admin"), func(string) gin.HandlerFunc { return func(*gin.Context) {} })
	for _, rt := range [][2]string{{"PATCH", "/events/x"}, {"POST", "/events/x/duplicate"}, {"POST", "/events/x/pause"}, {"POST", "/events/x/resume"}, {"POST", "/events/x/cancel"}} {
		if w := lifecycleDo(r, rt[0], rt[1], "{}", nil); w.Code != http.StatusNotFound {
			t.Fatalf("%s %s = %d, want 404", rt[0], rt[1], w.Code)
		}
	}
}

func TestLiveDB_LifecycleHandlers(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc := ticketTokenService(pool)
	h := top5events.NewHandler(svc)
	owner := seedTicketTokenUser(t, ctx, pool)
	other := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")

	ro := lifecycleRouter(owner, h)
	rx := lifecycleRouter(other, h)

	if w := lifecycleDo(ro, "PATCH", "/events/"+ev, `{"description":"via http"}`, nil); w.Code != 200 {
		t.Fatalf("PATCH = %d %s", w.Code, w.Body)
	}
	var d string
	_ = pool.QueryRow(ctx, `SELECT description FROM events WHERE id=$1`, ev).Scan(&d)
	if d != "via http" {
		t.Fatalf("persisted description = %q", d)
	}
	if w := lifecycleDo(rx, "PATCH", "/events/"+ev, `{"description":"hax"}`, nil); w.Code != 403 {
		t.Fatalf("non-owner PATCH = %d, want 403", w.Code)
	}
	if w := lifecycleDo(ro, "PATCH", "/events/00000000-0000-0000-0000-000000000000", `{"title":"x"}`, nil); w.Code != 404 {
		t.Fatalf("missing PATCH = %d, want 404", w.Code)
	}
	if w := lifecycleDo(ro, "PATCH", "/events/"+ev, `{"starts_at":"2099-01-02T00:00:00Z","ends_at":"2099-01-01T00:00:00Z"}`, nil); w.Code != 400 {
		t.Fatalf("bad times PATCH = %d, want 400", w.Code)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/pause", "", nil); w.Code != 200 {
		t.Fatalf("pause = %d %s", w.Code, w.Body)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/resume", "", nil); w.Code != 200 {
		t.Fatalf("resume = %d %s", w.Code, w.Body)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/duplicate", "", nil); w.Code != 201 {
		t.Fatalf("duplicate = %d %s", w.Code, w.Body)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/cancel", `{"reason":"x"}`, nil); w.Code != 400 {
		t.Fatalf("cancel w/o key = %d, want 400", w.Code)
	}
	if w := lifecycleDo(rx, "POST", "/events/"+ev+"/cancel", `{"reason":"x"}`, map[string]string{"Idempotency-Key": "k-1"}); w.Code != 403 {
		t.Fatalf("non-owner cancel = %d, want 403", w.Code)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/cancel", `{"reason":"x"}`, map[string]string{"Idempotency-Key": "k-2"}); w.Code != 202 {
		t.Fatalf("owner cancel = %d %s", w.Code, w.Body)
	}
}
