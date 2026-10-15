package connectvoting

// DB-free tests for the contest list's `status` filter and the contest logo.
//
// The mobile + web "Active contests" lists showed closed contests too because
// GET /contests always returned open AND closed, and ignored any ?status=. The
// filter is an ALLOWLIST mapped to the two stored states (open|closed): an
// unrecognised value is a 400, never a silently-unfiltered list and never text
// that reaches SQL. No ?status keeps today's behaviour (open + closed) so
// existing callers are unaffected.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestContestStatusFilter(t *testing.T) {
	both := []string{"open", "closed"}
	cases := []struct {
		in      string
		want    []string
		wantErr bool
	}{
		{"", both, false},
		{"all", both, false},
		{"active", []string{"open"}, false},
		{"open", []string{"open"}, false},
		{"closed", []string{"closed"}, false},
		{"ended", []string{"closed"}, false},
		{"  ACTIVE ", []string{"open"}, false},
		{"Closed", []string{"closed"}, false},
		{"draft", nil, true},
		{"upcoming", nil, true},
		{"garbage", nil, true},
		{"open' OR '1'='1", nil, true},
		{"open,closed", nil, true},
	}
	for _, tc := range cases {
		got, err := contestStatusFilter(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("%q: want an error, got %v", tc.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("%q: unexpected error %v", tc.in, err)
			continue
		}
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("%q: got %v, want %v", tc.in, got, tc.want)
		}
	}
}

// A nil-service handler proves the status check happens BEFORE the database:
// any query attempt on the zero Service would panic.
func TestListContestsHandler_RejectsUnknownStatusBeforeDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(&Service{})
	r.GET("/contests", h.ListContests)

	for _, status := range []string{"draft", "garbage", "open,closed"} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/contests?status="+status, nil)
		r.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Errorf("status=%s: want 400, got %d (%s)", status, w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), "status") {
			t.Errorf("status=%s: error should name the field, got %s", status, w.Body.String())
		}
	}
}

func TestContestJSON_CarriesLogoAndBanner(t *testing.T) {
	withBoth, _ := json.Marshal(Contest{ID: "c1", LogoURL: "https://cdn/logo.png", BannerImageURL: "https://cdn/banner.jpg"})
	for _, want := range []string{`"logo_url":"https://cdn/logo.png"`, `"banner_image_url":"https://cdn/banner.jpg"`} {
		if !strings.Contains(string(withBoth), want) {
			t.Errorf("contest JSON missing %s in %s", want, withBoth)
		}
	}
	// An unset logo is omitted, like the banner: clients treat absent as "none".
	without, _ := json.Marshal(Contest{ID: "c2"})
	if strings.Contains(string(without), "logo_url") {
		t.Errorf("an empty logo should be omitted, got %s", without)
	}
}
