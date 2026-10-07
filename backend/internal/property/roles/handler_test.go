package roles

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/platform/r2"
)

const uid = "11111111-1111-1111-1111-111111111111"

type fakeAPI struct {
	err       error
	gotUser   string
	gotAdmin  string
	gotRole   string
	gotStatus string
	gotLimit  int
	gotOffset int
	gotKey    string
}

func (f *fakeAPI) Register(_ context.Context, u, r, _ string) (*Profile, error) {
	f.gotUser, f.gotRole = u, r
	return &Profile{ID: "p", UserID: u, Role: r}, f.err
}
func (f *fakeAPI) Update(_ context.Context, u, r string, _ *string, _ map[string]any) (*Profile, error) {
	f.gotUser = u
	return &Profile{ID: "p"}, f.err
}
func (f *fakeAPI) AddDocument(_ context.Context, u, r, _, key string) (*Profile, error) {
	f.gotUser, f.gotKey = u, key
	return &Profile{ID: "p"}, f.err
}
func (f *fakeAPI) Submit(_ context.Context, u, r string) (*Profile, error) {
	f.gotUser = u
	return &Profile{ID: "p"}, f.err
}
func (f *fakeAPI) MyRoles(_ context.Context, u string) ([]Profile, error) {
	f.gotUser = u
	return []Profile{}, f.err
}
func (f *fakeAPI) ListByVerification(_ context.Context, s string, l, o int) ([]Profile, error) {
	f.gotStatus, f.gotLimit, f.gotOffset = s, l, o
	return []Profile{}, f.err
}
func (f *fakeAPI) Approve(_ context.Context, a, id string) (*Profile, error) {
	f.gotAdmin = a
	return &Profile{ID: id}, f.err
}
func (f *fakeAPI) Reject(_ context.Context, a, id, _ string) (*Profile, error) {
	f.gotAdmin = a
	return &Profile{ID: id}, f.err
}
func (f *fakeAPI) Suspend(_ context.Context, a, id, _ string) (*Profile, error) {
	f.gotAdmin = a
	return &Profile{ID: id}, f.err
}

func configuredPresigner() *r2.Presigner {
	return r2.New(r2.Config{AccountEndpoint: "https://acct.r2.cloudflarestorage.com", Bucket: "b",
		AccessKeyID: "AK", SecretAccessKey: "SK", Region: "auto"})
}

func newEngine(f *fakeAPI, p *r2.Presigner, user string, perm gin.HandlerFunc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	h := newHandler(f, p)
	setUser := func(c *gin.Context) {
		if user != "" {
			c.Set("user_id", user)
		}
		c.Next()
	}
	RegisterMember(e.Group("/m", setUser), h)
	RegisterAdmin(e.Group("/a", setUser), h, perm)
	return e
}

func allow(c *gin.Context) { c.Next() }

func do(e *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.ServeHTTP(w, req)
	return w
}

func TestHandler_Unauthenticated401(t *testing.T) {
	e := newEngine(&fakeAPI{}, nil, "", allow)
	for _, c := range [][2]string{{"GET", "/m"}, {"POST", "/m/agent"}, {"POST", "/m/agent/submit"}, {"POST", "/a/" + uid + "/approve"}} {
		if w := do(e, c[0], c[1], `{"displayName":"x"}`); w.Code != 401 {
			t.Errorf("%v: got %d", c, w.Code)
		}
	}
	if w := do(newEngine(&fakeAPI{}, nil, "not-a-uuid", allow), "GET", "/m", ""); w.Code != 401 {
		t.Errorf("bad uuid: %d", w.Code)
	}
}

func TestHandler_BadRole400(t *testing.T) {
	e := newEngine(&fakeAPI{}, nil, uid, allow)
	if w := do(e, "POST", "/m/landlord", `{"displayName":"x"}`); w.Code != 400 {
		t.Fatalf("got %d", w.Code)
	}
}

func TestHandler_BodyUserIDIgnored_AndNormalised(t *testing.T) {
	f := &fakeAPI{}
	e := newEngine(f, nil, strings.ToUpper(uid), allow)
	w := do(e, "POST", "/m/agent", `{"displayName":"x","userId":"99999999-9999-9999-9999-999999999999"}`)
	if w.Code != 200 || f.gotUser != uid {
		t.Fatalf("code=%d user=%q", w.Code, f.gotUser)
	}
}

func TestHandler_PresignUnconfigured503(t *testing.T) {
	for _, p := range []*r2.Presigner{nil, r2.New(r2.Config{})} {
		e := newEngine(&fakeAPI{}, p, uid, allow)
		w := do(e, "POST", "/m/agent/documents/presign", `{"kind":"id_document","contentType":"image/png"}`)
		if w.Code != 503 {
			t.Fatalf("got %d", w.Code)
		}
	}
}

