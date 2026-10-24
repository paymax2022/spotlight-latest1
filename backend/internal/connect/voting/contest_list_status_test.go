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

// The admin list is where a newly created contest becomes visible: contests are
// born as drafts, and only the admin filter maps ""/all onto the three stored
// statuses. Anything the member filter understands works the same here; the
// member route keeping draft out (asserted above) is what protects voters from
// reading an unpublished contest.
func TestContestStatusFilterAdmin(t *testing.T) {
	all := []string{"draft", "open", "closed"}
	cases := []struct {
		in      string
		want    []string
		wantErr bool
	}{
		{"", all, false},
		{"all", all, false},
		{"draft", []string{"draft"}, false},
		{" Draft ", []string{"draft"}, false},
		{"upcoming", []string{"draft"}, false},
		{"active", []string{"open"}, false},
		{"open", []string{"open"}, false},
		{"closed", []string{"closed"}, false},
		{"ended", []string{"closed"}, false},
		{"garbage", nil, true},
		{"open,closed", nil, true},
	}
	for _, tc := range cases {
		got, err := contestStatusFilterAdmin(tc.in)
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

// The admin route's 400 has to name draft as an option, otherwise an operator
// reading the error still believes the value they tried is unsupported.
func TestListContestsAdminHandler_RejectsUnknownStatusBeforeDB(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := NewHandler(&Service{})
	r.GET("/admin/contests", h.ListContestsAdmin)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/admin/contests?status=garbage", nil))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d (%s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "draft") {
		t.Errorf("admin error should offer draft, got %s", w.Body.String())
	}
}

// The admin contests list has no pager, so a page size that quietly collapses
// back to the default reads as "these are all the contests that exist". An
// over-large request is clamped to the ceiling instead; only an absent or
// non-positive one takes the default.
func TestContestListLimit(t *testing.T) {
	cases := []struct {
		in   int
		want int
	}{
		{0, contestListDefaultLimit},
		{-1, contestListDefaultLimit},
		{10, 10},
		{50, 50},
		{200, 200},
		{500, contestListMaxLimit},
		{501, contestListMaxLimit},
		{100000, contestListMaxLimit},
	}
	for _, tc := range cases {
		if got := contestListLimit(tc.in); got != tc.want {
			t.Errorf("limit %d: got %d, want %d", tc.in, got, tc.want)
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

// The admin console's Edit link is built from the slug, so it has to reach the
// client — and a fixture row with no public.contests record must stay absent
// rather than arriving as an empty string the page would link on.
func TestContestJSON_CarriesSlugForTheEditLink(t *testing.T) {
	with, _ := json.Marshal(Contest{ID: "c1", Slug: "rising-stars"})
	if !strings.Contains(string(with), `"slug":"rising-stars"`) {
		t.Errorf("contest JSON lost the slug: %s", with)
	}
	none, _ := json.Marshal(Contest{ID: "c2"})
	if strings.Contains(string(none), "slug") {
		t.Errorf("an empty slug should be omitted, got %s", none)
	}
}
