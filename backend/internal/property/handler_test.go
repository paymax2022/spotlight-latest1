package property

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func ctxEngine(t *testing.T, svc *Service) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	e := gin.New()
	h := NewHandler(svc)
	g := e.Group("/", func(c *gin.Context) { c.Set("user_id", "11111111-1111-1111-1111-111111111111"); c.Next() })
	g.GET("/context", h.GetContext)
	g.POST("/context/switch", h.SwitchContext)
	return e
}

// GetContext / SwitchContext must not echo driver/connection error text to the
// client. (The httperr sanitizer already masks it; validation sentinels such as
// "role profiles are not a switchable context" are intentionally returned.)
func TestContextHandlers_DoNotLeakErrors(t *testing.T) {
	// A lazily-connecting pool to a closed port: every query fails with a
	// driver error that names the host.
	pool, err := pgxpool.New(context.Background(), "postgres://leak:leak@127.0.0.1:1/leakdb?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	e := ctxEngine(t, NewService(pool))

	w := httptest.NewRecorder()
	e.ServeHTTP(w, httptest.NewRequest("GET", "/context", nil))
	if w.Code != 500 || strings.Contains(w.Body.String(), "127.0.0.1") || strings.Contains(w.Body.String(), "leak") {
		t.Fatalf("GetContext: %d %s", w.Code, w.Body)
	}

	for _, body := range []string{
		`{"contextType":"role","contextId":"x"}`,
		`{"contextType":"bogus","contextId":"x"}`,
		`{"contextType":"estate","contextId":"x"}`,
	} {
		w = httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/context/switch", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		e.ServeHTTP(w, req)
		if w.Code != 403 || strings.Contains(w.Body.String(), "127.0.0.1") || strings.Contains(w.Body.String(), "leak") {
			t.Errorf("SwitchContext %s: %d %s", body, w.Code, w.Body)
		}
	}
}
