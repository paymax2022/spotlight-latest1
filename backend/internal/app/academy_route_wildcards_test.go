package app

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Gin panics at startup if two routes on one path segment name their wildcard
// differently (/schools/:id vs /schools/:schoolId), so the server never listens
// and the healthcheck fails. The academy schools + fees modules share one group;
// this registers them together with a lazy (never-connected) pool to catch that.
func TestAcademySchoolsWildcardNamesDoNotConflict(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("academy route registration panicked: %v", r)
		}
	}()
	gin.SetMode(gin.TestMode)
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/x")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	r := gin.New()
	finance := r.Group("/api/finance")
	RegisterAcademy(r, finance, pool, nil, nil, nil, nil, nil, nil, nil, nil,
		false, false, false, false, false, true, false, true, false, nil)
}
