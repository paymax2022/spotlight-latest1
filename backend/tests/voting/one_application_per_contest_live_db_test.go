package voting_test

// One live application per contest — guards migration 20270125000000.
//
// The defect: a user could hold several live applications for the same open mic,
// so the admin list showed the same person registered twice and approving one
// left the other live. The index is PARTIAL — terminal statuses are excluded —
// so a rejected or withdrawn applicant can still apply again.
//
// The review RPC is here too, because the two belong to the same seam: the
// admin route calls review_registration_application so it cannot drift from the
// Go RegistrationAdminStore.SetStatus path.

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newApplication files a registration and removes it, plus anything the review
// RPC spawns from it.
func newApplication(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, status string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO public.registrations (
			user_id, contest_slug, reference, status, form_data,
			current_step, completion_percent, role)
		VALUES ($1, $2, $3, $4, '{}'::jsonb, 'review_submit', 100, 'public_user')
		RETURNING id::text`,
		userID, fixtureRegSlug, fixtureRef("REG"), status).Scan(&id)
	if err != nil {
		t.Fatalf("file application: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = pool.Exec(c, `DELETE FROM public.registration_status_events WHERE registration_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM public.contestants WHERE registration_id=$1`, id)
		_, _ = pool.Exec(c, `DELETE FROM public.registrations WHERE id=$1`, id)
	})
	return id
}

// applyAgain files a second application without registering cleanup on failure —
// the caller is testing whether it is allowed at all.
func applyAgain(ctx context.Context, pool *pgxpool.Pool, userID, status string) (string, error) {
	var id string
	err := pool.QueryRow(ctx, `
		INSERT INTO public.registrations (
			user_id, contest_slug, reference, status, form_data,
			current_step, completion_percent, role)
		VALUES ($1, $2, $3, $4, '{}'::jsonb, 'contest_selection', 0, 'public_user')
		RETURNING id::text`,
		userID, fixtureRegSlug, fixtureRef("REGX"), status).Scan(&id)
	return id, err
}

func TestRegistration_RejectsASecondLiveApplicationForTheSameContest(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	user := anyVoter(t, ctx, pool)
	newApplication(t, ctx, pool, user, "submitted")

	id, err := applyAgain(ctx, pool, user, "draft")
	if err == nil {
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM public.registrations WHERE id=$1`, id)
		})
		t.Fatal("a second live application was accepted; want a unique violation")
	}

	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("error = %v, want 23505 unique_violation on registrations_one_live_per_user_contest", err)
	}
}

// The index excludes terminal statuses precisely so this works: withdrawing
// must free the slot rather than lock the user out of the contest for good.
func TestRegistration_AllowsANewApplicationOnceTheFirstIsWithdrawn(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	user := anyVoter(t, ctx, pool)
	first := newApplication(t, ctx, pool, user, "submitted")

	if _, err := pool.Exec(ctx,
		`UPDATE public.registrations SET status='withdrawn' WHERE id=$1`, first); err != nil {
		t.Fatalf("withdraw: %v", err)
	}

	second, err := applyAgain(ctx, pool, user, "draft")
	if err != nil {
		t.Fatalf("re-application after a withdrawal was refused: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.registrations WHERE id=$1`, second)
	})
}

// The whole point of the seam: approving in the admin console must put the
// applicant on the roster in the same transaction as the status change, because
// the original defect was an approved participant who never appeared in the app.
func TestRegistration_PromotesOnApprovalAndDeactivatesOnRejection(t *testing.T) {
	pool := votingPool(t)
	ctx := context.Background()
	user := anyVoter(t, ctx, pool)
	id := newApplication(t, ctx, pool, user, "submitted")

	var promoted bool
	var contestant *string
	err := pool.QueryRow(ctx, `
		SELECT promoted, contestant_id::text
		  FROM public.review_registration_application($1, 'approved', 'go-live-db', 'admin')`,
		id).Scan(&promoted, &contestant)
	if err != nil {
		t.Fatalf("approve: %v", err)
	}
	if !promoted {
		t.Error("promoted = false on approval")
	}
	if contestant == nil || *contestant == "" {
		t.Error("no contestant id returned on approval — the applicant reached no roster")
	}

	var removed bool
	if err := pool.QueryRow(ctx, `
		SELECT removed
		  FROM public.review_registration_application($1, 'rejected', 'go-live-db', 'admin')`,
		id).Scan(&removed); err != nil {
		t.Fatalf("reject: %v", err)
	}
	if !removed {
		t.Error("removed = false on rejection")
	}

	var active bool
	if err := pool.QueryRow(ctx,
		`SELECT is_active FROM public.contestants WHERE registration_id=$1`, id).Scan(&active); err != nil {
		t.Fatalf("read roster row: %v — it must be deactivated, never deleted", err)
	}
	// Deactivated, never deleted: votes already cast reference this row.
	if active {
		t.Error("is_active = true after rejection")
	}
}
