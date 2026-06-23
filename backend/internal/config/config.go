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

	// ── Session / refresh-token hardening (#19) ──────────────────────────────
	// Feature-flagged surface (default OFF). When OFF, the new self/admin session
	// endpoints return 503 feature-disabled and the middleware session check is a
	// no-op (existing behaviour preserved). When ON, refresh rotation + reuse
	// detection, revocation enforcement, and suspicious-login response are active.
	FeatureSessionHardeningEnabled bool
	// Suspicious-login thresholds. Fail-closed defaults: any new device/IP is
	// treated as suspicious, a small failed-login spike escalates, and travel
	// faster than this km/h is "impossible".
	SuspiciousFailedLoginSpike int // failed logins (rolling window) that count as a spike
	SuspiciousImpossibleKmH    int // implied travel speed (km/h) above which travel is impossible
	// Escalation policy applied on a suspicious login: notify | force_reverify |
	// force_password_reset. force_* also revokes the user's active sessions.
	SuspiciousEscalationPolicy string

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
	MapleradPublicKey string
	MapleradProd      bool // false = sandbox
	MapleradWebhookSecret string

	// Eversend credentials (FX provider 2).
	EversendClientID      string
	EversendClientSecret  string
	EversendProd          bool
	EversendWebhookSecret string

	// Feature flags for financial modules.
	FeatureWalletEnabled          bool
	FeatureKYCEnabled             bool
	FeatureVirtualAccountsEnabled bool
	FeatureTransfersEnabled       bool
	FeatureWalletTransfersEnabled bool // wallet-to-wallet (P2P) go-live flag
	FeatureBankTransfersEnabled   bool // wallet-to-bank (payout) go-live flag
	FeatureReferralsEnabled       bool
	FeatureTierLimitsEnabled      bool
	FeatureFXEnabled              bool
	FeatureFXOrchestrationEnabled bool // normalized /v1 FX orchestration API
	PaymaxWebhookOutURL           string
	PaymaxWebhookSecret           string
	FeatureGroupsEnabled          bool
	FeatureAssociationsEnabled    bool
	FeatureEventsEnabled          bool
	FeatureEstateEnabled          bool
	FeatureCrowdfundingEnabled    bool
	FeatureRestaurantEnabled      bool
	FeatureTelemedicineEnabled    bool
	FeatureVoteBridgeEnabled      bool
	FeatureTransportEnabled       bool
	FeatureTransportModesEnabled  bool // parcel/bus/towing/movers/car-hire expansion
	FeatureAICareEnabled          bool
	FeatureDisputesEnabled        bool
	FeatureRatingsEnabled         bool
	FeaturePharmacyEnabled        bool
	FeatureOnboardingEnabled      bool
	FeatureInvestEnabled          bool // stock-trading (Paymax Invest) module
	FeatureDoctorEnabled          bool // doctor (provider) telemedicine module
	// Real-world emergency dispatch (ambulance/hospital/contact-notify). DEFAULT
	// OFF. Must route to a vetted emergency-services provider + pass a separate
	// safety review before enabling. No flag, no real dispatch.
	FeatureDoctorEmergencyDispatchEnabled bool
	FeatureMapsEnabled            bool // provider-agnostic MapService layer
	FeatureConnectEnabled         bool // Paymax Connect (dating/networking) module

	// ── MapService (provider-agnostic maps abstraction) ──────────────────────
	// Provider selection is config-driven via MapsConfigPath (a {primitive ->
	// provider} map per surface). Keys below are SERVER-SIDE ONLY and are never
	// shipped to the mobile/web client — all provider calls are proxied.
	//
	// Single legitimate key per provider. We never rotate keys/accounts to evade
	// free-tier limits (provider-terms violation). Cost control is via caching,
	// PostGIS, quotas, and graceful degradation only.
	MapsConfigPath     string // optional path to a YAML/JSON {primitive->provider} override
	MapsDefaultSurface string // surface used when a request omits one (default "default")

	// OpenStack stack (DEFAULT for display/geocode/route/matrix/tracking/geofence).
	MapsGeoapifyKey  string // Geoapify — OSM-licensed geocode/reverse/autocomplete (cacheable)
	MapsMapTilerKey  string // MapTiler — basemap vector tiles + styles
	MapsOSRMBaseURL  string // self-hosted OSRM (route/matrix/map-match); e.g. http://osrm:5000
	MapsTileStyleURL string // explicit MapLibre style URL override (else derived from MapTiler key)

	// Google (USE ONLY for autocomplete on consumer surfaces + external POI search).
	// NEVER cached, NEVER rendered on the OpenStack/MapLibre basemap.
	MapsGoogleKey string

	// Mapbox (OPTIONAL: static images + map-match fallback).
	MapsMapboxToken string

	// Cost-guard knobs: per-user proxy rate limit + budget-alert webhook.
	MapsRateLimitPerMin   int    // per-user requests/min on /api/finance/maps/* (default 120)
	MapsBudgetAlertWebhook string // POST budget alerts (50/75/90%) here; "" = log only

	// ── AI assist (server-side LLM) ──────────────────────────────────────────
	// SERVER-SIDE ONLY. Read from ANTHROPIC_API_KEY; default "" disables AI assist
	// (endpoints return a clearly-marked "not configured" envelope, never fabricated
	// medical content). This key is NEVER shipped to a client — all calls are proxied.
	AnthropicAPIKey string

	// ── Doctor AI per-doctor rate / cost guard ───────────────────────────────
	// A fixed-window guard (Redis INCR + EXPIRE) applied BEFORE each paid LLM call
	// in the doctor AI service, keyed by the authenticated doctor's user id. It
	// caps both per-minute burst and per-day spend. When Redis is unavailable the
	// guard FAILS OPEN (the call is allowed and a warning is logged) so a Redis
	// outage never blocks clinical AI assist. Set a limit to 0 to disable that
	// window entirely.
	DoctorAIRatePerMin int
	DoctorAIRatePerDay int

	// ── Doctor RTC (real-time call) credentials ──────────────────────────────
	// SERVER-SIDE ONLY. The App Certificate / VideoSDK secret are used to SIGN
	// short-lived join tokens and are NEVER shipped to a client. Empty creds
	// disable the provider: the call session returns an empty token + a
	// "not configured" flag (never a fabricated token).
	AgoraAppID          string
	AgoraAppCertificate string
	VideoSDKAPIKey      string
	VideoSDKSecret      string

	// ── Paymax Connect ───────────────────────────────────────────────────────
	// Server-side pepper for hashing verification identifiers (HMAC-SHA256).
	// Raw documents / biometric payloads are NEVER stored or logged — only the
	// hash + a provider reference (mirrors the KYC bvn_hash/nin_hash pattern).
	// NEVER shipped to a client. Empty disables verification hashing (fail-closed).
	ConnectVerificationPepper string

	// ── Cloudflare R2 (S3-compatible object storage) ─────────────────────────
	// SERVER-SIDE ONLY. Used to mint short-lived presigned PUT/GET URLs for the
	// doctor module's binary uploads (profile photo, documents, licence renewal,
	// chat attachments, dispute evidence). The client uploads directly to the
	// presigned URL and only records metadata via the API — credentials never
	// reach a client. Empty creds disable presigning (handlers fail closed with
	// 503, never a fabricated URL). Bucket default mirrors CLAUDE.md.
	R2AccountEndpoint string // https://<accountid>.r2.cloudflarestorage.com
	R2Bucket          string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2Region          string

	// ── Notification providers ────────────────────────────────────────────────
	// Resend: email delivery. Key from resend.com dashboard.
	ResendAPIKey    string
	ResendFromEmail string // e.g. "Paymax <noreply@mail.paymax.ng>"
	// Termii: SMS delivery. Key from termii.com dashboard.
	TermiiAPIKey    string
	TermiiSenderID  string // approved sender ID
	// Expo push: mobile push via Expo's push service. Optional access token.
	ExpoPushToken string
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

		FeatureSessionHardeningEnabled: getEnvBool("FEATURE_SESSION_HARDENING_ENABLED", false),
		SuspiciousFailedLoginSpike:     getEnvInt("AUTH_SUSPICIOUS_FAILED_LOGIN_SPIKE", 3),
		SuspiciousImpossibleKmH:        getEnvInt("AUTH_SUSPICIOUS_IMPOSSIBLE_KMH", 800),
		SuspiciousEscalationPolicy:     getEnv("AUTH_SUSPICIOUS_ESCALATION_POLICY", "notify"),

		DatabaseURL:        getEnv("DATABASE_URL", ""),
		RedisURL:           getEnv("REDIS_URL", "redis://localhost:6379"),
		PaystackSecretKey:  getEnv("PAYSTACK_SECRET_KEY", ""),
		PaystackWebhookKey: getEnv("PAYSTACK_WEBHOOK_SECRET", ""),

		MapleradSecretKey: getEnv("MAPLERAD_SECRET_KEY", ""),
		MapleradPublicKey: getEnv("MAPLERAD_PUBLIC_KEY", ""),
		MapleradProd:      getEnvBool("MAPLERAD_PROD", false),
		MapleradWebhookSecret: getEnv("MAPLERAD_WEBHOOK_SECRET", ""),

		EversendClientID:      getEnv("EVERSEND_CLIENT_ID", ""),
		EversendClientSecret:  getEnv("EVERSEND_CLIENT_SECRET", ""),
		EversendProd:          getEnvBool("EVERSEND_PROD", false),
		EversendWebhookSecret: getEnv("EVERSEND_WEBHOOK_SECRET", ""),

		FeatureWalletEnabled:          getEnvBool("FEATURE_WALLET_ENABLED", false),
		FeatureKYCEnabled:             getEnvBool("FEATURE_KYC_ENABLED", false),
		FeatureVirtualAccountsEnabled: getEnvBool("FEATURE_VIRTUAL_ACCOUNTS_ENABLED", false),
		FeatureTransfersEnabled:       getEnvBool("FEATURE_TRANSFERS_ENABLED", false),
		FeatureWalletTransfersEnabled: getEnvBool("FEATURE_WALLET_TRANSFERS_ENABLED", false),
		FeatureBankTransfersEnabled:   getEnvBool("FEATURE_BANK_TRANSFERS_ENABLED", false),
		FeatureReferralsEnabled:       getEnvBool("FEATURE_REFERRALS_ENABLED", false),
		FeatureTierLimitsEnabled:      getEnvBool("FEATURE_TIER_LIMITS_ENABLED", false),
		FeatureFXEnabled:              getEnvBool("FEATURE_FX_ENABLED", false),
		FeatureFXOrchestrationEnabled: getEnvBool("FEATURE_FX_ORCHESTRATION_ENABLED", false),
		PaymaxWebhookOutURL:           getEnv("PAYMAX_WEBHOOK_OUT_URL", ""),
		PaymaxWebhookSecret:           getEnv("PAYMAX_WEBHOOK_SECRET", ""),
		FeatureGroupsEnabled:          getEnvBool("FEATURE_GROUPS_ENABLED", false),
		FeatureAssociationsEnabled:    getEnvBool("FEATURE_ASSOCIATIONS_ENABLED", false),
		FeatureEventsEnabled:          getEnvBool("FEATURE_EVENTS_ENABLED", false),
		FeatureEstateEnabled:          getEnvBool("FEATURE_ESTATE_ENABLED", false),
		FeatureCrowdfundingEnabled:    getEnvBool("FEATURE_CROWDFUNDING_ENABLED", false),
		FeatureRestaurantEnabled:      getEnvBool("FEATURE_RESTAURANT_ENABLED", false),
		FeatureTelemedicineEnabled:    getEnvBool("FEATURE_TELEMEDICINE_ENABLED", false),
		FeatureVoteBridgeEnabled:      getEnvBool("FEATURE_VOTE_BRIDGE_ENABLED", false),
		FeatureTransportEnabled:       getEnvBool("FEATURE_TRANSPORT_ENABLED", false),
		FeatureTransportModesEnabled:  getEnvBool("FEATURE_TRANSPORT_MODES_ENABLED", false),
		FeatureAICareEnabled:          getEnvBool("FEATURE_AICARE_ENABLED", false),
		FeatureDisputesEnabled:        getEnvBool("FEATURE_DISPUTES_ENABLED", false),
		FeatureRatingsEnabled:         getEnvBool("FEATURE_RATINGS_ENABLED", false),
		FeaturePharmacyEnabled:        getEnvBool("FEATURE_PHARMACY_ENABLED", false),
		FeatureOnboardingEnabled:      getEnvBool("FEATURE_ONBOARDING_ENABLED", false),
		FeatureInvestEnabled:          getEnvBool("FEATURE_INVEST_ENABLED", false),
		FeatureDoctorEnabled:          getEnvBool("FEATURE_DOCTOR_ENABLED", false),
		FeatureDoctorEmergencyDispatchEnabled: getEnvBool("FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED", false),
		FeatureMapsEnabled:            getEnvBool("FEATURE_MAPS_ENABLED", false),
		FeatureConnectEnabled:         getEnvBool("FEATURE_CONNECT_ENABLED", false),

		MapsConfigPath:     getEnv("MAPS_CONFIG_PATH", ""),
		MapsDefaultSurface: getEnv("MAPS_DEFAULT_SURFACE", "default"),
		MapsGeoapifyKey:    getEnv("MAPS_GEOAPIFY_KEY", ""),
		MapsMapTilerKey:    getEnv("MAPS_MAPTILER_KEY", ""),
		MapsOSRMBaseURL:    getEnv("MAPS_OSRM_BASE_URL", ""),
		MapsTileStyleURL:   getEnv("MAPS_TILE_STYLE_URL", ""),
		MapsGoogleKey:      getEnv("MAPS_GOOGLE_KEY", ""),
		MapsMapboxToken:    getEnv("MAPS_MAPBOX_TOKEN", ""),
		MapsRateLimitPerMin:    getEnvInt("MAPS_RATE_LIMIT_PER_MIN", 120),
		MapsBudgetAlertWebhook: getEnv("MAPS_BUDGET_ALERT_WEBHOOK", ""),

		AnthropicAPIKey: getEnv("ANTHROPIC_API_KEY", ""),

		DoctorAIRatePerMin: getEnvInt("DOCTOR_AI_RATE_PER_MIN", 20),
		DoctorAIRatePerDay: getEnvInt("DOCTOR_AI_RATE_PER_DAY", 200),

		AgoraAppID:          getEnv("AGORA_APP_ID", ""),
		AgoraAppCertificate: getEnv("AGORA_APP_CERTIFICATE", ""),
		VideoSDKAPIKey:      getEnv("VIDEOSDK_API_KEY", ""),
		VideoSDKSecret:      getEnv("VIDEOSDK_SECRET", ""),

		ConnectVerificationPepper: getEnv("CONNECT_VERIFICATION_PEPPER", ""),

		R2AccountEndpoint: getEnv("R2_ACCOUNT_ENDPOINT", ""),
		R2Bucket:          getEnv("R2_BUCKET", "spotlight-open-mic"),
		R2AccessKeyID:     getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2Region:          getEnv("R2_REGION", "auto"),

		ResendAPIKey:    getEnv("RESEND_API_KEY", ""),
		ResendFromEmail: getEnv("RESEND_FROM_EMAIL", "Paymax <noreply@mail.paymax.ng>"),
		TermiiAPIKey:    getEnv("TERMII_API_KEY", ""),
		TermiiSenderID:  getEnv("TERMII_SENDER_ID", "Paymax"),
		ExpoPushToken:   getEnv("EXPO_PUSH_TOKEN", ""),
	}
}
