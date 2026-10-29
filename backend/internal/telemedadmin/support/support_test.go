package support

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ── state machines ──────────────────────────────────────────────────────────

func TestTransitions_AreClosedAndWellFormed(t *testing.T) {
	for kind, sp := range specs {
		if len(sp.transitions) == 0 {
			t.Fatalf("%s: no state machine", kind)
		}
		for from, tos := range sp.transitions {
			seen := map[string]bool{}
			for _, to := range tos {
				if to == from {
					t.Errorf("%s: %s -> itself is a no-op transition", kind, from)
				}
				if _, ok := sp.transitions[to]; !ok {
					t.Errorf("%s: %s -> %s targets an undeclared state", kind, from, to)
				}
				if seen[to] {
					t.Errorf("%s: duplicate %s -> %s", kind, from, to)
				}
				seen[to] = true
			}
		}
	}
}

func TestCanMove_Table(t *testing.T) {
	cases := []struct {
		kind     Kind
		from, to string
		want     bool
	}{
		{KindTicket, "open", "in_progress", true},
		{KindTicket, "open", "closed", true},
		{KindTicket, "in_progress", "open", false},
		{KindTicket, "resolved", "open", true}, // reopen
		{KindTicket, "closed", "open", false},  // terminal
		{KindTicket, "closed", "resolved", false},
		{KindDispute, "open", "awaiting_response", true},
		{KindDispute, "under_review", "awaiting_response", true},
		{KindDispute, "awaiting_response", "under_review", true},
		{KindDispute, "resolved", "under_review", false},
		{KindDispute, "rejected", "resolved", false},
		{KindCall, "open", "under_review", true},
		{KindCall, "open", "awaiting_response", false}, // not a call-dispute state
		{KindCall, "under_review", "open", false},
		{KindCall, "resolved", "rejected", false},
		{KindSafety, "open", "investigating", true},
		{KindSafety, "submitted", "acknowledged", true}, // app vocabulary folds onto open
		{KindSafety, "investigating", "acknowledged", false},
		{KindSafety, "closed", "open", false},
		{KindCase, "open", "resolved", true},
		{KindCase, "acknowledged", "open", false},
		{KindCase, "resolved", "acknowledged", false},
		{KindEscalation, "initiated", "notified", true},
		{KindEscalation, "notified", "initiated", false},
		{KindEscalation, "acknowledged", "cancelled", false},
		{KindEscalation, "cancelled", "notified", false},
	}
	for _, c := range cases {
		if got := specs[c.kind].canMove(c.from, c.to); got != c.want {
			t.Errorf("%s %s -> %s = %v, want %v", c.kind, c.from, c.to, got, c.want)
		}
	}
}

func TestTicketStatusesMatchDatabaseCheckConstraint(t *testing.T) {
	// doctor_support_tickets_status_check allows exactly these four values.
	want := []string{"closed", "in_progress", "open", "resolved"}
	var got []string
	for s := range specs[KindTicket].transitions {
		got = append(got, s)
	}
	sort.Strings(got)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ticket states %v must equal the CHECK constraint %v", got, want)
	}
}

func TestAllowedIsSortedAndTerminalIsEmpty(t *testing.T) {
	sp := specs[KindDispute]
	if got := sp.allowed("open"); !sort.StringsAreSorted(got) || len(got) != 4 {
		t.Fatalf("allowed(open) = %v", got)
	}
	if got := sp.allowed("resolved"); got == nil || len(got) != 0 {
		t.Fatalf("terminal state must yield a non-nil empty list, got %#v", got)
	}
}

func TestKnownStatus(t *testing.T) {
	if !specs[KindEscalation].knownStatus("cancelled") || specs[KindEscalation].knownStatus("closed") {
		t.Fatal("escalation vocabulary wrong")
	}
	if specs[KindTicket].knownStatus("") {
		t.Fatal("empty status is not a status")
	}
}

func TestOpenStatusSetsCoverOnlyNonTerminal(t *testing.T) {
	for kind, sp := range specs {
		for status, tos := range sp.transitions {
			if terminal := len(tos) == 0; terminal && sp.isOpenStatus(status) {
				t.Errorf("%s: terminal state %s counted as open work", kind, status)
			}
		}
	}
	if !specs[KindTicket].isOpenStatus("open") || specs[KindTicket].isOpenStatus("resolved") {
		t.Fatal("ticket open set wrong")
	}
}

