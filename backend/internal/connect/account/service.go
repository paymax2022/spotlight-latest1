// Package connectaccount implements the Paymax Connect account-deletion /
// data-subject-request (DSR) cascade — test-plan rows ON-010, EC-011, MB-020 and
// the privacy invariants (§4).
//
// Design: deletion ANONYMISES in place rather than hard-deleting rows that other
// users reference, so a partner sees a graceful "Deleted user" state instead of a
// broken match/thread. The whole cascade runs in ONE transaction and is idempotent
// (safe to replay), fail-closed (any step error rolls the whole thing back), and
// audited immutably in connect_audit_log.
//
// Retained on purpose (NOT erased): connect_audit_log (immutable compliance),
// connect_account_restrictions (a ban must survive deletion — anti ban-evasion),
// connect_cases (safety record), connect_consents (proof of consent). Everything
// that is personal data or a discovery/contact surface is erased or anonymised.
package connectaccount

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service owns the deletion cascade over the service-role pool.
type Service struct{ db *pgxpool.Pool }

// NewService builds the account service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// Result reports what the deletion did (useful for the caller/audit and tests).
type Result struct {
	UserID          string `json:"user_id"`
	AlreadyDeleted  bool   `json:"already_deleted"`
	MatchesEnded    int64  `json:"matches_ended"`
	MessagesRedacted int64 `json:"messages_redacted"`
}

// DeleteAccount erases/anonymises a user's Connect footprint. actorID is who
// initiated it (the user themselves for a self-serve delete, or an admin for a DSR)
// and is recorded for attribution. Idempotent: a second call on an already-deleted
// profile is a no-op success.
func (s *Service) DeleteAccount(ctx context.Context, userID, actorID string) (*Result, error) {
	if userID == "" {
		return nil, errors.New("connect: userID required")
	}
	if actorID == "" {
		actorID = userID
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("connect: begin delete tx: %w", err)
	}
	defer tx.Rollback(ctx)

	res := &Result{UserID: userID}

	// Resolve the profile id (may be absent if the user never built a profile).
	var profileID string
	err = tx.QueryRow(ctx, `SELECT id FROM connect_profiles WHERE user_id = $1::uuid`, userID).Scan(&profileID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		profileID = ""
	case err != nil:
		return nil, fmt.Errorf("connect: resolve profile: %w", err)
	}

	// 1) Anonymise the core profile PII + mark deleted. Idempotent guard on deleted_at.
	if profileID != "" {
		ct, err := tx.Exec(ctx, `
			UPDATE connect_profiles
			   SET display_name = 'Deleted user', bio = NULL, dob = NULL,
			       city = NULL, geo_lat = NULL, geo_lng = NULL,
			       deleted_at = now(), updated_at = now()
			 WHERE id = $1 AND deleted_at IS NULL`, profileID)
		if err != nil {
			return nil, fmt.Errorf("connect: anonymise profile: %w", err)
		}
		if ct.RowsAffected() == 0 {
			// Already deleted — idempotent success, nothing more to do.
			if err := tx.Commit(ctx); err != nil {
				return nil, fmt.Errorf("connect: commit noop: %w", err)
			}
			res.AlreadyDeleted = true
			return res, nil
		}

		// 2) Remove from discovery + delete photos + swipe history.
		if _, err := tx.Exec(ctx, `UPDATE connect_profile_modes SET visible = false, updated_at = now() WHERE profile_id = $1`, profileID); err != nil {
			return nil, fmt.Errorf("connect: hide modes: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM connect_profile_media WHERE profile_id = $1`, profileID); err != nil {
			return nil, fmt.Errorf("connect: delete media: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM connect_likes WHERE from_profile = $1 OR to_profile = $1`, profileID); err != nil {
			return nil, fmt.Errorf("connect: delete likes: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM connect_passes WHERE from_profile = $1 OR to_profile = $1`, profileID); err != nil {
			return nil, fmt.Errorf("connect: delete passes: %w", err)
		}

		// 3) End all active matches gracefully (partner sees 'unmatched'; this also
		//    severs chat, which requires status='matched').
		ct, err = tx.Exec(ctx, `
			UPDATE connect_matches SET status = 'unmatched'
			 WHERE (profile_a = $1 OR profile_b = $1) AND status = 'matched'`, profileID)
		if err != nil {
			return nil, fmt.Errorf("connect: end matches: %w", err)
		}
		res.MatchesEnded = ct.RowsAffected()
	}

	// 4) Redact the user's professional identity + hide it.
	if _, err := tx.Exec(ctx, `
		UPDATE connect_professional_profiles
		   SET headline = NULL, company = NULL, role_title = NULL, bio = NULL,
		       visible = false, updated_at = now()
		 WHERE user_id = $1::uuid`, userID); err != nil {
		return nil, fmt.Errorf("connect: redact professional: %w", err)
	}

	// 5) Erase sensitive verification evidence entirely.
	if _, err := tx.Exec(ctx, `DELETE FROM connect_verification WHERE user_id = $1::uuid`, userID); err != nil {
		return nil, fmt.Errorf("connect: delete verification: %w", err)
	}

	// 6) Drop blocks involving the user (both directions) — moot once the account is gone.
	if _, err := tx.Exec(ctx, `DELETE FROM connect_blocks WHERE blocker_id = $1::uuid OR blocked_id = $1::uuid`, userID); err != nil {
		return nil, fmt.Errorf("connect: delete blocks: %w", err)
	}

	// 7) Redact the content of the user's own chat messages (erase what they wrote)
	//    while leaving the thread structure intact for the counterpart.
	ct, err := tx.Exec(ctx, `UPDATE connect_messages SET body = '' WHERE sender_id = $1::uuid AND body <> ''`, userID)
	if err != nil {
		return nil, fmt.Errorf("connect: redact messages: %w", err)
	}
	res.MessagesRedacted = ct.RowsAffected()

	// 8) Immutable audit of the deletion (attribution + what was affected).
	if _, err := tx.Exec(ctx, `
		INSERT INTO connect_audit_log (actor_id, actor_role, action, entity_type, entity_id, new_value)
		VALUES ($1::uuid, $2, 'connect.account.delete', 'connect_user', $3, $4::jsonb)`,
		nullUUID(actorID), roleFor(actorID, userID), userID,
		fmt.Sprintf(`{"matches_ended":%d,"messages_redacted":%d}`, res.MatchesEnded, res.MessagesRedacted),
	); err != nil {
		return nil, fmt.Errorf("connect: audit delete: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("connect: commit delete: %w", err)
	}
	return res, nil
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func roleFor(actorID, userID string) string {
	if actorID == userID {
		return "member"
	}
	return "admin"
}
