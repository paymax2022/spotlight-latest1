package cryptosvc

// Live-DB tests for PGFeeStore and the audit columns it relies on. SKIPPED without
// TEST_DATABASE_URL (see livePool). crypto_fee_schedules is append-only by design, so these
// tests cannot delete what they write: each test ends by appending a row that restores the
// schedule that was active when it started, leaving the database pricing as it found it.

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func liveFees(t *testing.T) (*PGFeeStore, *pgxpool.Pool) {
	t.Helper()
	pool := livePool(t)
	s := NewPGFeeStore(pool, DefaultFeeSchedule())
	ctx := context.Background()
	start, err := s.Current(ctx)
	if err != nil {
		t.Fatalf("current: %v", err)
	}
	t.Cleanup(func() {
		now, err := s.Current(context.Background())
		if err != nil || (now.Version == start.Version) {
			return
		}
		in := start.asInput()
		in.Actor, in.IdempotencyKey, in.ExpectedVersion = "system:test-restore", "restore-"+uuid.NewString(), now.Version
		in.Reason = "restore the schedule that was active before the test"
		if _, err := s.Append(context.Background(), in); err != nil {
			t.Errorf("could not restore the fee schedule: %v", err)
		}
	})
	return s, pool
}

func liveInput(expected int64, key string, major int) FeeScheduleInput {
	return FeeScheduleInput{MajorBps: major, OtherBps: 110, Majors: []string{"BTC", "eth", "USDT"},
		Overrides: map[string]int{"doge": 140}, Reason: "live test", Actor: "tester", IdempotencyKey: key, ExpectedVersion: expected}
}

func TestPGFeeStore_AppendCurrentAndReplay(t *testing.T) {
	s, _ := liveFees(t)
	ctx := context.Background()
	cur, _ := s.Current(ctx)
	key := "live-" + uuid.NewString()

	ch, err := s.Append(ctx, liveInput(cur.Version, key, 81))
	if err != nil || !ch.Created {
		t.Fatalf("append: created=%v err=%v", ch.Created, err)
	}
	v := ch.New
	if ch.Old.Version != cur.Version {
		t.Fatalf("Old must be the version current under the lock (%d), got %d", cur.Version, ch.Old.Version)
	}
	if v.Version <= cur.Version || v.Schedule.MajorBps != 81 || v.Schedule.OtherBps != 110 || v.Schedule.Overrides["DOGE"] != 140 || v.CreatedBy != "tester" {
		t.Fatalf("stored schedule wrong: %+v", v)
	}
	if _, ok := v.Schedule.Majors["ETH"]; !ok {
		t.Fatalf("majors must be stored upper-cased: %v", v.Schedule.Majors)
	}
	now, err := s.Current(ctx)
	if err != nil || now.Version != v.Version || now.Schedule.MajorBps != 81 {
		t.Fatalf("Current does not return the new version: %+v err=%v", now, err)
	}

	again, err := s.Append(ctx, liveInput(cur.Version, key, 81)) // retry after a timeout
	if err != nil || again.Created || again.New.Version != v.Version {
		t.Fatalf("a retry must replay the stored row: created=%v err=%v v=%d", again.Created, err, again.New.Version)
	}
	if _, err := s.Append(ctx, liveInput(cur.Version, key, 99)); !errors.Is(err, ErrFeeIdempotencyConflict) {
		t.Fatalf("same key, different schedule: err = %v, want ErrFeeIdempotencyConflict", err)
	}
	if _, err := s.Append(ctx, liveInput(cur.Version, "other-"+uuid.NewString(), 82)); !errors.Is(err, ErrFeeVersionConflict) {
		t.Fatalf("a stale expected version: err = %v, want ErrFeeVersionConflict", err)
	}
	if h, err := s.History(ctx, 5); err != nil || len(h) == 0 || h[0].Version != v.Version {
		t.Fatalf("history newest-first wrong: %v err=%v", h, err)
	}
}

func TestPGFeeStore_RejectsAnOverCeilingScheduleBeforeTheDatabase(t *testing.T) {
	s, _ := liveFees(t)
	cur, _ := s.Current(context.Background())
	if _, err := s.Append(context.Background(), liveInput(cur.Version, "ceil-"+uuid.NewString(), HardMaxBps+1)); !errors.Is(err, ErrFeeBps) {
		t.Fatalf("err = %v, want ErrFeeBps", err)
	}
}

// Eight admins press save on the same version at once: exactly one wins, the rest are told to reload.
func TestPGFeeStore_ConcurrentWritersOnOneVersionHaveOneWinner(t *testing.T) {
	s, _ := liveFees(t)
	ctx := context.Background()
	cur, _ := s.Current(ctx)
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins, conflicts, other := 0, 0, 0
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ch, err := s.Append(ctx, liveInput(cur.Version, "race-"+uuid.NewString(), 60+i))
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil && ch.Created:
				wins++
			case errors.Is(err, ErrFeeVersionConflict):
				conflicts++
			default:
				other++
			}
		}(i)
	}
	wg.Wait()
	if wins != 1 || conflicts != 7 || other != 0 {
		t.Fatalf("wins=%d conflicts=%d other=%d, want 1 / 7 / 0", wins, conflicts, other)
	}
}

