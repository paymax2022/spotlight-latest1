package api

import (
	"net/http/httptest"
	"testing"
)

// clientIP is the rate-limiter key source. The pre-fix version trusted the
// left-most X-Forwarded-For entry — client-controlled, so any caller could
// rotate a fake IP per request and defeat the limiter entirely.
func TestClientIP(t *testing.T) {
	cases := []struct {
		name   string
		xff    string
		remote string
		hops   int
		want   string
	}{
		{name: "hops=0 ignores XFF entirely", xff: "9.9.9.9", remote: "10.0.0.1:5555", hops: 0, want: "10.0.0.1"},
		{name: "no XFF falls back to RemoteAddr", xff: "", remote: "10.0.0.1:5555", hops: 1, want: "10.0.0.1"},
		{name: "one trusted hop picks client", xff: "203.0.113.7", remote: "10.1.0.1:80", hops: 1, want: "203.0.113.7"},
		{name: "two trusted hops picks client", xff: "203.0.113.7, 10.1.0.1", remote: "10.2.0.1:80", hops: 2, want: "203.0.113.7"},
		{name: "spoofed prefix entries are skipped", xff: "1.1.1.1, 2.2.2.2, 203.0.113.7", remote: "10.1.0.1:80", hops: 1, want: "203.0.113.7"},
		{name: "chain shorter than hops fails closed", xff: "203.0.113.7", remote: "10.1.0.1:80", hops: 2, want: "10.1.0.1"},
		{name: "non-IP candidate fails closed", xff: "not-an-ip", remote: "10.1.0.1:80", hops: 1, want: "10.1.0.1"},
		{name: "remote addr without port", xff: "", remote: "10.0.0.1", hops: 0, want: "10.0.0.1"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/v1/crypto/assets", nil)
			r.RemoteAddr = tc.remote
			if tc.xff != "" {
				r.Header.Set("X-Forwarded-For", tc.xff)
			}
			if got := clientIP(r, tc.hops); got != tc.want {
				t.Errorf("clientIP(xff=%q, remote=%q, hops=%d) = %q, want %q",
					tc.xff, tc.remote, tc.hops, got, tc.want)
			}
		})
	}
}
