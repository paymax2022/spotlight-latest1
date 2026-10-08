package schools_test

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	feesschool "spotlight/backend/internal/academy/fees/school"
	"spotlight/backend/internal/academy/schools"
)

// Gin panics at registration if two routes use different wildcard names for the
// same path segment. academy/schools and academy/fees/school both mount under
// the same member group, so enabling both modules crashed the server at boot.
func TestSchoolsAndFeesSchoolRoutesCoexistOnOneGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// pgxpool connects lazily, so a dummy DSN yields a non-nil pool without a DB.
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/db?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	r := gin.New()
	member := r.Group("/api/finance/academy")
	admin := r.Group("/api/academy/admin")

	defer func() {
		if rec := recover(); rec != nil {
			t.Fatalf("route registration panicked: %v", rec)
		}
	}()
	feesschool.RegisterFeesSchool(member, admin, pool, nil)
	schools.RegisterAcademySchools(member, admin, pool, nil, nil)
}
