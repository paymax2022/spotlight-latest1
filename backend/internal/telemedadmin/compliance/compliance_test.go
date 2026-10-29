package compliance

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
)

const goodUser = "aaaaaaaa-0000-0000-0000-000000000001"

func day(s string) *time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return &t
}

func TestBucket(t *testing.T) {
	cases := map[int]string{-1: "expired", -400: "expired", 0: "30d", 30: "30d", 31: "90d", 90: "90d", 91: "later"}
	for days, want := range cases {
		if got := Bucket(days); got != want {
			t.Errorf("Bucket(%d) = %s, want %s", days, got, want)
		}
	}
}

func TestValidReason(t *testing.T) {
	for _, bad := range []string{"", "    ", "abcd", strings.Repeat("x", 501)} {
		if _, err := ValidReason(bad); !errors.Is(err, ErrValidation) {
			t.Errorf("ValidReason(%q) should fail, got %v", bad, err)
		}
	}
	got, err := ValidReason("  licence lapsed  ")
	if err != nil || got != "licence lapsed" {
		t.Fatalf("ValidReason trim: %q %v", got, err)
	}
}

func TestCanSuspend(t *testing.T) {
	if err := CanSuspend("approved"); err != nil {
		t.Fatalf("approved should be suspendable: %v", err)
	}
	for _, s := range []string{"suspended", "pending", "rejected", "unsubmitted", "needs_info", ""} {
		if err := CanSuspend(s); !errors.Is(err, ErrNotApproved) {
			t.Errorf("CanSuspend(%q) = %v, want ErrNotApproved", s, err)
		}
	}
}

func TestCanReinstate(t *testing.T) {
	today := *day("2026-10-27")
	cases := []struct {
		name     string
		status   string
		approval bool
		expiry   *time.Time
		want     error
	}{
		{"valid licence", "suspended", true, day("2027-01-01"), nil},
		{"no expiry recorded", "suspended", true, nil, nil},
		{"expires today still valid", "suspended", true, day("2026-10-27"), nil},
		{"expired yesterday", "suspended", true, day("2026-10-26"), ErrLicenceExpired},
		{"not suspended", "approved", true, day("2027-01-01"), ErrNotSuspended},
		{"no approved verification", "suspended", false, nil, ErrNoApproval},
	}
	for _, c := range cases {
		if got := CanReinstate(c.status, c.approval, c.expiry, today); !errors.Is(got, c.want) && got != c.want {
			t.Errorf("%s: got %v want %v", c.name, got, c.want)
		}
	}
}

// ---- handler / route tests with a fake store ----

type fakeStore struct {
	suspendErr, reinstateErr error
	calls                    []string
	lastActor, lastReason    string
	lastAudit                AuditFilter
	lastBucket               string
}

func (f *fakeStore) Summary(context.Context) (*Summary, error) { return &Summary{Suspended: 2}, nil }
func (f *fakeStore) Licences(_ context.Context, bucket, _ string, _, _ int) (*Page[LicenceRow], error) {
	f.lastBucket = bucket
	return &Page[LicenceRow]{Items: []LicenceRow{}}, nil
}
func (f *fakeStore) Suspended(context.Context, int, int) (*Page[SuspendedClinician], error) {
	return &Page[SuspendedClinician]{Items: []SuspendedClinician{}}, nil
}
func (f *fakeStore) Suspend(_ context.Context, userID, actor, reason string) (*StatusChange, error) {
	f.calls = append(f.calls, "suspend:"+userID)
	f.lastActor, f.lastReason = actor, reason
	if f.suspendErr != nil {
		return nil, f.suspendErr
	}
	return &StatusChange{UserID: userID, Status: StatusSuspended, AuditID: "x"}, nil
}
func (f *fakeStore) Reinstate(_ context.Context, userID, actor, reason string, _ time.Time) (*StatusChange, error) {
	f.calls = append(f.calls, "reinstate:"+userID)
	f.lastActor, f.lastReason = actor, reason
	if f.reinstateErr != nil {
		return nil, f.reinstateErr
	}
	return &StatusChange{UserID: userID, Status: StatusApproved, AuditID: "y"}, nil
}
func (f *fakeStore) Audit(_ context.Context, a AuditFilter, _, _ int) (*Page[AuditEvent], error) {
	f.lastAudit = a
	return &Page[AuditEvent]{Items: []AuditEvent{}}, nil
}
func (f *fakeStore) Training(context.Context, string, int, int) (*Page[TrainingRow], error) {
	return &Page[TrainingRow]{Items: []TrainingRow{}}, nil
}
func (f *fakeStore) Quality(context.Context, int, int) (*Page[QualityRow], error) {
	return &Page[QualityRow]{Items: []QualityRow{}}, nil
}
func (f *fakeStore) RecordAccess(context.Context, string, string, int, int) (*Page[RecordAccessRow], error) {
	return &Page[RecordAccessRow]{Items: []RecordAccessRow{}}, nil
}
func (f *fakeStore) DocAccess(context.Context, int, int) (*Page[DocAccessRow], error) {
	return &Page[DocAccessRow]{Items: []DocAccessRow{}}, nil
}

