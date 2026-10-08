package social

// Regression test for the PayShare idempotency gate (wave-6 prod probe).
// Every other money handler checks the ok return of RequireIdempotencyKeyOK;
// PayShare discarded it (`key, _ :=`), so a request with NO Idempotency-Key
// header still ran the full money path AFTER the 400 body was already written
// — the client saw "Idempotency-Key required" while the share was actually
// paid (and the response carried a second, appended JSON object). A money
// mutation must never proceed past a refused gate: iron rule #1.
//
// The Service is built with a nil pool on purpose: if the handler proceeds
// past the gate it dereferences the pool inside PayShare and panics — which is
// exactly the bug this test pins. Post-fix the handler returns at the gate and
// the service is never touched.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestPayShare_MissingIdempotencyKey_StopsAtGate(t *testing.T) {
	gin.SetMode(gin.TestMode)

	h := NewHandler(NewService(nil, nil, nil, nil, nil), nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost,
		"/api/finance/social/splits/split-1/shares/share-1/pay", nil)
	c.Params = gin.Params{
		{Key: "id", Value: "split-1"},
		{Key: "shareId", Value: "share-1"},
	}
	c.Set("user_id", "user-1")

	// Pre-fix this panics on the nil pool (handler reached the service despite
	// the missing key); post-fix it must write exactly one 400 JSON body.
	h.PayShare(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("missing Idempotency-Key must 400, got %d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("single JSON body expected (a second write would corrupt it): %v\nbody=%q", err, w.Body.String())
	}
	if body["success"] != false {
		t.Fatalf("expected success=false envelope, got %v", body)
	}
}

func TestPayShare_WithIdempotencyKey_ReachesService(t *testing.T) {
	// Companion control: a well-formed request must NOT be rejected at the
	// gate. With a nil pool the service errors (not panics at the gate) — we
	// only assert the request was not the 400 "Idempotency-Key required"
	// short-circuit, i.e. the gate let it through.
	gin.SetMode(gin.TestMode)

	h := NewHandler(NewService(nil, nil, nil, nil, nil), nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost,
		"/api/finance/social/splits/split-1/shares/share-1/pay", nil)
	req.Header.Set("Idempotency-Key", "test-key-1")
	c.Request = req
	c.Params = gin.Params{
		{Key: "id", Value: "split-1"},
		{Key: "shareId", Value: "share-1"},
	}
	c.Set("user_id", "user-1")

	func() {
		defer func() { _ = recover() }() // nil pool may panic inside the service — that still proves we passed the gate
		h.PayShare(c)
	}()

	if w.Code == http.StatusBadRequest && w.Body.String() == `{"success":false,"error":"Idempotency-Key required"}` {
		t.Fatalf("valid Idempotency-Key must pass the gate, got gate refusal")
	}
}
