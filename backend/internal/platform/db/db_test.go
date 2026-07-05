package db_test

import (
	"context"
	"testing"

	"spotlight/backend/internal/platform/db"
)

func TestNew_InvalidDSN_Rejects(t *testing.T) {
	_, err := db.New(context.Background(), "not-a-valid-dsn")
	if err == nil {
		t.Fatal("expected error for invalid DSN, got nil")
	}
}

func TestNew_MalformedScheme_Rejects(t *testing.T) {
	_, err := db.New(context.Background(), "mysql://user:pass@host/db")
	if err == nil {
		t.Fatal("expected error for non-postgres DSN, got nil")
	}
}

func TestNew_ValidDSN_ParsesWithoutConnect(t *testing.T) {
	// pgxpool.New is lazy — a well-formed DSN that points to a non-existent host
	// should succeed at parse time. Ping would fail, but New should not.
	pool, err := db.New(context.Background(), "postgres://user:pass@localhost:5432/testdb")
	if err != nil {
		t.Fatalf("expected no error for well-formed DSN, got: %v", err)
	}
	pool.Close()
}
