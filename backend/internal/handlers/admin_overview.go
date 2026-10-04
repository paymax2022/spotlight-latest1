package handlers

// The admin overview: one call that answers "what needs me today?" across every
// module, instead of a dashboard that counts contestants.
// WHY THIS IS NOT A LOOP OVER A TEMPLATE. Each module spells its queue
// differently, and the differences are invisible until a filter silently matches
// nothing. Verified against the live CHECK constraints:
//	cf_withdrawals            'PENDING'                   (upper)
//	restaurant_withdrawals    'pending'                   (lower)
//	stays_property            'PENDING_REVIEW'            (upper)
//	stays_hotelier_kyb        'submitted'                 (lower)
//	referral_payouts          'queued'                    (not "pending" at all)
//	crypto_withdrawals        'requested','pending_review'
//	insurance_claim           'FNOL_SUBMITTED','UNDER_ASSESSMENT'
//	creator_payouts           'REQUESTED'                 (column is `state`)
//	escrow_disputes           'OPEN'   vs  disputes 'open'
// A generic WHERE status='pending' would report ZERO outstanding work for
// crowdfunding, stays, referrals, crypto, insurance and creators — a dashboard
// confidently showing an all-clear while the queues fill. Every predicate below
// is written per module and taken from that module's own constraint.
// UNKNOWN IS NOT ZERO. A query that fails (table absent on a partially migrated
// environment, permission denied, timeout) yields a nil value, which the console
// renders as "—". It must never render as 0: "nothing to do" and "we could not
// look" are opposite messages, and collapsing them is how an operations console
// starts lying.

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/platform/buildinfo"
	"spotlight/backend/internal/services"
)

// queryTimeout caps EACH count independently. The whole endpoint is only as slow
// as its slowest query because they run concurrently, and one wedged table can
// never hold the dashboard hostage.
const overviewQueryTimeout = 4 * time.Second

// overviewConcurrency bounds simultaneous queries so a dashboard refresh cannot
// exhaust the shared pool that the money path also uses.
const overviewConcurrency = 8

type moduleSpec struct {
	Key      string
	Label    string
	Group    string
	Href     string
	Volume   string // human label for the headline number
	VolSQL   string
	Attn     string // human label for the work queue
	AttnSQL  string
	AttnHref string
	Severity string // "critical" (money/compliance) | "warn" (content/ops)
}

