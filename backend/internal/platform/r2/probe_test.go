package r2

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// probeServer answers every request with the given status/body and counts hits.
func probeServer(t *testing.T, status int, body string, hits *int32) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(hits, 1)
		if r.Method != http.MethodPut {
			t.Errorf("probe must PUT, got %s", r.Method)
		}
		if !strings.HasPrefix(r.URL.Path, "/probe-bucket/_healthcheck/") {
			t.Errorf("probe key must live under _healthcheck/ in the bucket, got %s", r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "text/plain" {
			t.Errorf("probe must send the signed content type, got %q", r.Header.Get("Content-Type"))
		}
		if r.URL.Query().Get("X-Amz-Signature") == "" {
			t.Error("probe URL must be presigned")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(s.Close)
	return s
}

func probePresigner(endpoint string) *Presigner {
	return New(Config{AccountEndpoint: endpoint, Bucket: "probe-bucket", AccessKeyID: "AK", SecretAccessKey: "SK"})
}

func xmlErr(code string) string {
	return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>` + code + `</Code><Message>x</Message></Error>`
}

func TestProbe_ClassifiesTheFailuresThatPassPresignButBreakThePut(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"healthy", 200, "", nil},
		{"no such bucket", 404, xmlErr("NoSuchBucket"), ErrNoSuchBucket},
		{"signature mismatch", 403, xmlErr("SignatureDoesNotMatch"), ErrBadCredentials},
		{"unknown access key", 403, xmlErr("InvalidAccessKeyId"), ErrBadCredentials},
		{"read-only token", 403, xmlErr("AccessDenied"), ErrAccessDenied},
		{"something else", 500, xmlErr("InternalError"), ErrProbeUnexpected},
		{"no body", 502, "", ErrProbeUnexpected},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var hits int32
			s := probeServer(t, tc.status, tc.body, &hits)
			err := probePresigner(s.URL).Probe(context.Background(), s.Client())
			if tc.want == nil {
				if err != nil {
					t.Fatalf("want nil, got %v", err)
				}
				return
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("want %v, got %v", tc.want, err)
			}
		})
	}
}

func TestProbe_UnreachableEndpoint(t *testing.T) {
	s := httptest.NewServer(http.NotFoundHandler())
	url := s.URL
	s.Close() // nothing is listening any more
	err := probePresigner(url).Probe(context.Background(), &http.Client{Timeout: time.Second})
	if !errors.Is(err, ErrUnreachable) {
		t.Fatalf("want ErrUnreachable, got %v", err)
	}
}

func TestProbe_NotConfigured(t *testing.T) {
	if err := New(Config{}).Probe(context.Background(), http.DefaultClient); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
}

func TestHealthy_IsANoOpUntilEnabled(t *testing.T) {
	var hits int32
	s := probeServer(t, 404, xmlErr("NoSuchBucket"), &hits)
	p := probePresigner(s.URL)
	if err := p.Healthy(context.Background()); err != nil {
		t.Fatalf("a presigner without EnableHealthCheck must never probe: %v", err)
	}
	if atomic.LoadInt32(&hits) != 0 {
		t.Fatal("no request expected before EnableHealthCheck")
	}
}

func TestHealthy_CachesSuccessLongAndFailureShort(t *testing.T) {
	var hits int32
	s := probeServer(t, 404, xmlErr("NoSuchBucket"), &hits)
	p := probePresigner(s.URL)
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	p.EnableHealthCheck(s.Client())
	p.now = func() time.Time { return now }

	for i := 0; i < 3; i++ {
		if err := p.Healthy(context.Background()); !errors.Is(err, ErrNoSuchBucket) {
			t.Fatalf("call %d: want ErrNoSuchBucket, got %v", i, err)
		}
	}
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("a failure must be cached for %s: %d probes", failureTTL, got)
	}

	now = now.Add(failureTTL + time.Second) // failure window over: probe again
	_ = p.Healthy(context.Background())
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("expected a re-probe after the failure TTL, got %d probes", got)
	}
}

func TestHealthy_SuccessIsCachedForTheLongTTL(t *testing.T) {
	var hits int32
	s := probeServer(t, 200, "", &hits)
	p := probePresigner(s.URL)
	now := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	p.EnableHealthCheck(s.Client())
	p.now = func() time.Time { return now }

	_ = p.Healthy(context.Background())
	now = now.Add(successTTL - time.Second)
	_ = p.Healthy(context.Background())
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("a success must be cached for %s: %d probes", successTTL, got)
	}
	now = now.Add(2 * time.Second)
	_ = p.Healthy(context.Background())
	if got := atomic.LoadInt32(&hits); got != 2 {
		t.Fatalf("expected a re-probe after the success TTL, got %d", got)
	}
}

// A pasted endpoint often carries the bucket path or a trailing slash, and a
// pasted bucket name often carries whitespace. All of those pass Configured()
// and then break the signature at PUT time, so New() must normalise them.
func TestNew_NormalisesPastedValues(t *testing.T) {
	p := New(Config{
		AccountEndpoint: "  https://acct.r2.cloudflarestorage.com/some-bucket/  ",
		Bucket:          " /my-bucket\n",
		AccessKeyID:     " AK ",
		SecretAccessKey: "SK\n",
	})
	u, err := p.PresignPut("k.png", "image/png", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(u, "https://acct.r2.cloudflarestorage.com/my-bucket/k.png?") {
		t.Fatalf("endpoint/bucket not normalised: %s", u)
	}
	if strings.Contains(u, "%20") || strings.Contains(u, "%0A") {
		t.Fatalf("whitespace leaked into the signed URL: %s", u)
	}
}
