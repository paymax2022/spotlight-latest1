package tiers_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/finance/tiers"
)

type fakeTierReader struct {
	tier tiers.Tier
	err  error
	got  string
}

func (f *fakeTierReader) GetUserTier(_ context.Context, id string) (tiers.Tier, error) {
	f.got = id
	return f.tier, f.err
}

func adminTierRouter(r tiers.TierReader) *gin.Engine {
	gin.SetMode(gin.TestMode)
	e := gin.New()
	e.GET("/tiers/:user_id", tiers.AdminGetTier(r))
	return e
}

func TestAdminGetTier_ReturnsRawLimits(t *testing.T) {
	cases := []struct {
		tier         tiers.Tier
		daily, maxBa int64
	}{
		{0, 0, 0},
		{1, 5_000_000, 30_000_000},
		{3, 0, 0},
	}
	for _, tc := range cases {
		f := &fakeTierReader{tier: tc.tier}
		w := httptest.NewRecorder()
		adminTierRouter(f).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/tiers/u1", nil))
		if w.Code != http.StatusOK {
			t.Fatalf("tier %d: status %d", tc.tier, w.Code)
		}
		var body struct {
			Tier                int   `json:"tier"`
			DailyDebitLimitKobo int64 `json:"dailyDebitLimitKobo"`
			MaxBalanceKobo      int64 `json:"maxBalanceKobo"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Tier != int(tc.tier) || body.DailyDebitLimitKobo != tc.daily || body.MaxBalanceKobo != tc.maxBa {
			t.Errorf("tier %d: got %+v", tc.tier, body)
		}
		if f.got != "u1" {
			t.Errorf("user id not passed through: %q", f.got)
		}
	}
}

func TestAdminGetTier_ErrorIsSanitized500(t *testing.T) {
	f := &fakeTierReader{err: errors.New("pq: secret internal detail")}
	w := httptest.NewRecorder()
	adminTierRouter(f).ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/tiers/u1", nil))
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", w.Code)
	}
	if strings.Contains(w.Body.String(), "secret internal detail") {
		t.Errorf("leaked internal error: %s", w.Body.String())
	}
}