// harness mounts the routes with view/manage middlewares that record which
// permission gate ran and can deny, plus an optional authenticated user id.
type harness struct {
	r     *gin.Engine
	st    *fakeStore
	gates []string
	deny  string
}

func newHarness(user string) *harness {
	gin.SetMode(gin.TestMode)
	h := &harness{r: gin.New(), st: &fakeStore{}}
	gate := func(name string) gin.HandlerFunc {
		return func(c *gin.Context) {
			h.gates = append(h.gates, name)
			if h.deny == name {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "forbidden"})
				return
			}
			if user != "" {
				c.Set("user_id", user)
			}
			c.Next()
		}
	}
	g := h.r.Group("/api/v1/telemedicine/admin")
	registerWith(g, &handler{st: h.st, now: func() time.Time { return *day("2026-10-27") }}, gate("view"), gate("manage"))
	return h
}

func (h *harness) do(method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "/api/v1/telemedicine/admin"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.r.ServeHTTP(w, req)
	return w
}

func TestRoutesAreGatedByPermission(t *testing.T) {
	reads := []string{"/compliance/summary", "/compliance/licences", "/compliance/suspended", "/compliance/audit",
		"/compliance/training", "/compliance/quality", "/compliance/record-access", "/compliance/doc-access"}
	for _, p := range reads {
		h := newHarness("admin-1")
		if w := h.do(http.MethodGet, p, ""); w.Code != http.StatusOK {
			t.Errorf("GET %s = %d", p, w.Code)
		}
		if len(h.gates) != 1 || h.gates[0] != "view" {
			t.Errorf("GET %s ran gates %v, want [view]", p, h.gates)
		}
	}
	for _, act := range []string{"suspend", "reinstate"} {
		h := newHarness("admin-1")
		w := h.do(http.MethodPost, "/compliance/doctors/"+goodUser+"/"+act, `{"reason":"licence lapsed"}`)
		if w.Code != http.StatusOK {
			t.Errorf("POST %s = %d %s", act, w.Code, w.Body)
		}
		if len(h.gates) != 1 || h.gates[0] != "manage" {
			t.Errorf("POST %s ran gates %v, want [manage]", act, h.gates)
		}
	}
}

func TestDeniedPermissionNeverReachesStore(t *testing.T) {
	h := newHarness("admin-1")
	h.deny = "manage"
	w := h.do(http.MethodPost, "/compliance/doctors/"+goodUser+"/suspend", `{"reason":"licence lapsed"}`)
	if w.Code != http.StatusForbidden || len(h.st.calls) != 0 {
		t.Fatalf("code=%d calls=%v", w.Code, h.st.calls)
	}
	// view alone must not authorise a mutation: the mutation route does not run view.
	h2 := newHarness("admin-1")
	h2.deny = "view"
	if w := h2.do(http.MethodPost, "/compliance/doctors/"+goodUser+"/suspend", `{"reason":"licence lapsed"}`); w.Code != http.StatusOK {
		t.Fatalf("manage-only route should not depend on view gate, got %d", w.Code)
	}
}

func TestSuspendValidation(t *testing.T) {
	h := newHarness("admin-1")
	cases := []struct {
		name, path, body string
		want             int
	}{
		{"bad uuid", "/compliance/doctors/not-a-uuid/suspend", `{"reason":"licence lapsed"}`, 400},
		{"no body", "/compliance/doctors/" + goodUser + "/suspend", ``, 400},
		{"missing reason", "/compliance/doctors/" + goodUser + "/suspend", `{}`, 400},
		{"short reason", "/compliance/doctors/" + goodUser + "/suspend", `{"reason":"abc"}`, 400},
		{"long reason", "/compliance/doctors/" + goodUser + "/suspend", `{"reason":"` + strings.Repeat("x", 501) + `"}`, 400},
	}
	for _, c := range cases {
		if w := h.do(http.MethodPost, c.path, c.body); w.Code != c.want {
			t.Errorf("%s: got %d want %d", c.name, w.Code, c.want)
		}
	}
	if len(h.st.calls) != 0 {
		t.Fatalf("invalid requests reached the store: %v", h.st.calls)
	}
}

