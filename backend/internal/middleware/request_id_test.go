package middleware //nolint:testpackage // exercises unexported context key like sibling middleware tests

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func requestWithID(t *testing.T, header string) (*httptest.ResponseRecorder, *gin.Context) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequestID())
	var captured *gin.Context
	r.GET("/ping", func(c *gin.Context) {
		captured = c
		c.Status(http.StatusOK)
	})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/ping", nil)
	if header != "" {
		req.Header.Set(RequestIDHeader, header)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w, captured
}

func TestRequestID_MintsWhenAbsent(t *testing.T) {
	w, c := requestWithID(t, "")
	id := w.Header().Get(RequestIDHeader)
	if _, err := uuid.Parse(id); err != nil {
		t.Fatalf("response header %q is not a UUID", id)
	}
	if GetRequestID(c) != id {
		t.Fatalf("context ID %q != response ID %q", GetRequestID(c), id)
	}
	if RequestIDFromContext(c.Request.Context()) != id {
		t.Fatalf("request-context ID mismatch")
	}
}

func TestRequestID_EchoesValidInbound(t *testing.T) {
	inbound := "req-abc-123"
	w, c := requestWithID(t, inbound)
	if got := w.Header().Get(RequestIDHeader); got != inbound {
		t.Fatalf("got %q, want echo of %q", got, inbound)
	}
	if GetRequestID(c) != inbound {
		t.Fatalf("context ID %q != inbound %q", GetRequestID(c), inbound)
	}
}

func TestRequestID_RejectsUnsanitaryInbound(t *testing.T) {
	w, c := requestWithID(t, "bad\nid\r\nInjected: yes")
	got := w.Header().Get(RequestIDHeader)
	if got == "bad\nid\r\nInjected: yes" || got == "" {
		t.Fatalf("unsanitary header was propagated: %q", got)
	}
	if _, err := uuid.Parse(GetRequestID(c)); err != nil {
		t.Fatalf("expected freshly minted UUID, got %q", GetRequestID(c))
	}
}
