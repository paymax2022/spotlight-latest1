// Package config is the single, centralized place the trading service reads its
// runtime configuration from the environment. It replaces scattered os.Getenv
// calls (env-var sprawl) so the BACKEND drives which venue powers each module,
// and so no secret is ever hardcoded.
package config

import (
	"os"
	"strconv"
	"strings"
)

// ProviderCreds are a vendor's credentials, loaded from env (never hardcoded).
type ProviderCreds struct {
	BaseURL   string
	APIKey    string
	APISecret string
	// AccountID is the venue sub-account to act on. For Alpaca's Broker API each
	// end-user maps to an Alpaca account; until per-user provisioning lands, a
	// single sandbox account (ALPACA_ACCOUNT_ID) lets orders flow end-to-end.
	AccountID string
}

// Enabled reports whether the provider is configured (has an API key).
func (p ProviderCreds) Enabled() bool { return p.APIKey != "" }

// Config is the whole trading service configuration, loaded once from the
// environment. Provider keys live here (from env) so the BACKEND drives which
// venue powers each module — no secret is ever hardcoded.
type Config struct {
	Port                 string
	DatabaseURL          string
	SupabaseJWTSecret    string
	SupabaseJWKSURL      string
	AllowDevAuth         bool
	TrustAdminRoleHeader bool
	CORSAllowOrigins     string // raw comma list; empty => safe localhost default
	RateLimitRPS         float64
	CryptoWebhookSecret  string
	LedgerBackend        string
	LedgerBaseURL        string
	LedgerServiceToken   string
	Provider             string // generic httpadapter selector ("", "http")
	ProviderBaseURL      string
	ProviderAPIKey       string
	Alpaca               ProviderCreds // stocks brokerage + market data
	Quidax               ProviderCreds // crypto market data / liquidity / custody
}

// Load reads the configuration from the environment.
func Load() Config {
	return Config{
		Port:                 os.Getenv("PORT"),
		DatabaseURL:          os.Getenv("DATABASE_URL"),
		SupabaseJWTSecret:    os.Getenv("SUPABASE_JWT_SECRET"),
		SupabaseJWKSURL:      os.Getenv("SUPABASE_JWKS_URL"),
		AllowDevAuth:         os.Getenv("ALLOW_DEV_AUTH") == "true",
		TrustAdminRoleHeader: os.Getenv("TRUST_ADMIN_ROLE_HEADER") == "true",
		CORSAllowOrigins:     os.Getenv("CORS_ALLOW_ORIGINS"),
		RateLimitRPS:         envFloat("RATE_LIMIT_RPS", 50),
		CryptoWebhookSecret:  os.Getenv("CRYPTO_WEBHOOK_SECRET"),
		LedgerBackend:        os.Getenv("LEDGER_BACKEND"),
		LedgerBaseURL:        os.Getenv("LEDGER_BASE_URL"),
		LedgerServiceToken:   os.Getenv("LEDGER_SERVICE_TOKEN"),
		Provider:             os.Getenv("PROVIDER"),
		ProviderBaseURL:      os.Getenv("PROVIDER_BASE_URL"),
		ProviderAPIKey:       os.Getenv("PROVIDER_API_KEY"),
		Alpaca: ProviderCreds{
			BaseURL:   os.Getenv("ALPACA_BASE_URL"),
			APIKey:    os.Getenv("ALPACA_API_KEY"),
			APISecret: os.Getenv("ALPACA_API_SECRET"),
			AccountID: os.Getenv("ALPACA_ACCOUNT_ID"),
		},
		Quidax: ProviderCreds{
			BaseURL:   os.Getenv("QUIDAX_BASE_URL"),
			APIKey:    os.Getenv("QUIDAX_API_KEY"),
			APISecret: os.Getenv("QUIDAX_API_SECRET"),
		},
	}
}

// envFloat parses a positive float from env, falling back to def when unset,
// unparseable, or non-positive.
func envFloat(key string, def float64) float64 {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			return f
		}
	}
	return def
}
