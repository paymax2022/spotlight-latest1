package dbutil_test

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"spotlight/backend/go-common/dbutil"
)

func pgErr(code string) error {
	return &pgconn.PgError{Code: code}
}

func TestSQLState(t *testing.T) {
	if got := dbutil.SQLState(pgErr("23505")); got != "23505" {
		t.Fatalf("SQLState = %q", got)
	}
	wrapped := fmt.Errorf("insert: %w", pgErr("23503"))
	if got := dbutil.SQLState(wrapped); got != "23503" {
		t.Fatalf("SQLState wrapped = %q", got)
	}
	if got := dbutil.SQLState(errors.New("plain")); got != "" {
		t.Fatalf("SQLState plain = %q, want empty", got)
	}
}

func TestIsUniqueViolation(t *testing.T) {
	if !dbutil.IsUniqueViolation(pgErr("23505")) {
		t.Fatal("23505 should be unique violation")
	}
	if dbutil.IsUniqueViolation(pgErr("23503")) {
		t.Fatal("23503 should not be unique violation")
	}
	if dbutil.IsUniqueViolation(errors.New("x")) {
		t.Fatal("plain err should not be unique violation")
	}
}

func TestSQLStateFamily(t *testing.T) {
	cases := []struct {
		code string
		fn   func(error) bool
	}{
		{"23503", dbutil.IsForeignKeyViolation},
		{"23514", dbutil.IsCheckViolation},
		{"23502", dbutil.IsNotNullViolation},
		{"40001", dbutil.IsSerializationFailure},
		{"40P01", dbutil.IsDeadlock},
	}
	for _, tc := range cases {
		if !tc.fn(pgErr(tc.code)) {
			t.Fatalf("code %s not detected", tc.code)
		}
	}
}

func TestIsRetryable(t *testing.T) {
	if !dbutil.IsRetryable(pgErr("40001")) || !dbutil.IsRetryable(pgErr("40P01")) {
		t.Fatal("serialization/deadlock must be retryable")
	}
	if dbutil.IsRetryable(pgErr("23505")) {
		t.Fatal("unique violation is not retryable")
	}
}

func TestIsNoRows(t *testing.T) {
	if !dbutil.IsNoRows(pgx.ErrNoRows) {
		t.Fatal("pgx.ErrNoRows not detected")
	}
	if !dbutil.IsNoRows(fmt.Errorf("q: %w", pgx.ErrNoRows)) {
		t.Fatal("wrapped ErrNoRows not detected")
	}
	if dbutil.IsNoRows(errors.New("other")) {
		t.Fatal("other err falsely detected")
	}
}

func TestNullStr(t *testing.T) {
	if dbutil.NullStr("") != nil {
		t.Fatal("NullStr(\"\") must be nil")
	}
	if dbutil.NullStr("x") != "x" {
		t.Fatal("NullStr passthrough failed")
	}
}

func TestNullUUID(t *testing.T) {
	if dbutil.NullUUID("") != nil {
		t.Fatal("NullUUID(\"\") must be nil")
	}
	if dbutil.NullUUID("abc") != "abc" {
		t.Fatal("NullUUID passthrough failed")
	}
}

func TestNullTime(t *testing.T) {
	if dbutil.NullTime(time.Time{}) != nil {
		t.Fatal("zero time must be nil")
	}
	now := time.Now()
	if dbutil.NullTime(now) != now {
		t.Fatal("non-zero time passthrough failed")
	}
}

func TestNullInt(t *testing.T) {
	if dbutil.NullInt(0) != nil {
		t.Fatal("NullInt(0) must be nil")
	}
	if dbutil.NullInt(7) != int64(7) {
		t.Fatal("NullInt(7) failed")
	}
}

func TestNullIntP(t *testing.T) {
	var p *int64
	if dbutil.NullIntP(p) != nil {
		t.Fatal("nil ptr must be nil")
	}
	v := int64(0)
	if dbutil.NullIntP(&v) != int64(0) {
		t.Fatal("ptr to 0 must deref to 0 — NullIntP preserves legitimate zeros")
	}
}

func TestDerefHelpers(t *testing.T) {
	if got := dbutil.DerefString(nil); got != "" {
		t.Fatalf("DerefString(nil) = %q", got)
	}
	s := "hi"
	if got := dbutil.DerefString(&s); got != "hi" {
		t.Fatalf("DerefString(&hi) = %q", got)
	}
	if got := dbutil.DerefInt(nil); got != 0 {
		t.Fatalf("DerefInt(nil) = %d", got)
	}
	if got := dbutil.DerefTime(nil); !got.IsZero() {
		t.Fatal("DerefTime(nil) must be zero")
	}
}

func TestStrPtr(t *testing.T) {
	if dbutil.StrPtr("") != nil {
		t.Fatal("StrPtr(\"\") must be nil")
	}
	p := dbutil.StrPtr("x")
	if p == nil || *p != "x" {
		t.Fatal("StrPtr(x) failed")
	}
}

func TestRetry(t *testing.T) {
	calls := 0
	err := dbutil.Retry(3, func() error {
		calls++
		if calls < 3 {
			return pgErr("40001")
		}
		return nil
	})
	if err != nil || calls != 3 {
		t.Fatalf("Retry: calls=%d err=%v", calls, err)
	}

	calls = 0
	err = dbutil.Retry(3, func() error {
		calls++
		return pgErr("23505") // not retryable → immediate
	})
	if calls != 1 {
		t.Fatalf("non-retryable err retried: calls=%d", calls)
	}
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNullFloatNaN(t *testing.T) {
	if dbutil.NullFloat(1.5) != 1.5 {
		t.Fatal("normal float passthrough")
	}
	var z float64
	if dbutil.NullFloat(z/z) != nil {
		t.Fatal("NaN must map to nil")
	}
}
