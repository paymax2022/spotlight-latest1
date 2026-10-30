package estate

// LIVE-DB UAT for estate profile, configuration history, role-scoped invitations and ownership
// governance (profile.go + service.go CreateEstate/invite paths, migrations
// 20271099000040_estate_profile_governance.sql and 20271099000050_estate_invite_roles.sql).
//
// Closes docs/qa/estate-uat-443 estate-a M02 rows EST-UAT-0023 (duplicate review), 0028 (manager
// invite), 0031 (timezone), 0032 (governance policy version), 0035 (owner transfer), 0036 (branding
// and notices). Like the other *_live_db_test.go files these run against TEST_DATABASE_URL and skip
// when it is unset:
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:54322/postgres' \
//	  go test ./internal/estate/... -run TestLiveDB_Profile -v

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

func profileTestService(t *testing.T) (*Service, *pgxpool.Pool, context.Context) {
	t.Helper()
	pool := estateMeetingsTestPool(t)
	return newMeetingsTestService(pool), pool, context.Background()
}

// profileSeedEstate creates a live estate with a unique name so the EST-UAT-0023 duplicate rule
// cannot pick up rows left behind by another suite or an earlier run.
func profileSeedEstate(t *testing.T, ctx context.Context, pool *pgxpool.Pool, adminID string) string {
	t.Helper()
	estateID := uuid.New().String()
	name := "Profile Test Estate " + estateID[:8]
	if _, err := pool.Exec(ctx,
		`INSERT INTO estates (id, name, address, admin_id, status)
		 VALUES ($1,$2,$3,$4,'active')`,
		estateID, name, "7 "+estateID[:8]+" Crescent", adminID); err != nil {
		t.Fatalf("seed profile estate: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estates WHERE id=$1`, estateID) })
	seedResident(t, ctx, pool, estateID, adminID, "estate_admin")
	return estateID
}

func estateAdminID(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT admin_id::text FROM estates WHERE id=$1`, estateID).Scan(&id); err != nil {
		t.Fatalf("estate admin_id: %v", err)
	}
	return id
}

func residentRole(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, userID string) string {
	t.Helper()
	var role string
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT role FROM estate_residents WHERE estate_id=$1 AND user_id=$2`, estateID, userID).Scan(&role); err != nil {
		t.Fatalf("resident role for %s: %v", userID, err)
	}
	return role
}

func transferState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, transferID string) (string, bool) {
	t.Helper()
	var status string
	var decided bool
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT status, decided_at IS NOT NULL FROM estate_owner_transfers WHERE id=$1`, transferID).
		Scan(&status, &decided); err != nil {
		t.Fatalf("transfer state: %v", err)
	}
	return status, decided
}

func auditActionCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID, action string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT count(*) FROM estate_audit_log WHERE estate_id=$1 AND action=$2`, estateID, action).Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	return n
}

// EST-UAT-0031 — an estate carries an IANA timezone, defaults to the platform's implicit zone, and
// the database refuses a zone it does not know even when the writer is not the Go service.
func TestLiveDB_Profile_TimezoneDefaultsValidatesAndIsEnforcedInDB(t *testing.T) {
	svc, pool, ctx := profileTestService(t)
	admin := seedDuesUser(t, ctx, pool)
	estateID := profileSeedEstate(t, ctx, pool, admin)

	p, err := svc.GetEstateProfile(ctx, estateID, admin)
	if err != nil {
		t.Fatalf("GetEstateProfile: %v", err)
	}
	if p.Timezone != DefaultEstateTimezone {
		t.Fatalf("new estate timezone = %q, want the platform default %q", p.Timezone, DefaultEstateTimezone)
	}

	tz := "Europe/London"
	updated, err := svc.UpdateEstateProfile(ctx, estateID, admin, UpdateEstateProfileRequest{Timezone: &tz})
	if err != nil {
		t.Fatalf("UpdateEstateProfile(Europe/London): %v", err)
	}
	if updated.Timezone != "Europe/London" {
		t.Fatalf("timezone after patch = %q", updated.Timezone)
	}

	bad := "Africa/Lag0s"
	if _, err := svc.UpdateEstateProfile(ctx, estateID, admin, UpdateEstateProfileRequest{Timezone: &bad}); !errors.Is(err, ErrInvalidTimezone) {
		t.Fatalf("unknown zone: got %v, want ErrInvalidTimezone", err)
	}
	if got := estateTimezone(t, ctx, pool, estateID); got != "Europe/London" {
		t.Fatalf("refused write changed the stored zone to %q", got)
	}

	// The same row is writable by the BFF and by an operator with psql, so the gate lives in the
	// database too: a direct UPDATE with a made-up zone must fail on 22023.
	if _, err := pool.Exec(ctx, `UPDATE estates SET timezone=$2 WHERE id=$1`, estateID, "Mars/Phobos"); err == nil {
		t.Fatal("direct write of an unknown timezone succeeded — the DB gate is missing")
	} else {
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "22023" {
			t.Fatalf("direct unknown-zone write error = %v, want SQLSTATE 22023", err)
		}
	}
}

