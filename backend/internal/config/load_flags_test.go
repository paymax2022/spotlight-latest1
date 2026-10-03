package config

// Flag-loading tests for the env knobs added by the audit fixes:
//   - FEATURE_CONNECT_ENABLED presence (E2E-SEC-064): unset vs set matters —
//     FeatureConnectFlagSet distinguishes "absent" from "explicitly false".
//   - SCHEDULER_ENABLED / SCHEDULER_POLL_INTERVAL_SECONDS (E2E-BE-005).
//   - REDIS_REQUIRED (E2E-FR-050).

import (
	"os"
	"testing"
)

// withEnvUnset removes key for the duration of the test and restores it after,
// so the "unset" case is real even when the ambient env happens to set it.
func withEnvUnset(t *testing.T, key string) {
	t.Helper()
	if v, ok := os.LookupEnv(key); ok {
		t.Cleanup(func() { t.Setenv(key, v) })
	}
	_ = os.Unsetenv(key)
}

func TestLoad_ConnectFlagPresence(t *testing.T) {
	t.Run("unset", func(t *testing.T) {
		withEnvUnset(t, "FEATURE_CONNECT_ENABLED")
		cfg := Load()
		if cfg.FeatureConnectFlagSet {
			t.Error("FeatureConnectFlagSet = true with FEATURE_CONNECT_ENABLED unset")
		}
		if cfg.FeatureConnectEnabled {
			t.Error("FeatureConnectEnabled = true with the flag unset")
		}
	})
	t.Run("explicitly false", func(t *testing.T) {
		t.Setenv("FEATURE_CONNECT_ENABLED", "false")
		cfg := Load()
		if !cfg.FeatureConnectFlagSet {
			t.Error("FeatureConnectFlagSet = false with the flag explicitly set")
		}
		if cfg.FeatureConnectEnabled {
			t.Error("FeatureConnectEnabled = true for FEATURE_CONNECT_ENABLED=false")
		}
	})
	t.Run("explicitly true", func(t *testing.T) {
		t.Setenv("FEATURE_CONNECT_ENABLED", "true")
		cfg := Load()
		if !cfg.FeatureConnectFlagSet || !cfg.FeatureConnectEnabled {
			t.Errorf("flag=true parsed as set=%v enabled=%v", cfg.FeatureConnectFlagSet, cfg.FeatureConnectEnabled)
		}
	})
	t.Run("explicit empty counts as unset", func(t *testing.T) {
		t.Setenv("FEATURE_CONNECT_ENABLED", "")
		cfg := Load()
		if cfg.FeatureConnectFlagSet {
			t.Error("FeatureConnectFlagSet = true for an empty FEATURE_CONNECT_ENABLED")
		}
	})
}

func TestLoad_SchedulerDefaults(t *testing.T) {
	withEnvUnset(t, "SCHEDULER_ENABLED")
	withEnvUnset(t, "SCHEDULER_POLL_INTERVAL_SECONDS")
	cfg := Load()
	if !cfg.SchedulerEnabled {
		t.Error("SchedulerEnabled = false by default — the poller is the only drain for scheduler_jobs")
	}
	if cfg.SchedulerPollIntervalSeconds != 5 {
		t.Errorf("SchedulerPollIntervalSeconds = %d, want 5", cfg.SchedulerPollIntervalSeconds)
	}
}

func TestLoad_SchedulerExplicitlyDisabled(t *testing.T) {
	t.Setenv("SCHEDULER_ENABLED", "false")
	t.Setenv("SCHEDULER_POLL_INTERVAL_SECONDS", "30")
	cfg := Load()
	if cfg.SchedulerEnabled {
		t.Error("SchedulerEnabled = true for SCHEDULER_ENABLED=false")
	}
	if cfg.SchedulerPollIntervalSeconds != 30 {
		t.Errorf("SchedulerPollIntervalSeconds = %d, want 30", cfg.SchedulerPollIntervalSeconds)
	}
}

func TestLoad_RedisRequiredDefaultsOff(t *testing.T) {
	withEnvUnset(t, "REDIS_REQUIRED")
	if cfg := Load(); cfg.RedisRequired {
		t.Error("RedisRequired = true by default — Redis is optional unless operators opt in")
	}
	t.Setenv("REDIS_REQUIRED", "true")
	if cfg := Load(); !cfg.RedisRequired {
		t.Error("RedisRequired = false for REDIS_REQUIRED=true")
	}
}
