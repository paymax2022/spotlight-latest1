package config

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	// AppEnv is the deployment environment: "development" (default), "staging",
	// or "production". Validate() is strict (fatal) in production, advisory
	// (warnings) elsewhere so local/dev boots with placeholder secrets.
	AppEnv                 string
	Port                   string
	SupabaseURL            string
	SupabaseServiceRoleKey string
	// SupabaseJWTSecret enables local HS256 verification of Supabase access
	// tokens (ADR-PR395: removes the per-request GoTrue GET /auth/v1/user call
	// that saturates first under load). Only consulted when AuthJWTLocalVerify
	// is true.
	SupabaseJWTSecret  string
	AuthJWTLocalVerify bool
	// AuthIdentityCacheTTLSeconds caches the per-request RBAC identity lookups
	// (status/roles/global perms) for this many seconds; 0 = live lookups.
	// Opt-in because a suspend/lock takes up to this long to take effect.
	AuthIdentityCacheTTLSeconds int
	AdminAPIKey                 string
	CORSAllowOrigins            string
	// TrustedProxyCIDRs is a CSV of CIDRs/IPs whose X-Forwarded-For/X-Real-Ip
	// headers Gin may trust when resolving c.ClientIP(). c.ClientIP() feeds
	// rate limits, audit records, and the suspicious-login engine, so it must
	// not be caller-controlled. Default: the GCP external HTTPS LB frontend
	// ranges (the hop in front of Cloud Run). Set TRUSTED_PROXY_CIDRS=none to
	// distrust forwarded headers entirely (ClientIP = RemoteAddr).
	TrustedProxyCIDRs      string
	MaxFailedLoginAttempts int
	AccountLockMinutes     int

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
	DatabaseURL string

	// Redis URL for cache, Redlock, asynq, and WS pub/sub.
	RedisURL string
	// RedisRequired promotes Redis from a latency optimization to a hard
	// readiness dependency: when true, /readyz reports 503 while Redis is
	// unreachable (E2E-FR-050). DEFAULT OFF — Redis has a DB-unique fallback
	// for idempotency and nil-safe degradation everywhere it is used, so when
	// this is unset a down Redis reports "degraded" in the readiness components
	// payload but the probe stays 200.
	RedisRequired bool
	// SchedulerEnabled runs the in-process durable-job poller
	// (scheduler.Service.Poll) that drains scheduler_jobs. DEFAULT ON —
	// without a poller, durable jobs are produced but never execute
	// (E2E-BE-005). Set SCHEDULER_ENABLED=false only if an external process
	// owns the drain (none exists today; the claim is SKIP LOCKED + UNIQUE run
	// key, so per-replica pollers are safe anyway).
	SchedulerEnabled bool
	// SchedulerPollIntervalSeconds is the scheduler RunDue tick (default 5s).
	SchedulerPollIntervalSeconds int

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
	MapleradProd          bool
	MapleradWebhookSecret string
	// FeatureMapleradEnabled gates the Maplerad WaaS DOMAIN money path (ADR-012):
	// member /api/finance/maplerad/* routes, the /api/webhooks/maplerad/go webhook,
	// and the reconcile + orphan-sweep jobs. DEFAULT OFF — no flag, no money path.
	FeatureMapleradEnabled bool
	// FeatureUtilityBillsEnabled gates the Utility Bills DOMAIN money path:
	// member /api/finance/utilitybills/* routes, admin routes, and background
	// jobs (pending-transaction requery sweep). DEFAULT OFF — no flag, no
	// money path; the flag exists ahead of the Phase 1 wiring.
	FeatureUtilityBillsEnabled bool

	// Eversend credentials (FX provider 2).
	EversendClientID      string
	EversendClientSecret  string
	EversendProd          bool
	EversendWebhookSecret string

	// Monnify credentials (bank-payout provider 2 / disbursement). Server-side only.
	MonnifyAPIKey        string
	MonnifySecretKey     string
	MonnifyContractCode  string
	MonnifyProd          bool
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
	// Referral purchase-commission-split: a flat 20% of Spotlight's realised
	// commission on a purchase, paid to the referred payer's referrer, capped at
	// referral_links.reward_cap rewarded purchases per CODE (not per referred
	// user). Hooked into commission.Service (see referral/commissionsplit);
	// distinct from the older tiered engine above. DEFAULT OFF — new money path.
	FeatureReferralCommissionSplitEnabled bool
	FeatureTierLimitsEnabled              bool
	FeatureFXEnabled                      bool
	FeatureFXOrchestrationEnabled         bool // normalized /v1 FX orchestration API
	FeatureRealtimeEnabled                bool // SSE server-push (marketplace chat etc.)
	PaymaxWebhookOutURL                   string
	PaymaxWebhookSecret                   string
	FeatureGroupsEnabled                  bool
	FeatureAssociationsEnabled            bool
	// AssocCardSigningSecret is the HMAC secret for digital membership cards.
	// Empty outside development is a hard startup failure: the fallback is a
	// constant compiled into this (public) repo, so anyone could forge a
	// structurally valid card token for a known membership id.
	AssocCardSigningSecret string
	FeatureEventsEnabled   bool
	FeatureEstateEnabled   bool
	// FeatureEstateDuesPaystackCheckoutEnabled gates the Paystack-funded
	// (card/bank-transfer) estate dues path (estate/paystackcheckout): direct
	// Paystack payment posted DR provider-clearing / CR settlement, never
	// touching the payer's wallet, so no KYC-tier gate. Default OFF. Same
	// audited design as FeatureRestaurantPaystackCheckoutEnabled, minus the
	// escrow/hold-release step (dues settle immediately).
	FeatureEstateDuesPaystackCheckoutEnabled bool
	FeatureCrowdfundingEnabled               bool
	FeatureRestaurantEnabled                 bool
	// FeatureRestaurantWithdrawalsEnabled gates the merchant/rider withdrawal
	// money path (wallet → saved bank account; restaurant/withdrawal.go
	// RequestWithdrawal). Default OFF: the routes are always mounted once
	// FeatureRestaurantEnabled is on (list/admin views are read-only-safe), but
	// RequestWithdrawal itself refuses with ErrWithdrawalsDisabled until this is
	// explicitly turned on (see Service.WithWithdrawals).
	FeatureRestaurantWithdrawalsEnabled bool
	// FeatureRestaurantPaystackCheckoutEnabled gates the Paystack-funded
	// (card/bank-transfer) food-order checkout path (restaurant/paystackcheckout):
	// an order paid directly via Paystack, escrowed via
	// settlement.EscrowExternal, never touching the customer's wallet, so no
	// KYC-tier gate. Default OFF. This is the audited alternative to the
	// rejected FEATURE_CHECKOUT_TOPUP_TIER0 top-up-then-spend design (see
	// docs/audit/checkout-allowance-audit-findings.md): a new wallet-free rail;
	// the tier gate on wallet-funded PlaceOrder stays fail-closed regardless.
	FeatureRestaurantPaystackCheckoutEnabled bool
	// FeatureModuleGateEnforce turns the server-side module gate from observe-only
	// (logs what it would refuse) into enforcing (503s unpublished modules). Default
	// false: the gate's route map is hand-built and must be validated against real
	// traffic before it can refuse anything.
	FeatureModuleGateEnforce     bool
	FeatureNutritionEnabled      bool // Nutrition Resolution Engine (NRE)
	FeatureTelemedicineEnabled   bool
	FeatureVoteBridgeEnabled     bool
	FeatureTransportEnabled      bool
	FeatureTransportModesEnabled bool // parcel/bus/towing/movers/car-hire expansion
	// FeatureTransportPaystackCheckoutEnabled gates the Paystack-funded
	// (card/bank-transfer) ride-hailing checkout path
	// (transport/paystackcheckout): a ride paid directly via Paystack, escrowed
	// via settlement.EscrowExternal, never touching the rider's wallet, so no
	// KYC-tier gate. Default OFF. Same audited design as
	// FeatureRestaurantPaystackCheckoutEnabled, ported to ride-hailing's
	// instant-pricing flow (no offer-mode negotiation).
	FeatureTransportPaystackCheckoutEnabled bool
	// Transport Trip Scheduling: schedule a future logistics movement (ride/parcel/
	// airport/bus) that the transport-scheduler worker materializes + escrows at a
	// lead time before pickup. DEFAULT OFF. Gates the member /api/finance/mobility/
	// scheduled* + admin /api/finance/admin/transport/scheduled* routes and the
	// transport-scheduler worker. No flag, no scheduled dispatch.
	FeatureTransportSchedulingEnabled bool
	// FeatureTransportBusDeferredSettlementEnabled (FEATURE_TRANSPORT_BUS_DEFERRED_SETTLEMENT,
	// DEFAULT OFF): wallet bus tickets keep the fare in ESCROW (refundable) until
	// departure + TransportBusSettleGraceMinutes instead of paying the operator at
	// booking. Off = legacy settle-on-issue (cancel of a settled ticket is refused,
	// never faked). See ADR-PR559-bus-wallet-fixes.
	FeatureTransportBusDeferredSettlementEnabled bool
	// FeatureTransportBusLifecycleSweeperEnabled (FEATURE_TRANSPORT_BUS_LIFECYCLE_SWEEPER,
	// DEFAULT OFF): advance bus schedules/tickets to departed/completed/no_show.
	FeatureTransportBusLifecycleSweeperEnabled bool
	TransportBusSettleGraceMinutes             int // TRANSPORT_BUS_SETTLE_GRACE_MINUTES (default 30)
	TransportBusCancelCutoffMinutes            int // TRANSPORT_BUS_CANCEL_CUTOFF_MINUTES (default 120, clamped 60-1440)
	TransportBusMinBookingLeadMinutes          int // TRANSPORT_BUS_MIN_BOOKING_LEAD_MINUTES (default 15)
	FeatureAICareEnabled                       bool
	FeatureDisputesEnabled                     bool
	FeatureRatingsEnabled                      bool
	FeaturePharmacyEnabled                     bool
	// Symptom-based medication search (term → concept → condition cluster →
	// therapeutic class → live SKUs, triage tiers T1–T4). DEFAULT OFF. Gates
	// /pharmacy/symptom-search, /pharmacy/classes/{id}/skus and the
	// /admin/pharmacy/{mappings,reviews} pharmacist console. Requires
	// FeaturePharmacyEnabled — symptom search never runs without the base
	// pharmacy module.
	FeaturePharmacySymptomSearchEnabled bool
	FeatureOnboardingEnabled            bool
	FeatureInvestEnabled                bool // stock-trading (Paymax Invest) module

	// AI-trading fund (backend/internal/trading). Two gates, matching the
	// module's own contract:
	//   FeatureTradingEnabled   – mounts Module-KYC + fund wallet (subscribe/redeem).
	//   FeatureAITradingEnabled – ALSO exposes the decision pipeline (/evaluate)
	//                             and the promotion-ladder admin routes.
	// Neither executes a real venue order in this build; cash moves only through
	// the finance ledger.
	FeatureTradingEnabled   bool
	FeatureAITradingEnabled bool

	// Performance-fee terms for the fund, in basis points. TradingFeeBps must be
	// in (0,10000] or PerformanceFee fails closed and charges nothing.
	TradingFeeBps             int  // e.g. 2000 = 20% performance fee
	TradingHurdleBps          int  // 0 = pure high-water-mark, no hurdle
	FeatureInvestPINDevBypass bool // dev only: accept any well-formed PIN
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
	FeatureAcademyTuitionEnabled          bool // Academy tuition payment path (Phases 1–5 Go migration)
	FeatureConnectEnabled                 bool // Paymax Connect (dating/networking) module
	// FeatureConnectFlagSet records whether FEATURE_CONNECT_ENABLED was present
	// and non-empty in the environment at boot. Needed because the Connect
	// wallet/KYC mounts (/api/v1/wallet, /api/v1/kyc, /api/v1/me/tier) predate
	// the flag and must stay mounted when it is UNSET to avoid breaking
	// existing deployments — they unmount only when the flag is explicitly set
	// to a false value (E2E-SEC-064).
	FeatureConnectFlagSet bool
	// FeatureConnectWalletFundEnabled mounts POST /api/v1/wallet/fund, the
	// Connect wallet top-up. DEFAULT OFF — E2E-SEC-052: the handler credits the
	// user wallet from provider_clearing (the account reserved for verified
	// Paystack webhooks) with no payment proof, so any authenticated user could
	// mint money. The documented funding rail — debit the member's Paymax
	// super-app wallet — was never implemented; keep the route unmounted until
	// that design lands. When OFF the route 404s even for a valid session.
	FeatureConnectWalletFundEnabled    bool
	FeatureContestStageEvictionEnabled bool // Voting contest stage eviction system (multi-stage, grace period, judge save)
	FeatureContestantSocialEnabled     bool // Contestant likes + profile-share links (contestant_likes/contestant_shares)
	// Property Management suite (unification umbrella over estate + realtor):
	// role context, rent passport, stay→gate-pass bridge. DEFAULT OFF. The estate
	// and realtor modules keep their own flags; this gates only the /property/*
	// cross-module surface.
	FeaturePropertySuiteEnabled bool
	FeaturePropertyRolesEnabled bool

	// Fractional Real Estate / Land crowd-investing module. DEFAULT OFF. Gates
	// the /api/finance/fractionalre[/admin] surface (internal/fractionalre).
	FeatureFractionalREEnabled bool

	// Crypto buy/sell module. DEFAULT OFF. Gates the /api/v1/crypto[/admin] surface
	// (internal/crypto): mock-first price feed, reuses the finance ledger.
	FeatureCryptoEnabled bool

	// FeatureTelemedicinePlatformFeeEnabled turns on the platform booking fee
	// charged on top of a doctor's consultation fee (ADR-044). Default OFF: it is a
	// patient-visible price increase, so it is opt-in, and switching it off is the
	// rollback — the app renders whatever quote the server returns, so no client
	// release is needed either way.
	FeatureTelemedicinePlatformFeeEnabled bool

	// FeatureCheckoutTopupTier0 lets an UNVERIFIED (Tier 0) account pay for a
	// purchase under a capped allowance (ADR-042 funds it, ADR-043 lets it be
	// spent). This MUST be the same value as frontend-web's
	// FEATURE_CHECKOUT_TOPUP_TIER0: enabling only the funding half charges a
	// customer for a purchase that is then refused at escrow. Default OFF.
	FeatureCheckoutTopupTier0 bool

	// Gates the member /api/finance/business/* + admin /api/business/admin/*
	// surface (internal/business). The CAC registration fee is a real idempotent
	// wallet debit → paymax_revenue. DEFAULT OFF — no flag, no registration path.
	FeatureBusinessRegistryEnabled bool
	// CAC VAS provider credentials (server-side ONLY; never shipped to a client).
	// When the base URL AND api key are set the real HTTP adapter is used; otherwise
	// the deterministic sandbox adapter keeps dev/CI offline-functional.
	CACVASBaseURL        string // e.g. https://vas.cac.gov.ng/api
	CACVASApiKey         string // Bearer / consumer key
	CACVASConsumerSecret string // HMAC request-signing secret

	// Lets the separate trading service post cash legs through the AUTHORITATIVE
	// double-entry ledger (it does not run its own money ledger). DEFAULT OFF.
	// Gates POST /internal/finance/ledger/journal + GET /internal/finance/ledger/balance.
	// The endpoints are ADDITIONALLY guarded by a constant-time service-token check
	// against LedgerServiceToken — never a user JWT.
	FeatureInternalLedgerAPIEnabled bool
	// Lets the Next.js gateway-fulfilment arm (Paystack webhook/recover) confirm a
	// paid academy tuition instalment when the payer's client never reaches the
	// member confirm route. DEFAULT OFF. Gates
	// POST /internal/finance/academy/tuition/confirm — additionally guarded by the
	// same RequireServiceToken check (LedgerServiceToken; empty ⇒ fail-closed 503).
	FeatureInternalAcademyAPIEnabled bool
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
	// RunWorkersInProcess enables in-process background workers (marketplace search
	// indexer) for single-instance deploys (ADR-026 free-tier deployment).
	// Default OFF — promote to dedicated worker dynos at scale. RUN_WORKERS_INPROCESS.
	RunWorkersInProcess bool

	// Top-5 expansion modules (no-new-licence; ride existing wallet/ledger rails).
	// DEFAULT OFF. Each gates /api/finance/<mod> + /api/<mod>/admin (internal/<mod>).
	// (FeatureEventsEnabled is declared once above with the other module flags.)
	FeatureSocialPayEnabled bool // Social Payments & P2P Escrow
	FeatureP2PMarketEnabled bool // P2P Marketplace
	FeatureSavingsEnabled   bool // Group & Goal Savings (Ajo/Esusu)

	// SavingsEarlyBreakPenaltyBps is the fee for breaking a LOCK vault before
	// maturity, in basis points (1000 = 10%). MUST stay server-side: a
	// client-supplied value would let a member break a lock for free by sending 0.
	SavingsEarlyBreakPenaltyBps int
	FeatureCreatorsEnabled      bool // Creator & Talent Monetisation
	FeatureLoyaltyEnabled       bool // Unified Loyalty & Paymax Black
	FeatureCommissionEnabled    bool // Central Commission & Profit management

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

	// Provider selection is config-driven via MapsConfigPath (a {primitive ->
	// provider} map per surface). Keys below are SERVER-SIDE ONLY and are never
	// shipped to the mobile/web client — all provider calls are proxied.
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
	MapsRateLimitPerMin int // per-user requests/min on /api/finance/maps/* (default 120)
	// FinanceTransferRatePerMin caps per-user transfer-initiate requests/min —
	// E2E-SEC-058: money mutations had no rate limit (15 rapid transfers, no
	// 429). Covers the transfer initiates plus the other money-moving writes
	// that share the budget: resolve-account, beneficiaries, fx/convert, and
	// the FX-orchestrator conversion/transfer/VA/beneficiary/card-fund posts.
	FinanceTransferRatePerMin int
	// FinancePinRatePerMin is the tighter budget for /transfers/pin|pin/verify —
	// a verify oracle on a 4-6 digit space needs less headroom than a
	// money transfer does.
	FinancePinRatePerMin   int
	MapsBudgetAlertWebhook string // POST budget alerts (50/75/90%) here; "" = log only

	// Connect voting cost guards: per-user POSTs/min on the vote endpoints.
	// The paid path debits a wallet, so it gets the tighter budget.
	ConnectFreeVoteRatePerMin int // contests/:id/vote (default 30)
	ConnectPaidVoteRatePerMin int // contests/:id/paid-vote + vote-bridge debit (default 10)

	MapsHereKey      string // HERE API key (accuracy fallback); mock when empty
	MapsGazetteerKey string // 32-byte AES key for gazetteer PII (NDPA); Noop when empty
	MapsV2ConfigPath string // optional JSON override for v2 thresholds/order/budgets

	// SERVER-SIDE ONLY. Read from ANTHROPIC_API_KEY; default "" disables AI assist
	// (endpoints return a clearly-marked "not configured" envelope, never fabricated
	// medical content). This key is NEVER shipped to a client — all calls are proxied.
	AnthropicAPIKey string

	// A fixed-window guard (Redis INCR + EXPIRE) applied BEFORE each paid LLM call
	// in the doctor AI service, keyed by the authenticated doctor's user id. It
	// caps both per-minute burst and per-day spend. When Redis is unavailable the
	// guard FAILS OPEN (the call is allowed and a warning is logged) so a Redis
	// outage never blocks clinical AI assist. Set a limit to 0 to disable that
	// window entirely.
	DoctorAIRatePerMin int
	DoctorAIRatePerDay int

	// SERVER-SIDE ONLY. The VideoSDK secret is used to SIGN short-lived join
	// tokens and is NEVER shipped to a client. Empty creds disable the provider:
	// the call session returns an empty token + a "not configured" flag (never a
	// fabricated token).
	VideoSDKAPIKey string
	VideoSDKSecret string

	// Server-side pepper for hashing verification identifiers (HMAC-SHA256).
	// Raw documents / biometric payloads are NEVER stored or logged — only the
	// hash + a provider reference (mirrors the KYC bvn_hash/nin_hash pattern).
	// NEVER shipped to a client. Empty disables verification hashing (fail-closed).
	ConnectVerificationPepper string

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

	// Per-IP, per-route auth throttles. See middleware.AuthRateLimit.
	AuthRateLimitPerMin       int
	AuthResetRateLimitPerHour int

	// Resend: email delivery. Key from resend.com dashboard.
	ResendAPIKey    string
	ResendFromEmail string // must be @spotlightng.com — the only domain verified on the Resend account

	// Brevo joins Resend rather than replacing it: Resend is the fire-and-forget
	// notification path (a silent failure is tolerable); an undelivered OTP is a
	// failed login, so the OTP path reports and classifies its failures.
	// FeatureOTPEmailEnabled defaults OFF and the routes 503 until it is on; the
	// Brevo account, sender domain and template must be provisioned first.
	// See docs/audit/USER_MANAGEMENT_AUDIT.md B1.
	FeatureOTPEmailEnabled bool
	// FeatureOTPLoginMFAEnabled turns a correct password into a code challenge
	// instead of a session. SEPARATE from FeatureOTPEmailEnabled on purpose:
	// enabling server-issued OTP should not silently add a second factor to
	// every login.
	// ⚠️ It fails CLOSED, which is the point of a second factor and also means an
	// email outage is a TOTAL LOGIN OUTAGE for everyone. There is no enrolment,
	// no opt-out and no recovery code: a user who loses access to their mailbox
	// cannot sign in. Read docs/runbooks/otp-email-brevo.md before enabling it.
	FeatureOTPLoginMFAEnabled bool
	BrevoAPIKey               string
	BrevoSenderName           string
	BrevoSenderEmail          string
	BrevoOTPTemplateID        int64
	BrevoTimeoutSeconds       int

	// OTPPepper is the server-side HMAC key for code and identifier hashing.
	// REQUIRED whenever the feature is on: otp.NewService refuses to construct
	// without it, and the routes then answer 503 misconfigured rather than
	// storing digests that a rainbow table reverses. Generate with
	// `openssl rand -base64 32`. Rotating it invalidates every in-flight code,
	// which is acceptable.
	OTPPepper                string
	OTPLength                int
	OTPTTLMinutes            int
	OTPMaxAttempts           int
	OTPResendCooldownSeconds int
	OTPMaxSendsPerHour       int
	OTPMaxSendsPerIPPerHour  int
	OTPMaxVerifyPerIPPerHour int

	// SignupRateLimitPer5Min replaces GoTrue's sign_in_sign_ups limit on the
	// admin creation path, which that endpoint does not enforce. Defaulted to
	// GoTrue's own default (30 per 5 minutes per IP) so switching creation paths
	// does not quietly change the budget.
	SignupRateLimitPer5Min int
	// AdminAppBaseURL: origin of frontend-admin, used to build links inside
	// transactional emails (e.g. the hotelier staff invite accept link).
	AdminAppBaseURL string
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

