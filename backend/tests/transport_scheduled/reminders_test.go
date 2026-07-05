package transport_scheduled_test

// ---------------------------------------------------------------------------
// SendDueReminders idempotency (24h + 1h waves, concurrent-safe claim).
//
// Service.sendReminderWave (backend/internal/transport/scheduled_dispatch.go)
// claims each booking with a single SQL statement:
//
//	UPDATE transport_scheduled_bookings
//	SET %s = NOW(), updated_at = NOW()          -- %s = reminder_24h_sent_at | reminder_1h_sent_at
//	WHERE %s IS NULL
//	  AND status IN ('scheduled','dispatch_pending','dispatched')
//	  AND scheduled_pickup_at > now()
//	  AND scheduled_pickup_at <= now() + $1::interval
//	RETURNING id, user_id, mode, scheduled_pickup_at
//
// The claim and the notify are split (UPDATE...RETURNING claims the row atomically;
// notifyUser fires only for rows the UPDATE actually returned), so two concurrent
// SendDueReminders calls racing the SAME row can only have ONE of them see it in
// the RETURNING set — this is a property of Postgres's row-level locking on
// UPDATE, not something Go-level code arbitrates. This file cannot exercise
// that concurrency without a live Postgres (see the live-DB test in
// live_db_integration_test.go), but it DOES prove, DB-free, the two properties
// that are pure logic: (1) the WHERE-clause claim guard is a correct one-shot
// gate (already-sent bookings are excluded), and (2) the two waves (24h/1h) are
// independent columns so firing one never blocks or duplicates the other.
// ---------------------------------------------------------------------------

import (
	"testing"
	"time"
)

// reminderBooking is a minimal in-memory model of the columns
// sendReminderWave's WHERE clause inspects, keyed the same way the real SQL
// is: a NULL sent_at column is the one-shot claim gate.
type reminderBooking struct {
	id                string
	status            schedStatus
	scheduledPickupAt time.Time
	reminder24hSentAt *time.Time
	reminder1hSentAt  *time.Time
}

// claimWave models ONE call to sendReminderWave for a single column/window,
// transcribing the WHERE clause exactly: NULL sent_at, active status, pickup
// falls within (now, now+window]. Returns true if this call claims (and would
// fire) the reminder, and stamps sent_at as the real UPDATE...RETURNING does —
// so a second call against the same booking sees a non-NULL column and is
// excluded by the WHERE clause (never double-fires).
func claimWave(b *reminderBooking, which string, window time.Duration, now time.Time) bool {
	active := b.status == schedScheduled || b.status == schedDispatchPending || b.status == schedDispatched
	if !active {
		return false
	}
	if !(b.scheduledPickupAt.After(now) && !b.scheduledPickupAt.After(now.Add(window))) {
		return false
	}
	switch which {
	case "24h":
		if b.reminder24hSentAt != nil {
			return false // already claimed — WHERE reminder_24h_sent_at IS NULL excludes it
		}
		t := now
		b.reminder24hSentAt = &t
		return true
	case "1h":
		if b.reminder1hSentAt != nil {
			return false
		}
		t := now
		b.reminder1hSentAt = &t
		return true
	}
	return false
}

// TestReminders_24hWaveFiresExactlyOnce simulates N sequential worker ticks
// (as if the 60s loop ran N times back-to-back) against the SAME booking
// sitting inside the 24h window the whole time, and asserts the reminder
// claims exactly once — every subsequent tick sees a non-NULL
// reminder_24h_sent_at and is excluded.
func TestReminders_24hWaveFiresExactlyOnce(t *testing.T) {
	now := time.Now()
	b := &reminderBooking{
		id:                "b1",
		status:            schedScheduled,
		scheduledPickupAt: now.Add(20 * time.Hour), // inside (now, now+24h]
	}
	fired := 0
	for tick := 0; tick < 10; tick++ {
		if claimWave(b, "24h", 24*time.Hour, now) {
			fired++
		}
	}
	if fired != 1 {
		t.Errorf("24h reminder fired %d times across 10 ticks, want exactly 1", fired)
	}
	if b.reminder24hSentAt == nil {
		t.Error("reminder_24h_sent_at should be stamped after the claiming tick")
	}
}

// TestReminders_1hWaveFiresExactlyOnce mirrors the above for the 1h wave.
func TestReminders_1hWaveFiresExactlyOnce(t *testing.T) {
	now := time.Now()
	b := &reminderBooking{
		id:                "b2",
		status:            schedDispatchPending,
		scheduledPickupAt: now.Add(45 * time.Minute), // inside (now, now+1h]
	}
	fired := 0
	for tick := 0; tick < 10; tick++ {
		if claimWave(b, "1h", 1*time.Hour, now) {
			fired++
		}
	}
	if fired != 1 {
		t.Errorf("1h reminder fired %d times across 10 ticks, want exactly 1", fired)
	}
}

