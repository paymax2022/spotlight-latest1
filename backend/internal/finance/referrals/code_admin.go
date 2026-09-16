package referrals

// Admin-chosen referral codes.
//
// An admin can replace a referrer's generated code with a memorable one
// ("JIDE1" on a flyer). The whole risk of that feature is COLLISION, and the
// check has to be wider than it first appears — see SetLinkCode.

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// codeIssueAttempts bounds the retry when a generated code is already taken.
// Bounded, not infinite: if the space were somehow exhausted or the unique index
// were failing for another reason, an unbounded loop would spin forever inside a
// request instead of surfacing the problem.
const codeIssueAttempts = 8

// ErrCodeTaken means the requested code already belongs to someone.
var ErrCodeTaken = errors.New("referrals: code already in use")

// isDuplicateCode reports whether err is a unique violation on a code column.
//
// It deliberately does not distinguish WHICH unique index fired: on these tables
// the referrer_id conflicts are handled by ON CONFLICT clauses before this is
// reached, so a 23505 arriving here is a code clash.
func isDuplicateCode(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// codeOwner returns the user holding code, or "" if it is free.
//
// IT CHECKS BOTH TABLES, and that is the point. Attribution resolves a code by
// looking in referral_links FIRST and falling back to the legacy
// finance_referral_codes (see resolveCode). So if an admin were allowed to set a
// link code equal to some legacy user's code, every future signup typing that
// code would resolve to the NEW owner and the original owner would silently stop
// being credited — no error anywhere, just someone else's rewards. Checking one
// table would have shipped exactly that.
func (s *RewardService) codeOwner(ctx context.Context, code string) (string, error) {
	const q = `
		SELECT referrer_id::text FROM public.referral_links          WHERE code = $1
		UNION
		SELECT user_id::text     FROM public.finance_referral_codes  WHERE code = $1
		LIMIT 1`
	var owner string
	err := s.db.QueryRow(ctx, q, code).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("referrals: check code owner: %w", err)
	}
	return owner, nil
}

// SetLinkCode assigns an admin-chosen code to a referrer.
//
// Returns ErrCodeTaken if the code belongs to anyone else, in EITHER namespace.
// Re-assigning a referrer their own existing code is a no-op success, so a
// double-submit from the admin UI does not read as a failure.
func (s *RewardService) SetLinkCode(ctx context.Context, referrerID, rawCode string) (*Link, error) {
	code := NormalizeCode(rawCode)
	if err := ValidateCode(code); err != nil {
		return nil, err
	}

	// Make sure the referrer has a link row to update; also covers "admin edits
	// a user who has never opened the referral screen".
	if _, err := s.GetOrCreateLink(ctx, referrerID); err != nil {
		return nil, err
	}

	switch owner, err := s.codeOwner(ctx, code); {
	case err != nil:
		return nil, err
	case owner == referrerID:
		// Already theirs — nothing to do, and not an error.
		return s.GetOrCreateLink(ctx, referrerID)
	case owner != "":
		return nil, ErrCodeTaken
	}

	const upd = `
		UPDATE public.referral_links SET code = $2
		WHERE referrer_id = $1
		RETURNING id, referrer_id, code, created_at`
	var l Link
	err := s.db.QueryRow(ctx, upd, referrerID, code).Scan(&l.ID, &l.ReferrerID, &l.Code, &l.CreatedAt)
	if err != nil {
		// The read above is not a lock: another admin can claim the same code in
		// between. The unique index is the real guarantee, so translate its
		// violation into the same typed error rather than a 500.
		if isDuplicateCode(err) {
			return nil, ErrCodeTaken
		}
		return nil, fmt.Errorf("referrals: set code: %w", err)
	}
	return &l, nil
}
