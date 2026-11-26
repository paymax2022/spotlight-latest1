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
	// original is the code the account was issued before an admin customised it
	// ("" when the code was never changed), and origErr fails that read alone.
	original string
	origErr  error
	origGot  string
}

func (f *fakeCodeReader) LookupCode(_ context.Context, id string) (string, string, error) {
	f.got = id
	return f.code, f.source, f.err
}

func (f *fakeCodeReader) OriginalCode(_ context.Context, id string) (string, error) {
	f.origGot = id
	return f.original, f.origErr
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

// The user record shows the issued code and the customised one, so the read that
// backs it has to carry both. Without this the console can only ever report the
// current value and support cannot tell "the user's own code" from "an admin's
// rename".
func TestAdminCode_ReportsTheOriginalCodeAlongsideTheCurrentOne(t *testing.T) {
	f := &fakeCodeReader{code: "JIDE1", source: "referral_links", original: "94JQ7"}
	w := doCode(f, codeTestUID)
	if w.Code != 200 {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	for _, want := range []string{`"code":"JIDE1"`, `"original_code":"94JQ7"`, `"source":"referral_links"`} {
		if !strings.Contains(body, want) {
			t.Errorf("body %s missing %s", body, want)
		}
	}
	if f.origGot != codeTestUID {
		t.Errorf("history read used %q, want the same user id as the code read", f.origGot)
	}
}

// A code nobody has changed has no original. Reporting "" would render an empty
// "Original" row, which is exactly the "is this broken?" confusion the section is
// meant to remove — so the key is absent and the UI shows one code.
func TestAdminCode_OmitsTheOriginalWhenTheCodeWasNeverChanged(t *testing.T) {
	w := doCode(&fakeCodeReader{code: "K7QX2", source: "referral_links"}, codeTestUID)
	if w.Code != 200 {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "original_code") {
		t.Errorf("body %s must not carry original_code when there is no history", w.Body.String())
	}
}

// The history lives in a different table from the code. A fault reading it may not
// take the code section down with it — the admin still needs the current code.
func TestAdminCode_StillServesTheCodeWhenTheHistoryReadFails(t *testing.T) {
	w := doCode(&fakeCodeReader{code: "JIDE1", source: "referral_links", origErr: errors.New("pq: boom")}, codeTestUID)
	if w.Code != 200 {
		t.Fatalf("a failed history read must not fail the code read: %d %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, `"code":"JIDE1"`) || strings.Contains(body, "original_code") {
		t.Errorf("body = %s, want the code with no original", body)
	}
}
