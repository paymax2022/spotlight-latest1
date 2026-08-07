package app

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"os"
	"spotlight/backend/internal/aicare"
	"spotlight/backend/internal/association"
	"spotlight/backend/internal/business"
	"spotlight/backend/internal/config"
	"spotlight/backend/internal/crowdfunding"
	cfadminext "spotlight/backend/internal/crowdfunding/adminext"
	cfcreator "spotlight/backend/internal/crowdfunding/creator"
	cfcsr "spotlight/backend/internal/crowdfunding/csr"
	cfengage "spotlight/backend/internal/crowdfunding/engage"
	cfinvestment "spotlight/backend/internal/crowdfunding/investment"
	cfwallet "spotlight/backend/internal/crowdfunding/wallet"
	"spotlight/backend/internal/crypto"
	"spotlight/backend/internal/doctor"
	"spotlight/backend/internal/estate"
	"spotlight/backend/internal/finance/disputes"
	"spotlight/backend/internal/finance/fx"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/kycverify"
	"spotlight/backend/internal/finance/ledger"
	mapleraddomain "spotlight/backend/internal/finance/maplerad"
	"spotlight/backend/internal/finance/ratings"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/transfers"
	"spotlight/backend/internal/finance/va"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/fractionalre"
	"spotlight/backend/internal/groups"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/integrations/llm"
	"spotlight/backend/internal/integrations/rtc"
	"spotlight/backend/internal/invest"
	"spotlight/backend/internal/maps"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/notifications"
	"spotlight/backend/internal/onboarding"
	"spotlight/backend/internal/orchestration"
	"spotlight/backend/internal/orchestration/adapters"
	"spotlight/backend/internal/pharmacy"
	platformCrypto "spotlight/backend/internal/platform/crypto"
	"spotlight/backend/internal/platform/queue"
	"spotlight/backend/internal/platform/r2"
	platformRedis "spotlight/backend/internal/platform/redis"
	platformWS "spotlight/backend/internal/platform/ws"
	"spotlight/backend/internal/property"
	providerInterfaces "spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/cac"
	"spotlight/backend/internal/provider/disbursement"
	"spotlight/backend/internal/provider/eversend"
	"spotlight/backend/internal/provider/maplerad"
	"spotlight/backend/internal/provider/monnify"
	"spotlight/backend/internal/provider/paystack"
	"spotlight/backend/internal/realtor"
	"spotlight/backend/internal/repositories"
	"spotlight/backend/internal/restaurant"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/telemedicine"
	"spotlight/backend/internal/trading"
	"spotlight/backend/internal/transport"
	"spotlight/backend/internal/votebridge"
	"spotlight/backend/internal/webhooks"
)

