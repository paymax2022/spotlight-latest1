package platform

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
)

// Handler exposes the read-only platform EdTech oversight endpoints. Every response
// is wrapped in {"data": ...} to match the console client (getJson unwraps
// `j?.data ?? j`). Money is always integer minor units (kobo). Where a screen has no
// backing table the handler returns a documented empty/placeholder shape.
type Handler struct {
	repo  *Repo
	flags *FlagService
}

// NewHandler builds the platform oversight handler.
func NewHandler(repo *Repo) *Handler { return &Handler{repo: repo, flags: NewFlagService(repo)} }

func rfc(t time.Time) string { return t.UTC().Format(time.RFC3339) }
func rfcPtr(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}

func fail(c *gin.Context, err error) {
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

// ── SU-01 GET /schools → PlatformSchool[] ─────────────────────────────────────
func (h *Handler) ListSchools(c *gin.Context) {
	rows, err := h.repo.ListSchools(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, s := range rows {
		out = append(out, gin.H{
			"id":                s.ID,
			"name":              s.Name,
			"state":             s.State,
			"owner_identity_id": s.OwnerIdentityID,
			"verification_tier": s.VerificationTier,
			"status":            s.Status,
			"students":          s.Students,
			"gmv_kobo":          s.GMVKobo,
			"trust_score":       s.TrustScore,
			"gov_sync_opt_in":   s.GovSyncOptIn,
			"created_at":        rfc(s.CreatedAt),
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── SU-02 GET /verification-queue → VerificationSubmission[] ───────────────────
func (h *Handler) ListVerificationQueue(c *gin.Context) {
	rows, err := h.repo.ListVerificationQueue(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, v := range rows {
		out = append(out, gin.H{
			"id":             v.SchoolID, // no submission entity — the school id is the queue key
			"school_id":      v.SchoolID,
			"school_name":    v.SchoolName,
			"requested_tier": "verified", // no requested-tier column; default next tier (documented)
			"cac_number":     "",         // no CAC entity in schema (documented empty)
			"cac_doc_url":    "",
			"references":     []any{},
			"submitted_at":   rfc(v.SubmittedAt),
			"status":         v.Status,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── SU-02 POST /schools/:id/verify → VerificationSubmission ────────────────────
// Advances verification_tier on the money-free academy_schools column. Body may
// carry {granted_tier, reason}; defaults to 'verified' when absent.
func (h *Handler) VerifySchool(c *gin.Context) {
	// Supports both the spec route (POST /schools/:id/verify) and the console client's
	// live route (POST /verification-queue/:id/review, where :id is the school id in the
	// derived queue). Whichever param is present wins.
	schoolID := c.Param("id")
	var body struct {
		Decision    string `json:"decision"` // console sends 'approve' | 'reject'
		GrantedTier string `json:"granted_tier"`
		Reason      string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)

	// Reject decision: do NOT advance the tier; return the rejected submission shape.
	if body.Decision == "reject" {
		var name string
		_ = h.repo.pool.QueryRow(c.Request.Context(),
			`SELECT name FROM public.academy_schools WHERE id=$1`, schoolID).Scan(&name)
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"id": schoolID, "school_id": schoolID, "school_name": name,
			"requested_tier": firstNonEmpty(body.GrantedTier, "verified"),
			"cac_number":     "", "cac_doc_url": "", "references": []any{},
			"submitted_at": rfc(time.Now()), "status": "rejected",
			"reason": body.Reason, "decided_at": rfc(time.Now()),
		}})
		return
	}

	tier := body.GrantedTier
	if tier == "" {
		tier = "verified"
	}
	v, err := h.repo.VerifySchool(c.Request.Context(), schoolID, tier)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":             v.SchoolID,
		"school_id":      v.SchoolID,
		"school_name":    v.SchoolName,
		"requested_tier": tier,
		"cac_number":     "",
		"cac_doc_url":    "",
		"references":     []any{},
		"submitted_at":   rfc(v.SubmittedAt),
		"status":         "approved",
		"reason":         body.Reason,
		"decided_at":     rfc(time.Now()),
	}})
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// ── SU-03 GET /collections → CollectionsOverview ──────────────────────────────
func (h *Handler) Collections(c *gin.Context) {
	ctx := c.Request.Context()
	agg, err := h.repo.CollectionsOverview(ctx)
	if err != nil {
		fail(c, err)
		return
	}
	trend, err := h.repo.GMVTrend(ctx, 14)
	if err != nil {
		fail(c, err)
		return
	}
	schools, _ := h.repo.ListSchools(ctx)
	top := make([]gin.H, 0, 4)
	for i, s := range schools { // ListSchools is created_at-ordered; sort by gmv for top
		_ = i
		top = append(top, gin.H{"school_id": s.ID, "name": s.Name, "gmv_kobo": s.GMVKobo})
	}
	top = topByGMV(top, 4)

	trendOut := make([]gin.H, 0, len(trend))
	for _, t := range trend {
		trendOut = append(trendOut, gin.H{"date": t.Date, "value_kobo": t.ValueKobo})
	}
	var rate float64
	if agg.InvoicesIssued > 0 {
		rate = float64(agg.InvoicesPaid) / float64(agg.InvoicesIssued)
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"gmv_kobo":        agg.GMVKobo,
		"gmv_today_kobo":  agg.GMVTodayKobo,
		"active_schools":  agg.ActiveSchools,
		"invoices_issued": agg.InvoicesIssued,
		"invoices_paid":   agg.InvoicesPaid,
		"collection_rate": rate,
		"reconciliation": gin.H{
			"matched":       agg.Matched,
			"pending":       agg.Pending,
			"drift_flagged": agg.DriftFlagged,
			"last_run_at":   rfc(time.Now()),
		},
		"gmv_trend":   trendOut,
		"top_schools": top,
	}})
}

// topByGMV selects the n highest gmv_kobo entries (simple selection sort on a small
// slice — the console only shows the top 4).
func topByGMV(rows []gin.H, n int) []gin.H {
	for i := 0; i < len(rows) && i < n; i++ {
		max := i
		for j := i + 1; j < len(rows); j++ {
			if rows[j]["gmv_kobo"].(int64) > rows[max]["gmv_kobo"].(int64) {
				max = j
			}
		}
		rows[i], rows[max] = rows[max], rows[i]
	}
	if len(rows) > n {
		return rows[:n]
	}
	return rows
}

// ── SU-04 GET /risk → RiskCase[] ──────────────────────────────────────────────
func (h *Handler) ListRisk(c *gin.Context) {
	rows, err := h.repo.ListRiskCases(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, r := range rows {
		out = append(out, gin.H{
			"id":          r.ID,
			"kind":        r.Kind,
			"school_id":   r.SchoolID,
			"school_name": r.SchoolName,
			"severity":    "critical", // reversed/chargeback is treated critical
			"amount_kobo": r.AmountKobo,
			"summary":     "Reversed fee payment (chargeback) — funds may already be applied to an invoice.",
			"opened_at":   rfc(r.OpenedAt),
			"status":      "open",
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── SU-05 GET /gov-sync → GovSyncRow[] ────────────────────────────────────────
func (h *Handler) ListGovSync(c *gin.Context) {
	rows, err := h.repo.ListGovSync(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, g := range rows {
		cats := g.Categories
		if cats == nil {
			cats = []string{}
		}
		out = append(out, gin.H{
			"school_id":       g.SchoolID,
			"school_name":     g.SchoolName,
			"opted_in":        g.OptedIn,
			"data_categories": cats,
			"regulator":       g.Regulator,
			"last_export_at":  rfcPtr(g.LastExportAt),
			"export_count":    g.ExportCount,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── SU-05 GET /compliance-exports → ComplianceExportLog[] ─────────────────────
func (h *Handler) ListComplianceExports(c *gin.Context) {
	rows, err := h.repo.ListComplianceExports(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, e := range rows {
		cats := e.Categories
		if cats == nil {
			cats = []string{}
		}
		out = append(out, gin.H{
			"id":              e.ID,
			"school_id":       e.SchoolID,
			"school_name":     e.SchoolName,
			"report_type":     e.ReportType,
			"period":          e.Period,
			"data_categories": cats,
			"regulator":       "", // no regulator column; empty (documented)
			"generated_at":    rfc(e.GeneratedAt),
			"generated_by":    e.GeneratedBy,
			"immutable_hash":  e.PayloadRef, // payload_ref is the append-only integrity anchor
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── SU-06 GET /competitions → Competition[] ───────────────────────────────────
func (h *Handler) ListCompetitions(c *gin.Context) {
	rows, err := h.repo.ListCompetitions(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, cm := range rows {
		out = append(out, gin.H{
			"id":                    cm.ID,
			"name":                  cm.Name,
			"scope":                 cm.Scope,
			"status":                cm.Status,
			"participating_schools": cm.ParticipatingSchools,
			"sponsor":               cm.Sponsor,
			"start_date":            dateOrEmpty(cm.StartDate),
			"end_date":              dateOrEmpty(cm.EndDate),
			"broadcast_ready":       false, // no broadcast_ready column (documented default)
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func dateOrEmpty(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format("2006-01-02")
}

// ── SU-07 GET /trust-scores → TrustScoreRow[] ─────────────────────────────────
func (h *Handler) ListTrustScores(c *gin.Context) {
	rows, err := h.repo.ListTrustScores(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, t := range rows {
		out = append(out, trustJSON(t))
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── SU-07 POST /trust-scores/:schoolId/override → TrustScoreRow ───────────────
func (h *Handler) OverrideTrustScore(c *gin.Context) {
	schoolID := c.Param("schoolId")
	var body struct {
		SchoolID string  `json:"school_id"`
		Score    float64 `json:"score"`
		Reason   string  `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if schoolID == "" {
		schoolID = body.SchoolID
	}
	actorID := ""
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		actorID = u.ID
	}
	row, err := h.repo.SaveTrustOverride(c.Request.Context(), schoolID, actorID, body.Score, body.Reason)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": trustJSON(row)})
}

func trustJSON(t TrustRow) gin.H {
	updated := ""
	if !t.UpdatedAt.IsZero() {
		updated = rfc(t.UpdatedAt)
	}
	// Components mirror the console weighting labels; value tracks the current score
	// so the UI renders. The authoritative computed breakdown lives in the
	// fees/trustscore service (not recomputed here to avoid a second source of truth).
	comp := func(label string, w float64) gin.H {
		return gin.H{"label": label, "weight": w, "value": t.Score}
	}
	return gin.H{
		"school_id":   t.SchoolID,
		"school_name": t.SchoolName,
		"score":       t.Score,
		"components": []gin.H{
			comp("Collection reliability", 0.35),
			comp("Reconciliation health", 0.25),
			comp("Dispute rate (inverse)", 0.2),
			comp("Verification tier", 0.2),
		},
		"overridden":      t.Overridden,
		"override_reason": t.OverrideReason,
		"updated_at":      updated,
	}
}

// ── SU-08 GET /scholarship-pledges → ScholarshipPledge[] ──────────────────────
func (h *Handler) ListScholarships(c *gin.Context) {
	rows, err := h.repo.ListScholarships(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	// Map the pledge state machine to the console's PledgeStatus vocabulary.
	stateMap := map[string]string{
		"pledged":           "pledged",
		"funded":            "funded",
		"partially_applied": "disbursed",
		"applied":           "disbursed",
		"cancelled":         "cancelled",
	}
	out := make([]gin.H, 0, len(rows))
	for _, s := range rows {
		st := stateMap[s.State]
		if st == "" {
			st = s.State
		}
		ledger := s.LedgerRef
		if ledger == "" {
			ledger = "—"
		}
		out = append(out, gin.H{
			"id":                  s.ID,
			"sponsor":             "", // pledge stores sponsor_identity_id only; no display name (documented)
			"sponsor_identity_id": s.SponsorIdentity,
			"target_student_ref":  s.TargetStudentRef,
			"school_name":         s.SchoolName,
			"amount_kobo":         s.AmountKobo,
			"status":              st,
			"ledger_ref":          ledger,
			"created_at":          rfc(s.CreatedAt),
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── SU-09 GET /support-tickets → SupportTicket[] (no backing table) ───────────
// There is no support-ticket table in the schema. Returns a documented empty list.
func (h *Handler) ListSupportTickets(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": []any{}})
}

// ── SU-10 GET /flags → FeatureFlag[] (real runtime store) ─────────────────────
// Reads the persisted public.academy_feature_flags store. Rows here are authoritative;
// the composition root additionally falls back to the compile-time default for any flag
// with no row (fail-closed). Read-only; no money.
func (h *Handler) ListFlags(c *gin.Context) {
	rows, err := h.flags.ListFlags(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, f := range rows {
		out = append(out, gin.H{
			"key":         f.Key,
			"label":       f.Key,
			"description": f.Description,
			"scope_type":  "global",
			"scope_ref":   "",
			"enabled":     f.Enabled,
			"updated_at":  rfc(f.UpdatedAt),
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── SU-10 PUT/POST /flags/toggle → FeatureFlag (real persisted toggle) ────────
// Persists the requested enabled state to academy_feature_flags and appends an immutable
// audit row (academy_commerce_audit, surfaced by SU-11). RBAC (platform_edtech_admin) is
// enforced at the route group; the actor is the authenticated operator. No money path.
func (h *Handler) ToggleFlag(c *gin.Context) {
	var body struct {
		Key       string `json:"key"`
		ScopeType string `json:"scope_type"`
		ScopeRef  string `json:"scope_ref"`
		Enabled   bool   `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if body.Key == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key is required"})
		return
	}
	actorID := ""
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		actorID = u.ID
	}
	f, err := h.flags.SetFlag(c.Request.Context(), body.Key, body.Enabled, actorID)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"key":         f.Key,
		"label":       f.Key,
		"description": f.Description,
		"scope_type":  "global",
		"scope_ref":   body.ScopeRef,
		"enabled":     f.Enabled,
		"updated_at":  rfc(f.UpdatedAt),
	}})
}

// ── SU-11 GET /audit-log → AuditLogEntry[] ────────────────────────────────────
func (h *Handler) SearchAudit(c *gin.Context) {
	entity := c.Query("entity")
	schoolID := c.Query("school_id")
	limit := 200
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	rows, err := h.repo.SearchAudit(c.Request.Context(), entity, schoolID, limit)
	if err != nil {
		fail(c, err)
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, a := range rows {
		out = append(out, gin.H{
			"id":             a.ID,
			"module":         "academy.fees",
			"entity":         a.Entity,
			"entity_id":      a.EntityID,
			"action":         a.Action,
			"actor":          a.Actor,
			"actor_role":     "", // commerce audit stores actor_id only (documented empty)
			"school_id":      a.SchoolID,
			"at":             rfc(a.At),
			"immutable_hash": a.ID, // append-only row id is the integrity anchor
			"metadata":       a.Detail,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ── SU-12 GET /compliance-posture → CompliancePosture ─────────────────────────
func (h *Handler) CompliancePosture(c *gin.Context) {
	drift, err := h.repo.DriftSignals(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	signals := make([]gin.H, 0, len(drift))
	for _, d := range drift {
		signals = append(signals, gin.H{
			"id":          d.ID,
			"school_name": d.SchoolName,
			"signal":      d.Signal,
			"severity":    "critical",
			"detected_at": rfc(d.DetectedAt),
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"model_a_only":         true,
		"bnpl_rail_repurposed": len(signals) > 0, // any advance/financing drift ⇒ flag
		"license_category":     "Payment facilitation (Model A — collections only)",
		"last_reviewed_at":     rfc(time.Now()),
		"drift_signals":        signals,
	}})
}