// specs is the registry. Adding a module means adding one row — and verifying
// its predicate against that module's CHECK constraint, not assuming.
var overviewSpecs = []moduleSpec{
	{"marketplace", "Marketplace", "Commerce", "/admin/marketplace",
		"Live listings", `SELECT count(*) FROM public.mkt_listings WHERE status='active'`,
		"Awaiting moderation", `SELECT count(*) FROM public.mkt_listings WHERE status='pending_review'`,
		"/admin/marketplace?status=pending_review", "warn"},
	{"mkt-disputes", "Marketplace disputes", "Commerce", "/admin/marketplace/disputes",
		"Open cases", `SELECT count(*) FROM public.mkt_disputes WHERE status IN ('opened','evidence_window','under_review')`,
		"Needs a decision", `SELECT count(*) FROM public.mkt_disputes WHERE status='under_review'`,
		"/admin/marketplace/disputes?status=under_review", "critical"},
	{"restaurant", "Restaurant", "Commerce", "/admin/restaurant",
		"Withdrawals paid", `SELECT count(*) FROM public.restaurant_withdrawals WHERE status='paid'`,
		"Withdrawals pending", `SELECT count(*) FROM public.restaurant_withdrawals WHERE status='pending'`,
		"/admin/restaurant/withdrawals?status=pending", "critical"},
	{"crowdfunding", "Crowdfunding", "Money", "/admin/crowdfunding",
		"Disputes open", `SELECT count(*) FROM public.cf_disputes WHERE status IN ('OPEN','INVESTIGATING','ESCALATED')`,
		"Withdrawals pending", `SELECT count(*) FROM public.cf_withdrawals WHERE status='PENDING'`,
		"/admin/crowdfunding/withdrawals", "critical"},
	{"crypto", "Crypto", "Money", "/admin/crypto",
		"Withdrawals confirmed", `SELECT count(*) FROM public.crypto_withdrawals WHERE status='confirmed'`,
		"Awaiting review", `SELECT count(*) FROM public.crypto_withdrawals WHERE status IN ('requested','pending_review')`,
		"/admin/crypto/withdrawals", "critical"},
	{"referral", "Referrals", "Money", "/admin/referral",
		"Payouts paid", `SELECT count(*) FROM public.referral_payouts WHERE status='paid'`,
		"Payouts queued", `SELECT count(*) FROM public.referral_payouts WHERE status='queued'`,
		"/admin/referral-rewards", "critical"},
	{"payouts", "Platform payouts", "Money", "/admin/payments-finance",
		"Completed", `SELECT count(*) FROM public.payouts WHERE status='completed'`,
		"Pending release", `SELECT count(*) FROM public.payouts WHERE status='pending'`,
		"/admin/payments-finance", "critical"},
	{"creators", "Creators", "Community", "/admin/creators",
		"Payouts paid", `SELECT count(*) FROM public.creator_payouts WHERE state='PAID'`,
		"Payout requests", `SELECT count(*) FROM public.creator_payouts WHERE state='REQUESTED'`,
		"/admin/creators", "critical"},
	{"escrow", "Social escrow", "Money", "/admin/social-escrow",
		"Disputes resolved", `SELECT count(*) FROM public.escrow_disputes WHERE state='RESOLVED'`,
		"Disputes open", `SELECT count(*) FROM public.escrow_disputes WHERE state='OPEN'`,
		"/admin/social-escrow", "critical"},
	{"disputes", "Disputes desk", "Money", "/admin/disputes",
		"In review", `SELECT count(*) FROM public.disputes WHERE status='in_review'`,
		"Open, unassigned", `SELECT count(*) FROM public.disputes WHERE status='open'`,
		"/admin/disputes", "critical"},

	{"stays", "Stays", "Travel", "/admin/stays",
		"Active properties", `SELECT count(*) FROM public.stays_property WHERE status='ACTIVE'`,
		"Properties to review", `SELECT count(*) FROM public.stays_property WHERE status='PENDING_REVIEW'`,
		"/admin/stays/properties", "warn"},
	{"stays-kyb", "Stays hotelier KYB", "Travel", "/admin/stays",
		"Approved", `SELECT count(*) FROM public.stays_hotelier_kyb WHERE status='approved'`,
		"Submitted, awaiting KYB", `SELECT count(*) FROM public.stays_hotelier_kyb WHERE status='submitted'`,
		"/admin/stays/kyb", "critical"},
	{"health", "Health providers", "Health", "/admin/health",
		"Approved providers", `SELECT count(*) FROM public.health_provider_applications WHERE state='APPROVED'`,
		"Applications to review", `SELECT count(*) FROM public.health_provider_applications WHERE state IN ('SUBMITTED','UNDER_REVIEW')`,
		"/admin/health/providers", "warn"},
	{"telemedicine", "Telemedicine payouts", "Health", "/admin/telemedicine",
		"Paid", `SELECT count(*) FROM public.doctor_payouts WHERE status='paid'`,
		"Pending", `SELECT count(*) FROM public.doctor_payouts WHERE status='pending'`,
		"/admin/telemedicine/dashboard", "critical"},
	{"insurance", "Insurance claims", "Money", "/admin/insurance",
		"Policies live", `SELECT count(*) FROM public.insurance_policy WHERE state='ACTIVE'`,
		"Claims to assess", `SELECT count(*) FROM public.insurance_claim WHERE state IN ('FNOL_SUBMITTED','UNDER_ASSESSMENT')`,
		"/admin/insurance/claims", "critical"},
	{"registration", "Registrations", "Programs", "/admin/registration",
		"Approved", `SELECT count(*) FROM public.registrations WHERE status='approved'`,
		"Awaiting review", `SELECT count(*) FROM public.registrations WHERE status IN ('submitted','under_review')`,
		"/admin/registration?status=submitted", "warn"},
}

