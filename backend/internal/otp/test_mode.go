package otp

// Deterministic test-mode OTP for E2E fixtures (DEV ONLY).
//
// Reserved test range: identifiers beginning "+234999" (after trimming
// whitespace). That block is not an assigned Nigerian mobile range, so no real
// subscriber can collide with it. For those identifiers ONLY, Issue stores the
// digest of TestOTPCode ("123456") through the normal Put path (same pepper,
// TTL, cooldown, rate limits, attempt ceiling, single-use) and skips delivery.
// Verify is untouched: it hashes whatever was submitted, so the deterministic
// code verifies for a test phone and is rejected for every other identifier,
// while real phones keep using real, delivered codes.
//
// Gate: FEATURE_TEST_OTP_DETERMINISTIC_ENABLED=true AND the environment must
// allow mocks (never production/staging). NewTestMode returns a disabled mode
// otherwise, and the Service re-checks Active() on every call.

import (
	"context"
	"log"
	"strings"
	"time"
)

const (
	// TestOTPCode is the fixed code issued for test phones.
	TestOTPCode = "123456"
	// TestPhonePrefix is the reserved test-only phone range.
	TestPhonePrefix = "+234999"
)

// TestMode decides whether an identifier gets the deterministic code.
// A nil *TestMode is valid and means "disabled".
type TestMode struct{ active bool }

// NewTestMode builds the gate. mocksAllowed must come from
// config.Config.MocksAllowed() (development/local/test only). It fails closed:
// flag on in a non-dev environment logs an ERROR and returns a disabled mode.
func NewTestMode(flagOn, mocksAllowed bool, appEnv string) *TestMode {
	if !flagOn {
		return &TestMode{}
	}
	if !mocksAllowed {
		log.Printf("[otp] ERROR: FEATURE_TEST_OTP_DETERMINISTIC_ENABLED is set but APP_ENV=%q does not allow mocks — test OTP REFUSED", appEnv)
		return &TestMode{}
	}
	log.Printf("[otp] WARNING: deterministic test OTP ENABLED for %s* (APP_ENV=%q, dev only)", TestPhonePrefix, appEnv)
	return &TestMode{active: true}
}

// Active reports whether test mode is on at all.
func (t *TestMode) Active() bool { return t != nil && t.active }

// AppliesTo reports whether id is a reserved test phone and the mode is on.
func (t *TestMode) AppliesTo(id string) bool {
	return t.Active() && strings.HasPrefix(strings.TrimSpace(id), TestPhonePrefix)
}

// noopSender swallows delivery; used when test mode is on but no SMS provider
// is configured so the service can still be built.
type noopSender struct{}

func (noopSender) SendOTP(_ context.Context, _, _, _ string, _ time.Duration) error { return nil }

// NoopSender returns a sender that delivers nothing (test-mode wiring only).
func NoopSender() EmailSender { return noopSender{} }

func redactLast4(id string) string {
	id = strings.TrimSpace(id)
	if len(id) <= 4 {
		return "****"
	}
	return "****" + id[len(id)-4:]
}

// WithTestMode attaches the gate. Pass nil to leave it disabled.
func (s *Service) WithTestMode(t *TestMode) *Service {
	s.testMode = t
	return s
}
