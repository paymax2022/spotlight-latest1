package connectmoderation

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	connectsafety "spotlight/backend/internal/connect/safety"
)

// validConvStates mirror connect_conversations.safety_state CHECK.
var validConvStates = map[string]bool{
	"open": true, "flagged": true, "under_review": true, "restricted": true, "closed": true,
}

// Service powers the admin moderation queues + decision log. All entry points
// are admin-only (RBAC enforced at the route layer); every state change is audited.
type Service struct {
	db     *pgxpool.Pool
	safety *connectsafety.Service
}

// NewService wires moderation over the pool + safety audit backbone.
func NewService(db *pgxpool.Pool, safety *connectsafety.Service) *Service {
	return &Service{db: db, safety: safety}
}

// ListFlaggedConversations returns conversations needing moderator attention,
// newest activity first.
func (s *Service) ListFlaggedConversations(ctx context.Context, limit int) ([]FlaggedConversation, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, match_id, safety_state, flag_count, updated_at
		FROM connect_conversations
		WHERE safety_state IN ('flagged','under_review','restricted')
		ORDER BY updated_at DESC LIMIT $1`
	rows, err := s.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list flagged conversations: %w", err)
	}
	defer rows.Close()
	var out []FlaggedConversation
	for rows.Next() {
		var f FlaggedConversation
		if err := rows.Scan(&f.ID, &f.MatchID, &f.SafetyState, &f.FlagCount, &f.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ListFlaggedMessages returns flagged messages (optionally for one conversation),
// with their stored reason codes, for moderator review.
func (s *Service) ListFlaggedMessages(ctx context.Context, conversationID string, limit int) ([]FlaggedMessage, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, conversation_id, sender_id, reason_codes, created_at
		FROM connect_messages
		WHERE flagged = true AND ($1 = '' OR conversation_id = NULLIF($1,'')::uuid)
		ORDER BY created_at DESC LIMIT $2`
	rows, err := s.db.Query(ctx, q, conversationID, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list flagged messages: %w", err)
	}
	defer rows.Close()
	var out []FlaggedMessage
	for rows.Next() {
		var m FlaggedMessage
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.ReasonCodes, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// RecordDecision appends a moderation decision (reason codes stored, invariant 8)
// and audits it, in one tx so a decision always carries an audit trail.
func (s *Service) RecordDecision(ctx context.Context, adminID string, req DecisionRequest) (*Decision, error) {
	if !ValidTargetType(req.TargetType) {
		return nil, fmt.Errorf("connect: invalid target type %q", req.TargetType)
	}
	if !ValidDecision(req.Decision) {
		return nil, fmt.Errorf("connect: invalid decision %q", req.Decision)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const ins = `INSERT INTO connect_moderation_decisions
		(target_type, target_id, decision, reason_codes, reviewer_id, case_id)
		VALUES ($1, $2, $3, $4, $5::uuid, NULLIF($6,'')::uuid)
		RETURNING id, target_type, target_id, decision, reason_codes, model, reviewer_id, case_id, created_at`
	var d Decision
	if err := tx.QueryRow(ctx, ins, req.TargetType, req.TargetID, req.Decision,
		req.ReasonCodes, adminID, req.CaseID).Scan(
		&d.ID, &d.TargetType, &d.TargetID, &d.Decision, &d.ReasonCodes,
		&d.Model, &d.ReviewerID, &d.CaseID, &d.CreatedAt); err != nil {
		return nil, fmt.Errorf("connect: insert decision: %w", err)
	}

	if err := writeAuditTx(ctx, tx, adminID, "connect.moderation.decision", req.TargetType, req.TargetID,
		map[string]any{"decision": req.Decision, "reason_codes": req.ReasonCodes}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit decision: %w", err)
	}
	return &d, nil
}

// SetConversationState transitions a conversation's safety state (admin action),
// recording an audit entry. Used to restrict/close a flagged conversation.
func (s *Service) SetConversationState(ctx context.Context, adminID, convID string, req ConvActionRequest) error {
	if !validConvStates[req.SafetyState] {
		return fmt.Errorf("connect: invalid safety state %q", req.SafetyState)
	}
	const upd = `UPDATE connect_conversations SET safety_state = $2 WHERE id = $1::uuid`
	tag, err := s.db.Exec(ctx, upd, convID, req.SafetyState)
	if err != nil {
		return fmt.Errorf("connect: set conversation state: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("connect: conversation not found")
	}
	return s.safety.WriteAudit(ctx, connectsafety.AuditInput{
		ActorID:    adminID,
		ActorRole:  "admin",
		Action:     "connect.moderation.conversation_state",
		EntityType: "connect_conversation",
		EntityID:   convID,
		Reason:     req.Reason,
		NewValue:   map[string]any{"safety_state": req.SafetyState},
	})
}

// ListDecisions returns recent moderation decisions for an audit trail view.
func (s *Service) ListDecisions(ctx context.Context, limit int) ([]Decision, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, target_type, target_id, decision, reason_codes, model, reviewer_id, case_id, created_at
		FROM connect_moderation_decisions ORDER BY created_at DESC LIMIT $1`
	rows, err := s.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list decisions: %w", err)
	}
	defer rows.Close()
	var out []Decision
	for rows.Next() {
		var d Decision
		if err := rows.Scan(&d.ID, &d.TargetType, &d.TargetID, &d.Decision, &d.ReasonCodes,
			&d.Model, &d.ReviewerID, &d.CaseID, &d.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// txExecer is satisfied by pgx.Tx so the audit write joins the decision's tx.
type txExecer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// writeAuditTx appends to connect_audit_log inside the caller's transaction, so
// a moderation decision and its audit entry commit atomically (never one without
// the other). Mirrors the insert the safety service performs.
func writeAuditTx(ctx context.Context, q txExecer, adminID, action, entityType, entityID string, newVal map[string]any) error {
	raw, _ := json.Marshal(newVal)
	const ins = `INSERT INTO connect_audit_log
		(actor_id, actor_role, action, entity_type, entity_id, new_value)
		VALUES (NULLIF($1,'')::uuid, 'admin', $2, $3, $4, $5::jsonb)`
	if _, err := q.Exec(ctx, ins, adminID, action, entityType, entityID, string(raw)); err != nil {
		return fmt.Errorf("connect: write moderation audit: %w", err)
	}
	return nil
}