func TestPGFeeStore_HistoryCannotBeRewritten(t *testing.T) {
	s, pool := liveFees(t)
	ctx := context.Background()
	cur, _ := s.Current(ctx)
	chg, err := s.Append(ctx, liveInput(cur.Version, "imm-"+uuid.NewString(), 70))
	if err != nil {
		t.Fatal(err)
	}
	v := chg.New
	if _, err := pool.Exec(ctx, `UPDATE public.crypto_fee_schedules SET major_bps = 0 WHERE version = $1`, v.Version); err == nil {
		t.Fatal("UPDATE on the append-only fee history must fail")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM public.crypto_fee_schedules WHERE version = $1`, v.Version); err == nil {
		t.Fatal("DELETE on the append-only fee history must fail")
	}
}

func TestPGAuditor_RecordsEntityTypeAndOldAndNewValues(t *testing.T) {
	pool := livePool(t)
	a := &PGAuditor{Pool: pool}
	id := uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.crypto_audit_log WHERE entity_id = $1`, id)
	})
	a.Audit(context.Background(), AuditEvent{Actor: "admin-1", Action: "crypto.fee_schedule.update", EntityType: "crypto_fee_schedule",
		EntityID: id, Reason: "why", Old: map[string]any{"major_bps": 75}, Detail: map[string]any{"major_bps": 80}})
	var et, reason string
	var oldV, newV []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT entity_type, old_value, new_value, reason FROM public.crypto_audit_log WHERE entity_id = $1`, id).Scan(&et, &oldV, &newV, &reason); err != nil {
		t.Fatalf("audit row not written: %v", err)
	}
	if et != "crypto_fee_schedule" || reason != "why" || string(oldV) == "" || string(newV) == "" {
		t.Fatalf("audit row wrong: type=%q old=%s new=%s reason=%q", et, oldV, newV, reason)
	}
	// A swap event still defaults to crypto_swap.
	sid := uuid.NewString()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.crypto_audit_log WHERE entity_id = $1`, sid)
	})
	a.Audit(context.Background(), AuditEvent{Actor: "u", Action: "crypto.swap.quote", EntityID: sid})
	if err := pool.QueryRow(context.Background(), `SELECT entity_type FROM public.crypto_audit_log WHERE entity_id = $1`, sid).Scan(&et); err != nil || et != "crypto_swap" {
		t.Fatalf("default entity type = %q err=%v", et, err)
	}
}

// TRUNCATE skips row triggers, so it has its own guard; the history must survive it.
func TestPGFeeStore_HistoryCannotBeTruncated(t *testing.T) {
	_, pool := liveFees(t)
	if _, err := pool.Exec(context.Background(), `TRUNCATE public.crypto_fee_schedules`); err == nil {
		t.Fatal("TRUNCATE on the append-only fee history must fail")
	}
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM public.crypto_fee_schedules`).Scan(&n); err != nil {
		t.Fatal(err)
	}
}

// The audit row is part of the same transaction as the change: one change, exactly one row,
// carrying old and new; a replay adds none.
func TestPGFeeStore_AuditRowIsAtomicWithTheChange(t *testing.T) {
	s, pool := liveFees(t)
	ctx := context.Background()
	cur, _ := s.Current(ctx)
	key := "aud-" + uuid.NewString()
	ch, err := s.Append(ctx, liveInput(cur.Version, key, 72))
	if err != nil || !ch.Created {
		t.Fatalf("append: %+v %v", ch, err)
	}
	ver := ch.New.Version
	count := func() int {
		var n int
		if err := pool.QueryRow(ctx,
			`SELECT count(*) FROM public.crypto_audit_log WHERE action = 'crypto.fee_schedule.update' AND entity_id = $1`, itoa(ver)).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if got := count(); got != 1 {
		t.Fatalf("audit rows for version %d = %d, want 1", ver, got)
	}
	var et, actor string
	var oldV, newV []byte
	if err := pool.QueryRow(ctx, `SELECT entity_type, actor_id, old_value, new_value FROM public.crypto_audit_log WHERE action = 'crypto.fee_schedule.update' AND entity_id = $1`, itoa(ver)).Scan(&et, &actor, &oldV, &newV); err != nil {
		t.Fatal(err)
	}
	if et != "crypto_fee_schedule" || actor != "tester" || len(oldV) == 0 || len(newV) == 0 {
		t.Fatalf("audit row wrong: type=%q actor=%q old=%s new=%s", et, actor, oldV, newV)
	}
	if _, err := s.Append(ctx, liveInput(cur.Version, key, 72)); err != nil { // replay
		t.Fatal(err)
	}
	if got := count(); got != 1 {
		t.Fatalf("a replay must not add an audit row, have %d", got)
	}
	// A refused write leaves no audit row either.
	if _, err := s.Append(ctx, liveInput(cur.Version, "stale-"+uuid.NewString(), 73)); !errors.Is(err, ErrFeeVersionConflict) {
		t.Fatal("expected a version conflict")
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.crypto_audit_log WHERE action = 'crypto.fee_schedule.update' AND entity_id = $1`, itoa(ver))
	})
}

func itoa(v int64) string { return strconv.FormatInt(v, 10) }