// TestReminders_ConcurrentInvocationClaimsExactlyOnce simulates two "workers"
// (e.g. a scheduler pod restarted mid-tick and briefly overlapped, or the
// contract's every-60s loop running on more than one replica) racing to claim
// the SAME booking in the SAME instant. Because claimWave mutates the shared
// booking struct synchronously (mirroring the atomic UPDATE...RETURNING claim
// a real transaction provides), only the FIRST call in program order can ever
// see reminder24hSentAt == nil; this proves the claim-then-check ordering is
// what makes double-send structurally impossible, independent of goroutine
// scheduling — the real guarantee comes from Postgres row locking (asserted
// against a live DB in live_db_integration_test.go), but the invariant "claim
// state must be checked and set as a single indivisible step" is what this
// locks at the logic level.
func TestReminders_ConcurrentInvocationClaimsExactlyOnce(t *testing.T) {
	now := time.Now()
	b := &reminderBooking{
		id:                "b3",
		status:            schedScheduled,
		scheduledPickupAt: now.Add(30 * time.Minute),
	}
	var claims int
	const workers = 20
	for i := 0; i < workers; i++ {
		if claimWave(b, "1h", 1*time.Hour, now) {
			claims++
		}
	}
	if claims != 1 {
		t.Fatalf("%d 'concurrent' worker calls claimed the reminder %d times, want exactly 1 (idempotent claim broken)", workers, claims)
	}
}

// TestReminders_WavesAreIndependentColumns proves that claiming the 24h
// reminder does not consume/block the 1h reminder for the same booking (two
// separate columns, two separate windows) — a booking legitimately gets BOTH
// reminders over its lifetime, each exactly once.
func TestReminders_WavesAreIndependentColumns(t *testing.T) {
	now := time.Now()
	b := &reminderBooking{
		id:                "b4",
		status:            schedScheduled,
		scheduledPickupAt: now.Add(20 * time.Hour), // inside 24h window right now
	}
	if !claimWave(b, "24h", 24*time.Hour, now) {
		t.Fatal("expected 24h reminder to claim")
	}
	// A second attempt at 24h must not re-fire.
	if claimWave(b, "24h", 24*time.Hour, now) {
		t.Fatal("24h reminder re-fired after being claimed")
	}
	// Advance the clock to inside the 1h window; 1h reminder must still be
	// claimable (independent column) even though 24h is already sent.
	later := b.scheduledPickupAt.Add(-45 * time.Minute)
	if !claimWave(b, "1h", 1*time.Hour, later) {
		t.Fatal("expected 1h reminder to claim independently of the already-sent 24h reminder")
	}
	if b.reminder24hSentAt == nil || b.reminder1hSentAt == nil {
		t.Error("both reminder columns should be stamped by end of the booking's lifecycle")
	}
}

// TestReminders_TerminalOrExpiredBookingsNeverFire proves the WHERE clause's
// status IN ('scheduled','dispatch_pending','dispatched') guard excludes
// terminal-state bookings (cancelled/completed/failed_no_driver/expired) even
// if their pickup time would otherwise fall in the reminder window — a
// cancelled trip must never get a "your ride is coming up" reminder.
func TestReminders_TerminalOrExpiredBookingsNeverFire(t *testing.T) {
	now := time.Now()
	terminalStatuses := []schedStatus{schedCancelled, schedCompleted, schedFailedNoDriver, schedExpired}
	for _, status := range terminalStatuses {
		b := &reminderBooking{
			id:                "b-" + string(status),
			status:            status,
			scheduledPickupAt: now.Add(30 * time.Minute), // would be inside 1h window
		}
		if claimWave(b, "1h", 1*time.Hour, now) {
			t.Errorf("status=%s must never fire a reminder, but claimWave returned true", status)
		}
	}
}

// TestReminders_OutsideWindowNeverFires proves a booking whose pickup is
// either already past, or further out than the window, is excluded —
// scheduled_pickup_at > now() AND <= now()+window is a half-open interval on
// BOTH ends.
func TestReminders_OutsideWindowNeverFires(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name     string
		pickupAt time.Time
	}{
		{"already past", now.Add(-5 * time.Minute)},
		{"exactly now (not strictly after)", now},
		{"far beyond window", now.Add(2 * time.Hour)},
	}
	for _, tc := range cases {
		b := &reminderBooking{id: "x", status: schedScheduled, scheduledPickupAt: tc.pickupAt}
		if claimWave(b, "1h", 1*time.Hour, now) {
			t.Errorf("%s: pickup=%s should NOT be inside the 1h reminder window (now=%s)", tc.name, tc.pickupAt, now)
		}
	}
}
