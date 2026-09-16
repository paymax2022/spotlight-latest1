package email

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newClient(url string) *BrevoClient {
	return NewBrevoClient("test-key", "Spotlight", "no-reply@spotlightng.com", 12, 5*time.Second).
		WithEndpoint(url)
}

// The request shape is a contract with Brevo's template engine: the template
// reads {{ params.OTP }}, so a renamed param ships an email with a blank code
// and nothing here fails.
func TestSendOTPSendsTheDocumentedPayload(t *testing.T) {
	var got struct {
		Sender     map[string]string   `json:"sender"`
		To         []map[string]string `json:"to"`
		TemplateID int64               `json:"templateId"`
		Params     map[string]string   `json:"params"`
		Tags       []string            `json:"tags"`
	}
	var apiKey, contentType string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiKey = r.Header.Get("api-key")
		contentType = r.Header.Get("content-type")
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &got)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"messageId":"<test>"}`))
	}))
	defer srv.Close()

	err := newClient(srv.URL).SendOTP(context.Background(), "user@example.com", "Ada", "482913", 10*time.Minute)
	if err != nil {
		t.Fatalf("send: %v", err)
	}

	if apiKey != "test-key" {
		t.Errorf("api-key header = %q", apiKey)
	}
	if contentType != "application/json" {
		t.Errorf("content-type = %q", contentType)
	}
	if got.TemplateID != 12 {
		t.Errorf("templateId = %d, want 12", got.TemplateID)
	}
	if len(got.To) != 1 || got.To[0]["email"] != "user@example.com" || got.To[0]["name"] != "Ada" {
		t.Errorf("to = %+v", got.To)
	}
	if got.Sender["email"] != "no-reply@spotlightng.com" {
		t.Errorf("sender = %+v", got.Sender)
	}
	for k, want := range map[string]string{"OTP": "482913", "NAME": "Ada", "EXPIRY_MINUTES": "10"} {
		if got.Params[k] != want {
			t.Errorf("params[%s] = %q, want %q — the Brevo template reads this key by name", k, got.Params[k], want)
		}
	}
	if len(got.Tags) != 1 || got.Tags[0] != "otp" {
		t.Errorf("tags = %v, want [otp]", got.Tags)
	}
}

// A sub-minute TTL must not render as "expires in 0 minutes".
func TestSendOTPFloorsExpiryAtOneMinute(t *testing.T) {
	var params map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Params map[string]string `json:"params"`
		}
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		params = body.Params
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	if err := newClient(srv.URL).SendOTP(context.Background(), "a@b.com", "A", "111111", 30*time.Second); err != nil {
		t.Fatalf("send: %v", err)
	}
	if params["EXPIRY_MINUTES"] != "1" {
		t.Errorf("EXPIRY_MINUTES = %q, want \"1\"", params["EXPIRY_MINUTES"])
	}
}

func TestErrorClassification(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   error
	}{
		{"429 is transient", http.StatusTooManyRequests, ErrTransient},
		{"500 is transient", http.StatusInternalServerError, ErrTransient},
		{"502 is transient", http.StatusBadGateway, ErrTransient},
		{"401 is permanent", http.StatusUnauthorized, ErrPermanent},
		{"403 is permanent", http.StatusForbidden, ErrPermanent},
		{"400 is permanent", http.StatusBadRequest, ErrPermanent},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(`{"code":"x","message":"nope"}`))
			}))
			defer srv.Close()
			err := newClient(srv.URL).SendOTP(context.Background(), "a@b.com", "A", "111111", time.Minute)
			if !errors.Is(err, tc.want) {
				t.Fatalf("error = %v, want it to wrap %v", err, tc.want)
			}
		})
	}
}

// A 200 is as much a success as a 201; Brevo has returned both.
func TestSendOTPAcceptsBoth200And201(t *testing.T) {
	for _, status := range []int{http.StatusOK, http.StatusCreated} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"messageId":"x"}`))
		}))
		if err := newClient(srv.URL).SendOTP(context.Background(), "a@b.com", "A", "111111", time.Minute); err != nil {
			t.Errorf("status %d: %v", status, err)
		}
		srv.Close()
	}
}

// The error is logged verbatim by callers, so it must never carry the code.
func TestErrorsNeverContainTheCode(t *testing.T) {
	const code = "482913"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":"invalid_parameter","message":"bad recipient"}`))
	}))
	defer srv.Close()
	err := newClient(srv.URL).SendOTP(context.Background(), "a@b.com", "A", code, time.Minute)
	if err == nil {
		t.Fatal("expected an error")
	}
	if strings.Contains(err.Error(), code) {
		t.Fatalf("the code leaked into an error string that callers log: %q", err.Error())
	}
}

// ── retry ───────────────────────────────────────────────────────────────────

func TestSendWithRetryRetriesTransientFailures(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&calls, 1) < 3 {
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	if err := SendWithRetry(context.Background(), newClient(srv.URL), "a@b.com", "A", "111111", time.Minute); err != nil {
		t.Fatalf("send: %v", err)
	}
	if n := atomic.LoadInt32(&calls); n != 3 {
		t.Errorf("attempts = %d, want 3", n)
	}
}

// Retrying a revoked key cannot succeed and, on a throttled account, makes the
// underlying condition worse.
func TestSendWithRetryDoesNotRetryPermanentFailures(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	err := SendWithRetry(context.Background(), newClient(srv.URL), "a@b.com", "A", "111111", time.Minute)
	if !errors.Is(err, ErrPermanent) {
		t.Fatalf("error = %v, want ErrPermanent", err)
	}
	if n := atomic.LoadInt32(&calls); n != 1 {
		t.Errorf("attempts = %d, want 1 — a permanent failure was retried", n)
	}
}

func TestSendWithRetryGivesUpAfterThreeAttempts(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	err := SendWithRetry(context.Background(), newClient(srv.URL), "a@b.com", "A", "111111", time.Minute)
	if !errors.Is(err, ErrTransient) {
		t.Fatalf("error = %v, want ErrTransient", err)
	}
	if n := atomic.LoadInt32(&calls); n != 3 {
		t.Errorf("attempts = %d, want 3", n)
	}
}

// The caller is a user waiting on an HTTP response: retries must not outlive the
// request.
func TestSendWithRetryStopsWhenTheContextIsCancelled(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Millisecond)
	defer cancel()

	start := time.Now()
	err := SendWithRetry(ctx, newClient(srv.URL), "a@b.com", "A", "111111", time.Minute)
	if err == nil {
		t.Fatal("expected an error")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("retries ran for %s past a 120ms deadline", elapsed)
	}
	if n := atomic.LoadInt32(&calls); n > 2 {
		t.Errorf("attempts = %d — the deadline did not bound the retries", n)
	}
}
