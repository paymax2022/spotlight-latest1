package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/telemetry/navigation"
)

type fakeNavLister struct {
	evs   []navigation.Event
	err   error
	gotID string
	gotN  int
}

func (f *fakeNavLister) ListRecentByUser(_ context.Context, id string, n int) ([]navigation.Event, error) {
	f.gotID, f.gotN = id, n
	return f.evs, f.err
}

func serveNav(f *fakeNavLister) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/users/:id/navigation", AdminUserNavigationHandler(f))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/users/u-1/navigation", nil))
	return w
}

func TestAdminUserNavigation_MapsFieldsWithoutUserID(t *testing.T) {
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	f := &fakeNavLister{evs: []navigation.Event{{UserID: "secret-uid", Surface: "mobile", Route: "/wallet", OccurredAt: at}}}
	w := serveNav(f)
	if w.Code != 200 {
		t.Fatalf("code %d", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"surface":"mobile"`) || !strings.Contains(body, `"route":"/wallet"`) ||
		!strings.Contains(body, `"occurred_at":"2026-01-02T03:04:05Z"`) {
		t.Fatalf("body = %s", body)
	}
	if strings.Contains(body, "secret-uid") || strings.Contains(strings.ToLower(body), "user_id") {
		t.Fatalf("leaks user id: %s", body)
	}
	if f.gotID != "u-1" || f.gotN != 100 {
		t.Fatalf("called with %q,%d", f.gotID, f.gotN)
	}
}

func TestAdminUserNavigation_EmptyIsArray(t *testing.T) {
	w := serveNav(&fakeNavLister{})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"events":[]`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}

func TestAdminUserNavigation_ErrorIsSanitized(t *testing.T) {
	w := serveNav(&fakeNavLister{err: errors.New("pq: secret detail")})
	if w.Code != 500 || strings.Contains(w.Body.String(), "secret detail") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}

type fakeNavAgg struct {
	out *navigation.NavAnalytics
	err error
	got navigation.AnalyticsFilter
}

func (f *fakeNavAgg) AggregateNavigation(_ context.Context, af navigation.AnalyticsFilter) (*navigation.NavAnalytics, error) {
	f.got = af
	return f.out, f.err
}

func serveNavAgg(f *fakeNavAgg, query string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/analytics/navigation", AdminNavigationAnalyticsHandler(f))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/analytics/navigation"+query, nil))
	return w
}

func TestNavigationAnalytics_DefaultsAndShape(t *testing.T) {
	f := &fakeNavAgg{out: &navigation.NavAnalytics{
		TopScreens:   []navigation.TopScreen{{Route: "/wallet", Views: 3, Users: 2}},
		Timeseries:   []navigation.DayBucket{{Day: "2026-01-02", Mobile: 1, Web: 2, Total: 3}},
		SurfaceSplit: navigation.SurfaceSplit{Mobile: 1, Web: 2, Total: 3},
	}}
	w := serveNavAgg(f, "")
	if w.Code != 200 {
		t.Fatalf("code %d", w.Code)
	}
	if f.got.Range != "30d" || f.got.Surface != "all" || f.got.Search != "" {
		t.Fatalf("filter = %+v", f.got)
	}
	body := w.Body.String()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatal(err)
	}
	want := `{"range":"30d","surface":"all","surfaceSplit":{"mobile":1,"total":3,"web":2},` +
		`"timeseries":[{"day":"2026-01-02","mobile":1,"total":3,"web":2}],` +
		`"topScreens":[{"route":"/wallet","users":2,"views":3}]}`
	if body != want {
		t.Fatalf("body = %s", body)
	}
	if strings.Contains(strings.ToLower(body), "user_id") {
		t.Fatalf("leaks user_id: %s", body)
	}
}

func TestNavigationAnalytics_CoercesInvalid(t *testing.T) {
	f := &fakeNavAgg{out: &navigation.NavAnalytics{}}
	w := serveNavAgg(f, "?range=bogus&surface=bogus&search=cry")
	if w.Code != 200 || f.got.Range != "30d" || f.got.Surface != "all" || f.got.Search != "cry" {
		t.Fatalf("%d %+v", w.Code, f.got)
	}
	if !strings.Contains(w.Body.String(), `"topScreens":[]`) || !strings.Contains(w.Body.String(), `"timeseries":[]`) {
		t.Fatalf("nil slices not arrays: %s", w.Body.String())
	}
	serveNavAgg(f, "?range=7d&surface=web")
	if f.got.Range != "7d" || f.got.Surface != "web" {
		t.Fatalf("valid values altered: %+v", f.got)
	}
	serveNavAgg(f, "?range=90d&surface=mobile")
	if f.got.Range != "90d" || f.got.Surface != "mobile" {
		t.Fatalf("%+v", f.got)
	}
}