func estateTimezone(t *testing.T, ctx context.Context, pool *pgxpool.Pool, estateID string) string {
	t.Helper()
	var tz string
	if err := pool.QueryRow(context.WithoutCancel(ctx),
		`SELECT timezone FROM estates WHERE id=$1`, estateID).Scan(&tz); err != nil {
		t.Fatalf("estate timezone: %v", err)
	}
	return tz
}

// EST-UAT-0036 — branding and the resident notice are presentation, restricted to the keys the
// clients read, and never a privilege: a plain member cannot set them.
func TestLiveDB_Profile_BrandingAndNoticeAreAdminOnlyAndBounded(t *testing.T) {
	svc, pool, ctx := profileTestService(t)
	admin := seedDuesUser(t, ctx, pool)
	member := seedDuesUser(t, ctx, pool)
	estateID := profileSeedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, member, RoleResident)

	branding := json.RawMessage(`{"logo_url":"https://cdn.local/alpha.png","primary_color":"#1f2933"}`)
	notice := "Water tank maintenance on the 12th, 08:00-11:00."
	p, err := svc.UpdateEstateProfile(ctx, estateID, admin, UpdateEstateProfileRequest{Branding: &branding, Notice: &notice})
	if err != nil {
		t.Fatalf("UpdateEstateProfile(branding+notice): %v", err)
	}
	if !strings.Contains(string(p.Branding), "1f2933") || p.Notice != notice {
		t.Fatalf("profile after patch: branding=%s notice=%q", p.Branding, p.Notice)
	}

	// An unknown key is refused rather than stored, so it cannot become an implicit contract.
	unknown := json.RawMessage(`{"primary_color":"#000000","launch_calendar":"secret"}`)
	if _, err := svc.UpdateEstateProfile(ctx, estateID, admin, UpdateEstateProfileRequest{Branding: &unknown}); !errors.Is(err, ErrInvalidBranding) {
		t.Fatalf("unknown branding key: got %v, want ErrInvalidBranding", err)
	}
	badColor := json.RawMessage(`{"primary_color":"reddish"}`)
	if _, err := svc.UpdateEstateProfile(ctx, estateID, admin, UpdateEstateProfileRequest{Branding: &badColor}); !errors.Is(err, ErrInvalidBranding) {
		t.Fatalf("malformed colour: got %v, want ErrInvalidBranding", err)
	}
	notAnObject := json.RawMessage(`["a","b"]`)
	if _, err := svc.UpdateEstateProfile(ctx, estateID, admin, UpdateEstateProfileRequest{Branding: &notAnObject}); !errors.Is(err, ErrInvalidBranding) {
		t.Fatalf("array branding: got %v, want ErrInvalidBranding", err)
	}

	long := strings.Repeat("a", maxEstateNoticeLen+1)
	if _, err := svc.UpdateEstateProfile(ctx, estateID, admin, UpdateEstateProfileRequest{Notice: &long}); !errors.Is(err, ErrNoticeTooLong) {
		t.Fatalf("over-length notice: got %v, want ErrNoticeTooLong", err)
	}
	// Multi-byte text: the limit is characters, matching char_length() in the database, not bytes.
	runes := strings.Repeat("é", maxEstateNoticeLen)
	if _, err := svc.UpdateEstateProfile(ctx, estateID, admin, UpdateEstateProfileRequest{Notice: &runes}); err != nil {
		t.Fatalf("notice of exactly %d characters refused: %v", maxEstateNoticeLen, err)
	}

	if _, err := svc.UpdateEstateProfile(ctx, estateID, member, UpdateEstateProfileRequest{Notice: &notice}); err == nil {
		t.Fatal("a plain member changed the estate profile")
	}
	if _, err := svc.GetEstateProfile(ctx, estateID, member); err != nil {
		t.Fatalf("a member must be able to read the profile they are shown: %v", err)
	}
	if n := auditActionCount(t, ctx, pool, estateID, "ESTATE_PROFILE_SET"); n == 0 {
		t.Fatal("profile writes were not audited")
	}
}

