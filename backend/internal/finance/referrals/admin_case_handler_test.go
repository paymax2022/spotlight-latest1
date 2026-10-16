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

type fakeCaseReader struct {
	cv  *referrals.CaseView
	err error
	got string
}

func (f *fakeCaseReader) GetCase(_ context.Context, id string) (*referrals.CaseView, error) {
	f.got = id
	return f.cv, f.err
}

func caseRouter(r referrals.CaseReader) *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.GET("/referrals/:user_id", referrals.AdminGetCaseByUser(r))
	return e
}

func TestAdminGetCaseByUser_OK(t *testing.T) {
	f := &fakeCaseReader{cv: &referrals.CaseView{ReferrerID: "u1", Rewards: []referrals.Reward{}, Milestones: []referrals.Milestone{}}}
	w := httptest.NewRecorder()
	caseRouter(f).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/referrals/u1", nil))
	if w.Code != http.StatusOK || f.got != "u1" || !strings.Contains(w.Body.String(), `"referrer_id":"u1"`) {
		t.Fatalf("code=%d got=%q body=%s", w.Code, f.got, w.Body.String())
	}
}

func TestAdminGetCaseByUser_ErrorSanitized(t *testing.T) {
	f := &fakeCaseReader{err: errors.New("pq: secret detail")}
	w := httptest.NewRecorder()
	caseRouter(f).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/referrals/u1", nil))
	if w.Code != http.StatusInternalServerError || strings.Contains(w.Body.String(), "secret detail") {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
}
