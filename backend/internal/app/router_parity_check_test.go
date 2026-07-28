package app

import (
	"testing"

	"spotlight/backend/internal/config"
)

// Guards #23 route additions: static (/users/export, /users/bulk-roles,
// /roles/:id/permissions/bulk) must coexist with the param routes
// (/users/:id, /users/:id/roles) without a Gin registration panic.
func TestRouterParityRoutesRegister(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("router registration panicked: %v", r)
		}
	}()
	// Zero config: DatabaseURL empty → finance/connect routes skipped; the RBAC
	// admin tree (which holds the new routes) is always registered.
	_ = NewRouter(config.Config{})
}
