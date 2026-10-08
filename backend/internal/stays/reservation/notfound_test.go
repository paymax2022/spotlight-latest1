package reservation

// E2E wave-6 prod probe: GET/POST /api/finance/stays/reservations/<id> 500'd
// for both malformed and absent ids — repo.Get let Postgres's 22P02 (uuid
// syntax) and pgx.ErrNoRows fall through to mapErr's 500 default. The repo
// funnel now answers ErrNotFound for both, and mapErr must map it to 404.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// A malformed id returns before the pool is touched, so a nil-pool repo
// proves the gate fires ahead of the query.
func TestGetMalformedIDIsNotFound(t *testing.T) {
	repo := NewRepository(nil)
	_, err := repo.Get(context.Background(), "not-a-uuid")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound for malformed id, got %v", err)
	}
}

// mapErr is the only translator between service sentinels and HTTP; a
// missing reservation must surface as 404, never 500.
func TestMapErrNotFoundIs404(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	mapErr(c, ErrNotFound)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d body=%s", rec.Code, rec.Body.String())
	}
}
