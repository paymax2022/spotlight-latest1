package app

import (
	"context"
	"errors"
	"testing"

	connectdiscovery "spotlight/backend/internal/connect/discovery"
	connectmatching "spotlight/backend/internal/connect/matching"
)

// The discovery LikeRecorder adapter must translate the matcher's not-found
// sentinel into the discovery domain's own — a raw passthrough landed on the
// 500 default in mapDiscoveryError, so a swipe on a nonexistent target 500'd
// instead of 404ing. A nil-pool matcher still reaches the malformed-id guard,
// which is enough to prove the errors.Is translation seam works.
func TestConnectLikeRecorderAdapterTranslatesNotFound(t *testing.T) {
	adapter := &connectLikeRecorderAdapter{svc: connectmatching.NewService(nil)}
	_, err := adapter.Like(context.Background(), "user-1", "not-a-uuid", "like")
	if !errors.Is(err, connectdiscovery.ErrTargetNotFound) {
		t.Fatalf("want discovery ErrTargetNotFound, got %v", err)
	}
	if errors.Is(err, connectmatching.ErrTargetNotFound) {
		t.Fatal("matcher sentinel must be translated, not passed through")
	}
}