// registerFinanceRoutes wires up all financial module routes under /api/finance/...
// Each route group is gated behind its feature flag.
// If DATABASE_URL is not set, financial routes are skipped entirely.
//
// It RETURNS the *referrals.RewardService built by the Direct Referral Rewards engine
// (nil when the engine is flag-off or the pool is nil) so router.go can thread the
// emitter into Phase-1 revenue modules wired OUTSIDE this function — currently the
// Marketplace (RegisterMarketplace). Modules built INSIDE this function (the Maplerad
// bills domain) are wired with it directly here.
func registerFinanceRoutes(r *gin.Engine, cfg config.Config, supabase *integrations.SupabaseRestClient, rbac services.RBACService, pool *pgxpool.Pool) *referrals.RewardService {
	if cfg.DatabaseURL == "" {
		log.Println("[finance] DATABASE_URL not set — skipping financial routes")
		return nil
	}
	if pool == nil {
		log.Println("[finance] no database pool — skipping financial routes")
		return nil
	}

	// Direct Referral Rewards engine service, captured below when the flag is on and
	// threaded into the revenue modules that emit purchase events (PRD §2.5/§7.1).
	// Stays nil when FEATURE_REFERRAL_REWARDS_ENABLED is off — every emit is nil-safe.
	var rewardSvc *referrals.RewardService

	// Shared immutable-audit sink (NL-12 / SC-12 / HL-12). Built once here from the
	// same Supabase-backed audit repository the router uses, then threaded into the
	// money-path + health modules whose Register* previously passed a nil Auditor.
	// The concrete auditService satisfies each module's minimal Auditor interface
	// (identical LogAction signature). Every module remains nil-safe, but wiring the
	// real sink means their audit events actually persist in production.
	auditSink := services.NewAuditService(repositories.NewAuditSupabaseRepository(supabase))

	ctx := context.Background()

	var redisClient *platformRedis.Client
	if cfg.RedisURL != "" {
		rc, err := platformRedis.New(cfg.RedisURL)
		if err != nil {
			log.Printf("[finance] WARN: could not connect to Redis: %v — idempotency cache disabled", err)
		} else {
			redisClient = rc
		}
	}

	// --- MapService (built early so transport dispatch can consume it) ---
	// One interface, config-driven adapters; provider keys are server-side here.
	mapsAuth := func() gin.HandlerFunc {
		// RequireAuthContext validates the token and sets user_id/user_email before
		// it calls c.Next(); handlers read those directly, so no post-base mirror.
		return middleware.RequireAuthContext(supabase, rbac)
	}
	var mapSvc *maps.Service
	if cfg.FeatureMapsEnabled {
		ms, err := maps.NewServiceFromDeps(maps.RouteDeps{
			DB:              pool,
			Enabled:         true,
			ConfigPath:      cfg.MapsConfigPath,
			DefaultSurface:  cfg.MapsDefaultSurface,
			Provider:        cfg.MapsProvider,
			BaseURL:         cfg.MapsBaseURL,
			APIKey:          cfg.MapsAPIKey,
			GeoapifyKey:     cfg.MapsGeoapifyKey,
			MapTilerKey:     cfg.MapsMapTilerKey,
			OSRMBaseURL:     cfg.MapsOSRMBaseURL,
			TileStyleURL:    cfg.MapsTileStyleURL,
			GoogleKey:       cfg.MapsGoogleKey,
			MapboxToken:     cfg.MapsMapboxToken,
			Redis:           redisClient,
			AlertWebhook:    cfg.MapsBudgetAlertWebhook,
			RateLimitPerMin: cfg.MapsRateLimitPerMin,
			// MapService v2 (MAPSERVICE.md) — coverage-aware resolution chain.
			V2Enabled:    cfg.FeatureMapsV2Enabled,
			V2ConfigPath: cfg.MapsV2ConfigPath,
			HereKey:      cfg.MapsHereKey,
			GazetteerKey: cfg.MapsGazetteerKey,
		})
		if err != nil {
			log.Printf("[maps] config error: %v — maps disabled", err)
		} else {
			mapSvc = ms
			if cfg.FeatureMapsV2Enabled {
				// Seed coverage tiers + register the OSM contribution batch (best-effort).
				maps.RegisterMapsV2Background(ms, pool)
				// Admin cost/coverage/provider-health + contribution review console.
				maps.RegisterMapsV2Admin(r, pool,
					middleware.RequireAuthContext(supabase, rbac),
					middleware.RequirePermission(rbac, "map.admin.review"))
			}
		}
	}

	// --- Finance services ---
	ledgerRepo := ledger.NewRepository(pool)
	ledgerSvc := ledger.NewService(ledgerRepo, redisClient)

	// --- Internal service-authenticated ledger API (Stage 1.5c) ---
	// Exposes the authoritative double-entry ledger to the separate trading service
	// so it can post trade CASH legs here. Flag-gated (default OFF) + service-token
	// guarded (fail-closed when the token is unset). Additive — reuses ledgerSvc only.
	RegisterInternalLedgerAPI(r, cfg, ledgerSvc)

	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	kycSvc := kyc.NewService(pool)
	referralSvc := referrals.NewService(pool, ledgerSvc)

	// --- Providers ---
	var paymentProvider providerInterfaces.PaymentProvider
	var vaProvider providerInterfaces.VirtualAccountProvider

	if cfg.PaystackSecretKey != "" {
		ps := paystack.New(cfg.PaystackSecretKey)
		paymentProvider = ps
		vaProvider = ps
	}

	// Maplerad overrides VA provider when its key is set (preferred for NGN DVAs + FX).
	maplerадKey := cfg.MapleradSecretKey
	var maplerадClient *maplerad.Client
	if maplerадKey != "" {
		maplerадClient = maplerad.New(maplerадKey, cfg.MapleradProd)
		vaProvider = maplerадClient
		paymentProvider = maplerадClient // use Maplerad as payment provider too when available
	}

	// --- Multi-provider disbursement registry (Paystack + Monnify) ---
	// Each real client is wrapped with a deterministic mock fallback (mock-first
	// when creds blank / on transport error) so dev/CI run offline. The registry
	// holds them by Name, picks a configurable default, and auto-fails-over.
	var paystackDisb providerInterfaces.DisbursementProvider
	if cfg.PaystackSecretKey != "" {
		paystackDisb = paystack.New(cfg.PaystackSecretKey)
	}
	var monnifyDisb providerInterfaces.DisbursementProvider
	if cfg.MonnifyAPIKey != "" && cfg.MonnifySecretKey != "" {
		monnifyDisb = monnify.New(cfg.MonnifyAPIKey, cfg.MonnifySecretKey, cfg.MonnifyContractCode, cfg.MonnifyWebhookSecret, cfg.MonnifyProd)
	}
	disbRegistry := disbursement.NewRegistry(
		disbursement.Config{DefaultProvider: cfg.TransferProviderDefault, FailoverEnabled: cfg.TransferFailoverEnabled},
		disbursement.NewLive("paystack", paystackDisb),
		disbursement.NewLive("monnify", monnifyDisb),
	)

	xferSvc := transfers.NewService(pool, ledgerSvc, tiersSvc, paymentProvider, disbRegistry)

	// --- Module services ---
	vaSvc := va.NewService(pool, ledgerSvc, vaProvider)
	vaHandler := va.NewHandler(vaSvc)
	// Upgrading a user to Tier 1+ auto-provisions their NGN virtual account with
	// the provider (idempotent; also self-heals via GET /finance/va/me).
	kycSvc.WithVAProvisioner(vaSvc)

	var fxHandler *fx.Handler
	if maplerадClient != nil {
		fxSvc := fx.NewService(pool, ledgerSvc, maplerадClient, redisClient)
		fxHandler = fx.NewHandler(fxSvc)
	}

	// Webhook handler (needs paymentProvider for signature verification).
	var webhookHandler *webhooks.PaystackHandler
	if paymentProvider != nil {
		webhookHandler = webhooks.NewPaystackHandler(paymentProvider, vaSvc, xferSvc, walletSvc)
	}

	// --- Handlers ---
	walletHandler := wallet.NewHandler(walletSvc)
	kycHandler := kyc.NewHandler(kycSvc)
	referralHandler := referrals.NewHandler(referralSvc)
	// Transfers handler is flag-aware: each route family returns 503 when its
	// go-live flag is off (FEATURE_WALLET_TRANSFERS_ENABLED / FEATURE_BANK_TRANSFERS_ENABLED).
	transfersHandler := transfers.NewHandler(xferSvc, cfg.FeatureWalletTransfersEnabled, cfg.FeatureBankTransfersEnabled)
	transfersAdminHandler := transfers.NewAdminHandler(xferSvc)

	// Base finance group — all routes require auth. RequireAuthContext validates the
	// bearer token and sets user_id; requireUserID then fail-closes if it's missing.
	// (Previously only requireUserID was applied, so user_id was never set and every
	// finance route 401'd even with a valid token.)
	finance := r.Group("/api/finance")
	finance.Use(middleware.RequireAuthContext(supabase, rbac))
	finance.Use(requireUserID())

	// --- Transfer routes (wallet-to-wallet + wallet-to-bank) ---
	// Routes are always mounted; the handler returns 503 per family when the
	// corresponding go-live flag is off (gate: flag=false → 503). All money
	// mutations require an Idempotency-Key, post balanced ledger entries, and
	// enforce tier limits fail-closed inside the service.
	transferGroup := finance.Group("/transfers")
	transferGroup.GET("/paymax/resolve", transfersHandler.ResolvePaymax)
	transferGroup.POST("/paymax", transfersHandler.InitiatePaymax)
	transferGroup.POST("/bank", transfersHandler.InitiateBank)
	// Multi-provider bank payout surface (gated by FEATURE_BANK_TRANSFERS_ENABLED
	// inside the handler). Idempotency-Key required on initiates.
	transferGroup.POST("/bank-to-bank", transfersHandler.InitiateBankToBank)
	transferGroup.GET("/banks", transfersHandler.ListBanks)
	transferGroup.POST("/resolve-account", transfersHandler.ResolveAccount)
	transferGroup.GET("/beneficiaries", transfersHandler.ListBeneficiaries)
	transferGroup.POST("/beneficiaries", transfersHandler.SaveBeneficiary)
	transferGroup.DELETE("/beneficiaries/:id", transfersHandler.DeleteBeneficiary)
	transferGroup.GET("/pin/status", transfersHandler.PinStatus)
	transferGroup.POST("/pin", transfersHandler.SetPin)
	transferGroup.POST("/pin/verify", transfersHandler.VerifyPin)

	// --- Admin transfers console (RBAC finance.admin.transfers) ---
	// Mounted on the root engine with requireUserID + RequireAuthContext so the
	// permission middleware can read the caller; per-route RBAC fail-closed.
	transfersAdmin := r.Group("/api/finance/admin/transfers")
	transfersAdmin.Use(mapsAuth()) // RequireAuthContext + mirror user_id
	transfersAdmin.GET("", middleware.RequirePermission(rbac, "finance.admin.transfers"), transfersAdminHandler.List)
	transfersAdmin.GET("/provider-health", middleware.RequirePermission(rbac, "finance.admin.transfers"), transfersAdminHandler.ProviderHealth)
	transfersAdmin.GET("/:id", middleware.RequirePermission(rbac, "finance.admin.transfers"), transfersAdminHandler.Get)
	transfersAdmin.POST("/:id/retry", middleware.RequirePermission(rbac, "finance.admin.transfers"), transfersAdminHandler.Retry)
	transfersAdmin.POST("/:id/reverse", middleware.RequirePermission(rbac, "finance.admin.transfers"), transfersAdminHandler.Reverse)

	// --- KYC routes ---
	if cfg.FeatureKYCEnabled {
		kycGroup := finance.Group("/kyc")
		kycGroup.GET("/me", kycHandler.GetMe)
		kycGroup.POST("/initiate", kycHandler.Initiate)
	}

	// --- Wallet routes ---
	if cfg.FeatureWalletEnabled {
		walletGroup := finance.Group("/wallet")
		walletGroup.GET("/balance", walletHandler.GetBalance)
		walletGroup.GET("/transactions", walletHandler.ListTransactions)
	}

	// --- Virtual account routes ---
	if cfg.FeatureVirtualAccountsEnabled {
		vaGroup := finance.Group("/va")
		vaGroup.GET("/me", vaHandler.GetMe)
	}

	// --- Referral routes ---
	if cfg.FeatureReferralsEnabled {
		refGroup := finance.Group("/referrals")
		refGroup.GET("/me", referralHandler.GetMe)

		// Referral Earning System (PRD v1.1 incl. §7A default-referrer/house engine).
		// Member routes under /api/finance/referral/* (auth via finance group's
		// requireUserID); admin routes under /api/referral/admin/* with per-route
		// RBAC (referral.*) applied inside each Register fn. Pool may be nil in
		// REST-only deployments — the aggregators no-op on a nil pool.
		if pool != nil {
			referralMember := finance.Group("/referral")
			referralAdmin := r.Group("/api/referral/admin")
			referralAdmin.Use(requireUserID())
			RegisterReferral(referralMember, referralAdmin, pool, rbac)      // attribution/house/ledger/config (§7A)
			RegisterReferralEcon(referralMember, referralAdmin, pool, rbac)  // campaigns/gamification/overrides/merchant
			RegisterReferralTrust(referralMember, referralAdmin, pool, rbac) // risk/compliance/finance/analytics
		}
	}

	// --- Direct Referral Rewards ENGINE (single-level, purchase-triggered) ---
	// SUPERSEDES the §7A house/reassignment model with a no-network-depth design.
	// Mounted at NEW prefixes on the root engine (leaving the older
	// /api/finance/referral routes above intact — additive brownfield rule):
	//   user    : /v1/referrals/*         (Bearer; object-level authZ)
	//   admin   : /v1/admin/referrals/*   (per-route RBAC referral.admin.*)
	//   internal: /internal/referrals/*   (service-to-service X-Internal-Secret)
	// Gated by FEATURE_REFERRAL_REWARDS_ENABLED + a non-nil pool. Money reuses the
	// finance ledger (balanced double-entry credit; balanced reversal on refund).
	if cfg.FeatureReferralRewardsEnabled && pool != nil {
		// Capture the engine service so the Phase-1 revenue modules (bills, marketplace)
		// can emit PurchaseSettled/PurchaseRefunded into it (PRD §2.5/§7.1). rewardSvc
		// stays nil if the engine returns nil (nil pool), keeping all emits nil-safe.
		rewardSvc = RegisterReferralRewards(r, pool, rbac, mapsAuth(), cfg.ReferralRewardsInternalSecret)
	}

	// --- Insurance / Protection (Partnering Insurtech: MyCover + Octamile) ---
	// Member routes under /api/finance/insurance/* (auth via finance group);
	// admin under /api/insurance/admin/* (RBAC insurance.*); provider webhooks
	// under /internal/webhooks/{mycover,octamile} (UNauthenticated — signature
	// verified inside the gateway). Reuses wallet/ledger/settlement/kyc.
	if cfg.FeatureInsuranceEnabled && pool != nil {
		insuranceMember := finance.Group("/insurance")
		insuranceAdmin := r.Group("/api/insurance/admin")
		insuranceAdmin.Use(requireUserID())
		insuranceWebhooks := r.Group("/internal/webhooks")                                      // provider-signed, no user auth
		RegisterInsurance(insuranceMember, insuranceAdmin, pool, rbac)                          // gateway/catalog/policy/quote/saga/consent
		RegisterInsuranceClaims(insuranceMember, insuranceAdmin, insuranceWebhooks, pool, rbac) // claims/embedded/webhooks/reconciliation
	}

	// --- Hotel Booking / Stays (Property Suite, dual-rail supply gateway) ---
	// Member /api/finance/stays/* (auth via finance group); ops admin
	// /api/stays/admin/* (RBAC stays.admin.*); hotelier extranet
	// /api/stays/extranet/* (RBAC stays.hotelier.*, object-scoped); supplier
	// webhooks /internal/webhooks/stays-supplier (signature-verified, no user auth).
	// Reuses wallet/ledger/settlement (hold→charge→release saga, Naira payouts).
	if cfg.FeatureStaysEnabled && pool != nil {
		staysMember := finance.Group("/stays")
		staysAdmin := r.Group("/api/stays/admin")
		staysAdmin.Use(requireUserID())
		staysExtranet := r.Group("/api/stays/extranet")
		staysExtranet.Use(requireUserID())
		staysWebhooks := r.Group("/internal/webhooks")                                           // provider-signed, no user auth
		RegisterStays(staysMember, staysAdmin, pool, rbac)                                       // supply-gateway/search/prebook→book saga/pricing
		RegisterStaysExtranet(staysMember, staysAdmin, staysExtranet, staysWebhooks, pool, rbac) // ari/extranet/settlement/reviews/webhooks
	}

	// --- Featured Placement (paid landing-page promotion; booking over scarce ad
	// inventory with ledger escrow + guarded state machine + serving resolver) ---
	// Member /api/finance/placement/* (auth via finance group); admin
	// /api/placement/admin/* (per-route RBAC placement.admin.*); PUBLIC (no auth)
	// /api/finance/placement/{landing,events} mounted on the root engine (consumer
	// landing pages can't send a Bearer). Money REUSES the finance ledger: HOLD =
	// wallet.Debit (tier-checked) → PLACEMENT_ESCROW; REFUND = ledger.PostReversal;
	// RECOGNIZE = ledger.PostJournal → PLACEMENT_REVENUE.
	if cfg.FeaturePlacementEnabled && pool != nil {
		placementMember := finance // member.Group("/placement") is created inside RegisterPlacement
		placementAdmin := r.Group("/api/placement/admin")
		placementAdmin.Use(requireUserID())
		placementPublic := r.Group("/api/finance/placement") // unauthenticated landing/events
		RegisterPlacement(placementMember, placementAdmin, placementPublic, pool, rbac, ledgerSvc, walletSvc, tiersSvc)
	}

	// --- Top-5 expansion (no-new-licence; existing wallet/ledger/escrow rails) ---
	// Each module: member /api/finance/<mod>/* (auth via finance group) + admin
	// /api/<mod>/admin/* (RBAC <mod>.admin.*). Reuse scheduler/escrow/cashtag/
	// credential/points shared primitives. NL-1..12 invariants enforced in-module.
	if cfg.FeatureSavingsEnabled && pool != nil {
		RegisterSavings(finance.Group("/savings"), adminGroupTop5(r, "/api/savings/admin"), pool, rbac)
	}
	if cfg.FeatureSocialPayEnabled && pool != nil {
		RegisterSocialPay(finance.Group("/social"), adminGroupTop5(r, "/api/social/admin"), pool, rbac)
	}
	if cfg.FeatureEventsEnabled && pool != nil {
		RegisterEvents(finance.Group("/events"), adminGroupTop5(r, "/api/events/admin"), pool, rbac)
	}
	if cfg.FeatureLoyaltyEnabled && pool != nil {
		RegisterLoyalty(finance.Group("/loyalty"), adminGroupTop5(r, "/api/loyalty/admin"), pool, rbac)
		RegisterLoyaltyBlack(finance.Group("/loyalty"), adminGroupTop5(r, "/api/loyalty/admin/black"), pool, rbac)
	}
	if cfg.FeatureCreatorsEnabled && pool != nil {
		RegisterCreators(finance.Group("/creators"), adminGroupTop5(r, "/api/creators/admin"), pool, rbac)
	}
	if cfg.FeatureP2PMarketEnabled && pool != nil {
		RegisterP2PMarket(finance.Group("/p2p"), adminGroupTop5(r, "/api/p2p/admin"), pool, rbac, auditSink)
	}

	// --- Health verticals (marketplace; licensed partners deliver care) ---
	// Shared platform (providers/records/rx/consent/scheduling/consult/intake)
	// under FeatureHealthEnabled; each vertical additionally gated by its own
	// flag. Member /api/finance/health/<vertical>/* (auth via finance group);
	// admin /api/health/<vertical>/admin/* (RBAC health.<vertical>.*). Reuses
	// escrow (HELD→RELEASE→REFUND), scheduler, transport last-mile, wallet/ledger.
	if cfg.FeatureHealthEnabled && pool != nil {
		RegisterHealth(finance, adminGroupTop5(r, "/api/health/admin"), pool, rbac, cfg, auditSink) // shared platform
		if cfg.FeatureHealthPharmacyEnabled {
			pharmacySvc := RegisterHealthPharmacy(finance, adminGroupTop5(r, "/api/health/pharmacy/admin"), pool, rbac)
			// Symptom-based medication search addon — its own flag AND'd with
			// the pharmacy flag (FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED).
			if cfg.FeaturePharmacySymptomSearchEnabled {
				symptomSvc := RegisterHealthSymptomSearch(ctx, finance, adminGroupTop5(r, "/api/health/pharmacy/admin"), pool, redisClient, rbac)
				// Order seams (PRD §10 review cases + §5.5 quantity caps): hand
				// the symptom addon's collaborators to the pharmacy order flow.
				// Flag off ⇒ this block never runs ⇒ nil seams ⇒ CreateOrder
				// behavior unchanged.
				WireSymptomOrderSeams(pharmacySvc, symptomSvc, pool)
			}
		}
		if cfg.FeatureHealthLabEnabled {
			RegisterHealthLab(finance, adminGroupTop5(r, "/api/health/lab/admin"), pool, rbac, auditSink)
		}
		if cfg.FeatureHealthVetEnabled {
			RegisterHealthVet(finance, adminGroupTop5(r, "/api/health/vet/admin"), pool, rbac)
			// Mode-B (assisted) VCN verification: vet gets verified without ever
			// seeing the VCN portal; ops confirms out-of-band; capability granted
			// only on approval. Member /api/finance/health/vet/verification/*,
			// admin /api/health/vet/admin/verification/* (health.vet.review).
			RegisterHealthVCNVerification(finance, adminGroupTop5(r, "/api/health/vet/admin"), pool, rbac)
		}
		// AI Symptom Checker (triage & navigation, NOT diagnosis) — reuses the care
		// loop + wallet + clinician-governed red-flag layer. SC-1..SC-12 enforced.
		if cfg.FeatureHealthTriageEnabled {
			RegisterHealthTriage(r, finance, pool, rbac, ledgerSvc, mapSvc,
				cfg.AnthropicAPIKey, cfg.RedisURL, cfg.TriageEngine, cfg.InfermedicaAppID,
				cfg.InfermedicaAppKey, cfg.TriageWhatsAppSecret, cfg.FeatureHealthTriageWhatsAppEnabled, auditSink)
		}
	}

	// --- Spotlight Academy (K-12 EdTech, Phase 0 + Phase 1) ---
	// Reuses wallet ledger (reward credits), KYC/tiers, RBAC academy.*; exam
	// beachhead behind its own sub-flag. Member /api/finance/academy/*,
	// admin /api/academy/admin/* (+ /api/academy for identity/curriculum/commerce).
	if cfg.FeatureAcademyEnabled && pool != nil {
		academyRTC := rtc.NewIssuer(rtc.Config{
			AgoraAppID:          cfg.AgoraAppID,
			AgoraAppCertificate: cfg.AgoraAppCertificate,
			VideoSDKAPIKey:      cfg.VideoSDKAPIKey,
			VideoSDKSecret:      cfg.VideoSDKSecret,
		})
		// RAILS_MODE seam: select the HTTP fake/sandbox/live adapters for the four
		// unbacked academy rails (BNPL/payout/disburse/billing). nil per-rail ⇒ that
		// package keeps its in-process dev stub (academy_rails_external.go).
		academyBNPL, academyDisburse, academyBilling, academyPayout := academyRails(cfg)
		RegisterAcademy(r, finance, pool, rbac, ledgerSvc, academyRTC, academyBNPL, academyDisburse, academyBilling, academyPayout, paymentProvider, cfg.FeatureAcademyExamEnabled, cfg.FeatureAcademySpineEnabled, cfg.FeatureAcademyEduPayEnabled, cfg.FeatureAcademyCredentialsEnabled, cfg.FeatureAcademyLiveEnabled, cfg.FeatureAcademySchoolsEnabled, cfg.FeatureAcademyTutorEnabled, cfg.FeatureAcademyFeesEnabled, webhookHandler)

		// EdTech PLATFORM super-admin oversight (SU-01..SU-12): read-only cross-tenant
		// console backend at /api/academy/admin/platform/*, gated purely by the seeded
		// platform_edtech_admin capability. Behind the academy fees flag (the same flag
		// that lights up the fees data these screens observe). No money path.
		if cfg.FeatureAcademyFeesEnabled {
			RegisterAcademyPlatform(r, pool, rbac, middleware.RequireAuthContext(supabase, rbac))
		}

		// Inbound academy rail webhooks (signature-verified, idempotent), mounted on
		// the unauthenticated /internal/webhooks group. Only when RAILS_MODE is active.
		if m := strings.ToLower(strings.TrimSpace(cfg.RailsMode)); m != "" && m != "off" {
			academyWebhookGroup := r.Group("/internal/webhooks") // provider-signed, no user auth
			awh := newAcademyWebhookHandler(context.Background(), pool, ledgerSvc, cfg)
			registerAcademyWebhooks(academyWebhookGroup, awh)
		}
	}

	// --- FX routes (legacy single-provider wallet FX) ---
	if cfg.FeatureFXEnabled && fxHandler != nil {
		fxGroup := finance.Group("/fx")
		fxGroup.POST("/quote", fxHandler.GetQuote)
		fxGroup.POST("/convert", fxHandler.Convert)
		fxGroup.GET("/history", fxHandler.ListHistory)
		fxGroup.GET("/wallets/:currency", fxHandler.GetWallet)
	}

	// --- FX Orchestration (normalized, provider-agnostic /v1 API) ---
	// Smart order routing across Eversend + Maplerad, spread engine, treasury,
	// unified multi-currency ledger, quote->lock->execute with idempotency.
	if cfg.FeatureFXOrchestrationEnabled {
		orchStore := orchestration.NewSQLStore(pool)

		// Maplerad: live HTTP adapter when a secret key is configured, else the
		// deterministic adapter (keeps the corridor routable in dev/CI).
		var mplProvider orchestration.Provider
		if cfg.MapleradSecretKey != "" {
			mplProvider = adapters.NewMapleradLive(
				maplerad.New(cfg.MapleradSecretKey, cfg.MapleradProd),
				cfg.MapleradWebhookSecret, cfg.MapleradProd,
			)
			log.Println("[finance] FX orchestration: Maplerad LIVE adapter enabled")
		} else {
			mplProvider = adapters.NewMapleradFX(cfg.MapleradProd)
		}
		// Eversend: live HTTP adapter when client credentials are configured.
		var evsProvider orchestration.Provider
		if cfg.EversendClientID != "" && cfg.EversendClientSecret != "" {
			evsProvider = adapters.NewEversendLive(
				eversend.New(cfg.EversendClientID, cfg.EversendClientSecret, cfg.EversendProd),
				cfg.EversendWebhookSecret, cfg.EversendProd,
			)
			log.Println("[finance] FX orchestration: Eversend LIVE adapter enabled")
		} else {
			evsProvider = adapters.NewEversend(cfg.EversendProd)
		}
		providers := []orchestration.Provider{
			evsProvider,
			mplProvider,
		}
		spreadEngine := orchestration.NewSpreadEngine(105,
			orchestration.SpreadRule{Corridor: "USD-NGN", Tier: "business", BPS: 75, MinBPS: 50, MaxBPS: 150},
			orchestration.SpreadRule{Corridor: "USD-NGN", BPS: 120, MinBPS: 80, MaxBPS: 200},
			orchestration.SpreadRule{Corridor: "USD-XAF", BPS: 150, MinBPS: 100, MaxBPS: 250},
		)
		treasury := orchestration.NewTreasury([]orchestration.FloatBucket{
			{Provider: "eversend", Currency: "USD", BalanceMinor: 820_000_00, LowWaterMinor: 200_000_00, HighWaterMinor: 1_000_000_00, ExposureLimitMinor: 5_000_000_00},
			{Provider: "eversend", Currency: "NGN", BalanceMinor: 1_800_000_000_00, LowWaterMinor: 250_000_000_00, HighWaterMinor: 9_000_000_000_00, ExposureLimitMinor: 50_000_000_000_00},
			{Provider: "maplerad", Currency: "NGN", BalanceMinor: 2_400_000_000_00, LowWaterMinor: 250_000_000_00, HighWaterMinor: 9_000_000_000_00, ExposureLimitMinor: 50_000_000_000_00},
			{Provider: "maplerad", Currency: "USD", BalanceMinor: 600_000_00, LowWaterMinor: 150_000_00, HighWaterMinor: 800_000_00, ExposureLimitMinor: 4_000_000_00},
			{Provider: "maplerad", Currency: "XAF", BalanceMinor: 420_000_000_00, LowWaterMinor: 100_000_000_00, HighWaterMinor: 500_000_000_00, ExposureLimitMinor: 5_000_000_000_00},
		})
		// Quote lifecycle: Redis-backed when available (multi-instance safe),
		// else in-memory.
		var quoteStore orchestration.QuoteStore
		if redisClient != nil {
			quoteStore = orchestration.NewRedisQuoteBook(redisClient, 90*time.Second)
		}

		// Rate-integrity feed: versioned, staleness- and spike-guarded rate store
		// (RT-002/RT-005/RT-006). Seeded from the deterministic baseline and kept
		// fresh by a refresher until live provider ticks call Publish directly; a
		// stale corridor rate then blocks quoting fail-closed.
		rateFeed := orchestration.NewRateFeed(orchestration.RateFeedConfig{
			TTL: 30 * time.Minute, MaxDeviationPct: 10, Source: "baseline",
		})
		orchestration.StartRateFeedRefresher(ctx, rateFeed, 5*time.Minute)

		// Limits & velocity: per-tier per-txn/daily/monthly caps + anti-structuring
		// throttle, denominated in USD and normalized via the mid rate (TS-8). Usage
		// is ledger-derived. A hard gate before any conversion is priced.
		limitsEngine := orchestration.NewLimitsEngine("USD",
			orchestration.LimitRule{PerTxnMinMinor: 1_00, PerTxnMaxMinor: 10_000_00, DailyMaxMinor: 20_000_00, MonthlyMaxMinor: 100_000_00, MaxTxnsPerHour: 30},
			map[string]orchestration.LimitRule{
				"business": {PerTxnMinMinor: 1_00, PerTxnMaxMinor: 250_000_00, DailyMaxMinor: 1_000_000_00, MonthlyMaxMinor: 5_000_000_00, MaxTxnsPerHour: 200},
			},
			orchestration.NewStoreUsage(orchStore, "USD"),
		)

		orchSvc := orchestration.NewService(providers, orchStore, orchestration.Options{
			Spread: spreadEngine, Treasury: treasury, QuoteStore: quoteStore, Rates: rateFeed, Limits: limitsEngine, LockWindow: 90 * time.Second,
		})
		// Outbound webhooks (signed) to the caller endpoint, when configured.
		orchSvc.SetEmitter(orchestration.NewWebhookEmitter(cfg.PaymaxWebhookOutURL, cfg.PaymaxWebhookSecret))
		// Automated treasury rebalancing + balance.low alerts.
		orchestration.StartTreasuryMonitor(ctx, orchSvc, time.Minute)
		// Daily reconciliation (ledger-derived source until a provider settlement
		// feed is wired). Emits recon.completed per provider.
		orchestration.StartReconScheduler(ctx, orchSvc, orchestration.NewLedgerSettlementSource(orchStore), 24*time.Hour)

		// Secondary store persists beneficiaries + rate alerts (orch_beneficiaries,
		// orch_rate_alerts). Not money-path; scoped by customer_id in the handlers.
		orchHandler := orchestration.NewHandler(orchSvc).
			WithSecondary(orchestration.NewSecondaryStore(pool)).
			WithBusiness(orchestration.NewBusinessStore(pool))

		og := r.Group("/api/v1/fx")
		// RequireAuthContext validates the bearer token and mirrors user_id into the
		// gin context; requireUserID then fail-closes if it's missing. Without the
		// mirror, requireUserID would 401 every call even with a valid token (same
		// bug the base finance group documents above).
		og.Use(mapsAuth())
		og.Use(requireUserID())
		og.POST("/quotes", orchHandler.CreateQuote)
		og.POST("/quotes/:id/lock", orchHandler.LockQuote)
		og.POST("/conversions", orchHandler.CreateConversion)
		og.POST("/transfers", orchHandler.CreateTransfer)
		og.POST("/collections/virtual-accounts", orchHandler.CreateCollection)
		og.GET("/rates", orchHandler.GetRates)
		og.GET("/balances", orchHandler.GetBalances)
		og.GET("/transactions", orchHandler.ListTransactions)
		og.GET("/transactions/:id", orchHandler.GetTransaction)
		// --- Secondary FX endpoints the mobile app calls (handler_stubs.go) ------
		// Contract-shaped placeholders so flipping EXPO_PUBLIC_FX_USE_MOCK=false to
		// test the real exchange path doesn't 404 on these not-yet-backed features.
		// None are money-path; replace with persistence-backed handlers when built.
		og.POST("/balances", orchHandler.AddWallet)
		og.GET("/rates/history", orchHandler.GetRateHistory)
		og.GET("/transfers/:reference", orchHandler.GetTransferByReference)
		og.GET("/collections", orchHandler.ListCollections)
		og.GET("/collections/virtual-accounts", orchHandler.ListVirtualAccounts)
		og.GET("/beneficiaries", orchHandler.ListBeneficiaries)
		og.POST("/beneficiaries", orchHandler.CreateBeneficiary)
		og.POST("/beneficiaries/validate", orchHandler.ValidateBeneficiary)
		og.PUT("/beneficiaries/:id", orchHandler.UpdateBeneficiary)
		og.PATCH("/beneficiaries/:id", orchHandler.FavoriteBeneficiary)
		og.DELETE("/beneficiaries/:id", orchHandler.DeleteBeneficiary)
		og.POST("/transactions/:id/dispute", orchHandler.DisputeTransaction)
		og.GET("/rate-alerts", orchHandler.ListRateAlerts)
		og.POST("/rate-alerts", orchHandler.CreateRateAlert)
		og.DELETE("/rate-alerts/:id", orchHandler.DeleteRateAlert)
		// --- FX business-admin console (handler_business.go / business_store.go).
		// Team, approvals+thresholds, activity/audit, api-keys, webhooks, settings,
		// and notifications persist to the orch_fx_* tables (scoped by business_id =
		// customer id). limits reads real tier config. NOT money-path: no ledger, no
		// idempotency; approvals persist a DECISION only (money stays on the transfer
		// path). Mutations write an immutable audit row; api-keys store a hash only.
		og.GET("/team", orchHandler.ListTeam)
		og.PATCH("/team/:id", orchHandler.UpdateMemberRole)
		og.GET("/approvals", orchHandler.ListApprovals)
		og.POST("/approvals/:id/approve", orchHandler.ApproveApproval)
		og.POST("/approvals/:id/reject", orchHandler.RejectApproval)
		og.GET("/approvals/thresholds", orchHandler.ListApprovalThresholds)
		og.PATCH("/approvals/thresholds/:id", orchHandler.UpdateThreshold)
		og.GET("/activity", orchHandler.ListActivity)
		og.GET("/api-keys", orchHandler.ListAPIKeys)
		og.POST("/api-keys", orchHandler.CreateAPIKey)
		og.POST("/api-keys/:id/rotate", orchHandler.RotateAPIKey)
		og.GET("/webhooks", orchHandler.ListWebhookSettings)
		og.POST("/webhooks", orchHandler.CreateWebhook)
		og.PATCH("/webhooks/:id", orchHandler.UpdateWebhook)
		og.DELETE("/webhooks/:id", orchHandler.DeleteWebhook)
		og.GET("/settings", orchHandler.GetSettings)
		og.PATCH("/settings", orchHandler.UpdateSettings)
		og.PATCH("/settings/notifications", orchHandler.UpdateNotificationPrefs)
		og.POST("/settings/stablecoin-addresses", orchHandler.AddStablecoinAddress)
		og.DELETE("/settings/stablecoin-addresses/:id", orchHandler.RemoveStablecoinAddress)
		og.GET("/limits", orchHandler.GetLimits)
		og.GET("/notifications", orchHandler.ListNotifications)
		og.PATCH("/notifications/:id", orchHandler.MarkNotificationRead)
		og.POST("/notifications/read-all", orchHandler.MarkAllNotificationsRead)
		// --- FX virtual cards (handler_cards.go) — STUBS, no issuer wired yet.
		// Consistent :id param across all card sub-routes (gin requires it).
		og.GET("/cards", orchHandler.ListCards)
		og.POST("/cards", orchHandler.CreateCard)
		og.GET("/cards/:id", orchHandler.GetCard)
		og.GET("/cards/:id/transactions", orchHandler.ListCardTransactions)
		og.POST("/cards/:id/reveal", orchHandler.RevealCard)
		og.POST("/cards/:id/fund", orchHandler.FundCard)
		og.POST("/cards/:id/freeze", orchHandler.FreezeCard)
		og.POST("/cards/:id/unfreeze", orchHandler.UnfreezeCard)
		og.POST("/cards/:id/terminate", orchHandler.TerminateCard)
		og.PATCH("/cards/:id/controls", orchHandler.UpdateCardControls)
		// Inbound provider webhooks (no auth; provider-signed).
		r.POST("/api/v1/fx/webhooks/:provider", orchHandler.InboundWebhook)
		log.Println("[finance] FX orchestration routes registered at /api/v1/fx")
	}

	// --- Webhook routes (no auth — providers call these directly; body-signed) ---
	if webhookHandler != nil {
		r.POST("/api/webhooks/paystack/go", webhookHandler.Handle)
	}
	// Monnify disbursement/collection webhooks — unauthenticated + signature
	// verified inside the handler. Settles via the same provider-routed path
	// (keyed by provider_transfer_ref / funding_reference).
	if monnifyDisb, ok := xferSvc.ProviderByName("monnify"); ok {
		monnifyWH := webhooks.NewMonnifyHandler(monnifyDisb, xferSvc)
		r.POST("/api/webhooks/monnify/go", monnifyWH.Handle)
	}

	// --- Maplerad WaaS DOMAIN money path (ADR-012, NGN v1) ---
	// Gated by FEATURE_MAPLERAD_ENABLED (no flag, no money path). The domain
	// service depends ONLY on the provider GATEWAY PORTS — the concrete Maplerad
	// client (built with its webhook secret) is injected as all five ports. Member
	// routes are auth'd via the finance group's requireUserID; the webhook is
	// mounted UNAUTHENTICATED (signature verified inside the handler); the
	// reconcile + orphan-sweep jobs run as ctx-scoped goroutines.
	if cfg.FeatureMapleradEnabled && pool != nil {
		mplClient := maplerad.New(cfg.MapleradSecretKey, cfg.MapleradProd).
			WithWebhookSecret(cfg.MapleradWebhookSecret)
		mplSvc := mapleraddomain.NewService(mapleraddomain.Deps{
			Pool:         pool,
			Ledger:       ledgerSvc,
			Tiers:        tiersSvc,
			VA:           vaSvc,
			Identity:     mplClient,
			Wallet:       mplClient,
			Bills:        mplClient,
			Disbursement: mplClient,
			VAPort:       mplClient,
		})
		// Thread the Direct Referral Rewards emitter into the bills path (PRD §2.5/§7.1).
		// OPTIONAL + nil-safe: only wire a NON-nil concrete service. Passing a typed-nil
		// *referrals.RewardService through the interface setter would produce a non-nil
		// interface wrapping a nil pointer (the classic Go nil-interface trap) and the
		// `!= nil` guard would then call a method on nil — so we gate on rewardSvc here.
		// When FEATURE_REFERRAL_REWARDS_ENABLED is off the emitter stays nil and a
		// settled bill simply skips the emit. On success the domain calls
		// emitter.OnPurchaseSettled{Module:"bills", ...} post-commit.
		if rewardSvc != nil {
			mplSvc.WithReferralEmitter(rewardSvc)
		}
		mplHandler := mapleraddomain.NewHandler(mplSvc)

		mplGroup := finance.Group("/maplerad")
		mplGroup.POST("/customer", mplHandler.CreateCustomer)
		mplGroup.POST("/virtual-account", mplHandler.OpenVirtualAccount)
		mplGroup.POST("/transfers", mplHandler.InitiateTransfer)
		mplGroup.GET("/transfers/:ref", mplHandler.GetTransfer)
		mplGroup.POST("/bills", mplHandler.PurchaseBill)

		// Unauthenticated webhook (body-signed; verified inside the handler).
		mplWH := webhooks.NewMapleradHandler(mplClient, mplSvc)
		r.POST("/api/webhooks/maplerad/go", mplWH.Handle)

		// Background reconciliation: daily full recon + hourly orphan sweep.
		mapleraddomain.StartReconcile(ctx, mplSvc, 24*time.Hour)
		mapleraddomain.StartOrphanSweep(ctx, mplSvc, time.Hour)
		log.Println("[finance] Maplerad WaaS domain routes + webhook + jobs registered")
	}

	// --- Multi-provider KYC verification gateway (ADR-013) ---
	// Gated by FEATURE_KYC_VERIFY_ENABLED (default off). Builds the adapter
	// registry from config (only providers with non-empty creds are registered;
	// failover skips the rest), the PII cipher (AES-256-GCM), and the domain
	// service depending on provider PORTS only. Member routes are auth'd via the
	// finance group's requireUserID; the webhook group is mounted UNAUTHENTICATED
	// (signature verified inside the handler); admin routes are RBAC-gated
	// (finance.admin.kyc). Tier elevation reuses the KYC core (kyc.Service.Approve).
	if cfg.FeatureKYCVerifyEnabled && pool != nil {
		kvReg := kycverify.BuildRegistry(cfg)

		var kvCipher *platformCrypto.Cipher
		if cfg.KYCPIIEncKey != "" {
			if ci, err := platformCrypto.NewCipherFromBase64Key(cfg.KYCPIIEncKey); err != nil {
				log.Printf("[finance] KYC verify: invalid KYC_PII_ENC_KEY: %v — PII store fails closed", err)
			} else {
				kvCipher = ci
			}
		}

		// Tier elevation reuses the KYC core: a thin adapter over kyc.Service.Approve
		// keeps kycverify decoupled from the kyc package's concrete Profile type.
		var kvElevator kycverify.TierElevator = kycTierElevator{svc: kycSvc}

		kvSvc := kycverify.NewService(kycverify.Deps{
			Pool:     pool,
			Registry: kvReg,
			Cipher:   kvCipher,
			Elevator: kvElevator,
			Seed: kycverify.RoutingSeed{
				IDNumber:  cfg.KYCRouteIDNumber,
				IDFacial:  cfg.KYCRouteIDFacial,
				Liveness:  cfg.KYCRouteLiveness,
				Document:  cfg.KYCRouteDocument,
				AML:       cfg.KYCRouteAML,
				Threshold: cfg.KYCFacialMatchThreshold,
			},
			FacialThreshold: cfg.KYCFacialMatchThreshold,
		})
		kvHandler := kycverify.NewHandler(kvSvc)

		// Member routes (auth via the finance group's requireUserID).
		kvGroup := finance.Group("/kyc")
		kvGroup.POST("/session", kvHandler.StartSession)
		kvGroup.GET("/session/:id", kvHandler.GetSession)
		kvGroup.POST("/consent", kvHandler.RecordConsent)
		kvGroup.POST("/checks/id-number", kvHandler.CheckIDNumber)
		kvGroup.POST("/checks/facial", kvHandler.CheckFacial)
		kvGroup.POST("/checks/liveness", kvHandler.CheckLiveness)
		kvGroup.POST("/checks/document", kvHandler.CheckDocument)
		kvGroup.POST("/checks/aml", kvHandler.CheckAML)
		kvGroup.POST("/sdk-token", kvHandler.SDKToken)

		// Webhooks — UNAUTHENTICATED (signature verified inside the handler),
		// mounted OUTSIDE the auth-required finance group.
		r.POST("/api/kyc/webhooks/:provider", kvHandler.Webhook)

		// Admin console (RBAC finance.admin.kyc). Mounted on the root engine with
		// requireUserID + RequireAuthContext so the permission middleware can read
		// the caller; per-route RBAC fail-closed.
		kvAdmin := r.Group("/api/finance/admin/kyc")
		kvAdmin.Use(mapsAuth()) // RequireAuthContext + mirror user_id
		kvAdmin.GET("/review-queue", middleware.RequirePermission(rbac, "finance.admin.kyc"), kvHandler.ReviewQueue)
		kvAdmin.GET("/cases/:id", middleware.RequirePermission(rbac, "finance.admin.kyc"), kvHandler.GetCase)
		kvAdmin.POST("/cases/:id/approve", middleware.RequirePermission(rbac, "finance.admin.kyc"), kvHandler.ApproveCase)
		kvAdmin.POST("/cases/:id/reject", middleware.RequirePermission(rbac, "finance.admin.kyc"), kvHandler.RejectCase)
		kvAdmin.GET("/routing-rules", middleware.RequirePermission(rbac, "finance.admin.kyc"), kvHandler.ListRoutingRules)
		kvAdmin.PUT("/routing-rules/:check_type", middleware.RequirePermission(rbac, "finance.admin.kyc"), kvHandler.UpdateRoutingRule)
		kvAdmin.GET("/events", middleware.RequirePermission(rbac, "finance.admin.kyc"), kvHandler.Events)

		log.Println("[finance] KYC verification gateway routes + webhook registered")
	}

	// --- Groups routes ---
	if cfg.FeatureGroupsEnabled {
		groupsSvc := groups.NewService(pool, ledgerSvc)
		groupsHandler := groups.NewHandler(groupsSvc)
		grp := finance.Group("/groups")
		grp.POST("", groupsHandler.Create)
		grp.GET("", groupsHandler.List)
		grp.GET("/:id", groupsHandler.Get)
		grp.POST("/:id/invite", groupsHandler.Invite)
		grp.POST("/:id/dues", groupsHandler.PayDues)
	}

	// --- Association (group membership) money-path + approvals ---
	if cfg.FeatureAssociationsEnabled {
		assocSvc := association.NewService(pool, ledgerSvc)
		// Membership-card QR signing key, derived from a stable server secret so
		// signed cards verify consistently across hosts/restarts. Empty in dev →
		// the service keeps its built-in dev key (SetCardSigningSecret ignores "").
		assocSvc.SetCardSigningSecret(cfg.SupabaseServiceRoleKey)
		assocHandler := association.NewHandler(assocSvc)
		association.RegisterRoutes(finance.Group("/associations"), assocHandler)
	}

	// --- Events routes ---
	// Superseded by the top5events module (RegisterEvents, wired earlier in this
	// file under FeatureEventsEnabled — see ~line 359-360), which is the
	// canonical, comprehensive event ticketing + cashless event wallet system the
	// mobile app is built against. The legacy backend/internal/events package
	// (simple ticketing CMS) is intentionally left UNWIRED here but NOT deleted,
	// per the brownfield iron rule (never edit/remove existing Spotlight module
	// files — only router wiring may change). Do not re-add this block without
	// first confirming top5events is not the desired implementation.

	// --- Estate routes ---
	if cfg.FeatureEstateEnabled {
		estateSvc := estate.NewService(pool, redisClient).
			WithLedger(ledgerSvc). // Block 29 dues money path: balanced double-entry
			WithTiers(tiersSvc).   // fail-closed tier-limit check on wallet debit
			// Block 31: KYC-gated elections. Adapts *kyc.Service to the estate
			// KYCVerifier interface; a voter is "verified" at KYC status=verified.
			WithKYC(estate.KYCVerifierFunc(func(ctx context.Context, userID string) (bool, error) {
				p, err := kycSvc.GetProfile(ctx, userID)
				if err != nil {
					return false, err
				}
				return p.Status == kyc.StatusVerified, nil
			})).
			// Block 33: AI note-taking uses claude-sonnet-4-6 (per playbook). An
			// empty API key yields a disabled client → endpoints fail closed.
			WithLLM(llm.NewAnthropicClient(cfg.AnthropicAPIKey).WithModel("claude-sonnet-4-6"))
		if mapSvc != nil {
			estateSvc = estateSvc.WithGeocoder(maps.NewLocationGeocoder(mapSvc))
		}
		// Block 37/43: push delivery. The adapter resolves the recipient's device
		// push tokens and enqueues via the platform notifications queue (asynq).
		// In-app feed rows are persisted by the estate service regardless; only
		// push is skipped when Redis/queue is unavailable.
		if cfg.RedisURL != "" {
			if asynqClient, qerr := queue.NewClient(cfg.RedisURL); qerr == nil {
				notifSvc := notifications.NewService(asynqClient)
				estateSvc = estateSvc.WithNotifier(estate.NotifierFunc(func(ctx context.Context, n estate.EstateNotification) error {
					rows, err := pool.Query(ctx, `SELECT token FROM device_push_tokens WHERE user_id=$1`, n.UserID)
					if err != nil {
						return err
					}
					defer rows.Close()
					var tokens []string
					for rows.Next() {
						var tok string
						if rows.Scan(&tok) == nil {
							tokens = append(tokens, tok)
						}
					}
					for _, tok := range tokens {
						_ = notifSvc.Send(ctx, notifications.Notification{
							UserID:    n.UserID,
							Event:     notifications.Event(n.Type),
							Title:     n.Title,
							Body:      n.Body,
							Data:      n.Data,
							Channels:  []notifications.Channel{notifications.ChannelPush},
							PushToken: tok,
						})
					}
					return nil
				}))
			}
		}
		// Backend-owned presigned R2 uploads (profile photo / vehicle doc / incident
		// evidence / repair photos / documents). Unconfigured creds → the presign
		// endpoint fails closed with 503. Bucket default mirrors CLAUDE.md.
		estatePresigner := r2.New(r2.Config{
			AccountEndpoint: cfg.R2AccountEndpoint,
			Bucket:          cfg.R2Bucket,
			AccessKeyID:     cfg.R2AccessKeyID,
			SecretAccessKey: cfg.R2SecretAccessKey,
			Region:          cfg.R2Region,
		})
		estateHandler := estate.NewHandler(estateSvc).
			WithPresigner(estatePresigner, cfg.R2Bucket)
		estGroup := finance.Group("/estate")

		// Presigned uploads (Blocks 25/28/35/39)
		estGroup.POST("/:id/uploads/presign", estateHandler.PresignUpload)

		// Core (Block 16/23)
		estGroup.GET("", estateHandler.ListEstates)
		estGroup.POST("", estateHandler.CreateEstate)
		estGroup.POST("/:id/residents", estateHandler.AddResident)
		estGroup.POST("/:id/passes", estateHandler.IssuePass)
		estGroup.POST("/:id/passes/scan", estateHandler.ScanPass)
		estGroup.POST("/:id/elections", estateHandler.CreateElection)
		estGroup.POST("/:id/elections/:electionId/vote", estateHandler.CastVote)
		estGroup.GET("/:id/elections/:electionId/results", estateHandler.GetResults)
		// Block 31: per-election voter eligibility (KYC / payment / resident type)
		estGroup.GET("/:id/elections/:electionId/eligibility", estateHandler.GetVoterEligibility)
		estGroup.POST("/:id/elections/:electionId/eligibility", estateHandler.SetEligibilityRules)

		// Block 24: Onboarding & property selection
		estGroup.POST("/:id/invite-codes", estateHandler.GenerateInviteCode)
		estGroup.POST("/join/invite", estateHandler.JoinWithInviteCode)
		estGroup.POST("/:id/access-request", estateHandler.RequestAccess)
		estGroup.GET("/:id/access-request/me", estateHandler.GetMyJoinRequest)
		estGroup.GET("/:id/access-requests", estateHandler.ListJoinRequests)
		estGroup.POST("/:id/access-requests/:reqId/review", estateHandler.ReviewJoinRequest)
		estGroup.GET("/:id/properties", estateHandler.ListProperties)
		estGroup.POST("/:id/properties", estateHandler.AddProperty)
		estGroup.POST("/:id/properties/:pid/claim", estateHandler.ClaimOwnership)
		estGroup.POST("/:id/properties/:pid/claims/:claimId/review", estateHandler.ReviewOwnershipClaim)
		estGroup.POST("/:id/properties/:pid/tenancy", estateHandler.CreateTenancyRequest)
		estGroup.POST("/:id/properties/:pid/tenancy/:tid/review", estateHandler.ReviewTenancyRequest)

		// Block 29: Property management
		estGroup.GET("/:id/properties/:pid", estateHandler.GetProperty)
		estGroup.PATCH("/:id/properties/:pid", estateHandler.UpdateProperty)
		estGroup.POST("/:id/properties/:pid/landlord", estateHandler.AssignLandlord)
		estGroup.POST("/:id/properties/:pid/tenant", estateHandler.AssignTenant)
		estGroup.POST("/:id/properties/:pid/occupancy", estateHandler.SetOccupancyStatus)
		estGroup.POST("/:id/properties/:pid/archive", estateHandler.ArchiveProperty)
		estGroup.POST("/:id/properties/:pid/transfer-request", estateHandler.RequestPropertyTransfer)
		estGroup.GET("/:id/properties/:pid/analytics", estateHandler.GetPropertyAnalytics)
		estGroup.GET("/:id/property-transfers", estateHandler.ListTransferRequests)
		estGroup.POST("/:id/property-transfers/:reqId/review", estateHandler.ReviewPropertyTransfer)

		// Block 44: Reports & analytics
		estGroup.GET("/:id/analytics/:type", estateHandler.GetAnalytics)

		// Block 33: AI note-taking
		estGroup.POST("/:id/meetings/:mid/ai-notes", estateHandler.GenerateAINotes)
		estGroup.GET("/:id/ai-notes", estateHandler.ListAINotes)
		estGroup.GET("/:id/ai-notes/:sid", estateHandler.GetAINote)
		estGroup.POST("/:id/ai-notes/:sid/approve", estateHandler.ApproveAINote)

		// Block 41: Admin panel & configuration
		estGroup.GET("/:id/admin/dashboard", estateHandler.GetAdminDashboard)
		estGroup.GET("/:id/admin/residents", estateHandler.AdminListResidents)
		estGroup.POST("/:id/admin/residents/:uid/ban", estateHandler.BanResident)
		estGroup.POST("/:id/admin/residents/:uid/restore", estateHandler.RestoreResident)
		estGroup.GET("/:id/admin/config", estateHandler.GetEstateConfig)
		estGroup.PUT("/:id/admin/rules", estateHandler.SetEstateRules)
		estGroup.PUT("/:id/admin/subscription-plan", estateHandler.ConfigureSubscriptionPlan)
		estGroup.GET("/:id/admin/audit-log", estateHandler.GetAuditLog)
		estGroup.POST("/:id/admin/run-maintenance", estateHandler.RunMaintenance) // Block 47

		// Block 45: Settings & account
		estGroup.GET("/:id/settings", estateHandler.GetMemberSettings)
		estGroup.PATCH("/:id/settings", estateHandler.UpdateMemberSettings)
		estGroup.DELETE("/:id/account", estateHandler.DeleteAccount)

		// Block 42: Vendor / contractor app
		estGroup.POST("/:id/vendor/onboard", estateHandler.OnboardVendor)
		estGroup.GET("/:id/vendor/profile", estateHandler.GetVendorProfile)
		estGroup.GET("/:id/vendor/earnings", estateHandler.GetVendorEarnings)
		estGroup.GET("/:id/vendor/jobs", estateHandler.ListVendorJobs)
		estGroup.POST("/:id/vendor/assign-job", estateHandler.AssignVendorJob)
		estGroup.POST("/:id/vendor/jobs/:jid/accept", estateHandler.AcceptVendorJob)
		estGroup.POST("/:id/vendor/jobs/:jid/reject", estateHandler.RejectVendorJob)
		estGroup.POST("/:id/vendor/jobs/:jid/checkin", estateHandler.CheckInVendorJob)
		estGroup.POST("/:id/vendor/jobs/:jid/start", estateHandler.StartVendorJob)
		estGroup.POST("/:id/vendor/jobs/:jid/complete", estateHandler.CompleteVendorJob)
		estGroup.POST("/:id/vendor/jobs/:jid/quote", estateHandler.SubmitVendorQuote)
		estGroup.POST("/:id/vendor/jobs/:jid/invoice", estateHandler.SubmitVendorInvoice)
		estGroup.POST("/:id/vendor/jobs/:jid/evidence", estateHandler.SubmitVendorEvidence)
		estGroup.POST("/:id/vendor/jobs/:jid/payout", estateHandler.RequestVendorPayout)

		// Block 32: Meeting management
		estGroup.POST("/:id/meetings", estateHandler.CreateMeeting)
		estGroup.GET("/:id/meetings", estateHandler.ListMeetings)
		estGroup.GET("/:id/meetings/:mid", estateHandler.GetMeeting)
		estGroup.POST("/:id/meetings/:mid/rsvp", estateHandler.RSVPMeeting)
		estGroup.POST("/:id/meetings/:mid/checkin", estateHandler.CheckInMeeting)
		estGroup.POST("/:id/meetings/:mid/start", estateHandler.StartMeeting)
		estGroup.POST("/:id/meetings/:mid/end", estateHandler.EndMeeting)
		estGroup.POST("/:id/meetings/:mid/cancel", estateHandler.CancelMeeting)
		estGroup.POST("/:id/meetings/:mid/reschedule", estateHandler.RescheduleMeeting)
		estGroup.GET("/:id/meetings/:mid/minutes", estateHandler.GetMinutes)
		estGroup.POST("/:id/meetings/:mid/minutes", estateHandler.UploadMinutes)
		estGroup.POST("/:id/meetings/:mid/minutes/approve", estateHandler.ApproveMinutes)
		estGroup.GET("/:id/meetings/:mid/documents", estateHandler.ListMeetingDocuments)
		estGroup.POST("/:id/meetings/:mid/documents", estateHandler.AddMeetingDocument)

		// Block 28: Guard app
		estGroup.GET("/:id/gates", estateHandler.ListGates)
		estGroup.GET("/:id/guard/expected-visitors", estateHandler.GetExpectedVisitors)
		estGroup.GET("/:id/guard/lookup", estateHandler.LookupCode)
		estGroup.POST("/:id/guard/checkin", estateHandler.GuardCheckin)
		estGroup.POST("/:id/guard/checkout", estateHandler.GuardCheckout)
		estGroup.POST("/:id/guard/incident", estateHandler.SubmitIncident)
		estGroup.GET("/:id/guard/incidents", estateHandler.ListIncidents)
		estGroup.POST("/:id/guard/shift-handover", estateHandler.HandoverShift)
		estGroup.POST("/:id/guard/sync", estateHandler.SyncOfflineLogs)

		// Block 27: Extended visitor access codes
		estGroup.POST("/:id/access-codes", estateHandler.CreateAccessCode)
		estGroup.GET("/:id/access-codes", estateHandler.ListAccessCodes)
		estGroup.GET("/:id/access-codes/:cid", estateHandler.GetAccessCode)
		estGroup.POST("/:id/access-codes/:cid/revoke", estateHandler.RevokeCode)
		estGroup.POST("/:id/access-codes/:cid/extend", estateHandler.ExtendCode)
		estGroup.POST("/:id/access-codes/:cid/blacklist", estateHandler.BlacklistVisitor)
		estGroup.GET("/:id/access-codes/:cid/history", estateHandler.GetCheckinHistory)

		// Block 26: Dashboard
		estGroup.GET("/:id/dashboard", estateHandler.GetDashboard)

		// Block 25: Resident profiles
		estGroup.GET("/:id/profile", estateHandler.GetProfile)
		estGroup.PUT("/:id/profile", estateHandler.UpsertProfile)
		estGroup.GET("/:id/profile/household", estateHandler.ListHouseholdMembers)
		estGroup.POST("/:id/profile/household", estateHandler.AddHouseholdMember)
		estGroup.DELETE("/:id/profile/household/:mid", estateHandler.DeleteHouseholdMember)
		estGroup.GET("/:id/profile/staff", estateHandler.ListDomesticStaff)
		estGroup.POST("/:id/profile/staff", estateHandler.AddDomesticStaff)
		estGroup.PATCH("/:id/profile/staff/:sid/status", estateHandler.UpdateStaffStatus)
		estGroup.GET("/:id/profile/vehicles", estateHandler.ListVehicles)
		estGroup.POST("/:id/profile/vehicles", estateHandler.AddVehicle)
		estGroup.POST("/:id/profile/vehicles/:vid/verify", estateHandler.VerifyVehicle)
		estGroup.GET("/:id/profile/id-card", estateHandler.GetResidentCard)

		// Block 29: Dues / Rent (money path — Idempotency-Key required on pay)
		estGroup.GET("/:id/dues/invoices", estateHandler.ListInvoices)
		estGroup.POST("/:id/dues/invoices", estateHandler.CreateInvoice)
		estGroup.POST("/:id/dues/invoices/:invoiceId/pay", estateHandler.PayDues)
		estGroup.POST("/:id/dues/restrictions", estateHandler.ApplyRestriction)
		estGroup.POST("/:id/dues/restrictions/:residentId/lift", estateHandler.LiftRestriction)

		// Block 31: Tasks
		estGroup.GET("/:id/tasks", estateHandler.ListTasks)
		estGroup.POST("/:id/tasks", estateHandler.CreateTask)
		estGroup.PATCH("/:id/tasks/:taskId/status", estateHandler.UpdateTaskStatus)

		// Block 32: Maintenance / Repairs
		estGroup.GET("/:id/repairs", estateHandler.ListRepairs)
		estGroup.POST("/:id/repairs", estateHandler.CreateRepair)
		estGroup.GET("/:id/repairs/:repairId/updates", estateHandler.ListRepairUpdates)
		estGroup.POST("/:id/repairs/:repairId/updates", estateHandler.AddRepairUpdate)

		// Block 33: Facilities / Amenities
		estGroup.GET("/:id/facilities", estateHandler.ListFacilities)
		estGroup.POST("/:id/facilities", estateHandler.CreateFacility)
		estGroup.POST("/:id/facilities/:facilityId/book", estateHandler.BookFacility)
		estGroup.GET("/:id/bookings", estateHandler.ListMyBookings)

		// Block 34: Announcements
		estGroup.GET("/:id/announcements", estateHandler.ListAnnouncements)
		estGroup.POST("/:id/announcements", estateHandler.CreateAnnouncement)
		estGroup.POST("/:id/announcements/:annId/read", estateHandler.MarkAnnouncementRead)

		// Block 35: Emergencies / Incidents
		estGroup.GET("/:id/emergencies", estateHandler.ListEmergencies)
		estGroup.POST("/:id/emergencies", estateHandler.RaiseEmergency)
		estGroup.PATCH("/:id/emergencies/:alertId/status", estateHandler.UpdateEmergencyStatus)

		// Block 36/39: Documents (upload via presigned R2; type/size validated;
		// download via short-lived presigned GET)
		estGroup.GET("/:id/documents", estateHandler.ListDocuments)
		estGroup.POST("/:id/documents", estateHandler.CreateDocument)
		estGroup.GET("/:id/documents/:did/download-url", estateHandler.DocumentDownloadURL)

		// Block 37: Vendors / Artisans
		estGroup.GET("/:id/vendors", estateHandler.ListVendors)
		estGroup.POST("/:id/vendors", estateHandler.CreateVendor)
		estGroup.POST("/:id/vendors/:vendorId/verify", estateHandler.VerifyVendor)

		// Block 40/43/44: Finance dashboard, notifications, reports (aggregates)
		estGroup.GET("/:id/finance/dashboard", estateHandler.FinanceDashboard)
		estGroup.GET("/:id/notifications", estateHandler.Notifications)
		estGroup.GET("/:id/reports", estateHandler.Report)

		// Platform estate oversight admin surface (read-only, estate.admin.* RBAC).
		// Mounted as a sibling group /estate-admin (NOT /estate/admin) to avoid the
		// Gin radix conflict with the /estate/:id/... param routes above. See
		// estate_admin_routes.go for the full rationale.
		RegisterEstateAdmin(finance, pool, rbac, middleware.RequireAuthContext(supabase, rbac))
	}

	// --- Property Management suite (unification umbrella) ---
	// Read-mostly cross-module glue: role context across estate/property/agency,
	// portable rent passport, and (with realtor) the stay→gate-pass moat bridge.
	// Owns NO money path. Auth wrapper (mapsAuth) applies RequireAuthContext and
	// mirrors the user id into c.Set("user_id", ...), and leaves the authUser set so
	// RequirePermission can read the caller for the screening lookup.
	if cfg.FeaturePropertySuiteEnabled {
		propertySvc := property.NewService(pool)
		propertyHandler := property.NewHandler(propertySvc)
		propGroup := finance.Group("/property")
		propGroup.Use(mapsAuth())

		// Role / context model (read + metadata switch).
		propGroup.GET("/context", propertyHandler.GetContext)
		propGroup.POST("/context/switch", propertyHandler.SwitchContext)

		// Rent passport (portable trust profile).
		propGroup.GET("/rent-passport/me", propertyHandler.GetMyRentPassport)
		// Landlord/agency screening view of another user — RBAC-gated (fail-closed).
		propGroup.GET("/rent-passport/lookup/:userId",
			middleware.RequirePermission(rbac, "property.manage"),
			propertyHandler.LookupRentPassport)

		log.Println("[property] suite routes registered at /api/finance/property")
	}

	// --- Realtor stays → gate-pass bridge (cross-cutting flow #4, the moat flow) ---
	// Auto-issues an estate visitor gate pass for a confirmed shortlet/hotel booking
	// whose unit sits inside a managed estate, reusing the estate pass-issuance seam.
	// Gated on FeatureRealtorEnabled (the realtor data plane). Issuance is lazy +
	// idempotent (booking.estate_pass_id), since bookings are created via Supabase
	// RPCs (no Go confirm hook). Skips gracefully when the unit is not in an estate.
	if cfg.FeatureRealtorEnabled {
		// A db-only estate service instance is sufficient for the system pass seam
		// (it needs only the pgx pool + redis); the full estate service with ledger/
		// KYC/LLM wiring lives behind FeatureEstateEnabled and is not required here.
		bridgeEstateSvc := estate.NewService(pool, redisClient)
		staysSvc := realtor.NewStaysService(pool, bridgeEstateSvc)
		staysHandler := realtor.NewStaysHandler(staysSvc)
		realtorMember := finance.Group("/realtor")
		realtorMember.Use(mapsAuth())
		// Non-blocking estate-staff detection: a guard/estate admin (estate.manage)
		// may view ANY booking's gate pass at the gate, while ordinary guests are
		// still served as the booking owner. This must NOT fail closed — unlike
		// RequirePermission it never aborts; it only annotates the request.
		estateStaffProbe := func(c *gin.Context) {
			if u, ok := middleware.GetAuthenticatedUser(c); ok {
				if allowed, _ := rbac.CheckPermission(u.ID, "estate.manage", "global", ""); allowed {
					c.Set("property_estate_staff", true)
				}
			}
			c.Next()
		}
		realtorMember.GET("/stays/:bookingId/gate-pass", estateStaffProbe, staysHandler.GetGatePass)
		log.Println("[realtor] stays gate-pass bridge registered at /api/finance/realtor/stays/:bookingId/gate-pass")
	}

	// --- Crowdfunding routes ---
	if cfg.FeatureCrowdfundingEnabled {
		settlementSvcCF := settlement.NewService(pool, ledgerSvc)
		cfSvc := crowdfunding.NewService(pool, ledgerSvc, settlementSvcCF)
		cfHandler := crowdfunding.NewHandler(cfSvc)
		cfGroup := finance.Group("/crowdfunding")
		// Discovery & detail (read)
		cfGroup.GET("/campaigns", cfHandler.ListCampaigns)
		cfGroup.GET("/categories", cfHandler.ListCategories)
		cfGroup.GET("/campaigns/:id", cfHandler.GetDetail)
		// Lifecycle (write)
		cfGroup.POST("/campaigns", cfHandler.SubmitCampaign)
		cfGroup.POST("/campaigns/:id/publish", cfHandler.Publish)
		cfGroup.POST("/campaigns/:id/contribute", cfHandler.Contribute)
		cfGroup.POST("/campaigns/:id/release", cfHandler.Release)
		cfGroup.POST("/campaigns/:id/refund", cfHandler.Refund)

		// Domain packages (parallel build) — each registers its routes on the
		// shared crowdfunding group. All use the ':id' param on /campaigns/:id/*.
		cfwallet.Register(cfGroup, pool)
		cfengage.Register(cfGroup, pool)
		cfcreator.Register(cfGroup, pool)
		cfinvestment.Register(cfGroup, pool)
		cfcsr.Register(cfGroup, pool)

		// Admin review group (matches the admin web client's /api/crowdfunding/admin base).
		cfAdmin := r.Group("/api/crowdfunding/admin")
		cfAdmin.Use(requireUserID())
		cfAdmin.GET("/stats", cfHandler.AdminStats)
		cfAdmin.GET("/campaigns", cfHandler.AdminListPending)
		cfAdmin.GET("/campaigns/:id", cfHandler.AdminGetCampaign)
		cfAdmin.POST("/campaigns/:id/decision", cfHandler.AdminDecide)
		cfadminext.RegisterAdmin(cfAdmin, pool, ledgerSvc)
	}

	// --- Restaurant & Delivery routes ---
	if cfg.FeatureRestaurantEnabled {
		settlementSvcR := settlement.NewService(pool, ledgerSvc)
		restaurantSvc := restaurant.NewService(pool, settlementSvcR).WithLedger(ledgerSvc).WithTiers(tiersSvc)

		// Merchant WITHDRAWAL money path (wallet → saved bank account). Gated by
		// FEATURE_RESTAURANT_WITHDRAWALS_ENABLED (default OFF — no flag, no money path).
		// The disburser defaults to the NoopDisburser (executes nothing) until a real
		// provider adapter is wired. See restaurant/withdrawal.go.
		restaurantWithdrawalsEnabled := strings.EqualFold(os.Getenv("FEATURE_RESTAURANT_WITHDRAWALS_ENABLED"), "true")
		restaurantSvc = restaurantSvc.WithWithdrawals(restaurantWithdrawalsEnabled)
		if mapSvc != nil {
			locGeo := maps.NewLocationGeocoder(mapSvc)
			restaurantSvc = restaurantSvc.WithGeocoder(locGeo)
			// Real driving distance + ETA for delivery-fee pricing (Google Distance
			// Matrix when configured; falls back to haversine on error).
			restaurantSvc = restaurantSvc.WithDistancer(locGeo)
			// Delivery-zone gate: reject destinations outside the restaurant owner's
			// drawn service areas (no-op when the owner has defined none). Runs on our
			// own PostGIS geofences, not a maps API.
			restaurantSvc = restaurantSvc.WithZoneChecker(maps.NewOwnerZoneChecker(pool))
		}

		// Real notifications via the asynq queue (push + in-app). Falls back to
		// the module's LogNotifier when Redis/asynq is unavailable so the module
		// never hard-fails on notification delivery.
		if cfg.RedisURL != "" {
			if aClient, qerr := queue.NewClient(cfg.RedisURL); qerr == nil {
				notifSvcR := notifications.NewService(aClient)
				restaurantSvc.SetNotifier(restaurant.NotifierFunc(func(ctx context.Context, n restaurant.Notification) error {
					return notifSvcR.Send(ctx, notifications.Notification{
						UserID:   n.UserID,
						Event:    notifications.Event(n.Event),
						Title:    n.Title,
						Body:     n.Body,
						Data:     n.Data,
						Channels: []notifications.Channel{notifications.ChannelPush, notifications.ChannelInApp},
					})
				}))
			}
		}

		// Real-time per-order channel: status changes, rider location, and chat
		// messages fan out to the order's three participants over the WS hub
		// (Redis pub/sub fans out across instances).
		restaurantHub := platformWS.New()
		restaurantRT := restaurant.NewRealtime(restaurantHub, redisClient, restaurantSvc.OrderParties)
		restaurantRT.Start(ctx)
		restaurantSvc = restaurantSvc.WithRealtime(restaurantRT)

		restaurantHandler := restaurant.NewHandler(restaurantSvc).WithRealtime(restaurantHub)
		restGroup := finance.Group("/restaurant")

		// Reads / discovery.
		restGroup.GET("", restaurantHandler.ListRestaurants)
		restGroup.POST("", restaurantHandler.Create)

		// Settlement bank accounts (capture only — NOT money movement). Static
		// siblings of the ":id" param below (allowed in Gin v1.10).
		restGroup.POST("/bank-accounts", restaurantHandler.AddBankAccount)
		restGroup.GET("/bank-accounts", restaurantHandler.ListBankAccounts)
		restGroup.PATCH("/bank-accounts/:accountId/default", restaurantHandler.SetDefaultBankAccount)
		restGroup.DELETE("/bank-accounts/:accountId", restaurantHandler.DeleteBankAccount)

		// Merchant withdrawals (money path). Registered only when the feature flag is
		// on. POST reserves funds (Idempotency-Key header REQUIRED); GET lists history.
		if restaurantWithdrawalsEnabled {
			restGroup.POST("/withdrawals", restaurantHandler.RequestWithdrawal)
			restGroup.GET("/withdrawals", restaurantHandler.ListWithdrawals)
			restGroup.GET("/withdrawals/:withdrawalId", restaurantHandler.GetWithdrawal)
		}

		restGroup.GET("/:id", restaurantHandler.GetRestaurant)
		// Owner edits discovery fields (cuisine/description/logo).
		restGroup.PATCH("/:id", restaurantHandler.UpdateRestaurantProfile)
		// Merchant KYB onboarding (owner): fill business/settlement details, attach
		// documents, and submit for review. Approval (admin) is what takes it live.
		restGroup.GET("/:id/kyb", restaurantHandler.GetKYB)
		restGroup.PUT("/:id/kyb", restaurantHandler.SaveKYB)
		restGroup.POST("/:id/kyb/documents", restaurantHandler.AddKYBDocument)
		restGroup.POST("/:id/kyb/submit", restaurantHandler.SubmitKYB)

		// Menu management (owner only).
		restGroup.POST("/:id/menu/categories", restaurantHandler.CreateCategory)
		restGroup.POST("/:id/menu/items", restaurantHandler.CreateItem)
		restGroup.PATCH("/:id/menu/items/:itemId", restaurantHandler.UpdateItem)
		// Grouped menu-item modifiers: public read of an item's option groups, owner
		// writes to define groups + options.
		restGroup.GET("/:id/menu/items/:itemId/modifier-groups", restaurantHandler.ListItemModifierGroups)
		restGroup.POST("/:id/menu/items/:itemId/modifier-groups", restaurantHandler.CreateModifierGroup)
		restGroup.POST("/:id/menu/modifier-groups/:groupId/modifiers", restaurantHandler.AddModifier)
		// Promo codes (owner-created, restaurant-funded).
		restGroup.POST("/:id/promos", restaurantHandler.CreatePromo)
		// Weekly business hours: public read (schedule + open-now), owner replace-all.
		restGroup.GET("/:id/reviews", restaurantHandler.ListReviews)        // public reviews (hidden excluded, rater anonymized)
		restGroup.GET("/:id/earnings", restaurantHandler.EarningsStatement) // owner earnings statement (PY-008)
		restGroup.GET("/:id/hours", restaurantHandler.GetBusinessHours)
		restGroup.PUT("/:id/hours", restaurantHandler.SetBusinessHours)
		// Holiday / special-hours overrides (owner): a per-date override wins over the
		// weekly schedule for that date.
		restGroup.PUT("/:id/holidays", restaurantHandler.SetHoliday)
		restGroup.DELETE("/:id/holidays/:date", restaurantHandler.DeleteHoliday)

		// Distance-based delivery-fee preview (before placing the order). Member auth
		// via the finance group's requireUserID. Static "delivery-quote" segment under
		// the ":id" param is fine in Gin v1.10.
		restGroup.POST("/:id/delivery-quote", restaurantHandler.DeliveryQuote)

		// Order placement keeps the restaurant id in the path (existing money path).
		restGroup.POST("/:id/orders", restaurantHandler.PlaceOrder)
		restGroup.PATCH("/:id/orders/:orderId/status", restaurantHandler.UpdateStatus)
		restGroup.DELETE("/:id/orders/:orderId", restaurantHandler.CancelOrder)
		// Expanded lifecycle (Phase 14): owner rejects (refund), rider reports failed drop-off.
		restGroup.POST("/:id/orders/:orderId/reject", restaurantHandler.RejectOrder)
		restGroup.POST("/:id/orders/:orderId/delivery-failed", restaurantHandler.MarkDeliveryFailed)

		// Food disputes: a party opens a dispute on a delivered order; parties read it.
		// Resolution (with the platform-funded refund) is admin-only, mounted below.
		restGroup.POST("/orders/:orderId/dispute", restaurantHandler.RaiseFoodDispute)
		restGroup.GET("/disputes/:id", restaurantHandler.GetFoodDispute)

		// Order reads (static "orders" sibling of the ":id" param — allowed in Gin v1.10).
		// Customer saved delivery addresses (GEO-001/005/006).
		restGroup.GET("/addresses", restaurantHandler.ListAddresses)
		restGroup.POST("/addresses", restaurantHandler.AddAddress)
		restGroup.PUT("/addresses/:id/default", restaurantHandler.SetDefaultAddress)
		restGroup.DELETE("/addresses/:id", restaurantHandler.DeleteAddress)
		restGroup.GET("/orders", restaurantHandler.ListOrders)
		// Group orders (SG-003/004): host creates, contributors add, host finalizes → one order.
		restGroup.POST("/:id/group", restaurantHandler.CreateGroupOrder)
		restGroup.GET("/group/:groupId", restaurantHandler.GetGroupOrder)
		restGroup.POST("/group/:groupId/items", restaurantHandler.AddGroupItem)
		restGroup.POST("/group/:groupId/finalize", restaurantHandler.FinalizeGroupOrder)
		restGroup.GET("/orders/:orderId", restaurantHandler.GetOrder)

		// Rider / delivery lifecycle. Marking an order "ready" (via the status
		// endpoint) auto-dispatches to nearby available riders; the first to
		// accept wins, picks up, then confirms handoff with the delivery code.
		restGroup.POST("/orders/:orderId/assign", restaurantHandler.AssignRider)      // manual offer (fallback)
		restGroup.POST("/orders/:orderId/dispatch", restaurantHandler.Redispatch)     // owner re-runs auto-dispatch
		restGroup.POST("/orders/:orderId/accept", restaurantHandler.AcceptDelivery)   // rider claims the delivery
		restGroup.POST("/orders/:orderId/decline", restaurantHandler.DeclineDelivery) // rider declines → reassign (DP-002)
		restGroup.POST("/orders/:orderId/pickup", restaurantHandler.ConfirmPickup)    // rider confirms pickup
		restGroup.POST("/orders/:orderId/handoff", restaurantHandler.ConfirmHandoff)  // rider confirms drop-off (code)
		restGroup.POST("/orders/:orderId/location", restaurantHandler.PostLocation)
		restGroup.GET("/rider/offers", restaurantHandler.RiderOffers)
		restGroup.GET("/rider/active", restaurantHandler.RiderActive)

		// Communication: chat + realtime channel.
		restGroup.GET("/orders/:orderId/messages", restaurantHandler.ListMessages)
		restGroup.POST("/orders/:orderId/messages", restaurantHandler.SendMessage)
		// Live-order WebSocket is mounted on a SEPARATE public group (no requireUserID):
		// browser/RN WS clients can't send a Bearer across the proxy, so it is
		// authenticated by the short-lived HMAC ticket (validated in ServeOrderWS) and
		// still enforces order participation. Registered once here only.
		restPublicWS := r.Group("/api/finance/restaurant")
		restPublicWS.GET("/orders/:orderId/ws", restaurantHandler.ServeOrderWS)

		// Ratings.
		restGroup.POST("/orders/:orderId/rate", restaurantHandler.RateOrder)

		// Admin delivery-fee pricing console (RBAC restaurant.admin.pricing). Mounted
		// on the root engine with mapsAuth() so RequirePermission can read the
		// authenticated caller (RequireAuthContext + user_id mirror), then per-route
		// permission middleware fail-closed.
		restAdmin := r.Group("/api/restaurant/admin")
		restAdmin.Use(mapsAuth())
		restAdmin.GET("/delivery-config", middleware.RequirePermission(rbac, "restaurant.admin.pricing"), restaurantHandler.GetDeliveryConfig)
		restAdmin.PUT("/delivery-config", middleware.RequirePermission(rbac, "restaurant.admin.pricing"), restaurantHandler.PutDeliveryConfig)
		// Pricing v2 knobs (service fee % + item surge, basis points) — platform-controlled.
		restAdmin.PUT("/pricing-config", middleware.RequirePermission(rbac, "restaurant.admin.pricing"), restaurantHandler.AdminSetPricingConfig)
		// Accept-SLA sweeper: auto-cancel + refund orders never accepted in time (ops job).
		restAdmin.POST("/sweep-unaccepted", middleware.RequirePermission(rbac, "restaurant.admin.dispatch"), restaurantHandler.AdminSweepUnaccepted)

		// Ops-console admin surfaces (dispatch board, onboarding/KYC review, payout
		// reconciliation) consumed by frontend-admin/app/admin/restaurant/*. Each is
		// fail-closed behind its own restaurant.admin.* permission. Reads are thin
		// projections over existing tables; the two mutations drive existing
		// idempotent transitions (manual assign, onboarding is_open gate). Disputes
		// are NOT here — the console reuses /api/finance/{disputes,admin/disputes}.
		restAdmin.GET("/riders", middleware.RequirePermission(rbac, "restaurant.admin.dispatch"), restaurantHandler.AdminListRiders)
		restAdmin.GET("/dispatch/queue", middleware.RequirePermission(rbac, "restaurant.admin.dispatch"), restaurantHandler.AdminDispatchQueue)
		restAdmin.POST("/orders/:id/assign", middleware.RequirePermission(rbac, "restaurant.admin.dispatch"), restaurantHandler.AdminAssignRider)
		// Dispatch-failure ops (DP-003): fail+refund a single stalled order, or sweep all.
		restAdmin.POST("/orders/:id/dispatch-failed", middleware.RequirePermission(rbac, "restaurant.admin.dispatch"), restaurantHandler.AdminMarkDispatchFailed)
		// Reassignment ops (DP-005): reassign a single order, or sweep offline-assigned.
		restAdmin.POST("/orders/:id/reassign", middleware.RequirePermission(rbac, "restaurant.admin.dispatch"), restaurantHandler.AdminReassignOrder)
		restAdmin.POST("/sweep-offline-assigned", middleware.RequirePermission(rbac, "restaurant.admin.dispatch"), restaurantHandler.AdminSweepOfflineAssigned)
		// Scheduled-order activation (SG-002/005): release due slots / auto-cancel if closed.
		restAdmin.POST("/activate-scheduled", middleware.RequirePermission(rbac, "restaurant.admin.dispatch"), restaurantHandler.AdminActivateScheduled)
		restAdmin.POST("/sweep-stalled-dispatch", middleware.RequirePermission(rbac, "restaurant.admin.dispatch"), restaurantHandler.AdminSweepStalledDispatch)
		restAdmin.GET("/onboarding", middleware.RequirePermission(rbac, "restaurant.admin.onboarding"), restaurantHandler.AdminListApplications)
		// Review moderation (RV-004): hide/approve an abusive review.
		restAdmin.POST("/reviews/:id/moderate", middleware.RequirePermission(rbac, "restaurant.admin.onboarding"), restaurantHandler.AdminModerateReview)
		// Single wildcard segment handles all three shapes the admin UI may post:
		//   /onboarding/:id/decision  (body {decision, note})
		//   /onboarding/:id/approve   (decision taken from the path)
		//   /onboarding/:id/reject    (decision taken from the path)
		// Registering both a static "decision" and a ":decision" param at the same
		// position would panic in Gin, so the handler resolves the literal below.
		restAdmin.POST("/onboarding/:id/:decision", middleware.RequirePermission(rbac, "restaurant.admin.onboarding"), restaurantHandler.AdminDecideApplication)
		// Food disputes ops queue + resolution (platform-funded refund). Fail-closed
		// behind the seeded restaurant.admin.disputes permission.
		restAdmin.GET("/disputes", middleware.RequirePermission(rbac, "restaurant.admin.disputes"), restaurantHandler.AdminListFoodDisputes)
		restAdmin.POST("/disputes/:id/resolve", middleware.RequirePermission(rbac, "restaurant.admin.disputes"), restaurantHandler.AdminResolveFoodDispute)
		// Real restaurant/rider payout-run DISBURSEMENT subsystem (money path). List
		// + detail are reads; build aggregates unpaid settlements into a draft run;
		// process posts ONE balanced ledger transfer (DR settlement acct → CR provider
		// wallet) keyed on the run's idempotency_key and requires an Idempotency-Key
		// header. Every route fail-closed behind restaurant.admin.payouts. Static
		// "payouts/build" is a sibling of the ":id" param (allowed in Gin v1.10).
		restAdmin.GET("/payouts", middleware.RequirePermission(rbac, "restaurant.admin.payouts"), restaurantHandler.AdminListPayoutRuns)
		restAdmin.POST("/payouts/build", middleware.RequirePermission(rbac, "restaurant.admin.payouts"), restaurantHandler.AdminBuildPayoutRun)
		restAdmin.GET("/payouts/:id", middleware.RequirePermission(rbac, "restaurant.admin.payouts"), restaurantHandler.AdminGetPayoutRun)
		restAdmin.POST("/payouts/:id/process", middleware.RequirePermission(rbac, "restaurant.admin.payouts"), restaurantHandler.AdminProcessPayoutRun)

		// Merchant WITHDRAWAL settlement webhook surface (money path). The provider
		// webhook / ops console flips a reserved withdrawal to paid (drain suspense →
		// provider_clearing) or reversed (return funds to the merchant wallet). Both
		// are idempotent + balanced (see restaurant/withdrawal.go), fail-closed behind
		// restaurant.admin.payouts, registered only when the feature flag is on.
		if restaurantWithdrawalsEnabled {
			restAdmin.POST("/withdrawals/:withdrawalId/settle", middleware.RequirePermission(rbac, "restaurant.admin.payouts"), restaurantHandler.AdminSettleWithdrawal)
			restAdmin.POST("/withdrawals/:withdrawalId/reverse", middleware.RequirePermission(rbac, "restaurant.admin.payouts"), restaurantHandler.AdminReverseWithdrawal)
		}

		// Crash-recovery settlement reconciliation (money-path durability): an order
		// marked delivered whose escrow never released (process died / Settle errored
		// after the status flip) is re-driven through the SAME idempotent settleOrder
		// path. Idempotent + multi-instance safe (Settle guards on status='escrowed' +
		// ON CONFLICT ledger legs + FOR UPDATE lock). Cadence 5m, grace 10m by default;
		// ops-tunable via env.
		restaurant.StartStuckSettlementReconciler(
			ctx, restaurantSvc,
			time.Duration(envInt("FOOD_RECONCILE_INTERVAL_MINUTES", 5))*time.Minute,
			time.Duration(envInt("FOOD_SETTLE_GRACE_MINUTES", 10))*time.Minute,
		)
	}

	// --- Nutrition Resolution Engine (NRE) routes ---
	// Estimated nutrition + allergens for orderable dishes. NOT a money module
	// (no ledger). Object-level authz on vendor actions (via the restaurant
	// ownership chain), immutable audit on AI estimates / vendor confirmations /
	// allergen attestations, guarded status machine, sanity bounds before publish.
	// Member /api/finance/nutrition/* (auth via the finance group); admin
	// /api/nutrition/admin/* (per-route RBAC nutrition.admin.*). Tier-3 AI reuses
	// the shared LLM client (claude-sonnet-4-6); empty key → deterministic mock.
	if cfg.FeatureNutritionEnabled && pool != nil {
		nutritionAdmin := r.Group("/api/nutrition/admin")
		nutritionAdmin.Use(requireUserID())
		registerNutritionRoutes(finance, nutritionAdmin, pool, rbac, cfg.AnthropicAPIKey)
	}

	// --- Telemedicine routes ---
	if cfg.FeatureTelemedicineEnabled {
		settlementSvcT := settlement.NewService(pool, ledgerSvc)
		telemedSvc := telemedicine.NewService(pool, settlementSvcT)
		telemedHandler := telemedicine.NewHandler(telemedSvc)

		// Legacy /api/finance/telemedicine/... (kept for backward compat)
		teleGroup := finance.Group("/telemedicine")
		teleGroup.GET("/doctors", telemedHandler.ListDoctors)
		teleGroup.POST("/doctors", telemedHandler.RegisterDoctor)
		teleGroup.POST("/appointments", telemedHandler.BookAppointment)
		teleGroup.POST("/appointments/:id/complete", telemedHandler.CompleteAppointment)
		teleGroup.DELETE("/appointments/:id", telemedHandler.CancelAppointment)
		teleGroup.POST("/appointments/:id/prescription", telemedHandler.IssuePrescription)

		// Mobile-facing /api/v1/telemedicine/... (matches mobile API client)
		v1Tele := r.Group("/api/v1/telemedicine")
		v1Tele.Use(requireUserID())
		v1Tele.GET("/specialties", telemedHandler.ListSpecialties)
		v1Tele.GET("/doctors", telemedHandler.ListDoctors)
		v1Tele.GET("/doctors/:id", telemedHandler.GetDoctor)
		v1Tele.GET("/doctors/:id/availability", telemedHandler.GetAvailability)
		v1Tele.GET("/doctors/:id/reviews", telemedHandler.ListDoctorReviews)
		v1Tele.POST("/doctors", telemedHandler.RegisterDoctor)
		v1Tele.POST("/appointments", telemedHandler.BookAppointment)
		v1Tele.GET("/appointments", telemedHandler.ListMyAppointments)
		v1Tele.GET("/appointments/:id", telemedHandler.GetAppointment)
		v1Tele.GET("/appointments/:id/summary", telemedHandler.GetVisitSummary)
		v1Tele.POST("/appointments/:id/confirm", telemedHandler.ConfirmAppointment)
		v1Tele.POST("/appointments/:id/reschedule", telemedHandler.RescheduleAppointment)
		v1Tele.POST("/appointments/:id/complete", telemedHandler.CompleteAppointment)
		v1Tele.POST("/appointments/:id/cancel", telemedHandler.CancelAppointment)
		v1Tele.POST("/appointments/:id/review", telemedHandler.AddReview)
		v1Tele.DELETE("/appointments/:id", telemedHandler.CancelAppointment)
		v1Tele.POST("/appointments/:id/prescription", telemedHandler.IssuePrescription)
		v1Tele.GET("/appointments/:id/prescription", telemedHandler.GetPrescription)
		// Doctor-facing
		v1Tele.POST("/doctor/register", telemedHandler.RegisterDoctorV2)
		v1Tele.GET("/doctor/dashboard", telemedHandler.GetDoctorDashboard)
		v1Tele.PATCH("/doctor/availability", telemedHandler.ToggleAvailability)
		v1Tele.POST("/doctor/notes", telemedHandler.SubmitSOAPNote)
		v1Tele.POST("/doctor/licence", telemedHandler.UploadLicenceDoc)
	}

	// --- Pharmacy routes ---
	if cfg.FeaturePharmacyEnabled {
		pharmacySvc := pharmacy.NewService(pool)
		pharmacyHandler := pharmacy.NewHandler(pharmacySvc)
		v1Pharm := r.Group("/api/v1/pharmacy")
		v1Pharm.Use(requireUserID())
		v1Pharm.GET("/products", pharmacyHandler.ListProducts)
		v1Pharm.GET("/cart", pharmacyHandler.GetCart)
		v1Pharm.POST("/cart", pharmacyHandler.AddToCart)
		v1Pharm.PATCH("/cart/:product_id", pharmacyHandler.UpdateCartItem)
		v1Pharm.DELETE("/cart/:product_id", pharmacyHandler.RemoveFromCart)
		v1Pharm.DELETE("/cart", pharmacyHandler.ClearCart)
	}

	// --- AI Customer Care routes ---
	if cfg.FeatureAICareEnabled {
		var aicAI aicare.AIProvider
		if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
			aicAI = aicare.NewAnthropicProvider(key)
		}
		aicSvc := aicare.NewService(pool, aicAI)
		aicHandler := aicare.NewHandler(aicSvc)
		aicGroup := finance.Group("/support")
		aicGroup.POST("/sessions", aicHandler.CreateSession)
		aicGroup.GET("/sessions/:id/messages", aicHandler.GetHistory)
		aicGroup.POST("/sessions/:id/messages", aicHandler.SendMessage)
		aicGroup.POST("/sessions/:id/escalate", aicHandler.Escalate)
		aicGroup.POST("/sessions/:id/resolve", aicHandler.Resolve)
	}

	// --- Transport / Mobility (ride-hailing) routes ---
	if cfg.FeatureTransportEnabled {
		// GO-LIVE GUARD: transport fares (and every mode escrow that follows from
		// them) are computed from the MapService route. When mapSvc is nil the
		// transport service silently falls back to transport.MockMaps, whose
		// haversine distances FABRICATE fares — acceptable for dev/CI/offline, a
		// money-integrity hazard in production (riders escrow amounts derived from
		// invented distances). We refuse to boot production with a nil map service.
		//
		// cfg.IsProd() (config.validate) is the single prod/dev signal; APP_ENV
		// defaults to "development" so dev/staging/offline — which legitimately use
		// MockMaps — are unaffected. In non-prod we log loudly instead of aborting.
		if mapSvc == nil {
			if cfg.IsProd() {
				log.Fatalf("[transport] FATAL: FEATURE_TRANSPORT_ENABLED=true in production (APP_ENV=%q) but no MapService is wired "+
					"(FEATURE_MAPS_ENABLED off or maps config failed) — refusing to boot with MockMaps, which fabricates fares. "+
					"Enable FEATURE_MAPS_ENABLED with a real MAPS_PROVIDER, or disable FEATURE_TRANSPORT_ENABLED.", cfg.AppEnv)
			}
			log.Printf("[transport] WARN: no MapService wired (APP_ENV=%q) — falling back to MockMaps. "+
				"Fares are FABRICATED from haversine distance; acceptable for dev/offline only. "+
				"Production boot is blocked by the IsProd() guard above.", cfg.AppEnv)
		}
		settlementSvcTr := settlement.NewService(pool, ledgerSvc)
		transportSvc := transport.NewService(pool, settlementSvcTr)
		// Bridge transport dispatch/estimation onto the provider-agnostic
		// MapService (OpenStack/OSRM by default) instead of the ad-hoc maps stub.
		if mapSvc != nil {
			transportSvc = transportSvc.WithMaps(transport.NewMapServiceBridge(mapSvc))
			log.Println("[transport] dispatch using provider-agnostic MapService")
		}
		transportHandler := transport.NewHandler(transportSvc)
		transportAdmin := transport.NewAdminHandler(transport.NewAdminService(transportSvc))

		// Backend-owned presigned R2 uploads for driver documents (licence,
		// insurance, roadworthiness, etc.). Unconfigured creds → the presign
		// endpoint fails closed with 503 (never a fabricated URL). Mirrors the
		// estate/doctor presigner wiring; bucket default mirrors CLAUDE.md.
		transportPresigner := r2.New(r2.Config{
			AccountEndpoint: cfg.R2AccountEndpoint,
			Bucket:          cfg.R2Bucket,
			AccessKeyID:     cfg.R2AccessKeyID,
			SecretAccessKey: cfg.R2SecretAccessKey,
			Region:          cfg.R2Region,
		})
		transportHandler = transportHandler.WithPresigner(transportPresigner, cfg.R2Bucket)

		// Real-time trip tracking: driver GPS → MatchToRoad snap → rider+driver
		// over WebSocket (Redis pub/sub fans out across instances).
		transportHub := platformWS.New()
		var trackMaps maps.MapService
		if mapSvc != nil {
			trackMaps = mapSvc
		}
		tripTracker := transport.NewTripTracker(pool, transportHub, trackMaps, redisClient)
		tripTracker.Start(ctx)
		transportHandler = transportHandler.WithRealtime(tripTracker, transportHub)

		// Legacy transport endpoints (driver profile only, kept for back-compat).
		// SECURITY: the legacy money-path trip routes (POST /trips,
		// POST /trips/:id/accept, PATCH /trips/:id/status) were REMOVED. They had no
		// object-level authz and no phase-transition guard — UpdateTripStatus let any
		// authenticated caller mark ANY trip 'completed' (triggering settlement/payout)
		// or 'cancelled' (triggering a refund to the payer) on a trip they don't own.
		// The guarded /mobility + /driver state machine (RequestRide → DriverAccept →
		// … → CompleteTrip) fully supersedes them, enforcing ownership + legal
		// transitions. The driver profile routes below carry no money and are
		// self-scoped by user_id, so they remain.
		trGroup := finance.Group("/transport")
		trGroup.POST("/drivers", transportHandler.RegisterDriver)
		trGroup.PATCH("/drivers/status", transportHandler.SetStatus)

		// Customer (rider) mobility endpoints.
		mob := finance.Group("/mobility")
		// Real-time tracking: rider/driver WS channel + driver GPS ingest.
		mob.GET("/ws", transportHandler.ServeTripWS)
		mob.POST("/trips/:id/track", transportHandler.TrackPosition)
		mob.GET("/home", transportHandler.Home)
		mob.GET("/config/pricing", transportHandler.ConfigPricing)
		mob.POST("/rides/estimate", transportHandler.Estimate)
		mob.POST("/rides/request", transportHandler.RequestRide)
		mob.GET("/rides/active", transportHandler.ActiveRide)
		mob.POST("/rides/:id/offer", transportHandler.Offer)
		mob.POST("/rides/:id/accept-counter", transportHandler.AcceptCounter)
		mob.POST("/rides/:id/cancel", transportHandler.CancelRide)
		mob.GET("/rides/:id", transportHandler.GetRide)
		mob.POST("/rides/:id/share", transportHandler.ShareRide)
		// Public (unauthenticated) resolve path for a live-share link. A share link
		// must be openable by someone without an account; the handler returns only
		// non-sensitive tracking fields (never the trip PIN) and enforces the token
		// TTL. Registered on r (not the auth-gated finance group) on purpose.
		mobPublic := r.Group("/api/finance/mobility/public")
		mobPublic.GET("/track/:token", transportHandler.ResolveShare)
		mob.POST("/rides/:id/sos", transportHandler.SOS)
		mob.POST("/rides/:id/rate", transportHandler.Rate)
		mob.GET("/history", transportHandler.History)
		mob.GET("/profile", transportHandler.GetProfile)
		mob.PUT("/profile", transportHandler.UpdateProfile)
		mob.GET("/trusted-contacts", transportHandler.ListContacts)
		mob.POST("/trusted-contacts", transportHandler.AddContact)
		mob.DELETE("/trusted-contacts/:id", transportHandler.DeleteContact)

		// Driver endpoints.
		drv := finance.Group("/driver")
		drv.POST("/onboarding/submit", transportHandler.OnboardingSubmit)
		drv.POST("/documents", transportHandler.AddDocument)
		drv.POST("/documents/presign", transportHandler.PresignDriverDocument)
		drv.POST("/vehicle", transportHandler.AddVehicle)
		drv.GET("/me", transportHandler.DriverMe)
		drv.PATCH("/status", transportHandler.DriverStatus)
		drv.GET("/requests", transportHandler.DriverRequests)
		drv.POST("/requests/:id/accept", transportHandler.DriverAccept)
		drv.POST("/requests/:id/counter", transportHandler.DriverCounter)
		drv.POST("/trips/:id/arrive", transportHandler.DriverArrive)
		drv.POST("/trips/:id/verify-pin", transportHandler.VerifyPin)
		drv.POST("/trips/:id/start", transportHandler.StartTrip)
		drv.POST("/trips/:id/complete", transportHandler.CompleteTrip)
		drv.GET("/earnings", transportHandler.DriverEarnings)
		drv.POST("/sos", transportHandler.DriverSOS)

		// Admin transport endpoints (user auth + admin gate + per-area RBAC;
		// every mutation audited).
		//
		// Auth chain (defense-in-depth):
		//   1. mapsAuth()                — RequireAuthContext + sets user_id; this is
		//                                  what populates GetAuthenticatedUser so the
		//                                  RBAC middleware can read the caller.
		//   2. requireUserID()          — legacy guard (user_id must be set).
		//   3. RequireAdmin(AdminAPIKey) — optional x-admin-api-key gate (no-op when
		//                                  AdminAPIKey is empty).
		//   4. RequirePermission(...)    — per-route slug, applied as route-level
		//                                  middleware so reads use `mobility.view`
		//                                  and mutations use the matching `.manage`
		//                                  slug (fail-closed).
		// Read-only GETs are gated with mobilityViewPerm; mutations with the
		// area-specific manage slug. The slugs are seeded (and granted to
		// super-admin) by 20260621090000_mobility_rbac.sql.
		adminTr := r.Group("/api/finance/admin/transport")
		adminTr.Use(mapsAuth())
		adminTr.Use(requireUserID())
		adminTr.Use(middleware.RequireAdmin(cfg.AdminAPIKey))
		adminTr.GET("/dashboard", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.Dashboard)
		adminTr.GET("/drivers", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.ListDrivers)
		adminTr.GET("/drivers/:id", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.DriverDetail)
		adminTr.PATCH("/drivers/:id/verification", middleware.RequirePermission(rbac, mobilityRideManagePerm), transportAdmin.SetVerification)
		adminTr.GET("/vehicles", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.ListVehicles)
		adminTr.PATCH("/vehicles/:id/status", middleware.RequirePermission(rbac, mobilityRideManagePerm), transportAdmin.SetVehicleStatus)
		adminTr.GET("/trips", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.ListTrips)
		adminTr.GET("/dispatch/live", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.DispatchLive)
		adminTr.POST("/dispatch/:trip_id/assign", middleware.RequirePermission(rbac, mobilityRideManagePerm), transportAdmin.ManualAssign)
		adminTr.GET("/pricing", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.GetPricing)
		adminTr.PATCH("/pricing", middleware.RequirePermission(rbac, mobilityManagePerm), transportAdmin.PatchPricing)
		adminTr.GET("/commission", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.ListCommission)
		adminTr.PATCH("/commission/:tier", middleware.RequirePermission(rbac, mobilityManagePerm), transportAdmin.PatchCommission)
		adminTr.GET("/safety/incidents", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.ListIncidents)
		adminTr.PATCH("/safety/incidents/:id", middleware.RequirePermission(rbac, mobilityManagePerm), transportAdmin.PatchIncident)
		adminTr.GET("/reports/summary", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.ReportsSummary)
		adminTr.GET("/audit", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AuditFeed)

		// ── Transport Trip Scheduling (schedule a future logistics movement) ──
		// A scheduling layer over the existing transport modes: the member books a
		// future ride/parcel/airport/bus; the transport-scheduler worker
		// materializes the real booking + escrows at a lead time before pickup.
		// Own feature flag (default OFF). Idempotency-Key required on create + cancel.
		if cfg.FeatureTransportSchedulingEnabled {
			// Member (owner-scoped) scheduled endpoints.
			mob.POST("/scheduled", transportHandler.ScheduledCreate)
			mob.GET("/scheduled", transportHandler.ScheduledList)
			mob.POST("/scheduled/estimate", transportHandler.ScheduledEstimate)
			mob.GET("/scheduled/:id", transportHandler.ScheduledGet)
			mob.PATCH("/scheduled/:id", transportHandler.ScheduledPatch)
			mob.POST("/scheduled/:id/cancel", transportHandler.ScheduledCancel)

			// Admin ops board (audited; per-action RBAC — read vs reassign vs cancel).
			adminTr.GET("/scheduled", middleware.RequirePermission(rbac, schedReadPerm), transportAdmin.AdminScheduledList)
			adminTr.GET("/scheduled/:id", middleware.RequirePermission(rbac, schedReadPerm), transportAdmin.AdminScheduledGet)
			adminTr.POST("/scheduled/:id/force-dispatch", middleware.RequirePermission(rbac, schedReassignPerm), transportAdmin.AdminScheduledForceDispatch)
			adminTr.POST("/scheduled/:id/reassign", middleware.RequirePermission(rbac, schedReassignPerm), transportAdmin.AdminScheduledReassign)
			adminTr.POST("/scheduled/:id/cancel", middleware.RequirePermission(rbac, schedCancelPerm), transportAdmin.AdminScheduledCancel)

			log.Println("[finance] transport trip scheduling (member + admin ops board) routes registered")
		}

		// ── Multi-modal expansion: parcel · bus · towing · movers · car hire ──
		// Reuses the same transport service/handlers, settlement escrow, driver
		// gate, pricing config, and audit sink. Gated on its own flag.
		if cfg.FeatureTransportModesEnabled {
			// Customer (rider) mode endpoints.
			mob.POST("/parcels/estimate", transportHandler.ParcelEstimate)
			mob.POST("/parcels", transportHandler.ParcelBook)
			mob.GET("/parcels", transportHandler.ParcelList)
			mob.GET("/parcels/:id", transportHandler.ParcelGet)
			mob.POST("/parcels/:id/cancel", transportHandler.ParcelCancel)
			// Plural for consistency with the rest of the /parcels tree (was the
			// singular /parcel/:id/rate typo). NOTE for the mobile agent: align the
			// client to POST /mobility/parcels/:id/rate.
			mob.POST("/parcels/:id/rate", transportHandler.ParcelRate)

			mob.GET("/bus/routes", transportHandler.BusRoutes)
			mob.GET("/bus/schedules", transportHandler.BusSchedules)
			mob.GET("/bus/schedules/:id/seats", transportHandler.BusSeatMap)
			mob.POST("/bus/book", transportHandler.BusBook)
			mob.GET("/bus/tickets", transportHandler.BusTickets)
			mob.POST("/bus/tickets/:id/cancel", transportHandler.BusTicketCancel)

			// ── Bus PROVIDER MARKETPLACE (interstate, self-service) ──
			// Customer discovery (member auth via the mobility group).
			mob.GET("/bus/search", transportHandler.BusSearch)
			mob.GET("/bus/providers", transportHandler.BusProviders)
			mob.GET("/bus/providers/:id", transportHandler.BusProviderDetail)
			// Provider self-service (owner-gated inside the service via
			// owner_user_id = user_id; a caller who is not a provider gets 403).
			mob.POST("/bus/provider/register", transportHandler.BusProviderRegister)
			mob.GET("/bus/provider/me", transportHandler.BusProviderMe)
			mob.PATCH("/bus/provider/me", transportHandler.BusProviderUpdate)
			mob.POST("/bus/provider/routes", transportHandler.BusProviderRouteCreate)
			mob.PATCH("/bus/provider/routes/:id", transportHandler.BusProviderRouteUpdate)
			mob.POST("/bus/provider/routes/:id/schedules", transportHandler.BusProviderScheduleCreate)
			mob.GET("/bus/provider/bookings", transportHandler.BusProviderBookings)

			mob.POST("/towing/estimate", transportHandler.TowingEstimate)
			mob.POST("/towing", transportHandler.TowingBook)
			mob.GET("/towing", transportHandler.TowingList)
			mob.GET("/towing/:id", transportHandler.TowingGet)
			mob.POST("/towing/:id/cancel", transportHandler.TowingCancel)
			mob.POST("/towing/:id/rate", transportHandler.TowingRate)

			mob.POST("/movers/quote", transportHandler.MoverQuote)
			mob.GET("/movers", transportHandler.MoverList)
			mob.GET("/movers/:id", transportHandler.MoverGet)
			mob.POST("/movers/:id/accept-bid", transportHandler.MoverAcceptBid)
			mob.POST("/movers/:id/confirm-completion", transportHandler.MoverConfirmCompletion)
			mob.POST("/movers/:id/cancel", transportHandler.MoverCancel)
			mob.POST("/movers/:id/rate", transportHandler.MoverRate)

			mob.POST("/car-hire/quote", transportHandler.CarHireQuote)
			mob.POST("/car-hire/book", transportHandler.CarHireBook)
			mob.GET("/car-hire", transportHandler.CarHireList)
			mob.GET("/car-hire/:id", transportHandler.CarHireGet)
			mob.POST("/car-hire/:id/activate", transportHandler.CarHireActivate)
			mob.POST("/car-hire/:id/extend", transportHandler.CarHireExtend)
			mob.POST("/car-hire/:id/complete", transportHandler.CarHireComplete)
			mob.POST("/car-hire/:id/cancel", transportHandler.CarHireCancel)

			// Driver (courier/operator/provider) mode endpoints.
			drv.GET("/parcels/requests", transportHandler.ParcelRequests)
			drv.POST("/parcels/:id/accept", transportHandler.ParcelAccept)
			drv.POST("/parcels/:id/verify-pickup-pin", transportHandler.ParcelVerifyPickupPin)
			drv.POST("/parcels/:id/picked-up", transportHandler.ParcelPickedUp)
			drv.POST("/parcels/:id/verify-dropoff", transportHandler.ParcelVerifyDropoff)

			drv.POST("/bus/validate", transportHandler.BusValidate)

			drv.GET("/towing/requests", transportHandler.TowingRequests)
			drv.POST("/towing/:id/accept", transportHandler.TowingAccept)
			drv.POST("/towing/:id/en-route", transportHandler.TowingEnRoute)
			drv.POST("/towing/:id/verify-pin", transportHandler.TowingVerifyPin)
			drv.POST("/towing/:id/start", transportHandler.TowingStart)
			drv.POST("/towing/:id/complete", transportHandler.TowingComplete)

			drv.GET("/movers/open", transportHandler.MoverOpen)
			drv.POST("/movers/:id/bid", transportHandler.MoverBid)
			drv.POST("/movers/:id/start", transportHandler.MoverStart)
			drv.POST("/movers/:id/complete", transportHandler.MoverComplete)

			// Admin mode endpoints (audited; per-mode RBAC — reads use mobility.view,
			// mutations use the mode-specific .manage slug).
			adminTr.GET("/parcels", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminParcelsList)
			adminTr.PATCH("/parcels/:id/status", middleware.RequirePermission(rbac, mobilityParcelManagePerm), transportAdmin.AdminParcelStatus)

			adminTr.GET("/bus/routes", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminBusListRoutes)
			adminTr.POST("/bus/routes", middleware.RequirePermission(rbac, mobilityBusManagePerm), transportAdmin.AdminBusCreateRoute)
			adminTr.POST("/bus/schedules", middleware.RequirePermission(rbac, mobilityBusManagePerm), transportAdmin.AdminBusCreateSchedule)
			adminTr.POST("/bus/schedules/:id/approve-fare", middleware.RequirePermission(rbac, mobilityBusManagePerm), transportAdmin.AdminBusApproveFare)
			adminTr.GET("/bus/manifest", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminBusManifest)

			adminTr.GET("/towing", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminTowingList)
			adminTr.PATCH("/towing/:id/status", middleware.RequirePermission(rbac, mobilityTowingManagePerm), transportAdmin.AdminTowingStatus)

			adminTr.GET("/movers", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminMoversList)
			adminTr.PATCH("/movers/:id/status", middleware.RequirePermission(rbac, mobilityMoversManagePerm), transportAdmin.AdminMoverStatus)

			adminTr.GET("/car-hire", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminCarHireList)
			adminTr.PATCH("/car-hire/:id/status", middleware.RequirePermission(rbac, mobilityManagePerm), transportAdmin.AdminCarHireStatus)

			// ── Final modes: business logistics + event transport ──
			// Business logistics (owner) endpoints.
			mob.POST("/business/accounts", transportHandler.BusinessAccountCreate)
			mob.GET("/business/accounts/me", transportHandler.BusinessAccountGet)
			mob.POST("/business/deliveries", transportHandler.BusinessDeliveryCreate)
			mob.GET("/business/deliveries", transportHandler.BusinessDeliveryList)
			mob.GET("/business/deliveries/:id", transportHandler.BusinessDeliveryGet)
			mob.POST("/business/deliveries/:id/cancel", transportHandler.BusinessDeliveryCancel)
			mob.POST("/business/batches", transportHandler.BusinessBatchCreate)
			mob.GET("/business/batches", transportHandler.BusinessBatchList)
			mob.GET("/business/batches/:id", transportHandler.BusinessBatchGet)
			mob.GET("/business/invoices", transportHandler.BusinessInvoiceList)
			mob.GET("/business/analytics", transportHandler.BusinessAnalytics)

			// Business logistics (courier) endpoints.
			drv.GET("/business/requests", transportHandler.BusinessRequests)
			drv.POST("/business/:id/accept", transportHandler.BusinessAccept)
			drv.POST("/business/:id/picked-up", transportHandler.BusinessPickedUp)
			drv.POST("/business/:id/deliver", transportHandler.BusinessDeliver)
			drv.POST("/business/:id/fail", transportHandler.BusinessFail)

			// Event transport (rider / organizer) endpoints. event_id is a query
			// param on the list endpoint (GET /mobility/events/transport?event_id=)
			// to keep the static /events/transport tree unambiguous and stable.
			mob.GET("/events/transport", transportHandler.EventOffersList)
			mob.POST("/events/transport", transportHandler.EventOfferCreate)
			mob.GET("/events/transport/:id", transportHandler.EventOfferGet)
			mob.POST("/events/transport/:id/book", transportHandler.EventBook)
			mob.GET("/events/bookings", transportHandler.EventBookings)
			mob.POST("/events/bookings/:id/cancel", transportHandler.EventBookingCancel)

			// Event transport (organizer/driver) validation.
			drv.POST("/events/validate", transportHandler.EventValidate)

			// Admin: business logistics + event transport (audited; per-area RBAC).
			adminTr.GET("/business/accounts", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminBusinessAccountsList)
			adminTr.PATCH("/business/accounts/:id/status", middleware.RequirePermission(rbac, mobilityLogisticsManagePerm), transportAdmin.AdminBusinessAccountStatus)
			adminTr.GET("/business/deliveries", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminBusinessDeliveriesList)
			adminTr.PATCH("/business/deliveries/:id/status", middleware.RequirePermission(rbac, mobilityLogisticsManagePerm), transportAdmin.AdminBusinessDeliveryStatus)
			adminTr.GET("/business/invoices", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminBusinessInvoicesList)
			adminTr.POST("/business/invoices/:id/issue", middleware.RequirePermission(rbac, mobilityLogisticsManagePerm), transportAdmin.AdminBusinessInvoiceIssue)
			adminTr.POST("/business/invoices/:id/mark-paid", middleware.RequirePermission(rbac, mobilityLogisticsManagePerm), transportAdmin.AdminBusinessInvoiceMarkPaid)
			adminTr.GET("/events/offers", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminEventOffersList)
			adminTr.PATCH("/events/offers/:id/status", middleware.RequirePermission(rbac, mobilityEventManagePerm), transportAdmin.AdminEventOfferStatus)
			adminTr.GET("/events/bookings", middleware.RequirePermission(rbac, mobilityViewPerm), transportAdmin.AdminEventBookingsList)

			log.Println("[finance] transport modes (parcel/bus/towing/movers/car-hire/logistics/event) routes registered")
		}

		// Crash-recovery settlement reconciliation (money-path durability): a trip
		// marked completed whose escrow never released (process died / Settle errored
		// after the completion commit) is re-driven through the SAME idempotent
		// settleTrip path. Idempotent + multi-instance safe (Settle guards on
		// status='escrowed' + ON CONFLICT ledger legs + FOR UPDATE lock). Cadence 5m,
		// grace 10m by default; ops-tunable via env.
		transport.StartStuckSettlementReconciler(
			ctx, transportSvc,
			time.Duration(envInt("TRANSPORT_RECONCILE_INTERVAL_MINUTES", 5))*time.Minute,
			time.Duration(envInt("TRANSPORT_SETTLE_GRACE_MINUTES", 10))*time.Minute,
		)
	}

	// --- Disputes routes ---
	if cfg.FeatureDisputesEnabled {
		disputesSvc := disputes.NewService(pool)
		disputesHandler := disputes.NewHandler(disputesSvc)
		dpGroup := finance.Group("/disputes")
		dpGroup.POST("", disputesHandler.Open)
		dpGroup.GET("", disputesHandler.List)
		adminFinanceDisputes := r.Group("/api/finance/admin/disputes")
		adminFinanceDisputes.Use(requireUserID())
		adminFinanceDisputes.POST("/:id/resolve", disputesHandler.AdminResolve)
	}

	// --- Ratings routes ---
	if cfg.FeatureRatingsEnabled {
		ratingsSvc := ratings.NewService(pool)
		ratingsHandler := ratings.NewHandler(ratingsSvc)
		rtGroup := finance.Group("/ratings")
		rtGroup.POST("", ratingsHandler.Create)
		rtGroup.GET("/:entity_id", ratingsHandler.GetSummary)
	}

	// --- Vote bridge routes ---
	// Provides a wallet-debit endpoint called by the Next.js bridge before crediting
	// votes via the legacy Spotlight service. Never touches protected contest files.
	if cfg.FeatureVoteBridgeEnabled && cfg.FeatureWalletEnabled {
		vbHandler := votebridge.NewHandler(walletSvc)
		r.POST("/api/finance/vote-bridge/debit", requireUserID(), vbHandler.DebitForVotes)
	}

	// --- Admin finance routes ---
	adminFinance := r.Group("/api/finance/admin")
	adminFinance.Use(requireUserID())
	if cfg.FeatureKYCEnabled {
		adminFinance.GET("/kyc/pending", kycHandler.ListPending)
		adminFinance.POST("/kyc/users/:user_id/approve", kycHandler.Approve)
		adminFinance.POST("/kyc/users/:user_id/reject", kycHandler.Reject)
	}
	if cfg.FeatureWalletEnabled {
		adminFinance.GET("/wallets/:user_id/balance", walletHandler.AdminGetBalance)
		adminFinance.GET("/wallets/:user_id/transactions", walletHandler.AdminListTransactions)
	}

	// --- Merchant Onboarding & Role-Upgrade routes ---
	// Captured so the CAC business-registry gate can be injected below once the
	// business service is built (SetBusinessGate). Nil when onboarding is flag-off.
	merchantOnboardingSvc := onboarding.Register(r, onboarding.Deps{
		DB:       pool,
		Supabase: supabase,
		RBAC:     rbac,
		Enabled:  cfg.FeatureOnboardingEnabled,
	})

	// --- Doctor (provider) telemedicine routes ---
	// Mounted on /api/v1/doctor (the mobile client base) with the Supabase-JWT
	// auth middleware. Money path (POST /payouts) posts a balanced double-entry
	// via the shared ledger, enforces tier limits fail-closed, and is idempotent.
	if cfg.FeatureDoctorEnabled {
		// Wave 6: realtime layer. The RTC Issuer signs short-lived Agora/VideoSDK
		// join tokens server-side (creds never leave the process); an unconfigured
		// provider yields an empty token + a "not configured" flag, never a fake one.
		// One shared WS Hub fans push events to a doctor's connected devices.
		rtcIssuer := rtc.NewIssuer(rtc.Config{
			AgoraAppID:          cfg.AgoraAppID,
			AgoraAppCertificate: cfg.AgoraAppCertificate,
			VideoSDKAPIKey:      cfg.VideoSDKAPIKey,
			VideoSDKSecret:      cfg.VideoSDKSecret,
		})
		doctorHub := platformWS.New()

		doctorSvc := doctor.NewService(pool, ledgerSvc, tiersSvc, redisClient).WithRealtime(rtcIssuer, doctorHub)
		// Backend-owned presigned R2 uploads (profile photo / documents / licence /
		// chat attachments / dispute evidence). Unconfigured creds → the presign
		// endpoint fails closed with 503. Bucket default mirrors CLAUDE.md.
		doctorPresigner := r2.New(r2.Config{
			AccountEndpoint: cfg.R2AccountEndpoint,
			Bucket:          cfg.R2Bucket,
			AccessKeyID:     cfg.R2AccessKeyID,
			SecretAccessKey: cfg.R2SecretAccessKey,
			Region:          cfg.R2Region,
		})
		doctorHandler := doctor.NewHandler(doctorSvc).WithHub(doctorHub).
			WithPresigner(doctorPresigner, cfg.R2Bucket)

		// Wave 5: AI-assist. The LLM client is server-side only (key from config);
		// an empty key disables AI (endpoints return a "not configured" envelope).
		llmClient := llm.NewAnthropicClient(cfg.AnthropicAPIKey)
		doctorAIHandler := doctor.NewAIHandler(doctorHandler,
			doctor.NewAIService(doctorSvc, llmClient).
				WithRateLimits(cfg.DoctorAIRatePerMin, cfg.DoctorAIRatePerDay))

		docGroup := r.Group("/api/v1/doctor")
		docGroup.Use(middleware.RequireAuthContext(supabase, rbac))

		// Reads
		docGroup.GET("/profile", doctorHandler.GetProfile)
		docGroup.GET("/verification", doctorHandler.GetVerification)
		docGroup.GET("/availability", doctorHandler.GetAvailability)
		docGroup.GET("/appointments", doctorHandler.ListAppointments)
		docGroup.GET("/appointments/:appointmentId", doctorHandler.GetAppointment)
		docGroup.GET("/appointments/:appointmentId/notes", doctorHandler.ListNotes)
		docGroup.GET("/patients/:patientId", doctorHandler.GetPatient)
		docGroup.GET("/prescriptions", doctorHandler.ListPrescriptions)
		docGroup.GET("/prescriptions/:id", doctorHandler.GetPrescription)
		docGroup.GET("/lab-orders", doctorHandler.ListLabOrders)
		docGroup.GET("/lab-orders/:orderId/result", doctorHandler.GetLabResult)
		docGroup.GET("/earnings", doctorHandler.GetEarnings)
		docGroup.GET("/notifications", doctorHandler.ListNotifications)
		docGroup.GET("/settings", doctorHandler.GetSettings)

		// Mutations (require Idempotency-Key where money/clinical records are written)
		docGroup.POST("/verification", doctorHandler.SubmitVerification)
		docGroup.PUT("/availability", doctorHandler.UpdateAvailability)
		docGroup.POST("/appointments/:appointmentId/status", doctorHandler.UpdateAppointmentStatus)
		docGroup.POST("/appointments/:appointmentId/notes", doctorHandler.SaveNote)
		docGroup.POST("/prescriptions", doctorHandler.CreatePrescription)
		docGroup.POST("/lab-orders", doctorHandler.CreateLabOrder)
		docGroup.POST("/lab-results/:resultId/review", doctorHandler.ReviewLabResult)
		docGroup.PUT("/settings", doctorHandler.UpdateSettings)
		docGroup.POST("/notifications/:id/read", doctorHandler.MarkNotificationRead)

		// Money path
		docGroup.POST("/payouts", doctorHandler.RequestPayout)

		// ── Wave 2 (account / provider / admin) ──────────────────────────────
		// Onboarding
		docGroup.GET("/onboarding/consents", doctorHandler.ListConsents)
		docGroup.POST("/onboarding/consents", doctorHandler.AcceptConsent)
		docGroup.GET("/onboarding/permissions", doctorHandler.ListPermissions)
		docGroup.POST("/onboarding/permissions", doctorHandler.RecordPermission)
		docGroup.GET("/onboarding/merchant-upgrade", doctorHandler.GetMerchantUpgrade)
		docGroup.POST("/onboarding/merchant-upgrade", doctorHandler.RequestMerchantUpgrade)
		docGroup.POST("/onboarding/provider-type", doctorHandler.SetProviderType)

		// Profile builder + licence
		docGroup.GET("/profile/draft", doctorHandler.GetProfileDraft)
		docGroup.PUT("/profile/draft", doctorHandler.SaveProfileDraft)
		docGroup.GET("/profile/documents", doctorHandler.ListProfileDocuments)
		docGroup.POST("/profile/publish", doctorHandler.PublishProfile)
		docGroup.GET("/licence/expiry-warning", doctorHandler.GetLicenceExpiry)
		docGroup.POST("/licence/renew", doctorHandler.RenewLicence)

		// Notifications (groups / preferences / read-all)
		docGroup.GET("/notifications/groups", doctorHandler.ListNotificationGroups)
		docGroup.GET("/notifications/preferences", doctorHandler.ListNotificationPreferences)
		docGroup.PUT("/notifications/preferences", doctorHandler.UpdateNotificationPreference)
		docGroup.POST("/notifications/read-all", doctorHandler.MarkAllNotificationsRead)

		// Support (tickets / disputes / threads)
		docGroup.GET("/support/tickets", doctorHandler.ListSupportTickets)
		docGroup.POST("/support/tickets", doctorHandler.CreateSupportTicket)
		docGroup.GET("/disputes", doctorHandler.ListSupportDisputes)
		docGroup.POST("/disputes", doctorHandler.CreateSupportDispute)
		docGroup.GET("/disputes/:id", doctorHandler.GetSupportDispute)
		docGroup.POST("/disputes/:id/evidence", doctorHandler.AddDisputeEvidence)
		docGroup.GET("/support/:threadId/messages", doctorHandler.ListSupportMessages)
		docGroup.POST("/support/:threadId/messages", doctorHandler.SendSupportMessage)

		// Compliance (audit / training / safety / privacy)
		docGroup.GET("/audit-trail", doctorHandler.ListAuditTrail)
		docGroup.GET("/training", doctorHandler.ListTraining)
		docGroup.POST("/training/:moduleId/complete", doctorHandler.CompleteTraining)
		docGroup.GET("/safety-issues", doctorHandler.ListSafetyIssues)
		docGroup.POST("/safety-issues", doctorHandler.ReportSafetyIssue)
		docGroup.GET("/privacy", doctorHandler.GetPrivacySettings)
		docGroup.PUT("/privacy", doctorHandler.UpdatePrivacySettings)

		// Security / devices / preferences
		docGroup.GET("/security", doctorHandler.GetSecurity)
		docGroup.PUT("/security/biometric", doctorHandler.SetSecurityFlags)
		docGroup.PUT("/security/2fa", doctorHandler.SetSecurityFlags)
		docGroup.GET("/security/devices", doctorHandler.ListDevices)
		docGroup.DELETE("/security/devices/:deviceId", doctorHandler.RevokeDevice)
		docGroup.GET("/preferences", doctorHandler.GetAppPreferences)
		docGroup.PUT("/preferences", doctorHandler.UpdateAppPreferences)

		// Reputation / quality / reviews
		docGroup.GET("/quality/score", doctorHandler.GetQualityScore)
		docGroup.GET("/quality/ranking", doctorHandler.GetRanking)
		docGroup.GET("/quality/recommendations", doctorHandler.GetImprovements)
		docGroup.GET("/feedback", doctorHandler.ListConsultationFeedback)
		docGroup.GET("/reviews/disputes", doctorHandler.ListReviewDisputes)
		docGroup.POST("/reviews/:reviewId/dispute", doctorHandler.DisputeReview)
		docGroup.POST("/reviews/:reviewId/report", doctorHandler.ReportReview)
		docGroup.POST("/reviews/:reviewId/removal-request", doctorHandler.ReportReview)

		// ── Wave 3a: PHARMACY (doctor-phase2 + doctor-batch3) ──
		docGroup.GET("/pharmacy/fulfilments", doctorHandler.ListPharmacyFulfilments)
		docGroup.GET("/pharmacy/fulfilments/:id", doctorHandler.GetPharmacyFulfilment)
		docGroup.GET("/pharmacy/fulfilments/:id/delivery", doctorHandler.GetFulfilmentDelivery)
		docGroup.POST("/pharmacy/fulfilments/:id/substitute", doctorHandler.ReviewSubstitute)
		docGroup.GET("/drug-deliveries", doctorHandler.ListDrugDeliveries)
		docGroup.GET("/refills", doctorHandler.ListRefillRequests)
		docGroup.GET("/refills/:id", doctorHandler.GetRefillRequest)
		docGroup.POST("/refills/:id/review", doctorHandler.ReviewRefill)
		docGroup.GET("/pharmacies", doctorHandler.ListPharmacies)
		docGroup.GET("/pharmacies/preferred", doctorHandler.GetPreferredPharmacy)
		docGroup.GET("/pharmacies/:pharmacyId/stock", doctorHandler.GetPharmacyStock)
		docGroup.POST("/pharmacies/:pharmacyId/report", doctorHandler.ReportPharmacy)
		docGroup.GET("/pharmacy/:fulfilmentId/messages", doctorHandler.ListPharmacyMessages)
		docGroup.POST("/pharmacy/:fulfilmentId/messages", doctorHandler.SendPharmacyMessage)
		docGroup.POST("/pharmacy/:fulfilmentId/received", doctorHandler.ConfirmFulfilmentReceived)
		docGroup.GET("/delivery-alerts", doctorHandler.ListDeliveryAlerts)

		// ── Wave 3a: LABS extended (doctor-batch3) ──
		docGroup.GET("/lab-catalogue", doctorHandler.ListLabCatalogue)
		docGroup.GET("/lab-packages", doctorHandler.ListLabPackages)
		docGroup.GET("/lab-providers", doctorHandler.ListLabProviders)
		docGroup.GET("/lab-orders/:orderId/rich", doctorHandler.GetLabOrderRich)
		docGroup.POST("/lab-orders/:orderId/share", doctorHandler.ShareLabOrder)
		docGroup.POST("/lab-orders/:orderId/cancel", doctorHandler.CancelLabOrder)
		docGroup.GET("/lab-results/inbox", doctorHandler.ListLabResultInbox)
		docGroup.GET("/lab-results/:resultId/rich", doctorHandler.GetLabResultRich)
		docGroup.GET("/lab-results/:resultId/comparisons", doctorHandler.ListLabValueComparisons)
		docGroup.PUT("/lab-results/:resultId/interpretation", doctorHandler.AddLabInterpretation)
		docGroup.POST("/lab-results/:resultId/share-explanation", doctorHandler.ShareLabExplanation)
		docGroup.POST("/lab-results/:resultId/report", doctorHandler.ReportSuspiciousResult)

		// ── Wave 3a: REFERRALS & COLLABORATION (doctor-phase2 + doctor-batch4) ──
		docGroup.GET("/specialists", doctorHandler.ListSpecialists)
		docGroup.GET("/referrals", doctorHandler.ListReferrals)
		docGroup.POST("/referrals", doctorHandler.CreateReferral)
		docGroup.GET("/referrals/incoming", doctorHandler.ListIncomingReferrals)
		docGroup.GET("/referrals/incoming/:id", doctorHandler.GetIncomingReferral)
		docGroup.POST("/referrals/incoming/:id/accept", doctorHandler.AcceptIncomingReferral)
		docGroup.POST("/referrals/incoming/:id/reject", doctorHandler.RejectIncomingReferral)
		docGroup.GET("/referrals/:id", doctorHandler.GetReferral)
		docGroup.GET("/opinions", doctorHandler.ListOpinionRequests)
		docGroup.POST("/opinions", doctorHandler.CreateOpinionRequest)
		docGroup.GET("/opinions/:id", doctorHandler.GetOpinionRequest)
		docGroup.GET("/care-team/:threadId", doctorHandler.ListCareTeamMessages)
		docGroup.POST("/care-team/:threadId/messages", doctorHandler.SendCareTeamMessage)
		docGroup.GET("/case-summaries/:caseRef", doctorHandler.GetSharedCaseSummary)

		// ── Wave 3a: FOLLOW-UP CARE (doctor-phase2 + doctor-batch4) ──
		docGroup.GET("/follow-ups", doctorHandler.ListFollowUps)
		docGroup.POST("/follow-ups", doctorHandler.CreateFollowUp)
		docGroup.GET("/follow-ups/:id", doctorHandler.GetFollowUp)
		docGroup.POST("/follow-ups/:id/review", doctorHandler.ReviewFollowUp)
		docGroup.POST("/follow-ups/:id/reminder", doctorHandler.SetFollowUpReminder)
		docGroup.POST("/follow-ups/:id/complete", doctorHandler.CompleteFollowUp)
		docGroup.GET("/patients/:patientId/follow-up-eligibility", doctorHandler.GetFollowUpEligibility)
		docGroup.GET("/care-plans", doctorHandler.ListCarePlans)
		docGroup.POST("/care-plans", doctorHandler.SaveCarePlan)
		docGroup.GET("/care-plans/:id", doctorHandler.GetCarePlan)
		docGroup.GET("/chronic-monitoring", doctorHandler.ListChronicMonitoring)
		docGroup.POST("/chronic-monitoring", doctorHandler.SaveChronicMonitoring)
		docGroup.GET("/adherence-checks", doctorHandler.ListAdherenceChecks)
		docGroup.POST("/adherence-checks", doctorHandler.RecordAdherenceCheck)

		// ── Wave 3a: HMO (doctor-phase2 + doctor-batch4) ──
		docGroup.GET("/hmo/coverage/:patientId", doctorHandler.GetHMOCoverage)
		docGroup.GET("/hmo/pre-auth", doctorHandler.ListPreAuthRequests)
		docGroup.POST("/hmo/pre-auth", doctorHandler.RequestPreAuth)
		docGroup.GET("/hmo/pre-auth/:id", doctorHandler.GetPreAuthRequest)
		docGroup.GET("/hmo/covered-services", doctorHandler.ListCoveredServices)
		docGroup.GET("/hmo/claims", doctorHandler.ListHMOClaims)
		docGroup.GET("/hmo/claims/:id", doctorHandler.GetHMOClaim)
		docGroup.GET("/hmo/support/:threadId", doctorHandler.ListHMOSupportThread)
		docGroup.POST("/hmo/support/:threadId/messages", doctorHandler.SendHMOSupportMessage)
		docGroup.GET("/hmo/fraud-warnings", doctorHandler.ListFraudWarnings)
		docGroup.POST("/hmo/fraud-warnings/:warningId/ack", doctorHandler.AckFraudWarning)

		// ── Wave 3a: MEDICAL RECORDS (doctor-batch6) ──
		docGroup.GET("/records/dashboard", doctorHandler.GetRecordsDashboard)
		docGroup.GET("/records/shares", doctorHandler.ListRecordShares)
		docGroup.GET("/records/:patientId/index", doctorHandler.GetPatientRecordIndex)
		docGroup.GET("/records/:patientId/restrictions", doctorHandler.ListRecordRestrictions)
		docGroup.GET("/records/:patientId/restricted-warnings", doctorHandler.ListRestrictedWarnings)
		docGroup.POST("/records/:patientId/export", doctorHandler.ExportRecord)
		docGroup.POST("/records/:patientId/share", doctorHandler.ShareRecord)
		docGroup.POST("/records/:patientId/access-request", doctorHandler.RequestRecordAccess)

		// --- Wave 3b: VETERINARY / PET-side ---
		// VET CONSULT
		docGroup.GET("/vet/dashboard", doctorHandler.GetVetDashboard)
		docGroup.POST("/vet/mode", doctorHandler.ToggleVetMode)
		docGroup.GET("/vet/appointments", doctorHandler.ListVetAppointments)
		docGroup.GET("/vet/owner-requests", doctorHandler.ListPetOwnerRequests)
		docGroup.POST("/vet/requests/:requestId/respond", doctorHandler.RespondToOwnerRequest)
		docGroup.GET("/vet/specialists", doctorHandler.ListVetSpecialists)
		docGroup.POST("/vet/soap-notes", doctorHandler.SaveVetSoapNote)
		docGroup.POST("/vet/referrals", doctorHandler.CreateVetReferral)
		docGroup.GET("/vet/consults/history", doctorHandler.ListVetConsultHistory)
		docGroup.GET("/vet/consults/:consultId/summary", doctorHandler.GetVetConsultSummary)
		docGroup.GET("/vet/pharmacies", doctorHandler.ListPetPharmacies)

		// PET PROFILE (per-pet reads use the :petId param consistently)
		docGroup.GET("/vet/pets/:petId", doctorHandler.GetPet)
		docGroup.GET("/vet/pets/:petId/chat", doctorHandler.GetPetChatThread)
		docGroup.GET("/vet/pets/:petId/call", doctorHandler.GetPetCallSession)
		docGroup.GET("/vet/pets/:petId/soap-note", doctorHandler.GetPetSoapNote)
		docGroup.GET("/vet/pets/:petId/emergency-warnings", doctorHandler.ListPetEmergencyWarnings)
		docGroup.GET("/vet/pets/:petId/referrals", doctorHandler.ListPetReferrals)
		docGroup.GET("/vet/pets/:petId/recommendations", doctorHandler.ListPetRecommendationsForPet)
		docGroup.GET("/vet/pets/:petId/prescription", doctorHandler.GetPetPrescriptionForPet)
		docGroup.GET("/vet/pets/:petId/health-record", doctorHandler.GetPetHealthRecord)
		docGroup.GET("/vet/pets/:petId/growth", doctorHandler.GetPetGrowth)
		docGroup.POST("/vet/pets/:petId/growth", doctorHandler.RecordPetGrowth)
		docGroup.GET("/vet/pets/:petId/vaccination-recommendations", doctorHandler.ListPetVaccinationRecommendations)
		docGroup.GET("/vet/pets/:petId/vaccination-reminders", doctorHandler.ListPetVaccinationReminders)
		docGroup.GET("/vet/pets/:petId/chronic-monitoring", doctorHandler.ListPetChronicMonitoring)
		docGroup.POST("/vet/pets/:petId/chronic-monitoring", doctorHandler.SavePetChronicMonitoring)

		// PET E-PRESCRIPTION
		docGroup.POST("/vet/prescriptions", doctorHandler.CreatePetPrescription)
		docGroup.GET("/vet/prescriptions/:prescriptionId/issued", doctorHandler.GetIssuedPetPrescription)
		docGroup.POST("/vet/prescriptions/:prescriptionId/issue", doctorHandler.IssuePetPrescription)
		docGroup.POST("/vet/prescriptions/:prescriptionId/send", doctorHandler.SendPetPrescription)
		docGroup.GET("/vet/refills", doctorHandler.ListPetRefills)
		docGroup.POST("/vet/refills", doctorHandler.RequestPetRefill)
		docGroup.POST("/vet/refills/:refillId/review", doctorHandler.ReviewPetRefill)

		// PET LABS
		docGroup.GET("/vet/lab-orders", doctorHandler.ListPetLabOrders)
		docGroup.POST("/vet/lab-orders", doctorHandler.CreatePetLabOrder)
		docGroup.GET("/vet/lab-orders/:orderId/result", doctorHandler.GetPetLabResultForOrder)
		docGroup.GET("/vet/lab-catalogue", doctorHandler.ListPetLabCatalogue)
		docGroup.GET("/vet/lab-results/inbox", doctorHandler.ListPetLabResultInbox)
		docGroup.POST("/vet/lab-results/:resultId/review", doctorHandler.ReviewPetLabResult)
		docGroup.POST("/vet/lab-results/:resultId/interpretation", doctorHandler.AddPetLabInterpretation)
		docGroup.POST("/vet/vaccination-reminders", doctorHandler.SetPetVaccinationReminder)

		// PET STORE
		docGroup.GET("/vet/products", doctorHandler.ListPetProducts)
		docGroup.GET("/vet/products/:productId", doctorHandler.GetPetProduct)
		docGroup.POST("/vet/recommendations", doctorHandler.RecommendPetProducts)
		docGroup.GET("/vet/recommendations", doctorHandler.ListPetRecommendations)
		docGroup.POST("/vet/recommendations/:recommendationId/share", doctorHandler.SharePetRecommendation)
		docGroup.GET("/vet/product-fulfilments", doctorHandler.ListPetFulfilments)
		docGroup.GET("/vet/product-fulfilments/:id", doctorHandler.GetPetFulfilment)

		// ── Wave 4: CHAT (persistence; realtime WS push is OUT OF SCOPE — TODO) ──
		docGroup.GET("/chat/threads", doctorHandler.ListChatThreads)
		docGroup.GET("/chat/:threadId/messages", doctorHandler.ListChatMessages)
		docGroup.POST("/chat/:threadId/messages", doctorHandler.SendChatMessage)

		// ── Wave 4/6: CALL SESSIONS (Wave 6 issues real Agora/VideoSDK RTC tokens) ──
		docGroup.GET("/calls/:appointmentId", doctorHandler.GetCallSession)
		docGroup.POST("/calls/:appointmentId/join", doctorHandler.StartCallSession)
		docGroup.POST("/calls/:appointmentId/leave", doctorHandler.EndCallSession)
		// Wave 6: fresh short-lived RTC token refresh (time-bound; no idempotency).
		docGroup.POST("/calls/:appointmentId/token", doctorHandler.IssueCallToken)

		// ── Wave 6: REALTIME WebSocket (server→client push for the authed doctor) ──
		docGroup.GET("/ws", doctorHandler.ServeWS)

		// ── Wave 4: SCHEDULE MANAGEMENT (Section E) ──
		docGroup.GET("/schedule/blocked-dates", doctorHandler.ListBlockedDates)
		docGroup.POST("/schedule/blocked-dates", doctorHandler.CreateBlockedDate)
		docGroup.GET("/schedule/vacation", doctorHandler.GetVacation)
		docGroup.PUT("/schedule/vacation", doctorHandler.SetVacation)
		docGroup.GET("/schedule/recurring", doctorHandler.ListRecurringRules)
		docGroup.PUT("/schedule/recurring", doctorHandler.SaveRecurringRule)
		docGroup.GET("/schedule/reminders", doctorHandler.ListReminders)
		docGroup.PUT("/schedule/reminders", doctorHandler.SaveReminderSettings)
		docGroup.PUT("/schedule/timezone", doctorHandler.SetTimezone)

		// ── Wave 4: APPOINTMENT QUEUE (Section F) ──
		docGroup.GET("/queue", doctorHandler.ListConsultQueue)
		docGroup.GET("/appointment-requests", doctorHandler.ListAppointmentRequests)
		docGroup.GET("/appointment-requests/:id", doctorHandler.GetAppointmentRequest)
		docGroup.POST("/appointments/:appointmentId/accept", doctorHandler.AcceptAppointment)
		docGroup.POST("/appointments/:appointmentId/reject", doctorHandler.RejectAppointment)
		docGroup.POST("/appointments/:appointmentId/request-reschedule", doctorHandler.RescheduleAppointment)
		docGroup.POST("/appointments/:appointmentId/reschedule", doctorHandler.RescheduleAppointment)

		// ── Wave 4: HMO CLAIMS (submit + dispute; GET list/get shipped in Wave 3a) ──
		docGroup.POST("/hmo/claims", doctorHandler.SubmitHMOClaim)
		// Route param is :id to match the existing GET /hmo/claims/:id (gin forbids two
		// different param names at the same position); OpenAPI spells this {claimId}.
		docGroup.POST("/hmo/claims/:id/dispute", doctorHandler.DisputeHMOClaim)

		// ── Wave 4: MULTI-CLINIC PORTFOLIO (quality analytics shipped in Wave 2) ──
		docGroup.GET("/clinics", doctorHandler.GetClinicPortfolio)
		docGroup.POST("/clinics/active", doctorHandler.SetActiveClinic)
		docGroup.PATCH("/clinics/:clinicId/schedule", doctorHandler.UpdateClinicSchedule)

		// ── Wave 5: AI ASSIST (server-side LLM; advisory decision-support only) ──
		docGroup.POST("/ai/note-summary", doctorAIHandler.GenerateNoteSummary)
		docGroup.POST("/ai/note-summary/accept", doctorAIHandler.AcceptNoteSummary)
		docGroup.POST("/ai/rx-safety", doctorAIHandler.CheckPrescriptionSafety)
		docGroup.POST("/ai/lab-explanation", doctorAIHandler.ExplainLabResult)

		// ── Finishing/hardening pass: remaining contract endpoints ───────────────
		// These complete coverage of contracts/doctor.openapi.yaml. Param names are
		// kept CONSISTENT with the existing wildcard tree to avoid gin "conflicting
		// param" panics: /prescriptions/:id/* (matches existing /prescriptions/:id),
		// /payouts/:id/* (single :id position), /appointments/:appointmentId/*,
		// /calls/:appointmentId/*, /chat/:threadId/*, /patients/:patientId/*.

		// Appointment lifecycle transitions (doctor_appointments).
		docGroup.POST("/appointments/:appointmentId/start", doctorHandler.StartAppointment)
		docGroup.POST("/appointments/:appointmentId/end", doctorHandler.EndAppointment)
		docGroup.POST("/appointments/:appointmentId/cancel", doctorHandler.CancelAppointment)
		docGroup.POST("/appointments/:appointmentId/no-show", doctorHandler.MarkNoShow)

		// Clinical notes (doctor_clinical_notes).
		docGroup.GET("/appointments/:appointmentId/clinical-note", doctorHandler.GetClinicalNote)
		docGroup.PUT("/appointments/:appointmentId/clinical-note", doctorHandler.SaveClinicalNote)
		docGroup.POST("/clinical-notes/:noteId/finalize", doctorHandler.FinalizeClinicalNote)
		docGroup.POST("/clinical-notes/:noteId/share", doctorHandler.ShareClinicalNote)

		// HMO eligibility for an appointment (doctor_hmo_plan_coverage).
		docGroup.GET("/appointments/:appointmentId/hmo-eligibility", doctorHandler.GetHMOEligibility)

		// Prescription lifecycle + pharmacy routing (doctor_prescriptions / _audit).
		// NOTE: :id keeps the same gin tree position as GET /prescriptions/:id above.
		docGroup.GET("/prescriptions/:id/issued", doctorHandler.GetIssuedPrescription)
		docGroup.POST("/prescriptions/:id/issue", doctorHandler.IssuePrescription)
		docGroup.POST("/prescriptions/:id/cancel", doctorHandler.CancelPrescription)
		docGroup.POST("/prescriptions/:id/share", doctorHandler.SharePrescription)
		docGroup.POST("/prescriptions/:id/pharmacy", doctorHandler.AttachPrescriptionPharmacy)
		docGroup.POST("/prescriptions/:id/send-to-pharmacy", doctorHandler.SendPrescriptionToPharmacy)
		docGroup.POST("/prescriptions/:id/refill-consultation", doctorHandler.RequestRefillConsultation)

		// Call session extras (doctor_call_sessions / _disputes / consultation_feedback).
		docGroup.GET("/calls/:appointmentId/pre-check", doctorHandler.GetCallPreCheck)
		docGroup.GET("/calls/:appointmentId/rich", doctorHandler.GetCallRich)
		docGroup.POST("/calls/:appointmentId/dispute", doctorHandler.DisputeCall)
		docGroup.POST("/calls/:appointmentId/feedback", doctorHandler.SubmitCallFeedback)
		docGroup.POST("/calls/:appointmentId/switch-provider", doctorHandler.SwitchCallProvider)

		// Chat extras (doctor_chat_threads / doctor_chat_messages).
		docGroup.GET("/chat/:threadId/presence", doctorHandler.GetChatPresence)
		docGroup.GET("/chat/:threadId/rich-messages", doctorHandler.ListChatRichMessages)
		docGroup.GET("/chat/:threadId/state", doctorHandler.GetChatState)
		docGroup.GET("/chat/:threadId/transcript", doctorHandler.GetChatTranscript)
		docGroup.POST("/chat/:threadId/attachments", doctorHandler.SendChatAttachment)
		docGroup.POST("/chat/:threadId/end", doctorHandler.EndChatThread)
		docGroup.POST("/chat/:threadId/escalate", doctorHandler.EscalateChatThread)
		docGroup.POST("/chat/:threadId/share", doctorHandler.ShareChatThread)
		docGroup.POST("/chat/:threadId/voice", doctorHandler.SendChatVoice)
		docGroup.POST("/chat/messages/:messageId/report", doctorHandler.ReportChatMessage)
		docGroup.PUT("/chat/messages/:messageId/annotations", doctorHandler.AnnotateChatMessage)

		// Emergency (doctor_emergency_cases / doctor_emergency_escalations).
		// Case CRUD is always available; the REAL-WORLD DISPATCH endpoints
		// (ambulance / hospital / emergency-contact notify) are SEPARATELY
		// feature-flagged and default OFF. They MUST route to a vetted emergency-
		// services provider before any real go-live — do NOT enable without that
		// integration + a separate safety review. See DOCTOR_GO_LIVE.md "Emergency
		// dispatch (DEMO-guarded)".
		docGroup.GET("/emergency/cases/:id", doctorHandler.GetEmergencyCase)
		docGroup.POST("/emergency/cases", doctorHandler.CreateEmergencyCase)
		if cfg.FeatureDoctorEmergencyDispatchEnabled {
			docGroup.POST("/emergency/contacts/:patientId/notify", doctorHandler.NotifyEmergencyContact)
			docGroup.POST("/emergency/escalate/ambulance", doctorHandler.EscalateAmbulance)
			docGroup.POST("/emergency/escalate/hospital", doctorHandler.EscalateHospital)
		} else {
			log.Println("[doctor] emergency dispatch routes DISABLED " +
				"(FEATURE_DOCTOR_EMERGENCY_DISPATCH_ENABLED=false) — must route to a " +
				"vetted provider before go-live")
		}

		// AI advisory read-backs (NOT persisted: return a "regenerate" envelope; no LLM call).
		docGroup.GET("/ai/note-summary/:appointmentId", doctorHandler.GetStoredNoteSummary)
		docGroup.GET("/ai/rx-safety/:id", doctorHandler.GetStoredRxSafety)
		docGroup.GET("/ai/lab-explanation/:resultId", doctorHandler.GetStoredLabExplanation)

		// Backend-owned presigned R2 upload URL (profile photo / document / licence /
		// chat attachment / dispute evidence). Client PUTs the binary direct to R2,
		// then records metadata via the existing endpoints. 503 when R2 unconfigured.
		docGroup.POST("/uploads/presign", doctorHandler.PresignUpload)

		// Profile builder extras (doctor_profiles / doctor_bank_accounts / _verification_documents).
		docGroup.POST("/profile/bank-account", doctorHandler.CreateBankAccount)
		docGroup.POST("/profile/documents", doctorHandler.UploadProfileDocument)
		docGroup.POST("/profile/photo", doctorHandler.SetProfilePhoto)
		docGroup.PUT("/profile/tax-info", doctorHandler.UpdateTaxInfo)

		// Payouts reads + account + dispute (doctor_payouts / _bank_accounts / settlement_disputes).
		// :id keeps a single gin wildcard tree position under /payouts.
		docGroup.GET("/payouts", doctorHandler.ListPayouts)
		docGroup.GET("/payouts/:id", doctorHandler.GetPayout)
		docGroup.GET("/payout-report", doctorHandler.GetPayoutReport)
		docGroup.PUT("/payout-account", doctorHandler.UpdatePayoutAccount)
		docGroup.POST("/payouts/:id/dispute", doctorHandler.DisputePayout)

		// Data privacy (doctor_data_privacy_settings).
		docGroup.POST("/privacy/export", doctorHandler.RequestPrivacyExport)
		docGroup.POST("/privacy/delete", doctorHandler.RequestPrivacyDelete)

		// Security password change request (audit-only; Supabase Auth owns credentials).
		docGroup.POST("/security/password", doctorHandler.ChangePassword)

		// Compliance + policy acknowledgement (doctor_compliance_audit / mandatory_training).
		docGroup.GET("/compliance", doctorHandler.GetCompliance)
		docGroup.POST("/compliance/policies/:policyKey/ack", doctorHandler.AckPolicy)

		// Onboarding legal + reputation + patient hubs.
		docGroup.GET("/onboarding/legal", doctorHandler.GetLegalOnboarding)
		docGroup.GET("/reputation", doctorHandler.GetReputation)
		docGroup.GET("/patients/:patientId/full-profile", doctorHandler.GetPatientFullProfile)
		docGroup.GET("/patients/:patientId/record-hub", doctorHandler.GetPatientRecordHub)

		// Misc account actions.
		docGroup.PUT("/presence", doctorHandler.SetPresence)
		docGroup.POST("/auth/logout", doctorHandler.Logout)
		docGroup.POST("/announcements/:announcementId/dismiss", doctorHandler.DismissAnnouncement)
		docGroup.POST("/support/technical", doctorHandler.CreateTechnicalSupport)
		docGroup.PUT("/schedule/emergency", doctorHandler.SetEmergencySchedule)

		// Vet profile lifecycle (doctor_vet_profiles).
		docGroup.POST("/vet/licence/renew", doctorHandler.RenewVetLicence)
		docGroup.POST("/vet/verification", doctorHandler.SubmitVetVerification)
		docGroup.POST("/vet/profile/publish", doctorHandler.PublishVetProfile)
		docGroup.PUT("/vet/profile/draft", doctorHandler.SaveVetProfileDraft)

		// ── Wave 3 (coverage close-out: 26 contract GETs) ────────────────────
		// Read-only endpoints that were specified in contracts/doctor.openapi.yaml
		// but never wired. All are scoped to the authenticated doctor. The money
		// reads (wallet/balance, earnings/*) are LEDGER-PROJECTED — they read no
		// stored balance and post no ledger entries. Static segments (disputes,
		// faqs, …) coexist with sibling :param routes (gin v1.10 static-wins),
		// exactly like /pharmacies/preferred vs /pharmacies/:pharmacyId/stock.

		// Dashboard / account / app status (derived; no new tables).
		docGroup.GET("/dashboard", doctorHandler.GetDashboard)
		docGroup.GET("/account/status", doctorHandler.GetAccountStatus)
		docGroup.GET("/account/review-notice", doctorHandler.GetReviewNotice)
		docGroup.GET("/app-status", doctorHandler.GetAppStatus)
		docGroup.GET("/announcements/latest", doctorHandler.GetLatestAnnouncement)
		docGroup.GET("/verification/decision", doctorHandler.GetVerificationDecision)

		// Money reads — wallet balance + earnings projections (ledger-projected).
		docGroup.GET("/wallet/balance", doctorHandler.GetWalletBalance)
		docGroup.GET("/earnings/breakdown", doctorHandler.GetEarningsBreakdown)
		docGroup.GET("/earnings/commission", doctorHandler.GetCommissionBreakdown)
		docGroup.GET("/earnings/tax-vat", doctorHandler.GetTaxVatReport)
		docGroup.GET("/invoices", doctorHandler.ListInvoices)
		docGroup.GET("/payouts/disputes", doctorHandler.ListSettlementDisputes)

		// Schedule + quality analytics (composed from existing sub-reads).
		docGroup.GET("/schedule", doctorHandler.GetScheduleSettings)
		docGroup.GET("/analytics/quality", doctorHandler.GetQualityAnalytics)

		// Calls + emergency reads.
		docGroup.GET("/calls/disputes", doctorHandler.ListCallDisputes)
		docGroup.GET("/emergency/cases", doctorHandler.ListEmergencyCases)
		docGroup.GET("/emergency/escalations", doctorHandler.ListEmergencyEscalations)
		docGroup.GET("/emergency/facilities", doctorHandler.ListEmergencyFacilities)
		docGroup.GET("/red-flag-alerts", doctorHandler.ListRedFlagAlerts)

		// Support content + onboarding slides (static catalogues).
		docGroup.GET("/support/faqs", doctorHandler.GetSupportFAQs)
		docGroup.GET("/support/help-articles", doctorHandler.GetHelpArticles)
		docGroup.GET("/onboarding/slides", doctorHandler.GetOnboardingSlides)

		// Vet reads.
		docGroup.GET("/vet/licence", doctorHandler.GetVetLicence)
		docGroup.GET("/vet/verification", doctorHandler.GetVetVerification)
		docGroup.GET("/vet/profile/draft", doctorHandler.GetVetProfileDraft)
		docGroup.GET("/vet/profile/documents", doctorHandler.ListVetProfileDocuments)

		// Assisted (Mode-B) MDCN verification review console — augments the existing
		// doctor_verifications flow with an ops decision layer, identity cross-check,
		// access-logged signed-URL docs, idempotent capability grant, and HL-2
		// licence-expiry auto-suspend. Admin: /api/health/doctor/admin/verification/*.
		RegisterDoctorMDCNVerification(r, pool, supabase, rbac, doctorPresigner)

		log.Println("[finance] doctor module routes registered at /api/v1/doctor")
	}

	// --- Paymax Invest (stock trading) routes ---
	// Reuses platform auth + the main wallet ledger (which funds the logically
	// separate investment-cash ledger). Mock broker + market-data adapters ship
	// first; real adapters slot in behind the same interfaces later.
	// Real price-alert delivery via the notifications queue (asynq). Falls back
	// to the module's LogNotifier when Redis/asynq is unavailable.
	var investNotifier invest.Notifier
	if cfg.RedisURL != "" {
		if aClient, qerr := queue.NewClient(cfg.RedisURL); qerr == nil {
			notifSvc := notifications.NewService(aClient)
			investNotifier = invest.NotifierFunc(func(ctx context.Context, userID, symbol, message string) error {
				return notifSvc.Send(ctx, notifications.Notification{
					UserID:   userID,
					Event:    notifications.EventOrderStatusUpdate,
					Title:    "Price alert: " + symbol,
					Body:     message,
					Channels: []notifications.Channel{notifications.ChannelPush, notifications.ChannelInApp},
				})
			})
		}
	}

	// Real provider adapters when configured; nil → deterministic mock.
	var investBroker invest.BrokerAdapter
	var investMarket invest.MarketDataAdapter
	if cfg.InvestMarketDataBaseURL != "" {
		investMarket = invest.NewHTTPMarketData(invest.HTTPMarketDataConfig{
			BaseURL: cfg.InvestMarketDataBaseURL, APIKey: cfg.InvestMarketDataAPIKey,
		})
	}
	if cfg.InvestBrokerBaseURL != "" {
		investBroker = invest.NewHTTPBroker(invest.HTTPBrokerConfig{
			BaseURL: cfg.InvestBrokerBaseURL, APIKey: cfg.InvestBrokerAPIKey,
			WebhookSecret: cfg.InvestBrokerWebhookSecret,
		})
	}

	investSvc := invest.Register(r, invest.Deps{
		DB:           pool,
		Supabase:     supabase,
		RBAC:         rbac,
		MainLedger:   ledgerSvc,
		Redis:        redisClient,
		Notifier:     investNotifier,
		Broker:       investBroker,
		Market:       investMarket,
		PINDevBypass: cfg.FeatureInvestPINDevBypass,
		Enabled:      cfg.FeatureInvestEnabled,
	})
	// Background workers: T+N settlement processor + price-alert evaluator,
	// Redlock-guarded so only one instance runs each per tick.
	if investSvc != nil {
		invest.StartSettlementWorker(ctx, investSvc, redisClient, time.Minute)
		invest.StartAlertWorker(ctx, investSvc, redisClient, 2*time.Minute)
	}

	// --- Crypto buy/sell routes (mock-first price feed; reuses finance ledger) ---
	// Mounted under /api/v1/crypto + /api/v1/admin/crypto so the frontend-web
	// proxy (app/api/v1/crypto/[...path]) resolves. Gated by FEATURE_CRYPTO_ENABLED.
	if cfg.FeatureCryptoEnabled {
		cryptoV1 := r.Group("/api/v1")
		cryptoMember := cryptoV1.Group("/crypto")
		cryptoMember.Use(mapsAuth())
		cryptoAdmin := cryptoV1.Group("/admin/crypto")
		cryptoAdmin.Use(mapsAuth())
		// Real price + on-chain withdrawal provider (Quidax) selectable via CRYPTO_PROVIDER,
		// with separate TEST/LIVE credential sets — TEST in dev/staging, LIVE in production
		// (IsProd). Falls back to the deterministic mock when unset/creds missing.
		cryptoPrice, cryptoWithdraw, cryptoMode := crypto.ProvidersFromConfig(crypto.ProviderConfig{
			Provider:    cfg.CryptoProvider,
			Live:        cfg.IsProd(),
			TestKey:     cfg.CryptoQuidaxTestKey,
			TestBaseURL: cfg.CryptoQuidaxTestBaseURL,
			LiveKey:     cfg.CryptoQuidaxLiveKey,
			LiveBaseURL: cfg.CryptoQuidaxLiveBaseURL,
		})
		log.Printf("[crypto] price/withdrawal provider mode: %s", cryptoMode)
		crypto.Register(cryptoMember, cryptoAdmin, pool, rbac, ledgerSvc, cryptoPrice, cryptoWithdraw)
	} else {
		log.Println("[crypto] FEATURE_CRYPTO_ENABLED is false — skipping routes")
	}

	// ── Custodial AI-trading module (internal/trading) — DEFAULT OFF ────────────
	// PAPER/accounting only: Module-KYC (the access gate) + unitized-NAV fund
	// wallet, cash strictly through the finance ledger. No venue execution, no
	// withdrawal keys. Live trading of real funds stays gated behind the §12
	// validation ladder + legal sign-off — this flag only exposes the accounting
	// surface. The Module-KYC service is wired in as the wallet's access gate.
	if cfg.FeatureTradingEnabled {
		tradingV1 := r.Group("/api/v1")
		tradingMember := tradingV1.Group("/trading")
		tradingMember.Use(mapsAuth())
		tradingAdmin := tradingV1.Group("/admin/trading")
		tradingAdmin.Use(mapsAuth())
		trading.Register(tradingMember, tradingAdmin, pool, rbac, ledgerSvc, int64(cfg.TradingFeeBps), int64(cfg.TradingHurdleBps), cfg.FeatureAITradingEnabled)
		if cfg.FeatureAITradingEnabled {
			log.Printf("[trading] registered (paper mode; fee %d bps, hurdle %d bps) + AI decision surface (evaluate + §12 promotion ladder) — no venue execution", cfg.TradingFeeBps, cfg.TradingHurdleBps)
		} else {
			log.Printf("[trading] registered (paper mode; fee %d bps, hurdle %d bps) — FEATURE_AI_TRADING_ENABLED off, decision/promotion routes dark", cfg.TradingFeeBps, cfg.TradingHurdleBps)
		}
	} else {
		log.Println("[trading] FEATURE_TRADING_ENABLED is false — skipping routes")
	}

	// --- Business registry (CAC business-name verification + registration) ---
	// Member routes hang off the finance group (RequireAuthContext + requireUserID);
	// the fee is charged through the finance ledger via the shared wallet service.
	// The CAC provider is the sandbox adapter unless CAC_VAS_* creds are supplied.
	// The returned service is injected as the onboarding merchant-upgrade gate:
	// merchant types flagged requires_business demand a verified/registered CAC
	// business before a user can submit or be approved for that merchant role.
	if cfg.FeatureBusinessRegistryEnabled && pool != nil {
		cacProvider := cac.New(cac.Config{
			BaseURL:        cfg.CACVASBaseURL,
			APIKey:         cfg.CACVASApiKey,
			ConsumerSecret: cfg.CACVASConsumerSecret,
		})
		businessAdmin := r.Group("/api/business/admin")
		businessAdmin.Use(middleware.RequireAuthContext(supabase, rbac))
		businessAdmin.Use(requireUserID())
		businessSvc := business.Register(finance, businessAdmin, business.RouteDeps{
			Pool:     pool,
			Ledger:   ledgerSvc,
			Wallet:   walletSvc,
			Provider: cacProvider,
			Payment:  paymentProvider,
			RBAC:     rbac,
		})
		// Wire the merchant-upgrade gate: onboarding will require a verified CAC
		// business for any merchant type flagged requires_business. Both nil-safe.
		if merchantOnboardingSvc != nil && businessSvc != nil {
			merchantOnboardingSvc.SetBusinessGate(businessSvc)
			log.Println("[business] onboarding merchant-upgrade gate wired (requires_business)")
		}
		log.Println("[business] registry routes registered (CAC verification + registration)")
	} else {
		log.Println("[business] FEATURE_BUSINESS_REGISTRY_ENABLED is false — skipping routes")
	}

	// --- Realtor admin control plane (moderation, verification, payments, escrow) ---
	realtor.Register(r, realtor.Deps{
		DB:       pool,
		Supabase: supabase,
		RBAC:     rbac,
		Enabled:  cfg.FeatureRealtorEnabled,
	})

	// --- Fractional Real Estate / Land crowd-investing routes ---
	// Reuses the shared finance primitives (ledger, settlement, kyc, tiers, rbac,
	// r2). Mock asset provider ships first (no external broker required to run).
	// Money paths: subscribe (escrow), maker-checker round close (allocate/refund),
	// maker-checker distributions (ledger credit), NAV-anchored secondary market.
	{
		freSettlement := settlement.NewService(pool, ledgerSvc)
		var frePresigner fractionalre.Presigner
		if cfg.R2AccountEndpoint != "" {
			frePresigner = r2.New(r2.Config{
				AccountEndpoint: cfg.R2AccountEndpoint,
				Bucket:          cfg.R2Bucket,
				AccessKeyID:     cfg.R2AccessKeyID,
				SecretAccessKey: cfg.R2SecretAccessKey,
				Region:          cfg.R2Region,
			})
		}
		var freNotifier fractionalre.Notifier
		if cfg.RedisURL != "" {
			if aClient, qerr := queue.NewClient(cfg.RedisURL); qerr == nil {
				notifSvcFRE := notifications.NewService(aClient)
				freNotifier = fractionalre.NotifierFunc(func(ctx context.Context, userID, title, body string) error {
					return notifSvcFRE.Send(ctx, notifications.Notification{
						UserID:   userID,
						Event:    notifications.EventOrderStatusUpdate,
						Title:    title,
						Body:     body,
						Channels: []notifications.Channel{notifications.ChannelPush, notifications.ChannelInApp},
					})
				})
			}
		}
		// Referral surface is a thin proxy over the platform engine — only wired
		// when the platform referrals feature is on (else {enabled:false}).
		var freReferrals fractionalre.ReferralSource
		if cfg.FeatureReferralsEnabled {
			freReferrals = referralSvc
		}
		freSvc := fractionalre.Register(r, fractionalre.Deps{
			DB:         pool,
			Supabase:   supabase,
			RBAC:       rbac,
			Ledger:     ledgerSvc,
			Settlement: freSettlement,
			KYC:        kycSvc,
			Tiers:      tiersSvc,
			Notifier:   freNotifier,
			Presigner:  frePresigner,
			Referrals:  freReferrals,
			Enabled:    cfg.FeatureFractionalREEnabled,
		})
		// Auto-invest execution: hourly background ticker (house pattern —
		// StartTreasuryMonitor / symptomsearch.StartRetentionPurge). Runs due
		// plans through the Subscribe money path with deterministic idempotency
		// keys; nil svc (flag off / no pool) → no-op.
		if freSvc != nil {
			fractionalre.StartAutoInvestRunner(ctx, freSvc, time.Hour)
		}
	}

	// --- MapService proxy routes (service built earlier, shared with transport) ---
	// One interface, pluggable adapters, config-driven {primitive -> provider}.
	// All provider keys are server-side here; the client calls /api/finance/maps,
	// never a provider. PostGIS powers near-me + geofencing (no maps API).
	if mapSvc != nil {
		maps.Mount(r, mapSvc, mapsAuth(), maps.PerUserRateLimit(redisClient, cfg.MapsRateLimitPerMin))
	}

	log.Printf("[finance] routes registered — wallet=%v kyc=%v va=%v referrals=%v fx=%v transfers=%v walletXfer=%v bankXfer=%v groups=%v events=%v estate=%v",
		cfg.FeatureWalletEnabled, cfg.FeatureKYCEnabled, cfg.FeatureVirtualAccountsEnabled,
		cfg.FeatureReferralsEnabled, cfg.FeatureFXEnabled, cfg.FeatureTransfersEnabled,
		cfg.FeatureWalletTransfersEnabled, cfg.FeatureBankTransfersEnabled,
		cfg.FeatureGroupsEnabled, cfg.FeatureEventsEnabled, cfg.FeatureEstateEnabled)

	// Hand the Direct Referral Rewards engine service back to router.go so it can be
	// threaded into revenue modules wired outside this function (Marketplace). Nil
	// when the engine is flag-off / pool-less — the receiving setter is nil-safe.
	return rewardSvc
}

