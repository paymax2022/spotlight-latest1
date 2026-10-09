package handlers

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// AUD-SEC-001: getIPAddress must resolve through Gin's proxy-aware ClientIP
// so a client-supplied X-Forwarded-For entry cannot spoof the IP recorded in
// consent/audit logs and used by IP-keyed rate limits.

func ipContext(t *testing.T, proxies []string, remoteAddr, xff string) *gin.Context {
	t.Helper()
	e := gin.New()
	if err := e.SetTrustedProxies(proxies); err != nil {
		t.Fatalf("SetTrustedProxies: %v", err)
	}
	c := gin.CreateTestContextOnly(httptest.NewRecorder(), e)
	c.Request = httptest.NewRequestWithContext(context.Background(), "POST", "/", nil)
	c.Request.RemoteAddr = remoteAddr
	c.Request.Header.Set("X-Forwarded-For", xff)
	return c
}

func TestGetIPAddress_TrustedProxyHonoursXFF(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// RemoteAddr is inside the trusted range: the platform LB appended the
	// real client IP, so XFF is honoured.
	c := ipContext(t, []string{"10.0.0.0/8"}, "10.0.0.5:1234", "203.0.113.50")
	if got := getIPAddress(c); got != "203.0.113.50" {
		t.Fatalf("trusted proxy: got %q, want 203.0.113.50", got)
	}
}

func TestGetIPAddress_UntrustedRemoteIgnoresXFF(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// RemoteAddr is NOT trusted: a direct client (or an attacker spoofing
	// XFF from outside the LB) must not be able to choose its IP.
	c := ipContext(t, []string{"10.0.0.0/8"}, "198.51.100.9:1234", "203.0.113.50")
	if got := getIPAddress(c); got != "198.51.100.9" {
		t.Fatalf("untrusted remote: got %q, want RemoteAddr 198.51.100.9 (spoof must fail)", got)
	}
}

func TestGetIPAddress_SpoofedXFFEntriesSkipped(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// Client appended its own fake XFF entries; the LB appended the real
	// peer IP last. Gin walks right-to-left past trusted hops, so the
	// rightmost untrusted entry (the LB-observed client) wins — not the
	// leftmost client-controlled one.
	c := ipContext(t, []string{"10.0.0.0/8"}, "10.0.0.5:1234", "1.1.1.1, 203.0.113.50")
	if got := getIPAddress(c); got != "203.0.113.50" {
		t.Fatalf("spoofed leftmost XFF: got %q, want 203.0.113.50", got)
	}
}