// EST-UAT-0032 — every governance rule / subscription write leaves an immutable, ordered revision,
// written by the trigger so a writer cannot skip it.
func TestLiveDB_Profile_ConfigRevisionHistory(t *testing.T) {
	svc, pool, ctx := profileTestService(t)
	admin := seedDuesUser(t, ctx, pool)
	estateID := profileSeedEstate(t, ctx, pool, admin)

	if _, err := svc.SetEstateRules(ctx, estateID, admin, json.RawMessage(`{"dues_due_day":5}`)); err != nil {
		t.Fatalf("SetEstateRules v1: %v", err)
	}
	if _, err := svc.SetEstateRules(ctx, estateID, admin, json.RawMessage(`{"dues_due_day":10}`)); err != nil {
		t.Fatalf("SetEstateRules v2: %v", err)
	}
	// Writing the same value again must not mint a revision: the history is a change log.
	if _, err := svc.SetEstateRules(ctx, estateID, admin, json.RawMessage(`{"dues_due_day":10}`)); err != nil {
		t.Fatalf("SetEstateRules repeat: %v", err)
	}

	revs, err := svc.GetEstateConfigHistory(ctx, estateID, admin, "rules", 0)
	if err != nil {
		t.Fatalf("GetEstateConfigHistory: %v", err)
	}
	if len(revs) != 2 {
		t.Fatalf("rule revisions = %d, want 2 (a no-change write must not version): %+v", len(revs), revs)
	}
	if revs[0].Version != 2 || revs[1].Version != 1 {
		t.Fatalf("revision order/versions wrong: v%d then v%d", revs[0].Version, revs[1].Version)
	}
	if !strings.Contains(string(revs[0].Value), "10") || !strings.Contains(string(revs[0].PreviousValue), "5") {
		t.Fatalf("v2 revision lost its value/previous: value=%s previous=%s", revs[0].Value, revs[0].PreviousValue)
	}
	if revs[1].PreviousValue != nil && len(revs[1].PreviousValue) > 0 && string(revs[1].PreviousValue) != "{}" {
		t.Fatalf("v1 should have no predecessor, got %s", revs[1].PreviousValue)
	}
	if revs[0].ChangedBy != admin {
		t.Fatalf("revision changed_by = %q, want the acting admin %q", revs[0].ChangedBy, admin)
	}

	// The two governance columns are versioned independently.
	plan := json.RawMessage(`{"tier":"premium"}`)
	if _, err := pool.Exec(ctx,
		`UPDATE estate_config SET subscription_plan=$2, updated_by=$3 WHERE estate_id=$1`,
		estateID, plan, admin); err != nil {
		t.Fatalf("direct subscription_plan write: %v", err)
	}
	subRevs, err := svc.GetEstateConfigHistory(ctx, estateID, admin, "subscription_plan", 0)
	if err != nil {
		t.Fatalf("subscription history: %v", err)
	}
	if len(subRevs) != 1 || subRevs[0].Version != 1 {
		t.Fatalf("subscription revisions = %+v, want one version-1 row", subRevs)
	}

	if _, err := svc.GetEstateConfigHistory(ctx, estateID, admin, "not_a_column", 0); !errors.Is(err, ErrInvalidConfigColumn) {
		t.Fatalf("unknown config column = %v, want %v", err, ErrInvalidConfigColumn)
	}
	if _, err := svc.GetEstateConfigHistory(ctx, estateID, seedDuesUser(t, ctx, pool), "rules", 0); err == nil {
		t.Fatal("a non-admin read the governance history")
	}
}

