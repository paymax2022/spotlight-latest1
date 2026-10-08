package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func staging() Config {
	c := base(false)
	c.AppEnv = "staging"
	return c
}

func seed() string { return base64.StdEncoding.EncodeToString(make([]byte, 32)) }

func TestMocksAllowed_OnlyDevelopmentClass(t *testing.T) {
	for env, want := range map[string]bool{
		"": true, "development": true, "dev": true, "local": true, "test": true,
		"staging": false, "production": false, "prod": false,
	} {
		if got := (Config{AppEnv: env}).MocksAllowed(); got != want {
			t.Errorf("MocksAllowed(%q)=%v want %v", env, got, want)
		}
	}
}

func TestValidate_BankTransfersDoNotNeedMonnifyWithPaystackDefault(t *testing.T) {
	c := base(true)
	c.FeatureBankTransfersEnabled = true
	c.PaystackSecretKey = "sk_live_fixture"
	c.TransferProviderDefault = "paystack"
	if err := c.Validate(); err != nil {
		t.Fatalf("paystack-default bank transfers must not require Monnify: %v", err)
	}
	c.TransferProviderDefault = "monnify"
	if err := c.Validate(); err == nil {
		t.Fatal("monnify as default provider must still require MONNIFY_SECRET_KEY")
	}
}

func TestValidate_StagingIsFatalOnMockOrMissingSecret(t *testing.T) {
	cases := map[string]func(*Config){
		"associations": func(c *Config) { c.FeatureAssociationsEnabled = true },
		"arena":        func(c *Config) { c.FeatureArenaEnabled = true },
		"maps":         func(c *Config) { c.FeatureMapsEnabled = true },
		"transport":    func(c *Config) { c.FeatureTransportEnabled = true; c.MapsGoogleKey = "AIza-real" },
		"wallet":       func(c *Config) { c.FeatureWalletEnabled = true },
		"academy":      func(c *Config) { c.FeatureAcademyEnabled = true; c.RailsMode = "fake" },
		"crypto":       func(c *Config) { c.FeatureCryptoEnabled = true; c.CryptoProvider = "mock" },
	}
	for name, mutate := range cases {
		c := staging()
		mutate(&c)
		if err := c.Validate(); err == nil {
			t.Errorf("%s: staging with a mock/missing secret must fail", name)
		}
	}
}

func TestValidate_StagingPassesWhenRealAndConfigured(t *testing.T) {
	c := staging()
	c.FeatureAssociationsEnabled, c.AssocCardSigningSecret = true, "assoc-secret-real"
	c.FeatureArenaEnabled, c.ArenaSigningSeedTheory = true, seed()
	c.FeatureMapsEnabled, c.FeatureTransportEnabled, c.MapsGoogleKey = true, true, "AIza-real"
	c.FeatureWalletEnabled, c.FeatureBankTransfersEnabled, c.PaystackSecretKey = true, true, "sk_test_fixture"
	c.FeatureAcademyEnabled, c.RailsMode = true, "live"
	c.FeatureCryptoEnabled, c.CryptoProvider, c.CryptoQuidaxTestKey, c.CryptoQuidaxTestBaseURL = true, "quidax", "qk_real", "https://app.quidax.io/api/v1"
	if err := c.Validate(); err != nil {
		t.Fatalf("fully configured staging must pass: %v", err)
	}
}

func TestValidate_DevStillAllowsMocksAndMissingSecrets(t *testing.T) {
	c := base(false)
	c.FeatureAssociationsEnabled, c.FeatureArenaEnabled, c.FeatureMapsEnabled = true, true, true
	c.FeatureTransportEnabled, c.FeatureAcademyEnabled, c.FeatureCryptoEnabled = true, true, true
	c.RailsMode, c.CryptoProvider = "fake", "mock"
	if err := c.Validate(); err != nil {
		t.Fatalf("development must keep running on mocks: %v", err)
	}
}

func TestValidate_StagingErrorNamesTheProblem(t *testing.T) {
	c := staging()
	c.FeatureAssociationsEnabled = true
	err := c.Validate()
	if err == nil || !strings.Contains(err.Error(), "ASSOC_CARD_SIGNING_SECRET") {
		t.Fatalf("error should name the missing secret, got: %v", err)
	}
}
