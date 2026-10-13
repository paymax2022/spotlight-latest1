package top5events_test

// Handler-level tests for the team-role routes (FEATURE_EVENTS_TEAM_ROLES).
// Live-DB tests skip unless TEST_DATABASE_URL is set.

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/top5events"
)

func teamRouter(userID string, h *top5events.Handler, flagOn bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/events", func(c *gin.Context) { c.Set("user_id", userID); c.Next() })
	if flagOn {
		h.RegisterTeam(g)
	}
	return r
}

func TestLiveDB_TeamHandlers_FlagOn(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	h := top5events.NewHandler(ticketTokenService(pool))
	owner := seedTicketTokenUser(t, ctx, pool)
	other := seedTicketTokenUser(t, ctx, pool)
	mgr, handle := seedTeamHandleUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	ro, rx := teamRouter(owner, h, true), teamRouter(other, h, true)
	base := "/events/" + ev + "/team"
	body := `{"user_handle":"@` + handle + `","role":"MANAGER"}`

	if w := lifecycleDo(rx, "POST", base, body, nil); w.Code != http.StatusForbidden {
		t.Fatalf("non-owner POST = %d %s, want 403", w.Code, w.Body)
	}
	if w := lifecycleDo(ro, "POST", base, `{"user_handle":"@`+handle+`","role":"FINANCE"}`, nil); w.Code != http.StatusBadRequest {
		t.Fatalf("FINANCE POST = %d %s, want 400", w.Code, w.Body)
	}
	w := lifecycleDo(ro, "POST", base, body, nil)
	if w.Code != http.StatusCreated || !strings.Contains(w.Body.String(), mgr) {
		t.Fatalf("owner POST = %d %s, want 201 with member", w.Code, w.Body)
	}
	if w := lifecycleDo(rx, "GET", base, "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("non-owner GET = %d, want 403", w.Code)
	}
	w = lifecycleDo(ro, "GET", base, "", nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), mgr) {
		t.Fatalf("owner GET = %d %s, want 200 with member", w.Code, w.Body)
	}
	if w := lifecycleDo(rx, "DELETE", base+"/"+mgr, "", nil); w.Code != http.StatusForbidden {
		t.Fatalf("non-owner DELETE = %d, want 403", w.Code)
	}
	if w := lifecycleDo(ro, "DELETE", base+"/"+mgr, "", nil); w.Code != http.StatusOK {
		t.Fatalf("owner DELETE = %d %s, want 200", w.Code, w.Body)
	}
	if n := teamRowCount(t, ctx, pool, ev); n != 0 {
		t.Fatalf("rows after delete = %d, want 0", n)
	}
}

func TestLiveDB_TeamHandlers_FlagOff(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	h := top5events.NewHandler(ticketTokenService(pool))
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	r := teamRouter(owner, h, false)
	base := "/events/" + ev + "/team"
	for _, rt := range [][3]string{
		{"POST", base, `{"user_handle":"@x","role":"MANAGER"}`},
		{"GET", base, ""},
		{"DELETE", base + "/someone", ""},
	} {
		if w := lifecycleDo(r, rt[0], rt[1], rt[2], nil); w.Code != http.StatusNotFound {
			t.Fatalf("%s %s = %d, want 404", rt[0], rt[1], w.Code)
		}
	}
}