// envPresent reports whether the variable exists AND is non-empty. Used where
// "unset" and "explicitly set" must be told apart (FEATURE_CONNECT_ENABLED —
// E2E-SEC-064). An explicit empty value counts as unset.
func envPresent(key string) bool {
	v, ok := os.LookupEnv(key)
	return ok && strings.TrimSpace(v) != ""
}

func Load() Config {
	return Config{
		AppEnv:                      getEnv("APP_ENV", "development"),
		Port:                        getEnv("APP_PORT", "8080"),
		SupabaseURL:                 getEnv("SUPABASE_URL", getEnv("NEXT_PUBLIC_SUPABASE_URL", "")),
		SupabaseServiceRoleKey:      getEnv("SUPABASE_SERVICE_ROLE_KEY", ""),
		SupabaseJWTSecret:           getEnv("SUPABASE_JWT_SECRET", ""),
		AuthJWTLocalVerify:          getEnvBool("AUTH_JWT_LOCAL_VERIFY", false),
		AuthIdentityCacheTTLSeconds: getEnvInt("AUTH_IDENTITY_CACHE_TTL_SECONDS", 0),
		AdminAPIKey:                 getEnv("ADMIN_API_KEY", ""),
		CORSAllowOrigins:            getEnv("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://localhost:4030,http://localhost:8081"),
		TrustedProxyCIDRs:           getEnv("TRUSTED_PROXY_CIDRS", "130.211.0.0/22,35.191.0.0/16"),
		MaxFailedLoginAttempts:      getEnvInt("AUTH_MAX_FAILED_LOGIN_ATTEMPTS", 5),
		AccountLockMinutes:          getEnvInt("AUTH_ACCOUNT_LOCK_MINUTES", 30),

		FeatureSessionHardeningEnabled: getEnvBool("FEATURE_SESSION_HARDENING_ENABLED", false),
		SuspiciousFailedLoginSpike:     getEnvInt("AUTH_SUSPICIOUS_FAILED_LOGIN_SPIKE", 3),
		SuspiciousImpossibleKmH:        getEnvInt("AUTH_SUSPICIOUS_IMPOSSIBLE_KMH", 800),
		SuspiciousEscalationPolicy:     getEnv("AUTH_SUSPICIOUS_ESCALATION_POLICY", "notify"),

		DatabaseURL:   getEnv("DATABASE_URL", ""),
		RedisURL:      getEnv("REDIS_URL", "redis://localhost:6379"),
		RedisRequired: getEnvBool("REDIS_REQUIRED", false),
		// Default ON: the durable-job poller is the only thing that drains
		// scheduler_jobs; opt out only when an external worker owns it.
		SchedulerEnabled:             getEnvBool("SCHEDULER_ENABLED", true),
		SchedulerPollIntervalSeconds: getEnvInt("SCHEDULER_POLL_INTERVAL_SECONDS", 5),
		PaystackSecretKey:            getEnv("PAYSTACK_SECRET_KEY", ""),
		PaystackWebhookKey:           getEnv("PAYSTACK_WEBHOOK_SECRET", ""),

		CryptoProvider:          getEnv("CRYPTO_PROVIDER", "mock"),
		CryptoQuidaxTestKey:     getEnv("QUIDAX_TEST_API_KEY", ""),
		CryptoQuidaxTestBaseURL: getEnv("QUIDAX_TEST_BASE_URL", "https://app.quidax.io/api/v1"),
		CryptoQuidaxLiveKey:     getEnv("QUIDAX_LIVE_API_KEY", ""),
		CryptoQuidaxLiveBaseURL: getEnv("QUIDAX_LIVE_BASE_URL", "https://app.quidax.io/api/v1"),

		MapleradSecretKey:          getEnv("MAPLERAD_SECRET_KEY", ""),
		MapleradPublicKey:          getEnv("MAPLERAD_PUBLIC_KEY", ""),
		MapleradProd:               getEnvBool("MAPLERAD_PROD", false),
		MapleradWebhookSecret:      getEnv("MAPLERAD_WEBHOOK_SECRET", ""),
		FeatureMapleradEnabled:     getEnvBool("FEATURE_MAPLERAD_ENABLED", false),
		FeatureUtilityBillsEnabled: getEnvBool("FEATURE_UTILITY_BILLS_ENABLED", false),

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
		FeatureVirtualAccountsEnabled:         getEnvBool("FEATURE_VIRTUAL_ACCOUNTS_ENABLED", false),
		FeatureTransfersEnabled:               getEnvBool("FEATURE_TRANSFERS_ENABLED", false),
		FeatureWalletTransfersEnabled:         getEnvBool("FEATURE_WALLET_TRANSFERS_ENABLED", false),
		FeatureBankTransfersEnabled:           getEnvBool("FEATURE_BANK_TRANSFERS_ENABLED", false),
		FeatureReferralsEnabled:               getEnvBool("FEATURE_REFERRALS_ENABLED", false),
		FeatureReferralRewardsEnabled:         getEnvBool("FEATURE_REFERRAL_REWARDS_ENABLED", false),
		ReferralRewardsInternalSecret:         getEnv("REFERRAL_REWARDS_INTERNAL_SECRET", ""),
		FeatureReferralCommissionSplitEnabled: getEnvBool("FEATURE_REFERRAL_COMMISSION_SPLIT_ENABLED", false),
		// Iron Rule: every money mutation must pass tier-limit checks fail-closed.
		// Defaults TRUE so limits are enforced by default; set FEATURE_TIER_LIMITS_ENABLED=false
		// only for explicit local/dev opt-out. (docs/go-live-readiness.md blocker #1)
		FeatureTierLimitsEnabled:                     getEnvBool("FEATURE_TIER_LIMITS_ENABLED", true),
		FeatureFXEnabled:                             getEnvBool("FEATURE_FX_ENABLED", false),
		FeatureFXOrchestrationEnabled:                getEnvBool("FEATURE_FX_ORCHESTRATION_ENABLED", false),
		FeatureRealtimeEnabled:                       getEnvBool("FEATURE_REALTIME_ENABLED", false),
		PaymaxWebhookOutURL:                          getEnv("PAYMAX_WEBHOOK_OUT_URL", ""),
		PaymaxWebhookSecret:                          getEnv("PAYMAX_WEBHOOK_SECRET", ""),
		FeatureGroupsEnabled:                         getEnvBool("FEATURE_GROUPS_ENABLED", false),
		FeatureAssociationsEnabled:                   getEnvBool("FEATURE_ASSOCIATIONS_ENABLED", false),
		AssocCardSigningSecret:                       getEnv("ASSOC_CARD_SIGNING_SECRET", ""),
		FeatureEventsEnabled:                         getEnvBool("FEATURE_EVENTS_ENABLED", false),
		FeatureEstateEnabled:                         getEnvBool("FEATURE_ESTATE_ENABLED", false),
		FeatureEstateDuesPaystackCheckoutEnabled:     getEnvBool("FEATURE_ESTATE_DUES_PAYSTACK_CHECKOUT_ENABLED", false),
		FeatureCrowdfundingEnabled:                   getEnvBool("FEATURE_CROWDFUNDING_ENABLED", false),
		FeatureRestaurantEnabled:                     getEnvBool("FEATURE_RESTAURANT_ENABLED", false),
		FeatureRestaurantWithdrawalsEnabled:          getEnvBool("FEATURE_RESTAURANT_WITHDRAWALS_ENABLED", false),
		FeatureRestaurantPaystackCheckoutEnabled:     getEnvBool("FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED", false),
		FeatureModuleGateEnforce:                     getEnvBool("FEATURE_MODULE_GATE_ENFORCE", false),
		FeatureNutritionEnabled:                      getEnvBool("FEATURE_NUTRITION_ENABLED", false),
		FeatureTelemedicineEnabled:                   getEnvBool("FEATURE_TELEMEDICINE_ENABLED", false),
		FeatureVoteBridgeEnabled:                     getEnvBool("FEATURE_VOTE_BRIDGE_ENABLED", false),
		FeatureTransportEnabled:                      getEnvBool("FEATURE_TRANSPORT_ENABLED", false),
		FeatureTransportModesEnabled:                 getEnvBool("FEATURE_TRANSPORT_MODES_ENABLED", false),
		FeatureTransportPaystackCheckoutEnabled:      getEnvBool("FEATURE_TRANSPORT_PAYSTACK_CHECKOUT_ENABLED", false),
		FeatureTransportSchedulingEnabled:            getEnvBool("FEATURE_TRANSPORT_SCHEDULING_ENABLED", false),
		FeatureTransportBusDeferredSettlementEnabled: getEnvBool("FEATURE_TRANSPORT_BUS_DEFERRED_SETTLEMENT", false),
		FeatureTransportBusLifecycleSweeperEnabled:   getEnvBool("FEATURE_TRANSPORT_BUS_LIFECYCLE_SWEEPER", false),
		TransportBusSettleGraceMinutes:               getEnvInt("TRANSPORT_BUS_SETTLE_GRACE_MINUTES", 30),
		TransportBusCancelCutoffMinutes:              getEnvInt("TRANSPORT_BUS_CANCEL_CUTOFF_MINUTES", 120),
		TransportBusMinBookingLeadMinutes:            getEnvInt("TRANSPORT_BUS_MIN_BOOKING_LEAD_MINUTES", 15),
		FeatureAICareEnabled:                         getEnvBool("FEATURE_AICARE_ENABLED", false),
		FeatureDisputesEnabled:                       getEnvBool("FEATURE_DISPUTES_ENABLED", false),
		FeatureRatingsEnabled:                        getEnvBool("FEATURE_RATINGS_ENABLED", false),
		FeaturePharmacyEnabled:                       getEnvBool("FEATURE_PHARMACY_ENABLED", false),
		FeaturePharmacySymptomSearchEnabled:          getEnvBool("FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED", false),
		FeatureOnboardingEnabled:                     getEnvBool("FEATURE_ONBOARDING_ENABLED", false),
		FeatureInvestEnabled:                         getEnvBool("FEATURE_INVEST_ENABLED", false),
		FeatureInvestPINDevBypass:                    getEnvBool("FEATURE_INVEST_PIN_DEV_BYPASS", false),
		InvestMarketDataBaseURL:                      getEnv("INVEST_MARKETDATA_BASE_URL", ""),
		InvestMarketDataAPIKey:                       getEnv("INVEST_MARKETDATA_API_KEY", ""),
		InvestBrokerBaseURL:                          getEnv("INVEST_BROKER_BASE_URL", ""),
		InvestBrokerAPIKey:                           getEnv("INVEST_BROKER_API_KEY", ""),
		InvestBrokerWebhookSecret:                    getEnv("INVEST_BROKER_WEBHOOK_SECRET", ""),
		FeatureRealtorEnabled:                        getEnvBool("FEATURE_REALTOR_ENABLED", false),
		FeatureDoctorEnabled:                         getEnvBool("FEATURE_DOCTOR_ENABLED", false),
		FeatureDoctorEmergencyDispatchEnabled:        getEnvBool("FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED", false),
		FeatureMapsEnabled:                           getEnvBool("FEATURE_MAPS_ENABLED", false),
		FeatureMapsV2Enabled:                         getEnvBool("FEATURE_MAPS_V2_ENABLED", false),
		FeatureAcademyEnabled:                        getEnvBool("FEATURE_ACADEMY_ENABLED", false),
		FeatureAcademyExamEnabled:                    getEnvBool("FEATURE_ACADEMY_EXAM_ENABLED", false),
		FeatureAcademySpineEnabled:                   getEnvBool("FEATURE_ACADEMY_SPINE_ENABLED", false),
		FeatureAcademyEduPayEnabled:                  getEnvBool("FEATURE_ACADEMY_EDUPAY_ENABLED", false),
		FeatureAcademyCredentialsEnabled:             getEnvBool("FEATURE_ACADEMY_CREDENTIALS_ENABLED", false),
		FeatureAcademyLiveEnabled:                    getEnvBool("FEATURE_ACADEMY_LIVE_ENABLED", false),
		FeatureAcademySchoolsEnabled:                 getEnvBool("FEATURE_ACADEMY_SCHOOLS_ENABLED", false),
		FeatureAcademyTutorEnabled:                   getEnvBool("FEATURE_ACADEMY_TUTOR_ENABLED", false),
		FeatureAcademyFeesEnabled:                    getEnvBool("FEATURE_ACADEMY_FEES_ENABLED", false),
		FeatureAcademyTuitionEnabled:                 getEnvBool("FEATURE_ACADEMY_TUITION_ENABLED", false),
		FeatureConnectEnabled:                        getEnvBool("FEATURE_CONNECT_ENABLED", false),
		FeatureConnectFlagSet:                        envPresent("FEATURE_CONNECT_ENABLED"),
		FeatureConnectWalletFundEnabled:              getEnvBool("FEATURE_CONNECT_WALLET_FUND_ENABLED", false),
		FeatureContestStageEvictionEnabled:           getEnvBool("FEATURE_CONTEST_STAGE_EVICTION_ENABLED", false),
		FeatureContestantSocialEnabled:               getEnvBool("FEATURE_CONTESTANT_SOCIAL_ENABLED", false),
		FeaturePropertySuiteEnabled:                  getEnvBool("FEATURE_PROPERTY_SUITE_ENABLED", false),
		FeaturePropertyRolesEnabled:                  getEnvBool("FEATURE_PROPERTY_ROLES_ENABLED", false),
		FeatureFractionalREEnabled:                   getEnvBool("FEATURE_FRACTIONAL_RE_ENABLED", false),
		FeatureCryptoEnabled:                         getEnvBool("FEATURE_CRYPTO_ENABLED", false),
		FeatureTelemedicinePlatformFeeEnabled:        getEnvBool("FEATURE_TELEMEDICINE_PLATFORM_FEE_ENABLED", false),
		FeatureCheckoutTopupTier0:                    getEnvBool("FEATURE_CHECKOUT_TOPUP_TIER0", false),
		FeatureBusinessRegistryEnabled:               getEnvBool("FEATURE_BUSINESS_REGISTRY_ENABLED", false),
		CACVASBaseURL:                                getEnv("CAC_VAS_BASE_URL", ""),
		CACVASApiKey:                                 getEnv("CAC_VAS_API_KEY", ""),
		CACVASConsumerSecret:                         getEnv("CAC_VAS_CONSUMER_SECRET", ""),
		FeatureInternalLedgerAPIEnabled:              getEnvBool("FEATURE_INTERNAL_LEDGER_API_ENABLED", false),
		FeatureInternalAcademyAPIEnabled:             getEnvBool("FEATURE_INTERNAL_ACADEMY_API_ENABLED", false),
		LedgerServiceToken:                           getEnv("LEDGER_SERVICE_TOKEN", ""),
		FeatureLearnEnabled:                          getEnvBool("FEATURE_LEARN_ENABLED", false),
		FeatureInvestaiEnabled:                       getEnvBool("FEATURE_INVESTAI_ENABLED", false),
		FeatureSpotlightwealthEnabled:                getEnvBool("FEATURE_SPOTLIGHTWEALTH_ENABLED", false),
		FeatureInsuranceEnabled:                      getEnvBool("FEATURE_INSURANCE_ENABLED", false),
		FeatureStaysEnabled:                          getEnvBool("FEATURE_STAYS_ENABLED", false),
		FeaturePlacementEnabled:                      getEnvBool("FEATURE_PLACEMENT_ENABLED", false),
		FeatureMarketplaceEnabled:                    getEnvBool("FEATURE_MARKETPLACE_ENABLED", false),
		ElasticsearchURL:                             getEnv("ELASTICSEARCH_URL", ""),
		RunWorkersInProcess:                          getEnvBool("RUN_WORKERS_INPROCESS", false),
		FeatureSocialPayEnabled:                      getEnvBool("FEATURE_SOCIAL_PAY_ENABLED", false),
		FeatureP2PMarketEnabled:                      getEnvBool("FEATURE_P2P_MARKET_ENABLED", false),
		FeatureSavingsEnabled:                        getEnvBool("FEATURE_SAVINGS_ENABLED", false),
		FeatureTradingEnabled:                        getEnvBool("FEATURE_TRADING_ENABLED", false),
		FeatureAITradingEnabled:                      getEnvBool("FEATURE_AI_TRADING_ENABLED", false),
		TradingFeeBps:                                getEnvInt("TRADING_FEE_BPS", 2000),
		TradingHurdleBps:                             getEnvInt("TRADING_HURDLE_BPS", 0),
		SavingsEarlyBreakPenaltyBps:                  getEnvInt("SAVINGS_EARLY_BREAK_PENALTY_BPS", 1000),
		FeatureCreatorsEnabled:                       getEnvBool("FEATURE_CREATORS_ENABLED", false),
		FeatureLoyaltyEnabled:                        getEnvBool("FEATURE_LOYALTY_ENABLED", false),
		FeatureCommissionEnabled:                     getEnvBool("FEATURE_COMMISSION_ENABLED", false),
		FeatureHealthEnabled:                         getEnvBool("FEATURE_HEALTH_ENABLED", false),
		FeatureHealthPharmacyEnabled:                 getEnvBool("FEATURE_HEALTH_PHARMACY_ENABLED", false),
		FeatureHealthLabEnabled:                      getEnvBool("FEATURE_HEALTH_LAB_ENABLED", false),
		FeatureHealthVetEnabled:                      getEnvBool("FEATURE_HEALTH_VET_ENABLED", false),
		FeatureHealthIntakeEnabled:                   getEnvBool("FEATURE_HEALTH_INTAKE_ENABLED", false),
		FeatureHealthTriageEnabled:                   getEnvBool("FEATURE_HEALTH_TRIAGE_ENABLED", false),
		FeatureHealthTriageWhatsAppEnabled:           getEnvBool("FEATURE_HEALTH_TRIAGE_WHATSAPP_ENABLED", false),
		TriageEngine:                                 getEnv("TRIAGE_ENGINE", "mock"),
		InfermedicaAppID:                             getEnv("INFERMEDICA_APP_ID", ""),
		InfermedicaAppKey:                            getEnv("INFERMEDICA_APP_KEY", ""),
		InfermedicaBaseURL:                           getEnv("INFERMEDICA_BASE_URL", ""),
		TriageWhatsAppSecret:                         getEnv("TRIAGE_WHATSAPP_SECRET", ""),

		MapsConfigPath:            getEnv("MAPS_CONFIG_PATH", ""),
		MapsDefaultSurface:        getEnv("MAPS_DEFAULT_SURFACE", "default"),
		MapsProvider:              getEnv("MAPS_PROVIDER", "mock"),
		MapsBaseURL:               getEnv("MAPS_BASE_URL", ""),
		MapsAPIKey:                getEnv("MAPS_API_KEY", ""),
		MapsGeoapifyKey:           getEnv("MAPS_GEOAPIFY_KEY", ""),
		MapsMapTilerKey:           getEnv("MAPS_MAPTILER_KEY", ""),
		MapsOSRMBaseURL:           getEnv("MAPS_OSRM_BASE_URL", ""),
		MapsTileStyleURL:          getEnv("MAPS_TILE_STYLE_URL", ""),
		MapsGoogleKey:             getEnv("MAPS_GOOGLE_KEY", ""),
		MapsMapboxToken:           getEnv("MAPS_MAPBOX_TOKEN", ""),
		MapsRateLimitPerMin:       getEnvInt("MAPS_RATE_LIMIT_PER_MIN", 120),
		FinanceTransferRatePerMin: getEnvInt("FINANCE_TRANSFER_RATE_PER_MIN", 30),
		FinancePinRatePerMin:      getEnvInt("FINANCE_PIN_RATE_PER_MIN", 10),
		MapsBudgetAlertWebhook:    getEnv("MAPS_BUDGET_ALERT_WEBHOOK", ""),

		ConnectFreeVoteRatePerMin: getEnvInt("CONNECT_FREE_VOTE_RATE_PER_MIN", 30),
		ConnectPaidVoteRatePerMin: getEnvInt("CONNECT_PAID_VOTE_RATE_PER_MIN", 10),
		MapsHereKey:               getEnv("MAPS_HERE_KEY", ""),
		MapsGazetteerKey:          getEnv("MAPS_GAZETTEER_KEY", ""),
		MapsV2ConfigPath:          getEnv("MAPS_V2_CONFIG_PATH", ""),

		AnthropicAPIKey: getEnv("ANTHROPIC_API_KEY", ""),

		DoctorAIRatePerMin: getEnvInt("DOCTOR_AI_RATE_PER_MIN", 20),
		DoctorAIRatePerDay: getEnvInt("DOCTOR_AI_RATE_PER_DAY", 200),

		VideoSDKAPIKey: getEnv("VIDEOSDK_API_KEY", ""),
		VideoSDKSecret: getEnv("VIDEOSDK_SECRET", ""),

		ConnectVerificationPepper: getEnv("CONNECT_VERIFICATION_PEPPER", ""),

		R2AccountEndpoint: getEnv("R2_ACCOUNT_ENDPOINT", ""),
		// No default: the previous default ("spotlight-open-mic") does not exist
		// in the R2 account, and because Configured() only checks non-emptiness
		// the presign returned 200 while the upload died at the PUT with
		// NoSuchBucket. Empty fails closed at Configured() — an unset bucket
		// reports "uploads are not configured" up front.
		R2Bucket:          getEnv("R2_BUCKET", ""),
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

		// Auth throttling. Login/register/password-reset had no limit at all; these
		// are per-IP-per-route budgets. Deliberately tight — a real person signs in a
		// handful of times a minute, a credential-stuffer does not.
		AuthRateLimitPerMin:       getEnvInt("AUTH_RATE_LIMIT_PER_MIN", 10),
		AuthResetRateLimitPerHour: getEnvInt("AUTH_RESET_RATE_LIMIT_PER_HOUR", 5),

		ResendAPIKey:    getEnv("RESEND_API_KEY", ""),
		ResendFromEmail: getEnv("RESEND_FROM_EMAIL", "Spotlight <no-reply@spotlightng.com>"),

		FeatureOTPEmailEnabled:    getEnvBool("FEATURE_OTP_EMAIL_ENABLED", false),
		FeatureOTPLoginMFAEnabled: getEnvBool("FEATURE_OTP_LOGIN_MFA_ENABLED", false),
		BrevoAPIKey:               getEnv("BREVO_API_KEY", ""),
		BrevoSenderName:           getEnv("BREVO_SENDER_NAME", "Spotlight"),
		BrevoSenderEmail:          getEnv("BREVO_SENDER_EMAIL", ""),
		BrevoOTPTemplateID:        int64(getEnvInt("BREVO_OTP_TEMPLATE_ID", 0)),
		BrevoTimeoutSeconds:       getEnvInt("BREVO_TIMEOUT_SECONDS", 10),

		OTPPepper:                getEnv("OTP_PEPPER", ""),
		OTPLength:                getEnvInt("OTP_LENGTH", 6),
		OTPTTLMinutes:            getEnvInt("OTP_TTL_MINUTES", 10),
		OTPMaxAttempts:           getEnvInt("OTP_MAX_ATTEMPTS", 5),
		OTPResendCooldownSeconds: getEnvInt("OTP_RESEND_COOLDOWN_SECONDS", 60),
		OTPMaxSendsPerHour:       getEnvInt("OTP_MAX_SENDS_PER_HOUR", 5),
		OTPMaxSendsPerIPPerHour:  getEnvInt("OTP_MAX_SENDS_PER_IP_PER_HOUR", 20),
		OTPMaxVerifyPerIPPerHour: getEnvInt("OTP_MAX_VERIFY_PER_IP_PER_HOUR", 20),
		SignupRateLimitPer5Min:   getEnvInt("AUTH_SIGNUP_RATE_LIMIT_PER_5MIN", 30),
		AdminAppBaseURL:          getEnv("ADMIN_APP_BASE_URL", "https://admin.spotlightng.com"),
		TermiiAPIKey:             getEnv("TERMII_API_KEY", getEnv("TERMIL_LIVE_API_KEY", "")), // TERMIL_LIVE_API_KEY: legacy misspelled var on Railway
		TermiiSenderID:           getEnv("TERMII_SENDER_ID", "Paymax"),
		ExpoPushToken:            getEnv("EXPO_PUSH_TOKEN", ""),
	}
}

