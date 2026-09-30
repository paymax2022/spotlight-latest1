package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func clientIPEngine(t *testing.T, cidrCSV string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	proxies, err := ParseTrustedProxies(cidrCSV)
	if err != nil {
		t.Fatalf("ParseTrustedProxies(%q): %v", cidrCSV, err)
	}
	if err := r.SetTrustedProxies(proxies); err != nil {
		t.Fatalf("SetTrustedProxies: %v", err)
	}
	r.GET("/ip", func(c *gin.Context) { c.String(http.StatusOK, c.ClientIP()) })
	return r
}

func clientIP(t *testing.T, r *gin.Engine, remoteAddr, xff string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ip", nil)
	req.RemoteAddr = remoteAddr
	if xff != "" {
		req.Header.Set("X-Forwarded-For", xff)
	}
	r.ServeHTTP(rec, req)
	return rec.Body.String()
}

func TestParseTrustedProxies(t *testing.T) {
	if got, err := ParseTrustedProxies("none"); err != nil || got != nil {
		t.Fatalf("'none' must disable trust, got %v (err %v)", got, err)
	}
	if got, err := ParseTrustedProxies("  ,  "); err != nil || got != nil {
		t.Fatalf("blank must disable trust, got %v (err %v)", got, err)
	}
	got, err := ParseTrustedProxies("10.0.0.0/8, 192.168.1.1")
	if err != nil || len(got) != 2 {
		t.Fatalf("valid CSV must parse, got %v (err %v)", got, err)
	}
	if _, err := ParseTrustedProxies("not-an-ip"); err == nil {
		t.Fatal("invalid entry must error, not silently widen trust")
	}
}

func TestClientIPSpoofedXFFIgnoredForUntrustedPeer(t *testing.T) {
	r := clientIPEngine(t, "10.0.0.0/8")
	// Attacker connects directly (peer not in 10/8) and injects a forged XFF —
	// ClientIP must be the peer, not the forged head.
	if got := clientIP(t, r, "203.0.113.9:443", "1.1.1.1, 2.2.2.2"); got != "203.0.113.9" {
		t.Fatalf("spoofed XFF from untrusted peer leaked: got %q", got)
	}
}

func TestClientIPHonorsXFFFromTrustedPeer(t *testing.T) {
	r := clientIPEngine(t, "10.0.0.0/8")
	// Peer is a trusted LB (10/8); the client IP it appended is honored.
	if got := clientIP(t, r, "10.1.2.3:443", "198.51.100.7"); got != "198.51.100.7" {
		t.Fatalf("trusted proxy XFF ignored: got %q", got)
	}
}
