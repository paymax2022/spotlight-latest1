package onboarding

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/doctor"
)

const (
	userID     = "11111111-1111-1111-1111-111111111111"
	reviewerID = "22222222-2222-2222-2222-222222222222"
	verifID    = "33333333-3333-3333-3333-333333333333"
)

type fakeStore struct {
	detail      *ApplicationDetail
	detailErr   error
	verifStatus string
	verifErr    error
	recorded    []decisionRecord
	recordErr   error
	lastList    ListQuery
}

func (f *fakeStore) List(_ context.Context, q ListQuery) (*ApplicationList, error) {
	f.lastList = q
	return &ApplicationList{Items: []Application{}, Counts: map[string]int{}}, nil
}
func (f *fakeStore) Detail(context.Context, string) (*ApplicationDetail, error) {
	return f.detail, f.detailErr
}
func (f *fakeStore) LatestVerification(context.Context, string) (string, string, error) {
	return verifID, f.verifStatus, f.verifErr
}
func (f *fakeStore) RecordDecision(_ context.Context, r decisionRecord) error {
	if f.recordErr != nil {
		return f.recordErr
	}
	f.recorded = append(f.recorded, r)
	return nil
}

type fakeDecider struct {
	calls []doctor.MDCNDecision
	err   error
}

func (f *fakeDecider) Decide(_ context.Context, _, _ string, in doctor.MDCNDecision) (*doctor.MDCNReviewRecord, error) {
	f.calls = append(f.calls, in)
	return &doctor.MDCNReviewRecord{}, f.err
}

func newFixture(status string) (*Service, *fakeStore, *fakeDecider) {
	st := &fakeStore{detail: &ApplicationDetail{}, verifStatus: status}
	d := &fakeDecider{}
	svc := newService(st, d)
	svc.now = func() time.Time { return time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC) }
	return svc, st, d
}

func TestValidateDecision(t *testing.T) {
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		req  DecisionRequest
		ok   bool
	}{
		{"approve ok", DecisionRequest{Action: "approve", LicenceExpiry: "2027-01-01", Discipline: "medical"}, true},
		{"approve dental ok", DecisionRequest{Action: "approve", LicenceExpiry: "2027-01-01", Discipline: "dental"}, true},
		{"approve missing expiry", DecisionRequest{Action: "approve", Discipline: "medical"}, false},
		{"approve bad date", DecisionRequest{Action: "approve", LicenceExpiry: "01/01/2027", Discipline: "medical"}, false},
		{"approve expiring today", DecisionRequest{Action: "approve", LicenceExpiry: "2026-10-27", Discipline: "medical"}, false},
		{"approve past", DecisionRequest{Action: "approve", LicenceExpiry: "2020-01-01", Discipline: "medical"}, false},
		{"approve bad discipline", DecisionRequest{Action: "approve", LicenceExpiry: "2027-01-01", Discipline: "vet"}, false},
		{"approve no discipline", DecisionRequest{Action: "approve", LicenceExpiry: "2027-01-01"}, false},
		{"reject with reason", DecisionRequest{Action: "reject", Notes: "licence not on register"}, true},
		{"reject no reason", DecisionRequest{Action: "reject"}, false},
		{"reject blank reason", DecisionRequest{Action: "reject", Notes: "   "}, false},
		{"need_info with reason", DecisionRequest{Action: "need_info", Notes: "re-upload licence"}, true},
		{"need_info no reason", DecisionRequest{Action: "need_info"}, false},
		{"unknown action", DecisionRequest{Action: "suspend", Notes: "x"}, false},
		{"empty action", DecisionRequest{}, false},
		{"notes too long", DecisionRequest{Action: "reject", Notes: strings.Repeat("x", 2001)}, false},
	}
	for _, c := range cases {
		_, err := ValidateDecision(c.req, now)
		if (err == nil) != c.ok {
			t.Errorf("%s: err=%v want ok=%v", c.name, err, c.ok)
		}
		if err != nil && !errors.Is(err, ErrValidation) {
			t.Errorf("%s: error %v does not wrap ErrValidation", c.name, err)
		}
	}
}

