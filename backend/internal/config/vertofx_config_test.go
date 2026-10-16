package config

import "testing"

func TestLoad_VertoFXAndDefaultProvider(t *testing.T) {
	keys := []string{"VERTOFX_CLIENT_ID", "VERTOFX_API_KEY", "VERTOFX_PROD", "VERTOFX_WEBHOOK_SECRET", "VERTOFX_BASE_URL", "FEATURE_VERTOFX", "FX_DEFAULT_PROVIDER"}
	t.Run("set", func(t *testing.T) {
		t.Setenv("VERTOFX_CLIENT_ID", "cid")
		t.Setenv("VERTOFX_API_KEY", "key")
		t.Setenv("VERTOFX_PROD", "true")
		t.Setenv("VERTOFX_WEBHOOK_SECRET", "whsec")
		t.Setenv("VERTOFX_BASE_URL", "http://localhost:9")
		t.Setenv("FEATURE_VERTOFX", "true")
		t.Setenv("FX_DEFAULT_PROVIDER", "vertofx")
		c := Load()
		if c.VertoFXClientID != "cid" || c.VertoFXAPIKey != "key" || !c.VertoFXProd ||
			c.VertoFXWebhookSecret != "whsec" || c.VertoFXBaseURL != "http://localhost:9" ||
			!c.FeatureVertoFXEnabled || c.FXDefaultProvider != "vertofx" {
			t.Fatalf("fields not populated: %+v", c.FXDefaultProvider)
		}
	})
	t.Run("unset", func(t *testing.T) {
		for _, k := range keys {
			t.Setenv(k, "")
		}
		c := Load()
		if c.FeatureVertoFXEnabled || c.FXDefaultProvider != "" || c.VertoFXProd {
			t.Fatal("defaults must be off/empty")
		}
	})
}

func TestLoad_SpotlightGlobalFlagDefaultsOff(t *testing.T) {
	t.Setenv("FEATURE_SPOTLIGHT_GLOBAL", "")
	if Load().FeatureSpotlightGlobalEnabled {
		t.Fatal("FEATURE_SPOTLIGHT_GLOBAL must default to off")
	}
	t.Setenv("FEATURE_SPOTLIGHT_GLOBAL", "true")
	if !Load().FeatureSpotlightGlobalEnabled {
		t.Fatal("FEATURE_SPOTLIGHT_GLOBAL=true must enable")
	}
}

func TestValidate_VertoFXBaseURLForbiddenWhenProd(t *testing.T) {
	c := base(true)
	c.VertoFXProd = true
	c.VertoFXBaseURL = "http://evil.example"
	if err := c.Validate(); err == nil {
		t.Fatal("VERTOFX_BASE_URL with VERTOFX_PROD=true must fail")
	}
	c.VertoFXBaseURL = ""
	if err := c.Validate(); err != nil {
		t.Fatalf("prod without base URL override must pass, got: %v", err)
	}
}
