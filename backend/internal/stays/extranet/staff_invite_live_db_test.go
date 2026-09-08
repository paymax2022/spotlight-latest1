package extranet

// LIVE-DB tests for the email-based hotelier staff invite (staff_invite.go).
//
// The property that matters most: the invite token is a credential. It must
// never be recoverable from the database (only its hash is stored), and it
// must bind to the invitee's own verified email — not a client-supplied one —
// so a forwarded link is useless to anyone else and a mismatched accept is
// rejected with the same error as an outright wrong token.
//
// Skips unless TEST_DATABASE_URL is set.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/testsupport"
)

func staffInvitePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping staff invite live-DB tests")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	return pool
}

// recordingMailer captures what would have gone to Resend, so tests can assert
// on invite content (including the accept link/token) without hitting the network.
type recordingMailer struct {
	invites []struct{ email, name, propertyName, role, acceptURL string }
	grants  []struct{ email, name, propertyName, role string }
}

func (m *recordingMailer) SendInvite(email, name, propertyName, role, acceptURL string) {
	m.invites = append(m.invites, struct{ email, name, propertyName, role, acceptURL string }{email, name, propertyName, role, acceptURL})
}
func (m *recordingMailer) SendGrantNotice(email, name, propertyName, role string) {
	m.grants = append(m.grants, struct{ email, name, propertyName, role string }{email, name, propertyName, role})
}

type inviteFixture struct {
	svc      *Service
	pool     *pgxpool.Pool
	mailer   *recordingMailer
	owner    string
	property string
}

func newInviteFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool) inviteFixture {
	t.Helper()
	owner := uuid.New().String()
	property := uuid.New().String()

	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)

	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_property
			(id, source_rail, supplier_code, supplier_property_ref, name, address, city, star_rating, property_type)
		VALUES ($1, 'DIRECT', 'self', $2, 'STF Invite Test Hotel', '1 St', 'Lagos', 4, 'hotel')`,
		property, uuid.New().String()); err != nil {
		t.Fatalf("seed property: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.stays_hotelier_profile (user_id, property_id, role, status)
		VALUES ($1, $2, 'OWNER', 'ACTIVE')`, owner, property); err != nil {
		t.Fatalf("seed owner grant: %v", err)
	}

	mailer := &recordingMailer{}
	svc := NewService(NewRepository(pool), NewAuthZ(pool), nil, mailer, "https://admin.test")

	t.Cleanup(func() {
		bg := context.Background()
		pool.Exec(bg, `DELETE FROM public.stays_staff_invite WHERE property_id = $1`, property)
		pool.Exec(bg, `DELETE FROM public.stays_hotelier_profile WHERE property_id = $1`, property)
		pool.Exec(bg, `DELETE FROM public.stays_property WHERE id = $1`, property)
	})
	return inviteFixture{svc: svc, pool: pool, mailer: mailer, owner: owner, property: property}
}

// seedPlatformUser creates an auth.users row for this email. The
// on_auth_user_created trigger (handle_new_user) mirrors it into
// platform_users automatically (20260904000000_rbac_identity_bridge.sql), so
// this is exactly the shape a real signed-up Paymax user has.
func seedPlatformUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, email string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, id, email); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	t.Cleanup(func() { pool.Exec(context.Background(), `DELETE FROM public.platform_users WHERE id = $1`, id) })
	return id
}

func acceptTokenFromURL(t *testing.T, acceptURL string) string {
	t.Helper()
	u, err := url.Parse(acceptURL)
	if err != nil {
		t.Fatalf("parse accept URL: %v", err)
	}
	tok := u.Query().Get("token")
	if tok == "" {
		t.Fatalf("accept URL has no token: %s", acceptURL)
	}
	return tok
}

