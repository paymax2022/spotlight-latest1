package app

import (
	"context"
	"log"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	connectcredits "spotlight/backend/internal/connect/credits"
	connectdiscovery "spotlight/backend/internal/connect/discovery"
	connectmatching "spotlight/backend/internal/connect/matching"
	connectprofile "spotlight/backend/internal/connect/profile"
	connectsafety "spotlight/backend/internal/connect/safety"
	connectverification "spotlight/backend/internal/connect/verification"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Discovery RBAC permission slugs. Seeded by the connect discovery migration
// (see connect_boosts migration + rbac_permissions seed). Enforced per-route in
// ADDITION to the inherited member auth. If unseeded, RequirePermission fails
// closed (403) — deliberately: the gate must be seeded before go-live.
const (
	permDiscoveryAccess = "connect.discovery.access"
	permBoostPurchase   = "connect.boost.purchase"
)

// registerConnectPhase1Routes wires the Paymax Connect Phase-1 core slice
// (profiles + per-mode visibility, L0–L1 selfie/liveness verification + badge,
// curated daily discovery with match-reason cards, idempotent likes/super-likes
// with mutual-only matches, and privacy-preserving search) onto the already
// auth-gated member/admin groups created by registerConnectRoutes.
//
// The orchestrator (connect_routes.go) calls this with the shared member group
// (RequireAuthContext + user_id mirror already applied), the admin group, the pgx
// pool, and the RBAC service. All routes inherit the FeatureConnectEnabled gate
// from the parent group; admin routes add per-route RBAC permission checks.
//
// Tunables (daily/anti-fatigue limits, ranking weights, distance buckets, badge
// min level) are read from the backend-owned connect_config table — never
// hard-coded and never new env config.
func registerConnectPhase1Routes(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	// Verification provider (Phase 1 stub — no real SDK, no network). The pepper is
	// the existing CONNECT_VERIFICATION_PEPPER env (read here so we neither edit
	// config.go nor depend on it being threaded through the signature). If unset,
	// verification endpoints are skipped fail-closed rather than hashing with no key.
	var verifSvc *connectverification.StatusService
	if pepper := os.Getenv("CONNECT_VERIFICATION_PEPPER"); pepper != "" {
		hasher, err := connectverification.NewHasher(pepper)
		if err != nil {
			log.Printf("[connect:phase1] verification disabled: %v", err)
		} else if stub, err := connectverification.NewStubProvider(hasher); err != nil {
			log.Printf("[connect:phase1] verification disabled: %v", err)
		} else {
			badgeMin := connectverification.VerificationLevel(
				connectConfigString(pool, "verification.badge_min_level", "l1"))
			verifSvc = connectverification.NewStatusService(pool, stub, badgeMin)
		}
	} else {
		log.Println("[connect:phase1] CONNECT_VERIFICATION_PEPPER unset — verification endpoints disabled")
	}

	// Profile service surfaces the verified badge via the verification service when
	// available (nil-safe: badge defaults false otherwise).
	var badgeChecker connectprofile.BadgeChecker
	if verifSvc != nil {
		badgeChecker = verifSvc
	}
	profileSvc := connectprofile.NewService(pool, badgeChecker)
	profileHandler := connectprofile.NewHandler(profileSvc)

	matchSvc := connectmatching.NewService(pool)
	matchSvc.SetCreditConsumer(connectcredits.NewService(pool)) // PAY-003: super-like spends a credit
	matchHandler := connectmatching.NewHandler(matchSvc)

	discoverySvc := connectdiscovery.NewService(pool)
	discoveryHandler := connectdiscovery.NewHandler(discoverySvc)

	// --- Mobile-aligned member discovery surface (stack/swipe/likes-you/nearby/
	// rewind/boosts). Reuses the SAME discovery ranking + the SAME matching
	// mutual-match transaction underneath; boosts reuse the finance ledger/wallet
	// money path (identical pattern to paid voting: DR wallet, CR paymax_revenue). ---
	//
	// Money stack (REUSED from internal/finance — no hand-rolled ledger SQL):
	//   ledger.Service → wallet.Service.Debit (tier-checked, balanced double-entry,
	//   idempotent on the ledger unique idempotency_key). Redis nil: the DB unique
	//   constraint remains the durable idempotency backstop.
	discLedger := ledger.NewService(ledger.NewRepository(pool), nil)
	discTiers := tiers.NewService(pool)
	discWallet := wallet.NewService(discLedger, discTiers)
	discAudit := &connectDiscoveryAuditAdapter{svc: connectsafety.NewService(pool)}

	boostSvc := connectdiscovery.NewBoostService(
		connectdiscovery.NewBoostRepo(pool),
		discWallet, // WalletDebiter (tier-checked debit → credit account)
		&connectDiscoveryRevenueAdapter{ledger: discLedger}, // paymax_revenue resolver
		discTiers, // TierGuard (fail-closed, BEFORE the charge)
		discAudit, // immutable audit event per purchase
		nil,       // AML boost flagger wired in production
		connectdiscovery.NewConfigReader(pool),
	)

	memberDiscovery := connectdiscovery.NewMemberHandler(
		discoverySvc,
		&connectLikeRecorderAdapter{svc: matchSvc}, // reuse the mutual-match tx
		boostSvc,
	)

	// --- Member routes (FeatureConnectEnabled + RequireAuthContext inherited) ---
	member.GET("/profile", profileHandler.Get)
	member.PATCH("/profile", profileHandler.Update)
	member.GET("/profile/modes", profileHandler.GetModes)
	member.PATCH("/profile/modes/:mode", profileHandler.UpsertMode)
	member.POST("/profile/media", profileHandler.AddMedia)

	if verifSvc != nil {
		verifHandler := connectverification.NewHandler(verifSvc)
		member.POST("/verification/selfie", verifHandler.Selfie)
		member.GET("/verification/status", verifHandler.Status)
	}

	member.GET("/discovery", discoveryHandler.Discovery)
	member.POST("/likes", matchHandler.Like)
	member.GET("/matches", matchHandler.ListMatches)
	member.GET("/search", discoveryHandler.Search)

	// --- Mobile-aligned member discovery routes (RBAC: connect.discovery.access on
	// every route, IN ADDITION to the inherited member auth; the boost POST adds
	// connect.boost.purchase). ---
	discoveryGate := middleware.RequirePermission(rbac, permDiscoveryAccess)
	member.GET("/discovery/stack", discoveryGate, memberDiscovery.Stack)
	member.POST("/discovery/swipe", discoveryGate, memberDiscovery.Swipe)
	member.GET("/discovery/likes-you", discoveryGate, memberDiscovery.LikesYou)
	member.GET("/discovery/nearby", discoveryGate, memberDiscovery.Nearby)
	member.POST("/discovery/rewind", discoveryGate, memberDiscovery.Rewind) // premium action
	member.GET("/discovery/boosts", discoveryGate, memberDiscovery.BoostInfo)
	member.POST("/discovery/boosts",
		discoveryGate,
		middleware.RequirePermission(rbac, permBoostPurchase),
		memberDiscovery.BuyBoost) // MONEY PATH — Idempotency-Key required

	// --- Admin routes (per-route RBAC) ---
	// Verification review read (admin reads its own session status here as a stub;
	// the full admin queue with user_id param lands in the admin sub-package).
	if verifSvc != nil {
		verifHandler := connectverification.NewHandler(verifSvc)
		admin.GET("/verification/status",
			middleware.RequirePermission(rbac, "connect.verification.view"),
			verifHandler.Status)
	}

	log.Println("[connect:phase1] routes registered — profile/modes/media, verification, discovery, likes, matches, search, discovery stack/swipe/likes-you/nearby/rewind/boosts")
}

// connectLikeRecorderAdapter adapts connectmatching.Service.Like (which returns
// *connectmatching.LikeResult) to the discovery LikeRecorder seam. Swipe delegates
// like/superlike through here so the idempotent mutual-match transaction stays in
// ONE place (the matching package) and is never re-implemented in discovery.
type connectLikeRecorderAdapter struct{ svc *connectmatching.Service }

func (a *connectLikeRecorderAdapter) Like(ctx context.Context, fromUserID, toProfileID, kind string) (connectdiscovery.SwipeResult, error) {
	res, err := a.svc.Like(ctx, fromUserID, toProfileID, kind)
	if err != nil {
		return connectdiscovery.SwipeResult{}, err
	}
	return connectdiscovery.SwipeResult{Matched: res.Matched, MatchID: res.MatchID}, nil
}

// connectDiscoveryRevenueAdapter resolves the standing paymax_revenue ledger
// account that boost purchases credit (same account paid-vote revenue credits).
type connectDiscoveryRevenueAdapter struct{ ledger *ledger.Service }

func (r *connectDiscoveryRevenueAdapter) RevenueAccountID(ctx context.Context) (string, error) {
	acc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// connectDiscoveryAuditAdapter bridges the discovery BoostAuditor interface to the
// Phase 0 connect_audit_log writer (connect/safety.Service.WriteAudit) — the same
// immutable audit trail the money path uses elsewhere.
type connectDiscoveryAuditAdapter struct{ svc *connectsafety.Service }

func (a *connectDiscoveryAuditAdapter) WriteAudit(ctx context.Context, action, actorID, entityType, entityID string, newValue map[string]any) error {
	return a.svc.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    actorID,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		NewValue:   newValue,
	})
}

// connectConfigString reads a string-valued connect_config key (JSON string) with
// a fallback, so verification badge level stays backend-owned. Best-effort: any
// error returns the default.
func connectConfigString(pool *pgxpool.Pool, key, def string) string {
	var raw []byte
	if err := pool.QueryRow(context.Background(),
		`SELECT value FROM connect_config WHERE key = $1`, key).Scan(&raw); err != nil {
		return def
	}
	s := string(raw)
	// Stored as a JSON string e.g. "l1" — strip the surrounding quotes if present.
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return def
}
