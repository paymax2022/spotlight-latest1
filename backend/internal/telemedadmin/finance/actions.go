package finance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/ginutil"
)

// Admin finance decisions: payout approve/hold, dispute resolve, commission
// override upsert. None of them moves money — the doctor's ledger debit already
// happened when the payout was requested — they change workflow state only.
// Each one requires an Idempotency-Key, runs in one transaction with its audit row
// (doctor_compliance_audit), and replays the stored result for a repeated key.

const actionPrefix = "admin.finance."

const (
	ActionPayoutApprove    = actionPrefix + "payout.approve"
	ActionPayoutHold       = actionPrefix + "payout.hold"
	ActionDisputeResolve   = actionPrefix + "dispute.resolve"
	ActionCommissionUpdate = actionPrefix + "commission.update"
)

var (
	errConflict = errors.New("conflict")
	errKeyReuse = errors.New("idempotency key reused for a different request")
	errNoKey    = errors.New("Idempotency-Key header is required")
)

var payoutCycles = map[string]bool{"weekly": true, "biweekly": true, "monthly": true}

// ActionResult is what every finance action answers (and what a replay returns).
type ActionResult struct {
	Action   string    `json:"action"`
	EntityID string    `json:"entity_id"`
	Status   string    `json:"status"`
	AuditID  string    `json:"audit_id"`
	At       time.Time `json:"at"`
	Replayed bool      `json:"replayed"`
}

type CommissionUpdate struct {
	CommissionBps int    `json:"commission_bps"`
	VATBps        int    `json:"vat_bps"`
	PayoutCycle   string `json:"payout_cycle"`
}

// actor performs the mutations; actionStore implements it and tests fake it.
type actor interface {
	approvePayout(ctx context.Context, key, admin, id, note string) (ActionResult, error)
	holdPayout(ctx context.Context, key, admin, id, reason string) (ActionResult, error)
	resolveDispute(ctx context.Context, key, admin, id, outcome, note string) (ActionResult, error)
	updateCommission(ctx context.Context, key, admin, doctorUserID string, in CommissionUpdate) (ActionResult, error)
}

type beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

type actionStore struct{ db beginner }

type actionHandler struct{ act actor }

func registerActions(g *gin.RouterGroup, act actor, manage gin.HandlerFunc) {
	h := actionHandler{act: act}
	f := g.Group("/finance")
	f.POST("/payouts/:id/approve", manage, h.approve)
	f.POST("/payouts/:id/hold", manage, h.hold)
	f.POST("/disputes/:id/resolve", manage, h.resolve)
	f.PUT("/commission-config/:doctorUserId", manage, h.commission)
}

func failAction(c *gin.Context, err error) {
	switch {
	case errors.Is(err, errNoKey):
		c.JSON(http.StatusBadRequest, gin.H{"error": errNoKey.Error()})
	case errors.Is(err, errConflict):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, errKeyReuse):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": errKeyReuse.Error()})
	default:
		fail(c, err)
	}
}

func idemKey(c *gin.Context) (string, error) {
	k := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if len(k) < 8 || len(k) > 200 {
		return "", errNoKey
	}
	return k, nil
}

// prelude extracts the key, admin id and path uuid shared by every action.
func prelude(c *gin.Context, param string) (key, admin, id string, ok bool) {
	k, err := idemKey(c)
	if err != nil {
		failAction(c, err)
		return "", "", "", false
	}
	p, err := parseUUIDParam(c.Param(param))
	if err != nil || p == nil {
		fail(c, errBadParam)
		return "", "", "", false
	}
	a := ginutil.UserID(c)
	if a == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", "", "", false
	}
	return k, a, *p, true
}

func text(v string, max int) (string, bool) {
	v = strings.TrimSpace(v)
	return v, len(v) <= max
}

