package embedded

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// POST /embedded/events is a SERVICE-TOKEN route — it debits the named
// policyholder's wallet off a caller-chosen source_event_id, so it must never
// hang off a user-JWT member group. These tests pin the HTTP contract that
// replaced the old member route: Idempotency-Key required at the boundary,
// user_id required in the body (the caller is the platform, not the member),
// and a foreign-owned source_event_id surfacing as a 409 conflict rather than
// a cross-user policy leak.

type stubEngine struct {
	res *Result
	err error
	got EmbeddedEvent
}

func (e *stubEngine) Handle(_ context.Context, ev EmbeddedEvent) (*Result, error) {
	e.got = ev
	return e.res, e.err
}

func triggerCtx(body, idemKey string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if idemKey != "" {
		req.Header.Set("Idempotency-Key", idemKey)
	}
	c.Request = req
	return c, w
}

func TestTrigger_MissingIdempotencyKey_Is400(t *testing.T) {
	h := NewHandler(&stubEngine{}) // engine never reached — the gate returns first
	c, w := triggerCtx(
		`{"source_event_id":"s1","event_type":"trip.started","user_id":"u1"}`, "")
	h.Trigger(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Trigger without Idempotency-Key = %d, want 400", w.Code)
	}
}

func TestTrigger_MissingUserID_Is400(t *testing.T) {
	h := NewHandler(&stubEngine{})
	c, w := triggerCtx(
		`{"source_event_id":"s1","event_type":"trip.started"}`, "k1")
	h.Trigger(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Trigger without user_id = %d, want 400", w.Code)
	}
}

// A source_event_id already claimed by a DIFFERENT policyholder must surface as
// a 409 idempotency_key_conflict — the same contract the transfers replay path
// uses — never the other user's policy id or state.
func TestTrigger_ForeignAnchorConflict_Is409(t *testing.T) {
	h := NewHandler(&stubEngine{err: ErrSourceEventConflict})
	c, w := triggerCtx(
		`{"source_event_id":"someone-elses-event","event_type":"trip.started","user_id":"u1"}`, "k1")
	h.Trigger(c)
	if w.Code != http.StatusConflict {
		t.Fatalf("foreign source_event_id = %d, want 409 (body: %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "idempotency_key_conflict") {
		t.Errorf("expected idempotency_key_conflict body, got %s", w.Body.String())
	}
}

func TestTrigger_ForwardsEventToEngine(t *testing.T) {
	eng := &stubEngine{res: &Result{State: StateNoMapping}}
	h := NewHandler(eng)
	c, w := triggerCtx(
		`{"source_event_id":"s1","event_type":"trip.started","user_id":"u1","sum_insured_kobo":500}`, "k1")
	h.Trigger(c)
	if w.Code != http.StatusOK {
		t.Fatalf("Trigger = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if eng.got.SourceEventID != "s1" || eng.got.EventType != "trip.started" ||
		eng.got.UserID != "u1" || eng.got.SumInsuredKobo != 500 {
		t.Errorf("engine got %+v — fields not forwarded", eng.got)
	}
}

// The member group must expose ONLY the read-only event catalog — the debit
// trigger lives on the service-token internal group.
func TestRegister_MemberGroupHasNoTriggerPost(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	member := r.Group("/api/finance/insurance")
	internal := r.Group("/internal/insurance")
	Register(member, internal, NewHandler(&stubEngine{res: &Result{State: StateNoMapping}}))

	var memberPost, memberGet, internalPost bool
	for _, ri := range r.Routes() {
		switch {
		case ri.Method == http.MethodPost && ri.Path == "/api/finance/insurance/embedded/events":
			memberPost = true
		case ri.Method == http.MethodGet && ri.Path == "/api/finance/insurance/embedded/events":
			memberGet = true
		case ri.Method == http.MethodPost && ri.Path == "/internal/insurance/embedded/events":
			internalPost = true
		}
	}
	if memberPost {
		t.Error("POST /embedded/events still mounted on the member group — the debit trigger must be service-only")
	}
	if !memberGet {
		t.Error("GET /embedded/events missing from the member group")
	}
	if !internalPost {
		t.Error("POST /embedded/events missing from the internal group")
	}
}

func TestTrigger_GenericEngineError_Is422(t *testing.T) {
	h := NewHandler(&stubEngine{err: errors.New("boom")})
	c, w := triggerCtx(
		`{"source_event_id":"s1","event_type":"trip.started","user_id":"u1"}`, "k1")
	h.Trigger(c)
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("generic engine error = %d, want 422", w.Code)
	}
}
