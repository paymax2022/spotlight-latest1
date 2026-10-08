package marketplace

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// repository_admin_users.go — pgx data layer for mkt_user_moderation +
// mkt_blacklist (MKT-007 Users/Trust&Safety). New file per this module's
// existing file-per-concern split.

const userModCols = `user_id, market_id, status, suspension_reason_code, blacklisted,
	blacklist_reason_code, kyc_tier, kyc_pending, pending_action, pending_reason_code,
	proposed_by, proposed_at, requires_dual_approval, second_approver_id,
	second_approved_at, created_at, updated_at`

func scanUserMod(row pgx.Row) (*UserModerationRow, error) {
	var m UserModerationRow
	if err := row.Scan(
		&m.UserID, &m.MarketID, &m.Status, &m.SuspensionReasonCode, &m.Blacklisted,
		&m.BlacklistReasonCode, &m.KYCTier, &m.KYCPending, &m.PendingAction, &m.PendingReasonCode,
		&m.ProposedBy, &m.ProposedAt, &m.RequiresDualApproval, &m.SecondApproverID,
		&m.SecondApprovedAt, &m.CreatedAt, &m.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &m, nil
}

// GetOrInitUserModeration loads the mkt_user_moderation row for a user, creating a
// default 'active' row on first touch (a user with no prior admin action has no
// row yet — this makes every read/write idempotent without a separate
// "does a row exist" branch at every call site).
func (r *Repository) GetOrInitUserModeration(ctx context.Context, userID, marketID string) (*UserModerationRow, error) {
	row := r.db.QueryRow(ctx, `
		INSERT INTO public.mkt_user_moderation (user_id, market_id)
		VALUES ($1, $2)
		ON CONFLICT (user_id, market_id) DO UPDATE SET user_id = EXCLUDED.user_id
		RETURNING `+userModCols, userID, marketID)
	return scanUserMod(row)
}

// ProposeUserStatus records a maker's proposed action. When requiresDualApproval
// is false the caller (service layer) has ALREADY decided to execute
// immediately — status flips right away and pending_action stays nil.
// suspensionReasonCode is only stamped on the immediate-execute path (a
// suspend/reinstate), matching mkt_user_moderation.suspension_reason_code's role
// as the CURRENT reason, not a proposal-in-flight reason (that is
// pending_reason_code).
func (r *Repository) ProposeUserStatus(ctx context.Context, userID, marketID string, targetStatus UserModerationStatus, action UserAction, reasonCode, proposedBy string, requiresDualApproval bool) (*UserModerationRow, error) {
	var row pgx.Row
	if requiresDualApproval {
		row = r.db.QueryRow(ctx, `
			UPDATE public.mkt_user_moderation SET
				pending_action = $3,
				pending_reason_code = $4,
				proposed_by = $5,
				proposed_at = now(),
				requires_dual_approval = true,
				second_approver_id = NULL,
				second_approved_at = NULL,
				updated_at = now()
			WHERE user_id = $1 AND market_id = $2
			RETURNING `+userModCols, userID, marketID, string(action), reasonCode, proposedBy)
	} else {
		row = r.db.QueryRow(ctx, `
			UPDATE public.mkt_user_moderation SET
				status = $3,
				suspension_reason_code = $4,
				pending_action = NULL,
				pending_reason_code = NULL,
				proposed_by = $5,
				proposed_at = now(),
				requires_dual_approval = false,
				second_approver_id = NULL,
				second_approved_at = NULL,
				updated_at = now()
			WHERE user_id = $1 AND market_id = $2
			RETURNING `+userModCols, userID, marketID, string(targetStatus), reasonCode, proposedBy)
	}
	m, err := scanUserMod(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, wrapInternal("propose user status", err)
	}
	return m, nil
}

// ApproveUserAction is the checker step: applies the pending action's resulting
// status and stamps second_approver_id. The DB CHECK constraint
// (mkt_user_moderation_no_self_approve) is a second, independent line of defense
// on top of the Go-layer makercheck.Authorize call the service performs before
// this runs — this method does not re-check identity itself, only that a
// pending action exists.
func (r *Repository) ApproveUserAction(ctx context.Context, userID, marketID, checkerID string) (*UserModerationRow, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_user_moderation SET
			status = CASE pending_action
				WHEN 'ban' THEN 'banned'
				WHEN 'suspend' THEN 'suspended'
				ELSE 'active'
			END,
			suspension_reason_code = pending_reason_code,
			second_approver_id = $3,
			second_approved_at = now(),
			pending_action = NULL,
			updated_at = now()
		WHERE user_id = $1 AND market_id = $2 AND pending_action IS NOT NULL
		RETURNING `+userModCols, userID, marketID, checkerID)
	m, err := scanUserMod(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoPendingAction
		}
		return nil, wrapInternal("approve user action", err)
	}
	return m, nil
}

// SetKYCReview applies a KYC review decision. Single-admin, immediate — no
// separate approve endpoint exists for KYC review in the frontend contract
// (marketplaceAdminService.reviewKyc has no approveKycSecondSign counterpart),
// so this is NOT gated by maker-checker (see PR notes for this judgment call).
func (r *Repository) SetKYCReview(ctx context.Context, userID, marketID string, approved bool, grantTier *string) (*UserModerationRow, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_user_moderation SET
			kyc_pending = false,
			kyc_tier = CASE WHEN $3 AND $4::text IS NOT NULL THEN $4 ELSE kyc_tier END,
			updated_at = now()
		WHERE user_id = $1 AND market_id = $2
		RETURNING `+userModCols, userID, marketID, approved, grantTier)
	m, err := scanUserMod(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, wrapInternal("set kyc review", err)
	}
	return m, nil
}

