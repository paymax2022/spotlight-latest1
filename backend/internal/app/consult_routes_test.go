package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/health/consultengine"
)

type fakeConsultAPI struct {
	lastCaller  string
	joinErr     error
	extErr      error
	payErr      error
	session     consultengine.Session
	join        consultengine.Join
	lastPackage string
	lastSession string
	packageErr  error
	extListErr  error
}

func (f *fakeConsultAPI) PublishPackage(_ context.Context, callerID string, p consultengine.Package) (consultengine.Package, error) {
	f.lastCaller = callerID
	p.ID = "pkg-1"
	return p, nil
}
func (f *fakeConsultAPI) ListPackages(context.Context, consultengine.Vertical, consultengine.OwnerKind, string) ([]consultengine.Package, error) {
	return []consultengine.Package{{ID: "pkg-1", DurationMinutes: 30, PriceKobo: 500_000}}, nil
}
func (f *fakeConsultAPI) GetPackage(_ context.Context, id string) (consultengine.Package, error) {
	f.lastPackage = id
	if f.packageErr != nil {
		return consultengine.Package{}, f.packageErr
	}
	return consultengine.Package{
		ID: id, Vertical: consultengine.VerticalTelemedicine, Mode: consultengine.ModeVideo,
		DurationMinutes: 30, PriceKobo: 500_000, Active: true,
	}, nil
}
func (f *fakeConsultAPI) ListExtensions(_ context.Context, sessionID, callerID string) ([]consultengine.Extension, error) {
	f.lastCaller, f.lastSession = callerID, sessionID
	if f.extListErr != nil {
		return nil, f.extListErr
	}
	return []consultengine.Extension{{ID: "ext-1", AddedMinutes: 10, Status: consultengine.ExtPending}}, nil
}
func (f *fakeConsultAPI) Get(_ context.Context, _, callerID string) (consultengine.Session, error) {
	f.lastCaller = callerID
	return f.session, nil
}
func (f *fakeConsultAPI) Join(_ context.Context, _, callerID string) (consultengine.Join, error) {
	f.lastCaller = callerID
	return f.join, f.joinErr
}
func (f *fakeConsultAPI) Complete(_ context.Context, _, callerID string) error {
	f.lastCaller = callerID
	return nil
}
func (f *fakeConsultAPI) RequestExtension(_ context.Context, _, callerID string, minutes int) (consultengine.Extension, error) {
	f.lastCaller = callerID
	return consultengine.Extension{ID: "ext-1", AddedMinutes: minutes, Status: consultengine.ExtPending}, f.extErr
}
func (f *fakeConsultAPI) DecideExtension(_ context.Context, _, extID, callerID string, approve bool, _ string) (consultengine.Extension, error) {
	f.lastCaller = callerID
	return consultengine.Extension{ID: extID, Status: consultengine.ExtAwaitingPayment}, nil
}
func (f *fakeConsultAPI) PayExtension(context.Context, string, string, string) (consultengine.Extension, consultengine.Session, error) {
	return consultengine.Extension{ID: "ext-1", Status: consultengine.ExtPaid}, f.session, f.payErr
}
func (f *fakeConsultAPI) PostMessage(_ context.Context, _, callerID, body string) (consultengine.Message, error) {
	f.lastCaller = callerID
	return consultengine.Message{ID: "m1", Body: body, CreatedAt: time.Now()}, nil
}
func (f *fakeConsultAPI) ListMessages(context.Context, string, string, time.Time) ([]consultengine.Message, error) {
	return []consultengine.Message{}, nil
}

func consultTestRouter(api consultAPI) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v1/consult/packages", (&consultHandler{svc: api}).listPackages)     // public
	r.GET("/api/v1/consult/packages/:id", (&consultHandler{svc: api}).getPackage) // public
	g := r.Group("/api/v1/consult")
	g.Use(func(c *gin.Context) { c.Set("user_id", c.GetHeader("X-User")); c.Next() })
	registerConsultHandlers(g, api)
	return r
}