// ── PII scrubbing ───────────────────────────────────────────────────────────

func TestScrubDetail_DropsIdentityKeysAtAnyDepth(t *testing.T) {
	raw := []byte(`{
		"redFlags": ["chest pain"],
		"patientName": "Ada Obi",
		"Phone": "0803",
		"nested": {"emailAddress": "a@b.c", "keep": 1, "list": [{"next_of_kin": "x", "ok": true}]},
		"meaning": "survives", "dob": "1990-01-01", "nin": "123",
		"admin_resolution": {"note": "done"}
	}`)
	got := scrubDetail(raw)
	for _, k := range []string{"patientName", "Phone", "dob", "nin"} {
		if _, ok := got[k]; ok {
			t.Errorf("%s leaked", k)
		}
	}
	if got["meaning"] != "survives" || got["admin_resolution"] == nil {
		t.Errorf("over-scrubbed: %v", got)
	}
	nested := got["nested"].(map[string]any)
	if _, ok := nested["emailAddress"]; ok || nested["keep"] == nil {
		t.Errorf("nested wrong: %v", nested)
	}
	item := nested["list"].([]any)[0].(map[string]any)
	if _, ok := item["next_of_kin"]; ok || item["ok"] != true {
		t.Errorf("list element wrong: %v", item)
	}
	if scrubDetail([]byte(`[1,2]`)) != nil || scrubDetail(nil) != nil || scrubDetail([]byte(`nope`)) != nil {
		t.Error("non-object payloads must yield nil")
	}
}

