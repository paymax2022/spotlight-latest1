package claims

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func ptr(s string) *string { return &s }

func TestMaskPatient(t *testing.T) {
	cases := []struct {
		in   *string
		want string
	}{
		{nil, "—"},
		{ptr(""), "—"},
		{ptr("   "), "—"},
		{ptr("abc"), "••••"},
		{ptr("abcd"), "••••"},
		{ptr("8f14e45f-ceea-467a"), "8f14•••"},
		{ptr("Chidinma Okeke"), "Chid•••"},
	}
	for _, c := range cases {
		if got := maskPatient(c.in); got != c.want {
			t.Errorf("maskPatient(%v) = %q, want %q", c.in, got, c.want)
		}
	}
	// Never reveals more than four characters of the original.
	if got := maskPatient(ptr("Chidinma Okeke")); strings.Contains(got, "Chidi") {
		t.Errorf("mask leaked more than 4 chars: %q", got)
	}
}

func TestLikePatternEscapesMetacharacters(t *testing.T) {
	if got := likePattern(`50%_off\x`); got != `%50\%\_off\\x%` {
		t.Errorf("likePattern = %q", got)
	}
}

func TestSanitizeDetailKeepsOnlyAllowListed(t *testing.T) {
	raw := []byte(`{"reason":"duplicate billing","patient_name":"Chidinma Okeke","diagnosis":"malaria",
		"hmo":"Hygeia","timeline":[{"status":"submitted","note":"x"}],"auth_code":"SECRET-1"}`)
	got := sanitizeDetail(raw)
	for _, banned := range []string{"patient_name", "diagnosis", "auth_code"} {
		if _, ok := got[banned]; ok {
			t.Errorf("detail leaked %q", banned)
		}
	}
	if got["reason"] != "duplicate billing" || got["hmo"] != "Hygeia" {
		t.Errorf("allow-listed keys dropped: %v", got)
	}
	if _, ok := got["timeline"]; !ok {
		t.Errorf("timeline dropped")
	}
}

func TestSanitizeDetailTruncatesAndSurvivesGarbage(t *testing.T) {
	long := strings.Repeat("a", 900)
	b, _ := json.Marshal(map[string]any{"reason": long})
	got := sanitizeDetail(b)
	if s, _ := got["reason"].(string); len([]rune(s)) != maxDetailString+1 {
		t.Errorf("reason not truncated: %d runes", len([]rune(s)))
	}
	if out := sanitizeDetail([]byte(`not json`)); len(out) != 0 {
		t.Errorf("garbage should yield empty map, got %v", out)
	}
	if out := sanitizeDetail(nil); out == nil || len(out) != 0 {
		t.Errorf("nil should yield empty non-nil map, got %v", out)
	}
}

func TestWarningSummaryPrefersAllowListedText(t *testing.T) {
	if got := warningSummary([]byte(`{"patient_name":"X","message":"Unusual claim volume"}`)); got != "Unusual claim volume" {
		t.Errorf("summary = %q", got)
	}
	if got := warningSummary([]byte(`{"patient_name":"X"}`)); got != "" {
		t.Errorf("summary leaked non-allow-listed text: %q", got)
	}
}

// ── routing / RBAC wiring ────────────────────────────────────────────────

func guardRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1/telemedicine/admin")
	tag := func(name string) gin.HandlerFunc {
		return func(c *gin.Context) {
			c.Header("X-Guard", name)
			c.AbortWithStatus(http.StatusForbidden) // stop before any handler / DB access
		}
	}
	register(g, &store{}, tag("view"), tag("manage"))
	return r
}

