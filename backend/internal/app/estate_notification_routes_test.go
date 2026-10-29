package app

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/estate"
)

// TestRegisterEstateNotifications_NoRouteConflict exists because the inbox routes mix a static segment
// (read-all, retention) with a wildcard one (:notificationId) under the same parent, and gin panics at
// registration when a tree cannot carry both — which crash-loops the backend at boot rather than failing
// one request.
//
// The pre-existing GET /:id/notifications is re-registered here because it lives in the shared finance
// group: the collision risk is about the whole group, not this file alone.
func TestRegisterEstateNotifications_NoRouteConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/db?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	h := estate.NewHandler(estate.NewService(pool, nil))
	r := gin.New()
	est := r.Group("/api/v1/estate")
	est.GET("/:id/notifications", h.Notifications)

	defer func() {
		if rec := recover(); rec != nil {
			t.Fatalf("estate notification route registration panicked: %v", rec)
		}
	}()
	RegisterEstateNotifications(est, h)

	want := []string{
		"GET /api/v1/estate/:id/notifications",
		"POST /api/v1/estate/:id/notifications/read-all",
		"POST /api/v1/estate/:id/notifications/:notificationId/read",
		"POST /api/v1/estate/:id/notifications/:notificationId/archive",
		"POST /api/v1/estate/:id/notifications/:notificationId/pin",
		"GET /api/v1/estate/:id/notifications/retention",
		"PUT /api/v1/estate/:id/notifications/retention",
		"POST /api/v1/estate/:id/notifications/retention/run",
	}
	got := make(map[string]bool)
	for _, ri := range r.Routes() {
		got[ri.Method+" "+ri.Path] = true
	}
	for _, w := range want {
		if !got[w] {
			t.Errorf("route not registered: %s", w)
		}
	}
}

// TestRegisterEstateProfile_MountsNotifications checks the surface is actually hung off the governance
// group, so it inherits LifecycleGate() — a registration test alone would pass with the mount removed.
func TestRegisterEstateProfile_MountsNotifications(t *testing.T) {
	gin.SetMode(gin.TestMode)
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/db?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	h := estate.NewHandler(estate.NewService(pool, nil))
	r := gin.New()
	defer func() {
		if rec := recover(); rec != nil {
			t.Fatalf("estate profile route registration panicked: %v", rec)
		}
	}()
	RegisterEstateProfile(r.Group("/api/v1/estate"), h)

	var found int
	for _, ri := range r.Routes() {
		switch ri.Method + " " + ri.Path {
		case "POST /api/v1/estate/:id/notifications/:notificationId/archive",
			"GET /api/v1/estate/:id/notifications/retention",
			"GET /api/v1/estate/:id/info",
			"GET /api/v1/estate/:id/properties/:pid/occupants":
			found++
		}
	}
	if found != 4 {
		t.Fatalf("profile group mounted %d of the 4 expected surfaces (%v)", found, r.Routes())
	}
}
