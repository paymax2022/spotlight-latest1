package restaurant

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestRestockAt_OnlyAFutureTimeIsAccepted(t *testing.T) {
	now := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	if got, err := restockAt(nil, now); got != nil || err != nil {
		t.Fatalf("no time = %v, %v; want nil, nil", got, err)
	}
	empty := ""
	if got, err := restockAt(&empty, now); got != nil || err != nil {
		t.Fatalf("empty time = %v, %v; want nil, nil", got, err)
	}
	future := "2026-10-11T13:00:00Z"
	if got, err := restockAt(&future, now); err != nil || got == nil {
		t.Fatalf("future time refused: %v", err)
	}
	past := "2026-10-11T11:00:00Z"
	if _, err := restockAt(&past, now); err == nil {
		t.Fatal("a past restock time must be refused")
	}
	bad := "tomorrow-ish"
	if _, err := restockAt(&bad, now); err == nil {
		t.Fatal("a non-RFC3339 restock time must be refused")
	}
}

// Gin rejects an ambiguous route at registration time, which is a panic at startup. The
// bulk route and the per-item route share a prefix, so mount both and check.
func TestBulkAvailabilityRoute_MountsBesideTheItemRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/restaurant")
	h := &Handler{}
	g.PATCH("/:id/menu/items/:itemId", h.UpdateItem)
	g.PATCH("/:id/menu/items/availability/bulk", h.BulkSetAvailability)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPatch, "/restaurant/r1/menu/items/availability/bulk", nil))
	if w.Code == http.StatusNotFound {
		t.Fatal("bulk route did not match its own path")
	}
}
