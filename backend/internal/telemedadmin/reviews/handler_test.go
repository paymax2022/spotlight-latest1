package reviews

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

const (
	adminID  = "11111111-1111-1111-1111-111111111111"
	reviewID = "22222222-2222-2222-2222-222222222222"
)

type fakeStore struct {
	hideCalls    []string
	resolveCalls []string
	err          error
}

func (f *fakeStore) Summary(context.Context) (Summary, error) { return Summary{OpenDisputes: 2}, f.err }
func (f *fakeStore) ListReviews(_ context.Context, fl ListFilter) ([]Review, int, error) {
	f.hideCalls = append(f.hideCalls, "list:"+fl.Source)
	return []Review{}, 0, f.err
}
func (f *fakeStore) GetReview(context.Context, string, string) (*ReviewDetail, error) {
	return &ReviewDetail{}, f.err
}
func (f *fakeStore) SetHidden(_ context.Context, actor, source, id string, hidden bool, reason string) (*Review, error) {
	f.hideCalls = append(f.hideCalls, actor+"|"+source+"|"+id+"|"+reason)
	return &Review{ID: id, Hidden: hidden}, f.err
}
func (f *fakeStore) ListDisputes(context.Context, DisputeFilter) ([]Dispute, int, error) {
	return []Dispute{}, 0, f.err
}
func (f *fakeStore) GetDispute(context.Context, string) (*DisputeDetail, error) {
	return &DisputeDetail{}, f.err
}
func (f *fakeStore) Resolve(_ context.Context, actor, id, decision, reason string) (*Dispute, error) {
	f.resolveCalls = append(f.resolveCalls, decision+"|"+reason)
	return &Dispute{ID: id, Status: decision}, f.err
}

// router wires the routes with view/manage middlewares that record which gate ran
// and reject the request unless the test grants that permission.
func router(store Store, grantView, grantManage bool) (*gin.Engine, *[]string) {
	gin.SetMode(gin.TestMode)
	var ran []string
	gate := func(name string, granted bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			ran = append(ran, name)
			if !granted {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
				return
			}
			c.Next()
		}
	}
	r := gin.New()
	g := r.Group("/api/v1/telemedicine/admin")
	g.Use(func(c *gin.Context) { c.Set("user_id", adminID); c.Next() })
	registerWith(g, store, gate("view", grantView), gate("manage", grantManage))
	return r, &ran
}

func do(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

const base = "/api/v1/telemedicine/admin/reviews"

func TestRoutes_RBACGates(t *testing.T) {
	reads := []string{
		"/summary", "", "/disputes", "/disputes/" + reviewID, "/telemedicine/" + reviewID,
	}
	writes := []string{
		"/telemedicine/" + reviewID + "/hide", "/doctor_module/" + reviewID + "/unhide", "/disputes/" + reviewID + "/resolve",
	}

	t.Run("reads need view only", func(t *testing.T) {
		r, ran := router(&fakeStore{}, true, false)
		for _, p := range reads {
			*ran = nil
			if w := do(r, http.MethodGet, base+p, ""); w.Code != http.StatusOK {
				t.Fatalf("GET %s = %d %s", p, w.Code, w.Body)
			}
			if len(*ran) != 1 || (*ran)[0] != "view" {
				t.Fatalf("GET %s ran gates %v, want [view]", p, *ran)
			}
		}
	})
	t.Run("mutations need manage", func(t *testing.T) {
		r, ran := router(&fakeStore{}, true, false)
		for _, p := range writes {
			*ran = nil
			w := do(r, http.MethodPost, base+p, `{"reason":"valid reason","decision":"upheld"}`)
			if w.Code != http.StatusForbidden {
				t.Fatalf("POST %s without manage = %d, want 403", p, w.Code)
			}
			if len(*ran) != 1 || (*ran)[0] != "manage" {
				t.Fatalf("POST %s ran gates %v, want [manage]", p, *ran)
			}
		}
	})
	t.Run("no view means no reads", func(t *testing.T) {
		r, _ := router(&fakeStore{}, false, true)
		for _, p := range reads {
			if w := do(r, http.MethodGet, base+p, ""); w.Code != http.StatusForbidden {
				t.Fatalf("GET %s without view = %d, want 403", p, w.Code)
			}
		}
	})
	t.Run("static disputes routes win over :source/:id", func(t *testing.T) {
		st := &fakeStore{}
		r, _ := router(st, true, true)
		if w := do(r, http.MethodPost, base+"/disputes/"+reviewID+"/resolve", `{"decision":"rejected","reason":"not valid"}`); w.Code != http.StatusOK {
			t.Fatalf("resolve = %d %s", w.Code, w.Body)
		}
		if len(st.resolveCalls) != 1 {
			t.Fatalf("resolve not routed to Resolve: %v", st.resolveCalls)
		}
	})
}

func TestHide_Validation(t *testing.T) {
	cases := []struct {
		name, path, body string
		want             int
	}{
		{"missing reason", "/telemedicine/" + reviewID + "/hide", `{}`, 400},
		{"short reason", "/telemedicine/" + reviewID + "/hide", `{"reason":"no"}`, 400},
		{"long reason", "/telemedicine/" + reviewID + "/hide", `{"reason":"` + strings.Repeat("x", 501) + `"}`, 400},
		{"bad source", "/pharmacy/" + reviewID + "/hide", `{"reason":"valid reason"}`, 400},
		{"bad id", "/telemedicine/not-a-uuid/hide", `{"reason":"valid reason"}`, 400},
		{"not json", "/telemedicine/" + reviewID + "/hide", `nope`, 400},
		{"ok", "/telemedicine/" + reviewID + "/hide", `{"reason":"  abusive content  "}`, 200},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := &fakeStore{}
			r, _ := router(st, true, true)
			w := do(r, http.MethodPost, base+tc.path, tc.body)
			if w.Code != tc.want {
				t.Fatalf("got %d (%s), want %d", w.Code, w.Body, tc.want)
			}
			if tc.want == 200 && (len(st.hideCalls) != 1 || !strings.HasSuffix(st.hideCalls[0], "|abusive content")) {
				t.Fatalf("reason not trimmed before reaching the store: %v", st.hideCalls)
			}
			if tc.want == 400 && len(st.hideCalls) != 0 {
				t.Fatalf("store reached on invalid input: %v", st.hideCalls)
			}
		})
	}
}

