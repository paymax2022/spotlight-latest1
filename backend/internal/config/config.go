package config

import (
	"os"
	"strconv"
)

type Config struct {
	// AppEnv is the deployment environment: "development" (default), "staging",
	// or "production". Validate() is strict (fatal) in production, advisory
	// (warnings) elsewhere so local/dev boots with placeholder secrets.
	AppEnv                 string
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

	// Crypto real provider (retail crypto price feed + on-chain withdrawal broadcast).
	// CryptoProvider selects the implementation: "mock" (default, deterministic, no
	// network) or "quidax" (real HTTP adapter). Separate TEST and LIVE credential sets
	// are provisioned; the TEST set is used in dev/staging and the LIVE set in
	// production, selected by IsProd(). When the selected credentials are absent the
	// module falls back to the safe deterministic mock.
	CryptoProvider          string
	CryptoQuidaxTestKey     string
	CryptoQuidaxTestBaseURL string
	CryptoQuidaxLiveKey     string
	CryptoQuidaxLiveBaseURL string

	// Maplerad credentials (FX + alternative VA provider).
	MapleradSecretKey     string
	MapleradPublicKey     string
	MapleradProd          bool // false = sandbox
	MapleradWebhookSecret string
	// FeatureMapleradEnabled gates the Maplerad WaaS DOMAIN money path (ADR-012):
	// member /api/finance/maplerad/* routes, the /api/webhooks/maplerad/go webhook,
	// and the reconcile + orphan-sweep jobs. DEFAULT OFF — no flag, no money path.
	FeatureMapleradEnabled bool

	// Eversend credentials (FX provider 2).
	EversendClientID      string
	EversendClientSecret  string
	EversendProd          bool
	EversendWebhookSecret string

	// Monnify credentials (bank-payout provider 2 / disbursement). Server-side only.
	MonnifyAPIKey        string
	MonnifySecretKey     string
	MonnifyContractCode  string
	MonnifyProd          bool // false = sandbox
	MonnifyWebhookSecret string

	// Multi-provider bank-transfer routing.
	TransferProviderDefault string // default disbursement provider ("paystack")
	TransferFailoverEnabled bool   // auto-failover to the next provider on error

	// ── Multi-provider KYC verification gateway (ADR-013) ─────────────────────
	// Three providers behind capability-routed ports (Dojah · Smile ID · Youverify).
	// All secrets server-side ONLY; the client never receives a provider secret
	// (web/mobile SDK flows use a server-issued token). DEFAULT OFF.
	FeatureKYCVerifyEnabled bool

	// Dojah — headers Authorization:<secret> + AppId:<app_id>; sandbox→live.
	DojahAppID         string
	DojahSecretKey     string
	DojahProd          bool
	DojahWebhookSecret string

	// Smile ID — partner_id + api key + request signature; callback-based.
	SmileIDPartnerID   string
	SmileIDAPIKey      string
	SmileIDProd        bool // sid_server 0=sandbox / 1=prod
	SmileIDCallbackURL string

	// Youverify — token secret; isSubjectConsent must be true; webhooks async.
	YouverifyToken         string
	YouverifyProd          bool
	YouverifyWebhookSecret string

	// AES-256 key (base64, 32 bytes) encrypting KYC PII blobs at rest. Required
	// when FEATURE_KYC_VERIFY_ENABLED=true in production.
	KYCPIIEncKey string
	// Facial-match confidence gate (default 70): below → REVIEW, not silent fail.
	KYCFacialMatchThreshold int

	// ── Arena competition engine (ADR-014) ───────────────────────────────────
	// Config-driven competition module (Naija Driver = instance #1). Merit ledger
	// is signed by authorized scoring adapters (NDC-2). Seeds are base64 32-byte
	// Ed25519 seeds, server-side ONLY. DEFAULT OFF.
	FeatureArenaEnabled       bool
	ArenaSigningSeedTheory    string
	ArenaSigningSeedPractical string
	ArenaSigningSeedFirstAid  string
	// Dedicated crown-award signing key (NDC-1 defense-in-depth). Kept separate
	// from the merit adapter seeds so an award signature never shares a key with a
	// merit signer. Falls back to the practical adapter's signer when unset.
	ArenaAwardSigningSeed string
	// Seed routing (comma-separated ordered providers) per check type; admin-editable
	// after seed. Empty → built-in defaults from ADR-013 §1.
	KYCRouteIDNumber string
	KYCRouteIDFacial string
	KYCRouteLiveness string
	KYCRouteDocument string
	KYCRouteAML      string

	// Feature flags for financial modules.
	FeatureWalletEnabled          bool
	FeatureKYCEnabled             bool
	FeatureVirtualAccountsEnabled bool
	FeatureTransfersEnabled       bool
	FeatureWalletTransfersEnabled bool // wallet-to-wallet (P2P) go-live flag
	FeatureBankTransfersEnabled   bool // wallet-to-bank (payout) go-live flag
	FeatureReferralsEnabled       bool
	// Direct Referral Rewards ENGINE (single-level, purchase-triggered). Gates the
	// /v1/referrals + /v1/admin/referrals + /internal/referrals route block.
	FeatureReferralRewardsEnabled bool
	// Shared secret guarding /internal/referrals/* (service-to-service purchase
	// hooks). Empty ⇒ those endpoints fail closed (503).
	ReferralRewardsInternalSecret string
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
	FeatureNutritionEnabled       bool // Nutrition Resolution Engine (NRE)
	FeatureTelemedicineEnabled    bool
	FeatureVoteBridgeEnabled      bool
	FeatureTransportEnabled       bool
	FeatureTransportModesEnabled  bool // parcel/bus/towing/movers/car-hire expansion
	// Transport Trip Scheduling: schedule a future logistics movement (ride/parcel/
	// airport/bus) that the transport-scheduler worker materializes + escrows at a
	// lead time before pickup. DEFAULT OFF. Gates the member /api/finance/mobility/
	// scheduled* + admin /api/finance/admin/transport/scheduled* routes and the
	// transport-scheduler worker. No flag, no scheduled dispatch.
	FeatureTransportSchedulingEnabled bool
	FeatureAICareEnabled          bool
	FeatureDisputesEnabled        bool
	FeatureRatingsEnabled         bool
	FeaturePharmacyEnabled        bool
	// Symptom-based medication search (term → concept → condition cluster →
	// therapeutic class → live SKUs, triage tiers T1–T4). DEFAULT OFF. Gates
	// /pharmacy/symptom-search, /pharmacy/classes/{id}/skus and the
	// /admin/pharmacy/{mappings,reviews} pharmacist console. Requires
	// FeaturePharmacyEnabled — symptom search never runs without the base
	// pharmacy module.
	FeaturePharmacySymptomSearchEnabled bool
	FeatureOnboardingEnabled      bool
	FeatureInvestEnabled          bool // stock-trading (Paymax Invest) module
	FeatureInvestPINDevBypass     bool // dev only: accept any well-formed PIN
	// Invest provider adapters — when a base URL is set the real HTTP adapter is
	// used; otherwise the deterministic mock is used (mock-first, real last).
	InvestMarketDataBaseURL   string
	InvestMarketDataAPIKey    string
	InvestBrokerBaseURL       string
	InvestBrokerAPIKey        string
	InvestBrokerWebhookSecret string
	FeatureRealtorEnabled     bool // realtor super-app admin control plane
	FeatureDoctorEnabled      bool // doctor (provider) telemedicine module
	// Real-world emergency dispatch (ambulance/hospital/contact-notify). DEFAULT
	// OFF. Must route to a vetted emergency-services provider + pass a separate
	// safety review before enabling. No flag, no real dispatch.
	FeatureDoctorEmergencyDispatchEnabled bool
	FeatureMapsEnabled                    bool // provider-agnostic MapService layer
	FeatureMapsV2Enabled                  bool // Nigeria-tuned cost/coverage-aware resolution layer (MAPSERVICE.md)
	FeatureAcademyEnabled                 bool // Spotlight Academy (K-12 EdTech) module
	FeatureAcademyExamEnabled             bool // Academy exam arenas + CBT simulator (Phase 1 crown)
	FeatureAcademySpineEnabled            bool // Academy Phase 2: progression/adaptive paths + content/CMS + parent layer
	FeatureAcademyEduPayEnabled           bool // Academy Phase 2: EduPay (fees, pots, disbursement, scholarships)
	FeatureAcademyCredentialsEnabled      bool // Academy Phase 3: trade tracks + credentials + earning bridge
	FeatureAcademyLiveEnabled             bool // Academy Phase 3: live classes + community + moderation
	FeatureAcademySchoolsEnabled          bool // Academy Phase 4: B2B2C institutions + licences + enrolment
	FeatureAcademyTutorEnabled            bool // Academy Phase 4: tutor marketplace + payouts
	FeatureAcademyFeesEnabled             bool // Academy EdTech Fees: invoices, vault, promotion, competition, scholarship, trust-score, compliance export
	FeatureConnectEnabled                 bool // Paymax Connect (dating/networking) module
	// Property Management suite (unification umbrella over estate + realtor):
	// role context, rent passport, stay→gate-pass bridge. DEFAULT OFF. The estate
	// and realtor modules keep their own flags; this gates only the /property/*
	// cross-module surface.
	FeaturePropertySuiteEnabled bool

	// Fractional Real Estate / Land crowd-investing module. DEFAULT OFF. Gates
	// the /api/finance/fractionalre[/admin] surface (internal/fractionalre).
	FeatureFractionalREEnabled bool

	// Crypto buy/sell module. DEFAULT OFF. Gates the /api/v1/crypto[/admin] surface
	// (internal/crypto): mock-first price feed, reuses the finance ledger.
	FeatureCryptoEnabled bool

	// Custodial AI-trading module (internal/trading). DEFAULT OFF. Gates the
	// /api/v1/trading[/admin] surface — Module-KYC + unitized-NAV fund wallet
	// (PAPER/accounting only; no venue execution, no withdrawal keys). Cash moves
	// only through the finance ledger. TradingFeeBps/TradingHurdleBps are the
	// performance-fee terms (bps) for the fund's HWM engine.
	FeatureTradingEnabled bool
	TradingFeeBps         int
	TradingHurdleBps      int

	// Stricter SECOND gate over the AI decision surface inside internal/trading.
	// DEFAULT OFF and independent of FeatureTradingEnabled: the paper Module-KYC +
	// fund wallet can run with FEATURE_TRADING_ENABLED alone, while the deterministic
	// decision pipeline (POST /trading/evaluate) and the §12 promotion-ladder admin
	// routes stay dark until this is also on. Neither surface executes a real order
	// in this build (no venue adapter); this flag governs exposure, not execution.
	FeatureAITradingEnabled bool

	// ── Internal service-authenticated Ledger API (Stage 1.5c) ───────────────
	// Lets the separate trading service post cash legs through the AUTHORITATIVE
	// double-entry ledger (it does not run its own money ledger). DEFAULT OFF.
	// Gates POST /internal/finance/ledger/journal + GET /internal/finance/ledger/balance.
	// The endpoints are ADDITIONALLY guarded by a constant-time service-token check
	// against LedgerServiceToken — never a user JWT.
	FeatureInternalLedgerAPIEnabled bool
	// Shared Bearer service token authenticating the trading service to the internal
	// ledger API. Server-side ONLY; NEVER shipped to a client and NEVER a user JWT.
	// Empty ⇒ the internal ledger endpoints fail closed (503), even when the flag is on.
	LedgerServiceToken string

	// Learn Center (education). DEFAULT OFF. Gates /api/v1/learn (internal/learn).
	FeatureLearnEnabled bool
	// Invest-AI education assistant. DEFAULT OFF. Gates /api/v1/ai/invest
	// (internal/investai): DB-backed chat, pluggable AIProvider (mock or Anthropic),
	// education-only guardrails. No money path.
	FeatureInvestaiEnabled bool
	// Spotlight Wealth (learn-to-earn challenges + reward wallet). DEFAULT OFF.
	// Gates /api/v1/spotlight (internal/spotlightwealth); rewards via finance ledger.
	FeatureSpotlightwealthEnabled bool

	// Micro-insurance / Protection module (Partnering Insurtech: MyCover + Octamile
	// via underwriter-gateway). DEFAULT OFF. Gates /api/finance/insurance[/admin]
	// and /internal/webhooks/{mycover,octamile} (internal/insurance).
	FeatureInsuranceEnabled bool

	// Hotel Booking / Stays module (Property Suite). Dual-rail supply-gateway
	// (bedbank + direct extranet). DEFAULT OFF. Gates /api/finance/stays,
	// /api/stays/{admin,extranet} and /internal/webhooks/stays-supplier
	// (internal/stays).
	FeatureStaysEnabled bool

	// Featured Placement module (paid landing-page promotion; booking over scarce ad
	// inventory with ledger escrow + guarded state machine + serving resolver).
	// DEFAULT OFF. Gates /api/finance/placement, /api/placement/admin, and the public
	// /api/finance/placement/{landing,events} surface (internal/placement).
	FeaturePlacementEnabled bool

	// Paymax Marketplace module (Jiji-style classifieds + escrow checkout over the
	// finance ledger). DEFAULT OFF. Gates /v1/marketplace member/admin routes, the
	// public HMAC webhooks (logistics delivery + payments funding), and the escrow
	// order/dispute/boost state machines (internal/marketplace). No flag, no money path.
	FeatureMarketplaceEnabled bool

	// ElasticsearchURL is the marketplace search read-model cluster base URL
	// (e.g. "http://elasticsearch:9200"). When empty, GET /v1/marketplace/search
	// returns 501 SEARCH_NOT_WIRED (graceful degradation, never a panic) — the rest
	// of the marketplace still functions. Consumed by app-wiring to build
	// search.NewClient(...) and inject it via svc.SetSearcher(...).
	ElasticsearchURL string

	// RunWorkersInProcess starts background worker loops (currently the marketplace
	// search indexer) INSIDE the API process when true — for single-instance / free-
	// tier deploys with no separate always-on worker (see ADR-026). Default OFF; the
	// indexer only actually starts when a search cluster is configured
	// (ElasticsearchURL set). Promote to dedicated worker processes at scale.
	RunWorkersInProcess bool

	// Top-5 expansion modules (no-new-licence; ride existing wallet/ledger rails).
	// DEFAULT OFF. Each gates /api/finance/<mod> + /api/<mod>/admin (internal/<mod>).
	// (FeatureEventsEnabled is declared once above with the other module flags.)
	FeatureSocialPayEnabled bool // Social Payments & P2P Escrow
	FeatureP2PMarketEnabled bool // P2P Marketplace
	FeatureSavingsEnabled   bool // Group & Goal Savings (Ajo/Esusu)
	FeatureCreatorsEnabled  bool // Creator & Talent Monetisation
	FeatureLoyaltyEnabled   bool // Unified Loyalty & Paymax Black

	// Health verticals (marketplace; licensed partners deliver care). DEFAULT OFF.
	// FeatureHealthEnabled gates the shared platform (internal/health/*); the
	// per-vertical flags gate Pharmacy/Lab/Vet (/api/finance/health/<vertical>).
	FeatureHealthEnabled         bool
	FeatureHealthPharmacyEnabled bool
	FeatureHealthLabEnabled      bool
	FeatureHealthVetEnabled      bool
	// Pre-Consultation Health Intake (ADR-010). DEFAULT OFF. Gates the member
	// /api/finance/health/intake/* + admin /api/health/admin/intake surface.
	FeatureHealthIntakeEnabled bool
	// AI Symptom Checker (triage & navigation, NOT diagnosis). DEFAULT OFF.
	FeatureHealthTriageEnabled         bool
	FeatureHealthTriageWhatsAppEnabled bool
	// Triage engine selection: mock (deterministic, dev/CI) | infermedica (licensed).
	// LLM evidence-extraction reuses AnthropicAPIKey; never generates conclusions (SC-10).
	TriageEngine         string
	InfermedicaAppID     string
	InfermedicaAppKey    string
	InfermedicaBaseURL   string
	TriageWhatsAppSecret string

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

	// Generic HTTP maps provider (real geocode + routing/ETA behind a documented
	// JSON contract — see internal/maps/provider_http.go). When MapsProvider="http"
	// and MapsBaseURL is set, one real adapter serves geocode/reverse/route/matrix
	// via the gateway you point at (Google Distance Matrix/Directions, Mapbox, or
	// your own shim). Any other value (default "mock") keeps the deterministic mock,
	// so dev/CI stay offline-functional. MapsAPIKey is server-side only.
	MapsProvider string // "mock" (default) | "http"
	MapsBaseURL  string // gateway root, e.g. https://maps-gw.partner.example/v1
	MapsAPIKey   string // Bearer token (server-side only); optional

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
	MapsRateLimitPerMin    int    // per-user requests/min on /api/finance/maps/* (default 120)
	MapsBudgetAlertWebhook string // POST budget alerts (50/75/90%) here; "" = log only

	// ── MapService v2 (MAPSERVICE.md) ──
	MapsHereKey      string // HERE API key (accuracy fallback); mock when empty
	MapsGazetteerKey string // 32-byte AES key for gazetteer PII (NDPA); Noop when empty
	MapsV2ConfigPath string // optional JSON override for v2 thresholds/order/budgets

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

	// ── Academy rails seam (RAILS_MODE) ──────────────────────────────────────
	// The four unbacked academy money rails (BNPL, payout, disbursement, billing)
	// each sit behind their EXISTING provider-agnostic gateway interface. RailsMode
	// selects the adapter WITHOUT changing the code path:
	//   - "fake"    → HTTP adapter pointed at the local deterministic fake service
	//                 (tools/fakes, :9100). DEFAULT.
	//   - "sandbox" → SAME HTTP adapter, pointed at a provider sandbox (only base
	//                 URL + creds + webhook secret differ).
	//   - "live"    → SAME HTTP adapter, pointed at production creds (later).
	//   - "off"/""  → no HTTP adapter; each package keeps its in-process dev stub.
	// In every non-off mode the inbound webhook is HMAC-signature-verified.
	RailsMode string

	// Per-rail base URL + API key + webhook secret. The HTTP adapter is selected
	// per rail only when RailsMode != off/"" AND that rail's base URL is set.
	// Server-side only; NEVER shipped to a client and NEVER logged.
	BNPLBaseURL       string
	BNPLAPIKey        string
	BNPLWebhookSecret string

	PayoutBaseURL       string
	PayoutAPIKey        string
	PayoutWebhookSecret string

	DisburseBaseURL       string
	DisburseAPIKey        string
	DisburseWebhookSecret string

	BillingBaseURL       string
	BillingAPIKey        string
	BillingWebhookSecret string

	// ── Notification providers ────────────────────────────────────────────────
	// Resend: email delivery. Key from resend.com dashboard.
	ResendAPIKey    string
	ResendFromEmail string // e.g. "Paymax <noreply@mail.paymax.ng>"
	// Termii: SMS delivery. Key from termii.com dashboard.
	TermiiAPIKey   string
	TermiiSenderID string // approved sender ID
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
		AppEnv:                 getEnv("APP_ENV", "development"),
		Port:                   getEnv("APP_PORT", "8080"),
		SupabaseURL:            getEnv("SUPABASE_URL", getEnv("NEXT_PUBLIC_SUPABASE_URL", "")),
		SupabaseServiceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY", ""),
		AdminAPIKey:            getEnv("ADMIN_API_KEY", ""),
		CORSAllowOrigins:       getEnv("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://localhost:4030,http://localhost:8081"),
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

		CryptoProvider:          getEnv("CRYPTO_PROVIDER", "mock"),
		CryptoQuidaxTestKey:     getEnv("QUIDAX_TEST_API_KEY", ""),
		CryptoQuidaxTestBaseURL: getEnv("QUIDAX_TEST_BASE_URL", "https://app.quidax.io/api/v1"),
		CryptoQuidaxLiveKey:     getEnv("QUIDAX_LIVE_API_KEY", ""),
		CryptoQuidaxLiveBaseURL: getEnv("QUIDAX_LIVE_BASE_URL", "https://app.quidax.io/api/v1"),

		MapleradSecretKey:      getEnv("MAPLERAD_SECRET_KEY", ""),
		MapleradPublicKey:      getEnv("MAPLERAD_PUBLIC_KEY", ""),
		MapleradProd:           getEnvBool("MAPLERAD_PROD", false),
		MapleradWebhookSecret:  getEnv("MAPLERAD_WEBHOOK_SECRET", ""),
		FeatureMapleradEnabled: getEnvBool("FEATURE_MAPLERAD_ENABLED", false),

		EversendClientID:      getEnv("EVERSEND_CLIENT_ID", ""),
		EversendClientSecret:  getEnv("EVERSEND_CLIENT_SECRET", ""),
		EversendProd:          getEnvBool("EVERSEND_PROD", false),
		EversendWebhookSecret: getEnv("EVERSEND_WEBHOOK_SECRET", ""),

		MonnifyAPIKey:        getEnv("MONNIFY_API_KEY", ""),
		MonnifySecretKey:     getEnv("MONNIFY_SECRET_KEY", ""),
		MonnifyContractCode:  getEnv("MONNIFY_CONTRACT_CODE", ""),
		MonnifyProd:          getEnvBool("MONNIFY_PROD", false),
		MonnifyWebhookSecret: getEnv("MONNIFY_WEBHOOK_SECRET", ""),

		TransferProviderDefault: getEnv("TRANSFER_PROVIDER_DEFAULT", "paystack"),
		TransferFailoverEnabled: getEnvBool("TRANSFER_FAILOVER_ENABLED", true),

		// ── Multi-provider KYC verification (ADR-013) ──
		FeatureKYCVerifyEnabled: getEnvBool("FEATURE_KYC_VERIFY_ENABLED", false),
		DojahAppID:              getEnv("DOJAH_APP_ID", ""),
		DojahSecretKey:          getEnv("DOJAH_SECRET_KEY", ""),
		DojahProd:               getEnvBool("DOJAH_PROD", false),
		DojahWebhookSecret:      getEnv("DOJAH_WEBHOOK_SECRET", ""),
		SmileIDPartnerID:        getEnv("SMILEID_PARTNER_ID", ""),
		SmileIDAPIKey:           getEnv("SMILEID_API_KEY", ""),
		SmileIDProd:             getEnvBool("SMILEID_PROD", false),
		SmileIDCallbackURL:      getEnv("SMILEID_CALLBACK_URL", ""),
		YouverifyToken:          getEnv("YOUVERIFY_TOKEN", ""),
		YouverifyProd:           getEnvBool("YOUVERIFY_PROD", false),
		YouverifyWebhookSecret:  getEnv("YOUVERIFY_WEBHOOK_SECRET", ""),
		KYCPIIEncKey:            getEnv("KYC_PII_ENC_KEY", ""),
		KYCFacialMatchThreshold: getEnvInt("KYC_FACIAL_MATCH_THRESHOLD", 70),

		// ── Arena competition engine (ADR-014) ──
		FeatureArenaEnabled:       getEnvBool("FEATURE_ARENA_ENABLED", false),
		ArenaSigningSeedTheory:    getEnv("ARENA_SIGNING_SEED_THEORY", ""),
		ArenaSigningSeedPractical: getEnv("ARENA_SIGNING_SEED_PRACTICAL", ""),
		ArenaSigningSeedFirstAid:  getEnv("ARENA_SIGNING_SEED_FIRSTAID", ""),
		ArenaAwardSigningSeed:     getEnv("ARENA_AWARD_SIGNING_SEED", ""),
		KYCRouteIDNumber:          getEnv("KYC_ROUTE_ID_NUMBER", "dojah,youverify"),
		KYCRouteIDFacial:          getEnv("KYC_ROUTE_ID_FACIAL", "dojah,smileid"),
		KYCRouteLiveness:          getEnv("KYC_ROUTE_LIVENESS", "dojah,smileid"),
		KYCRouteDocument:          getEnv("KYC_ROUTE_DOCUMENT", "dojah,smileid"),
		KYCRouteAML:               getEnv("KYC_ROUTE_AML", "dojah,youverify"),

		FeatureWalletEnabled:                  getEnvBool("FEATURE_WALLET_ENABLED", false),
		FeatureKYCEnabled:                     getEnvBool("FEATURE_KYC_ENABLED", false),
		FeatureVirtualAccountsEnabled:         getEnvBool("FEATURE_VIRTUAL_ACCOUNTS_ENABLED", false),
		FeatureTransfersEnabled:               getEnvBool("FEATURE_TRANSFERS_ENABLED", false),
		FeatureWalletTransfersEnabled:         getEnvBool("FEATURE_WALLET_TRANSFERS_ENABLED", false),
		FeatureBankTransfersEnabled:           getEnvBool("FEATURE_BANK_TRANSFERS_ENABLED", false),
		FeatureReferralsEnabled:               getEnvBool("FEATURE_REFERRALS_ENABLED", false),
		FeatureReferralRewardsEnabled:         getEnvBool("FEATURE_REFERRAL_REWARDS_ENABLED", false),
		ReferralRewardsInternalSecret:         getEnv("REFERRAL_REWARDS_INTERNAL_SECRET", ""),
		// Iron Rule: every money mutation must pass tier-limit checks fail-closed.
		// Defaults TRUE so limits are enforced by default; set FEATURE_TIER_LIMITS_ENABLED=false
		// only for explicit local/dev opt-out. (docs/go-live-readiness.md blocker #1)
		FeatureTierLimitsEnabled:              getEnvBool("FEATURE_TIER_LIMITS_ENABLED", true),
		FeatureFXEnabled:                      getEnvBool("FEATURE_FX_ENABLED", false),
		FeatureFXOrchestrationEnabled:         getEnvBool("FEATURE_FX_ORCHESTRATION_ENABLED", false),
		PaymaxWebhookOutURL:                   getEnv("PAYMAX_WEBHOOK_OUT_URL", ""),
		PaymaxWebhookSecret:                   getEnv("PAYMAX_WEBHOOK_SECRET", ""),
		FeatureGroupsEnabled:                  getEnvBool("FEATURE_GROUPS_ENABLED", false),
		FeatureAssociationsEnabled:            getEnvBool("FEATURE_ASSOCIATIONS_ENABLED", false),
		FeatureEventsEnabled:                  getEnvBool("FEATURE_EVENTS_ENABLED", false),
		FeatureEstateEnabled:                  getEnvBool("FEATURE_ESTATE_ENABLED", false),
		FeatureCrowdfundingEnabled:            getEnvBool("FEATURE_CROWDFUNDING_ENABLED", false),
		FeatureRestaurantEnabled:              getEnvBool("FEATURE_RESTAURANT_ENABLED", false),
		FeatureNutritionEnabled:               getEnvBool("FEATURE_NUTRITION_ENABLED", false),
		FeatureTelemedicineEnabled:            getEnvBool("FEATURE_TELEMEDICINE_ENABLED", false),
		FeatureVoteBridgeEnabled:              getEnvBool("FEATURE_VOTE_BRIDGE_ENABLED", false),
		FeatureTransportEnabled:               getEnvBool("FEATURE_TRANSPORT_ENABLED", false),
		FeatureTransportModesEnabled:          getEnvBool("FEATURE_TRANSPORT_MODES_ENABLED", false),
		FeatureTransportSchedulingEnabled:     getEnvBool("FEATURE_TRANSPORT_SCHEDULING_ENABLED", false),
		FeatureAICareEnabled:                  getEnvBool("FEATURE_AICARE_ENABLED", false),
		FeatureDisputesEnabled:                getEnvBool("FEATURE_DISPUTES_ENABLED", false),
		FeatureRatingsEnabled:                 getEnvBool("FEATURE_RATINGS_ENABLED", false),
		FeaturePharmacyEnabled:                getEnvBool("FEATURE_PHARMACY_ENABLED", false),
		FeaturePharmacySymptomSearchEnabled:   getEnvBool("FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED", false),
		FeatureOnboardingEnabled:              getEnvBool("FEATURE_ONBOARDING_ENABLED", false),
		FeatureInvestEnabled:                  getEnvBool("FEATURE_INVEST_ENABLED", false),
		FeatureInvestPINDevBypass:             getEnvBool("FEATURE_INVEST_PIN_DEV_BYPASS", false),
		InvestMarketDataBaseURL:               getEnv("INVEST_MARKETDATA_BASE_URL", ""),
		InvestMarketDataAPIKey:                getEnv("INVEST_MARKETDATA_API_KEY", ""),
		InvestBrokerBaseURL:                   getEnv("INVEST_BROKER_BASE_URL", ""),
		InvestBrokerAPIKey:                    getEnv("INVEST_BROKER_API_KEY", ""),
		InvestBrokerWebhookSecret:             getEnv("INVEST_BROKER_WEBHOOK_SECRET", ""),
		FeatureRealtorEnabled:                 getEnvBool("FEATURE_REALTOR_ENABLED", false),
		FeatureDoctorEnabled:                  getEnvBool("FEATURE_DOCTOR_ENABLED", false),
		FeatureDoctorEmergencyDispatchEnabled: getEnvBool("FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED", false),
		FeatureMapsEnabled:                    getEnvBool("FEATURE_MAPS_ENABLED", false),
		FeatureMapsV2Enabled:                  getEnvBool("FEATURE_MAPS_V2_ENABLED", false),
		FeatureAcademyEnabled:                 getEnvBool("FEATURE_ACADEMY_ENABLED", false),
		FeatureAcademyExamEnabled:             getEnvBool("FEATURE_ACADEMY_EXAM_ENABLED", false),
		FeatureAcademySpineEnabled:            getEnvBool("FEATURE_ACADEMY_SPINE_ENABLED", false),
		FeatureAcademyEduPayEnabled:           getEnvBool("FEATURE_ACADEMY_EDUPAY_ENABLED", false),
		FeatureAcademyCredentialsEnabled:      getEnvBool("FEATURE_ACADEMY_CREDENTIALS_ENABLED", false),
		FeatureAcademyLiveEnabled:             getEnvBool("FEATURE_ACADEMY_LIVE_ENABLED", false),
		FeatureAcademySchoolsEnabled:          getEnvBool("FEATURE_ACADEMY_SCHOOLS_ENABLED", false),
		FeatureAcademyTutorEnabled:            getEnvBool("FEATURE_ACADEMY_TUTOR_ENABLED", false),
		FeatureAcademyFeesEnabled:             getEnvBool("FEATURE_ACADEMY_FEES_ENABLED", false),
		FeatureConnectEnabled:                 getEnvBool("FEATURE_CONNECT_ENABLED", false),
		FeaturePropertySuiteEnabled:           getEnvBool("FEATURE_PROPERTY_SUITE_ENABLED", false),
		FeatureFractionalREEnabled:            getEnvBool("FEATURE_FRACTIONAL_RE_ENABLED", false),
		FeatureCryptoEnabled:                  getEnvBool("FEATURE_CRYPTO_ENABLED", false),
		FeatureTradingEnabled:                 getEnvBool("FEATURE_TRADING_ENABLED", false),
		FeatureAITradingEnabled:               getEnvBool("FEATURE_AI_TRADING_ENABLED", false),
		TradingFeeBps:                         getEnvInt("TRADING_FEE_BPS", 2000),
		TradingHurdleBps:                      getEnvInt("TRADING_HURDLE_BPS", 0),
		FeatureInternalLedgerAPIEnabled:       getEnvBool("FEATURE_INTERNAL_LEDGER_API_ENABLED", false),
		LedgerServiceToken:                    getEnv("LEDGER_SERVICE_TOKEN", ""),
		FeatureLearnEnabled:                   getEnvBool("FEATURE_LEARN_ENABLED", false),
		FeatureInvestaiEnabled:                getEnvBool("FEATURE_INVESTAI_ENABLED", false),
		FeatureSpotlightwealthEnabled:         getEnvBool("FEATURE_SPOTLIGHTWEALTH_ENABLED", false),
		FeatureInsuranceEnabled:               getEnvBool("FEATURE_INSURANCE_ENABLED", false),
		FeatureStaysEnabled:                   getEnvBool("FEATURE_STAYS_ENABLED", false),
		FeaturePlacementEnabled:               getEnvBool("FEATURE_PLACEMENT_ENABLED", false),
		FeatureMarketplaceEnabled:             getEnvBool("FEATURE_MARKETPLACE_ENABLED", false),
		ElasticsearchURL:                      getEnv("ELASTICSEARCH_URL", ""),
		RunWorkersInProcess:                   getEnvBool("RUN_WORKERS_INPROCESS", false),
		FeatureSocialPayEnabled:               getEnvBool("FEATURE_SOCIAL_PAY_ENABLED", false),
		FeatureP2PMarketEnabled:               getEnvBool("FEATURE_P2P_MARKET_ENABLED", false),
		FeatureSavingsEnabled:                 getEnvBool("FEATURE_SAVINGS_ENABLED", false),
		FeatureCreatorsEnabled:                getEnvBool("FEATURE_CREATORS_ENABLED", false),
		FeatureLoyaltyEnabled:                 getEnvBool("FEATURE_LOYALTY_ENABLED", false),
		FeatureHealthEnabled:                  getEnvBool("FEATURE_HEALTH_ENABLED", false),
		FeatureHealthPharmacyEnabled:          getEnvBool("FEATURE_HEALTH_PHARMACY_ENABLED", false),
		FeatureHealthLabEnabled:               getEnvBool("FEATURE_HEALTH_LAB_ENABLED", false),
		FeatureHealthVetEnabled:               getEnvBool("FEATURE_HEALTH_VET_ENABLED", false),
		FeatureHealthIntakeEnabled:            getEnvBool("FEATURE_HEALTH_INTAKE_ENABLED", false),
		FeatureHealthTriageEnabled:            getEnvBool("FEATURE_HEALTH_TRIAGE_ENABLED", false),
		FeatureHealthTriageWhatsAppEnabled:    getEnvBool("FEATURE_HEALTH_TRIAGE_WHATSAPP_ENABLED", false),
		TriageEngine:                          getEnv("TRIAGE_ENGINE", "mock"),
		InfermedicaAppID:                      getEnv("INFERMEDICA_APP_ID", ""),
		InfermedicaAppKey:                     getEnv("INFERMEDICA_APP_KEY", ""),
		InfermedicaBaseURL:                    getEnv("INFERMEDICA_BASE_URL", ""),
		TriageWhatsAppSecret:                  getEnv("TRIAGE_WHATSAPP_SECRET", ""),

		MapsConfigPath:         getEnv("MAPS_CONFIG_PATH", ""),
		MapsDefaultSurface:     getEnv("MAPS_DEFAULT_SURFACE", "default"),
		MapsProvider:           getEnv("MAPS_PROVIDER", "mock"),
		MapsBaseURL:            getEnv("MAPS_BASE_URL", ""),
		MapsAPIKey:             getEnv("MAPS_API_KEY", ""),
		MapsGeoapifyKey:        getEnv("MAPS_GEOAPIFY_KEY", ""),
		MapsMapTilerKey:        getEnv("MAPS_MAPTILER_KEY", ""),
		MapsOSRMBaseURL:        getEnv("MAPS_OSRM_BASE_URL", ""),
		MapsTileStyleURL:       getEnv("MAPS_TILE_STYLE_URL", ""),
		MapsGoogleKey:          getEnv("MAPS_GOOGLE_KEY", ""),
		MapsMapboxToken:        getEnv("MAPS_MAPBOX_TOKEN", ""),
		MapsRateLimitPerMin:    getEnvInt("MAPS_RATE_LIMIT_PER_MIN", 120),
		MapsBudgetAlertWebhook: getEnv("MAPS_BUDGET_ALERT_WEBHOOK", ""),
		MapsHereKey:            getEnv("MAPS_HERE_KEY", ""),
		MapsGazetteerKey:       getEnv("MAPS_GAZETTEER_KEY", ""),
		MapsV2ConfigPath:       getEnv("MAPS_V2_CONFIG_PATH", ""),

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

		RailsMode: getEnv("RAILS_MODE", "fake"),

		BNPLBaseURL:       getEnv("BNPL_BASE_URL", ""),
		BNPLAPIKey:        getEnv("BNPL_API_KEY", ""),
		BNPLWebhookSecret: getEnv("BNPL_WEBHOOK_SECRET", ""),

		PayoutBaseURL:       getEnv("PAYOUT_BASE_URL", ""),
		PayoutAPIKey:        getEnv("PAYOUT_API_KEY", ""),
		PayoutWebhookSecret: getEnv("PAYOUT_WEBHOOK_SECRET", ""),

		DisburseBaseURL:       getEnv("DISBURSE_BASE_URL", ""),
		DisburseAPIKey:        getEnv("DISBURSE_API_KEY", ""),
		DisburseWebhookSecret: getEnv("DISBURSE_WEBHOOK_SECRET", ""),

		BillingBaseURL:       getEnv("BILLING_BASE_URL", ""),
		BillingAPIKey:        getEnv("BILLING_API_KEY", ""),
		BillingWebhookSecret: getEnv("BILLING_WEBHOOK_SECRET", ""),

		ResendAPIKey:    getEnv("RESEND_API_KEY", ""),
		ResendFromEmail: getEnv("RESEND_FROM_EMAIL", "Paymax <noreply@mail.paymax.ng>"),
		TermiiAPIKey:    getEnv("TERMII_API_KEY", ""),
		TermiiSenderID:  getEnv("TERMII_SENDER_ID", "Paymax"),
		ExpoPushToken:   getEnv("EXPO_PUSH_TOKEN", ""),
	}
}
