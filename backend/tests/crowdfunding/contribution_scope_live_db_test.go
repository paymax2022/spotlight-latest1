package crowdfunding_test

// ---------------------------------------------------------------------------
// LIVE-DB tests: the per-contribution endpoints are OWNER-SCOPED.
//
//	GET  /crowdfunding/contributions/:id
//	POST /crowdfunding/contributions/:id/refund-request
//
// WHY THIS EXISTS
// ---------------
// GetContribution used to read a contribution by id alone, on the reasoning
// that "the proxy auth layer gates the caller". That gate only proves the
// caller is *some* logged-in user — not that they are *this* contribution's
// contributor. A contribution id is a bare uuid a client holds after paying and
// passes around in navigation params, so any authenticated account holding one
// could read another person's amount, campaign and payment reference.
//
// The endpoint is now the confirmation read the mobile contribute flow depends
// on, which makes the scoping load-bearing rather than incidental.
//
// The three properties pinned here would all fail against the unscoped version:
// the owner still reads their own row, a stranger gets ErrNotFound (the same
// answer as a nonexistent id, so the endpoint never confirms an id it will not
// serve), and a missing caller identity is refused rather than treated as a
// wildcard.
//
// Gated on TEST_DATABASE_URL alone — never DATABASE_URL, which the root .env
// points at the production pooler and this test INSERTs (see
// scripts/ci/check-live-db-gate.sh).
//
// Bring-up:
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_Contribution -v
//	cd backend && go test ./tests/crowdfunding/... -run LiveDB_RefundRequest -v
// ---------------------------------------------------------------------------

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/crowdfunding/creator"
)

