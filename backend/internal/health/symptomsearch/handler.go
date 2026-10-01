package symptomsearch

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	platformRedis "spotlight/backend/internal/platform/redis"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// HTTP surface (contracts/openapi.yaml — /pharmacy/symptom-search,
// /pharmacy/classes/{id}/skus, /admin/pharmacy/mappings,
// /admin/pharmacy/reviews/{id}/decision). Response bodies are wrapped as
// { "data": ... } per the contract. AuthN is the finance auth chain (user_id
// mirrored onto the gin context); RBAC is applied at route registration.

// maxSearchTerms mirrors the contract (terms maxItems: 5).
const maxSearchTerms = 5

// Handler exposes the symptom-search API.
type Handler struct {
	svc *Service
	// isSuperintendent reports whether the caller may decide review cases
	// across premises tenants (object-level authz override).
	isSuperintendent func(c *gin.Context) bool
}

func NewHandler(svc *Service, isSuperintendent func(c *gin.Context) bool) *Handler {
	if isSuperintendent == nil {
		isSuperintendent = func(c *gin.Context) bool { return false }
	}
	return &Handler{svc: svc, isSuperintendent: isSuperintendent}
}

// symErrMap maps service sentinel errors onto HTTP statuses.
var symErrMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, ErrValidation),
	httperr.R(http.StatusForbidden, ErrForbidden),
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusConflict, ErrConflict),
)

// writeSvcErr maps a service error to its status. Sentinel (4xx) messages are
// safe by construction; anything else is an infrastructure error whose text
// (pgx/SQL detail) must never reach the client — 500s get a generic body.
func writeSvcErr(c *gin.Context, err error) {
	status := symErrMap.Code(err)
	if status == http.StatusInternalServerError {
		ginutil.Fail(c, status, "internal error")
		return
	}
	ginutil.Fail(c, status, err.Error())
}

// SymptomSearch resolves symptom terms to a triage tier + class groups (T1/T2)
// or an escalation card (T3/T4). 404 when NO term matched the taxonomy (the
// miss is still logged server-side for the synonym curation loop).
func (h *Handler) SymptomSearch(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		ginutil.Fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Terms    []string `json:"terms"`
		Refiners struct {
			Who      string `json:"who"`
			Duration string `json:"duration"`
		} `json:"refiners"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.Fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	norm := normalizeTerms(req.Terms)
	if len(norm) == 0 {
		ginutil.Fail(c, http.StatusBadRequest, "terms must contain at least one symptom")
		return
	}
	if len(norm) > maxSearchTerms {
		ginutil.Fail(c, http.StatusBadRequest, "too many terms (max 5)")
		return
	}
	for _, t := range norm {
		if len(t) < 2 || len(t) > 80 {
			ginutil.Fail(c, http.StatusBadRequest, "each term must be 2–80 characters")
			return
		}
	}
	if req.Refiners.Who != "" && !ValidCohorts[req.Refiners.Who] {
		ginutil.Fail(c, http.StatusBadRequest, "refiners.who must be ADULT, CHILD_6_12, CHILD_UNDER_6 or PREGNANT_OR_BF")
		return
	}
	if req.Refiners.Duration != "" && !ValidDurations[req.Refiners.Duration] {
		ginutil.Fail(c, http.StatusBadRequest, "refiners.duration must be TODAY, D2_3 or GT_3D")
		return
	}

	res, err := h.svc.Resolve(c.Request.Context(), ResolveInput{
		UserID:     userID,
		DeviceHash: deviceHash(c),
		Terms:      req.Terms,
		Who:        req.Refiners.Who,
		Duration:   req.Refiners.Duration,
	})
	if err != nil {
		writeSvcErr(c, err)
		return
	}
	if res.Unmatched {
		// Contract: 404 when no term matched the taxonomy. The miss (with the
		// unmatched terms) was already logged for the curation loop.
		ginutil.Fail(c, http.StatusNotFound, "no symptom term matched — try different words or speak to a pharmacist")
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// ListClassSkus lists live (in-stock, NAFDAC-registered, OTC/PHARMACY_ONLY)
// SKUs for a therapeutic class, cohort-filtered.
func (h *Handler) ListClassSkus(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		ginutil.Fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	classID := c.Param("id")
	if !isUUID(classID) {
		ginutil.Fail(c, http.StatusNotFound, "unknown or inactive therapeutic class")
		return
	}
	who := c.Query("who")
	if who != "" && !ValidCohorts[who] {
		ginutil.Fail(c, http.StatusBadRequest, "who must be ADULT, CHILD_6_12, CHILD_UNDER_6 or PREGNANT_OR_BF")
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))

	out, err := h.svc.ListClassSkus(c.Request.Context(), classID, strings.TrimSpace(c.Query("region")), who, limit, offset)
	if err != nil {
		writeSvcErr(c, err)
		return
	}
	if out == nil {
		out = []PharmacySkuOption{}
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// AdminUpsertMapping is the pharmacist-console taxonomy write surface.
func (h *Handler) AdminUpsertMapping(c *gin.Context) {
	actor := ginutil.UserID(c)
	if actor == "" {
		ginutil.Fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var req struct {
		Entity  string         `json:"entity"`
		Action  string         `json:"action"`
		Payload map[string]any `json:"payload"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.Fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	row, err := h.svc.AdminUpsertMapping(c.Request.Context(), actor, req.Entity, req.Action, req.Payload)
	if err != nil {
		writeSvcErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": row})
}

// AdminListMappings serves the console taxonomy read: ?entity=term|cluster.
// All statuses are returned — this is the curation surface, not the member
// resolution path (which stays APPROVED-only).
func (h *Handler) AdminListMappings(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		ginutil.Fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	rows, err := h.svc.ListTaxonomy(c.Request.Context(), c.Query("entity"))
	if err != nil {
		writeSvcErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows})
}