// EST-UAT-0023 — a normalised (name, address) twin does not become a second live estate: it lands
// in the platform review queue flagged, and only a reviewer's decision takes it out of there.
func TestLiveDB_Profile_DuplicateEstateGoesToReviewQueue(t *testing.T) {
	svc, pool, ctx := profileTestService(t)
	admin := seedDuesUser(t, ctx, pool)
	name := "Gate Estate Dup " + uuid.New().String()[:8]
	address := " 14 Repetition Road "

	first, err := svc.CreateEstate(ctx, admin, CreateEstateRequest{Name: name, Address: address})
	if err != nil {
		t.Fatalf("CreateEstate(first): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estates WHERE id=$1`, first.ID)
	})
	if first.Status != EstateStatusActive || first.DuplicateSuspected {
		t.Fatalf("first estate: status=%s duplicate=%v, want active/false", first.Status, first.DuplicateSuspected)
	}

	// EST-UAT-0022 — gin's binding counts three spaces as a 3-character name, so a name no resident
	// could read has to be refused where the estate is actually built.
	if _, err := svc.CreateEstate(ctx, admin, CreateEstateRequest{Name: "   ", Address: address}); !errors.Is(err, ErrEstateNameRequired) {
		t.Fatalf("whitespace-only name: got %v, want ErrEstateNameRequired", err)
	}
	// The stored name is what was typed minus the padding, so a padded application still twins
	// against the estate it repeats.
	paddedName := "  Padded Estate " + uuid.New().String()[:8] + " "
	padded, err := svc.CreateEstate(ctx, admin, CreateEstateRequest{Name: paddedName, Address: "1 Padding Way"})
	if err != nil {
		t.Fatalf("CreateEstate(padded name): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estates WHERE id=$1`, padded.ID)
	})
	if padded.Name != strings.TrimSpace(paddedName) {
		t.Fatalf("stored name = %q, want %q", padded.Name, strings.TrimSpace(paddedName))
	}

	// Same estate, differently typed: extra whitespace and a different case.
	second, err := svc.CreateEstate(ctx, admin, CreateEstateRequest{
		Name:    strings.ToUpper(name),
		Address: address + "  ",
	})
	if err != nil {
		t.Fatalf("CreateEstate(duplicate): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estates WHERE id=$1`, second.ID)
	})
	if second.Status != EstateStatusPending || !second.DuplicateSuspected {
		t.Fatalf("duplicate estate: status=%s duplicate=%v, want pending/true", second.Status, second.DuplicateSuspected)
	}

	queue, err := svc.ListEstatesByStatus(ctx, EstateStatusPending, 200)
	if err != nil {
		t.Fatalf("review queue: %v", err)
	}
	var flagged *EstateLifecycle
	for i := range queue {
		if queue[i].EstateID == second.ID {
			flagged = &queue[i]
		}
	}
	if flagged == nil {
		t.Fatal("the duplicate is not in the platform review queue")
	}
	if !flagged.DuplicateSuspected {
		t.Fatal("the review queue row does not carry the duplicate flag")
	}

	// Rejecting a duplicate closes it, and a closed twin alone must not block a genuine later
	// application. Here the original estate is still live, so the twin rule correctly applies again.
	if _, err := svc.TransitionEstate(ctx, second.ID, admin, LifecycleReject, "duplicate of an existing estate"); err != nil {
		t.Fatalf("reject duplicate: %v", err)
	}
	newAdmin := seedDuesUser(t, ctx, pool)
	blocked, err := svc.CreateEstate(ctx, newAdmin, CreateEstateRequest{Name: name, Address: address})
	if err != nil {
		t.Fatalf("CreateEstate(twin of the live original): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estates WHERE id=$1`, blocked.ID)
	})
	if blocked.Status != EstateStatusPending {
		t.Fatalf("twin of a still-live estate: status=%s, want pending", blocked.Status)
	}

	// Once every twin is closed, the same identity is free to go live.
	if _, err := svc.TransitionEstate(ctx, blocked.ID, admin, LifecycleReject, "second duplicate"); err != nil {
		t.Fatalf("reject the second duplicate: %v", err)
	}
	if _, err := svc.TransitionEstate(ctx, first.ID, admin, LifecycleClose, "estate wound down"); err != nil {
		t.Fatalf("close the original: %v", err)
	}
	third, err := svc.CreateEstate(ctx, seedDuesUser(t, ctx, pool), CreateEstateRequest{Name: name, Address: address})
	if err != nil {
		t.Fatalf("CreateEstate(after reject): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estates WHERE id=$1`, third.ID)
	})
	if third.Status != EstateStatusActive {
		t.Fatalf("estate after the twin was closed: status=%s, want active", third.Status)
	}
	if n := auditActionCount(t, ctx, pool, second.ID, "ESTATE_CREATE_DUPLICATE_SUSPECTED"); n != 1 {
		t.Fatalf("duplicate audit rows = %d, want 1", n)
	}
}

