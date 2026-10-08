package marketplace

// repository_verification.go — pgx data layer for mkt_verification_requests
// (the pending-review queue behind POST /verification/{id,business}).

import (
	"context"
	"encoding/json"

	"spotlight/backend/go-common/dbutil"
)

// InsertVerificationRequest files one pending verification submission and
// returns the created row. The mkt_verification_requests_one_pending partial
// unique index enforces at most one open request per (user, kind); a 23505 is
// mapped to ErrVerificationPending (409) — a resubmission is legal only after
// the previous request was decided.
func (r *Repository) InsertVerificationRequest(ctx context.Context, userID, marketID string, kind VerificationKind, payload map[string]any) (*VerificationRequest, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, wrapInternal("marshal verification payload", err)
	}
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_verification_requests (user_id, market_id, kind, payload)
		VALUES ($1, $2, $3, $4)
		RETURNING id, user_id, market_id, kind, status, created_at`,
		userID, marketID, string(kind), raw)
	var v VerificationRequest
	if err := row.Scan(&v.ID, &v.UserID, &v.MarketID, &v.Kind, &v.Status, &v.CreatedAt); err != nil {
		if dbutil.IsUniqueViolation(err) {
			return nil, ErrVerificationPending
		}
		return nil, wrapInternal("insert verification request", err)
	}
	return &v, nil
}

// ResolveVerificationRequests settles every pending request for a user in one
// pass — called from the admin KYC review so the queue flag (kyc_pending) and
// the request rows can never disagree. approved=true marks them 'approved' and
// returns the approved kinds so the service can grant the matching badges;
// approved=false marks them 'rejected' (reason stamped) so the member may
// resubmit. Returns the resolved kinds (empty when nothing was pending).
func (r *Repository) ResolveVerificationRequests(ctx context.Context, userID, marketID string, approved bool, reviewerID, reasonCode string) ([]VerificationKind, error) {
	status := VerificationStatusRejected
	if approved {
		status = VerificationStatusApproved
	}
	rows, err := r.db.Query(ctx, `
		UPDATE public.mkt_verification_requests SET
			status      = $3,
			reviewed_by = $4,
			reviewed_at = now(),
			reason_code = $5,
			updated_at  = now()
		WHERE user_id = $1 AND market_id = $2 AND status = 'pending'
		RETURNING kind`, userID, marketID, status, reviewerID, reasonCode)
	if err != nil {
		return nil, wrapInternal("resolve verification requests", err)
	}
	defer rows.Close()
	var kinds []VerificationKind
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, wrapInternal("resolve verification requests", err)
		}
		kinds = append(kinds, VerificationKind(k))
	}
	if err := rows.Err(); err != nil {
		return nil, wrapInternal("resolve verification requests", err)
	}
	return kinds, nil
}