func TestCanDecide(t *testing.T) {
	for st, want := range map[string]bool{
		"pending": true, "needs_info": true, "approved": false, "rejected": false, "unsubmitted": false,
	} {
		if CanDecide(st) != want {
			t.Errorf("CanDecide(%s) should be %v", st, want)
		}
	}
}

func TestServiceDecide_validatesBeforeTouchingAnything(t *testing.T) {
	svc, st, d := newFixture("pending")
	_, err := svc.Decide(context.Background(), reviewerID, userID, DecisionRequest{Action: "reject"})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("err = %v, want ErrValidation", err)
	}
	if len(d.calls) != 0 || len(st.recorded) != 0 {
		t.Fatal("an invalid decision must not call the review service or record anything")
	}
}

func TestServiceDecide_approveRunsReviewThenRecords(t *testing.T) {
	svc, st, d := newFixture("pending")
	_, err := svc.Decide(context.Background(), reviewerID, userID,
		DecisionRequest{Action: "approve", LicenceExpiry: "2027-06-30", Discipline: "medical", Notes: "ok"})
	if err != nil {
		t.Fatal(err)
	}
	if len(d.calls) != 1 || d.calls[0].Action != "approve" || d.calls[0].LicenceExpiry == nil ||
		*d.calls[0].Discipline != "medical" {
		t.Fatalf("decider calls = %+v", d.calls)
	}
	if len(st.recorded) != 1 || st.recorded[0].NewStatus != "approved" || st.recorded[0].ReviewerID != reviewerID ||
		st.recorded[0].VerificationID != verifID || st.recorded[0].UserID != userID {
		t.Fatalf("recorded = %+v", st.recorded)
	}
}

func TestServiceDecide_statusMapping(t *testing.T) {
	for action, want := range map[string]string{"reject": "rejected", "need_info": "needs_info"} {
		svc, st, _ := newFixture("pending")
		if _, err := svc.Decide(context.Background(), reviewerID, userID, DecisionRequest{Action: action, Notes: "because"}); err != nil {
			t.Fatal(err)
		}
		if st.recorded[0].NewStatus != want {
			t.Errorf("%s -> %s, want %s", action, st.recorded[0].NewStatus, want)
		}
	}
}

func TestServiceDecide_settledVerificationRefusesAnotherVerdict(t *testing.T) {
	svc, st, d := newFixture("approved")
	_, err := svc.Decide(context.Background(), reviewerID, userID, DecisionRequest{Action: "reject", Notes: "changed my mind"})
	if !errors.Is(err, ErrNoOpenVerification) {
		t.Fatalf("err = %v, want ErrNoOpenVerification", err)
	}
	if len(d.calls) != 0 || len(st.recorded) != 0 {
		t.Fatal("nothing may be applied to a settled verification")
	}
}

func TestServiceDecide_retryOfSameVerdictReachesRecording(t *testing.T) {
	// The verdict landed but recording failed earlier: the status is already
	// approved, and the same approve must get through so the upgrade and audit
	// write can be redone.
	svc, st, d := newFixture("approved")
	if _, err := svc.Decide(context.Background(), reviewerID, userID,
		DecisionRequest{Action: "approve", LicenceExpiry: "2027-06-30", Discipline: "dental"}); err != nil {
		t.Fatal(err)
	}
	if len(d.calls) != 1 || len(st.recorded) != 1 {
		t.Fatalf("calls=%d recorded=%d", len(d.calls), len(st.recorded))
	}
}

func TestServiceDecide_noVerificationSubmitted(t *testing.T) {
	svc, st, d := newFixture("pending")
	st.verifErr = ErrNoOpenVerification
	_, err := svc.Decide(context.Background(), reviewerID, userID, DecisionRequest{Action: "reject", Notes: "x"})
	if !errors.Is(err, ErrNoOpenVerification) || len(d.calls) != 0 {
		t.Fatalf("err=%v calls=%d", err, len(d.calls))
	}
}

