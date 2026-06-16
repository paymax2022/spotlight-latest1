package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port                   string
	SupabaseURL            string
	SupabaseServiceRoleKey string
	AdminAPIKey            string
	CORSAllowOrigins       string
	MaxFailedLoginAttempts int
	AccountLockMinutes     int

	// Direct Postgres connection (pgx) for money-path operations.
	// Format: postgres://user:pass@host:port/db?sslmode=require
	DatabaseURL string

	// Redis URL for cache, Redlock, asynq, and WS pub/sub.
	RedisURL string

	// Paystack credentials.
	PaystackSecretKey  string
	PaystackWebhookKey string

	// Maplerad credentials (FX + alternative VA provider).
	MapleradSecretKey string
	MapleradProd      bool // false = sandbox

	// Feature flags for financial modules.
	FeatureWalletEnabled          bool
	FeatureKYCEnabled             bool
	FeatureVirtualAccountsEnabled bool
	FeatureTransfersEnabled       bool
	FeatureReferralsEnabled       bool
	FeatureTierLimitsEnabled      bool
	FeatureFXEnabled              bool
	FeatureGroupsEnabled          bool
	FeatureEventsEnabled          bool
	FeatureEstateEnabled          bool
	FeatureCrowdfundingEnabled    bool
	FeatureRestaurantEnabled      bool
	FeatureTelemedicineEnabled    bool
	FeatureVoteBridgeEnabled      bool
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "true" || v == "1" || v == "yes" {
		return true
	}
	if v == "false" || v == "0" || v == "no" {
		return false
	}
	return fallback
}

func Load() Config {
	return Config{
		Port:                   getEnv("APP_PORT", "8080"),
		SupabaseURL:            getEnv("SUPABASE_URL", getEnv("NEXT_PUBLIC_SUPABASE_URL", "")),
		SupabaseServiceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY", ""),
		AdminAPIKey:            getEnv("ADMIN_API_KEY", ""),
		CORSAllowOrigins:       getEnv("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://localhost:4030"),
		MaxFailedLoginAttempts: getEnvInt("AUTH_MAX_FAILED_LOGIN_ATTEMPTS", 5),
		AccountLockMinutes:     getEnvInt("AUTH_ACCOUNT_LOCK_MINUTES", 30),

		DatabaseURL:        getEnv("DATABASE_URL", ""),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379"),
		PaystackSecretKey:  getEnv("PAYSTACK_SECRET_KEY", ""),
		PaystackWebhookKey: getEnv("PAYSTACK_WEBHOOK_SECRET", ""),

		MapleradSecretKey: getEnv("MAPLERAD_SECRET_KEY", ""),
		MapleradProd:      getEnvBool("MAPLERAD_PROD", false),

		FeatureWalletEnabled:          getEnvBool("FEATURE_WALLET_ENABLED", false),
		FeatureKYCEnabled:             getEnvBool("FEATURE_KYC_ENABLED", false),
		FeatureVirtualAccountsEnabled: getEnvBool("FEATURE_VIRTUAL_ACCOUNTS_ENABLED", false),
		FeatureTransfersEnabled:       getEnvBool("FEATURE_TRANSFERS_ENABLED", false),
		FeatureReferralsEnabled:       getEnvBool("FEATURE_REFERRALS_ENABLED", false),
		FeatureTierLimitsEnabled:      getEnvBool("FEATURE_TIER_LIMITS_ENABLED", false),
		FeatureFXEnabled:              getEnvBool("FEATURE_FX_ENABLED", false),
		FeatureGroupsEnabled:          getEnvBool("FEATURE_GROUPS_ENABLED", false),
		FeatureEventsEnabled:          getEnvBool("FEATURE_EVENTS_ENABLED", false),
		FeatureEstateEnabled:          getEnvBool("FEATURE_ESTATE_ENABLED", false),
		FeatureCrowdfundingEnabled:    getEnvBool("FEATURE_CROWDFUNDING_ENABLED", false),
		FeatureRestaurantEnabled:      getEnvBool("FEATURE_RESTAURANT_ENABLED", false),
		FeatureTelemedicineEnabled:    getEnvBool("FEATURE_TELEMEDICINE_ENABLED", false),
		FeatureVoteBridgeEnabled:      getEnvBool("FEATURE_VOTE_BRIDGE_ENABLED", false),
	}
}