// MarkKYCPending flags a user as having a KYC upgrade request awaiting review
// (used when seeding/observing an upgrade request; kept separate from
// SetKYCReview so "flag pending" and "resolve pending" are distinct writes).
func (r *Repository) MarkKYCPending(ctx context.Context, userID, marketID string) (*UserModerationRow, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_user_moderation SET kyc_pending = true, updated_at = now()
		WHERE user_id = $1 AND market_id = $2
		RETURNING `+userModCols, userID, marketID)
	m, err := scanUserMod(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, wrapInternal("mark kyc pending", err)
	}
	return m, nil
}

// SetUserBlacklisted flags the ACCOUNT itself as blacklisted (distinct from
// InsertBlacklistEntry, which blacklists an IDENTIFIER — device/phone/ip/email —
// that may not resolve to one user_id). Single-admin, immediate: see PR notes.
func (r *Repository) SetUserBlacklisted(ctx context.Context, userID, marketID, reasonCode, adminID string) (*UserModerationRow, error) {
	row := r.db.QueryRow(ctx, `
		UPDATE public.mkt_user_moderation SET
			blacklisted = true, blacklist_reason_code = $3, updated_at = now()
		WHERE user_id = $1 AND market_id = $2
		RETURNING `+userModCols, userID, marketID, reasonCode)
	m, err := scanUserMod(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, wrapInternal("set user blacklisted", err)
	}
	_ = adminID // recorded via the admin-audit trail (writeAudit), not a column here
	return m, nil
}

// InsertBlacklistEntry records a blacklisted IDENTIFIER (device/phone/ip/email) —
// mkt_blacklist, UNIQUE(type,value). ON CONFLICT is a no-op re-affirmation (the
// identifier is already blacklisted; the audit trail still records the repeat
// admin action via writeAudit at the service layer).
func (r *Repository) InsertBlacklistEntry(ctx context.Context, typ, value, reasonCode, createdBy string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.mkt_blacklist (type, value, reason_code, created_by)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (type, value) DO NOTHING`, typ, value, reasonCode, createdBy)
	if err != nil {
		return wrapInternal("insert blacklist entry", err)
	}
	return nil
}

// SearchUserModeration lists mkt_user_moderation rows, optionally filtered by
// status.
func (r *Repository) SearchUserModeration(ctx context.Context, marketID, status string, limit, offset int) ([]UserModerationRow, error) {
	limit = clampLimit(limit)
	q := `SELECT ` + userModCols + ` FROM public.mkt_user_moderation WHERE market_id = $1`
	args := []any{marketID}
	if status != "" {
		q += ` AND status = $2 ORDER BY updated_at DESC LIMIT $3 OFFSET $4`
		args = append(args, status, limit, offset)
	} else {
		q += ` ORDER BY updated_at DESC LIMIT $2 OFFSET $3`
		args = append(args, limit, offset)
	}
	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, wrapInternal("search user moderation", err)
	}
	defer rows.Close()
	var out []UserModerationRow
	for rows.Next() {
		m, err := scanUserMod(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *m)
	}
	return out, rows.Err()
}

