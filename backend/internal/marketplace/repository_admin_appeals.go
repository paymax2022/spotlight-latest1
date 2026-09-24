package marketplace

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// repository_admin_appeals.go — pgx data layer for mkt_appeals (MKT-007
// Appeals). Status/vocab mirrors frontend-admin/src/types/marketplaceAdmin.ts
// MktAppealStatus ('opened'|'under_review'|'decided'|'executed'|'closed').

const appealCols = `id, market_id, appellant_id, target_type, target_id,
	original_action, original_reason_code, appellant_note, status, decision,
	decision_notes, decided_by, decided_at, second_approver_id, second_approved_at,
	requires_dual_approval, executed_at, created_at, updated_at`

func scanAppeal(row pgx.Row) (*Appeal, error) {
	var a Appeal
	if err := row.Scan(
		&a.ID, &a.MarketID, &a.AppellantID, &a.TargetType, &a.TargetID,
		&a.OriginalAction, &a.OriginalReasonCode, &a.AppellantNote, &a.Status, &a.Decision,
		&a.DecisionNotes, &a.DecidedBy, &a.DecidedAt, &a.SecondApproverID, &a.SecondApprovedAt,
		&a.RequiresDualApproval, &a.ExecutedAt, &a.CreatedAt, &a.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &a, nil
}

// InsertAppeal creates a new appeal in 'opened'. Member-facing (POST /appeals)
// and admin-on-behalf-of-member both call this.
func (r *Repository) InsertAppeal(ctx context.Context, marketID, appellantID, targetType, targetID, originalAction, originalReasonCode, appellantNote string) (*Appeal, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_appeals
			(market_id, appellant_id, target_type, target_id, original_action, original_reason_code, appellant_note)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING `+appealCols,
		marketID, appellantID, targetType, targetID, originalAction, originalReasonCode, appellantNote)
	a, err := scanAppeal(row)
	if err != nil {
		return nil, wrapInternal("insert appeal", err)
	}
	return a, nil
}

// GetAppeal loads one appeal by id.
func (r *Repository) GetAppeal(ctx context.Context, id string) (*Appeal, error) {
	row := r.db.QueryRow(ctx, `SELECT `+appealCols+` FROM public.mkt_appeals WHERE id=$1`, id)
	a, err := scanAppeal(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAppealNotFound
		}
		return nil, wrapInternal("get appeal", err)
	}
	return a, nil
}

// ListAppeals filters by status (optional).
func (r *Repository) ListAppeals(ctx context.Context, marketID, status string, limit, offset int) ([]Appeal, error) {
	limit = clampLimit(limit)
	q := `SELECT ` + appealCols + ` FROM public.mkt_appeals WHERE market_id = $1`
	args := []any{marketID}
	if status != "" {
		q += ` AND status = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`
		args = append(args, status, limit, offset)
	} else {
		q += ` ORDER BY created_at DESC LIMIT $2 OFFSET $3`
		args = append(args, limit, offset)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, wrapInternal("list appeals", err)
	}
	defer rows.Close()
	var out []Appeal
	for rows.Next() {
		a, err := scanAppeal(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// SetAppealStatus is the plain status PATCH (opened/under_review/closed — no
// decision content), used by PATCH /admin/appeals/:id/status.
func (r *Repository) SetAppealStatus(ctx context.Context, id, status string) (*Appeal, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_appeals SET status=$2, updated_at=now() WHERE id=$1
		RETURNING `+appealCols, id, status)
	a, err := scanAppeal(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAppealNotFound
		}
		return nil, wrapInternal("set appeal status", err)
	}
	return a, nil
}

// ProposeAppealDecision is the maker step: records the proposed decision.
// - decision='overturned': dual approval REQUIRED — status -> 'decided',
//   requires_dual_approval=true, nothing executes yet (the overturn only takes
//   effect once a different admin approves — see ApproveAppealDecision).
// - decision='upheld': single-admin, executes IMMEDIATELY — status -> 'executed'
//   directly, since upholding denies the appeal and nothing new is applied to
//   the account/listing (the original action already stands). See migration
//   comment + PR notes for the reasoning.
func (r *Repository) ProposeAppealDecision(ctx context.Context, id, decision, reasonCode, notes, decidedBy string) (*Appeal, error) {
	requiresDual := decision == "overturned"
	nextStatus := "decided"
	executedAtClause := "NULL"
	if !requiresDual {
		nextStatus = "executed"
		executedAtClause = "now()"
	}
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_appeals SET
			decision = $2,
			decision_notes = $3,
			decided_by = $4,
			decided_at = now(),
			status = $5,
			requires_dual_approval = $6,
			second_approver_id = NULL,
			second_approved_at = NULL,
			executed_at = `+executedAtClause+`,
			updated_at = now()
		WHERE id = $1 AND status IN ('opened','under_review')
		RETURNING `+appealCols, id, decision, nullStr(&notes), decidedBy, nextStatus, requiresDual)
	a, err := scanAppeal(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrConflict
		}
		return nil, wrapInternal("propose appeal decision", err)
	}
	_ = reasonCode // the appeal's own reason_code lives in original_reason_code (set at filing); the decision's justification is decision_notes
	return a, nil
}

// ApproveAppealDecision is the checker step: finalizes an 'overturned' decision
// to 'executed' and stamps second_approver_id. Only callable on a 'decided'
// appeal (requires_dual_approval=true implied — ProposeAppealDecision never sets
// status='decided' for an 'upheld' decision). The DB CHECK
// (mkt_appeals_no_self_approve) is the independent second line of defense
// behind the Go-layer makercheck check the service performs first.
func (r *Repository) ApproveAppealDecision(ctx context.Context, id, checkerID string) (*Appeal, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_appeals SET
			status = 'executed',
			second_approver_id = $2,
			second_approved_at = now(),
			executed_at = now(),
			updated_at = now()
		WHERE id = $1 AND status = 'decided' AND requires_dual_approval = true
		RETURNING `+appealCols, id, checkerID)
	a, err := scanAppeal(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoPendingAction
		}
		return nil, wrapInternal("approve appeal decision", err)
	}
	return a, nil
}
