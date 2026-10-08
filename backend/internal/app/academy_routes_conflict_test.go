package app

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// With every Academy sub-flag on, all modules mount onto the same member/admin
// groups. Gin panics at registration on any conflicting wildcard name, which
// crash-loops the whole backend at boot (healthcheck never passes).
func TestRegisterAcademy_AllSubFlagsOn_NoRouteConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/db?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	r := gin.New()
	defer func() {
		if rec := recover(); rec != nil {
			t.Fatalf("academy route registration panicked: %v", rec)
		}
	}()
	RegisterAcademy(r, r.Group("/api/finance"), pool, nil, nil, nil, nil, nil, nil, nil, nil, nil,
		true, true, true, true, true, true, true, true, true, nil, true, "")
}
