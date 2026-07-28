package app

import (
	"log"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	connectgamification "spotlight/backend/internal/connect/gamification"
	connectlive "spotlight/backend/internal/connect/live"
	connectsafety "spotlight/backend/internal/connect/safety"
	"spotlight/backend/internal/services"
)

// RegisterConnectLiveGame wires the Paymax Connect live-streaming and gamification
// modules onto the member + admin route groups created by the Connect orchestrator
// (connect_routes.go, not edited here). Both groups already carry
// RequireAuthContext + the c.Set("user_id", ...) mirror; the parent enforces the
// FeatureConnectEnabled gate. Admin routes add per-route RBAC inside each package
// (connect.live.* / connect.gamification.*).
//
//   - Live: 1:many sessions, co-host, PK battles (non-cash scores), moderation and
//     RTC-token issuance. Provider secrets are read from env/config HERE and passed
//     into the package — never hard-coded inside the package.
//   - Gamification: XP / missions / streaks / leaderboards / seasons. NON-CASH:
//     points live in their own tables and NEVER touch the finance ledger.
func RegisterConnectLiveGame(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		log.Println("[connect-live-game] nil pool — skipping Connect live/gamification routes")
		return
	}

	// Shared audit hook (reuses the Phase 0 connect_audit_log writer via the
	// auditAdapter defined in connect_growth_routes.go — same package).
	safetySvc := connectsafety.NewService(pool)
	audit := &auditAdapter{svc: safetySvc}

	// RTC provider config — secrets come from env, never hard-coded. When the
	// secret is unset, NewRTCIssuer returns nil and token issuance refuses
	// fail-closed (HTTP 503) rather than minting an unsigned credential.
	ttl := time.Hour
	if v := os.Getenv("CONNECT_RTC_TOKEN_TTL_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			ttl = time.Duration(n) * time.Second
		}
	}
	rtc := connectlive.NewRTCIssuer(connectlive.RTCConfig{
		Provider:  os.Getenv("CONNECT_RTC_PROVIDER"),
		AppID:     os.Getenv("CONNECT_RTC_APP_ID"),
		AppSecret: os.Getenv("CONNECT_RTC_APP_SECRET"),
		TokenTTL:  ttl,
	})
	if rtc == nil {
		log.Println("[connect-live-game] CONNECT_RTC_APP_SECRET unset — RTC token issuance disabled (fail-closed)")
	}

	connectlive.Register(member, admin, pool, rbac, audit, rtc)
	connectgamification.Register(member, admin, pool, rbac, audit)

	log.Println("[connect-live-game] routes registered — live streaming + gamification live")
}
