package config

import "testing"

// Railway holds the Quidax key as QUIDAX_API_KEY; the config historically read only
// QUIDAX_TEST_API_KEY / QUIDAX_LIVE_API_KEY, so the deployed key was ignored.
func TestLoad_QuidaxKeyEnvNames(t *testing.T) {
	clear := func(t *testing.T) {
		for _, k := range []string{"QUIDAX_API_KEY", "QUIDAX_TEST_API_KEY", "QUIDAX_LIVE_API_KEY"} {
			t.Setenv(k, "")
		}
	}
	t.Run("plain QUIDAX_API_KEY feeds the TEST slot only", func(t *testing.T) {
		clear(t)
		t.Setenv("QUIDAX_API_KEY", "plain")
		cfg := Load()
		if cfg.CryptoQuidaxTestKey != "plain" {
			t.Fatalf("test key = %q, want the QUIDAX_API_KEY value", cfg.CryptoQuidaxTestKey)
		}
		if cfg.CryptoQuidaxLiveKey != "" {
			t.Fatal("an unlabeled key must never become the LIVE key")
		}
	})
	t.Run("explicit names win over the plain one", func(t *testing.T) {
		clear(t)
		t.Setenv("QUIDAX_API_KEY", "plain")
		t.Setenv("QUIDAX_TEST_API_KEY", "explicit-test")
		t.Setenv("QUIDAX_LIVE_API_KEY", "explicit-live")
		cfg := Load()
		if cfg.CryptoQuidaxTestKey != "explicit-test" || cfg.CryptoQuidaxLiveKey != "explicit-live" {
			t.Fatalf("got test=%q live=%q", cfg.CryptoQuidaxTestKey, cfg.CryptoQuidaxLiveKey)
		}
	})
}
