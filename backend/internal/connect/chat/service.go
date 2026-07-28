package connectchat

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	connectsafety "spotlight/backend/internal/connect/safety"
	connecttrust "spotlight/backend/internal/connect/trust"
)

// Service owns the chat state machine. The single hard rule it enforces:
// a message can only be sent/read inside a conversation backed by a MUTUAL,
// ACTIVE match where the caller is a participant — checked server-side here AND
// re-asserted by the connect_messages RLS insert policy as a DB backstop.
type Service struct {
	db     *pgxpool.Pool
	cfg    *connecttrust.ConfigReader
	shield *connecttrust.ShieldStore
	safety *connectsafety.Service
}

// NewService wires chat over the pool, the trust config reader + scam-shield,
// and the Phase-0 safety service (audit/case backbone).
func NewService(db *pgxpool.Pool, cfg *connecttrust.ConfigReader, shield *connecttrust.ShieldStore, safety *connectsafety.Service) *Service {
	return &Service{db: db, cfg: cfg, shield: shield, safety: safety}
}

// participantMatch is the result of the authoritative match check.
type participantMatch struct {
	convID    string
	matchID   string
	otherUser string
	state     string
}

// resolveConversation returns the conversation for a match ONLY if the caller is
// a participant of an active mutual match and no block exists. It lazily creates
// the conversation row the first time a matched pair opens chat. This is the
// server-side enforcement of "chat only after match".
//
// Sibling-owned schema (verified against 20260702000000_connect_phase1_core.sql):
//   connect_matches(id, profile_a, profile_b, status, ...)   profile_* → connect_profiles.id
//   connect_profiles(id, user_id UNIQUE → auth.users)
// So an auth user_id maps to a participant by joining through connect_profiles.
// `status='matched'` means mutual. Queried defensively — a missing/renamed column
// errors loudly rather than leaking access.
func (s *Service) resolveConversationByMatch(ctx context.Context, q querier, matchID, userID string) (*participantMatch, error) {
	// me_uid / other_uid are the auth user ids of the two participants.
	const matchQ = `SELECT m.id, m.status, pme.user_id, poth.user_id
		FROM connect_matches m
		JOIN connect_profiles pme  ON pme.id IN (m.profile_a, m.profile_b) AND pme.user_id = $2::uuid
		JOIN connect_profiles poth ON poth.id IN (m.profile_a, m.profile_b) AND poth.id <> pme.id
		WHERE m.id = $1::uuid`
	var id, status, me, other string
	if err := q.QueryRow(ctx, matchQ, matchID, userID).Scan(&id, &status, &me, &other); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoMatch // not found OR caller is not a participant
		}
		return nil, fmt.Errorf("connect: load match: %w", err)
	}
	if status != "matched" {
		return nil, ErrNoMatch
	}
	if blocked, err := s.blockExists(ctx, q, me, other); err != nil {
		return nil, err
	} else if blocked {
		return nil, ErrBlocked
	}
	pm := &participantMatch{matchID: id, otherUser: other, state: StateOpen}

	// Ensure a conversation row exists for this match (idempotent on match_id UNIQUE).
	const upsert = `INSERT INTO connect_conversations (match_id) VALUES ($1::uuid)
		ON CONFLICT (match_id) DO UPDATE SET match_id = EXCLUDED.match_id
		RETURNING id, safety_state`
	if err := q.QueryRow(ctx, upsert, matchID).Scan(&pm.convID, &pm.state); err != nil {
		return nil, fmt.Errorf("connect: ensure conversation: %w", err)
	}
	return pm, nil
}

// resolveConversationByID loads a conversation and authorizes the caller as a
// participant of its (mutual, active) match. Used by list/send when the client
// holds a conversation id.
func (s *Service) resolveConversationByID(ctx context.Context, q querier, convID, userID string) (*participantMatch, error) {
	const cq = `SELECT c.id, c.match_id, c.safety_state, m.status, pme.user_id, poth.user_id
		FROM connect_conversations c
		JOIN connect_matches m     ON m.id = c.match_id
		JOIN connect_profiles pme  ON pme.id IN (m.profile_a, m.profile_b) AND pme.user_id = $2::uuid
		JOIN connect_profiles poth ON poth.id IN (m.profile_a, m.profile_b) AND poth.id <> pme.id
		WHERE c.id = $1::uuid`
	var pm participantMatch
	var status, me, other string
	if err := q.QueryRow(ctx, cq, convID, userID).Scan(&pm.convID, &pm.matchID, &pm.state, &status, &me, &other); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoMatch // not found OR caller is not a participant
		}
		return nil, fmt.Errorf("connect: load conversation: %w", err)
	}
	if status != "matched" {
		return nil, ErrNoMatch
	}
	if blocked, err := s.blockExists(ctx, q, me, other); err != nil {
		return nil, err
	} else if blocked {
		return nil, ErrBlocked
	}
	pm.otherUser = other
	return &pm, nil
}

