package ratelimit

import (
	"testing"
	"time"
)

func TestBurstThenDeny(t *testing.T) {
	// rate 0 → no refill; only the initial burst is available.
	l := New(0, 2)
	if !l.Allow("ip1") || !l.Allow("ip1") {
		t.Fatal("first two requests should be allowed (burst=2)")
	}
	if l.Allow("ip1") {
		t.Error("third request should be denied")
	}
	// Separate keys have independent buckets.
	if !l.Allow("ip2") {
		t.Error("a different key should have its own bucket")
	}
}

func TestRefill(t *testing.T) {
	l := New(100, 1) // 100/sec → refills in ~10ms
	if !l.Allow("k") {
		t.Fatal("first allowed")
	}
	if l.Allow("k") {
		t.Fatal("immediate second should be denied")
	}
	time.Sleep(20 * time.Millisecond)
	if !l.Allow("k") {
		t.Error("should refill after 20ms")
	}
}