func TestServiceDecide_unknownApplicant(t *testing.T) {
	svc, st, d := newFixture("pending")
	st.detailErr = ErrNotFound
	_, err := svc.Decide(context.Background(), reviewerID, userID, DecisionRequest{Action: "reject", Notes: "x"})
	if !errors.Is(err, ErrNotFound) || len(d.calls) != 0 {
		t.Fatalf("err=%v", err)
	}
}

func TestServiceDecide_reviewServiceErrorsPropagateWithoutRecording(t *testing.T) {
	for _, e := range []error{doctor.ErrReviewForbidden, doctor.ErrReviewIllegalTransition} {
		svc, st, d := newFixture("pending")
		d.err = e
		_, err := svc.Decide(context.Background(), reviewerID, userID, DecisionRequest{Action: "reject", Notes: "x"})
		if !errors.Is(err, e) || len(st.recorded) != 0 {
			t.Fatalf("err=%v recorded=%d", err, len(st.recorded))
		}
	}
}

func TestServiceDecide_recordFailureIsSurfacedAsRetryable(t *testing.T) {
	svc, st, _ := newFixture("pending")
	st.recordErr = errors.New("db down")
	_, err := svc.Decide(context.Background(), reviewerID, userID, DecisionRequest{Action: "reject", Notes: "x"})
	if err == nil || !strings.Contains(err.Error(), "retry") {
		t.Fatalf("err = %v", err)
	}
}

func TestNormalizeList(t *testing.T) {
	if _, err := normalizeList(ListQuery{Stage: "bogus"}); !errors.Is(err, ErrValidation) {
		t.Fatalf("bogus stage err = %v", err)
	}
	q, err := normalizeList(ListQuery{Limit: 9999, Offset: -5, Q: strings.Repeat("a", 300)})
	if err != nil || q.Limit != 200 || q.Offset != 0 || len(q.Q) != 100 {
		t.Fatalf("q=%+v err=%v", q, err)
	}
	q, _ = normalizeList(ListQuery{})
	if q.Limit != 25 {
		t.Fatalf("default limit = %d", q.Limit)
	}
	for _, st := range allStages {
		if !ValidStage(string(st)) {
			t.Fatalf("stage %s not valid", st)
		}
	}
}

// ---- routes / RBAC wiring / HTTP mapping ----

func newRouter(svc *Service, viewHits, manageHits *int) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v1/telemedicine/admin")
	g.Use(func(c *gin.Context) { c.Set("user_id", reviewerID) })
	mark := func(n *int) gin.HandlerFunc { return func(c *gin.Context) { *n++ } }
	registerRoutes(g, svc, mark(viewHits), mark(manageHits))
	return r
}

func do(r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

const base = "/api/v1/telemedicine/admin/onboarding/applications"

func TestRoutes_permissionWiring(t *testing.T) {
	var view, manage int
	svc, _, _ := newFixture("pending")
	r := newRouter(svc, &view, &manage)

	do(r, "GET", base, "")
	do(r, "GET", base+"/"+userID, "")
	if view != 2 || manage != 0 {
		t.Fatalf("reads must use only the view guard: view=%d manage=%d", view, manage)
	}
	do(r, "POST", base+"/"+userID+"/decision", `{"action":"reject","notes":"x"}`)
	if manage != 1 || view != 2 {
		t.Fatalf("decision must use only the manage guard: view=%d manage=%d", view, manage)
	}
	routes := map[string]bool{}
	for _, rt := range r.Routes() {
		routes[rt.Method+" "+rt.Path] = true
	}
	for _, want := range []string{
		"GET " + base,
		"GET " + base + "/:userId",
		"POST " + base + "/:userId/decision",
	} {
		if !routes[want] {
			t.Errorf("route %q not registered", want)
		}
	}
	if len(routes) != 3 {
		t.Errorf("expected exactly 3 routes, got %d", len(routes))
	}
}

func TestRoutes_manageGuardAbortStopsDecision(t *testing.T) {
	svc, st, d := newFixture("pending")
	gin.SetMode(gin.TestMode)
	r := gin.New()
	deny := func(c *gin.Context) { c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "no"}) }
	allow := func(c *gin.Context) {}
	registerRoutes(r.Group("/a"), svc, allow, deny)
	w := do(r, "POST", "/a/onboarding/applications/"+userID+"/decision", `{"action":"reject","notes":"x"}`)
	if w.Code != http.StatusForbidden || len(d.calls) != 0 || len(st.recorded) != 0 {
		t.Fatalf("code=%d calls=%d", w.Code, len(d.calls))
	}
}

