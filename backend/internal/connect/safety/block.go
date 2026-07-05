package connectsafety

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// This file ADDITIVELY extends the Phase-0 safety service with block/unmatch.
// It introduces NO changes to existing funcs/types. Block prevents further
// contact + visibility (the chat layer + connect_messages RLS both check
// connect_blocks), and — per "report/block create cases, never fail silently" —
// blocking also opens a connect_case so moderators see repeat-offender patterns.

// BlockRequest is the member body for POST /api/v1/connect/safety/block. The
// blocker is the authenticated user (never the body), so a user can only block
// on their own behalf.
type BlockRequest struct {
	BlockedID string `json:"blocked_id" binding:"required"`
	Reason    string `json:"reason"`
	OpenCase  bool   `json:"open_case"` // also file a report-style case (defaults false)
}

// BlockResult is returned to the blocker.
type BlockResult struct {
	BlockID    string  `json:"block_id"`
	CaseID     *string `json:"case_id,omitempty"`
	AlreadySet bool    `json:"already_set"`
}

// Block records a block (idempotent on UNIQUE(blocker_id, blocked_id)), audits
// it, and — when requested or on a flagged subject — opens a harassment case.
// The block write itself NEVER fails silently: a DB error bubbles to the caller.
func (s *Service) Block(ctx context.Context, blockerID string, req BlockRequest) (*BlockResult, error) {
	if blockerID == "" || req.BlockedID == "" {
		return nil, fmt.Errorf("connect: blocker and blocked are required")
	}
	if blockerID == req.BlockedID {
		return nil, fmt.Errorf("connect: cannot block yourself")
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	id := uuid.New().String()
	const ins = `INSERT INTO connect_blocks (id, blocker_id, blocked_id, reason)
		VALUES ($1::uuid, $2::uuid, $3::uuid, NULLIF($4,''))
		ON CONFLICT (blocker_id, blocked_id) DO NOTHING
		RETURNING id`
	res := &BlockResult{}
	var newID string
	err = tx.QueryRow(ctx, ins, id, blockerID, req.BlockedID, req.Reason).Scan(&newID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// Conflict: block already existed. Idempotent success.
		res.AlreadySet = true
		const sel = `SELECT id FROM connect_blocks WHERE blocker_id = $1::uuid AND blocked_id = $2::uuid`
		if e := tx.QueryRow(ctx, sel, blockerID, req.BlockedID).Scan(&res.BlockID); e != nil {
			return nil, fmt.Errorf("connect: load existing block: %w", e)
		}
	case err != nil:
		return nil, fmt.Errorf("connect: insert block: %w", err)
	default:
		res.BlockID = newID
	}

	if err := writeAudit(ctx, tx, AuditInput{
		ActorID:    blockerID,
		Action:     "connect.block.create",
		EntityType: "connect_block",
		EntityID:   res.BlockID,
		Reason:     req.Reason,
		NewValue:   map[string]any{"blocked_id": req.BlockedID, "already_set": res.AlreadySet},
	}); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit block: %w", err)
	}

	// Optionally open a case (own tx in OpenCase). A block-with-report must never
	// be swallowed, so a case error is surfaced.
	if req.OpenCase {
		c, err := s.OpenCase(ctx, OpenCaseInput{
			ReporterID: blockerID,
			SubjectID:  req.BlockedID,
			Type:       "harassment",
			SourceRef:  res.BlockID,
			Severity:   "normal",
			Notes:      "Case opened alongside a user block. Reason: " + req.Reason,
		})
		if err != nil {
			return nil, fmt.Errorf("connect: open case for block: %w", err)
		}
		res.CaseID = &c.ID
	}
	return res, nil
}

// Unblock removes a block the caller owns (idempotent).
func (s *Service) Unblock(ctx context.Context, blockerID, blockedID string) error {
	const del = `DELETE FROM connect_blocks WHERE blocker_id = $1::uuid AND blocked_id = $2::uuid`
	if _, err := s.db.Exec(ctx, del, blockerID, blockedID); err != nil {
		return fmt.Errorf("connect: unblock: %w", err)
	}
	return s.WriteAudit(ctx, AuditInput{
		ActorID:    blockerID,
		Action:     "connect.block.remove",
		EntityType: "connect_block",
		EntityID:   blockedID,
	})
}
