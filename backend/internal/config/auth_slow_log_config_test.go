package config

import "testing"

func TestLoad_AuthSlowLogThreshold(t *testing.T) {
	t.Setenv("AUTH_SLOW_LOG_MS", "")
	if got := Load().AuthSlowLogMs; got != 750 {
		t.Fatalf("default = %d, want 750", got)
	}
	t.Setenv("AUTH_SLOW_LOG_MS", "2000")
	if got := Load().AuthSlowLogMs; got != 2000 {
		t.Fatalf("env not read: %d", got)
	}
	t.Setenv("AUTH_SLOW_LOG_MS", "0")
	if got := Load().AuthSlowLogMs; got != 0 {
		t.Fatalf("0 must be honoured (it turns the log off), got %d", got)
	}
}