func TestLiveDB_InviteExistingPlatformUserGrantsImmediately(t *testing.T) {
	pool := staffInvitePool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInviteFixture(t, ctx, pool)

	email := uuid.New().String() + "@existing.test"
	invitee := seedPlatformUser(t, ctx, pool, email)

	// Lowercase + mixed-case input to prove role/email normalization.
	res, err := f.svc.InviteStaffByEmail(ctx, f.owner, f.property, "Jane Manager", strings.ToUpper(email), "manager")
	if err != nil {
		t.Fatalf("InviteStaffByEmail: %v", err)
	}
	if res.Status != "active" {
		t.Errorf("status = %q, want active — the invitee already has a platform account", res.Status)
	}
	if res.Role != "MANAGER" {
		t.Errorf("role = %q, want MANAGER", res.Role)
	}

	var role, status string
	if err := pool.QueryRow(ctx,
		`SELECT role, status FROM public.stays_hotelier_profile WHERE user_id = $1 AND property_id = $2`,
		invitee, f.property).Scan(&role, &status); err != nil {
		t.Fatalf("read grant: %v", err)
	}
	if role != "MANAGER" || status != "ACTIVE" {
		t.Errorf("grant = (%s,%s), want (MANAGER,ACTIVE)", role, status)
	}

	if len(f.mailer.grants) != 1 {
		t.Errorf("grant-notice emails sent = %d, want 1", len(f.mailer.grants))
	}
	if len(f.mailer.invites) != 0 {
		t.Errorf("invite emails sent = %d, want 0 — the invitee already has an account", len(f.mailer.invites))
	}

	var pending int
	pool.QueryRow(ctx, `SELECT count(*) FROM public.stays_staff_invite WHERE property_id = $1`, f.property).Scan(&pending)
	if pending != 0 {
		t.Errorf("pending invite rows = %d, want 0 — an immediate grant needs no invite record", pending)
	}
}

func TestLiveDB_InviteUnknownEmailStoresOnlyTheTokenHash(t *testing.T) {
	pool := staffInvitePool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInviteFixture(t, ctx, pool)

	email := uuid.New().String() + "@unknown.test"
	res, err := f.svc.InviteStaffByEmail(ctx, f.owner, f.property, "Sam Frontdesk", email, "FRONT_DESK")
	if err != nil {
		t.Fatalf("InviteStaffByEmail: %v", err)
	}
	if res.Status != "invited" {
		t.Errorf("status = %q, want invited", res.Status)
	}

	if len(f.mailer.invites) != 1 {
		t.Fatalf("invite emails sent = %d, want 1", len(f.mailer.invites))
	}
	token := acceptTokenFromURL(t, f.mailer.invites[0].acceptURL)

	var storedHash, status string
	if err := pool.QueryRow(ctx,
		`SELECT token_hash, status FROM public.stays_staff_invite WHERE property_id = $1 AND email = $2`,
		f.property, strings.ToLower(email)).Scan(&storedHash, &status); err != nil {
		t.Fatalf("read invite row: %v", err)
	}
	if status != "PENDING" {
		t.Errorf("status = %s, want PENDING", status)
	}
	if storedHash == token {
		t.Error("the invite token is stored in plaintext")
	}
	sum := sha256.Sum256([]byte(token))
	if storedHash != hex.EncodeToString(sum[:]) {
		t.Error("stored hash does not match the token that was actually sent — accept would never succeed")
	}
}

