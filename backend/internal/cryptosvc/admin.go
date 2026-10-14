package cryptosvc

import (
	"errors"
	"net/http"
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
