// Package dbutil holds the Postgres-facing helpers that were copy-pasted
// across internal modules: empty-to-NULL converters for optional columns and
// SQLSTATE classification for the pgx error chain.
//
// The Null* family exists because optional text/uuid/timestamp columns must
// store SQL NULL — never the zero value — so inserts do not fail uuid parsing
// or leak empty strings into NOT NULL-adjacent fields.
package dbutil

import (
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// sqlStater is implemented by pgconn.PgError and driver adapters that expose
// the Postgres SQLSTATE code.
type sqlStater interface {
	SQLState() string
}

// SQLState extracts the SQLSTATE code from anywhere in the error chain —
// covering pgconn.PgError (pgx), pq-style drivers, and wrapped errors.
// Returns "" when the chain carries no state.
func SQLState(err error) string {
	var ss sqlStater
	if errors.As(err, &ss) {
		return ss.SQLState()
	}
	if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok {
		return pgErr.Code
	}
	return ""
}

// IsUniqueViolation reports SQLSTATE 23505 — unique_violation. Use it to make
// "insert that may already exist" paths idempotent instead of erroring.
func IsUniqueViolation(err error) bool {
	return SQLState(err) == "23505"
}

// IsForeignKeyViolation reports SQLSTATE 23503 — foreign_key_violation.
func IsForeignKeyViolation(err error) bool {
	return SQLState(err) == "23503"
}

// IsCheckViolation reports SQLSTATE 23514 — check_violation.
func IsCheckViolation(err error) bool {
	return SQLState(err) == "23514"
}

// IsNotNullViolation reports SQLSTATE 23502 — not_null_violation.
func IsNotNullViolation(err error) bool {
	return SQLState(err) == "23502"
}

// IsSerializationFailure reports SQLSTATE 40001 — retry-able under
// SERIALIZABLE or explicit locking contention.
func IsSerializationFailure(err error) bool {
	return SQLState(err) == "40001"
}

// IsDeadlock reports SQLSTATE 40P01 — retry-able deadlock detection.
func IsDeadlock(err error) bool {
	return SQLState(err) == "40P01"
}

// IsRetryable reports whether err is a transient conflict worth one retry:
// serialization failure or deadlock.
func IsRetryable(err error) bool {
	return IsSerializationFailure(err) || IsDeadlock(err)
}

// IsNoRows reports whether err wraps pgx.ErrNoRows — the canonical "not found"
// for QueryRow paths. Modules previously compared with == which breaks under
// fmt.Errorf("%w") wrapping.
func IsNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}

// NullStr maps "" to nil so optional text/varchar columns store SQL NULL.
func NullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// NullUUID maps "" to nil so optional uuid columns store NULL instead of
// failing uuid parsing on insert. Non-empty values pass through verbatim.
func NullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// NullTime maps the zero Time to nil for optional timestamptz columns.
func NullTime(t time.Time) any {
	if t.IsZero() {
		return nil
	}
	return t
}

// NullInt maps 0 to nil for optional integer columns where 0 is "unset".
// Prefer the NullIntP pointer variant when 0 is a legitimate stored value.
func NullInt(v int64) any {
	if v == 0 {
		return nil
	}
	return v
}

// NullIntP maps a nil pointer to nil, else dereferences — the safe form for
// columns where 0 is meaningful.
func NullIntP(v *int64) any {
	if v == nil {
		return nil
	}
	return *v
}

// NullStrP dereferences a *string or yields nil — for nullable text columns
// scanned into pointers.
func NullStrP(s *string) any {
	if s == nil || *s == "" {
		return nil
	}
	return *s
}

// DerefString reads a scanned *string column into a plain string.
func DerefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// DerefInt reads a scanned *int64 column into a plain int64.
func DerefInt(v *int64) int64 {
	if v == nil {
		return 0
	}
	return *v
}

// DerefTime reads a scanned *time.Time column into a plain Time.
func DerefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

// StrPtr returns a *string or nil for empty — inverse of DerefString, for
// request DTOs that keep optional fields as pointers.
func StrPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// IntPtr returns a *int64 or nil for 0 — inverse of DerefInt.
func IntPtr(v int64) *int64 {
	if v == 0 {
		return nil
	}
	return &v
}

// Retry runs fn up to attempts times, retrying only when the error is a
// transient Postgres conflict (serialization failure or deadlock). It is the
// extracted form of the hand-rolled retry loops around ledger and settlement
// writes. attempts <= 1 runs exactly once.
func Retry(attempts int, fn func() error) error {
	var err error
	for range attempts {
		if err = fn(); err == nil || !IsRetryable(err) {
			return err
		}
	}
	return err
}

// NullFloat maps NaN to nil — optional float columns must never receive NaN
// (Postgres accepts it, aggregates then poison). Keep money in integer kobo;
// this exists for non-money floats (rates, coordinates) only.
func NullFloat(f float64) any {
	if f != f { // NaN
		return nil
	}
	return f
}

// NullBoolP maps a nil *bool to nil, else the value — tri-state columns where
// NULL means "not yet decided" and false is a real answer.
func NullBoolP(b *bool) any {
	if b == nil {
		return nil
	}
	return *b
}

// KV joins a set of optional/conditional parts for dynamic WHERE-less
// debug strings — prefer parameterized queries; this exists only for log
// lines that need a compact "k=v" rendering.
func KV(pairs ...string) string {
	return strings.Join(pairs, " ")
}