func TestResolve_Validation(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"unknown decision", `{"decision":"maybe","reason":"valid reason"}`},
		{"missing decision", `{"reason":"valid reason"}`},
		{"missing reason", `{"decision":"upheld"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			st := &fakeStore{}
			r, _ := router(st, true, true)
			if w := do(r, http.MethodPost, base+"/disputes/"+reviewID+"/resolve", tc.body); w.Code != http.StatusBadRequest {
				t.Fatalf("got %d, want 400", w.Code)
			}
			if len(st.resolveCalls) != 0 {
				t.Fatal("store reached on invalid input")
			}
		})
	}
}

func TestErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want int
	}{
		{ErrNotFound, 404}, {ErrConflict, 409}, {ErrSelfModeration, 403}, {ErrValidation, 400},
		{errors.New("db exploded"), 500},
	} {
		r, _ := router(&fakeStore{err: tc.err}, true, true)
		w := do(r, http.MethodPost, base+"/telemedicine/"+reviewID+"/hide", `{"reason":"valid reason"}`)
		if w.Code != tc.want {
			t.Errorf("%v -> %d, want %d", tc.err, w.Code, tc.want)
		}
	}
}

func TestMutationNeedsAuthenticatedActor(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	pass := func(c *gin.Context) { c.Next() }
	registerWith(r.Group("/a"), &fakeStore{}, pass, pass) // no user_id set
	w := do(r, http.MethodPost, "/a/reviews/telemedicine/"+reviewID+"/hide", `{"reason":"valid reason"}`)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("got %d, want 401 without an actor", w.Code)
	}
}

func TestList_QueryValidation(t *testing.T) {
	for _, q := range []string{
		"?source=other", "?rating=9", "?rating=x", "?hidden=maybe", "?doctor_id=nope",
		"?limit=abc", "?q=" + strings.Repeat("a", 101),
	} {
		r, _ := router(&fakeStore{}, true, true)
		if w := do(r, http.MethodGet, base+q, ""); w.Code != http.StatusBadRequest {
			t.Errorf("%s -> %d, want 400", q, w.Code)
		}
	}
	r, _ := router(&fakeStore{}, true, true)
	if w := do(r, http.MethodGet, base+"?source=doctor_module&rating=2&hidden=true&q=rude", ""); w.Code != http.StatusOK {
		t.Errorf("valid query -> %d", w.Code)
	}
	if w := do(r, http.MethodGet, base+"/disputes?status=weird", ""); w.Code != http.StatusBadRequest {
		t.Errorf("bad dispute status -> %d", w.Code)
	}
	if w := do(r, http.MethodGet, base+"/disputes?kind=weird", ""); w.Code != http.StatusBadRequest {
		t.Errorf("bad dispute kind -> %d", w.Code)
	}
}

func TestCanResolve_StateMachine(t *testing.T) {
	cases := []struct {
		cur, decision string
		repeat        bool
		err           error
	}{
		{StatusOpen, StatusUpheld, false, nil},
		{StatusOpen, StatusRejected, false, nil},
		{StatusUpheld, StatusUpheld, true, nil},
		{StatusRejected, StatusRejected, true, nil},
		{StatusUpheld, StatusRejected, false, ErrConflict},
		{StatusRejected, StatusUpheld, false, ErrConflict},
		{StatusOpen, "open", false, ErrValidation},
		{StatusOpen, "", false, ErrValidation},
	}
	for _, tc := range cases {
		repeat, err := canResolve(tc.cur, tc.decision)
		if repeat != tc.repeat || !errors.Is(err, tc.err) {
			t.Errorf("canResolve(%q,%q) = (%v,%v), want (%v,%v)", tc.cur, tc.decision, repeat, err, tc.repeat, tc.err)
		}
	}
}

func TestHelpers(t *testing.T) {
	if _, err := cleanReason("   "); !errors.Is(err, ErrValidation) {
		t.Error("blank reason accepted")
	}
	if r, err := cleanReason("  fine!!  "); err != nil || r != "fine!!" {
		t.Errorf("cleanReason = %q,%v", r, err)
	}
	if got := likePattern(`50%_off\`); got != `%50\%\_off\\%` {
		t.Errorf("likePattern did not escape metacharacters: %q", got)
	}
	if likePattern("  ") != "" {
		t.Error("blank query should disable the filter")
	}
	if got := maskPatient("abcdef12-3456"); got != "abcdef12…" || strings.Contains(got, "3456") {
		t.Errorf("maskPatient leaked: %q", got)
	}
	if l, o := clampPage(0, -5); l != 50 || o != 0 {
		t.Errorf("clampPage = %d,%d", l, o)
	}
	if l, _ := clampPage(500, 0); l != 50 {
		t.Errorf("clampPage over max = %d", l)
	}
}