func TestNavigationAnalytics_ErrorIsSanitized(t *testing.T) {
	w := serveNavAgg(&fakeNavAgg{err: errors.New("pq: secret detail")}, "")
	if w.Code != 500 || strings.Contains(w.Body.String(), "secret detail") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}

type fakeFunnelRepo struct {
	events []navigation.StepEvent
	err    error
	steps  []string
	got    navigation.AnalyticsFilter
	called bool
}

func (f *fakeFunnelRepo) FunnelStepEvents(_ context.Context, steps []string, af navigation.AnalyticsFilter) ([]navigation.StepEvent, error) {
	f.called, f.steps, f.got = true, steps, af
	return f.events, f.err
}

func serveFunnel(f *fakeFunnelRepo, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/analytics/navigation/funnel", AdminNavigationFunnelHandler(f))
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/analytics/navigation/funnel", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestNavigationFunnel_StepCountBounds(t *testing.T) {
	f := &fakeFunnelRepo{}
	if w := serveFunnel(f, `{"steps":["/a"]}`); w.Code != 400 {
		t.Fatalf("1 step: %d", w.Code)
	}
	eleven := `{"steps":["/1","/2","/3","/4","/5","/6","/7","/8","/9","/10","/11"]}`
	if w := serveFunnel(f, eleven); w.Code != 400 {
		t.Fatalf("11 steps: %d", w.Code)
	}
	if w := serveFunnel(f, `{"steps":["/a",""]}`); w.Code != 400 {
		t.Fatalf("empty step: %d", w.Code)
	}
	if w := serveFunnel(f, `{"steps":["/a","`+strings.Repeat("x", 257)+`"]}`); w.Code != 400 {
		t.Fatalf("long step: %d", w.Code)
	}
	if w := serveFunnel(f, `not json`); w.Code != 400 {
		t.Fatalf("bad json: %d", w.Code)
	}
	if f.called {
		t.Fatal("repo called on invalid input")
	}
}

func TestNavigationFunnel_ShapeAndNoUserID(t *testing.T) {
	at := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	f := &fakeFunnelRepo{events: []navigation.StepEvent{
		{UserID: "u1", Route: "/a", OccurredAt: at},
		{UserID: "u1", Route: "/b", OccurredAt: at.Add(time.Minute)},
		{UserID: "u2", Route: "/a", OccurredAt: at},
	}}
	w := serveFunnel(f, `{"steps":["/a","/b"]}`)
	if w.Code != 200 {
		t.Fatalf("code %d %s", w.Code, w.Body.String())
	}
	want := `{"gapMinutes":30,"range":"30d","steps":[{"route":"/a","users":2},{"route":"/b","users":1}],"surface":"all"}`
	if w.Body.String() != want {
		t.Fatalf("body = %s", w.Body.String())
	}
	if strings.Contains(strings.ToLower(w.Body.String()), "user_id") {
		t.Fatalf("leaks user_id: %s", w.Body.String())
	}
	if f.got.Range != "30d" || f.got.Surface != "all" || len(f.steps) != 2 {
		t.Fatalf("filter = %+v steps=%v", f.got, f.steps)
	}
}

func TestNavigationFunnel_CoercesAndClamps(t *testing.T) {
	f := &fakeFunnelRepo{}
	w := serveFunnel(f, `{"steps":["/a","/b"],"range":"bogus","surface":"bogus","gapMinutes":99999}`)
	if w.Code != 200 || f.got.Range != "30d" || f.got.Surface != "all" || !strings.Contains(w.Body.String(), `"gapMinutes":1440`) {
		t.Fatalf("%d %+v %s", w.Code, f.got, w.Body.String())
	}
	w = serveFunnel(f, `{"steps":["/a","/b"],"range":"7d","surface":"web","gapMinutes":-5}`)
	if f.got.Range != "7d" || f.got.Surface != "web" || !strings.Contains(w.Body.String(), `"gapMinutes":1`) {
		t.Fatalf("%+v %s", f.got, w.Body.String())
	}
	w = serveFunnel(f, `{"steps":["/a","/b"],"gapMinutes":0}`)
	if !strings.Contains(w.Body.String(), `"gapMinutes":30`) {
		t.Fatalf("zero gap should default: %s", w.Body.String())
	}
}

func TestNavigationFunnel_ErrorIsSanitized(t *testing.T) {
	w := serveFunnel(&fakeFunnelRepo{err: errors.New("pq: secret detail")}, `{"steps":["/a","/b"]}`)
	if w.Code != 500 || strings.Contains(w.Body.String(), "secret detail") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
}