func doJSON(r *gin.Engine, method, path, user, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.Header.Set("X-User", user)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestConsultSessionRoutesUseTheAuthenticatedCaller(t *testing.T) {
	sessionID := uuid.NewString()
	extID := uuid.NewString()
	f := &fakeConsultAPI{session: consultengine.Session{ID: sessionID, State: consultengine.StateScheduled}}
	r := consultTestRouter(f)

	w := doJSON(r, http.MethodGet, "/api/v1/consult/sessions/"+sessionID, "user-1", "")
	if w.Code != http.StatusOK {
		t.Fatalf("get: %d %s", w.Code, w.Body.String())
	}
	if f.lastCaller != "user-1" {
		t.Fatalf("caller = %q, want user-1", f.lastCaller)
	}

	w = doJSON(r, http.MethodPost, "/api/v1/consult/sessions/"+sessionID+"/join", "user-1", "")
	if w.Code != http.StatusOK {
		t.Fatalf("join: %d %s", w.Code, w.Body.String())
	}

	w = doJSON(r, http.MethodPost, "/api/v1/consult/sessions/"+sessionID+"/extensions", "user-1", `{"added_minutes":10}`)
	if w.Code != http.StatusOK {
		t.Fatalf("request extension: %d %s", w.Code, w.Body.String())
	}
	var body map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["success"] != true {
		t.Fatalf("envelope = %v", body)
	}

	w = doJSON(r, http.MethodPost, "/api/v1/consult/sessions/"+sessionID+"/extensions/"+extID+"/decide", "doc-1", `{"approve":true}`)
	if w.Code != http.StatusOK {
		t.Fatalf("decide: %d %s", w.Code, w.Body.String())
	}
}

func TestConsultRoutesMapSentinelsToStatuses(t *testing.T) {
	sessionID := uuid.NewString()
	f := &fakeConsultAPI{joinErr: consultengine.ErrMediaUnavailable}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodPost, "/api/v1/consult/sessions/"+sessionID+"/join", "user-1", "")
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("media unavailable: %d, want 503", w.Code)
	}

	f2 := &fakeConsultAPI{extErr: consultengine.ErrInvalid}
	r2 := consultTestRouter(f2)
	w = doJSON(r2, http.MethodPost, "/api/v1/consult/sessions/"+sessionID+"/extensions", "user-1", `{"added_minutes":0}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad minutes: %d, want 400", w.Code)
	}

	f3 := &fakeConsultAPI{joinErr: consultengine.ErrState}
	r3 := consultTestRouter(f3)
	w = doJSON(r3, http.MethodPost, "/api/v1/consult/sessions/"+sessionID+"/join", "user-1", "")
	if w.Code != http.StatusConflict {
		t.Fatalf("ended session: %d, want 409", w.Code)
	}
}

// TestConsultPayMapsInsufficientFundsTo402 pins the wallet-debit failure path:
// the escrow layer wraps ledger.ErrInsufficientFunds with %w, so the shared
// consult error map must answer 402 Payment Required rather than the 500
// default. Path ids are real UUIDs — the handler folds malformed ids to 404
// before the engine is ever called.
func TestConsultPayMapsInsufficientFundsTo402(t *testing.T) {
	sessionID := uuid.NewString()
	extID := uuid.NewString()
	f := &fakeConsultAPI{
		payErr: fmt.Errorf("consult: hold extension payment: %w", ledger.ErrInsufficientFunds),
	}
	r := consultTestRouter(f)

	w := doJSON(r, http.MethodPost,
		"/api/v1/consult/sessions/"+sessionID+"/extensions/"+extID+"/pay", "user-1", "")
	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("insufficient funds: %d, want 402 (%s)", w.Code, w.Body.String())
	}
}

func TestConsultPayMapsTierRefusalsTo403(t *testing.T) {
	sessionID := uuid.NewString()
	extID := uuid.NewString()
	for _, sentinel := range []error{tiers.ErrWalletDisabled, tiers.ErrDailyLimitExceeded} {
		f := &fakeConsultAPI{
			payErr: fmt.Errorf("consult: hold extension payment: %w", sentinel),
		}
		r := consultTestRouter(f)
		w := doJSON(r, http.MethodPost,
			"/api/v1/consult/sessions/"+sessionID+"/extensions/"+extID+"/pay", "user-1", "")
		if w.Code != http.StatusForbidden {
			t.Fatalf("%v: %d, want 403 (%s)", sentinel, w.Code, w.Body.String())
		}
	}
}

func TestConsultDecideRequiresApproveFlag(t *testing.T) {
	sessionID := uuid.NewString()
	extID := uuid.NewString()
	f := &fakeConsultAPI{}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodPost,
		"/api/v1/consult/sessions/"+sessionID+"/extensions/"+extID+"/decide", "doc-1", `{}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing approve: %d, want 400 (%s)", w.Code, w.Body.String())
	}
}

func TestConsultPackageListIsPublicAndPackagesRequireAUser(t *testing.T) {
	ownerID := uuid.NewString()
	f := &fakeConsultAPI{}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodGet, "/api/v1/consult/packages?vertical=vet", "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("public list: %d %s", w.Code, w.Body.String())
	}
	w = doJSON(r, http.MethodPost, "/api/v1/consult/packages", "doc-1",
		`{"owner_kind":"doctor","owner_id":"`+ownerID+`","vertical":"telemedicine","mode":"video","duration_minutes":30,"price_kobo":500000}`)
	if w.Code != http.StatusOK {
		t.Fatalf("publish: %d %s", w.Code, w.Body.String())
	}
	if f.lastCaller != "doc-1" {
		t.Fatalf("publish caller = %q", f.lastCaller)
	}
}

