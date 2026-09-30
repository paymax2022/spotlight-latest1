package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func requestIDRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequestID())
	r.GET("/ping", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"from_ctx": RequestIDFrom(c.Request.Context()),
			"from_gin": c.GetString("request_id"),
		})
	})
	return r
}

func TestRequestIDGeneratesWhenAbsent(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	requestIDRouter().ServeHTTP(rec, req)

	id := rec.Header().Get(RequestIDHeader)
	if _, err := uuid.Parse(id); err != nil {
		t.Fatalf("response X-Request-Id %q is not a uuid: %v", id, err)
	}
}

func TestRequestIDEchoesCleanInboundValue(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	req.Header.Set(RequestIDHeader, "req_abc-123.XYZ")
	requestIDRouter().ServeHTTP(rec, req)

	if got := rec.Header().Get(RequestIDHeader); got != "req_abc-123.XYZ" {
		t.Fatalf("echoed %q, want inbound id", got)
	}
}

func TestRequestIDRejectsDirtyInboundValue(t *testing.T) {
	for _, bad := range []string{
		"bad id with spaces",
		"inject\nlog-forgery",
		string(make([]byte, 65)),
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/ping", nil)
		req.Header.Set(RequestIDHeader, bad)
		requestIDRouter().ServeHTTP(rec, req)
		if got := rec.Header().Get(RequestIDHeader); got == bad || got == "" {
			t.Fatalf("dirty inbound id %q leaked into response as %q", bad, got)
		}
	}
}

func TestRequestIDReachesContextAndGinStore(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)
	requestIDRouter().ServeHTTP(rec, req)

	var body struct {
		FromCtx string `json:"from_ctx"`
		FromGin string `json:"from_gin"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.FromCtx == "" || body.FromCtx != body.FromGin {
		t.Fatalf("ctx %q and gin store %q disagree or empty", body.FromCtx, body.FromGin)
	}
}
