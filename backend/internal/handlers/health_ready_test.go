//nolint:testpackage // needs internal probe-cache fields — not reachable from the public API without a live DB
package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func readyStatus(h *HealthHandler) int {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/readyz", nil)
	h.Ready(c)
	return w.Code
}

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
	if got := readyStatus(NewHealthHandler()); got != http.StatusServiceUnavailable {
		t.Fatalf("nil pool: got %d, want 503", got)
	}
}

func TestReadyDeadPoolIsNotReady(t *testing.T) {
	if got := readyStatus(NewHealthHandler().WithPool(closedPool(t))); got != http.StatusServiceUnavailable {
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
	if got := readyStatus(h); got != http.StatusOK {
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
	if got := readyStatus(h); got != http.StatusServiceUnavailable {
		t.Fatalf("stale cached verdict over dead pool: got %d, want 503", got)
	}
}
