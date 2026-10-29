package healthvet

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestReportingSince(t *testing.T) {
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	cases := map[string]string{"": "All time", "all": "All time", "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", "ytd": "Year to date"}
	for in, label := range cases {
		since, got, ok := reportingSince(in, now)
		if !ok || got != label {
			t.Fatalf("%q → %q %v", in, got, ok)
		}
		if (in == "" || in == "all") != (since == nil) {
			t.Fatalf("%q: since=%v", in, since)
		}
	}
	if s, _, _ := reportingSince("ytd", now); !s.Equal(time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("ytd bound = %v", s)
	}
	if _, _, ok := reportingSince("fortnight", now); ok {
		t.Fatal("unknown period must be refused")
	}
}

// A bad period is refused before any DB access (nil-dependency Service).
func TestReportingHandlers_RejectUnknownPeriod(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/reporting", h.AdminConsoleReporting)
	r.GET("/reporting/export.csv", h.AdminReportingExportCSV)
	for _, p := range []string{"/reporting?period=fortnight", "/reporting/export.csv?period=fortnight"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, p, nil))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status %d, want 400", p, w.Code)
		}
	}
}
