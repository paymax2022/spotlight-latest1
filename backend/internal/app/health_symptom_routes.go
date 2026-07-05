package app

import (
	"context"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"
	"spotlight/backend/internal/health/symptomsearch"
	"spotlight/backend/internal/middleware"
	platformRedis "spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/services"
)

// RegisterHealthSymptomSearch wires the Pharmacy Symptom-Based Medication
// Search addon (docs/health/Pharmacy_Symptom_Search_Addon_PRD.md) alongside
// the existing pharmacy vertical. It is the ONLY wiring point for the addon
// and edits no existing pharmacy file (brownfield rule).
//
// Feature gating (orchestrator, finance_routes.go): FeatureHealthEnabled AND
// FeatureHealthPharmacyEnabled AND FeaturePharmacySymptomSearchEnabled
// (FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED, default off).
//
// Routes:
//
//	member (finance auth chain, /api/finance/health/pharmacy):
//	  POST /api/finance/health/pharmacy/symptom-search      — rate-limited per user+device
//	  GET  /api/finance/health/pharmacy/classes/:id/skus    — live OTC/PHARMACY_ONLY SKUs
//	admin  (/api/health/pharmacy/admin, per-route RBAC health.pharmacy.symptom.*):
//	  GET  /api/health/pharmacy/admin/symptom/mappings              — taxonomy read (?entity=term|cluster, all statuses)
//	  POST /api/health/pharmacy/admin/symptom/mappings              — taxonomy suggest-approve CRUD
//	  GET  /api/health/pharmacy/admin/symptom/reviews               — SLA-sorted pharmacist queue
//	  GET  /api/health/pharmacy/admin/symptom/reviews/:id           — case drawer (case + cart lines + history)
//	  POST /api/health/pharmacy/admin/symptom/reviews/:id/decision  — guarded decision (APPROVE/REJECT/NEEDS_INFO)
//	  GET  /api/health/pharmacy/admin/symptom/metrics               — safety KPIs (PRD §9)
//
// Rate limiting: Redis-backed fixed window when rdb is non-nil (limit holds
// across instances — same pattern as maps.PerUserRateLimit), in-memory
// per-instance fallback otherwise.
//
// NDPR retention (PRD §5.4): a daily background loop (house pattern —
// background tickers, e.g. orchestration.StartReconScheduler; the repo has no
// pg_cron and no asynq periodic scheduler) invokes the SECURITY DEFINER
// function pharmacy_symptom_events_purge, deleting symptom_search_events
// older than SYMPTOM_EVENTS_RETENTION_DAYS (default 180).
//
// ── ORDER-FLOW INTEGRATION (review-case creation) ─────────────────────────────
// The pharmacy order flow calls the idempotent seam at order submission via
// its optional ReviewCaseOpener collaborator (wired via WireSymptomOrderSeams
// in finance_routes.go when both flags are on; nil ⇒ no-op):
//
//	symptomsearch.Service.CreateReviewCaseForOrderFromContext(ctx, actorID,
//	    orderID, pharmacyProviderID, searchEventID, rxRequired)
//
// The tier is resolved SERVER-SIDE from the linked symptom_search_events row
// (unknown/dangling context fails closed to T2); any rx_required line without
// search context still opens a PHARMACIST_REVIEW case (POM gate regardless of
// entry path). One case per order (UNIQUE order_id); T1 auto-clears; every
// transition writes a pharmacy_review_case_events row in the same transaction.
// NEEDS_INFO → PHARMACIST_REVIEW resumes via Service.ResumeReviewCase.
//
// Returns the symptom-search service for that wiring; nil when skipped.
func RegisterHealthSymptomSearch(ctx context.Context, member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rdb *platformRedis.Client, rbac services.RBACService) *symptomsearch.Service {
	if pool == nil {
		log.Println("[health.pharmacy.symptom] nil pool — skipping symptom-search routes")
		return nil
	}

	repo := symptomsearch.NewPgxRepo(pool)
	svc := symptomsearch.NewService(repo, nil) // audit sink injected by orchestrator (HL-12) — nil-safe here

	// Superintendent override for object-level review authz: holders of the
	// mappings permission (SUPERINTENDENT-grade console access) may decide
	// cases across premises tenants; plain pharmacists are tenant-scoped.
	isSuperintendent := func(c *gin.Context) bool {
		if rbac == nil {
			return false
		}
		uid := c.GetString("user_id")
		if uid == "" {
			return false
		}
		ok, err := rbac.CheckPermission(uid, "health.pharmacy.symptom.mappings", "global", "")
		return err == nil && ok
	}
	h := symptomsearch.NewHandler(svc, isSuperintendent)

	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}

	// --- Member routes (/api/finance/health/pharmacy) ---
	// Per-user+device rate limit blunts scraping of the mapping IP (PRD §7) and
	// caps query volume on sensitive health data (NDPR). Redis-backed when
	// available so the window holds across instances.
	g := member.Group("/health/pharmacy")
	g.POST("/symptom-search", symptomsearch.PerUserDeviceRateLimit(rdb, 20, time.Minute), h.SymptomSearch)
	g.GET("/classes/:id/skus", h.ListClassSkus)

	// --- Admin routes (/api/health/pharmacy/admin/symptom, RBAC-gated) ---
	ag := admin.Group("/symptom")
	ag.GET("/mappings", guard("health.pharmacy.symptom.mappings"), h.AdminListMappings)
	ag.POST("/mappings", guard("health.pharmacy.symptom.mappings"), h.AdminUpsertMapping)
	ag.GET("/reviews", guard("health.pharmacy.symptom.reviews"), h.AdminListReviews)
	ag.GET("/reviews/:id", guard("health.pharmacy.symptom.reviews"), h.AdminGetReview)
	ag.POST("/reviews/:id/decision", guard("health.pharmacy.symptom.reviews"), h.AdminDecideReview)
	ag.GET("/metrics", guard("health.pharmacy.symptom.reviews"), h.AdminSymptomMetrics)

	// NDPR retention loop (PRD §5.4) — daily purge of symptom_search_events
	// older than the retention window via the service-role SQL function.
	symptomsearch.StartRetentionPurge(ctx, pool, envInt("SYMPTOM_EVENTS_RETENTION_DAYS", symptomsearch.DefaultSearchEventRetentionDays), 24*time.Hour)

	log.Println("[health.pharmacy.symptom] symptom-search routes registered — resolve/skus + admin mappings/reviews/metrics; retention loop started")
	return svc
}

