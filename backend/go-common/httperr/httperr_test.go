package httperr_test

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/httperr"
)

var (
	errNotFound = errors.New("not found")
	errBadInput = errors.New("bad input")
	errConflict = errors.New("conflict")
	errDB       = errors.New("db exploded")
)

func testMapper() *httperr.Mapper {
	return httperr.New(http.StatusInternalServerError,
		httperr.R(http.StatusNotFound, errNotFound),
		httperr.R(http.StatusBadRequest, errBadInput),
		httperr.R(http.StatusConflict, errConflict),
	)
}

func TestCode_Sentinels(t *testing.T) {
	m := testMapper()
	if got := m.Code(errNotFound); got != 404 {
		t.Fatalf("Code(errNotFound) = %d, want 404", got)
	}
	if got := m.Code(errBadInput); got != 400 {
		t.Fatalf("Code(errBadInput) = %d, want 400", got)
	}
	if got := m.Code(errConflict); got != 409 {
		t.Fatalf("Code(errConflict) = %d, want 409", got)
	}
	if got := m.Code(errDB); got != 500 {
		t.Fatalf("Code(errDB) = %d, want 500 (default)", got)
	}
}

func TestCode_Wrapped(t *testing.T) {
	m := testMapper()
	wrapped := fmt.Errorf("handler: %w", errNotFound)
	if got := m.Code(wrapped); got != 404 {
		t.Fatalf("Code(wrapped) = %d, want 404", got)
	}
}

func TestCode_NilIsOK(t *testing.T) {
	if got := testMapper().Code(nil); got != 200 {
		t.Fatalf("Code(nil) = %d, want 200", got)
	}
}

func TestCode_RuleOrder(t *testing.T) {
	// first match wins: errBadInput listed in both → first rule applies
	m := httperr.New(500,
		httperr.R(418, errBadInput),
		httperr.R(400, errBadInput),
	)
	if got := m.Code(errBadInput); got != 418 {
		t.Fatalf("Code = %d, want 418 (first match)", got)
	}
}

// Predicate rules cover error classes that cannot be named as sentinels (e.g.
// a Postgres SQLSTATE family). Rule order still applies and a nil Match is a
// no-op rule.
func TestCode_MatchPredicate(t *testing.T) {
	m := httperr.New(500,
		httperr.R(404, errNotFound),
		httperr.Rule{Status: 400, Match: func(err error) bool {
			return errors.Unwrap(err) == nil && err != errNotFound
		}},
	)
	if got := m.Code(errNotFound); got != 404 {
		t.Fatalf("Code(errNotFound) = %d, want 404 (sentinel wins first)", got)
	}
	if got := m.Code(errDB); got != 400 {
		t.Fatalf("Code(errDB) = %d, want 400 via Match", got)
	}
	if got := m.Code(fmt.Errorf("wrap: %w", errDB)); got != 500 {
		t.Fatalf("Code(wrapped errDB) = %d, want 500 (predicate refused)", got)
	}
}

func TestWrite_Body(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	testMapper().Write(c, errNotFound)
	if w.Code != 404 {
		t.Fatalf("status = %d, want 404", w.Code)
	}
	if body := w.Body.String(); body == "" {
		t.Fatal("empty body")
	}
}

func TestWriteOK_SuccessFlag(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	testMapper().WriteOK(c, errConflict)
	if w.Code != 409 {
		t.Fatalf("status = %d, want 409", w.Code)
	}
	if body := w.Body.String(); body == "" {
		t.Fatal("empty body")
	}
}
