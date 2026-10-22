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

func TestExpoPushClient_SucceedsOnAnOkTicketFailsWhenNoDeviceAccepts(t *testing.T) {
	reply := `{"data":[{"status":"error","message":"DeviceNotRegistered"},{"status":"ok","id":"t1"}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var msgs []map[string]any
		_ = json.NewDecoder(r.Body).Decode(&msgs)
		if len(msgs) != 2 || msgs[0]["to"] != "tok-a" {
			t.Errorf("messages %v", msgs)
		}
		_, _ = io.WriteString(w, reply)
	}))
	defer srv.Close()
	c := NewExpoPushClient("")
	c.url = srv.URL
	if err := c.SendPush(context.Background(), []string{"tok-a", "tok-b"}, "T", "PIN 4321"); err != nil {
		t.Fatalf("one ok ticket = delivered: %v", err)
	}
	reply = `{"data":[{"status":"error","message":"DeviceNotRegistered"}]}`
	if err := c.SendPush(context.Background(), []string{"tok-a", "tok-b"}, "T", "PIN 4321"); err == nil || strings.Contains(err.Error(), "4321") {
		t.Fatalf("no ok ticket must fail without echoing the body: %v", err)
	}
	if err := c.SendPush(context.Background(), nil, "T", "x"); err == nil {
		t.Fatal("no tokens must fail")
	}
}
