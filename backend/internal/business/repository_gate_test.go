package business

// E2E wave-6 prod probe: GET /api/finance/business/<not-a-uuid> 500'd —
// the malformed id hit Postgres as an invalid-uuid syntax error and fell
// through errMap to the 500 default. GetProfile is the funnel every :id
// member/admin entry point reaches; the malformed id must answer ErrNotFound
// before the query runs.

import (
	"context"
	"errors"
	"testing"
)

func TestGetProfileMalformedIDIsNotFound(t *testing.T) {
	// nil pool is safe: the UUID gate returns before any query executes.
	repo := NewRepository(nil)
	_, err := repo.GetProfile(context.Background(), "not-a-uuid")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound for malformed id, got %v", err)
	}
}
