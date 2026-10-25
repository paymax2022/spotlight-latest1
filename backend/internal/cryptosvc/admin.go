package cryptosvc

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/cryptoprov"
)

// AdminReviewSwap is the admin-console view of a swap parked in needs_review: a swap the
// pipeline could not auto-resolve, with the user's NGN still held in the ledger. Unlike the
// member SwapView it DOES expose user_id and the provider swap id, because this surface is
// gated by the crypto.admin permission and ops need them to resolve held money. NGN is
// integer kobo; held_kobo is the ngn+fee the wallet is holding.
//
// Round 1 is read-only — it surfaces parked money so ops can SEE it. The settle/release/retry
// decision controls are a follow-up (the resolution set is state-dependent: a swap with no
// provider swap id has an unknown provider outcome and must never be blindly settled). See
// ADR-PR727.
type AdminReviewSwap struct {
	ID             string `json:"id"`
	UserID         string `json:"user_id"`
	Status         string `json:"status"`
	Asset          string `json:"asset"`
	NGNKobo        int64  `json:"ngn_kobo"`
	FeeKobo        int64  `json:"fee_kobo"`
	HeldKobo       int64  `json:"held_kobo"`
	Provider       string `json:"provider"`
	ProviderSwapID string `json:"provider_swap_id,omitempty"`
	HasProviderID  bool   `json:"has_provider_id"`
	UpdatedAt      string `json:"updated_at,omitempty"`
	AgeSeconds     int64  `json:"age_seconds"`
}

func adminViewOf(r SwapRecord, now time.Time) AdminReviewSwap {
	v := AdminReviewSwap{
		ID: r.ID, UserID: r.UserID, Status: string(r.State), Asset: r.ToCurrency,
		NGNKobo: r.NGNKobo, FeeKobo: r.FeeKobo, HeldKobo: r.NGNKobo + r.FeeKobo,
		Provider: r.Provider, ProviderSwapID: r.ProviderSwapID,
		HasProviderID: r.ProviderSwapID != "",
	}
	if !r.UpdatedAt.IsZero() {
		v.UpdatedAt = r.UpdatedAt.UTC().Format("2006-01-02T15:04:05Z")
		if d := now.Sub(r.UpdatedAt); d > 0 {
			v.AgeSeconds = int64(d.Seconds())
		}
	}
	return v
}

type adminHandler struct {
	d   HandlerDeps
	now func() time.Time
}

const (
	reviewDefaultLimit = 50
	reviewMaxLimit     = 200
)

// RegisterAdminRoutes mounts the crypto swap admin surface on admin, which the caller has
// already authenticated and guarded with the crypto.admin permission: the needs_review queue
// and the resolve decision control.
func RegisterAdminRoutes(admin *gin.RouterGroup, d HandlerDeps) {
	h := &adminHandler{d: d, now: time.Now}
	admin.GET("/swaps/review", h.reviewQueue)
	admin.POST("/swaps/:id/resolve", h.resolve)
	admin.GET("/reconciler", h.reconcilerStatus)
	admin.GET("/deposits/reconciler", h.depositReconcilerStatus)
	admin.GET("/fee-schedule", h.feeSchedule)
	admin.PUT("/fee-schedule", h.updateFeeSchedule)
}

