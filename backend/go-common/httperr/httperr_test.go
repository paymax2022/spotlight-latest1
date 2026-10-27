package httperr_test

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/go-playground/validator/v10"

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

// A gin request-binding failure surfaces as validator.ValidationErrors, whose
// raw Error() leaks the Go struct/field names and reads as an unparseable dump.
// Msg must rewrite it into a short, snake_case, struct-name-free sentence.
func TestMsg_FormatsValidationErrors(t *testing.T) {
	type ResolveAccountRequest struct {
		AccountNumber string `validate:"required"`
		BankCode      string `validate:"required"`
	}
	err := validator.New().Struct(ResolveAccountRequest{})
	if err == nil {
		t.Fatal("expected validation to fail")
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	msg := httperr.Msg(c, http.StatusBadRequest, err)

	if strings.Contains(msg, "ResolveAccountRequest") || strings.Contains(msg, "Key:") || strings.Contains(msg, "Error:Field") {
		t.Fatalf("leaked raw validator output: %q", msg)
	}
	if !strings.Contains(msg, "account_number is required") {
		t.Fatalf("missing account_number message: %q", msg)
	}
	if !strings.Contains(msg, "bank_code is required") {
		t.Fatalf("missing bank_code message: %q", msg)
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
