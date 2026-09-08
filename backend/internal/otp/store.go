package otp

import (
	"context"
	"time"
)

// Record is one live code. The plaintext code is not part of it and never
// reaches storage.
type Record struct {
	Hash      string
	Purpose   string
	Attempts  int
	CreatedAt time.Time
	ExpiresAt time.Time
}

// Store is the persistence seam. The implementation is authoritative for
// single-use and for the attempt ceiling, which is why Consume and
// IncrementAttempts are defined as atomic operations rather than as a read
// followed by a write in the service.
type Store interface {
	Put(ctx context.Context, key string, r Record, ttl time.Duration) error
	Get(ctx context.Context, key string) (Record, error)

	// Consume atomically deletes the record if, and only if, it still exists,
	// still matches codeHash, has not expired and is under maxAttempts. It
	// reports whether it removed a row.
	//
	// This is the whole of the single-use guarantee. Checking the hash in the
	// service and then deleting would leave a window in which two concurrent
	// submissions of the same correct code both pass — an OTP that can be
	// replayed, which is the property the mechanism exists to provide.
	Consume(ctx context.Context, key, codeHash string, maxAttempts int) (bool, error)

	// IncrementAttempts atomically bumps and returns the new count. Two
	// simultaneous wrong guesses must produce 1 and 2, never 1 and 1 — the
	// second is how an attempt ceiling is escaped under concurrency.
	IncrementAttempts(ctx context.Context, key string) (int, error)

	Delete(ctx context.Context, key string) error

	// DeleteExpired removes at most limit expired rows. Postgres has no TTL, so
	// something has to sweep; expiry is nonetheless enforced on read, so a sweep
	// that never runs cannot make a stale code usable.
	DeleteExpired(ctx context.Context, limit int) (int64, error)
}

// Limiter is the rate-limit seam. Allow increments a fixed-window counter and
// reports whether the caller is still inside the budget.
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error)
}
