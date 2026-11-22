package referrals

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// OriginalCode reports the code an account was issued before an admin customised
// it, or "" when the code has never been changed.
//
// There is no row anywhere that holds it: SetLinkCode converges referral_links,
// finance_referral_codes and platform_users onto the new value on purpose, because
// the alternative is one person showing two codes on two surfaces. What survives is
// the append-only audit event SetLinkCode emits, so that stream is the record — and
// the EARLIEST one is the original, not the most recent (a code renamed twice has
// two "previous" values and exactly one issued value).
//
// Read-only by construction, like LookupCode: the admin console re-reads it on
// every open, and a GET that minted or rewrote a code would be a mutation dressed
// as a report.
func (s *Service) OriginalCode(ctx context.Context, userID string) (string, error) {
	var code string
	if err := s.rowReader().QueryRow(ctx, `
		SELECT COALESCE(payload->>'from', '') FROM referral_engine_events
		WHERE event_type = 'referral.code.changed'
		  AND referrer_id = $1
		  AND COALESCE(payload->>'from', '') <> ''
		ORDER BY created_at ASC
		LIMIT 1`, userID).Scan(&code); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil // never customised: nothing to report, and not an error
		}
		return "", err
	}
	return code, nil
}