// WireSymptomOrderSeams hands the symptom addon's order-time collaborators to
// the pharmacy order flow (both optional and nil-safe on the pharmacy side —
// flag off ⇒ never called ⇒ CreateOrder behavior byte-for-byte unchanged):
//
//   - ReviewCaseOpener: opens the gated review case after a successful order
//     (best-effort, idempotent per order, PRD §10);
//   - QuantityGate: BLOCKING per-SKU rolling-window quantity cap, enforced
//     before the escrow hold (fail-closed 422 QTY_CAP_EXCEEDED, PRD §5.5).
func WireSymptomOrderSeams(pharmacySvc *healthpharmacy.Service, symptomSvc *symptomsearch.Service, pool *pgxpool.Pool) {
	if pharmacySvc == nil || symptomSvc == nil || pool == nil {
		return
	}
	pharmacySvc.SetReviewCaseOpener(symptomReviewOpener{svc: symptomSvc})
	pharmacySvc.SetQuantityGate(healthpharmacy.NewPgxQuantityGate(pool))
}

// symptomReviewOpener adapts symptomsearch.Service to healthpharmacy's
// optional ReviewCaseOpener seam (PRD §10). It is wired ONLY when both the
// pharmacy and symptom-search flags are on — a nil opener in the pharmacy
// service is a no-op, so flag-off behavior is byte-for-byte unchanged.
type symptomReviewOpener struct{ svc *symptomsearch.Service }

func (a symptomReviewOpener) OpenReviewCaseForOrder(ctx context.Context, actorID, orderID, pharmacyProviderID string, searchEventID *string, rxRequired bool) error {
	_, err := a.svc.CreateReviewCaseForOrderFromContext(ctx, actorID, orderID, pharmacyProviderID, searchEventID, rxRequired)
	return err
}

// envInt reads a positive integer env var with a default (mirrors config's
// getEnvInt without importing it — config is the process-level loader).
func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return def
	}
	return n
}
