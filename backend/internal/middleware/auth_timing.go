package middleware

import (
	"fmt"
	"log"
	"sync/atomic"
	"time"
)

// Diagnostics for the authentication stage of RequireAuthContext. Every authenticated request pays
// for four calls to Supabase (token check, account status, roles, permissions) before its handler
// runs, and none are cached, so a page that fires many requests at once can queue on them. When the
// stage is slow this logs how long each call took and how many requests were in the stage at that
// moment, so the cause can be read off the logs instead of guessed.
//
// Log lines carry the HTTP method, the route TEMPLATE (never the concrete URL) and durations. They
// never carry the token, the user id, the email, or any request data.

// DefaultSlowAuthThreshold is when an authentication stage is considered slow enough to log.
const DefaultSlowAuthThreshold = 750 * time.Millisecond

var (
	slowAuthThresholdNs atomic.Int64
	authInflight        atomic.Int64
	// authTimingLogf is the log sink; tests replace it.
	authTimingLogf = log.Printf
)

func init() { slowAuthThresholdNs.Store(int64(DefaultSlowAuthThreshold)) }

// SetSlowAuthThreshold sets the duration at or above which a slow authentication stage is logged.
// Zero or negative turns the logging off.
func SetSlowAuthThreshold(d time.Duration) { slowAuthThresholdNs.Store(int64(d)) }

// authTiming is how long each part of the authentication stage took for one request.
type authTiming struct {
	token, status, roles, perms time.Duration
	total                       time.Duration
	inflight                    int64 // requests in the stage when this one started
}

func (t authTiming) shouldLog(threshold time.Duration) bool {
	return threshold > 0 && t.total >= threshold
}

// slowest names the longest single step and its duration.
func (t authTiming) slowest() (string, time.Duration) {
	name, d := "token", t.token
	for _, s := range []struct {
		n string
		d time.Duration
	}{{"status", t.status}, {"roles", t.roles}, {"perms", t.perms}} {
		if s.d > d {
			name, d = s.n, s.d
		}
	}
	return name, d
}

func ms(d time.Duration) int64 { return d.Milliseconds() }

func (t authTiming) line(method, route string) string {
	if route == "" {
		route = "(unmatched)"
	}
	name, _ := t.slowest()
	return fmt.Sprintf("[auth-timing] SLOW %s %s total=%dms token=%dms status=%dms roles=%dms perms=%dms slowest=%s inflight=%d",
		method, route, ms(t.total), ms(t.token), ms(t.status), ms(t.roles), ms(t.perms), name, t.inflight)
}

func (t authTiming) report(method, route string) {
	if t.shouldLog(time.Duration(slowAuthThresholdNs.Load())) {
		authTimingLogf("%s", t.line(method, route))
	}
}
