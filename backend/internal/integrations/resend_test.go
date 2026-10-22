package integrations

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestResendClient_SendsAndNeverEchoesTheMessageInErrors(t *testing.T) {
	var got map[string]any
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer k" {
			t.Errorf("auth header %q", r.Header.Get("Authorization"))
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(200)
		_, _ = io.WriteString(w, `{"id":"x"}`)
	}))
	defer ok.Close()
	c := NewResendClient("k", "Spotlight <no-reply@spotlightng.com>")
	c.url = ok.URL
	if err := c.SendEmail(context.Background(), "a@b.ng", "Subj", "PIN 4321"); err != nil {
		t.Fatal(err)
	}
	if got["text"] != "PIN 4321" || got["subject"] != "Subj" {
		t.Fatalf("payload %v", got)
	}

	echo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		w.WriteHeader(422)
		_, _ = w.Write([]byte(`{"name":"validation_error","message":"bad: ` + strings.ReplaceAll(string(b), `"`, `'`) + `"}`))
	}))
	defer echo.Close()
	c.url = echo.URL
	err := c.SendEmail(context.Background(), "a@b.ng", "Subj", "PIN 4321")
	if err == nil || strings.Contains(err.Error(), "4321") || strings.Contains(err.Error(), "a@b.ng") {
		t.Fatalf("error must not echo the message or address: %v", err)
	}
	if NewResendClient("", "x") != nil {
		t.Fatal("no key = nil client")
	}
}
