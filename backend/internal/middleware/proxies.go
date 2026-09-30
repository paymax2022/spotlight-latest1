package middleware

import (
	"fmt"
	"net"
	"strings"
)

// ParseTrustedProxies parses a CSV of CIDRs/IPs whose X-Forwarded-For /
// X-Real-Ip headers the Gin engine may trust when resolving ClientIP().
// "none" or empty input returns nil — forwarded headers are then ignored and
// ClientIP falls back to RemoteAddr (fail-closed; rate limits keyed on it may
// aggregate behind an unconfigured proxy, which is the safe direction).
func ParseTrustedProxies(csv string) ([]string, error) {
	csv = strings.TrimSpace(csv)
	if csv == "" || strings.EqualFold(csv, "none") {
		return nil, nil
	}
	var out []string
	for _, part := range strings.Split(csv, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, _, err := net.ParseCIDR(part); err != nil && net.ParseIP(part) == nil {
			return nil, fmt.Errorf("trusted proxy %q is not a valid IP or CIDR", part)
		}
		out = append(out, part)
	}
	return out, nil
}