func TestSuspendRequiresAttributableActor(t *testing.T) {
	h := newHarness("") // gate passes but no authenticated user id
	w := h.do(http.MethodPost, "/compliance/doctors/"+goodUser+"/suspend", `{"reason":"licence lapsed"}`)
	if w.Code != http.StatusUnauthorized || len(h.st.calls) != 0 {
		t.Fatalf("code=%d calls=%v", w.Code, h.st.calls)
	}
}

func TestSuspendPassesActorAndTrimmedReason(t *testing.T) {
	h := newHarness("admin-7")
	w := h.do(http.MethodPost, "/compliance/doctors/"+goodUser+"/suspend", `{"reason":"  licence lapsed  "}`)
	if w.Code != 200 || h.st.lastActor != "admin-7" || h.st.lastReason != "licence lapsed" {
		t.Fatalf("code=%d actor=%q reason=%q", w.Code, h.st.lastActor, h.st.lastReason)
	}
	var env struct {
		Data StatusChange `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil || env.Data.Status != StatusSuspended {
		t.Fatalf("envelope: %v %s", err, w.Body)
	}
}

func TestStateErrorsMapToHTTP(t *testing.T) {
	cases := []struct {
		err  error
		want int
	}{
		{ErrNotFound, 404}, {ErrNotApproved, 409}, {ErrNoProfile, 409},
		{ErrNotSuspended, 409}, {ErrLicenceExpired, 409}, {ErrNoApproval, 409},
		{errors.New("pq: connection refused to 10.0.0.5"), 500},
	}
	for _, c := range cases {
		h := newHarness("admin-1")
		h.st.suspendErr, h.st.reinstateErr = c.err, c.err
		for _, act := range []string{"suspend", "reinstate"} {
			w := h.do(http.MethodPost, "/compliance/doctors/"+goodUser+"/"+act, `{"reason":"licence lapsed"}`)
			if w.Code != c.want {
				t.Errorf("%v %s: got %d want %d", c.err, act, w.Code, c.want)
			}
			if c.want == 500 && strings.Contains(w.Body.String(), "10.0.0.5") {
				t.Errorf("internal error leaked to client: %s", w.Body)
			}
		}
	}
}

func TestQueryValidation(t *testing.T) {
	h := newHarness("admin-1")
	bad := []string{
		"/compliance/licences?bucket=sometime",
		"/compliance/licences?limit=0", "/compliance/licences?limit=201", "/compliance/licences?limit=abc",
		"/compliance/licences?offset=-1",
		"/compliance/licences?q=" + strings.Repeat("x", 81),
		"/compliance/audit?user_id=nope", "/compliance/audit?from=yesterday", "/compliance/audit?to=2026-10-27",
		"/compliance/training?status=overdue",
		"/compliance/record-access?user_id=1",
	}
	for _, p := range bad {
		if w := h.do(http.MethodGet, p, ""); w.Code != 400 {
			t.Errorf("GET %s = %d, want 400", p, w.Code)
		}
	}
	good := []string{
		"/compliance/licences?bucket=expired&limit=200&offset=0&q=ada",
		"/compliance/audit?user_id=" + goodUser + "&from=2026-01-01T00:00:00Z&to=2026-12-01T00:00:00Z&action=doctor.admin.suspended",
		"/compliance/training?status=pending",
	}
	for _, p := range good {
		if w := h.do(http.MethodGet, p, ""); w.Code != 200 {
			t.Errorf("GET %s = %d %s", p, w.Code, w.Body)
		}
	}
	if h.st.lastAudit.Action != "doctor.admin.suspended" || h.st.lastAudit.UserID != goodUser || h.st.lastAudit.From == nil || h.st.lastAudit.To == nil {
		t.Errorf("audit filter not passed through: %+v", h.st.lastAudit)
	}
}

func TestLikeArgEscapesWildcards(t *testing.T) {
	if likeArg("") != "" || likeArg("  ") != "" {
		t.Fatal("blank search must disable the filter")
	}
	if got := likeArg(`50%_\x`); got != `%50\%\_\\x%` {
		t.Fatalf("likeArg = %q", got)
	}
}