func TestHandlers_statusCodes(t *testing.T) {
	var v, m int
	cases := []struct {
		name   string
		setup  func(*fakeStore, *fakeDecider)
		method string
		path   string
		body   string
		want   int
	}{
		{"list ok", nil, "GET", base, "", 200},
		{"list bad stage", nil, "GET", base + "?stage=nope", "", 400},
		{"detail bad uuid", nil, "GET", base + "/not-a-uuid", "", 400},
		{"detail not found", func(s *fakeStore, _ *fakeDecider) { s.detailErr = ErrNotFound }, "GET", base + "/" + userID, "", 404},
		{"decision bad json", nil, "POST", base + "/" + userID + "/decision", `{`, 400},
		{"decision invalid", nil, "POST", base + "/" + userID + "/decision", `{"action":"approve"}`, 400},
		{"decision bad uuid", nil, "POST", base + "/zzz/decision", `{"action":"reject","notes":"x"}`, 400},
		{"decision ok", nil, "POST", base + "/" + userID + "/decision", `{"action":"reject","notes":"x"}`, 200},
		{"self approval", func(_ *fakeStore, d *fakeDecider) { d.err = doctor.ErrReviewForbidden }, "POST", base + "/" + userID + "/decision", `{"action":"reject","notes":"x"}`, 403},
		{"illegal transition", func(_ *fakeStore, d *fakeDecider) { d.err = doctor.ErrReviewIllegalTransition }, "POST", base + "/" + userID + "/decision", `{"action":"reject","notes":"x"}`, 409},
		{"nothing to decide", func(s *fakeStore, _ *fakeDecider) { s.verifErr = ErrNoOpenVerification }, "POST", base + "/" + userID + "/decision", `{"action":"reject","notes":"x"}`, 409},
	}
	for _, c := range cases {
		svc, st, d := newFixture("pending")
		if c.setup != nil {
			c.setup(st, d)
		}
		w := do(newRouter(svc, &v, &m), c.method, c.path, c.body)
		if w.Code != c.want {
			t.Errorf("%s: code=%d want %d body=%s", c.name, w.Code, c.want, w.Body.String())
		}
	}
}

func TestHandlers_envelopeAndListQueryPassThrough(t *testing.T) {
	var v, m int
	svc, st, _ := newFixture("pending")
	w := do(newRouter(svc, &v, &m), "GET", base+"?stage=pending_review&q=ada&limit=10&offset=20", "")
	var body struct {
		Data json.RawMessage `json:"data"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &body) != nil || len(body.Data) == 0 {
		t.Fatalf("envelope: code=%d body=%s", w.Code, w.Body.String())
	}
	if st.lastList.Stage != "pending_review" || st.lastList.Q != "ada" || st.lastList.Limit != 10 || st.lastList.Offset != 20 {
		t.Fatalf("query = %+v", st.lastList)
	}
}

func TestRegister_nilPoolMountsNothing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	Register(r.Group("/x"), nil, func(*gin.Context) {}, func(*gin.Context) {})
	if len(r.Routes()) != 0 {
		t.Fatalf("routes = %d", len(r.Routes()))
	}
}
