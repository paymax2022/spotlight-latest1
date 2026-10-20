package notifications

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSend_NilClient_FallsBackToSyncEmail(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 512)
		n, _ := r.Body.Read(b)
		got = string(b[:n])
		w.WriteHeader(200)
	}))
	defer srv.Close()
	s := NewService(nil).WithSyncEmailFallback(ProviderConfig{ResendAPIKey: "k", ResendFromEmail: "a@b.c"},
		func(context.Context, string) (string, error) { return "cust@example.com", nil })
	s.fallbackEndpoint = srv.URL

	if err := s.Send(context.Background(), Notification{UserID: "u1", Title: "Preparing", Body: "x"}); err != nil {
		t.Fatalf("expected fallback to succeed, got %v", err)
	}
	if !strings.Contains(got, "cust@example.com") {
		t.Fatalf("email not sent to resolved address: %q", got)
	}
}

func TestSend_NilClient_NoEmailOnFile_StillReportsFailure(t *testing.T) {
	s := NewService(nil).WithSyncEmailFallback(ProviderConfig{ResendAPIKey: "k"},
		func(context.Context, string) (string, error) { return "", nil })
	if err := s.Send(context.Background(), Notification{UserID: "u1"}); err == nil {
		t.Fatal("expected error when nothing could be delivered")
	}
	if err := NewService(nil).Send(context.Background(), Notification{UserID: "u1"}); err == nil {
		t.Fatal("expected error when fallback not configured")
	}
}
