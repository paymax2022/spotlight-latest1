package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"
)

func readyStatus(t *testing.T, h *HealthHandler) int {
	t.Helper()
	return readyResponse(t, h).Code
}

// readyResponse serves GET /readyz through the handler and returns the raw
// recorder so tests can inspect the per-component payload, not just the code.
func readyResponse(t *testing.T, h *HealthHandler) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/readyz", nil)
	h.Ready(c)
	return w
}

// readyComponents decodes the "components" object from a readyz response.
func readyComponents(t *testing.T, w *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var body struct {
		Components map[string]string `json:"components"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode readyz body %q: %v", w.Body.String(), err)
	}
	return body.Components
}

// deadRedis is a client that is wired but can never be reached — mirrors a
// Redis outage after a successful boot.
func deadRedis() *goredis.Client {
	return goredis.NewClient(&goredis.Options{Addr: "127.0.0.1:1"})
}

var errPingStub = errors.New("stub: ping failed")

// A closed pool fails Ping deterministically — no live database needed.
func closedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), "postgres://postgres:postgres@127.0.0.1:1/postgres")
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	pool.Close()
	return pool
}

func TestReadyNilPoolIsNotReady(t *testing.T) {
	if got := readyStatus(t, NewHealthHandler()); got != http.StatusServiceUnavailable {
		t.Fatalf("nil pool: got %d, want 503", got)
	}
}

func TestReadyDeadPoolIsNotReady(t *testing.T) {
	if got := readyStatus(t, NewHealthHandler().WithPool(closedPool(t))); got != http.StatusServiceUnavailable {
		t.Fatalf("dead pool: got %d, want 503", got)
	}
}

// The readiness verdict is cached for readyProbeInterval: a pre-seeded fresh
// "ready" verdict is served without touching the pool — this is the property
// that stops loadtest/deploy probes from stampeding the pool into a flap.
func TestReadyServesCachedVerdictWithinInterval(t *testing.T) {
	h := NewHealthHandler().WithPool(closedPool(t))
	h.mu.Lock()
	h.lastReady, h.lastReason, h.lastProbeAt = true, "", time.Now()
	h.mu.Unlock()
	if got := readyStatus(t, h); got != http.StatusOK {
		t.Fatalf("fresh cached verdict: got %d, want 200", got)
	}
}

// Once the cache window lapses the probe runs again — a stale "ready" verdict
// must not paper over a dead pool.
func TestReadyReprobesAfterInterval(t *testing.T) {
	h := NewHealthHandler().WithPool(closedPool(t))
	h.mu.Lock()
	h.lastReady, h.lastProbeAt = true, time.Now().Add(-2*readyProbeInterval)
	h.mu.Unlock()
	if got := readyStatus(t, h); got != http.StatusServiceUnavailable {
		t.Fatalf("stale cached verdict over dead pool: got %d, want 503", got)
	}
}

// ── E2E-FR-050: Redis as a readiness component ──────────────────────────────
// pingDB/pingRedis stubs stand in for live infra: "up" is unforgeable with a
// closed pool otherwise, and the component matrix is what matters here.

// dbUpHandler returns a handler whose DB probe always succeeds (via stub) on a
// non-nil pool, so Redis behavior can be isolated.
func dbUpHandler(t *testing.T) *HealthHandler {
	t.Helper()
	h := NewHealthHandler().WithPool(closedPool(t))
	h.pingDB = func(ctx context.Context) error { return nil }
	return h
}

func TestReadyRedisDownNotRequiredIsDegraded200(t *testing.T) {
	h := dbUpHandler(t).WithRedis(deadRedis(), false)
	h.pingRedis = func(ctx context.Context) error { return errPingStub }

	w := readyResponse(t, h)
	if w.Code != http.StatusOK {
		t.Fatalf("optional Redis down: got %d, want 200", w.Code)
	}
	comp := readyComponents(t, w)
	if comp["redis"] != componentDegraded {
		t.Errorf("components.redis = %q, want %q", comp["redis"], componentDegraded)
	}
	if comp["db"] != componentUp {
		t.Errorf("components.db = %q, want %q", comp["db"], componentUp)
	}
}

func TestReadyRedisDownRequiredIs503(t *testing.T) {
	h := dbUpHandler(t).WithRedis(deadRedis(), true)
	h.pingRedis = func(ctx context.Context) error { return errPingStub }

	w := readyResponse(t, h)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("required Redis down: got %d, want 503", w.Code)
	}
	if got := readyComponents(t, w)["redis"]; got != componentDown {
		t.Errorf("components.redis = %q, want %q", got, componentDown)
	}
}

func TestReadyRedisUp(t *testing.T) {
	h := dbUpHandler(t).WithRedis(deadRedis(), true)
	h.pingRedis = func(ctx context.Context) error { return nil }

	w := readyResponse(t, h)
	if w.Code != http.StatusOK {
		t.Fatalf("required Redis up: got %d, want 200", w.Code)
	}
	if got := readyComponents(t, w)["redis"]; got != componentUp {
		t.Errorf("components.redis = %q, want %q", got, componentUp)
	}
}

func TestReadyRedisNotConfigured(t *testing.T) {
	h := dbUpHandler(t) // no WithRedis at all

	w := readyResponse(t, h)
	if w.Code != http.StatusOK {
		t.Fatalf("no Redis wired: got %d, want 200", w.Code)
	}
	if got := readyComponents(t, w)["redis"]; got != componentNotConfigured {
		t.Errorf("components.redis = %q, want %q", got, componentNotConfigured)
	}
}

func TestReadyDBDownWithDegradedRedisIs503(t *testing.T) {
	// Required components still fail readiness even when Redis is merely
	// degraded: the 503 comes from the DB verdict.
	h := NewHealthHandler().WithPool(closedPool(t)).WithRedis(deadRedis(), false)
	h.pingRedis = func(ctx context.Context) error { return errPingStub }

	w := readyResponse(t, h)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("db down + redis degraded: got %d, want 503", w.Code)
	}
	comp := readyComponents(t, w)
	if comp["db"] != componentDown || comp["redis"] != componentDegraded {
		t.Errorf("components = %v, want db=down redis=degraded", comp)
	}
}

// The Redis verdict shares the probe cache: a second call inside the interval
// must not re-ping either component.
func TestReadyRedisProbeSharesCache(t *testing.T) {
	h := dbUpHandler(t).WithRedis(deadRedis(), false)
	calls := 0
	h.pingRedis = func(ctx context.Context) error { calls++; return nil }
	h.lastProbeAt = time.Now()
	h.lastReady, h.lastDB, h.lastRedis = true, componentUp, componentUp
	if got := readyStatus(t, h); got != http.StatusOK {
		t.Fatalf("cached verdict: got %d, want 200", got)
	}
	if calls != 0 {
		t.Errorf("redis ping ran %d times inside the cache window, want 0", calls)
	}
}
