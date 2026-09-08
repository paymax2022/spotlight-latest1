package association

import (
	"testing"

	"github.com/gin-gonic/gin"
)

// TestRegisterRoutesNoConflict fails loudly if any route added to routes.go
// conflicts with an existing one — gin panics at registration, which would
// otherwise only surface as a crash on server start.
func TestRegisterRoutesNoConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("route registration panicked: %v", r)
		}
	}()
	r := gin.New()
	RegisterRoutes(r.Group("/associations"), &Handler{})
	if len(r.Routes()) == 0 {
		t.Fatal("no routes registered")
	}
	t.Logf("registered %d association routes", len(r.Routes()))
}
