package paystackcheckout

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// With no billable email the handler must answer 422 email_required BEFORE it
// touches the service (nil here — reaching it would panic), so no quote or
// intent row is created for a payment that cannot start.
func TestInitiate_AsksForAnEmailBeforeAnyWork(t *testing.T) {
	gin.SetMode(gin.TestMode)
	g := gin.New()
	g.Use(func(c *gin.Context) {
		c.Set("user_id", "u1")
		c.Set("user_email", "u@spotlight.internal") // fixture account: not billable
	})
	g.POST("/:id/orders/paystack/initiate", NewHandler(nil).Initiate)

	req := httptest.NewRequest(http.MethodPost, "/r1/orders/paystack/initiate",
		strings.NewReader(`{"items":[{"item_id":"i1","qty":1}],"delivery_address":"1 Test Street, Lagos"}`))
	req.Header.Set("Idempotency-Key", "food-order-paystack-1760000000000-abc12345")
	w := httptest.NewRecorder()
	g.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), `"email_required"`) {
		t.Fatalf("status %d body %s, want 422 email_required", w.Code, w.Body.String())
	}
}