// EST-UAT-0028 — an invitation carries the role it grants, so a co-manager can be invited without
// the owner handing over the estate, and a resident code can never demote an admin.
func TestLiveDB_Invite_ManagerCodeGrantsAdminAndResidentCodeCannotDemote(t *testing.T) {
	svc, pool, ctx := profileTestService(t)
	admin := seedDuesUser(t, ctx, pool)
	estateID := profileSeedEstate(t, ctx, pool, admin)

	future := time.Now().Add(24 * time.Hour)
	manager, err := svc.GenerateInviteCode(ctx, estateID, admin, GenerateInviteCodeRequest{
		MaxUses: 2, ExpiresAt: future, Role: RoleEstateAdmin,
	})
	if err != nil {
		t.Fatalf("GenerateInviteCode(manager): %v", err)
	}
	if manager.Role != RoleEstateAdmin {
		t.Fatalf("invite role = %q, want %q", manager.Role, RoleEstateAdmin)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estate_invite_codes WHERE id=$1`, manager.ID)
	})

	newManager := seedDuesUser(t, ctx, pool)
	r, err := svc.JoinWithInviteCode(ctx, newManager, manager.Code)
	if err != nil {
		t.Fatalf("JoinWithInviteCode(manager): %v", err)
	}
	if r.Role != RoleEstateAdmin {
		t.Fatalf("joined role = %q, want %q", r.Role, RoleEstateAdmin)
	}
	if got := residentRole(t, ctx, pool, estateID, newManager); got != RoleEstateAdmin {
		t.Fatalf("stored role = %q, want %q", got, RoleEstateAdmin)
	}
	if err := svc.assertEstateAdmin(ctx, estateID, newManager); err != nil {
		t.Fatalf("the invited co-manager is not an estate admin: %v", err)
	}
	// A role outside the two the membership table accepts is refused rather than stored.
	if _, err := svc.GenerateInviteCode(ctx, estateID, admin, GenerateInviteCodeRequest{
		MaxUses: 1, ExpiresAt: future, Role: "guard",
	}); err == nil {
		t.Fatal("an unknown invite role was accepted")
	}
	// Minting a manager code is an estate-admin action, whatever else the caller can do.
	plain := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, plain, RoleResident)
	if _, err := svc.GenerateInviteCode(ctx, estateID, plain, GenerateInviteCodeRequest{
		MaxUses: 1, ExpiresAt: future, Role: RoleEstateAdmin,
	}); err == nil {
		t.Fatal("a plain member minted a manager invite code")
	}

	residentCode, err := svc.GenerateInviteCode(ctx, estateID, admin, GenerateInviteCodeRequest{MaxUses: 3, ExpiresAt: future})
	if err != nil {
		t.Fatalf("GenerateInviteCode(default role): %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM estate_invite_codes WHERE id=$1`, residentCode.ID)
	})
	if residentCode.Role != RoleResident {
		t.Fatalf("default invite role = %q, want %q", residentCode.Role, RoleResident)
	}
	joined, err := svc.JoinWithInviteCode(ctx, seedDuesUser(t, ctx, pool), residentCode.Code)
	if err != nil {
		t.Fatalf("JoinWithInviteCode(resident): %v", err)
	}
	if joined.Role != RoleResident {
		t.Fatalf("resident code granted %q", joined.Role)
	}
	// The same resident code redeemed by the estate owner must not strip their admin role.
	if _, err := svc.JoinWithInviteCode(ctx, admin, residentCode.Code); err != nil {
		t.Fatalf("existing member redeeming a resident code: %v", err)
	}
	if got := residentRole(t, ctx, pool, estateID, admin); got != RoleEstateAdmin {
		t.Fatalf("resident code demoted the owner to %q", got)
	}
	// A banned membership is not reactivated or promoted by an invite.
	banned := seedDuesUser(t, ctx, pool)
	seedResident(t, ctx, pool, estateID, banned, RoleResident)
	if _, err := pool.Exec(ctx,
		`UPDATE estate_residents SET banned_at=NOW() WHERE estate_id=$1 AND user_id=$2`, estateID, banned); err != nil {
		t.Fatalf("ban member: %v", err)
	}
	if _, err := svc.JoinWithInviteCode(ctx, banned, manager.Code); err == nil {
		t.Fatal("a manager code revived a banned membership")
	}
	if got := residentRole(t, ctx, pool, estateID, banned); got != RoleResident {
		t.Fatalf("banned member's role changed to %q", got)
	}
}