type overviewValue struct {
	Label string `json:"label"`
	// Value is a POINTER on purpose: nil marshals to JSON null and renders as
	// "—". Making it a plain int64 would turn every failed lookup into a
	// confident zero.
	Value *int64 `json:"value"`
}

type overviewAttention struct {
	overviewValue
	Href     string `json:"href"`
	Severity string `json:"severity"`
}

type overviewModule struct {
	Key       string            `json:"key"`
	Label     string            `json:"label"`
	Group     string            `json:"group"`
	Href      string            `json:"href"`
	Volume    overviewValue     `json:"volume"`
	Attention overviewAttention `json:"attention"`
}

// AdminOverviewHandler serves the cross-module operations overview.
type AdminOverviewHandler struct{ pool *pgxpool.Pool }

func NewAdminOverviewHandler(pool *pgxpool.Pool) *AdminOverviewHandler {
	return &AdminOverviewHandler{pool: pool}
}

// Overview runs every module's two counts concurrently and returns them all,
// degraded entries included. It returns 200 with nulls rather than 500 on a
// partial failure: an operations console that goes blank because one module's
// table is missing is worse than one that shows fifteen modules and one "—".
func (h *AdminOverviewHandler) Overview(c *gin.Context) {
	if h.pool == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false, "error": "database pool unavailable"})
		return
	}

	out := make([]overviewModule, len(overviewSpecs))
	sem := make(chan struct{}, overviewConcurrency)
	var wg sync.WaitGroup

	for i, spec := range overviewSpecs {
		wg.Add(1)
		go func(i int, s moduleSpec) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			out[i] = overviewModule{
				Key: s.Key, Label: s.Label, Group: s.Group, Href: s.Href,
				Volume: overviewValue{Label: s.Volume, Value: h.count(c.Request.Context(), s.VolSQL)},
				Attention: overviewAttention{
					overviewValue{Label: s.Attn, Value: h.count(c.Request.Context(), s.AttnSQL)},
					s.AttnHref, s.Severity,
				},
			}
		}(i, spec)
	}
	wg.Wait()

	c.JSON(http.StatusOK, gin.H{
		"success":      true,
		"generated_at": time.Now().UTC().Format(time.RFC3339),
		"modules":      out,
	})
}

// count returns nil on ANY failure — a missing table (42P01 on a partially
// migrated environment), a permission error, or a timeout. The caller renders
// nil as "unknown", never as zero.
func (h *AdminOverviewHandler) count(ctx context.Context, sql string) *int64 {
	ctx, cancel := context.WithTimeout(ctx, overviewQueryTimeout)
	defer cancel()

	var n int64
	if err := h.pool.QueryRow(ctx, sql).Scan(&n); err != nil {
		return nil
	}
	return &n
}

// Ops and admin auxiliary handlers: platform health probes, the legacy admin
// dashboard endpoints, analytics and the audit-log read surface.

type AdminHandler struct {
	service services.AdminService
}

func NewAdminHandler(service services.AdminService) *AdminHandler {
	return &AdminHandler{service: service}
}

func (h *AdminHandler) MenuCounts(c *gin.Context) {
	counts, err := h.service.GetMenuCounts()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load admin counts"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "counts": counts})
}

type AnalyticsHandler struct{ service services.AnalyticsService }

func NewAnalyticsHandler(service services.AnalyticsService) *AnalyticsHandler {
	return &AnalyticsHandler{service: service}
}

func (h *AnalyticsHandler) Summary(c *gin.Context) {
	analytics, err := h.service.GetChatAnalytics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "could not load chatbot analytics"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "analytics": analytics})
}

type AuditHandler struct{ svc services.AuditService }

func NewAuditHandler(svc services.AuditService) *AuditHandler { return &AuditHandler{svc: svc} }

func auditFilterFromQuery(c *gin.Context) domain.AuditFilter {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	return domain.AuditFilter{
		Limit:      limit,
		ActorUser:  c.Query("actorUser"),
		TargetUser: c.Query("targetUser"),
		Module:     c.Query("module"),
		Action:     c.Query("action"),
		Severity:   c.Query("severity"),
		DateFrom:   c.Query("dateFrom"),
		DateTo:     c.Query("dateTo"),
		Status:     c.Query("status"),
		Email:      c.Query("email"),
	}
}