// TestLiveDB_ContributionReadIsOwnerScoped is the regression that closes the
// IDOR: same row, three callers, three different answers.
func TestLiveDB_ContributionReadIsOwnerScoped(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	campaignID, _, trackUser := seedCampaign(t, ctx, pool)

	owner := uuid.NewString()
	stranger := uuid.NewString()
	trackUser(owner)
	trackUser(stranger)
	for _, u := range []string{owner, stranger} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, u, "cf-scope-"+u+"@test.local"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}

	contributionID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO contributions (id, campaign_id, contributor_id, amount_kobo, status, idempotency_key)
		VALUES ($1, $2, $3, 250000, 'released', $4)`,
		contributionID, campaignID, owner, "scope-test-"+contributionID); err != nil {
		t.Fatalf("seed contribution: %v", err)
	}

	svc := creator.NewService(pool)

	// 1. The owner reads their own contribution.
	got, err := svc.GetContribution(ctx, contributionID, owner)
	if err != nil {
		t.Fatalf("owner read: %v — the contributor must still be able to confirm their own payment", err)
	}
	if got.ID != contributionID {
		t.Errorf("id = %q, want %q", got.ID, contributionID)
	}
	if got.AmountKobo != 250000 {
		t.Errorf("amountKobo = %d, want 250000", got.AmountKobo)
	}
	if got.Status != "SUCCESSFUL" {
		t.Errorf("status = %q, want SUCCESSFUL (a released contribution has moved money)", got.Status)
	}

	// 2. A different authenticated user gets nothing — and specifically
	//    ErrNotFound, so the 404 is indistinguishable from an id that does not
	//    exist at all.
	if _, err := svc.GetContribution(ctx, contributionID, stranger); !errors.Is(err, creator.ErrNotFound) {
		t.Errorf("stranger read: err = %v, want ErrNotFound — another user's contribution must not be readable", err)
	}

	// 3. No caller identity at all (auth context missing) is refused, not
	//    treated as "match any owner". This must be ErrNotFound rather than a
	//    cast error, so an unauthenticated read answers 404 and not 500.
	if _, err := svc.GetContribution(ctx, contributionID, ""); !errors.Is(err, creator.ErrNotFound) {
		t.Errorf("empty caller: err = %v, want ErrNotFound — a missing identity must fail closed", err)
	}
}

// TestLiveDB_RefundRequestIsOwnerScoped is the regression for the write-side
// twin of the read above. RequestRefund used to look the contribution up by id
// alone and take requester_id from the row, so a stranger could open a refund
// dispute on someone else's contribution — correctly attributed to the real
// contributor, which is precisely what made it invisible.
//
// Two properties are pinned: a stranger cannot file at all, and a stranger
// cannot reword a request the owner already filed (the INSERT's
// ON CONFLICT ... DO UPDATE SET reason branch was reachable by anyone).
func TestLiveDB_RefundRequestIsOwnerScoped(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)

	campaignID, _, trackUser := seedCampaign(t, ctx, pool)

	owner := uuid.NewString()
	stranger := uuid.NewString()
	trackUser(owner)
	trackUser(stranger)
	for _, u := range []string{owner, stranger} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, u, "cf-refundscope-"+u+"@test.local"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}

	contributionID := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO contributions (id, campaign_id, contributor_id, amount_kobo, status, idempotency_key)
		VALUES ($1, $2, $3, 250000, 'escrowed', $4)`,
		contributionID, campaignID, owner, "refund-scope-"+contributionID); err != nil {
		t.Fatalf("seed contribution: %v", err)
	}
	// cf_refund_requests cascades from contributions, which seedCampaign already
	// deletes — but delete it explicitly first so the order is not load-bearing.
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM cf_refund_requests WHERE contribution_id = $1`, contributionID); err != nil {
			t.Errorf("cleanup refund requests: %v", err)
		}
	})

	svc := creator.NewService(pool)

	// 1. A stranger cannot file a refund request against someone else's
	//    contribution — and gets the same answer as for an id that does not exist.
	if _, err := svc.RequestRefund(ctx, contributionID, stranger, "not mine"); !errors.Is(err, creator.ErrNotFound) {
		t.Errorf("stranger request: err = %v, want ErrNotFound", err)
	}
	// 2. No caller identity at all is refused rather than treated as a wildcard.
	if _, err := svc.RequestRefund(ctx, contributionID, "", "anonymous"); !errors.Is(err, creator.ErrNotFound) {
		t.Errorf("empty caller: err = %v, want ErrNotFound — a missing identity must fail closed", err)
	}
	// Neither refusal may have written anything.
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM cf_refund_requests WHERE contribution_id = $1`, contributionID,
	).Scan(&rows); err != nil {
		t.Fatalf("count refund requests: %v", err)
	}
	if rows != 0 {
		t.Fatalf("refund requests after refused calls = %d, want 0 — a rejected request must not leave a row", rows)
	}

	// 3. The owner can still file, attributed to themselves.
	if _, err := svc.RequestRefund(ctx, contributionID, owner, "campaign stalled"); err != nil {
		t.Fatalf("owner request: %v — the contributor must still be able to request a refund", err)
	}
	var requester, reason string
	if err := pool.QueryRow(ctx,
		`SELECT requester_id::text, reason FROM cf_refund_requests WHERE contribution_id = $1`, contributionID,
	).Scan(&requester, &reason); err != nil {
		t.Fatalf("read refund request: %v", err)
	}
	if requester != owner {
		t.Errorf("requester_id = %q, want the contributor %q", requester, owner)
	}

	// 4. A stranger cannot reword the owner's existing request via ON CONFLICT.
	if _, err := svc.RequestRefund(ctx, contributionID, stranger, "hijacked reason"); !errors.Is(err, creator.ErrNotFound) {
		t.Errorf("stranger overwrite: err = %v, want ErrNotFound", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT reason FROM cf_refund_requests WHERE contribution_id = $1`, contributionID,
	).Scan(&reason); err != nil {
		t.Fatalf("re-read refund request: %v", err)
	}
	if reason != "campaign stalled" {
		t.Errorf("reason = %q, want the owner's %q — a stranger must not be able to reword it", reason, "campaign stalled")
	}
}
