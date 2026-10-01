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

type codedError struct{ code string }

func (e codedError) Error() string { return e.code }
func (e codedError) Code() string  { return "MACHINE_CODE" }

func TestWriteCode_UsesCoder(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	testMapper().WriteCode(c, codedError{code: "human"})
	if w.Body.String() == "" {
		t.Fatal("empty body")
	}
	// plain error path
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	testMapper().WriteCode(c2, errDB)
	if w2.Code != 500 {
		t.Fatalf("status = %d, want 500", w2.Code)
	}
}

func TestPredicateRules(t *testing.T) {
	m := httperr.NewF(500,
		[]httperr.Rule{httperr.R(400, errBadInput)},
		httperr.F(404, func(err error) bool { return errors.Is(err, errDB) }),
	)
	if got := m.Code(errDB); got != 404 {
		t.Fatalf("predicate rule: Code(errDB) = %d, want 404", got)
	}
}

func TestSimple(t *testing.T) {
	f := httperr.Simple(400, errBadInput)
	if got := f(errBadInput); got != 400 {
		t.Fatalf("Simple = %d, want 400", got)
	}
	if got := f(errDB); got != 0 {
		t.Fatalf("Simple unmatched = %d, want 0", got)
	}
}

func TestWriteFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	httperr.WriteFields(c, 422, "invalid", []httperr.FieldError{
		{Field: "email", Message: "required"},
	})
	if w.Code != 422 {
		t.Fatalf("status = %d, want 422", w.Code)
	}
}

func TestProblem(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	httperr.Problem(c, 403, "urn:spotlight:problem:frozen", "Frozen", "wallet frozen")
	if w.Code != 403 {
		t.Fatalf("status = %d, want 403", w.Code)
	}
}