func (h actionHandler) approve(c *gin.Context) {
	key, admin, id, ok := prelude(c, "id")
	if !ok {
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	if c.Request.ContentLength > 0 && c.ShouldBindJSON(&body) != nil {
		fail(c, errBadParam)
		return
	}
	note, valid := text(body.Note, 1000)
	if !valid {
		fail(c, errBadParam)
		return
	}
	out, err := h.act.approvePayout(c.Request.Context(), key, admin, id, note)
	respond(c, out, err)
}

func (h actionHandler) hold(c *gin.Context) {
	key, admin, id, ok := prelude(c, "id")
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	if c.ShouldBindJSON(&body) != nil {
		fail(c, errBadParam)
		return
	}
	reason, valid := text(body.Reason, 1000)
	if !valid || reason == "" {
		fail(c, errBadParam)
		return
	}
	out, err := h.act.holdPayout(c.Request.Context(), key, admin, id, reason)
	respond(c, out, err)
}

func (h actionHandler) resolve(c *gin.Context) {
	key, admin, id, ok := prelude(c, "id")
	if !ok {
		return
	}
	var body struct {
		Outcome string `json:"outcome"`
		Note    string `json:"note"`
	}
	if c.ShouldBindJSON(&body) != nil {
		fail(c, errBadParam)
		return
	}
	note, valid := text(body.Note, 2000)
	if !valid || note == "" || (body.Outcome != "resolved" && body.Outcome != "rejected") {
		fail(c, errBadParam)
		return
	}
	out, err := h.act.resolveDispute(c.Request.Context(), key, admin, id, body.Outcome, note)
	respond(c, out, err)
}

func (h actionHandler) commission(c *gin.Context) {
	key, admin, doc, ok := prelude(c, "doctorUserId")
	if !ok {
		return
	}
	var in CommissionUpdate
	if c.ShouldBindJSON(&in) != nil || !validCommission(in) {
		fail(c, errBadParam)
		return
	}
	out, err := h.act.updateCommission(c.Request.Context(), key, admin, doc, in)
	respond(c, out, err)
}

func validCommission(in CommissionUpdate) bool {
	return in.CommissionBps >= 0 && in.CommissionBps <= 10000 &&
		in.VATBps >= 0 && in.VATBps <= 10000 && payoutCycles[in.PayoutCycle]
}

func respond(c *gin.Context, out ActionResult, err error) {
	if err != nil {
		failAction(c, err)
		return
	}
	ok(c, out)
}

// ── persistence ─────────────────────────────────────────────────────────────

// withAction serialises same-key requests (advisory xact lock), replays a stored
// result, otherwise runs fn and writes the audit row in the same transaction.
func (s actionStore) withAction(ctx context.Context, key, action, entityID string,
	fn func(tx pgx.Tx) (subjectUserID, entityType, status string, detail map[string]any, err error),
) (ActionResult, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return ActionResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, "telemed-admin-finance:"+key); err != nil {
		return ActionResult{}, fmt.Errorf("finance: idempotency lock: %w", err)
	}
	var prevAction, prevEntity, raw string
	err = tx.QueryRow(ctx, `
		SELECT action, COALESCE(entity_id, ''), detail->>'result'
		FROM doctor_compliance_audit
		WHERE idempotency_key = $1 AND action LIKE 'admin.finance.%'
		ORDER BY created_at LIMIT 1`, key).Scan(&prevAction, &prevEntity, &raw)
	switch {
	case err == nil:
		if prevAction != action || prevEntity != entityID {
			return ActionResult{}, errKeyReuse
		}
		var out ActionResult
		if err := json.Unmarshal([]byte(raw), &out); err != nil {
			return ActionResult{}, fmt.Errorf("finance: decode replay: %w", err)
		}
		out.Replayed = true
		return out, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return ActionResult{}, fmt.Errorf("finance: idempotency lookup: %w", err)
	}

	subject, entityType, status, detail, err := fn(tx)
	if err != nil {
		return ActionResult{}, err
	}
	out := ActionResult{Action: action, EntityID: entityID, Status: status, At: time.Now().UTC()}
	if err := tx.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&out.AuditID); err != nil {
		return ActionResult{}, err
	}
	res, _ := json.Marshal(out)
	detail["result"] = string(res)
	b, err := json.Marshal(detail)
	if err != nil {
		return ActionResult{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO doctor_compliance_audit (id, user_id, action, entity_type, entity_id, detail, idempotency_key)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)`,
		out.AuditID, subject, action, entityType, entityID, b, key); err != nil {
		return ActionResult{}, fmt.Errorf("finance: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return ActionResult{}, err
	}
	return out, nil
}

// lockPayout row-locks the payout and returns its owner, status and hold marker.
func lockPayout(ctx context.Context, tx pgx.Tx, id string) (userID, status string, held bool, err error) {
	err = tx.QueryRow(ctx, `SELECT user_id::text, status, held_at IS NOT NULL
		FROM doctor_payouts WHERE id = $1::uuid FOR UPDATE`, id).Scan(&userID, &status, &held)
	if errors.Is(err, pgx.ErrNoRows) {
		err = errNotFound
	}
	return userID, status, held, err
}

func (s actionStore) approvePayout(ctx context.Context, key, admin, id, note string) (ActionResult, error) {
	return s.withAction(ctx, key, ActionPayoutApprove, id, func(tx pgx.Tx) (string, string, string, map[string]any, error) {
		user, status, held, err := lockPayout(ctx, tx, id)
		if err != nil {
			return "", "", "", nil, err
		}
		if status != "pending" {
			return "", "", "", nil, fmt.Errorf("%w: payout is %s, only pending payouts can be approved", errConflict, status)
		}
		if _, err := tx.Exec(ctx, `UPDATE doctor_payouts
			SET status = 'processing', approved_at = now(), approved_by = $2::uuid,
			    held_at = NULL, hold_reason = NULL, updated_at = now()
			WHERE id = $1::uuid`, id, admin); err != nil {
			return "", "", "", nil, fmt.Errorf("finance: approve payout: %w", err)
		}
		return user, "doctor_payout", "processing",
			map[string]any{"actor": admin, "previous_status": status, "was_held": held, "note": note}, nil
	})
}

func (s actionStore) holdPayout(ctx context.Context, key, admin, id, reason string) (ActionResult, error) {
	return s.withAction(ctx, key, ActionPayoutHold, id, func(tx pgx.Tx) (string, string, string, map[string]any, error) {
		user, status, held, err := lockPayout(ctx, tx, id)
		if err != nil {
			return "", "", "", nil, err
		}
		if status != "pending" {
			return "", "", "", nil, fmt.Errorf("%w: payout is %s, only pending payouts can be held", errConflict, status)
		}
		if held {
			return "", "", "", nil, fmt.Errorf("%w: payout is already on hold", errConflict)
		}
		if _, err := tx.Exec(ctx, `UPDATE doctor_payouts
			SET held_at = now(), hold_reason = $2, updated_at = now() WHERE id = $1::uuid`, id, reason); err != nil {
			return "", "", "", nil, fmt.Errorf("finance: hold payout: %w", err)
		}
		return user, "doctor_payout", "pending", map[string]any{"actor": admin, "reason": reason}, nil
	})
}

func (s actionStore) resolveDispute(ctx context.Context, key, admin, id, outcome, note string) (ActionResult, error) {
	return s.withAction(ctx, key, ActionDisputeResolve, id, func(tx pgx.Tx) (string, string, string, map[string]any, error) {
		var user, status string
		err := tx.QueryRow(ctx, `SELECT user_id::text, status FROM doctor_settlement_disputes
			WHERE id = $1::uuid FOR UPDATE`, id).Scan(&user, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", "", nil, errNotFound
		}
		if err != nil {
			return "", "", "", nil, fmt.Errorf("finance: lock dispute: %w", err)
		}
		if status != "open" {
			return "", "", "", nil, fmt.Errorf("%w: dispute is %s, only open disputes can be resolved", errConflict, status)
		}
		resolution, _ := json.Marshal(map[string]any{"outcome": outcome, "note": note, "by": admin, "at": time.Now().UTC()})
		if _, err := tx.Exec(ctx, `UPDATE doctor_settlement_disputes
			SET status = $2, detail = detail || jsonb_build_object('resolution', $3::jsonb), updated_at = now()
			WHERE id = $1::uuid`, id, outcome, string(resolution)); err != nil {
			return "", "", "", nil, fmt.Errorf("finance: resolve dispute: %w", err)
		}
		return user, "doctor_settlement_dispute", outcome,
			map[string]any{"actor": admin, "previous_status": status, "outcome": outcome, "note": note}, nil
	})
}

func (s actionStore) updateCommission(ctx context.Context, key, admin, doc string, in CommissionUpdate) (ActionResult, error) {
	return s.withAction(ctx, key, ActionCommissionUpdate, doc, func(tx pgx.Tx) (string, string, string, map[string]any, error) {
		var isDoctor bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM doctors WHERE user_id = $1::uuid)`, doc).Scan(&isDoctor); err != nil {
			return "", "", "", nil, fmt.Errorf("finance: doctor lookup: %w", err)
		}
		if !isDoctor {
			return "", "", "", nil, errNotFound
		}
		prev := map[string]any{}
		var pc, pv int
		var pcy string
		err := tx.QueryRow(ctx, `SELECT commission_bps, vat_bps, payout_cycle FROM doctor_commission_config
			WHERE user_id = $1::uuid FOR UPDATE`, doc).Scan(&pc, &pv, &pcy)
		switch {
		case err == nil:
			prev = map[string]any{"commission_bps": pc, "vat_bps": pv, "payout_cycle": pcy}
		case !errors.Is(err, pgx.ErrNoRows):
			return "", "", "", nil, fmt.Errorf("finance: read commission: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO doctor_commission_config (user_id, commission_bps, vat_bps, payout_cycle)
			VALUES ($1::uuid, $2, $3, $4)
			ON CONFLICT (user_id) DO UPDATE
			SET commission_bps = EXCLUDED.commission_bps, vat_bps = EXCLUDED.vat_bps,
			    payout_cycle = EXCLUDED.payout_cycle, updated_at = now()`,
			doc, in.CommissionBps, in.VATBps, in.PayoutCycle); err != nil {
			return "", "", "", nil, fmt.Errorf("finance: upsert commission: %w", err)
		}
		return doc, "doctor_commission_config", "updated", map[string]any{
			"actor": admin, "previous": prev,
			"next": map[string]any{"commission_bps": in.CommissionBps, "vat_bps": in.VATBps, "payout_cycle": in.PayoutCycle},
		}, nil
	})
}
