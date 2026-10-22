package cryptosvc

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/internal/cryptoprov"
)

// Admin operations surface (workplan RQ-ADM): provider health from measured telemetry, an
// audit-log search, a manual reconcile trigger and the deposit list. All read-only except the
// reconcile trigger, which only re-reads provider state through the normal settle path (no
// balance can be edited from here) and is itself audited.

// AuditQuery filters the audit log. Zero values are "any"; Before is a created_at cursor.
type AuditQuery struct {
	ActionPrefix string
	Actor        string
	EntityID     string
	Before       time.Time
	Limit        int
}

// AuditRow is one audit entry.
type AuditRow struct {
	ID         string          `json:"id"`
	Actor      string          `json:"actor"`
	Action     string          `json:"action"`
	EntityType string          `json:"entity_type"`
	EntityID   string          `json:"entity_id,omitempty"`
	OldValue   json.RawMessage `json:"old_value,omitempty"`
	NewValue   json.RawMessage `json:"new_value,omitempty"`
	Reason     string          `json:"reason,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

// AuditSearcher reads crypto_audit_log.
type AuditSearcher interface {
	Search(ctx context.Context, q AuditQuery) ([]AuditRow, error)
}

// WebhookClock reports when the provider last delivered a webhook (for webhook lag).
type WebhookClock interface {
	LastWebhookAt(ctx context.Context, provider string) (time.Time, bool, error)
}

const (
	auditDefaultLimit = 100
	auditMaxLimit     = 500
)

// PGAuditLog searches the append-only crypto_audit_log.
type PGAuditLog struct{ Pool *pgxpool.Pool }

var _ AuditSearcher = (*PGAuditLog)(nil)

// Search implements AuditSearcher, newest first.
func (a *PGAuditLog) Search(ctx context.Context, q AuditQuery) ([]AuditRow, error) {
	var before any
	if !q.Before.IsZero() {
		before = q.Before
	}
	rows, err := a.Pool.Query(ctx,
		`SELECT id::text, actor_id, action, entity_type, COALESCE(entity_id,''), old_value, new_value, COALESCE(reason,''), created_at
		   FROM public.crypto_audit_log
		  WHERE ($1 = '' OR action LIKE $1 || '%')
		    AND ($2 = '' OR actor_id = $2)
		    AND ($3 = '' OR entity_id = $3)
		    AND ($4::timestamptz IS NULL OR created_at < $4::timestamptz)
		  ORDER BY created_at DESC
		  LIMIT $5`,
		likePrefix(q.ActionPrefix), q.Actor, q.EntityID, before, q.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditRow{}
	for rows.Next() {
		var r AuditRow
		var oldV, newV []byte
		if err := rows.Scan(&r.ID, &r.Actor, &r.Action, &r.EntityType, &r.EntityID, &oldV, &newV, &r.Reason, &r.CreatedAt); err != nil {
			return nil, err
		}
		if len(oldV) > 0 {
			r.OldValue = oldV
		}
		if len(newV) > 0 {
			r.NewValue = newV
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// likePrefix escapes LIKE metacharacters (backslash first) so the prefix matches literally.
func likePrefix(p string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(p)
}

// LastWebhookAt implements WebhookClock.
func (s *PGStore) LastWebhookAt(ctx context.Context, provider string) (time.Time, bool, error) {
	var at *time.Time
	if err := s.pool.QueryRow(ctx, `SELECT max(received_at) FROM public.crypto_webhook_events WHERE provider = $1`, provider).Scan(&at); err != nil {
		return time.Time{}, false, err
	}
	if at == nil {
		return time.Time{}, false, nil
	}
	return *at, true, nil
}

// healthStatus grades a telemetry snapshot: idle (no calls), down (most calls failing), degraded
// (throttling, >5% failures or a slow p95), ok.
func healthStatus(h cryptoprov.Health) string {
	switch {
	case h.Calls == 0:
		return "idle"
	case h.Failures*2 > h.Calls:
		return "down"
	case h.Throttled > 0 || h.Failures*20 > h.Calls || h.P95 > 3*time.Second:
		return "degraded"
	}
	return "ok"
}

func (h *adminHandler) providerHealth(c *gin.Context) {
	svc := h.d.Service
	now := h.now()
	out := gin.H{"provider": svc.cfg.Provider, "checked_at": ts(now)}
	p, err := svc.provider()
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "provider_not_configured")
		return
	}
	if hr, err := cryptoprov.As[cryptoprov.HealthReporter](p); err == nil {
		hl := hr.Health(now)
		rate := 0.0
		if hl.Calls > 0 {
			rate = float64(hl.Failures) / float64(hl.Calls)
		}
		out["window_seconds"] = int64(hl.Window.Seconds())
		out["calls"], out["failures"], out["throttled"] = hl.Calls, hl.Failures, hl.Throttled
		out["failure_rate"] = rate
		out["p50_ms"], out["p95_ms"] = hl.P50.Milliseconds(), hl.P95.Milliseconds()
		out["last_success_at"], out["last_failure_at"], out["last_failure"] = ts(hl.LastSuccessAt), ts(hl.LastFailureAt), hl.LastFailure
		out["status"] = healthStatus(hl)
	} else {
		out["status"] = "unknown" // the adapter records no telemetry
	}
	if wc, ok := svc.cfg.Store.(WebhookClock); ok {
		if at, found, err := wc.LastWebhookAt(c.Request.Context(), svc.cfg.Provider); err != nil {
			log.Printf("[crypto] webhook clock: %v", err)
		} else if found {
			out["webhook_last_received_at"] = ts(at)
			out["webhook_lag_seconds"] = int64(now.Sub(at).Seconds())
		}
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "health": out})
}

func (h *adminHandler) auditSearch(c *gin.Context) {
	if h.d.AuditLog == nil {
		fail(c, http.StatusServiceUnavailable, "audit_unavailable")
		return
	}
	q := AuditQuery{
		ActionPrefix: strings.TrimSpace(c.Query("action")), Actor: strings.TrimSpace(c.Query("actor")),
		EntityID: strings.TrimSpace(c.Query("entity_id")), Limit: auditDefaultLimit,
	}
	if len(q.ActionPrefix) > 100 || len(q.Actor) > 100 || len(q.EntityID) > 100 {
		fail(c, http.StatusBadRequest, "invalid_filter")
		return
	}
	if v := c.Query("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			fail(c, http.StatusBadRequest, "invalid_limit")
			return
		}
		q.Limit = min(n, auditMaxLimit)
	}
	if v := c.Query("before"); v != "" {
		t, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			fail(c, http.StatusBadRequest, "invalid_cursor")
			return
		}
		q.Before = t
	}
	rows, err := h.d.AuditLog.Search(c.Request.Context(), q)
	if err != nil {
		log.Printf("[crypto] audit search: %v", err)
		fail(c, http.StatusInternalServerError, "internal_error")
		return
	}
	resp := gin.H{"success": true, "entries": rows}
	if len(rows) == q.Limit { // more may exist: the client pages with before=<last created_at>
		resp["next_before"] = rows[len(rows)-1].CreatedAt.UTC().Format(time.RFC3339Nano)
	}
	c.JSON(http.StatusOK, resp)
}

// reconcileNow POST /admin/crypto/reconciler/run — one reconcile pass now. It only re-reads the
// provider and applies results through the normal settle path; it cannot edit a balance.
func (h *adminHandler) reconcileNow(c *gin.Context) {
	if h.d.Recon == nil {
		fail(c, http.StatusServiceUnavailable, "reconciler_not_running")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()
	res, err := h.d.Recon.RunOnce(ctx)
	h.d.Service.audit(ctx, ginutil.UserID(c), "crypto.reconciler.manual_run", "", "manual sync from admin", map[string]any{
		"resolved": res.Resolved, "released": res.Released, "parked": res.Parked, "expired": res.Expired, "errors": res.Errors,
	})
	if err != nil {
		log.Printf("[crypto] manual reconcile: %v", err)
		fail(c, http.StatusBadGateway, "reconcile_failed")
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "result": gin.H{
		"resolved": res.Resolved, "released": res.Released, "parked": res.Parked, "expired": res.Expired, "errors": res.Errors,
	}})
}

func (h *adminHandler) depositsList(c *gin.Context) {
	ds := h.d.Service.cfg.Deposits
	if ds == nil {
		fail(c, http.StatusServiceUnavailable, "deposits_unavailable")
		return
	}
	st := cryptoprov.DepositStatus(strings.TrimSpace(c.Query("status")))
	switch st {
	case "", cryptoprov.DepositPending, cryptoprov.DepositAccepted, cryptoprov.DepositRejected:
	default:
		fail(c, http.StatusBadRequest, "invalid_status")
		return
	}
	rows, err := ds.AdminListDeposits(c.Request.Context(), st, 200)
	if err != nil {
		if !errors.Is(err, context.Canceled) {
			log.Printf("[crypto] admin deposits: %v", err)
		}
		fail(c, http.StatusInternalServerError, "internal_error")
		return
	}
	out := make([]gin.H, 0, len(rows))
	for _, d := range rows {
		out = append(out, gin.H{
			"id": d.ProviderDepositID, "user_id": d.UserID, "asset": d.Currency, "network": d.Network, "amount": d.Amount.String(),
			"status": string(d.Status), "txid": d.TxID, "confirmations": d.Confirmations, "required_confirmations": d.RequiredConfirmations,
			"created_at": ts(d.CreatedAt), "updated_at": ts(d.UpdatedAt),
		})
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "deposits": out})
}
