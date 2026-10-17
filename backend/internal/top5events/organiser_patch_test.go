package top5events

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// TestOrganiserPatch_BannerThreeStates pins the clear-banner semantics: an absent
// banner_url is "no change", an explicit null or empty string is "clear", and a
// value is "set".
func TestOrganiserPatch_BannerThreeStates(t *testing.T) {
	cases := []struct {
		name    string
		body    string
		set     bool
		isNil   bool
		wantVal string
	}{
		{"absent", `{"bio":"x"}`, false, true, ""},
		{"null", `{"banner_url":null}`, true, true, ""},
		{"empty string", `{"banner_url":""}`, true, false, ""},
		{"value", `{"banner_url":"https://e.com/b.png"}`, true, false, "https://e.com/b.png"},
	}
	for _, tc := range cases {
		var p OrganiserPatch
		if err := json.Unmarshal([]byte(tc.body), &p); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if p.BannerSet != tc.set || (p.BannerURL == nil) != tc.isNil {
			t.Errorf("%s: BannerSet=%v BannerURL=%v", tc.name, p.BannerSet, p.BannerURL)
		}
		if p.BannerURL != nil && *p.BannerURL != tc.wantVal {
			t.Errorf("%s: BannerURL=%q want %q", tc.name, *p.BannerURL, tc.wantVal)
		}
	}
	var p OrganiserPatch
	if err := json.Unmarshal([]byte(`{"banner_url":5}`), &p); err == nil {
		t.Error("a non-string banner_url must be a decode error")
	}
}

// TestListFollowing_BadPagingIs422BeforeService proves the route validates the page
// through followingPage: a zero Service would panic if it were reached.
func TestListFollowing_BadPagingIs422BeforeService(t *testing.T) {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.Use(func(c *gin.Context) { c.Set("user_id", "11111111-2222-4333-8444-555555555555") })
	NewHandler(&Service{}).RegisterSocial(e.Group("/events"))

	for _, q := range []string{"limit=0", "limit=101", "limit=abc", "offset=-1", "offset=x"} {
		w := httptest.NewRecorder()
		e.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/events/following?"+q, nil))
		if w.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status %d, want 422 (%s)", q, w.Code, w.Body.String())
		}
	}
}