func (s *Service) blockExists(ctx context.Context, q querier, a, b string) (bool, error) {
	const bq = `SELECT EXISTS (SELECT 1 FROM connect_blocks
		WHERE (blocker_id = $1::uuid AND blocked_id = $2::uuid)
		   OR (blocker_id = $2::uuid AND blocked_id = $1::uuid))`
	var exists bool
	if err := q.QueryRow(ctx, bq, a, b).Scan(&exists); err != nil {
		return false, fmt.Errorf("connect: block check: %w", err)
	}
	return exists, nil
}

// OpenConversation returns (creating if needed) the conversation for a match,
// enforcing the mutual-match rule. Exposed so the client can fetch a conv id.
func (s *Service) OpenConversation(ctx context.Context, matchID, userID string) (string, string, error) {
	pm, err := s.resolveConversationByMatch(ctx, s.db, matchID, userID)
	if err != nil {
		return "", "", err
	}
	return pm.convID, pm.state, nil
}

// ListMessages returns messages for a conversation the caller participates in.
func (s *Service) ListMessages(ctx context.Context, convID, userID string, limit int) ([]Message, error) {
	if _, err := s.resolveConversationByID(ctx, s.db, convID, userID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, conversation_id, sender_id, body, kind, flagged, reason_codes, created_at
		FROM connect_messages WHERE conversation_id = $1::uuid ORDER BY created_at ASC LIMIT $2`
	rows, err := s.db.Query(ctx, q, convID, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list messages: %w", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.Kind,
			&m.Flagged, &m.ReasonCodes, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SendMessage is the guarded write path. It (1) authorizes the caller as a
// participant of an active mutual match, (2) rejects closed/restricted
// conversations, (3) runs the inline safety detection, (4) persists the message
// (flagged or not), (5) records a scam-shield flag + routes the conversation to
// moderation when flagged. Steps 1-4 are transactional; the shield step opens a
// case via its own tx so a flag is never lost.
func (s *Service) SendMessage(ctx context.Context, convID, userID string, req SendMessageRequest) (*SendResult, error) {
	kind := req.Kind
	if kind == "" {
		kind = "text"
	}
	if !ValidMessageKind(kind) {
		return nil, fmt.Errorf("connect: invalid message kind %q", kind)
	}

	thresholds, _ := s.cfg.Load(ctx) // detection fails OPEN (no warning) on cfg miss

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	pm, err := s.resolveConversationByID(ctx, tx, convID, userID)
	if err != nil {
		return nil, err
	}
	if pm.state != StateOpen {
		return nil, ErrConversationClosed
	}

	// Inline safety hook (deterministic, no PII logged).
	det := connecttrust.Scan(req.Body, thresholds)

	const ins = `INSERT INTO connect_messages
		(conversation_id, sender_id, body, kind, flagged, reason_codes)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
		RETURNING id, conversation_id, sender_id, body, kind, flagged, reason_codes, created_at`
	var m Message
	if err := tx.QueryRow(ctx, ins, convID, userID, req.Body, kind, det.Flagged, det.ReasonCodes).Scan(
		&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &m.Kind, &m.Flagged, &m.ReasonCodes, &m.CreatedAt,
	); err != nil {
		return nil, fmt.Errorf("connect: insert message: %w", err)
	}

	// On a flag, move the conversation to 'flagged' and bump flag_count so the
	// moderation queue sees it. State transition is part of the same tx.
	if det.Flagged {
		const flagConv = `UPDATE connect_conversations
			SET safety_state = CASE WHEN safety_state = 'open' THEN 'flagged' ELSE safety_state END,
			    flag_count = flag_count + 1
			WHERE id = $1::uuid`
		if _, err := tx.Exec(ctx, flagConv, convID); err != nil {
			return nil, fmt.Errorf("connect: flag conversation: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit message: %w", err)
	}

	res := &SendResult{Message: m, Flagged: det.Flagged}

	// Post-commit: record the scam-shield flag (reason codes for moderators) and
	// let it open a case / escalate per config. A shield error is surfaced — a
	// flagged message must never be silently un-routed.
	if det.Flagged {
		res.Warning = det.Warning
		fr, err := s.shield.Flag(ctx, connecttrust.FlagInput{
			ConversationID: convID,
			MessageID:      m.ID,
			SubjectID:      userID,
			Category:       det.PrimaryCategory(),
			ReasonCodes:    det.ReasonCodes,
			Score:          det.Score,
		})
		if err != nil {
			return nil, fmt.Errorf("connect: route flagged message to moderation: %w", err)
		}
		res.Escalated = fr.Escalate || fr.CaseOpened
		if fr.Escalate {
			_, _ = s.db.Exec(ctx,
				`UPDATE connect_conversations SET safety_state = 'under_review'
				 WHERE id = $1::uuid AND safety_state IN ('open','flagged')`, convID)
		}
		_ = s.safety.WriteAudit(ctx, connectsafety.AuditInput{
			ActorID:    userID,
			Action:     "connect.chat.message_flagged",
			EntityType: "connect_conversation",
			EntityID:   convID,
			NewValue:   map[string]any{"reason_codes": det.ReasonCodes, "case_opened": fr.CaseOpened},
		})
	}
	return res, nil
}

// querier abstracts *pgxpool.Pool and pgx.Tx so the same resolver runs in or out
// of a transaction.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}