// AdminListReviews is the SLA-sorted pharmacist review queue. Object-level
// authz mirrors the decision route: plain pharmacists are scoped to their own
// premises tenant; the superintendent override may read across tenants.
func (h *Handler) AdminListReviews(c *gin.Context) {
	actor := ginutil.UserID(c)
	if actor == "" {
		ginutil.Fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	cases, err := h.svc.ListReviewCases(c.Request.Context(), actor, c.Query("state"), c.Query("pharmacy_provider_id"), h.isSuperintendent(c))
	if err != nil {
		writeSvcErr(c, err)
		return
	}
	if cases == nil {
		cases = []PharmacyReviewCase{}
	}
	c.JSON(http.StatusOK, gin.H{"data": cases})
}

// AdminGetReview returns the review case plus cart lines and derived history.
// Object-level authz mirrors the decision route: foreign-tenant cases read as
// not-found unless the caller holds the superintendent override.
func (h *Handler) AdminGetReview(c *gin.Context) {
	actor := ginutil.UserID(c)
	if actor == "" {
		ginutil.Fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	caseID := c.Param("id")
	if !isUUID(caseID) {
		ginutil.Fail(c, http.StatusNotFound, "review case not found")
		return
	}
	detail, err := h.svc.GetReviewCaseDetail(c.Request.Context(), actor, caseID, h.isSuperintendent(c))
	if err != nil {
		writeSvcErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": detail})
}

// AdminDecideReview applies a guarded pharmacist decision to a review case.
func (h *Handler) AdminDecideReview(c *gin.Context) {
	actor := ginutil.UserID(c)
	if actor == "" {
		ginutil.Fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	caseID := c.Param("id")
	if !isUUID(caseID) {
		ginutil.Fail(c, http.StatusNotFound, "review case not found")
		return
	}
	var req struct {
		Decision string `json:"decision"`
		Note     string `json:"note"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.Fail(c, http.StatusBadRequest, "invalid body")
		return
	}
	rc, err := h.svc.DecideReviewCase(c.Request.Context(), actor, caseID, req.Decision, req.Note, h.isSuperintendent(c))
	if err != nil {
		writeSvcErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rc})
}

// AdminSymptomMetrics serves the console safety-KPI snapshot (PRD §9):
// review-case volume by state/tier (7d), open-overdue count, median decision
// latency, 24h search volume and the T2+ gated share (7d). Aggregate-safe
// only — no per-user rows, no terms, no PII (NDPR).
func (h *Handler) AdminSymptomMetrics(c *gin.Context) {
	if ginutil.UserID(c) == "" {
		ginutil.Fail(c, http.StatusUnauthorized, "unauthenticated")
		return
	}
	m, err := h.svc.SafetyMetrics(c.Request.Context())
	if err != nil {
		writeSvcErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// The limiter itself lives in ratelimit.go (Redis-backed with in-memory
// fallback, mirroring maps.PerUserRateLimit).

// deviceHashSalt keeps device identifiers pseudonymous at rest (NDPR): the raw
// device id never touches the database — only this salted SHA-256.
const deviceHashSalt = "spotlight.pharmacy.symptom.v1:"

// deviceHash derives the salted device hash from the X-Device-Id header (the
// mobile clients send it), falling back to the client IP so unheadered calls
// are still metered.
func deviceHash(c *gin.Context) string {
	id := strings.TrimSpace(c.GetHeader("X-Device-Id"))
	if id == "" {
		id = "ip:" + c.ClientIP()
	}
	sum := sha256.Sum256([]byte(deviceHashSalt + id))
	return hex.EncodeToString(sum[:])
}

// Per-user+device rate limit for the symptom-search surface (mapping-IP
// scraping guard, PRD §7 + NDPR query-volume cap). Mirrors maps.PerUserRateLimit:
// Redis-backed fixed window (INCR + EXPIRE on a per-minute bucket key) when a
// client is available — so the limit holds across instances — with an
// in-memory per-instance fallback otherwise. Fail-open on Redis errors: an
// infra hiccup never blocks members (the taxonomy stays server-mediated and
// APPROVED-only regardless).

// PerUserDeviceRateLimit is a fixed-window limiter keyed by
// user_id|device_hash. rdb nil ⇒ in-memory fallback (single instance).
func PerUserDeviceRateLimit(rdb *platformRedis.Client, limit int, window time.Duration) gin.HandlerFunc {
	if limit <= 0 {
		limit = 20
	}
	if window <= 0 {
		window = time.Minute
	}
	mem := &searchLimiter{store: map[string]*searchBucket{}, limit: limit, window: window}

	return func(c *gin.Context) {
		key := c.GetString("user_id") + "|" + deviceHash(c)
		var count int
		var ok bool
		if rdb != nil {
			count, ok = redisAllow(c.Request.Context(), rdb, key, limit, window)
		} else {
			count, ok = mem.allow(key)
		}
		c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
		remaining := max(limit-count, 0)
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
		if !ok {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "rate limit exceeded", "code": "rate_limited"})
			return
		}
		c.Next()
	}
}

// redisAllow does a fixed-window counter on a per-minute UTC bucket (the same
// scheme as maps.redisAllow). Fail-open on cache errors.
func redisAllow(ctx context.Context, rdb *platformRedis.Client, key string, limit int, window time.Duration) (int, bool) {
	bucket := time.Now().UTC().Format("200601021504") // yyyymmddHHMM
	rkey := "symptom:rl:" + key + ":" + bucket
	n, err := rdb.Incr(ctx, rkey).Result()
	if err != nil {
		return 0, true // fail-open — never block members on infra
	}
	if n == 1 {
		_ = rdb.Expire(ctx, rkey, window+10*time.Second).Err()
	}
	return int(n), int(n) <= limit
}

type searchBucket struct {
	count       int
	windowStart time.Time
}

type searchLimiter struct {
	mu     sync.Mutex
	store  map[string]*searchBucket
	limit  int
	window time.Duration
}

func (l *searchLimiter) allow(key string) (int, bool) {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.store[key]
	if !ok || now.Sub(b.windowStart) >= l.window {
		b = &searchBucket{windowStart: now}
		l.store[key] = b
	}
	b.count++
	return b.count, b.count <= l.limit
}