func TestRoutesAreGuardedByTheRightPermission(t *testing.T) {
	r := guardRouter()
	const base = "/api/v1/telemedicine/admin"
	want := map[string]string{
		"GET " + base + "/claims/summary":                         "view",
		"GET " + base + "/claims/claims":                          "view",
		"GET " + base + "/claims/claims/:id":                      "view",
		"POST " + base + "/claims/claims/:id/review":              "manage",
		"GET " + base + "/claims/preauth":                         "view",
		"GET " + base + "/claims/preauth/:id":                     "view",
		"GET " + base + "/claims/fraud-warnings":                  "view",
		"POST " + base + "/claims/fraud-warnings/:id/acknowledge": "manage",
		"GET " + base + "/referrals/summary":                      "view",
		"GET " + base + "/referrals/outgoing":                     "view",
		"GET " + base + "/referrals/outgoing/:id":                 "view",
		"GET " + base + "/referrals/incoming":                     "view",
		"GET " + base + "/referrals/incoming/:id":                 "view",
		"GET " + base + "/referrals/opinions":                     "view",
		"GET " + base + "/referrals/opinions/:id":                 "view",
	}
	registered := map[string]bool{}
	for _, ri := range r.Routes() {
		registered[ri.Method+" "+ri.Path] = true
	}
	for route, guard := range want {
		if !registered[route] {
			t.Errorf("route not registered: %s", route)
			continue
		}
		parts := strings.SplitN(route, " ", 2)
		url := strings.ReplaceAll(parts[1], ":id", "11111111-1111-1111-1111-111111111111")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(parts[0], url, nil))
		if got := w.Header().Get("X-Guard"); got != guard {
			t.Errorf("%s guarded by %q, want %q", route, got, guard)
		}
	}
	if len(registered) != len(want) {
		t.Errorf("registered %d routes, expected %d — an unreviewed route was added", len(registered), len(want))
	}
	// Every mutation must be POST behind manage; no other verb may exist.
	for route := range registered {
		if m := strings.SplitN(route, " ", 2)[0]; m != "GET" && m != "POST" {
			t.Errorf("unexpected verb on %s", route)
		}
	}
}

// ── validation that must reject before touching the database ─────────────

func passthroughRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	pass := func(c *gin.Context) { c.Set("user_id", "") }
	register(r.Group("/a"), &store{}, pass, pass) // nil db: any query would panic
	return r
}

func do(r *gin.Engine, method, url, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestListRejectsBadFiltersWithoutQuerying(t *testing.T) {
	r := passthroughRouter()
	for _, u := range []string{
		"/a/claims/claims?status=Robert%27%29%3B%20DROP%20TABLE%20x%3B--",
		"/a/claims/claims?status=UPPER",
		"/a/claims/preauth?status=" + strings.Repeat("a", 33),
		"/a/referrals/outgoing?q=" + strings.Repeat("x", 65),
		"/a/claims/fraud-warnings?severity=a%20b",
	} {
		if w := do(r, "GET", u, ""); w.Code != http.StatusBadRequest {
			t.Errorf("GET %s = %d, want 400", u, w.Code)
		}
	}
}

func TestMalformedIDsAre404WithoutQuerying(t *testing.T) {
	r := passthroughRouter()
	for _, u := range []string{
		"/a/claims/claims/not-a-uuid", "/a/claims/preauth/1", "/a/referrals/opinions/x", "/a/referrals/incoming/../x",
	} {
		if w := do(r, "GET", u, ""); w.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", u, w.Code)
		}
	}
	if w := do(r, "POST", "/a/claims/fraud-warnings/zzz/acknowledge", ""); w.Code != http.StatusBadRequest {
		// no admin id on the context is rejected first — fail closed
		t.Errorf("ack without reviewer = %d, want 400", w.Code)
	}
}

func TestReviewValidationFailsClosed(t *testing.T) {
	r := passthroughRouter()
	const id = "11111111-1111-1111-1111-111111111111"
	for name, body := range map[string]string{
		"empty body":                        ``,
		"short note":                        `{"note":"ab"}`,
		"blank note":                        `{"note":"     "}`,
		"long note":                         `{"note":"` + strings.Repeat("n", 1001) + `"}`,
		"valid, but no reviewer on context": `{"note":"looks fine"}`,
	} {
		if w := do(r, "POST", "/a/claims/claims/"+id+"/review", body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: code %d, want 400", name, w.Code)
		}
	}
}
