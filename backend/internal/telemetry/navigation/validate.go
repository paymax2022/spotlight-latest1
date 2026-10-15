package navigation

import (
	"regexp"
	"strings"
	"time"
)

const (
	maxRouteLen  = 256
	maxEventAge  = 90 * 24 * time.Hour
	maxClockSkew = time.Hour
)

var (
	digitsOnly = regexp.MustCompile(`^[0-9]+$`)
	uuidSeg    = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// CleanRoute accepts only route templates: no query string, no PII-bearing or
// identifier path segments (all digits, uuid, or containing '@'), <=256 chars.
func CleanRoute(raw string) (string, bool) {
	r := strings.TrimSpace(raw)
	if r == "" || len(r) > maxRouteLen {
		return "", false
	}
	if strings.ContainsAny(r, "?=&#") {
		return "", false
	}
	for _, seg := range strings.Split(r, "/") {
		if strings.Contains(seg, "@") || digitsOnly.MatchString(seg) || uuidSeg.MatchString(seg) {
			return "", false
		}
	}
	return r, true
}

func validSurface(s string) bool { return s == "mobile" || s == "web" }

func validTime(t, now time.Time) bool {
	return !t.After(now.Add(maxClockSkew)) && !t.Before(now.Add(-maxEventAge))
}
