package referrals

import (
	"context"
	"fmt"
	"time"
)

// CodeSweepOpts bounds one pass of EnsureMissingCodes.
type CodeSweepOpts struct {
	// MinAge leaves accounts younger than this alone: signup files their code
	// itself, and a sweep racing a registration still being written would mint a
	// code for an account that may not exist by the end of it. Zero means no floor.
	MinAge time.Duration
	// Limit caps one pass. A real deployment's backlog is every account created
	// before this feature existed, so the ticker works through it in bounded passes
	// instead of one statement that holds the code tables for minutes.
	Limit int
	// OnlyUserIDs restricts the pass to these accounts (tests, targeted repair). Nil
	// means the whole roster — which on a shared development database means other
	// people's data, so a test must always set it.
	OnlyUserIDs []string
}

// EnsureMissingCodes files a referral code for every registered account that has
// none in any of the three code namespaces, and reports how many it issued.
//
// Why this exists: a code is the key attribution resolves on, and the surfaces that
// display one — the owner's referral screen and the admin user record — have to
// agree. Codes used to appear only when an owner first opened their own referral
// screen, so an account that never did had nothing to report and the console said
// "No referral code yet" for a user the product considers fully registered. Signup
// now mints at registration (see app.NewSignupAttributor); this closes the backlog
// and covers any signup path that did not run it.
//
// It reuses GetOrCreateLink rather than a bulk INSERT…SELECT because minting has to
// draw a code and retry one that is already spoken for, and that is this function's
// only job. An account that already has a code anywhere is skipped: re-minting for
// it would move a code a user may already be sharing.
//
// The roster is public.user_profiles — the same table the house sweep walks — because
// it is the list of accounts the application can read in every environment (ADR-052:
// the auth schema is not reachable from this pool) and, unlike platform_users, it
// carries only accounts rather than that table's seed fixtures with no signup behind
// them.
//
// The error it returns, when non-nil, is the first account that could not be
// minted; the pass continues past it, because one unwriteable row must not stop the
// rest of the backlog.
func (s *RewardService) EnsureMissingCodes(ctx context.Context, o CodeSweepOpts) (int, error) {
	if o.Limit <= 0 {
		o.Limit = 500
	}
	const roster = `
		SELECT up.id::text
		FROM public.user_profiles up
		WHERE COALESCE(up.created_at, 'epoch'::timestamptz) < now() - make_interval(secs => $1)
		  AND ($2::uuid[] IS NULL OR up.id = ANY($2::uuid[]))
		  AND NOT EXISTS (SELECT 1 FROM public.referral_links l WHERE l.referrer_id = up.id)
		  AND NOT EXISTS (SELECT 1 FROM public.finance_referral_codes f WHERE f.user_id = up.id)
		  AND NOT EXISTS (
				SELECT 1 FROM public.platform_users p
				WHERE p.id = up.id AND COALESCE(p.referral_code, '') <> ''
			  )
		ORDER BY up.created_at NULLS FIRST
		LIMIT $3`
	var only any // nil -> SQL NULL
	if o.OnlyUserIDs != nil {
		only = o.OnlyUserIDs
	}
	rows, err := s.db.Query(ctx, roster, o.MinAge.Seconds(), only, o.Limit)
	if err != nil {
		return 0, fmt.Errorf("referrals: code sweep: roster: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, fmt.Errorf("referrals: code sweep: scan: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, fmt.Errorf("referrals: code sweep: iterate: %w", err)
	}
	rows.Close()

	minted, failed := 0, 0
	var firstErr error
	for _, id := range ids {
		if ctx.Err() != nil {
			break // shutdown: report what was done, leave the rest for the next tick
		}
		if _, err := s.GetOrCreateLink(ctx, id); err != nil {
			failed++
			if firstErr == nil {
				firstErr = fmt.Errorf("account %s: %w", id, err)
			}
			continue
		}
		minted++
	}
	if failed > 0 {
		return minted, fmt.Errorf("referrals: code sweep: %d of %d accounts not minted, first failure: %w",
			failed, len(ids), firstErr)
	}
	return minted, nil
}