func TestHandler_PresignKeyUnderPrefix(t *testing.T) {
	e := newEngine(&fakeAPI{}, configuredPresigner(), uid, allow)
	w := do(e, "POST", "/m/agent/documents/presign", `{"kind":"id_document","contentType":"image/png","userId":"x"}`)
	if w.Code != 200 {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	body := w.Body.String()
	if !strings.Contains(body, `"storageKey":"property-roles/`+uid+`/agent/`) || !strings.Contains(body, `"method":"PUT"`) ||
		!strings.Contains(body, `"expiresIn"`) || !strings.Contains(body, `"uploadUrl"`) {
		t.Fatalf("body %s", body)
	}
	w = do(e, "POST", "/m/agent/documents/presign", `{"kind":"id_document","contentType":"text/html"}`)
	if w.Code != 400 {
		t.Fatalf("bad content type got %d", w.Code)
	}
	w = do(e, "POST", "/m/agent/documents/presign", `{"kind":"nope","contentType":"image/png"}`)
	if w.Code != 400 {
		t.Fatalf("bad kind got %d", w.Code)
	}
}

func TestHandler_AdminPermissionDenied403(t *testing.T) {
	deny := func(c *gin.Context) { c.AbortWithStatusJSON(403, gin.H{"error": "forbidden"}) }
	f := &fakeAPI{}
	e := newEngine(f, nil, uid, deny)
	for _, c := range [][2]string{{"GET", "/a?status=pending"}, {"POST", "/a/" + uid + "/approve"}, {"POST", "/a/" + uid + "/reject"}, {"POST", "/a/" + uid + "/suspend"}} {
		if w := do(e, c[0], c[1], `{"reason":"r"}`); w.Code != 403 {
			t.Errorf("%v: %d", c, w.Code)
		}
	}
	if f.gotAdmin != "" || f.gotStatus != "" {
		t.Fatal("service reached despite deny")
	}
}

func TestHandler_AdminListPaging(t *testing.T) {
	f := &fakeAPI{}
	e := newEngine(f, nil, uid, allow)
	do(e, "GET", "/a?status=pending", "")
	if f.gotLimit != 50 || f.gotOffset != 0 {
		t.Fatalf("defaults %d %d", f.gotLimit, f.gotOffset)
	}
	do(e, "GET", "/a?status=pending&limit=9999&offset=-4", "")
	if f.gotLimit != 200 || f.gotOffset != 0 {
		t.Fatalf("clamp %d %d", f.gotLimit, f.gotOffset)
	}
}

func TestHandler_AdminIDFromContext(t *testing.T) {
	f := &fakeAPI{}
	e := newEngine(f, nil, strings.ToUpper(uid), allow)
	if w := do(e, "POST", "/a/"+uid+"/approve", `{"adminId":"zzz"}`); w.Code != 200 || f.gotAdmin != uid {
		t.Fatalf("%d %q", w.Code, f.gotAdmin)
	}
}

func TestHandler_ErrorMapping(t *testing.T) {
	cases := []struct {
		err  error
		code int
	}{
		{ErrInvalidRole, 400}, {ErrDetailsInvalid, 400}, {ErrReasonRequired, 400}, {ErrForeignKey, 400},
		{ErrNotFound, 404}, {ErrSelfReview, 403}, {ErrSuspended, 403},
		{&IncompleteError{Missing: []string{"licenceNo"}}, 422}, {ErrIncomplete, 422}, {ErrNoDocument, 422},
		{ErrBadTransition, 409}, {errors.New("pg: secret detail"), 500},
	}
	for _, c := range cases {
		e := newEngine(&fakeAPI{err: c.err}, nil, uid, allow)
		w := do(e, "POST", "/m/agent/submit", "")
		if w.Code != c.code {
			t.Errorf("%v: got %d want %d", c.err, w.Code, c.code)
		}
		if c.code == 500 && strings.Contains(w.Body.String(), "secret") {
			t.Error("500 leaked error text")
		}
		if _, ok := c.err.(*IncompleteError); ok && !strings.Contains(w.Body.String(), "licenceNo") {
			t.Errorf("422 body missing fields: %s", w.Body)
		}
	}
	e := newEngine(&fakeAPI{err: ErrDetailsInvalid}, nil, uid, allow)
	if w := do(e, "GET", "/a?status=bogus", ""); w.Code != 400 {
		t.Errorf("bad status: %d", w.Code)
	}
}

func TestHandler_RejectRequiresBody(t *testing.T) {
	e := newEngine(&fakeAPI{}, nil, uid, allow)
	if w := do(e, "POST", "/a/"+uid+"/reject", `not json`); w.Code != 400 {
		t.Fatalf("got %d", w.Code)
	}
	if w := do(e, "POST", "/a/"+uid+"/suspend", ``); w.Code != 200 {
		t.Fatalf("suspend no body got %d", w.Code)
	}
}

func TestHandler_BodyCap(t *testing.T) {
	e := newEngine(&fakeAPI{}, nil, uid, allow)
	big := `{"displayName":"` + strings.Repeat("a", 70*1024) + `"}`
	if w := do(e, "POST", "/m/agent", big); w.Code != http.StatusRequestEntityTooLarge && w.Code != 400 {
		t.Fatalf("got %d", w.Code)
	}
}