// reconcilerStatus GET /admin/crypto/reconciler — what the reconciler has been doing and what
// is waiting on it. "replica" is in-process state of the replica that served this request (only
// the elected leader works, so a follower mostly shows skipped passes); "backlog" is read from
// the database and is the same whichever replica answers. Counts, kobo and alert text only:
// no swap, user or provider identifiers. Read-only.
func (h *adminHandler) reconcilerStatus(c *gin.Context) {
	if h.d.Recon == nil {
		fail(c, http.StatusServiceUnavailable, "reconciler_not_running")
		return
	}
	snap := h.d.Recon.Snapshot()
	backlog, err := h.d.Service.Backlog(c.Request.Context())
	if err != nil {
		fail(c, http.StatusInternalServerError, "internal_error")
		return
	}
	now := h.now()
	type alertView struct {
		At      string `json:"at"`
		Kind    string `json:"kind"`
		Message string `json:"message"`
	}
	alerts := make([]alertView, 0, len(snap.RecentAlerts))
	for _, a := range snap.RecentAlerts {
		alerts = append(alerts, alertView{At: ts(a.At), Kind: a.Kind, Message: a.Message})
	}
	rows := make([]gin.H, 0, len(backlog))
	for _, b := range backlog {
		row := gin.H{"state": string(b.State), "count": b.Count, "held_kobo": b.HeldKobo, "oldest_age_seconds": int64(0)}
		if b.Count > 0 && !b.OldestUpdatedAt.IsZero() {
			row["oldest_updated_at"] = ts(b.OldestUpdatedAt)
			if d := now.Sub(b.OldestUpdatedAt); d > 0 {
				row["oldest_age_seconds"] = int64(d.Seconds())
			}
		}
		rows = append(rows, row)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"note":    "replica is the in-process state of the replica that answered; only the elected leader does work, so a follower mostly shows skipped passes. backlog comes from the database.",
		"replica": gin.H{
			"started_at": ts(snap.StartedAt), "runs": snap.Runs, "led_runs": snap.LedRuns, "skipped_runs": snap.SkippedRuns,
			"last_run_at": ts(snap.LastRunAt), "last_led_at": ts(snap.LastLedAt), "last_led": snap.LastLed,
			"last_error": snap.LastError,
			"last_result": gin.H{
				"resolved": snap.LastResult.Resolved, "released": snap.LastResult.Released, "parked": snap.LastResult.Parked,
				"expired": snap.LastResult.Expired, "errors": snap.LastResult.Errors, "clearing_negative": snap.LastResult.ClearingNegative,
			},
			"totals": gin.H{
				"resolved": snap.Totals.Resolved, "released": snap.Totals.Released, "parked": snap.Totals.Parked,
				"expired": snap.Totals.Expired, "errors": snap.Totals.Errors, "clearing_negative_runs": snap.Totals.ClearingNegativeRuns,
			},
			"recent_alerts": alerts,
		},
		"backlog": rows,
	})
}

// depositReconcilerStatus GET /admin/crypto/deposits/reconciler — the money-IN safety net
// (GAP-DEP-01 Slice 2b): what the deposit sweep has done and what it is waiting on. Counts and
// alert text only — no account, user or provider identifiers. "replica" is this replica's
// in-process state; only the elected leader sweeps, so a follower mostly shows skipped passes.
// Read-only. Answers 503 when money-IN settlement is not wired.
func (h *adminHandler) depositReconcilerStatus(c *gin.Context) {
	if h.d.DepositRecon == nil {
		fail(c, http.StatusServiceUnavailable, "deposit_reconciler_not_running")
		return
	}
	snap := h.d.DepositRecon.Snapshot()
	alerts := make([]gin.H, 0, len(snap.RecentAlerts))
	for _, a := range snap.RecentAlerts {
		alerts = append(alerts, gin.H{"at": ts(a.At), "kind": a.Kind, "message": a.Message})
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"note":    "the deposit reconciler sweeps provider ListDeposits and re-submits each transfer to the once-only settler; it can never double-credit. replica is this process's state; only the elected leader sweeps.",
		"replica": gin.H{
			"started_at": ts(snap.StartedAt), "runs": snap.Runs, "led_runs": snap.LedRuns, "skipped_runs": snap.SkippedRuns,
			"last_run_at": ts(snap.LastRunAt), "last_led_at": ts(snap.LastLedAt), "last_led": snap.LastLed,
			"last_error": snap.LastError,
			"last_result": gin.H{
				"accounts": snap.LastResult.Accounts, "scanned": snap.LastResult.Scanned,
				"settled": snap.LastResult.Settled, "duplicates": snap.LastResult.Duplicates,
				"awaiting": snap.LastResult.Awaiting, "ignored": snap.LastResult.Ignored,
				"truncated": snap.LastResult.Truncated, "errors": snap.LastResult.Errors,
			},
			"totals": gin.H{
				"settled": snap.Totals.Settled, "duplicates": snap.Totals.Duplicates, "awaiting": snap.Totals.Awaiting,
				"ignored": snap.Totals.Ignored, "errors": snap.Totals.Errors,
			},
			"recent_alerts": alerts,
		},
	})
}