func TestMaskRef(t *testing.T) {
	cases := map[string]string{"": "", "abc": "•••", "abcdef": "••••••", "1234567890": "1234…90"}
	for in, want := range cases {
		if got := maskRef(in); got != want {
			t.Errorf("maskRef(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestLikePatternEscapesWildcards(t *testing.T) {
	if likePattern("  ") != "" {
		t.Fatal("blank must disable the filter")
	}
	if got := likePattern(`50%_off\`); got != `%50\%\_off\\%` {
		t.Fatalf("got %q", got)
	}
}

// ── routing / RBAC / validation (no database) ───────────────────────────────

func gateRouter(t *testing.T, withUser, pass bool) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	gate := func(name string, pass bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			c.Header("X-Gate", name)
			if withUser {
				c.Set("user_id", uuid.NewString())
			}
			if !pass {
				c.AbortWithStatus(http.StatusTeapot)
			}
		}
	}
	Register(r.Group("/api/v1/telemedicine/admin"), nil, gate("view", pass), gate("manage", pass))
	return r
}

func TestRoutes_ReadsUseViewAndMutationsUseManage(t *testing.T) {
	r := gateRouter(t, true, false)
	routes := r.Routes()
	if len(routes) != 28 {
		t.Fatalf("expected 28 routes, got %d", len(routes))
	}
	for _, rt := range routes {
		path := strings.NewReplacer(":id", uuid.NewString()).Replace(rt.Path)
		w := httptest.NewRecorder()
		req := httptest.NewRequest(rt.Method, path, bytes.NewReader([]byte(`{}`)))
		r.ServeHTTP(w, req)
		want := "view"
		if rt.Method != http.MethodGet {
			want = "manage"
		}
		if got := w.Header().Get("X-Gate"); got != want {
			t.Errorf("%s %s guarded by %q, want %q", rt.Method, rt.Path, got, want)
		}
		if w.Code != http.StatusTeapot {
			t.Errorf("%s %s reached its handler despite a failing gate (%d)", rt.Method, rt.Path, w.Code)
		}
	}
}

func TestRoutes_ExpectedSurface(t *testing.T) {
	r := gateRouter(t, true, false)
	have := map[string]bool{}
	for _, rt := range r.Routes() {
		have[rt.Method+" "+strings.TrimPrefix(rt.Path, "/api/v1/telemedicine/admin")] = true
	}
	for _, want := range []string{
		"GET /support/summary", "GET /support/tickets", "GET /support/tickets/:id",
		"POST /support/tickets/:id/reply", "POST /support/tickets/:id/status", "POST /support/tickets/:id/assign",
		"GET /support/disputes/:id", "POST /support/disputes/:id/reply", "POST /support/disputes/:id/status",
		"GET /support/call-disputes", "POST /support/call-disputes/:id/status", "POST /support/call-disputes/:id/assign",
		"GET /safety/issues", "POST /safety/issues/:id/status", "POST /safety/issues/:id/assign",
		"GET /emergencies/cases/:id", "POST /emergencies/cases/:id/status",
		"GET /emergencies/escalations", "GET /emergencies/escalations/:id", "POST /emergencies/escalations/:id/status", "POST /emergencies/escalations/:id/assign",
		"GET /emergencies/facilities",
	} {
		if !have[want] {
			t.Errorf("missing route %s", want)
		}
	}
	for _, not := range []string{"POST /support/call-disputes/:id/reply", "POST /safety/issues/:id/reply", "POST /emergencies/escalations/:id/reply"} {
		if have[not] {
			t.Errorf("unexpected route %s", not)
		}
	}
}

func call(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestValidation_RejectsBadInputBeforeTouchingTheDatabase(t *testing.T) {
	r := gateRouter(t, true, true)
	id := uuid.NewString()
	base := "/api/v1/telemedicine/admin"
	cases := []struct{ name, method, path, body string }{
		{"bad uuid", "GET", base + "/support/tickets/not-a-uuid", ""},
		{"unknown list status", "GET", base + "/support/tickets?status=bogus", ""},
		{"call dispute rejects ticket status", "GET", base + "/support/call-disputes?status=in_progress", ""},
		{"bad severity", "GET", base + "/safety/issues?severity=urgent", ""},
		{"limit zero", "GET", base + "/support/tickets?limit=0", ""},
		{"limit too big", "GET", base + "/support/tickets?limit=101", ""},
		{"negative offset", "GET", base + "/support/tickets?offset=-1", ""},
		{"bad assigned filter", "GET", base + "/support/tickets?assigned=bob", ""},
		{"overlong q", "GET", base + "/support/tickets?q=" + strings.Repeat("a", 121), ""},
		{"status missing", "POST", base + "/support/tickets/" + id + "/status", `{}`},
		{"status unknown", "POST", base + "/support/tickets/" + id + "/status", `{"status":"done"}`},
		{"status of another kind", "POST", base + "/support/call-disputes/" + id + "/status", `{"status":"awaiting_response"}`},
		{"note too long", "POST", base + "/support/tickets/" + id + "/status", `{"status":"closed","note":"` + strings.Repeat("a", 2001) + `"}`},
		{"reply empty", "POST", base + "/support/tickets/" + id + "/reply", `{"body":"   "}`},
		{"reply missing", "POST", base + "/support/disputes/" + id + "/reply", `{}`},
		{"reply too long", "POST", base + "/support/tickets/" + id + "/reply", `{"body":"` + strings.Repeat("a", 4001) + `"}`},
		{"assignee not a uuid", "POST", base + "/safety/issues/" + id + "/assign", `{"assignee_id":"abc"}`},
		{"assignee wrong type", "POST", base + "/safety/issues/" + id + "/assign", `{"assignee_id":5}`},
		{"assign bad json", "POST", base + "/safety/issues/" + id + "/assign", `{`},
		{"facilities bad limit", "GET", base + "/emergencies/facilities?limit=abc", ""},
	}
	for _, c := range cases {
		if w := call(r, c.method, c.path, c.body); w.Code != http.StatusBadRequest {
			t.Errorf("%s: got %d (%s), want 400", c.name, w.Code, strings.TrimSpace(w.Body.String()))
		}
	}
}

func TestValidation_MutationsRequireAnAuthenticatedAdmin(t *testing.T) {
	r := gateRouter(t, false, true)
	id := uuid.NewString()
	base := "/api/v1/telemedicine/admin"
	for _, c := range []struct{ path, body string }{
		{base + "/support/tickets/" + id + "/status", `{"status":"closed"}`},
		{base + "/support/tickets/" + id + "/reply", `{"body":"hi"}`},
		{base + "/safety/issues/" + id + "/assign", `{}`},
	} {
		if w := call(r, "POST", c.path, c.body); w.Code != http.StatusUnauthorized {
			t.Errorf("%s: got %d, want 401", c.path, w.Code)
		}
	}
}

func TestFail_MapsDomainErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for err, want := range map[error]int{
		ErrNotFound: 404, ErrValidation: 400, ErrInvalidTransition: 409, ErrClosed: 409,
	} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest("GET", "/", nil)
		fail(c, err)
		if w.Code != want {
			t.Errorf("%v -> %d, want %d", err, w.Code, want)
		}
	}
}
