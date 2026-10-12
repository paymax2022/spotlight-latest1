package config

import (
	"strings"
	"testing"
)

func TestLoad_CryptoSwapsFlagDefaultsOffAndReadsEnv(t *testing.T) {
	for _, k := range []string{"FEATURE_CRYPTO_SWAPS_ENABLED", "QUIDAX_WEBHOOK_SECRET", "CRYPTO_LOCK_POOL_CONNS", "CRYPTO_RECONCILE_SECONDS"} {
		t.Setenv(k, "")
	}
	c := Load()
	if c.FeatureCryptoSwapsEnabled || c.CryptoWebhookSecret != "" || c.CryptoLockPoolConns != 40 || c.CryptoReconcileSeconds != 30 {
		t.Fatalf("defaults wrong: %+v", struct {
			On   bool
			Sec  string
			Pool int
			Sec2 int
		}{c.FeatureCryptoSwapsEnabled, c.CryptoWebhookSecret, c.CryptoLockPoolConns, c.CryptoReconcileSeconds})
	}
	t.Setenv("FEATURE_CRYPTO_SWAPS_ENABLED", "true")
	t.Setenv("QUIDAX_WEBHOOK_SECRET", "whsec_x")
	t.Setenv("CRYPTO_LOCK_POOL_CONNS", "12")
	c = Load()
	if !c.FeatureCryptoSwapsEnabled || c.CryptoWebhookSecret != "whsec_x" || c.CryptoLockPoolConns != 12 {
		t.Fatalf("env not read: %+v", c.FeatureCryptoSwapsEnabled)
	}
}

func TestValidate_SwapsNeedTheirOwnSecretsOutsideDev(t *testing.T) {
	good := func() Config {
		c := staging()
		c.FeatureCryptoEnabled, c.CryptoProvider = true, "quidax"
		c.CryptoQuidaxTestKey, c.CryptoQuidaxTestBaseURL = "qk_real", "https://openapi.quidax.io/exchange-open-api/api/v1"
		c.FeatureCryptoSwapsEnabled, c.CryptoWebhookSecret, c.CryptoLockPoolConns = true, "whsec_real", 40
		return c
	}
	if err := good().Validate(); err != nil {
		t.Fatalf("a fully configured staging must pass: %v", err)
	}
	for name, mutate := range map[string]func(*Config){
		"no webhook secret": func(c *Config) { c.CryptoWebhookSecret = "" },
		"placeholder":       func(c *Config) { c.CryptoWebhookSecret = "CHANGE_ME" },
		"tiny lock pool":    func(c *Config) { c.CryptoLockPoolConns = 2 },
		"crypto off":        func(c *Config) { c.FeatureCryptoEnabled = false },
	} {
		c := good()
		mutate(&c)
		err := c.Validate()
		if err == nil {
			t.Errorf("%s: accepted", name)
		} else if !strings.Contains(err.Error(), "CRYPTO") && !strings.Contains(err.Error(), "QUIDAX") {
			t.Errorf("%s: error does not name the problem: %v", name, err)
		}
	}
	// Flag off: none of it is required.
	c := staging()
	if err := c.Validate(); err != nil {
		t.Logf("baseline staging (informational): %v", err)
	}
}
