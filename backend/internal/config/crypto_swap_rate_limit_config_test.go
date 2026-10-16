package config

import (
	"strings"
	"testing"
)

func TestLoad_SwapRateLimitDefaults(t *testing.T) {
	t.Setenv("CRYPTO_QUOTE_RATE_PER_MIN", "")
	t.Setenv("CRYPTO_CONFIRM_RATE_PER_MIN", "")
	c := Load()
	if c.CryptoQuoteRatePerMin != 20 || c.CryptoConfirmRatePerMin != 5 {
		t.Fatalf("defaults = quote %d confirm %d, want 20 / 5", c.CryptoQuoteRatePerMin, c.CryptoConfirmRatePerMin)
	}
	t.Setenv("CRYPTO_QUOTE_RATE_PER_MIN", "40")
	t.Setenv("CRYPTO_CONFIRM_RATE_PER_MIN", "8")
	c = Load()
	if c.CryptoQuoteRatePerMin != 40 || c.CryptoConfirmRatePerMin != 8 {
		t.Fatalf("env not read: quote %d confirm %d", c.CryptoQuoteRatePerMin, c.CryptoConfirmRatePerMin)
	}
}

// PerUserRateLimit silently turns a limit <= 0 into 60/min, so a 0 or negative
// value would loosen the budget instead of tightening it. With the swap pipeline
// on, refuse to boot on such values rather than guess.
func TestValidate_SwapRateLimitsAreBounded(t *testing.T) {
	good := func() Config {
		c := staging()
		c.FeatureCryptoEnabled, c.CryptoProvider = true, "quidax"
		c.CryptoQuidaxTestKey, c.CryptoQuidaxTestBaseURL = "qk_real", "https://openapi.quidax.io/exchange-open-api/api/v1"
		c.FeatureCryptoSwapsEnabled, c.CryptoWebhookSecret, c.CryptoLockPoolConns = true, "whsec_real", 40
		c.CryptoQuoteRatePerMin, c.CryptoConfirmRatePerMin = 20, 5
		return c
	}
	if err := good().Validate(); err != nil {
		t.Fatalf("a fully configured staging must pass: %v", err)
	}
	for name, mutate := range map[string]func(*Config){
		"zero quote rate":     func(c *Config) { c.CryptoQuoteRatePerMin = 0 },
		"negative confirm":    func(c *Config) { c.CryptoConfirmRatePerMin = -1 },
		"zero confirm rate":   func(c *Config) { c.CryptoConfirmRatePerMin = 0 },
		"absurd quote rate":   func(c *Config) { c.CryptoQuoteRatePerMin = 100_000 },
		"absurd confirm rate": func(c *Config) { c.CryptoConfirmRatePerMin = 100_000 },
	} {
		c := good()
		mutate(&c)
		err := c.Validate()
		if err == nil {
			t.Errorf("%s: accepted", name)
		} else if !strings.Contains(err.Error(), "RATE_PER_MIN") {
			t.Errorf("%s: error does not name the setting: %v", name, err)
		}
	}
}

// Boundaries of the accepted range: 1 and 600 pass, 0 and 601 do not.
func TestValidate_SwapRateLimitBoundaries(t *testing.T) {
	base := func() Config {
		c := staging()
		c.FeatureCryptoEnabled, c.CryptoProvider = true, "quidax"
		c.CryptoQuidaxTestKey, c.CryptoQuidaxTestBaseURL = "qk_real", "https://openapi.quidax.io/exchange-open-api/api/v1"
		c.FeatureCryptoSwapsEnabled, c.CryptoWebhookSecret, c.CryptoLockPoolConns = true, "whsec_real", 40
		c.CryptoQuoteRatePerMin, c.CryptoConfirmRatePerMin = 20, 5
		return c
	}
	for _, tc := range []struct {
		v    int
		want bool // accepted
	}{{0, false}, {1, true}, {600, true}, {601, false}} {
		for name, set := range map[string]func(*Config){
			"quote":   func(c *Config) { c.CryptoQuoteRatePerMin = tc.v },
			"confirm": func(c *Config) { c.CryptoConfirmRatePerMin = tc.v },
		} {
			c := base()
			set(&c)
			if got := c.Validate() == nil; got != tc.want {
				t.Errorf("%s=%d: accepted=%v, want %v", name, tc.v, got, tc.want)
			}
		}
	}
}