// ts formats a time as RFC3339 UTC, or "" for the zero time.
func ts(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format("2006-01-02T15:04:05Z")
}

// reviewQueue GET /admin/crypto/swaps/review?limit=&offset= — swaps parked in needs_review,
// oldest parked first, so ops can see held money. Read-only.
func (h *adminHandler) reviewQueue(c *gin.Context) {
	limit := boundedQuery(c, "limit", reviewDefaultLimit, 1, reviewMaxLimit)
	offset := boundedQuery(c, "offset", 0, 0, 1_000_000)
	recs, err := h.d.Service.ListByState(c.Request.Context(), cryptoprov.SwapStateNeedsReview, limit, offset)
	if err != nil {
		fail(c, http.StatusInternalServerError, "review_list_failed")
		return
	}
	now := h.now()
	out := make([]AdminReviewSwap, 0, len(recs))
	for _, r := range recs {
		out = append(out, adminViewOf(r, now))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "swaps": out, "count": len(out)})
}

// resolveBody is the operator's decision for a parked swap.
type resolveBody struct {
	Decision string `json:"decision"`
	Note     string `json:"note"`
}

// resolve POST /admin/crypto/swaps/:id/resolve — apply a human decision to a swap parked in
// needs_review. An Idempotency-Key header and a non-empty note are mandatory (iron-rule money
// path + audit trail). The decision is release or retry; which one is safe depends on whether
// the swap has a provider swap id (enforced in Service.AdminResolve). See ADR-PR728.
func (h *adminHandler) resolve(c *gin.Context) {
	id := c.Param("id")
	if !validSwapID(id) {
		fail(c, http.StatusNotFound, "swap_not_found")
		return
	}
	idemKey := c.GetHeader("Idempotency-Key")
	if !idemKeyRe.MatchString(idemKey) {
		fail(c, http.StatusBadRequest, "idempotency_key_required")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxJSONBytes)
	var body resolveBody
	if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "bad_request")
		return
	}
	note := strings.TrimSpace(body.Note)
	if note == "" {
		fail(c, http.StatusBadRequest, "note_required")
		return
	}
	decision := ResolveDecision(body.Decision)
	if decision != DecisionRelease && decision != DecisionRetry {
		fail(c, http.StatusBadRequest, "bad_decision")
		return
	}
	rec, err := h.d.Service.AdminResolve(c.Request.Context(), "admin:"+ginutil.UserID(c), idemKey, id, decision, note)
	if err != nil {
		h.writeResolveErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "swap": adminViewOf(rec, h.now())})
}

func (h *adminHandler) writeResolveErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrSwapNotFound):
		fail(c, http.StatusNotFound, "swap_not_found")
	case errors.Is(err, ErrNotParked):
		fail(c, http.StatusConflict, "not_parked")
	case errors.Is(err, ErrNothingToRetry):
		fail(c, http.StatusUnprocessableEntity, "nothing_to_retry")
	case errors.Is(err, ErrReleaseUnsafe):
		fail(c, http.StatusUnprocessableEntity, "release_unsafe")
	case errors.Is(err, ErrSettlementConflict):
		fail(c, http.StatusConflict, "settlement_conflict")
	case errors.Is(err, ErrUnknownDecision):
		fail(c, http.StatusBadRequest, "bad_decision")
	default:
		fail(c, http.StatusInternalServerError, "resolve_failed")
	}
}

