package referrals_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/referrals"
)

const codeTestUID = "11111111-1111-1111-1111-111111111111"

type fakeCodeReader struct {
	code, source string
	err          error
	got          string
}

func (f *fakeCodeReader) LookupCode(_ context.Context, id string) (string, string, error) {
	f.got = id
	return f.code, f.source, f.err
}

func codeRouter(r referrals.CodeReader) *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.GET("/referrals/:user_id/code", referrals.AdminGetCode(r))
	return e
}

func doCode(r referrals.CodeReader, id string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	codeRouter(r).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/referrals/"+id+"/code", nil))
	return w
}

func TestAdminCode_OK(t *testing.T) {
	f := &fakeCodeReader{code: "SPOT-ABC123", source: "referral_links"}
	w := doCode(f, codeTestUID)
	if w.Code != 200 || f.got != codeTestUID ||
		!strings.Contains(w.Body.String(), `"code":"SPOT-ABC123"`) || !strings.Contains(w.Body.String(), `"source":"referral_links"`) {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
}

func TestAdminCode_NotFoundOnErrNoCode(t *testing.T) {
	w := doCode(&fakeCodeReader{err: referrals.ErrNoCode}, codeTestUID)
	if w.Code != 404 || !strings.Contains(w.Body.String(), `"error":"no referral code"`) {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
}

func TestAdminCode_InvalidID(t *testing.T) {
	f := &fakeCodeReader{}
	w := doCode(f, "not-a-uuid")
	if w.Code != 400 || !strings.Contains(w.Body.String(), `"error":"invalid user id"`) || f.got != "" {
		t.Fatalf("code=%d body=%s got=%q", w.Code, w.Body.String(), f.got)
	}
}

func TestAdminCode_ErrorSanitized(t *testing.T) {
	w := doCode(&fakeCodeReader{err: errors.New("pq: secret detail")}, codeTestUID)
	if w.Code != 500 || strings.Contains(w.Body.String(), "secret detail") {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
}
