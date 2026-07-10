package config

import "testing"

// TestLoad verifies Load() populates every field from the environment.
func TestLoad(t *testing.T) {
	env := map[string]string{
		"PORT":                    "9090",
		"DATABASE_URL":            "postgres://localhost/trading",
		"SUPABASE_JWT_SECRET":     "jwt-secret",
		"SUPABASE_JWKS_URL":       "https://example.com/jwks",
		"ALLOW_DEV_AUTH":          "true",
		"TRUST_ADMIN_ROLE_HEADER": "true",
		"CORS_ALLOW_ORIGINS":      "https://app.example.com,https://admin.example.com",
		"RATE_LIMIT_RPS":          "125",
		"CRYPTO_WEBHOOK_SECRET":   "whsec",
		"LEDGER_BACKEND":          "http",
		"LEDGER_BASE_URL":         "https://ledger.example.com",
		"LEDGER_SERVICE_TOKEN":    "svc-token",
		"PROVIDER":                "http",
		"PROVIDER_BASE_URL":       "https://provider.example.com",
		"PROVIDER_API_KEY":        "prov-key",
		"ALPACA_BASE_URL":         "https://paper-api.alpaca.markets",
		"ALPACA_API_KEY":          "alpaca-key",
		"ALPACA_API_SECRET":       "alpaca-secret",
		"QUIDAX_BASE_URL":         "https://www.quidax.com/api/v1",
		"QUIDAX_API_KEY":          "quidax-key",
		"QUIDAX_API_SECRET":       "quidax-secret",
	}
	for k, v := range env {
		t.Setenv(k, v)
	}

	c := Load()

	if c.Port != "9090" {
		t.Errorf("Port = %q, want 9090", c.Port)
	}
	if c.DatabaseURL != "postgres://localhost/trading" {
		t.Errorf("DatabaseURL = %q", c.DatabaseURL)
	}
	if c.SupabaseJWTSecret != "jwt-secret" {
		t.Errorf("SupabaseJWTSecret = %q", c.SupabaseJWTSecret)
	}
	if c.SupabaseJWKSURL != "https://example.com/jwks" {
		t.Errorf("SupabaseJWKSURL = %q", c.SupabaseJWKSURL)
	}
	if !c.AllowDevAuth {
		t.Error("AllowDevAuth = false, want true")
	}
	if !c.TrustAdminRoleHeader {
		t.Error("TrustAdminRoleHeader = false, want true")
	}
	if c.CORSAllowOrigins != "https://app.example.com,https://admin.example.com" {
		t.Errorf("CORSAllowOrigins = %q", c.CORSAllowOrigins)
	}
	if c.RateLimitRPS != 125 {
		t.Errorf("RateLimitRPS = %v, want 125", c.RateLimitRPS)
	}
	if c.CryptoWebhookSecret != "whsec" {
		t.Errorf("CryptoWebhookSecret = %q", c.CryptoWebhookSecret)
	}
	if c.LedgerBackend != "http" {
		t.Errorf("LedgerBackend = %q", c.LedgerBackend)
	}
	if c.LedgerBaseURL != "https://ledger.example.com" {
		t.Errorf("LedgerBaseURL = %q", c.LedgerBaseURL)
	}
	if c.LedgerServiceToken != "svc-token" {
		t.Errorf("LedgerServiceToken = %q", c.LedgerServiceToken)
	}
	if c.Provider != "http" {
		t.Errorf("Provider = %q", c.Provider)
	}
	if c.ProviderBaseURL != "https://provider.example.com" {
		t.Errorf("ProviderBaseURL = %q", c.ProviderBaseURL)
	}
	if c.ProviderAPIKey != "prov-key" {
		t.Errorf("ProviderAPIKey = %q", c.ProviderAPIKey)
	}
	if c.Alpaca.BaseURL != "https://paper-api.alpaca.markets" || c.Alpaca.APIKey != "alpaca-key" || c.Alpaca.APISecret != "alpaca-secret" {
		t.Errorf("Alpaca creds = %+v", c.Alpaca)
	}
	if c.Quidax.BaseURL != "https://www.quidax.com/api/v1" || c.Quidax.APIKey != "quidax-key" || c.Quidax.APISecret != "quidax-secret" {
		t.Errorf("Quidax creds = %+v", c.Quidax)
	}
}

// TestRateLimitDefault verifies the RATE_LIMIT_RPS default of 50 when unset.
func TestRateLimitDefault(t *testing.T) {
	c := Load()
	if c.RateLimitRPS != 50 {
		t.Errorf("default RateLimitRPS = %v, want 50", c.RateLimitRPS)
	}
}

// TestEnabled verifies Enabled() is true only when an API key is present.
func TestEnabled(t *testing.T) {
	if (ProviderCreds{}).Enabled() {
		t.Error("empty creds: Enabled() = true, want false")
	}
	if (ProviderCreds{BaseURL: "https://x", APISecret: "s"}).Enabled() {
		t.Error("no APIKey: Enabled() = true, want false")
	}
	if !(ProviderCreds{APIKey: "k"}).Enabled() {
		t.Error("with APIKey: Enabled() = false, want true")
	}
}