func TestLiveDB_AcceptStaffInviteBindsToEmailAndIsSingleUse(t *testing.T) {
	pool := staffInvitePool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInviteFixture(t, ctx, pool)

	email := uuid.New().String() + "@accept.test"
	if _, err := f.svc.InviteStaffByEmail(ctx, f.owner, f.property, "Amara Finance", email, "finance"); err != nil {
		t.Fatalf("InviteStaffByEmail: %v", err)
	}
	token := acceptTokenFromURL(t, f.mailer.invites[0].acceptURL)

	invitee := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, invitee, email); err != nil {
		t.Fatalf("seed invitee: %v", err)
	}
	testsupport.CleanupUser(t, pool, invitee)

	// A forwarded link is useless to anyone else: wrong email, right token.
	if err := f.svc.AcceptStaffInvite(ctx, invitee, "someone-else@test.test", token); err != ErrInviteNotValid {
		t.Errorf("accept with mismatched email = %v, want ErrInviteNotValid", err)
	}

	// Right addressee, case-insensitive on the email.
	if err := f.svc.AcceptStaffInvite(ctx, invitee, strings.ToUpper(email), token); err != nil {
		t.Fatalf("AcceptStaffInvite: %v", err)
	}

	var role, status string
	if err := pool.QueryRow(ctx,
		`SELECT role, status FROM public.stays_hotelier_profile WHERE user_id = $1 AND property_id = $2`,
		invitee, f.property).Scan(&role, &status); err != nil {
		t.Fatalf("read grant: %v", err)
	}
	if role != "FINANCE" || status != "ACTIVE" {
		t.Errorf("grant = (%s,%s), want (FINANCE,ACTIVE)", role, status)
	}

	var inviteStatus string
	pool.QueryRow(ctx, `SELECT status FROM public.stays_staff_invite WHERE property_id = $1 AND email = $2`,
		f.property, strings.ToLower(email)).Scan(&inviteStatus)
	if inviteStatus != "ACCEPTED" {
		t.Errorf("invite status = %s, want ACCEPTED", inviteStatus)
	}

	// Replaying the same token must not resurrect the grant if it were later revoked.
	if err := f.svc.AcceptStaffInvite(ctx, invitee, email, token); err != ErrInviteNotValid {
		t.Errorf("second accept of the same token = %v, want ErrInviteNotValid", err)
	}
}

func TestLiveDB_AcceptStaffInviteRejectsAnExpiredInvite(t *testing.T) {
	pool := staffInvitePool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInviteFixture(t, ctx, pool)

	email := uuid.New().String() + "@expired.test"
	if _, err := f.svc.InviteStaffByEmail(ctx, f.owner, f.property, "", email, "READ_ONLY"); err != nil {
		t.Fatalf("InviteStaffByEmail: %v", err)
	}
	token := acceptTokenFromURL(t, f.mailer.invites[0].acceptURL)

	if _, err := pool.Exec(ctx,
		`UPDATE public.stays_staff_invite SET expires_at = now() - interval '1 hour' WHERE property_id = $1 AND email = $2`,
		f.property, strings.ToLower(email)); err != nil {
		t.Fatalf("backdate expiry: %v", err)
	}

	invitee := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, invitee, email); err != nil {
		t.Fatalf("seed invitee: %v", err)
	}
	testsupport.CleanupUser(t, pool, invitee)

	if err := f.svc.AcceptStaffInvite(ctx, invitee, email, token); err != ErrInviteNotValid {
		t.Errorf("accept of an expired invite = %v, want ErrInviteNotValid", err)
	}
}

func TestLiveDB_InviteRejectsOwnerRole(t *testing.T) {
	pool := staffInvitePool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInviteFixture(t, ctx, pool)

	if _, err := f.svc.InviteStaffByEmail(ctx, f.owner, f.property, "", "nobody@owner.test", "OWNER"); err == nil {
		t.Error("inviting OWNER succeeded — it must mirror the property creator only")
	}
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM public.stays_staff_invite WHERE property_id = $1`, f.property).Scan(&n)
	if n != 0 {
		t.Errorf("invite rows created for a rejected OWNER invite = %d, want 0", n)
	}
}

func TestLiveDB_InviteRequiresOwnerOrManager(t *testing.T) {
	pool := staffInvitePool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInviteFixture(t, ctx, pool)

	stranger := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, stranger, stranger+"@seed.test"); err != nil {
		t.Fatalf("seed stranger: %v", err)
	}
	testsupport.CleanupUser(t, pool, stranger)

	if _, err := f.svc.InviteStaffByEmail(ctx, stranger, f.property, "", "nobody@stranger-test.test", "READ_ONLY"); err != ErrForbidden {
		t.Errorf("invite by a non-staff caller = %v, want ErrForbidden", err)
	}
}

