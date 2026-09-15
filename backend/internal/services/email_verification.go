package services

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/integrations"
)

// EmailVerifier turns "this person controls this mailbox" into "this account is
// confirmed".
//
// It exists as a seam so the otp package never learns about Supabase, and so the
// OTP handler can be tested without a GoTrue instance.
type EmailVerifier interface {
	// ConfirmEmail marks the account for this address confirmed.
	//
	// Returns (false, nil) when there is NO account for the address. That is not
	// an error: the OTP endpoints deliberately accept any address, so proving
	// control of a mailbox with no account behind it is an ordinary outcome, and
	// the caller must answer identically either way or the endpoint becomes a
	// user-enumeration oracle.
	ConfirmEmail(ctx context.Context, email string) (bool, error)
}

// supabaseEmailVerifier reads the user id straight from auth.users and writes the
// confirmation through GoTrue's admin API.
//
// The read is SQL because GoTrue's admin list endpoint filters differently across
// versions and PostgREST cannot reach the auth schema; the write is the admin API
// because GoTrue owns that schema (see AdminConfirmEmail).
type supabaseEmailVerifier struct {
	db       *pgxpool.Pool
	supabase *integrations.SupabaseRestClient
}

// NewSupabaseEmailVerifier returns nil when either dependency is missing, so a
// caller can treat nil as "confirmation is not available here" rather than
// discovering it at the first verification.
func NewSupabaseEmailVerifier(db *pgxpool.Pool, supabase *integrations.SupabaseRestClient) EmailVerifier {
	if db == nil || supabase == nil || !supabase.Enabled() {
		return nil
	}
	return &supabaseEmailVerifier{db: db, supabase: supabase}
}

func (v *supabaseEmailVerifier) ConfirmEmail(ctx context.Context, email string) (bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return false, nil
	}

	id, alreadyConfirmed, err := authUserByEmail(ctx, v.db, email)
	if err != nil {
		return false, err
	}
	if id == "" {
		return false, nil // no account — an ordinary outcome, not a failure
	}
	if alreadyConfirmed {
		// Re-confirming is harmless, but skipping the round trip means a user who
		// verifies twice does not depend on GoTrue being reachable the second time.
		return true, nil
	}
	if err := v.supabase.AdminConfirmEmail(ctx, id); err != nil {
		return false, err
	}
	return true, nil
}

// authUserByEmail resolves a GoTrue user id from a lowercased address.
//
// SQL rather than GoTrue's admin list endpoint: PostgREST cannot reach the auth
// schema, and the admin list filter has changed shape across GoTrue versions. It
// is defined once and shared, because two copies of "how we find a user" drift,
// and the way they drift is that one of them stops lowercasing and silently
// reports "no account" for every address a client sent in mixed case.
//
// Reads public.platform_users, not auth.users: this pool runs as
// service_role, and Supabase never grants service_role access to the auth
// schema (SELECT ... FROM auth.users fails with "permission denied for table
// users"). platform_users.id mirrors auth.users.id 1:1
// (20260527100000_enterprise_auth_rbac.sql +
// 20260904000000_rbac_identity_bridge.sql), so the id returned here is
// exactly the GoTrue id the callers pass to the Supabase Admin API.
// email_verified_at is platform_users' own confirmation timestamp, kept in
// sync with GoTrue's email_confirmed_at by the same signup/verify flow.
//
// Returns ("", false, nil) when there is no such user.
func authUserByEmail(ctx context.Context, db *pgxpool.Pool, email string) (id string, confirmed bool, err error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || db == nil {
		return "", false, nil
	}
	err = db.QueryRow(ctx, `
		SELECT id::text, email_verified_at IS NOT NULL
		  FROM public.platform_users
		 WHERE lower(email) = $1
		   AND deleted_at IS NULL
		 LIMIT 1`, email).Scan(&id, &confirmed)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, confirmed, nil
}
