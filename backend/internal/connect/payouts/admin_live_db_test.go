package connectpayouts

// Live-DB test for the CONNECT-001 admin payout surface: RegisterAdmin's
// list/detail/settle/reject routes, which did not exist at all before this
// change (the member group only ever exposed creator-facing POST/GET
// /payouts — the admin console's payout queue 404'd in production).
//
// Proves, against a REAL local Postgres:
//  1. the admin list route returns real rows (seeded via the actual member
//     Request() money path, not hand-inserted fixtures);
//  2. RBAC blocks a caller without connect.payouts.manage from settling;
//  3. the settle action mutates the row (status -> settled), confirmed by a
//     fresh DB read;
//  4. the reject action reverses the parked ledger debit BACK to the
//     creator's wallet (confirmed via ledger.GetBalance, a real DB read) and
//     marks the row failed;
//  5. reject is idempotent (retrying does not double-refund).
//
// ⚠️ GATED ON TEST_DATABASE_URL, DELIBERATELY WITH NO FALLBACK TO DATABASE_URL
// (the root .env DATABASE_URL points at the PRODUCTION Supabase pooler).
//
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/connect/payouts/ -run TestLiveDB -v

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/domain"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"spotlight/backend/internal/testsupport"
)

func newAdminTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB connect/payouts admin test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect test db: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// newTestCreator seeds a throwaway auth.users + user_profiles row (via the
// handle_new_user trigger) at KYC tier 2, so Request() (the real member money
// path) accepts a payout for it without the fail-closed tier gate tripping.
func newTestCreator(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2)`,
		id, "connect-payouts-admin-test-"+id+"@example.invalid"); err != nil {
		t.Fatalf("seed auth.users creator: %v", err)
	}
	testsupport.CleanupUser(t, pool, id)
	if _, err := pool.Exec(ctx,
		`UPDATE user_profiles SET kyc_tier = 2 WHERE id = $1`, id); err != nil {
		t.Fatalf("seed user_profiles kyc_tier: %v", err)
	}
	return id
}

// creditWallet gives the creator spendable wallet balance to pay out, via the
// SAME ledger the payout debit uses (no shortcut balance-column write).
func creditWallet(t *testing.T, ledgerSvc *ledger.Service, userID string, amountKobo int64) {
	t.Helper()
	ctx := context.Background()
	acc, err := ledgerSvc.GetOrCreateUserWallet(ctx, userID)
	if err != nil {
		t.Fatalf("get creator wallet: %v", err)
	}
	rev, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("get revenue account: %v", err)
	}
	if err := ledgerSvc.PostJournal(ctx, ledger.JournalEntry{
		Reference:       "test:credit:" + userID,
		IdempotencyKey:  "test:credit:" + uuid.NewString(),
		AmountKobo:      amountKobo,
		DebitAccountID:  rev.ID,
		CreditAccountID: acc.ID,
	}); err != nil {
		t.Fatalf("credit creator wallet: %v", err)
	}
}

// testReverser mirrors app.connectPayoutReverseAdapter exactly (it cannot
// import internal/app — that would be a cycle — so it reimplements the same
// two-line adapter over the same ledger.Service.PostReversal this package's
// PayoutReverser interface expects production code to call).
type testReverser struct{ ledger *ledger.Service }

func (r *testReverser) ReversePayout(ctx context.Context, creatorID, payoutID string, amountKobo int64) error {
	settleAcc, err := r.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return err
	}
	creatorWallet, err := r.ledger.GetOrCreateUserWallet(ctx, creatorID)
	if err != nil {
		return err
	}
	ref := "connect:payout:reject:" + payoutID
	idem := "connect:payout:reject:" + payoutID
	err = r.ledger.PostReversal(ctx, creatorWallet.ID, settleAcc.ID, amountKobo, ref, idem)
	if errors.Is(err, ledger.ErrDuplicate) {
		return nil
	}
	return err
}

type noopAuditor struct{}

func (noopAuditor) WriteAudit(context.Context, string, string, string, string, map[string]any) error {
	return nil
}

// buildAdminTestService wires a real Service against the live pool, exactly
// like connect_money_routes.go's RegisterConnectMoney does (same repo, same
// wallet/tier/settlement machinery), so this test exercises production wiring
// rather than a hand-rolled substitute.
func buildAdminTestService(t *testing.T, pool *pgxpool.Pool) (*Service, *ledger.Service) {
	t.Helper()
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	tiersSvc := tiers.NewService(pool)
	walletSvc := wallet.NewService(ledgerSvc, tiersSvc)
	settlement := &testSettlementAdapter{ledger: ledgerSvc}
	tierGate := &testTierGateAdapter{tiers: tiersSvc}
	svc := NewService(
		NewRepository(pool), walletSvc, settlement, tierGate,
		nil, noopAuditor{}, nil, &testReverser{ledger: ledgerSvc})
	return svc, ledgerSvc
}

type testSettlementAdapter struct{ ledger *ledger.Service }

func (s *testSettlementAdapter) SettlementAccountID(ctx context.Context) (string, error) {
	acc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

type testTierGateAdapter struct{ tiers *tiers.Service }

func (g *testTierGateAdapter) GetUserTier(ctx context.Context, userID string) (int, error) {
	t, err := g.tiers.GetUserTier(ctx, userID)
	if err != nil {
		return 0, err
	}
	return int(t), nil
}

// seedPayout runs the REAL member money path (Service.Request) so the seeded
// row is exactly what production would have created: a balanced ledger debit
// plus a connect_payouts row in 'requested' status.
func seedPayout(t *testing.T, svc *Service, creatorID string, amountKobo int64) *Payout {
	t.Helper()
	p, err := svc.Request(context.Background(), creatorID, "test:req:"+uuid.NewString(), RequestPayoutRequest{
		AmountKobo:     amountKobo,
		DestinationRef: "test-bank-ref",
	})
	if err != nil {
		t.Fatalf("seed payout via Request: %v", err)
	}
	return p
}

// fakeRBAC implements services.RBACService's CheckPermission only (the rest
// of the interface is unused by middleware.RequirePermission) so the test can
// exercise the REAL middleware.RequirePermission + REAL RegisterAdmin route
// wiring while controlling, per test-user, whether the permission is granted
// — proving the route is actually gated, not just documented as such.
type fakeRBAC struct{ grantedTo map[string]bool }

func (f *fakeRBAC) CheckPermission(userID, permission, scopeType, scopeID string) (bool, error) {
	return f.grantedTo[userID], nil
}

// The rest of services.RBACService is unused by middleware.RequirePermission
// (which calls CheckPermission alone) — stubbed only so *fakeRBAC satisfies
// the interface signature RequirePermission requires.
func (f *fakeRBAC) GetUserRoles(string) ([]string, error)            { return nil, nil }
func (f *fakeRBAC) GetUserScopes(string) ([]domain.UserScope, error) { return nil, nil }
func (f *fakeRBAC) GetUserPermissions(string, string, string) ([]string, error) {
	return nil, nil
}
func (f *fakeRBAC) ListRoles() ([]domain.Role, error) { return nil, nil }
func (f *fakeRBAC) CreateRole(role domain.Role) (domain.Role, error) {
	return domain.Role{}, nil
}
func (f *fakeRBAC) UpdateRole(string, domain.Role) (domain.Role, error) {
	return domain.Role{}, nil
}
func (f *fakeRBAC) CloneRole(string, string, string) (domain.Role, error) {
	return domain.Role{}, nil
}
func (f *fakeRBAC) DeleteRole(string) error                       { return nil }
func (f *fakeRBAC) ListPermissions() ([]domain.Permission, error) { return nil, nil }
func (f *fakeRBAC) CreatePermission(p domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (f *fakeRBAC) UpdatePermission(string, domain.Permission) (domain.Permission, error) {
	return domain.Permission{}, nil
}
func (f *fakeRBAC) GetPermissionMatrix() (services.PermissionMatrix, error) {
	return services.PermissionMatrix{}, nil
}
func (f *fakeRBAC) AssignPermissionToRole(string, string, string) error { return nil }
func (f *fakeRBAC) RemovePermissionFromRole(string, string) error       { return nil }
func (f *fakeRBAC) DeletePermission(string) error                       { return nil }
func (f *fakeRBAC) AssignRoleToUser(string, string, string, string, string) error {
	return nil
}
func (f *fakeRBAC) RemoveRoleFromUser(string, string, string) error { return nil }
func (f *fakeRBAC) GetUserStatus(string) (string, error)            { return "", nil }
func (f *fakeRBAC) SuspendUser(string) error                        { return nil }
func (f *fakeRBAC) UnsuspendUser(string) error                      { return nil }
func (f *fakeRBAC) LockUser(string) error                           { return nil }
func (f *fakeRBAC) UnlockUser(string) error                         { return nil }
func (f *fakeRBAC) ListAdminUsers(domain.AdminUserFilter) ([]domain.AdminUser, error) {
	return nil, nil
}
func (f *fakeRBAC) GetAdminUser(string) (domain.AdminUser, error) { return domain.AdminUser{}, nil }
func (f *fakeRBAC) UpdateAdminUser(string, map[string]any) (domain.AdminUser, error) {
	return domain.AdminUser{}, nil
}
func (f *fakeRBAC) BulkAssignRoleToUsers(string, string, string, string, []string) []services.BulkOpResult {
	return nil
}
func (f *fakeRBAC) BulkAssignRolesToUser(string, string, string, string, []string) []services.BulkOpResult {
	return nil
}
func (f *fakeRBAC) BulkAssignPermissionsToRole(string, string, []string) []services.BulkOpResult {
	return nil
}

// buildAdminRouter wires the REAL gin routes (middleware.RequirePermission +
// payouts.RegisterAdmin) exactly as connect_money_routes.go does, with a
// context-setting shim standing in for RequireAuthContext (which needs a full
// Supabase JWT round-trip this package cannot exercise) — everything AFTER
// auth (the permission check, the route handlers, the service, the DB) is the
// real production code path.
func buildAdminRouter(svc *Service, rbac *fakeRBAC) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	admin := r.Group("/api/connect/admin")
	admin.Use(func(c *gin.Context) {
		uid := c.GetHeader("X-Test-User")
		c.Set(middleware.AuthUserContextKey, domain.AuthenticatedUser{ID: uid})
		c.Set("user_id", uid)
		c.Next()
	})
	guard := func(permission string) gin.HandlerFunc {
		return middleware.RequirePermission(rbac, permission)
	}
	RegisterAdmin(admin, svc, guard)
	return r
}

func TestLiveDB_AdminListPayouts_ReturnsRealRows(t *testing.T) {
	pool := newAdminTestPool(t)
	svc, ledgerSvc := buildAdminTestService(t, pool)
	creator := newTestCreator(t, pool)
	creditWallet(t, ledgerSvc, creator, 5_000_00)

	p1 := seedPayout(t, svc, creator, 1_000_00)
	p2 := seedPayout(t, svc, creator, 2_000_00)

	rows, err := svc.AdminList(context.Background(), AdminListFilter{CreatorID: &creator})
	if err != nil {
		t.Fatalf("AdminList: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 real payout rows for creator, got %d", len(rows))
	}
	ids := map[string]bool{rows[0].ID: true, rows[1].ID: true}
	if !ids[p1.ID] || !ids[p2.ID] {
		t.Fatalf("AdminList rows do not match seeded payouts: got %+v, want %s and %s", ids, p1.ID, p2.ID)
	}
	// The creator tier must be resolved LIVE (not zero) for a tier-2 creator.
	for _, r := range rows {
		if r.CreatorTier != 2 {
			t.Errorf("payout %s: CreatorTier = %d, want 2 (live tier lookup)", r.ID, r.CreatorTier)
		}
	}
}

func TestLiveDB_AdminSettlePayouts_RBACBlocksNonAdmin(t *testing.T) {
	pool := newAdminTestPool(t)
	svc, ledgerSvc := buildAdminTestService(t, pool)
	creator := newTestCreator(t, pool)
	creditWallet(t, ledgerSvc, creator, 5_000_00)
	p := seedPayout(t, svc, creator, 1_000_00)

	nonAdmin := uuid.NewString()
	admin := uuid.NewString()
	rbac := &fakeRBAC{grantedTo: map[string]bool{admin: true}} // nonAdmin NOT granted
	router := buildAdminRouter(svc, rbac)

	// Non-admin caller: must be refused BEFORE the handler runs (403), and the
	// payout must be untouched.
	req := httptest.NewRequest(http.MethodPost, "/api/connect/admin/payouts/"+p.ID+"/settle",
		strings.NewReader(`{"settlementRef":"manual-bank-ref-1"}`))
	req.Header.Set("X-Test-User", nonAdmin)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin settle: status = %d, want 403 (RBAC must block); body: %s", rec.Code, rec.Body.String())
	}

	fresh, err := NewRepository(pool).Get(context.Background(), p.ID)
	if err != nil {
		t.Fatalf("re-read payout after blocked settle: %v", err)
	}
	if fresh.Status != "requested" {
		t.Fatalf("payout status changed despite RBAC block: got %q, want %q", fresh.Status, "requested")
	}

	// Admin caller with the permission: must succeed and the DB row must move
	// to 'settled' with the supplied settlement ref stamped.
	req2 := httptest.NewRequest(http.MethodPost, "/api/connect/admin/payouts/"+p.ID+"/settle",
		strings.NewReader(`{"settlementRef":"manual-bank-ref-1"}`))
	req2.Header.Set("X-Test-User", admin)
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("admin settle: status = %d, want 200; body: %s", rec2.Code, rec2.Body.String())
	}

	settled, err := NewRepository(pool).Get(context.Background(), p.ID)
	if err != nil {
		t.Fatalf("re-read payout after settle: %v", err)
	}
	if settled.Status != "settled" {
		t.Fatalf("payout status = %q after admin settle, want %q", settled.Status, "settled")
	}
	if settled.SettlementRef == nil || *settled.SettlementRef != "manual-bank-ref-1" {
		t.Fatalf("settlement_ref not stamped: got %+v", settled.SettlementRef)
	}
}

func TestLiveDB_AdminRejectPayout_ReversesLedgerAndMarksFailed(t *testing.T) {
	pool := newAdminTestPool(t)
	svc, ledgerSvc := buildAdminTestService(t, pool)
	creator := newTestCreator(t, pool)
	creditWallet(t, ledgerSvc, creator, 5_000_00)

	balanceBeforePayout, err := ledgerSvc.GetBalance(context.Background(), creator)
	if err != nil {
		t.Fatalf("get balance before payout: %v", err)
	}

	p := seedPayout(t, svc, creator, 1_500_00)

	balanceAfterPayout, err := ledgerSvc.GetBalance(context.Background(), creator)
	if err != nil {
		t.Fatalf("get balance after payout: %v", err)
	}
	if balanceAfterPayout != balanceBeforePayout-1_500_00 {
		t.Fatalf("payout debit did not reduce balance as expected: before=%d after=%d",
			balanceBeforePayout, balanceAfterPayout)
	}

	admin := uuid.NewString()
	got, err := svc.AdminReject(context.Background(), admin, p.ID, "provider declined the bank transfer")
	if err != nil {
		t.Fatalf("AdminReject: %v", err)
	}
	if got.Status != "failed" {
		t.Fatalf("AdminReject returned status %q, want %q", got.Status, "failed")
	}

	// Confirm via a FRESH DB read (not the in-memory return value) that the
	// row actually persisted as failed.
	fresh, err := NewRepository(pool).Get(context.Background(), p.ID)
	if err != nil {
		t.Fatalf("re-read payout after reject: %v", err)
	}
	if fresh.Status != "failed" {
		t.Fatalf("payout status in DB = %q after reject, want %q", fresh.Status, "failed")
	}

	// The reversal must have restored the creator's wallet balance to what it
	// was BEFORE the payout — confirmed by a real ledger balance read, not an
	// assumption about what the reversal should have done.
	balanceAfterReject, err := ledgerSvc.GetBalance(context.Background(), creator)
	if err != nil {
		t.Fatalf("get balance after reject: %v", err)
	}
	if balanceAfterReject != balanceBeforePayout {
		t.Fatalf("balance after reject = %d, want %d (fully restored)", balanceAfterReject, balanceBeforePayout)
	}

	// Idempotency: rejecting an already-failed payout again must be a safe
	// no-op — it must NOT double-refund the creator.
	got2, err := svc.AdminReject(context.Background(), admin, p.ID, "retry")
	if err != nil {
		t.Fatalf("AdminReject (retry): %v", err)
	}
	if got2.Status != "failed" {
		t.Fatalf("AdminReject retry status = %q, want %q", got2.Status, "failed")
	}
	balanceAfterRetry, err := ledgerSvc.GetBalance(context.Background(), creator)
	if err != nil {
		t.Fatalf("get balance after retry: %v", err)
	}
	if balanceAfterRetry != balanceBeforePayout {
		t.Fatalf("balance after retried reject = %d, want %d (must not double-refund)",
			balanceAfterRetry, balanceBeforePayout)
	}
}