// TestConsultRoutesRejectMalformedIDs pins the handler-boundary guard: a
// malformed path or body identifier cannot name a row, so it is refused before
// pgx ever sees it. Path ids answer 404 (never confirming existence, matching
// the engine's non-participant folding); the publish body's owner_id is a body
// field, so it answers 400.
func TestConsultRoutesRejectMalformedIDs(t *testing.T) {
	f := &fakeConsultAPI{}
	r := consultTestRouter(f)

	w := doJSON(r, http.MethodGet, "/api/v1/consult/sessions/not-a-uuid", "user-1", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("malformed session id: %d, want 404", w.Code)
	}
	if f.lastCaller != "" {
		t.Fatalf("engine was called with a malformed session id: caller = %q", f.lastCaller)
	}

	w = doJSON(r, http.MethodPost, "/api/v1/consult/sessions/not-a-uuid/extensions/ext-1/decide", "doc-1", `{"approve":true}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("malformed session id on decide: %d, want 404", w.Code)
	}

	sessionID := uuid.NewString()
	w = doJSON(r, http.MethodPost, "/api/v1/consult/sessions/"+sessionID+"/extensions/not-a-uuid/decide", "doc-1", `{"approve":true}`)
	if w.Code != http.StatusNotFound {
		t.Fatalf("malformed extension id: %d, want 404", w.Code)
	}
	if f.lastCaller != "" {
		t.Fatalf("engine was called with a malformed extension id: caller = %q", f.lastCaller)
	}

	w = doJSON(r, http.MethodPost, "/api/v1/consult/packages", "doc-1",
		`{"owner_kind":"doctor","owner_id":"not-a-uuid","vertical":"telemedicine","mode":"video","duration_minutes":30,"price_kobo":500000}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("malformed owner_id: %d, want 400", w.Code)
	}
	if f.lastCaller != "" {
		t.Fatalf("engine was called with a malformed owner_id: caller = %q", f.lastCaller)
	}
}

func TestConsultPackageGetIsPublic(t *testing.T) {
	id := uuid.NewString()
	f := &fakeConsultAPI{}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodGet, "/api/v1/consult/packages/"+id, "", "")
	if w.Code != http.StatusOK {
		t.Fatalf("get package: %d %s", w.Code, w.Body.String())
	}
	var body struct {
		Success bool                  `json:"success"`
		Package consultengine.Package `json:"package"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Success || body.Package.ID != id {
		t.Fatalf("body = %+v", body)
	}
	if f.lastPackage != id {
		t.Fatalf("engine got %q, want %q", f.lastPackage, id)
	}
}

func TestConsultPackageGetFoldsInactiveTo404(t *testing.T) {
	f := &fakeConsultAPI{packageErr: consultengine.ErrNotFound}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodGet, "/api/v1/consult/packages/"+uuid.NewString(), "", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("inactive package: %d, want 404 (%s)", w.Code, w.Body.String())
	}
}

func TestConsultListExtensionsUsesTheAuthenticatedCaller(t *testing.T) {
	sessionID := uuid.NewString()
	f := &fakeConsultAPI{}
	r := consultTestRouter(f)
	w := doJSON(r, http.MethodGet, "/api/v1/consult/sessions/"+sessionID+"/extensions", "user-1", "")
	if w.Code != http.StatusOK {
		t.Fatalf("list extensions: %d %s", w.Code, w.Body.String())
	}
	if f.lastCaller != "user-1" || f.lastSession != sessionID {
		t.Fatalf("caller/session = %q/%q", f.lastCaller, f.lastSession)
	}
	var body struct {
		Success    bool                      `json:"success"`
		Extensions []consultengine.Extension `json:"extensions"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Success || len(body.Extensions) != 1 || body.Extensions[0].ID != "ext-1" {
		t.Fatalf("body = %+v", body)
	}
}

func TestConsultListExtensionsRejectsMalformedAndForeignSessions(t *testing.T) {
	f := &fakeConsultAPI{extListErr: consultengine.ErrNotFound}
	r := consultTestRouter(f)

	w := doJSON(r, http.MethodGet, "/api/v1/consult/sessions/not-a-uuid/extensions", "user-1", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("malformed id: %d, want 404", w.Code)
	}
	if f.lastCaller != "" {
		t.Fatalf("engine called with a malformed id: caller = %q", f.lastCaller)
	}

	w = doJSON(r, http.MethodGet, "/api/v1/consult/sessions/"+uuid.NewString()+"/extensions", "user-1", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("foreign session: %d, want 404 (%s)", w.Code, w.Body.String())
	}
}
