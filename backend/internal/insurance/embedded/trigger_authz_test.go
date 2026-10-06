package embedded

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// POST /embedded/events is a MEMBER route — the policyholder is always the
// authenticated caller. The body once accepted a user_id override with no
// admin check, so any member could drive an embedded bind that debits ANOTHER
// user's wallet (Handle charges ev.UserID). A mismatched override is now
// refused; a matching one is harmless.

func triggerCtx(body, callerID string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	c.Request = req
	if callerID != "" {
		c.Set("user_id", callerID)
	}
	return c, w
}

func TestTrigger_ForeignUserIDRefused(t *testing.T) {
	h := NewHandler(nil) // svc never reached — the check returns first
	c, w := triggerCtx(
		`{"source_event_id":"s1","event_type":"trip.started","user_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}`,
		"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
	h.Trigger(c)
	if w.Code != http.StatusForbidden {
		t.Errorf("Trigger with another user's id = %d, want 403", w.Code)
	}
}

func TestTrigger_NoCallerIdentityIs400(t *testing.T) {
	h := NewHandler(nil)
	c, w := triggerCtx(`{"source_event_id":"s1","event_type":"trip.started"}`, "")
	h.Trigger(c)
	if w.Code != http.StatusBadRequest {
		t.Errorf("Trigger without a caller identity = %d, want 400", w.Code)
	}
}

// A self-trigger still flows through to the engine. With a repo that has no
// pool and an unmapped event type, Handle returns NO_MAPPING without touching
// the DB — proving the caller's uid path is intact.
func TestTrigger_SelfReachesEngine(t *testing.T) {
	svc := NewService(Deps{Repo: &Repository{}})
	h := NewHandler(svc)
	c, w := triggerCtx(
		`{"source_event_id":"s1","event_type":"unmapped.probe","user_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}`,
		"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
	h.Trigger(c)
	if w.Code != http.StatusOK {
		t.Fatalf("self Trigger = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "NO_MAPPING") {
		t.Errorf("expected NO_MAPPING for an unmapped event, got %s", w.Body.String())
	}
}
