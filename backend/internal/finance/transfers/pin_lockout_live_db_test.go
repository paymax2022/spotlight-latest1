package transfers

// Live-DB tests for the transaction-PIN lockout. They need only auth.users and
// user_transaction_pin, and gate on TEST_DATABASE_URL alone (see liveDBPool).
//
//   export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//   cd backend && go test ./internal/finance/transfers/ -run PinLockout -v

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

const lockoutTestPIN = "4827"

// seedPinUser creates an auth user with a PIN set; the user (and its PIN row, by
// cascade) is removed afterwards.
func seedPinUser(t *testing.T, pool *pgxpool.Pool, ps *pinStore) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email) VALUES ($1, $2)`, id, id+"@pin.test"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	if err := ps.Set(ctx, id, lockoutTestPIN); err != nil {
		t.Fatalf("set pin: %v", err)
	}
	return id
}

func pinState(t *testing.T, pool *pgxpool.Pool, id string) (failed int, locked bool) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT failed_attempts, locked_until IS NOT NULL AND locked_until > now() FROM user_transaction_pin WHERE user_id=$1`, id).
		Scan(&failed, &locked); err != nil {
		t.Fatalf("read pin state: %v", err)
	}
	return failed, locked
}

// The race: Verify used to read failed_attempts, compare, then write read+1, so
// parallel wrong guesses all read the same count and all passed the lock check.
// A burst could test far more than maxPinFailures guesses and the stored count
// under-reported them. Exactly maxPinFailures guesses may ever be evaluated.
func TestPinLockoutLiveDB_ParallelWrongGuessesAreCapped(t *testing.T) {
	pool := liveDBPool(t)
	ps := newPinStore(pool)
	id := seedPinUser(t, pool, ps)

	const burst = 40
	var wg sync.WaitGroup
	var mu sync.Mutex
	invalid, locked, other := 0, 0, 0
	start := make(chan struct{})
	for i := 0; i < burst; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			err := ps.Verify(context.Background(), id, "0000")
			mu.Lock()
			defer mu.Unlock()
			var attempt *PinAttemptError
			switch {
			case errors.As(err, &attempt):
				invalid++
			case errors.Is(err, ErrPinLocked):
				locked++
			default:
				other++
			}
		}()
	}
	close(start)
	wg.Wait()

	if other != 0 {
		t.Fatalf("unexpected errors: %d", other)
	}
	// Guesses 1..4 report "n tries left"; the 5th trips the lock; the rest never get evaluated.
	if invalid != maxPinFailures-1 {
		t.Fatalf("evaluated-and-wrong guesses = %d, want %d (the lock must cap a parallel burst)", invalid, maxPinFailures-1)
	}
	if locked != burst-(maxPinFailures-1) {
		t.Fatalf("locked results = %d, want %d", locked, burst-(maxPinFailures-1))
	}
	failed, isLocked := pinState(t, pool, id)
	if failed != maxPinFailures || !isLocked {
		t.Fatalf("stored state failed=%d locked=%v, want failed=%d locked=true", failed, isLocked, maxPinFailures)
	}
	// And the lock holds even for the right PIN.
	if err := ps.Verify(context.Background(), id, lockoutTestPIN); !errors.Is(err, ErrPinLocked) {
		t.Fatalf("correct PIN while locked: err = %v, want ErrPinLocked", err)
	}
}

func TestPinLockoutLiveDB_CountsDownThenLocks(t *testing.T) {
	pool := liveDBPool(t)
	ps := newPinStore(pool)
	id := seedPinUser(t, pool, ps)

	for want := maxPinFailures - 1; want >= 1; want-- {
		err := ps.Verify(context.Background(), id, "0000")
		var attempt *PinAttemptError
		if !errors.As(err, &attempt) || !errors.Is(err, ErrPinInvalid) || attempt.Remaining != want {
			t.Fatalf("err = %v, want ErrPinInvalid with %d remaining", err, want)
		}
	}
	if err := ps.Verify(context.Background(), id, "0000"); !errors.Is(err, ErrPinLocked) {
		t.Fatalf("final wrong guess: err = %v, want ErrPinLocked", err)
	}
}

func TestPinLockoutLiveDB_CorrectPinResetsTheCount(t *testing.T) {
	pool := liveDBPool(t)
	ps := newPinStore(pool)
	id := seedPinUser(t, pool, ps)

	for i := 0; i < 3; i++ {
		_ = ps.Verify(context.Background(), id, "0000")
	}
	if err := ps.Verify(context.Background(), id, lockoutTestPIN); err != nil {
		t.Fatalf("correct PIN: %v", err)
	}
	if failed, locked := pinState(t, pool, id); failed != 0 || locked {
		t.Fatalf("after success failed=%d locked=%v, want 0/false", failed, locked)
	}
}

// A lock that has expired must let the right PIN through and clear the lock.
func TestPinLockoutLiveDB_ExpiredLockAcceptsCorrectPin(t *testing.T) {
	pool := liveDBPool(t)
	ps := newPinStore(pool)
	id := seedPinUser(t, pool, ps)

	if _, err := pool.Exec(context.Background(),
		`UPDATE user_transaction_pin SET failed_attempts=$2, locked_until=now() - interval '1 minute' WHERE user_id=$1`, id, maxPinFailures); err != nil {
		t.Fatal(err)
	}
	if err := ps.Verify(context.Background(), id, lockoutTestPIN); err != nil {
		t.Fatalf("correct PIN after the lock expired: %v", err)
	}
	if failed, locked := pinState(t, pool, id); failed != 0 || locked {
		t.Fatalf("after success failed=%d locked=%v, want 0/false", failed, locked)
	}
}

func TestPinLockoutLiveDB_NotSetFailsClosed(t *testing.T) {
	pool := liveDBPool(t)
	ps := newPinStore(pool)
	id := uuid.New().String()
	if _, err := pool.Exec(context.Background(), `INSERT INTO auth.users (id, email) VALUES ($1, $2)`, id, id+"@pin.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, id)
	if err := ps.Verify(context.Background(), id, lockoutTestPIN); !errors.Is(err, ErrPinNotSet) {
		t.Fatalf("err = %v, want ErrPinNotSet", err)
	}
}
