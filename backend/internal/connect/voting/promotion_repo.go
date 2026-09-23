package connectvoting

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ─── Partners ────────────────────────────────────────────────────────────────

const partnerColumns = `id, name, contact_email, contact_phone, logo_url, notes, created_by, created_at, updated_at`

func scanPartner(s rowScanner) (*ContestPartner, error) {
	p := &ContestPartner{}
	if err := s.Scan(&p.ID, &p.Name, &p.ContactEmail, &p.ContactPhone, &p.LogoURL, &p.Notes,
		&p.CreatedBy, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	return p, nil
}

// CreatePartner inserts a new contest_partners row.
func (r *Repository) CreatePartner(ctx context.Context, name string, contactEmail, contactPhone, logoURL, notes *string, createdBy string) (*ContestPartner, error) {
	const q = `INSERT INTO contest_partners (name, contact_email, contact_phone, logo_url, notes, created_by)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING ` + partnerColumns
	return scanPartner(r.db.QueryRow(ctx, q, name, contactEmail, contactPhone, logoURL, notes, createdBy))
}

// ListPartners returns all partner organisations, newest first.
func (r *Repository) ListPartners(ctx context.Context) ([]ContestPartner, error) {
	const q = `SELECT ` + partnerColumns + ` FROM contest_partners ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("voting: list partners: %w", err)
	}
	defer rows.Close()
	out := []ContestPartner{}
	for rows.Next() {
		p, err := scanPartner(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// UpdatePartner applies a partial update (COALESCE keeps unset fields as-is).
func (r *Repository) UpdatePartner(ctx context.Context, id string, name, contactEmail, contactPhone, logoURL, notes *string) (*ContestPartner, error) {
	const q = `UPDATE contest_partners SET
			name          = COALESCE($2, name),
			contact_email = COALESCE($3, contact_email),
			contact_phone = COALESCE($4, contact_phone),
			logo_url      = COALESCE($5, logo_url),
			notes         = COALESCE($6, notes),
			updated_at    = now()
		WHERE id = $1
		RETURNING ` + partnerColumns
	p, err := scanPartner(r.db.QueryRow(ctx, q, id, name, contactEmail, contactPhone, logoURL, notes))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrPartnerNotFound
		}
		return nil, fmt.Errorf("voting: update partner: %w", err)
	}
	return p, nil
}

// ─── Child contests / hierarchy ──────────────────────────────────────────────

// ListChildContests returns contests whose parent_contest_id is parentID.
func (r *Repository) ListChildContests(ctx context.Context, parentID string) ([]ChildContest, error) {
	const q = `SELECT id, name, status::text, state, lga, partner_id
		FROM contests WHERE parent_contest_id = $1 ORDER BY name ASC`
	rows, err := r.db.Query(ctx, q, parentID)
	if err != nil {
		return nil, fmt.Errorf("voting: list child contests: %w", err)
	}
	defer rows.Close()
	out := []ChildContest{}
	for rows.Next() {
		var c ChildContest
		if err := rows.Scan(&c.ID, &c.Name, &c.Status, &c.State, &c.LGA, &c.PartnerID); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// GetContestHierarchy fetches the parent-link + default-top-N for a contest
// (legacy public.contests, which is what contest_promotions FKs to).
func (r *Repository) GetContestHierarchy(ctx context.Context, id string) (*ContestHierarchyInfo, error) {
	const q = `SELECT id, parent_contest_id, default_promote_top_n FROM contests WHERE id = $1`
	info := &ContestHierarchyInfo{}
	if err := r.db.QueryRow(ctx, q, id).Scan(&info.ID, &info.ParentContestID, &info.DefaultPromoteTopN); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("voting: get contest hierarchy: %w", err)
	}
	return info, nil
}

// IsDescendantOf walks the parent chain starting at candidateAncestorID and
// reports whether contestID appears in it (i.e. contestID is an ancestor of
// candidateAncestorID, so setting candidateAncestorID as contestID's "parent"
// — or promoting contestID's contestants up through it — would close a
// cycle). Belt-and-braces on top of the DB trigger
// (contests_reject_parent_cycle), which only fires on parent_contest_id
// writes to `contests` itself — RequestPromotion never writes that column, so
// this is the only guard for the promotion path.
func (r *Repository) IsDescendantOf(ctx context.Context, contestID, candidateAncestorID string) (bool, error) {
	current := candidateAncestorID
	for depth := 0; depth < 1000; depth++ {
		if current == contestID {
			return true, nil
		}
		var next *string
		const q = `SELECT parent_contest_id FROM contests WHERE id = $1`
		if err := r.db.QueryRow(ctx, q, current).Scan(&next); err != nil {
			if err == pgx.ErrNoRows {
				return false, nil
			}
			return false, fmt.Errorf("voting: walk parent chain: %w", err)
		}
		if next == nil {
			return false, nil
		}
		current = *next
	}
	return false, fmt.Errorf("voting: parent chain exceeds max depth")
}

// LatestPublishedRoundResults returns the ranked results of the CHILD
// contest's most recently published voting round (status='results_published'
// on voting_rounds — the locking mechanism confirmed in
// 20270213000000_contest_prizes_and_results_lock.sql / publish_voting_round_results).
// Returns (nil, nil) if no round has been published yet.
func (r *Repository) LatestPublishedRoundResults(ctx context.Context, childContestID string) ([]RankedChildResult, error) {
	const roundQ = `SELECT id FROM voting_rounds
		WHERE contest_id = $1 AND status = 'results_published'
		ORDER BY updated_at DESC LIMIT 1`
	var roundID string
	if err := r.db.QueryRow(ctx, roundQ, childContestID).Scan(&roundID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("voting: find published round: %w", err)
	}

	const resultsQ = `SELECT contestant_id, rank FROM voting_round_results
		WHERE round_id = $1 ORDER BY rank ASC`
	rows, err := r.db.Query(ctx, resultsQ, roundID)
	if err != nil {
		return nil, fmt.Errorf("voting: load round results: %w", err)
	}
	defer rows.Close()
	out := []RankedChildResult{}
	for rows.Next() {
		var rr RankedChildResult
		if err := rows.Scan(&rr.ContestantID, &rr.Rank); err != nil {
			return nil, err
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

// ─── contestants (real roster table) ─────────────────────────────────────────

// contestantRegistration is the subset of a contestants row that gets copied
// into a new parent-contest contestant on promotion.
type contestantRegistration struct {
	Name        string
	Category    string
	Bio         string
	PhotoURL    string
	ContestLink string
}

func (r *Repository) getContestantRegistration(ctx context.Context, tx pgx.Tx, contestantID string) (*contestantRegistration, error) {
	const q = `SELECT name, category, bio, photo_url, contest_link FROM contestants WHERE id = $1`
	reg := &contestantRegistration{}
	if err := tx.QueryRow(ctx, q, contestantID).Scan(&reg.Name, &reg.Category, &reg.Bio, &reg.PhotoURL, &reg.ContestLink); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("voting: load contestant registration: %w", err)
	}
	return reg, nil
}

// ─── contest_promotions ───────────────────────────────────────────────────────

// CreatePromotionBatch inserts one contest_promotions row per ranked result
// PLUS one contest_admin_approvals row (action_type='contest_promotion') for
// maker-checker surfacing, all in a single transaction — either every row is
// created or none is.
func (r *Repository) CreatePromotionBatch(ctx context.Context, childContestID, parentContestID string, ranked []RankedChildResult, requestedBy string) ([]ContestPromotion, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("voting: create promotion batch: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	const insPromo = `INSERT INTO contest_promotions
		(child_contest_id, parent_contest_id, contestant_id, rank_in_child, requested_by)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id, child_contest_id, parent_contest_id, contestant_id, rank_in_child,
			requested_by, requested_at, approved_by, approved_at, status, new_contestant_id, rejection_reason`

	out := make([]ContestPromotion, 0, len(ranked))
	ids := make([]string, 0, len(ranked))
	for _, rr := range ranked {
		var p ContestPromotion
		if err := tx.QueryRow(ctx, insPromo, childContestID, parentContestID, rr.ContestantID, rr.Rank, requestedBy).Scan(
			&p.ID, &p.ChildContestID, &p.ParentContestID, &p.ContestantID, &p.RankInChild,
			&p.RequestedBy, &p.RequestedAt, &p.ApprovedBy, &p.ApprovedAt, &p.Status, &p.NewContestantID, &p.RejectionReason,
		); err != nil {
			return nil, fmt.Errorf("voting: insert contest_promotions row (contestant %s): %w", rr.ContestantID, err)
		}
		out = append(out, p)
		ids = append(ids, p.ID)
	}

	const insApproval = `INSERT INTO contest_admin_approvals
		(action_type, contest_id, payload, initiator_id, initiator_role)
		VALUES ('contest_promotion', $1, $2::jsonb, $3, 'admin')`
	payload := map[string]any{
		"childContestId":  childContestID,
		"parentContestId": parentContestID,
		"topN":            len(ranked),
		"promotionIds":    ids,
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("voting: marshal contest_admin_approvals payload: %w", err)
	}
	if _, err := tx.Exec(ctx, insApproval, childContestID, string(rawPayload), requestedBy); err != nil {
		return nil, fmt.Errorf("voting: insert contest_admin_approvals row: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("voting: create promotion batch: commit: %w", err)
	}
	return out, nil
}

func scanPromotion(s rowScanner) (*ContestPromotion, error) {
	p := &ContestPromotion{}
	if err := s.Scan(&p.ID, &p.ChildContestID, &p.ParentContestID, &p.ContestantID, &p.RankInChild,
		&p.RequestedBy, &p.RequestedAt, &p.ApprovedBy, &p.ApprovedAt, &p.Status, &p.NewContestantID, &p.RejectionReason); err != nil {
		return nil, err
	}
	return p, nil
}

const promotionColumns = `id, child_contest_id, parent_contest_id, contestant_id, rank_in_child,
	requested_by, requested_at, approved_by, approved_at, status, new_contestant_id, rejection_reason`

// GetPromotion fetches one contest_promotions row.
func (r *Repository) GetPromotion(ctx context.Context, id string) (*ContestPromotion, error) {
	const q = `SELECT ` + promotionColumns + ` FROM contest_promotions WHERE id = $1`
	p, err := scanPromotion(r.db.QueryRow(ctx, q, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrPromotionNotFound
		}
		return nil, fmt.Errorf("voting: get promotion: %w", err)
	}
	return p, nil
}

// ListPromotions returns contest_promotions rows, optionally filtered by
// status ("" = all), newest first.
func (r *Repository) ListPromotions(ctx context.Context, status string) ([]ContestPromotion, error) {
	q := `SELECT ` + promotionColumns + ` FROM contest_promotions`
	args := []any{}
	if status != "" {
		q += ` WHERE status = $1`
		args = append(args, status)
	}
	q += ` ORDER BY requested_at DESC`
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("voting: list promotions: %w", err)
	}
	defer rows.Close()
	out := []ContestPromotion{}
	for rows.Next() {
		p, err := scanPromotion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// ApprovePromotion executes one promotion inside a single transaction:
//   1. Locks + re-reads the contest_promotions row (FOR UPDATE — prevents a
//      concurrent double-approve of the same row).
//   2. Refuses unless status='pending' and approverID != requested_by (the
//      DB CHECK contest_promotions_no_self_approval also enforces the latter,
//      but failing fast here gives a clean typed error instead of a raw
//      constraint-violation from Postgres).
//   3. Copies the child contestant's real registration data into a NEW
//      contestants row under the PARENT contest.
//   4. Sets new_contestant_id / status='executed' / approved_by / approved_at.
// A partial promotion (new contestant created but the promotion row left
// pending, or vice versa) is impossible — both writes commit together or
// neither does.
func (r *Repository) ApprovePromotion(ctx context.Context, promotionID, approverID string) (*ContestPromotion, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("voting: approve promotion: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	const lockQ = `SELECT ` + promotionColumns + ` FROM contest_promotions WHERE id = $1 FOR UPDATE`
	p, err := scanPromotion(tx.QueryRow(ctx, lockQ, promotionID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrPromotionNotFound
		}
		return nil, fmt.Errorf("voting: approve promotion: lock: %w", err)
	}
	if p.Status != "pending" {
		return nil, ErrPromotionNotPending
	}
	if approverID == p.RequestedBy {
		return nil, ErrPromotionSelfApproval
	}

	reg, err := r.getContestantRegistration(ctx, tx, p.ContestantID)
	if err != nil {
		return nil, err
	}

	const insContestant = `INSERT INTO contestants
		(name, category, bio, photo_url, contest_link, contest_id, status, is_active)
		VALUES ($1,$2,$3,$4,$5,$6,'approved'::contestant_status, true)
		RETURNING id`
	var newContestantID string
	if err := tx.QueryRow(ctx, insContestant, reg.Name, reg.Category, reg.Bio, reg.PhotoURL, reg.ContestLink, p.ParentContestID).
		Scan(&newContestantID); err != nil {
		return nil, fmt.Errorf("voting: approve promotion: create parent contestant: %w", err)
	}

	const updPromo = `UPDATE contest_promotions
		SET status = 'executed', approved_by = $2, approved_at = now(), new_contestant_id = $3
		WHERE id = $1
		RETURNING ` + promotionColumns
	out, err := scanPromotion(tx.QueryRow(ctx, updPromo, promotionID, approverID, newContestantID))
	if err != nil {
		return nil, fmt.Errorf("voting: approve promotion: update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("voting: approve promotion: commit: %w", err)
	}
	return out, nil
}

// RejectPromotion marks a pending promotion row rejected with a reason.
func (r *Repository) RejectPromotion(ctx context.Context, promotionID, approverID, reason string) (*ContestPromotion, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("voting: reject promotion: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	const lockQ = `SELECT ` + promotionColumns + ` FROM contest_promotions WHERE id = $1 FOR UPDATE`
	p, err := scanPromotion(tx.QueryRow(ctx, lockQ, promotionID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrPromotionNotFound
		}
		return nil, fmt.Errorf("voting: reject promotion: lock: %w", err)
	}
	if p.Status != "pending" {
		return nil, ErrPromotionNotPending
	}
	if approverID == p.RequestedBy {
		return nil, ErrPromotionSelfApproval
	}

	const updPromo = `UPDATE contest_promotions
		SET status = 'rejected', approved_by = $2, approved_at = now(), rejection_reason = $3
		WHERE id = $1
		RETURNING ` + promotionColumns
	out, err := scanPromotion(tx.QueryRow(ctx, updPromo, promotionID, approverID, reason))
	if err != nil {
		return nil, fmt.Errorf("voting: reject promotion: update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("voting: reject promotion: commit: %w", err)
	}
	return out, nil
}
