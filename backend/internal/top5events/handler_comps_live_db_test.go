package top5events_test

// Handler-level tests for the Phase-3 comp / attendee-export / announcement
// routes (FEATURE_EVENTS_COMPS). Live-DB tests skip unless TEST_DATABASE_URL is set.

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/top5events"
)

// compsRouter mounts Register (attendees JSON is unconditional) and, when
// flagOn, RegisterComps — mirroring top5_routes.go.
func compsRouter(userID string, h *top5events.Handler, flagOn bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/events", func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	h.Register(g, r.Group("/admin"), func(string) gin.HandlerFunc { return func(*gin.Context) {} })
	if flagOn {
		h.RegisterComps(g)
	}
	return r
}

func TestLiveDB_CompsHandlers_FlagOn(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	h := top5events.NewHandler(ticketTokenService(pool))
	owner := seedTicketTokenUser(t, ctx, pool)
	other := seedTicketTokenUser(t, ctx, pool)
	_, handle := seedHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 5000, 10, 0)
	ro, rx := compsRouter(owner, h, true), compsRouter(other, h, true)

	body := `{"tier_id":"` + tier + `","recipients":["@` + handle + `"],"note":"VIP"}`
	w := lifecycleDo(ro, "POST", "/events/"+ev+"/comps", body, map[string]string{"Idempotency-Key": newIdem()})
	if w.Code != http.StatusCreated {
		t.Fatalf("comps = %d %s, want 201", w.Code, w.Body)
	}
	var env struct {
		Success bool              `json:"success"`
		Data    []json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || !env.Success || len(env.Data) != 1 {
		t.Fatalf("envelope = %s (%v)", w.Body, err)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/comps", body, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("no idem key = %d %s, want 400", w.Code, w.Body)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/comps", `{"tier_id":"","recipients":[]}`, map[string]string{"Idempotency-Key": newIdem()}); w.Code != http.StatusBadRequest {
		t.Fatalf("empty body = %d %s, want 400", w.Code, w.Body)
	}
	if w := lifecycleDo(rx, "POST", "/events/"+ev+"/comps", body, map[string]string{"Idempotency-Key": newIdem()}); w.Code != http.StatusForbidden {
		t.Fatalf("non-owner comp = %d, want 403", w.Code)
	}

	w = lifecycleDo(ro, "GET", "/events/"+ev+"/attendees?format=csv", "", nil)
	if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("csv = %d ct=%q %s", w.Code, w.Header().Get("Content-Type"), w.Body)
	}
	if !strings.Contains(w.Header().Get("Content-Disposition"), "attendees-"+ev+".csv") {
		t.Fatalf("content-disposition = %q", w.Header().Get("Content-Disposition"))
	}
	if w := lifecycleDo(rx, "GET", "/events/"+ev+"/attendees?format=csv", "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("non-owner csv = %d, want 403", w.Code)
	}
	if w := lifecycleDo(ro, "GET", "/events/"+ev+"/attendees", "", nil); w.Code != http.StatusOK || strings.HasPrefix(w.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("plain attendees = %d ct=%q", w.Code, w.Header().Get("Content-Type"))
	}

	ann := `{"subject":"Doors","body":"Doors open at 6"}`
	if w := lifecycleDo(rx, "POST", "/events/"+ev+"/announcements", ann, map[string]string{"Idempotency-Key": newIdem()}); w.Code != http.StatusForbidden {
		t.Fatalf("non-owner announce = %d, want 403", w.Code)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/announcements", ann, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("announce no key = %d, want 400", w.Code)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/announcements", ann, map[string]string{"Idempotency-Key": newIdem()}); w.Code != http.StatusAccepted {
		t.Fatalf("owner announce = %d %s, want 202", w.Code, w.Body)
	}
}

func TestLiveDB_CompsHandlers_FlagOff(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	h := top5events.NewHandler(ticketTokenService(pool))
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	ro := compsRouter(owner, h, false)

	hdr := map[string]string{"Idempotency-Key": newIdem()}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/comps", "{}", hdr); w.Code != http.StatusNotFound {
		t.Fatalf("comps flag off = %d, want 404", w.Code)
	}
	if w := lifecycleDo(ro, "POST", "/events/"+ev+"/announcements", "{}", hdr); w.Code != http.StatusNotFound {
		t.Fatalf("announcements flag off = %d, want 404", w.Code)
	}
	if w := lifecycleDo(ro, "GET", "/events/"+ev+"/attendees?format=csv", "", nil); w.Code != http.StatusNotFound {
		t.Fatalf("csv flag off = %d, want 404", w.Code)
	}
	if w := lifecycleDo(ro, "GET", "/events/"+ev+"/attendees", "", nil); w.Code != http.StatusOK {
		t.Fatalf("plain attendees flag off = %d, want 200", w.Code)
	}
}