// boundedQuery reads an integer query param, falling back to def when absent or unparseable
// and clamping into [lo, hi]. A hostile ?limit=99999999 can never widen the page.
func boundedQuery(c *gin.Context, name string, def, lo, hi int) int {
	raw := c.Query(name)
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

// feeView is the admin representation of one stored schedule version. Rates are integer basis
// points; Version 0 is the code default.
func feeView(v VersionedFees) gin.H {
	majors := make([]string, 0, len(v.Schedule.Majors))
	for m := range v.Schedule.Majors {
		majors = append(majors, m)
	}
	sort.Strings(majors)
	overrides := map[string]int{}
	for a, bps := range v.Schedule.Overrides {
		overrides[a] = bps
	}
	return gin.H{
		"version": v.Version, "major_bps": v.Schedule.MajorBps, "other_bps": v.Schedule.OtherBps,
		"majors": majors, "overrides": overrides, "reason": v.Reason, "created_by": v.CreatedBy, "created_at": ts(v.CreatedAt),
	}
}

const feeHistoryLimit = 20

// feeSchedule GET /admin/crypto/fee-schedule — the active markup schedule, the hard ceiling and
// the last changes (who, when, why). Read-only.
func (h *adminHandler) feeSchedule(c *gin.Context) {
	if h.d.FeeAdmin == nil {
		fail(c, http.StatusServiceUnavailable, "fee_schedule_unavailable")
		return
	}
	cur, err := h.d.FeeAdmin.Current(c.Request.Context())
	if err != nil {
		fail(c, http.StatusInternalServerError, "internal_error")
		return
	}
	hist, err := h.d.FeeAdmin.History(c.Request.Context(), feeHistoryLimit)
	if err != nil {
		fail(c, http.StatusInternalServerError, "internal_error")
		return
	}
	rows := make([]gin.H, 0, len(hist))
	for _, v := range hist {
		rows = append(rows, feeView(v))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "current": feeView(cur), "ceiling_bps": HardMaxBps, "history": rows})
}

// updateFeeSchedule PUT /admin/crypto/fee-schedule — replace the markup schedule with a new
// version. It needs an Idempotency-Key, the version the editor read (refused with 409 if stale)
// and a reason; every rate is capped at HardMaxBps. A new version prices NEW quotes only: a swap
// already quoted keeps the bps stored on it. Each applied change is audited (old and new) in the
// same transaction that stores it.
func (h *adminHandler) updateFeeSchedule(c *gin.Context) {
	if h.d.FeeAdmin == nil {
		fail(c, http.StatusServiceUnavailable, "fee_schedule_unavailable")
		return
	}
	key, ok := ginutil.RequireIdempotencyKeyOK(c)
	if !ok {
		return
	}
	if !idemKeyRe.MatchString(key) {
		fail(c, http.StatusBadRequest, "invalid_idempotency_key")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxJSONBytes)
	var body struct {
		ExpectedVersion *int64         `json:"expected_version"`
		MajorBps        int            `json:"major_bps"`
		OtherBps        int            `json:"other_bps"`
		Majors          []string       `json:"majors"`
		Overrides       map[string]int `json:"overrides"`
		Reason          string         `json:"reason"`
	}
	dec := json.NewDecoder(c.Request.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil || body.ExpectedVersion == nil || dec.More() {
		fail(c, http.StatusBadRequest, "invalid_body")
		return
	}
	in := FeeScheduleInput{
		MajorBps: body.MajorBps, OtherBps: body.OtherBps, Majors: body.Majors, Overrides: body.Overrides,
		Reason: body.Reason, Actor: ginutil.UserID(c), IdempotencyKey: key, ExpectedVersion: *body.ExpectedVersion,
	}
	if _, err := in.Schedule(); err != nil {
		c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid_fee_schedule", "detail": err.Error()})
		return
	}
	ch, err := h.d.FeeAdmin.Append(c.Request.Context(), in)
	switch {
	case errors.Is(err, ErrFeeVersionConflict):
		fail(c, http.StatusConflict, "version_conflict")
		return
	case errors.Is(err, ErrFeeIdempotencyConflict):
		fail(c, http.StatusConflict, "idempotency_conflict")
		return
	case errors.Is(err, ErrFeeInput), errors.Is(err, ErrFeeBps):
		fail(c, http.StatusBadRequest, "invalid_fee_schedule")
		return
	case err != nil:
		fail(c, http.StatusInternalServerError, "internal_error")
		return
	}
	// The audit record was written by the store in the same transaction as the version row.
	c.JSON(http.StatusOK, gin.H{"success": true, "current": feeView(ch.New), "ceiling_bps": HardMaxBps})
}

// feeAuditValues is the audit-log form of a schedule version (no free text beyond the reason).
func feeAuditValues(v VersionedFees) map[string]any {
	m := map[string]any{}
	for k, val := range feeView(v) {
		m[k] = val
	}
	return m
}