// EST-UAT-0035 — an estate changes hands only when the incoming owner accepts, the privilege move
// is atomic, and every refusal path is refused in the database rather than in the caller.
func TestLiveDB_OwnerTransfer_AcceptIsTheOnlyWayOwnershipMoves(t *testing.T) {
	svc, pool, ctx := profileTestService(t)
	admin := seedDuesUser(t, ctx, pool)
	target := seedDuesUser(t, ctx, pool)
	outsider := seedDuesUser(t, ctx, pool)
	estateID := profileSeedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, target, RoleResident)

	// A non-member cannot be handed an estate.
	if _, err := svc.RequestOwnerTransfer(ctx, estateID, admin, RequestOwnerTransferBody{ToUserID: outsider}); !errors.Is(err, ErrOwnerTransferTargetNotMember) {
		t.Fatalf("transfer to a non-member: got %v, want ErrOwnerTransferTargetNotMember", err)
	}
	// A plain member cannot initiate one.
	if _, err := svc.RequestOwnerTransfer(ctx, estateID, target, RequestOwnerTransferBody{ToUserID: admin}); err == nil {
		t.Fatal("a non-owner opened an ownership transfer")
	}
	// Malformed handover requests are caller mistakes, not server failures: the handler answers 400
	// only because these carry sentinels.
	if _, err := svc.RequestOwnerTransfer(ctx, estateID, admin, RequestOwnerTransferBody{ToUserID: " "}); !errors.Is(err, ErrInvalidTransferTargetUser) {
		t.Fatalf("blank to_user_id: got %v, want ErrInvalidTransferTargetUser", err)
	}
	if _, err := svc.RequestOwnerTransfer(ctx, estateID, admin, RequestOwnerTransferBody{ToUserID: "not-a-uuid"}); !errors.Is(err, ErrInvalidTransferTargetUser) {
		t.Fatalf("unparseable to_user_id: got %v, want ErrInvalidTransferTargetUser", err)
	}
	if _, err := svc.RequestOwnerTransfer(ctx, estateID, admin, RequestOwnerTransferBody{ToUserID: admin}); !errors.Is(err, ErrOwnerTransferToSelf) {
		t.Fatalf("self transfer: got %v, want ErrOwnerTransferToSelf", err)
	}

	tr, err := svc.RequestOwnerTransfer(ctx, estateID, admin, RequestOwnerTransferBody{ToUserID: target, Reason: "relocating"})
	if err != nil {
		t.Fatalf("RequestOwnerTransfer: %v", err)
	}
	if tr.Status != OwnerTransferPending || tr.EstateID != estateID {
		t.Fatalf("transfer = %+v, want a pending row for this estate", tr)
	}
	// One live handover per estate.
	if _, err := svc.RequestOwnerTransfer(ctx, estateID, admin, RequestOwnerTransferBody{ToUserID: target}); !errors.Is(err, ErrOwnerTransferPending) {
		t.Fatalf("second pending transfer: got %v, want ErrOwnerTransferPending", err)
	}
	// Nothing has moved yet: the request is not the decision.
	if got := estateAdminID(t, ctx, pool, estateID); got != admin {
		t.Fatalf("ownership moved on request: admin_id=%q", got)
	}

	// An unrelated member — even one who can read the estate — cannot decide.
	if _, err := svc.DecideOwnerTransfer(ctx, estateID, outsider, tr.ID, true, ""); !errors.Is(err, ErrOwnerTransferParty) {
		t.Fatalf("outsider accept: got %v, want ErrOwnerTransferParty", err)
	}
	// The outgoing owner cannot accept their own offer.
	if _, err := svc.DecideOwnerTransfer(ctx, estateID, admin, tr.ID, true, ""); !errors.Is(err, ErrOwnerTransferTarget) {
		t.Fatalf("owner accept: got %v, want ErrOwnerTransferTarget", err)
	}
	// The estate in the path must match the transfer's estate.
	otherEstate := profileSeedEstate(t, ctx, pool, admin)
	if _, err := svc.DecideOwnerTransfer(ctx, otherEstate, target, tr.ID, true, ""); !errors.Is(err, ErrOwnerTransferNotFound) {
		t.Fatalf("decide under the wrong estate: got %v, want ErrOwnerTransferNotFound", err)
	}
	if got := estateAdminID(t, ctx, pool, estateID); got != admin {
		t.Fatalf("a mis-pathed decision moved ownership: admin_id=%q", got)
	}

	// The incoming owner accepts: one atomic move of the estate and both roles.
	out, err := svc.DecideOwnerTransfer(ctx, estateID, target, tr.ID, true, "accepted")
	if err != nil {
		t.Fatalf("DecideOwnerTransfer(accept): %v", err)
	}
	if out.Status != OwnerTransferAccepted || out.DecidedAt == nil {
		t.Fatalf("accepted transfer = %+v, want accepted with a decision time", out)
	}
	if got := estateAdminID(t, ctx, pool, estateID); got != target {
		t.Fatalf("admin_id after accept = %q, want %q", got, target)
	}
	if got := residentRole(t, ctx, pool, estateID, target); got != RoleEstateAdmin {
		t.Fatalf("incoming owner role = %q, want %q", got, RoleEstateAdmin)
	}
	if got := residentRole(t, ctx, pool, estateID, admin); got != RoleResident {
		t.Fatalf("outgoing owner role = %q, want %q", got, RoleResident)
	}
	if err := svc.assertEstateAdmin(ctx, estateID, target); err != nil {
		t.Fatalf("the new owner cannot administer: %v", err)
	}
	if err := svc.assertEstateAdmin(ctx, estateID, admin); err == nil {
		t.Fatal("the outgoing owner still administers the estate")
	}
	if n := auditActionCount(t, ctx, pool, estateID, "ESTATE_OWNER_TRANSFER_ACCEPTED"); n != 1 {
		t.Fatalf("acceptance audit rows = %d, want 1", n)
	}
	// A decided transfer is terminal.
	if _, err := svc.DecideOwnerTransfer(ctx, estateID, target, tr.ID, false, "second thoughts"); !errors.Is(err, ErrOwnerTransferNotPending) {
		t.Fatalf("re-deciding an accepted transfer: got %v, want ErrOwnerTransferNotPending", err)
	}
	if got := estateAdminID(t, ctx, pool, estateID); got != target {
		t.Fatalf("estate moved again after a terminal decision: admin_id=%q", got)
	}
}

