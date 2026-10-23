package estate

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// A CreateEstate refused by the merchant gate is a 403, not a 500 (review M3 on
// PR #876): the caller is authenticated but not authorised to create estates.
func TestCreateEstateRefusedByMerchantGateIs403(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := (&Service{}).WithEstateMerchantGate(EstateMerchantGateFunc(
		func(context.Context, string) (bool, error) { return false, nil }))
	h := NewHandler(svc)
	r := gin.New()
	r.POST("/estates", func(c *gin.Context) { c.Set("user_id", "u-1"); h.CreateEstate(c) })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/estates", strings.NewReader(`{"name":"Gated"}`)))
	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", w.Code, w.Body.String())
	}
}
