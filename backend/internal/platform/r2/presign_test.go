package r2

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

func testCfg() Config {
	return Config{
		AccountEndpoint: "https://acct123.r2.cloudflarestorage.com",
		Bucket:          "spotlight-open-mic",
		AccessKeyID:     "AKIAEXAMPLE",
		SecretAccessKey: "secretEXAMPLE",
		Region:          "auto",
	}
}

func TestNotConfiguredFailsClosed(t *testing.T) {
	p := New(Config{}) // missing everything
	if p.Configured() {
		t.Fatal("empty config must not be Configured()")
	}
	if _, err := p.PresignPut("k", "image/png", time.Minute); err != ErrNotConfigured {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
	if _, err := p.PresignGet("k", time.Minute); err != ErrNotConfigured {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
}

func TestPartialConfigNotConfigured(t *testing.T) {
	c := testCfg()
	c.SecretAccessKey = ""
	if New(c).Configured() {
		t.Fatal("missing secret must not be Configured()")
	}
}

func TestPresignPutShape(t *testing.T) {
	p := New(testCfg())
	if !p.Configured() {
		t.Fatal("expected Configured()")
	}
	raw, err := p.presign("PUT", "doctor/u1/photo/abc.png", "image/png", 15*time.Minute,
		time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if u.Host != "acct123.r2.cloudflarestorage.com" {
		t.Errorf("host = %q", u.Host)
	}
	if !strings.HasPrefix(u.Path, "/spotlight-open-mic/doctor/u1/photo/") {
		t.Errorf("path = %q (bucket+key prefix missing)", u.Path)
	}
	q := u.Query()
	for _, k := range []string{"X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-SignedHeaders", "X-Amz-Signature"} {
		if q.Get(k) == "" {
			t.Errorf("missing query param %s", k)
		}
	}
	if q.Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" {
		t.Errorf("algorithm = %q", q.Get("X-Amz-Algorithm"))
	}
	if q.Get("X-Amz-Expires") != "900" {
		t.Errorf("expires = %q, want 900", q.Get("X-Amz-Expires"))
	}
	// Content-type binding → it must be a signed header for PUT.
	if sh := q.Get("X-Amz-SignedHeaders"); sh != "content-type;host" {
		t.Errorf("signed headers = %q, want content-type;host", sh)
	}
	// Secret must never leak into the URL.
	if strings.Contains(raw, "secretEXAMPLE") {
		t.Error("presigned URL leaks the secret access key")
	}
}

func TestPresignDeterministic(t *testing.T) {
	p := New(testCfg())
	at := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	a, _ := p.presign("PUT", "k/v.png", "image/png", time.Minute, at)
	b, _ := p.presign("PUT", "k/v.png", "image/png", time.Minute, at)
	if a != b {
		t.Error("signing must be deterministic for identical inputs+time")
	}
	c, _ := p.presign("PUT", "k/v.png", "image/jpeg", time.Minute, at)
	if a == c {
		t.Error("different content-type must change the signature")
	}
}

func TestPresignGetNoContentTypeHeader(t *testing.T) {
	p := New(testCfg())
	raw, err := p.PresignGet("doctor/u1/doc/x.pdf", time.Minute)
	if err != nil {
		t.Fatalf("presign get: %v", err)
	}
	u, _ := url.Parse(raw)
	if sh := u.Query().Get("X-Amz-SignedHeaders"); sh != "host" {
		t.Errorf("GET signed headers = %q, want host", sh)
	}
}

func TestExpiryClamped(t *testing.T) {
	p := New(testCfg())
	at := time.Date(2026, 6, 23, 12, 0, 0, 0, time.UTC)
	// Over the 7-day cap → clamped to default 900s.
	raw, _ := p.presign("PUT", "k", "image/png", 30*24*time.Hour, at)
	u, _ := url.Parse(raw)
	if u.Query().Get("X-Amz-Expires") != "900" {
		t.Errorf("over-cap expiry not clamped: %q", u.Query().Get("X-Amz-Expires"))
	}
}

func TestEmptyKeyRejected(t *testing.T) {
	p := New(testCfg())
	if _, err := p.PresignPut("  ", "image/png", time.Minute); err == nil {
		t.Error("empty key must be rejected")
	}
}
