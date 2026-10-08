package db_test

import (
	"context"
	"testing"
	"time"

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

func TestNew_EnvOverrides_Apply(t *testing.T) {
	// pgxpool.New is lazy, so a pool against an unreachable host still exposes
	// the parsed config — no live DB needed.
	t.Setenv("DB_POOL_MAX_CONNS", "24")
	t.Setenv("DB_POOL_MIN_CONNS", "2")
	t.Setenv("DB_CONNECT_TIMEOUT", "5s")

	pool, err := db.New(context.Background(), "postgres://user:pass@localhost:5432/testdb")
	if err != nil {
		t.Fatalf("expected no error with env overrides, got: %v", err)
	}
	defer pool.Close()

	if got := pool.Config().MaxConns; got != 24 {
		t.Errorf("MaxConns = %d, want 24 (DB_POOL_MAX_CONNS)", got)
	}
	if got := pool.Config().MinConns; got != 2 {
		t.Errorf("MinConns = %d, want 2 (DB_POOL_MIN_CONNS)", got)
	}
	if got := pool.Config().ConnConfig.ConnectTimeout; got != 5*time.Second {
		t.Errorf("ConnectTimeout = %v, want 5s (DB_CONNECT_TIMEOUT)", got)
	}
}

func TestNew_EnvOverrides_InvalidValuesFail(t *testing.T) {
	cases := []struct {
		env   string
		value string
	}{
		{"DB_POOL_MAX_CONNS", "banana"},
		{"DB_POOL_MAX_CONNS", "0"},
		{"DB_POOL_MIN_CONNS", "-1"},
		{"DB_CONNECT_TIMEOUT", "not-a-duration"},
		{"DB_STATEMENT_TIMEOUT_MS", "-500"},
		{"DB_IDLE_TX_TIMEOUT_MS", "abc"},
	}
	for _, tc := range cases {
		t.Run(tc.env+"="+tc.value, func(t *testing.T) {
			t.Setenv(tc.env, tc.value)
			if _, err := db.New(context.Background(), "postgres://user:pass@localhost:5432/testdb"); err == nil {
				t.Fatalf("expected error for %s=%q, got nil", tc.env, tc.value)
			}
		})
	}
}

func TestNew_EnvOverrides_TimeoutsBuildPool(t *testing.T) {
	// Statement/idle-tx timeouts are applied inside AfterConnect, so they can't
	// be observed on a lazy pool — but an invalid SET would fail connect. Here we
	// only assert the pool still builds with them set.
	t.Setenv("DB_STATEMENT_TIMEOUT_MS", "15000")
	t.Setenv("DB_IDLE_TX_TIMEOUT_MS", "10000")

	pool, err := db.New(context.Background(), "postgres://user:pass@localhost:5432/testdb")
	if err != nil {
		t.Fatalf("expected no error with timeout envs set, got: %v", err)
	}
	pool.Close()
}
