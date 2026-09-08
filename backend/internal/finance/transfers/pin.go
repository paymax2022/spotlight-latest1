package transfers

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// ---------------------------------------------------------------------------
// Transaction PIN — bcrypt-hashed second factor for money movement.
//
// Backed by user_transaction_pin (migration 20260819000000). bcrypt embeds its
// own salt, so the table needs only pin_hash (matches the locked schema). The
// raw PIN is never stored or logged. Lockout: maxPinFailures wrong attempts →
// locked for pinLockWindow. Every transfer initiate verifies the PIN
// fail-closed (a missing PIN, lock, or DB error all block the money path).
// ---------------------------------------------------------------------------

const (
	maxPinFailures = 5
	pinLockWindow  = 15 * time.Minute
)

// PinAttemptError carries how many tries remain before the lockout bites.
//
// Without it every wrong PIN looks identical to the customer, who then guesses
// their way into a 15-minute lock with no warning that they were one attempt
// away. errors.Is still matches the wrapped sentinel, so every existing status
// and code mapping is unaffected.
type PinAttemptError struct {
	Err       error
	Remaining int
}

func (e *PinAttemptError) Error() string { return e.Err.Error() }
func (e *PinAttemptError) Unwrap() error { return e.Err }

// pinStore wraps user_transaction_pin access.
type pinStore struct {
	db *pgxpool.Pool
}

func newPinStore(db *pgxpool.Pool) *pinStore { return &pinStore{db: db} }

func validPinFormat(pin string) bool {
	if len(pin) < 4 || len(pin) > 6 {
		return false
	}
	for _, c := range pin {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

type pinRow struct {
	Hash           string
	FailedAttempts int
	LockedUntil    *time.Time
}

func (p *pinStore) get(ctx context.Context, userID string) (*pinRow, error) {
	var r pinRow
	err := p.db.QueryRow(ctx,
		`SELECT pin_hash, failed_attempts, locked_until FROM user_transaction_pin WHERE user_id=$1`, userID).
		Scan(&r.Hash, &r.FailedAttempts, &r.LockedUntil)
	if err == pgx.ErrNoRows {
		return nil, ErrPinNotSet
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// Has reports whether a PIN exists for the user.
func (p *pinStore) Has(ctx context.Context, userID string) (bool, error) {
	_, err := p.get(ctx, userID)
	if err == ErrPinNotSet {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// Set creates or replaces the PIN (bcrypt) and resets lockout state.
func (p *pinStore) Set(ctx context.Context, userID, pin string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(pin), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO user_transaction_pin (user_id, pin_hash, failed_attempts, locked_until)
		VALUES ($1, $2, 0, NULL)
		ON CONFLICT (user_id) DO UPDATE
		SET pin_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now()`
	_, err = p.db.Exec(ctx, q, userID, string(hash))
	return err
}

// Verify checks the PIN fail-closed: not set / locked / wrong all return a typed
// error. A correct PIN resets failed_attempts; a wrong one increments it and
// locks the account at the threshold.
func (p *pinStore) Verify(ctx context.Context, userID, pin string) error {
	row, err := p.get(ctx, userID)
	if err != nil {
		return err // ErrPinNotSet or DB error (fail closed)
	}
	if row.LockedUntil != nil && row.LockedUntil.After(time.Now()) {
		return ErrPinLocked
	}
	if bcrypt.CompareHashAndPassword([]byte(row.Hash), []byte(pin)) == nil {
		_, _ = p.db.Exec(ctx,
			`UPDATE user_transaction_pin SET failed_attempts=0, locked_until=NULL, updated_at=now() WHERE user_id=$1`, userID)
		return nil
	}
	// Wrong PIN — record failure, lock at threshold.
	if row.FailedAttempts+1 >= maxPinFailures {
		_, _ = p.db.Exec(ctx,
			`UPDATE user_transaction_pin SET failed_attempts=$2, locked_until=$3, updated_at=now() WHERE user_id=$1`,
			userID, row.FailedAttempts+1, time.Now().Add(pinLockWindow))
		return ErrPinLocked
	}
	_, _ = p.db.Exec(ctx,
		`UPDATE user_transaction_pin SET failed_attempts=$2, updated_at=now() WHERE user_id=$1`, userID, row.FailedAttempts+1)
	return &PinAttemptError{Err: ErrPinInvalid, Remaining: maxPinFailures - (row.FailedAttempts + 1)}
}
