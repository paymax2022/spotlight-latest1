package healthpharmacy

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestStockSeverity(t *testing.T) {
	if stockSeverity(0) != "out" || stockSeverity(-1) != "out" {
		t.Fatal("zero/negative stock must be 'out'")
	}
	if stockSeverity(3) != "low" {
		t.Fatal("positive stock under the reorder level must be 'low'")
	}
}

// Every pharmacist work-surface must 401 an unauthenticated caller before any
// query runs (nil-db Service would panic on fallthrough).
func TestProviderWorklists_Unauthenticated_Is401(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandler(&Service{}, nil)
	r := gin.New()
	r.GET("/provider/stock-alerts", h.StockAlerts)
	r.GET("/provider/rx-queue", h.RxQueue)
	r.GET("/provider/controlled-log", h.ControlledLog)
	for _, p := range []string{"/provider/stock-alerts", "/provider/rx-queue", "/provider/controlled-log"} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, p, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s: status = %d, want 401", p, w.Code)
		}
	}
}