func (h *AuditHandler) AuditLogs(c *gin.Context) {
	rows, err := h.svc.ListAuditLogs(auditFilterFromQuery(c))
	if err != nil {
		log.Printf("[audit.logs] internal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "logs": rows})
}

func (h *AuditHandler) LoginActivity(c *gin.Context) {
	rows, err := h.svc.ListLoginActivity(auditFilterFromQuery(c))
	if err != nil {
		log.Printf("[audit.login_activity] internal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "activity": rows})
}

func (h *AuditHandler) SecurityEvents(c *gin.Context) {
	rows, err := h.svc.ListSecurityEvents(auditFilterFromQuery(c))
	if err != nil {
		log.Printf("[audit.security_events] internal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "internal error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "events": rows})
}

func (h *AuditHandler) ExportAuditLogs(c *gin.Context) {
	rows, err := h.svc.ListAuditLogs(auditFilterFromQuery(c))
	if err != nil {
		log.Printf("[audit.export] internal error: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "internal error"})
		return
	}
	payload, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "error": "export failed"})
		return
	}
	c.Header("Content-Disposition", "attachment; filename=audit-logs.json")
	c.Data(http.StatusOK, "application/json", payload)
}

type HealthHandler struct {
	pool *pgxpool.Pool

	// Redis component for /readyz (E2E-FR-050). redisRequired comes from
	// REDIS_REQUIRED: Redis is a latency optimization with DB-unique fallbacks,
	// so by default a Redis outage reports "degraded" and the probe stays 200;
	// only when the operator marks Redis required does a ping failure 503.
	redis         *goredis.Client
	redisRequired bool

	// Probe hooks — nil means "ping the real client". Overridable in tests so
	// the up/down/degraded matrix can run without live infra.
	pingDB    func(ctx context.Context) error
	pingRedis func(ctx context.Context) error

	// Readiness verdict is probed at most once per readyProbeInterval and
	// cached between probes — otherwise every LB/uptime/k8s probe issues its
	// own pool.Ping, which under a saturated pool queues, times out, and flaps
	// the pod exactly when load is highest. The same window covers the Redis
	// ping — one probe per component, never more.
	mu          sync.Mutex
	lastReady   bool
	lastReason  string
	lastDB      string
	lastRedis   string
	lastProbeAt time.Time
}

const readyProbeInterval = 2 * time.Second

// Readiness component verdicts, emitted under "components" in the payload.
const (
	componentUp            = "up"
	componentDown          = "down"
	componentDegraded      = "degraded"       // down, but not a required component
	componentNotConfigured = "not_configured" // client never wired — nothing to ping

	keyReadyStatus     = "status"
	keyReadyReason     = "reason"
	keyReadyComponents = "components"
)

func NewHealthHandler() *HealthHandler { return &HealthHandler{} }

// WithPool supplies the shared DB pool for the readiness probe. The pool is
// created late in router construction, after /healthz-worthy liveness routes
// are registered, so it arrives via a setter rather than the constructor.
func (h *HealthHandler) WithPool(pool *pgxpool.Pool) *HealthHandler {
	h.pool = pool
	return h
}

// WithRedis supplies the shared Redis client for the readiness probe and
// whether Redis is a required component (REDIS_REQUIRED). A nil client reports
// the component "not_configured" and never affects the verdict.
func (h *HealthHandler) WithRedis(client *goredis.Client, required bool) *HealthHandler {
	h.redis = client
	h.redisRequired = required
	return h
}

func (h *HealthHandler) PublicHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true, "service": "backend", "status": "ok"})
}

