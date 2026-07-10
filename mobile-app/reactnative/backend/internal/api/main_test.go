package api

import (
	"os"
	"testing"
)

// TestMain configures the api handler tests. These tests were written against the
// developer conveniences that are now OFF by default in production (Stage 0
// hardening): the no-token "demo-user" auth fallback and the X-Admin-Role header.
// The tests opt into both explicitly here so the production defaults stay
// fail-closed while the suite keeps exercising the handlers without minting JWTs.
func TestMain(m *testing.M) {
	_ = os.Setenv("ALLOW_DEV_AUTH", "true")
	_ = os.Setenv("TRUST_ADMIN_ROLE_HEADER", "true")
	os.Exit(m.Run())
}