// EST-UAT-0035 (decline / withdraw branches) — an offer the target refuses and an offer the owner
// takes back both leave the estate exactly where it was.
func TestLiveDB_OwnerTransfer_DeclineAndWithdrawKeepOwnership(t *testing.T) {
	svc, pool, ctx := profileTestService(t)

	for _, tc := range []struct {
		name       string
		decideAs   func(admin, target string) string
		wantStatus string
	}{
		{"declined by the target", func(a, tgt string) string { return tgt }, OwnerTransferDeclined},
		{"withdrawn by the owner", func(a, tgt string) string { return a }, OwnerTransferCancelled},
	} {
		t.Run(tc.name, func(t *testing.T) {
			admin := seedDuesUser(t, ctx, pool)
			target := seedDuesUser(t, ctx, pool)
			estateID := profileSeedEstate(t, ctx, pool, admin)
			seedResident(t, ctx, pool, estateID, target, RoleResident)

			tr, err := svc.RequestOwnerTransfer(ctx, estateID, admin, RequestOwnerTransferBody{ToUserID: target})
			if err != nil {
				t.Fatalf("RequestOwnerTransfer: %v", err)
			}
			actor := tc.decideAs(admin, target)
			out, err := svc.DecideOwnerTransfer(ctx, estateID, actor, tr.ID, false, "no thanks")
			if err != nil {
				t.Fatalf("DecideOwnerTransfer(decline): %v", err)
			}
			if out.Status != tc.wantStatus {
				t.Fatalf("status = %q, want %q", out.Status, tc.wantStatus)
			}
			status, decided := transferState(t, ctx, pool, tr.ID)
			if status != tc.wantStatus || !decided {
				t.Fatalf("stored transfer: status=%q decided=%v, want %q/true", status, decided, tc.wantStatus)
			}
			if got := estateAdminID(t, ctx, pool, estateID); got != admin {
				t.Fatalf("ownership moved on a %s offer: admin_id=%q", tc.wantStatus, got)
			}
			if got := residentRole(t, ctx, pool, estateID, admin); got != RoleEstateAdmin {
				t.Fatalf("outgoing owner was demoted by a declined offer: role=%q", got)
			}
			if got := residentRole(t, ctx, pool, estateID, target); got != RoleResident {
				t.Fatalf("target was promoted by a declined offer: role=%q", got)
			}
			// The estate is free to try again once an offer is off the table.
			again, err := svc.RequestOwnerTransfer(ctx, estateID, admin, RequestOwnerTransferBody{ToUserID: target})
			if err != nil {
				t.Fatalf("a decided transfer blocked a new offer: %v", err)
			}
			if again.Status != OwnerTransferPending {
				t.Fatalf("second offer status = %q, want pending", again.Status)
			}
		})
	}
}

