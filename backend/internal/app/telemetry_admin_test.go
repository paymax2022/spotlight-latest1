package app

import (
	"context"
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