// CountOpenFlagsForTarget counts open mkt_flags rows for a given target — feeds
// both UserAdminView.OpenFlags and the fraud-signals "N+ open flags" derivation.
func (r *Repository) CountOpenFlagsForTarget(ctx context.Context, targetType, targetID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM public.mkt_flags WHERE target_type=$1 AND target_id=$2 AND status='open'`, targetType, targetID).Scan(&n)
	if err != nil {
		return 0, wrapInternal("count open flags", err)
	}
	return n, nil
}

// UsersWithNOpenFlags returns (user_id, open_flag_count) for every user flagged
// target_type='user' with at least minCount OPEN flags — the "multiple_flags"
// fraud signal (real derived data, mkt_flags).
func (r *Repository) UsersWithNOpenFlags(ctx context.Context, marketID string, minCount int) (map[string]int, error) {
	rows, err := r.db.Query(ctx, `
		SELECT target_id::text, count(*) FROM public.mkt_flags
		WHERE market_id = $1 AND target_type = 'user' AND status = 'open'
		GROUP BY target_id HAVING count(*) >= $2`, marketID, minCount)
	if err != nil {
		return nil, wrapInternal("users with n open flags", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// RapidListingSellers returns seller_ids that have created >= minCount listings
// within the given window — the "velocity" fraud signal, derived from real
// mkt_listings.created_at (no separate ingestion pipeline needed).
func (r *Repository) RapidListingSellers(ctx context.Context, marketID string, windowMinutes, minCount int) (map[string]int, error) {
	rows, err := r.db.Query(ctx, `
		SELECT seller_id::text, count(*) FROM public.mkt_listings
		WHERE market_id = $1 AND created_at > now() - ($2 * interval '1 minute')
		GROUP BY seller_id HAVING count(*) >= $3`, marketID, windowMinutes, minCount)
	if err != nil {
		return nil, wrapInternal("rapid listing sellers", err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// PlatformUserBasics is the minimal identity slice read from platform_users for
// the admin console (PII masked by the service layer before it reaches JSON —
// this repo method returns the RAW values so masking stays a single, auditable
// service-layer function rather than being duplicated per query).
type PlatformUserBasics struct {
	ID        string
	FirstName string
	LastName  string
	Email     *string
	Phone     *string
	CreatedAt time.Time
}

// GetPlatformUserBasics reads identity fields from platform_users (core auth —
// read-only from marketplace; never written here, per CLAUDE.md brownfield rule).
func (r *Repository) GetPlatformUserBasics(ctx context.Context, userID string) (*PlatformUserBasics, error) {
	var b PlatformUserBasics
	err := r.db.QueryRow(ctx, `
		SELECT id::text, first_name, last_name, email, phone, created_at
		FROM public.platform_users WHERE id=$1`, userID).
		Scan(&b.ID, &b.FirstName, &b.LastName, &b.Email, &b.Phone, &b.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, wrapInternal("get platform user basics", err)
	}
	return &b, nil
}

// SearchPlatformUsers finds candidate platform_users by display-name/email/phone
// substring (q) for GET /admin/users — read-only, marketplace never writes here.
func (r *Repository) SearchPlatformUsers(ctx context.Context, q string, limit, offset int) ([]PlatformUserBasics, error) {
	limit = clampLimit(limit)
	rows, err := r.db.Query(ctx, `
		SELECT id::text, first_name, last_name, email, phone, created_at
		FROM public.platform_users
		WHERE ($1 = '' OR first_name ILIKE '%'||$1||'%' OR last_name ILIKE '%'||$1||'%'
		       OR email ILIKE '%'||$1||'%' OR phone ILIKE '%'||$1||'%')
		  AND deleted_at IS NULL
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`, q, limit, offset)
	if err != nil {
		return nil, wrapInternal("search platform users", err)
	}
	defer rows.Close()
	var out []PlatformUserBasics
	for rows.Next() {
		var b PlatformUserBasics
		if err := rows.Scan(&b.ID, &b.FirstName, &b.LastName, &b.Email, &b.Phone, &b.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// SetSellerKYCTier upserts mkt_trust_scores.kyc_tier — called on a KYC review
// approve with an explicit grant_tier. Mirrors SetVerifiedBadge's upsert shape
// (same table, same ON CONFLICT target) rather than inventing a new pattern.
func (r *Repository) SetSellerKYCTier(ctx context.Context, userID string, tier KYCTier) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.mkt_trust_scores (user_id, market_id, kyc_tier, account_created_at)
		VALUES ($1,$2,$3, now())
		ON CONFLICT (user_id) DO UPDATE SET kyc_tier=$3, updated_at=now()`, userID, DefaultMarketID, string(tier))
	if err != nil {
		return wrapInternal("set seller kyc tier", err)
	}
	return nil
}

// CountActiveListings counts a seller's currently-active listings.
func (r *Repository) CountActiveListings(ctx context.Context, sellerID string) (int, error) {
	var n int
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM public.mkt_listings WHERE seller_id=$1 AND status='active'`, sellerID).Scan(&n)
	if err != nil {
		return 0, wrapInternal("count active listings", err)
	}
	return n, nil
}

// BlacklistedIdentifierHitUsers is a placeholder derivation for the
// 'blacklist_hit' signal kind: it has no real linkage table yet (mkt_blacklist
// stores bare identifiers, not a user_id join), so it currently returns an empty
// map rather than fabricating a match. See PR notes: honestly documented gap,
// not a fabricated signal.
func (r *Repository) BlacklistedIdentifierHitUsers(ctx context.Context) (map[string]int, error) {
	return map[string]int{}, nil
}