// Ready is the readiness probe backing /readyz. Distinct from liveness: the
// process must also be able to serve DB-backed traffic. A nil pool (dev/test
// boots without DATABASE_URL) reports not-ready — on deployed tiers a failed
// pool is fatal at boot anyway, so this state is only reachable locally.
//
// Per-component verdicts (E2E-FR-050) are reported under "components":
//   - db:    up | down | not_configured — always a REQUIRED component; a
//     failure (or nil pool) fails readiness with 503.
//   - redis: up | degraded | down | not_configured — optional by default.
//     When wired but unreachable it reports "degraded" (still 200 — every
//     Redis consumer has a DB-unique or nil-safe fallback, so an outage is a
//     latency loss, not a serving outage). Only when WithRedis(required=true)
//     — REDIS_REQUIRED=true — does a Redis failure report "down" and fail the
//     probe with 503.
//
// The DB+Redis ping pair is rate-limited (see the struct comment): concurrent
// probes within readyProbeInterval share the previous verdict rather than each
// acquiring a pool connection. The mutex is held across the ping so at most
// one probe is ever in flight.
func (h *HealthHandler) Ready(c *gin.Context) {
	if h.pool == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"success": false, keyReadyStatus: "not_ready", keyReadyReason: "database pool not configured",
			keyReadyComponents: gin.H{"db": componentNotConfigured, "redis": h.redisComponentLabel()},
		})
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if time.Since(h.lastProbeAt) < readyProbeInterval {
		h.writeReady(c, h.lastReady, h.lastReason, h.lastDB, h.lastRedis)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	dbErr := h.probeDB(ctx)
	redisStatus := h.probeRedis(ctx)
	cancel()
	h.lastProbeAt = time.Now()

	reason := ""
	if dbErr != nil {
		reason = "database ping failed"
	}
	h.lastDB = componentUp
	if dbErr != nil {
		h.lastDB = componentDown
	}
	h.lastRedis = redisStatus
	h.lastReady = dbErr == nil && redisStatus != componentDown
	if redisStatus == componentDown {
		if reason != "" {
			reason += "; "
		}
		reason += "redis ping failed (required component)"
	}
	h.lastReason = reason
	h.writeReady(c, h.lastReady, h.lastReason, h.lastDB, h.lastRedis)
}

// probeDB pings Postgres, honoring the test override hook.
func (h *HealthHandler) probeDB(ctx context.Context) error {
	if h.pingDB != nil {
		return h.pingDB(ctx)
	}
	return h.pool.Ping(ctx)
}

// probeRedis returns the component verdict for Redis. "down" is only produced
// when the component is required; otherwise an unreachable Redis is "degraded".
func (h *HealthHandler) probeRedis(ctx context.Context) string {
	if h.redis == nil {
		return componentNotConfigured
	}
	ping := h.pingRedis
	if ping == nil {
		ping = func(ctx context.Context) error { return h.redis.Ping(ctx).Err() }
	}
	if err := ping(ctx); err != nil {
		if h.redisRequired {
			return componentDown
		}
		return componentDegraded
	}
	return componentUp
}

// redisComponentLabel reports the Redis verdict without probing — used on the
// early-return path where no probe has run (nil pool).
func (h *HealthHandler) redisComponentLabel() string {
	if h.redis == nil {
		return componentNotConfigured
	}
	return "unknown"
}

func (h *HealthHandler) writeReady(c *gin.Context, ready bool, reason, db, redisStatus string) {
	components := gin.H{"db": db, "redis": redisStatus}
	if components["db"] == "" {
		components["db"] = "unknown"
	}
	if components["redis"] == "" {
		components["redis"] = h.redisComponentLabel()
	}
	if !ready {
		c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, keyReadyStatus: "not_ready", keyReadyReason: reason, keyReadyComponents: components})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, keyReadyStatus: "ready", keyReadyComponents: components})
}

func (h *HealthHandler) GenericHealth(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// Build reports which commit this process is serving — PublicHealth's body is a
// fixed string, byte-identical on every build, so it cannot distinguish
// "deployed" from "did not deploy".
// Exposes ONLY build identity (commit, branch, dirty flag, process start): the
// endpoint is unauthenticated, so no config/environment/dependency inventory.
// Reports commit "" with source "unknown" rather than inventing a value — a
// wrong commit would be believed.
func (h *HealthHandler) Build(c *gin.Context) {
	dir, err := os.Getwd()
	if err != nil {
		dir = "."
	}
	c.JSON(http.StatusOK, buildinfo.CurrentRelease(c.Request.Context(), dir))
}