// IsProd reports whether this is a production deployment.
func (c Config) IsProd() bool {
	e := strings.ToLower(strings.TrimSpace(c.AppEnv))
	return e == "production" || e == "prod"
}

// isPlaceholder treats empty values and the common template markers as "unset"
// so a copied-but-unfilled .env fails validation instead of silently running.
func isPlaceholder(v string) bool {
	s := strings.TrimSpace(strings.ToLower(v))
	if s == "" {
		return true
	}
	for _, marker := range []string{"xxxx", "change_me", "changeme", "your_", "your-", "redacted", "placeholder", "todo"} {
		if strings.Contains(s, marker) {
			return true
		}
	}
	return false
}

// Validate enforces fail-fast secret validation: the service must not boot in
// production with missing, placeholder, or swapped secrets (e.g. a secret key
// in a public slot); in non-production the same checks log warnings so local
// dev keeps working with placeholders. Wired in main() before boot.
func (c Config) Validate() error {
	var problems []string

	// require: the value must be a real, non-placeholder secret.
	require := func(cond bool, name, value string) {
		if cond && isPlaceholder(value) {
			problems = append(problems, name+" is required but missing/placeholder")
		}
	}
	// prefix: guard against swapped keys (e.g. a public key in the secret slot).
	prefix := func(value, want, name string) {
		if !isPlaceholder(value) && !strings.HasPrefix(value, want) {
			problems = append(problems, fmt.Sprintf("%s does not start with %q — looks like the wrong/swapped key", name, want))
		}
	}

	// Core infrastructure — always required to serve real traffic.
	require(true, "DATABASE_URL", c.DatabaseURL)
	require(true, "SUPABASE_SERVICE_ROLE_KEY", c.SupabaseServiceRoleKey)
	// Local JWT verify (ADR-PR395) needs at least one verification material:
	// SUPABASE_URL (JWKS, covers ES256) or SUPABASE_JWT_SECRET (covers HS256).
	if c.AuthJWTLocalVerify && isPlaceholder(c.SupabaseURL) && isPlaceholder(c.SupabaseJWTSecret) {
		problems = append(problems, "AUTH_JWT_LOCAL_VERIFY requires SUPABASE_URL or SUPABASE_JWT_SECRET")
	}

	// Payment providers — required only when their money path is enabled.
	paymentsOn := c.FeatureWalletEnabled || c.FeatureBankTransfersEnabled
	require(paymentsOn, "PAYSTACK_SECRET_KEY", c.PaystackSecretKey)
	prefix(c.PaystackSecretKey, "sk_", "PAYSTACK_SECRET_KEY")

	require(c.FeatureBankTransfersEnabled, "MONNIFY_SECRET_KEY", c.MonnifySecretKey)

	require(c.FeatureMapleradEnabled, "MAPLERAD_SECRET_KEY", c.MapleradSecretKey)
	prefix(c.MapleradSecretKey, "mpr_", "MAPLERAD_SECRET_KEY")
	if c.IsProd() && c.FeatureMapleradEnabled && c.MapleradProd && strings.Contains(c.MapleradSecretKey, "sandbox") {
		problems = append(problems, "MAPLERAD_SECRET_KEY is a sandbox key but MAPLERAD_PROD=true")
	}

	// Multi-provider KYC verification (ADR-013): when enabled, at least one
	// provider must be configured and the PII encryption key is mandatory
	// (photos + government bio-data are stored encrypted at rest).
	if c.FeatureKYCVerifyEnabled {
		anyProvider := !isPlaceholder(c.DojahSecretKey) ||
			(!isPlaceholder(c.SmileIDPartnerID) && !isPlaceholder(c.SmileIDAPIKey)) ||
			!isPlaceholder(c.YouverifyToken)
		if !anyProvider {
			problems = append(problems, "FEATURE_KYC_VERIFY_ENABLED=true but no KYC provider is configured (need Dojah, Smile ID, or Youverify)")
		}
		require(true, "KYC_PII_ENC_KEY", c.KYCPIIEncKey)
		// The PII key must be a base64-encoded 32-byte (AES-256) key.
		if !isPlaceholder(c.KYCPIIEncKey) {
			if raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(c.KYCPIIEncKey)); err != nil || len(raw) != 32 {
				problems = append(problems, "KYC_PII_ENC_KEY must be base64 of exactly 32 bytes (AES-256)")
			}
		}
	}

	// Arena (ADR-014): merit entries must be signable — require at least one valid
	// Ed25519 signing seed (base64 32 bytes) when enabled. Any provided seed must
	// be well-formed.
	if c.FeatureArenaEnabled {
		seeds := map[string]string{
			"ARENA_SIGNING_SEED_THEORY":    c.ArenaSigningSeedTheory,
			"ARENA_SIGNING_SEED_PRACTICAL": c.ArenaSigningSeedPractical,
			"ARENA_SIGNING_SEED_FIRSTAID":  c.ArenaSigningSeedFirstAid,
		}
		anySeed := false
		for name, v := range seeds {
			if isPlaceholder(v) {
				continue
			}
			anySeed = true
			if raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(v)); err != nil || len(raw) != 32 {
				problems = append(problems, name+" must be base64 of exactly 32 bytes (Ed25519 seed)")
			}
		}
		if !anySeed {
			problems = append(problems, "FEATURE_ARENA_ENABLED=true but no ARENA_SIGNING_SEED_* is set — merit entries cannot be signed")
		}
		// Dedicated crown-award key (NDC-1 defense-in-depth). Optional — falls back to
		// the practical signer — but must be well-formed when provided.
		if !isPlaceholder(c.ArenaAwardSigningSeed) {
			if raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(c.ArenaAwardSigningSeed)); err != nil || len(raw) != 32 {
				problems = append(problems, "ARENA_AWARD_SIGNING_SEED must be base64 of exactly 32 bytes (Ed25519 seed)")
			}
		}
	}

	// Maps: required when the MapService is enabled. Address lookup degrades to a
	// mock/offline fallback if this is missing, so it is advisory (warn) — but in
	// production a missing Google key means no real geocoding.
	if c.FeatureMapsEnabled && isPlaceholder(c.MapsGoogleKey) {
		problems = append(problems, "MAPS_GOOGLE_KEY is missing while FEATURE_MAPS_ENABLED=true — address lookup will fall back to mock/offline")
	}

	if len(problems) == 0 {
		return nil
	}

	if c.IsProd() {
		return fmt.Errorf("config validation failed (%d problem(s)):\n  - %s",
			len(problems), strings.Join(problems, "\n  - "))
	}
	// Non-production: advisory only, never block local/dev boot.
	log.Printf("[config] %d configuration warning(s) (non-fatal in %s):", len(problems), c.AppEnv)
	for _, p := range problems {
		log.Printf("[config]   - %s", p)
	}
	return nil
}
