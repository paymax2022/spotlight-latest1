package transport

// Hardening tests for the w9-transport prod-probe findings — DB-free and
// correct-by-construction: each guard runs before any pool access, so a nil
// *pgxpool.Pool is safe (same seam style as academy/fees/school's 22P02 tests).

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

// ─── 1. standalone SOS requires a registered driver ─────────────────────────
// POST /driver/sos with no trip_id skipped BOTH authz gates and let any
// authenticated user write critical safety_incidents rows. A trip-bound SOS is
// participant-gated; a nil-trip SOS must fall back to the registered-driver
// gate every sibling /driver/* route enforces.

func TestSOSRequiresDriver_StandaloneIncidentGated(t *testing.T) {
	if !sosRequiresDriver(nil) {
		t.Fatal("a nil-trip SOS has no participant object to authz against — it MUST require a registered driver")
	}
}

func TestSOSRequiresDriver_TripBoundIncidentUsesParticipantGate(t *testing.T) {
	tripID := "trip-abc"
	if sosRequiresDriver(&tripID) {
		t.Fatal("a trip-bound SOS is gated by trip participation, not driver registration — the rider is a valid caller")
	}
}

// ─── 2. POST /trips/:id/track — malformed id → 404, not 500 ─────────────────
// participants() propagated pgx.ErrNoRows / 22P02 raw; TrackPosition only maps
// ErrNotTripDriver, so both non-uuid and nonexistent-uuid ids 500'd.

func TestTrackerParticipants_MalformedTripIDIs404(t *testing.T) {
	tr := &TripTracker{} // nil pool is safe: the uuid gate runs first
	_, _, err := tr.participants(context.Background(), "not-a-uuid")
	assertNotFound(t, err)
}

func TestTrackerIngest_MalformedTripIDIs404(t *testing.T) {
	tr := &TripTracker{}
	err := tr.Ingest(context.Background(), "not-a-uuid", "driver-1", TrackPoint{Lat: 6.5, Lng: 3.4})
	assertNotFound(t, err)
}

func TestTrackerParticipants_MalformedTripIDDoesNotLeakDriverGate(t *testing.T) {
	// A malformed id must 404 BEFORE the not-trip-driver check — a 403 here
	// would both leak the gate ordering and regress to the probed 500.
	tr := &TripTracker{}
	err := tr.Ingest(context.Background(), "bogus", "anyone", TrackPoint{Lat: 1, Lng: 1})
	if errors.Is(err, ErrNotTripDriver) {
		t.Fatal("malformed trip id must not reach the driver check")
	}
	assertNotFound(t, err)
}

// ─── 3. DELETE /trusted-contacts/:id — malformed id → 404, not 500 ──────────
// The raw DELETE let Postgres's 22P02 surface as a 500; a well-formed but
// missing id already answered 404, so malformed must too.

func TestDeleteTrustedContact_MalformedIDIs404(t *testing.T) {
	s := &Service{} // nil pool is safe: the uuid gate runs first
	err := s.DeleteTrustedContact(context.Background(), "user-1", "not-a-uuid")
	assertNotFound(t, err)
	if ce := asCodedErr(t, err); ce.Message != "contact not found" {
		t.Fatalf("message = %q, want %q (same as the missing-row path)", ce.Message, "contact not found")
	}
}

func asCodedErr(t *testing.T, err error) *CodedError {
	t.Helper()
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	ce := &CodedError{}
	if !errors.As(err, &ce) {
		t.Fatalf("expected *CodedError, got %T (%v)", err, err)
	}
	return ce
}

func assertNotFound(t *testing.T, err error) {
	t.Helper()
	ce := asCodedErr(t, err)
	if ce.Status != http.StatusNotFound || ce.Code != CodeNotFound {
		t.Fatalf("want 404 NOT_FOUND, got status=%d code=%q", ce.Status, ce.Code)
	}
}
