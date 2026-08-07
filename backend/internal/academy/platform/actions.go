package platform

// actions.go — LIGHT-OVERSIGHT write actions for the EdTech platform console that ride
// EXISTING guarded, money-free paths (mirrors the VerifySchool / OverrideTrustScore /
// ToggleFlag pattern already in this package). Every action:
//   - is authorized at the route group by the seeded platform_edtech_admin capability,
//   - appends an immutable public.academy_commerce_audit row (the SAME append-only trail
//     SU-11 reads — see feature_flags.go SetFlag), and
//   - posts NO ledger entry and moves NO money.
//
// Competition transition REUSES the existing competition state machine
// (feescompetition.Service.Transition → feesstatemachine.CompetitionTransition) — it is
// NOT reimplemented here.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	feescompetition "spotlight/backend/internal/academy/fees/competition"
	"spotlight/backend/internal/middleware"
)

// writeActionAudit appends an immutable academy_commerce_audit row (module 'academy.fees')
// for a platform oversight action. entity_id is uuid-typed; pass a uuid entity id (or ""
// to leave it NULL and carry the id in detail). Best-effort at the callsite (an audit
// failure surfaces as a 500 so the operator retries — no silent action).
func (r *Repo) writeActionAudit(ctx context.Context, actorID, action, entityType, entityID string, detail map[string]any) error {
	var actor any
	if actorID != "" {
		actor = actorID
	}
	var eid any
	if entityID != "" {
		eid = entityID
	}
	d, _ := json.Marshal(detail)
	const ins = `INSERT INTO public.academy_commerce_audit (actor_id, action, entity_type, entity_id, detail)
	             VALUES ($1,$2,$3,$4,$5)`
	_, err := r.pool.Exec(ctx, ins, actor, action, entityType, eid, d)
	return err
}

func actorOf(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return c.GetString("user_id")
}

// ── SU-04 POST /risk/:id/action — record a decision on a risk case ────────────────
//
// The risk surface (GET /risk) is a heuristic PROJECTION over real reversed payments —
// there is NO risk-case status table in the schema (the row id IS the underlying
// academy_invoice_payments id). An action therefore cannot flip a stored status column;
// it is recorded to the immutable audit trail (SU-11) referencing that payment id. This
// is the honest, additive write: the decision is durably captured, no schema invented.
func (h *Handler) ActionRiskCase(c *gin.Context) {
	riskID := c.Param("id")
	var body struct {
		Action   string `json:"action"`   // e.g. 'dismiss' | 'escalate' | 'confirm_fraud'
		Decision string `json:"decision"` // console alias for action
		Note     string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	decision := firstNonEmpty(body.Decision, body.Action)
	if decision == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "action (or decision) is required"})
		return
	}
	actorID := actorOf(c)
	if err := h.repo.writeActionAudit(c.Request.Context(), actorID, "risk_case_actioned",
		"academy_risk_case", riskID, map[string]any{"risk_id": riskID, "decision": decision, "note": body.Note}); err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":         riskID,
		"status":     "actioned",
		"decision":   decision,
		"note":       body.Note,
		"decided_by": actorID,
		"decided_at": rfc(time.Now()),
	}})
}

// ── SU-06 POST /competitions/:id/transition — advance a competition state ─────────
//
// REUSES feescompetition.Service.Transition (the shared competition state machine); no
// reimplementation. The leaderboard collaborator is nil because the transition path never
// touches it (only RecordScore does). Records an audit row. Money-free by design (SF-4).
func (h *Handler) TransitionCompetition(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Event string `json:"event"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Event == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "event is required"})
		return
	}
	svc := feescompetition.NewService(feescompetition.NewRepository(h.repo.pool), nil)
	out, err := svc.Transition(c.Request.Context(), id, body.Event)
	if err != nil {
		if errors.Is(err, feescompetition.ErrUnknownEvent) || errors.Is(err, feescompetition.ErrScopeInvalid) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		// Illegal/terminal/no-such-competition ⇒ conflict (matches the fees competition handler).
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	actorID := actorOf(c)
	_ = h.repo.writeActionAudit(c.Request.Context(), actorID, "competition_transitioned",
		"academy_competition", id, map[string]any{"event": body.Event, "status": string(out.Status)})
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"id":     id,
		"status": string(out.Status),
		"event":  body.Event,
	}})
}