// Mobility (transport) admin RBAC permission slugs. These gate the admin-facing
// transport routes server-side (in addition to the existing requireUserID +
// RequireAdmin gates). Reads use mobilityViewPerm; mutations use the area- or
// mode-specific .manage slug. The slugs are seeded and granted to super-admin by
// supabase/migrations/20260621090000_mobility_rbac.sql — keep these strings in
// exact sync with that migration.
const (
	mobilityViewPerm            = "mobility.view"             // read-only admin GETs
	mobilityManagePerm          = "mobility.manage"           // general/cross-cutting admin mutations
	mobilityRideManagePerm      = "mobility.ride.manage"      // drivers / vehicles / dispatch
	mobilityParcelManagePerm    = "mobility.parcel.manage"    // parcel delivery
	mobilityBusManagePerm       = "mobility.bus.manage"       // bus routes / schedules / fares
	mobilityTowingManagePerm    = "mobility.towing.manage"    // towing
	mobilityMoversManagePerm    = "mobility.movers.manage"    // movers
	mobilityEventManagePerm     = "mobility.event.manage"     // event transport
	mobilityLogisticsManagePerm = "mobility.logistics.manage" // business logistics

	// Transport Trip Scheduling ops-board perms (seeded by
	// 20260906000001_transport_scheduled_rbac.sql — keep in exact sync).
	schedReadPerm     = "transport.admin.scheduled.read"     // read-only ops board
	schedReassignPerm = "transport.admin.scheduled.reassign" // force-dispatch / reassign
	schedCancelPerm   = "transport.admin.scheduled.cancel"   // admin cancel + refund
)

// kycTierElevator adapts *kyc.Service to the kycverify.TierElevator port so the
// KYC verification gateway can elevate a user's tier through the KYC core
// (UPDATE user_profiles.kyc_tier/kyc_status + kyc_events audit) without importing
// the kyc package's concrete Profile return type into kycverify.
type kycTierElevator struct{ svc *kyc.Service }

func (e kycTierElevator) ElevateTier(ctx context.Context, userID string, newTier int, actorID *string) error {
	if e.svc == nil {
		return nil
	}
	_, err := e.svc.Approve(ctx, userID, newTier, actorID)
	return err
}

// requireUserID is a middleware that rejects requests without a user_id in context.
// In the full auth middleware (RequireAuthContext), user_id is set from the JWT.
// This guard ensures financial routes are never reached unauthenticated.
func requireUserID() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString("user_id") == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
			return
		}
		c.Next()
	}
}