// EST-UAT-0035 (visibility) — an offer is private to the two parties; a member who is not the
// target never sees it.
func TestLiveDB_OwnerTransfer_ListingIsScopedToTheParties(t *testing.T) {
	svc, pool, ctx := profileTestService(t)
	admin := seedDuesUser(t, ctx, pool)
	target := seedDuesUser(t, ctx, pool)
	other := seedDuesUser(t, ctx, pool)
	estateID := profileSeedEstate(t, ctx, pool, admin)
	seedResident(t, ctx, pool, estateID, target, RoleResident)
	seedResident(t, ctx, pool, estateID, other, RoleResident)

	tr, err := svc.RequestOwnerTransfer(ctx, estateID, admin, RequestOwnerTransferBody{ToUserID: target})
	if err != nil {
		t.Fatalf("RequestOwnerTransfer: %v", err)
	}
	if _, err := svc.ListOwnerTransfers(ctx, estateID, other, ""); err != nil {
		t.Fatalf("a member may list their transfers: %v", err)
	}
	// The listing never leaks an offer addressed to someone else.
	mine, err := svc.ListOwnerTransfers(ctx, estateID, other, "")
	if err != nil {
		t.Fatalf("ListOwnerTransfers(member): %v", err)
	}
	for _, row := range mine {
		if row.ID == tr.ID {
			t.Fatal("an unrelated member was shown a transfer addressed to somebody else")
		}
	}
	adminRows, err := svc.ListOwnerTransfers(ctx, estateID, admin, OwnerTransferPending)
	if err != nil {
		t.Fatalf("ListOwnerTransfers(admin): %v", err)
	}
	var found bool
	for _, row := range adminRows {
		if row.ID == tr.ID {
			found = true
			if row.ToUserID != target {
				t.Fatalf("listed transfer target = %q, want %q", row.ToUserID, target)
			}
		}
	}
	if !found {
		t.Fatal("the estate admin's own pending offer is missing from the listing")
	}
	if _, err := svc.ListOwnerTransfers(ctx, estateID, admin, "not-a-status"); !errors.Is(err, ErrInvalidTransferFilter) {
		t.Fatalf("unknown transfer status = %v, want %v", err, ErrInvalidTransferFilter)
	}
}
