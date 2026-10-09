package dbutil_test

import (
	"errors"
	"fmt"
	"testing"
	"time"

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
		{"23514", dbutil.IsCheckViolation},
		{"23503", dbutil.IsForeignKeyViolation},
	}
	for _, tc := range cases {
		if !tc.fn(pgErr(tc.code)) {
			t.Fatalf("code %s not detected", tc.code)
		}
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

func TestDerefHelpers(t *testing.T) {
	if got := dbutil.DerefString(nil); got != "" {
		t.Fatalf("DerefString(nil) = %q", got)
	}
	s := "hi"
	if got := dbutil.DerefString(&s); got != "hi" {
		t.Fatalf("DerefString(&hi) = %q", got)
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
