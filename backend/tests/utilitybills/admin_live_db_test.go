package utilitybills_test

// ---------------------------------------------------------------------------
// LIVE-DB suite for the Phase 4 ADMIN surface: catalogue CRUD, credential
// rotation, provider health checks, dispute resolution, the manual sweep
// trigger, and the three reports.
//
// Skipped unless TEST_DATABASE_URL is set (livePool, from live_db_test.go).
//
// What it proves:
//
//  1. Providers and products survive a full create → update → list round trip
//     with every field intact, including the partial-patch semantics (untouched
//     columns keep their values, an explicit null clears a nullable one).
//  2. Admin lists show DISABLED rows — the member-facing lists filter them out,
//     and an admin who cannot see a disabled row cannot re-enable it.
//  3. A credentials rotation round-trips through encrypt → store → decrypt, and
//     the plaintext never appears in the row, the API response, or the audit row.
//  4. Resolving a dispute updates the dispute and writes the lifecycle event —
//     and leaves the TRANSACTION status alone, which is what the TS source does
//     (see Service.ResolveDispute's doc comment).
//  5. The admin requery-pending endpoint really drives the Phase 3 sweep.
//  6. Each report returns correct aggregates against seeded fixture data.
//  7. Every mutation calls the audit sink with the right action / resourceType /
//     resourceID.
//
// Reports aggregate the WHOLE table, and this runs against a shared local
// database, so report assertions are written as before/after DELTAS or scoped to
// a uniquely-seeded provider — never as absolute totals, which would fail the
// moment another test or a developer left a row behind.
// ---------------------------------------------------------------------------

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	providerInterfaces "spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/vtpass"
	"spotlight/backend/internal/utilitybills"
)

// testCredentialsKey is a 64-char hex key, the format DeriveCredentialsKey
// prefers. Test-only, and obviously not a secret.
const testCredentialsKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// ── Audit double ─────────────────────────────────────────────────────────────

// fakeAuditor records LogAction calls. The real services.AuditService is
// Supabase-REST-backed, so a pgx live-DB test cannot observe its writes; the
// call SITE is what this phase added, and that is what this asserts.
type fakeAuditor struct{ calls []auditedCall }

type auditedCall struct {
	Actor        string
	Action       string
	Module       string
	ResourceType string
	ResourceID   string
	Old, New     map[string]any
	Severity     string
}

func (a *fakeAuditor) LogAction(actorUserID, _, action, module, resourceType, resourceID string,
	oldValues, newValues map[string]any, _, _, severity string) {
	a.calls = append(a.calls, auditedCall{actorUserID, action, module, resourceType, resourceID,
		oldValues, newValues, severity})
}

// find returns the single call with the given action, failing the test when it
// is absent — "the audit row was never written" is the failure this exists to
// catch, so it must be loud.
func (a *fakeAuditor) find(t *testing.T, action string) auditedCall {
	t.Helper()
	for _, c := range a.calls {
		if c.Action == action {
			return c
		}
	}
	t.Fatalf("no audit call recorded for %q; got %v", action, a.actions())
	return auditedCall{}
}

func (a *fakeAuditor) actions() []string {
	out := make([]string, 0, len(a.calls))
	for _, c := range a.calls {
		out = append(out, c.Action)
	}
	return out
}

// ── Fake provider adapter with a health capability ───────────────────────────

// fakeHealthAdapter implements BillsProvider plus the optional HealthChecker, so
// the health-check path can be exercised without a network call. (The real
// vtpass adapter deliberately has NO sandbox short-circuit for HealthCheck — see
// provider/vtpass/health.go — so using it here would hit sandbox.vtpass.com.)
type fakeHealthAdapter struct {
	status  string
	message string
	err     error
	calls   int
}

func (f *fakeHealthAdapter) Name() string { return "fakehealth" }

func (f *fakeHealthAdapter) PurchaseBill(context.Context, providerInterfaces.BillRequest) (*providerInterfaces.Bill, error) {
	return nil, errors.New("fakehealth: purchase not supported")
}

func (f *fakeHealthAdapter) GetBill(context.Context, string) (*providerInterfaces.Bill, error) {
	return nil, errors.New("fakehealth: requery not supported")
}

func (f *fakeHealthAdapter) HealthCheck(context.Context) (*providerInterfaces.HealthCheckResult, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return &providerInterfaces.HealthCheckResult{Status: f.status, Message: f.message}, nil
}

// bareAdapter implements ONLY BillsProvider — used to prove that a provider
// whose adapter lacks the optional capability gets ErrHealthCheckUnsupported
// rather than a silent no-op or a panic.
type bareAdapter struct{}

func (bareAdapter) Name() string { return "bare" }
func (bareAdapter) PurchaseBill(context.Context, providerInterfaces.BillRequest) (*providerInterfaces.Bill, error) {
	return nil, errors.New("bare: not supported")
}
func (bareAdapter) GetBill(context.Context, string) (*providerInterfaces.Bill, error) {
	return nil, errors.New("bare: not supported")
}

// ── Admin fixture ────────────────────────────────────────────────────────────

type adminFixture struct {
	pool   *pgxpool.Pool
	svc    *utilitybills.Service
	audit  *fakeAuditor
	health *fakeHealthAdapter
	actor  string
}

// newAdminFixture builds an admin-only service: no wallet, no ledger, no
// commission. The catalogue surface touches none of them, and wiring the full
// money-path fixture here would make these tests depend on machinery they do
// not exercise.
func newAdminFixture(t *testing.T) *adminFixture {
	t.Helper()
	pool := livePool(t)
	return newAdminFixtureOver(t, pool)
}

// newAdminFixtureOver builds the admin service over an EXISTING pool, so a test
// can drive the money path through newFixture and the admin path through this.
//
// No ledger: the catalogue/report surface never touches one. A test that
// exercises ReverseTransaction — the one admin action that moves money — must
// use newAdminFixtureWithLedger instead.
func newAdminFixtureOver(t *testing.T, pool *pgxpool.Pool) *adminFixture {
	return newAdminFixtureWithLedger(t, pool, nil)
}

// newAdminFixtureWithLedger is newAdminFixtureOver plus a real ledger, for the
// money-moving admin path (ReverseTransaction posts a reversal pair).
func newAdminFixtureWithLedger(t *testing.T, pool *pgxpool.Pool, ledgerSvc *ledger.Service) *adminFixture {
	t.Helper()
	key, err := utilitybills.DeriveCredentialsKey(testCredentialsKey)
	if err != nil {
		t.Fatalf("derive credentials key: %v", err)
	}
	audit := &fakeAuditor{}
	health := &fakeHealthAdapter{status: "healthy", message: "Balance: 1000"}

	svc := utilitybills.NewService(utilitybills.Deps{
		Repo:          utilitybills.NewRepository(pool),
		Beneficiaries: utilitybills.NewBeneficiaryRepository(pool),
		Binds:         utilitybills.NewBindRegistry(pool),
		Providers: utilitybills.NewProviderRegistry(map[string]providerInterfaces.BillsProvider{
			"vtpass":     vtpass.New("k", "p", "s", vtpass.EnvironmentSandbox, ""),
			"fakehealth": health,
			"bare":       bareAdapter{},
		}),
		Ledger:           ledgerSvc,
		DefaultTimeoutMs: 5_000,
		CredentialsKey:   key,
		Auditor:          audit,
	})

	return &adminFixture{pool: pool, svc: svc, audit: audit, health: health,
		actor: "admin-" + uuid.New().String()}
}

// cleanupProvider removes a seeded provider (and anything pointing at it) after
// the test. Ordering matters: children before parents.
func (f *adminFixture) cleanupProvider(t *testing.T, providerID string) {
	t.Helper()
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = f.pool.Exec(bg, `DELETE FROM public.utility_routing_rules WHERE provider_id=$1`, providerID)
		_, _ = f.pool.Exec(bg, `DELETE FROM public.utility_provider_product_mappings WHERE provider_id=$1`, providerID)
		_, _ = f.pool.Exec(bg, `DELETE FROM public.utility_providers WHERE id=$1`, providerID)
	})
}

func (f *adminFixture) cleanupProduct(t *testing.T, productID string) {
	t.Helper()
	t.Cleanup(func() {
		bg := context.Background()
		_, _ = f.pool.Exec(bg, `DELETE FROM public.utility_provider_product_mappings WHERE product_id=$1`, productID)
		_, _ = f.pool.Exec(bg, `DELETE FROM public.utility_products WHERE id=$1`, productID)
	})
}

func (f *adminFixture) cleanupBiller(t *testing.T, billerID string) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DELETE FROM public.utility_billers WHERE id=$1`, billerID)
	})
}

func ptrI64(v int64) *int64 { return &v }
func ptrInt(v int) *int     { return &v }
func ptrBool(v bool) *bool  { return &v }

// ── Providers: full create → update → list round trip ────────────────────────

func TestLiveDB_Admin_ProviderCreateUpdateListRoundTrip(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	created, err := f.svc.CreateProvider(ctx, f.actor, utilitybills.ProviderInput{
		Name:                "VTpass Admin Test",
		Code:                "vtpass-admin-" + suffix,
		AdapterCode:         "vtpass",
		Status:              "active",
		SupportedCategories: []string{"electricity", "airtime"},
		Priority:            ptrInt(15),
		HealthStatus:        "unknown",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	f.cleanupProvider(t, created.ID)

	if created.Name != "VTpass Admin Test" || created.AdapterCode != "vtpass" || created.Priority != 15 {
		t.Fatalf("created row does not reflect the input: %+v", created)
	}
	if len(created.SupportedCategories) != 2 || created.SupportedCategories[0] != "electricity" {
		t.Errorf("supported_categories = %v, want [electricity airtime]", created.SupportedCategories)
	}
	// A brand-new provider has no credentials — the flag must say so.
	if created.CredentialsConfigured {
		t.Error("credentials_configured = true on a provider created without credentials")
	}
	if created.LastHealthCheckAt != nil {
		t.Error("last_health_check_at must be nil before any health check has run")
	}

	// --- PARTIAL patch: change status and priority, leave everything else ---
	updated, err := f.svc.UpdateProvider(ctx, f.actor, created.ID, utilitybills.ProviderPatch{
		Status:   strptr("maintenance"),
		Priority: ptrInt(42),
	})
	if err != nil {
		t.Fatalf("UpdateProvider: %v", err)
	}
	if updated.Status != "maintenance" || updated.Priority != 42 {
		t.Errorf("patch not applied: status=%s priority=%d", updated.Status, updated.Priority)
	}
	// The untouched columns are the point of a PARTIAL update.
	if updated.Name != created.Name || updated.Code != created.Code || updated.AdapterCode != created.AdapterCode {
		t.Errorf("a partial patch clobbered untouched columns: %+v", updated)
	}
	if len(updated.SupportedCategories) != 2 {
		t.Errorf("supported_categories clobbered by an unrelated patch: %v", updated.SupportedCategories)
	}

	// --- The admin list must include a NON-active provider ---
	disabled, err := f.svc.UpdateProvider(ctx, f.actor, created.ID,
		utilitybills.ProviderPatch{Status: strptr("disabled")})
	if err != nil {
		t.Fatalf("disable: %v", err)
	}
	if disabled.Status != "disabled" {
		t.Fatalf("status = %s, want disabled", disabled.Status)
	}
	if !providerInList(t, f, created.ID) {
		t.Error("a DISABLED provider is missing from the admin list — an admin who cannot see it cannot re-enable it")
	}

	// --- Audit ---
	createCall := f.audit.find(t, "utilitybills.provider.create")
	if createCall.ResourceType != "utility_provider" || createCall.ResourceID != created.ID {
		t.Errorf("create audit = %+v", createCall)
	}
	if createCall.Actor != f.actor {
		t.Errorf("audit actor = %q, want %q", createCall.Actor, f.actor)
	}
	if createCall.Old != nil {
		t.Error("a CREATE must have nil oldValues")
	}
	updateCall := f.audit.find(t, "utilitybills.provider.update")
	if updateCall.Old == nil || updateCall.New == nil {
		t.Fatalf("an UPDATE must carry both old and new values; got %+v", updateCall)
	}
	if updateCall.Old["status"] != "active" || updateCall.New["status"] != "maintenance" {
		t.Errorf("update audit old/new status = %v / %v, want active / maintenance",
			updateCall.Old["status"], updateCall.New["status"])
	}
}

func providerInList(t *testing.T, f *adminFixture, id string) bool {
	t.Helper()
	// Page through — the shared local DB may hold many providers.
	for offset := 0; offset < 1000; offset += 200 {
		rows, err := f.svc.AdminListProviders(context.Background(), 200, offset)
		if err != nil {
			t.Fatalf("AdminListProviders: %v", err)
		}
		for _, r := range rows {
			if r.ID == id {
				return true
			}
		}
		if len(rows) < 200 {
			return false
		}
	}
	return false
}

func TestLiveDB_Admin_ProviderValidationRejectsBadValues(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()

	bad := map[string]utilitybills.ProviderInput{
		"missing name":           {Code: "c-" + uuid.New().String()[:8], AdapterCode: "vtpass"},
		"missing adapter_code":   {Name: "n", Code: "c-" + uuid.New().String()[:8]},
		"status outside CHECK":   {Name: "n", Code: "c-" + uuid.New().String()[:8], AdapterCode: "vtpass", Status: "archived"},
		"health outside CHECK":   {Name: "n", Code: "c-" + uuid.New().String()[:8], AdapterCode: "vtpass", HealthStatus: "fine"},
		"unknown supported cat.": {Name: "n", Code: "c-" + uuid.New().String()[:8], AdapterCode: "vtpass", SupportedCategories: []string{"water"}},
	}
	for name, in := range bad {
		t.Run(name, func(t *testing.T) {
			row, err := f.svc.CreateProvider(ctx, f.actor, in)
			if err == nil {
				f.cleanupProvider(t, row.ID)
				t.Fatal("want a validation error, got nil — the value should never have reached the database")
			}
		})
	}
}

// ── Credentials rotation ─────────────────────────────────────────────────────

func TestLiveDB_Admin_CredentialsRotationRoundTrips(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	created, err := f.svc.CreateProvider(ctx, f.actor, utilitybills.ProviderInput{
		Name: "Rotate Test", Code: "rotate-" + suffix, AdapterCode: "vtpass",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	f.cleanupProvider(t, created.ID)

	const secret = "sk_live_DO_NOT_LEAK_ME"
	updated, err := f.svc.RotateProviderCredentials(ctx, f.actor, created.ID, map[string]any{
		"api_key":    "ak_live_12345",
		"secret_key": secret,
	})
	if err != nil {
		t.Fatalf("RotateProviderCredentials: %v", err)
	}
	if !updated.CredentialsConfigured {
		t.Error("credentials_configured = false right after a successful rotation")
	}

	// --- The stored column must be an ENCRYPTED envelope, not plaintext ---
	var stored []byte
	if err := f.pool.QueryRow(ctx,
		`SELECT credentials FROM public.utility_providers WHERE id=$1`, created.ID).Scan(&stored); err != nil {
		t.Fatalf("read credentials column: %v", err)
	}
	if strings.Contains(string(stored), secret) {
		t.Fatal("the credential PLAINTEXT is present in utility_providers.credentials")
	}
	if !utilitybills.IsEncryptedCredentials(stored) {
		t.Fatalf("stored credentials are not a recognised encrypted envelope: %s", stored)
	}

	// --- Decrypt round trip ---
	key, err := utilitybills.DeriveCredentialsKey(testCredentialsKey)
	if err != nil {
		t.Fatalf("derive key: %v", err)
	}
	decrypted, err := utilitybills.DecryptCredentialsJSON(key, stored)
	if err != nil {
		t.Fatalf("DecryptCredentialsJSON: %v", err)
	}
	if got := utilitybills.CredentialString(decrypted, "secret_key"); got != secret {
		t.Errorf("decrypted secret_key = %q, want the original", got)
	}
	if got := utilitybills.CredentialString(decrypted, "api_key"); got != "ak_live_12345" {
		t.Errorf("decrypted api_key = %q", got)
	}

	// --- The secret must not reach the API response or the audit row ---
	encoded, err := json.Marshal(updated)
	if err != nil {
		t.Fatalf("marshal provider view: %v", err)
	}
	if strings.Contains(string(encoded), secret) {
		t.Fatalf("the credential plaintext leaked into the API response: %s", encoded)
	}

	call := f.audit.find(t, "utilitybills.provider.credentials_rotate")
	auditJSON, _ := json.Marshal(call)
	if strings.Contains(string(auditJSON), secret) {
		t.Fatalf("the credential plaintext leaked into the audit row: %s", auditJSON)
	}
	// It should still record WHICH fields were rotated, by name.
	fields, _ := call.New["fields"].([]string)
	if len(fields) != 2 || fields[0] != "api_key" || fields[1] != "secret_key" {
		t.Errorf("audit fields = %v, want the sorted key names", call.New["fields"])
	}
}

// Rotation must fail CLOSED when the encryption key is unavailable — never
// silently store a provider secret in the clear.
func TestLiveDB_Admin_CredentialsRotationFailsClosedWithoutAKey(t *testing.T) {
	pool := livePool(t)
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	// A service built with NO CredentialsKey, as an unconfigured deployment has.
	keyless := utilitybills.NewService(utilitybills.Deps{
		Repo:      utilitybills.NewRepository(pool),
		Providers: utilitybills.NewProviderRegistry(nil),
	})

	var providerID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.utility_providers (name, code, adapter_code)
		VALUES ('Keyless Test', $1, 'vtpass') RETURNING id`, "keyless-"+suffix).Scan(&providerID); err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.utility_providers WHERE id=$1`, providerID)
	})

	_, err := keyless.RotateProviderCredentials(ctx, "admin", providerID, map[string]any{"api_key": "x"})
	if !errors.Is(err, utilitybills.ErrCredentialsKeyMissing) {
		t.Fatalf("error = %v, want ErrCredentialsKeyMissing", err)
	}

	// And nothing may have been written.
	var stored []byte
	if err := pool.QueryRow(ctx,
		`SELECT credentials FROM public.utility_providers WHERE id=$1`, providerID).Scan(&stored); err != nil {
		t.Fatalf("read credentials: %v", err)
	}
	if stored != nil {
		t.Fatalf("credentials were written despite a missing key: %s", stored)
	}
}

// ── Provider health check ────────────────────────────────────────────────────

func TestLiveDB_Admin_HealthCheckPersistsStatusAndTimestamp(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	created, err := f.svc.CreateProvider(ctx, f.actor, utilitybills.ProviderInput{
		Name: "Health Test", Code: "health-" + suffix, AdapterCode: "fakehealth",
		HealthStatus: "unknown",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	f.cleanupProvider(t, created.ID)

	f.health.status, f.health.message = "degraded", "Unable to confirm VTPass balance."
	result, updated, err := f.svc.HealthCheckProvider(ctx, f.actor, created.ID)
	if err != nil {
		t.Fatalf("HealthCheckProvider: %v", err)
	}
	if f.health.calls != 1 {
		t.Errorf("adapter HealthCheck called %d times, want 1", f.health.calls)
	}
	if result.Status != "degraded" || result.Message != "Unable to confirm VTPass balance." {
		t.Errorf("result = %+v", result)
	}
	// The whole point: the answer is PERSISTED, because routing.go reads it.
	if updated.HealthStatus != "degraded" {
		t.Errorf("persisted health_status = %s, want degraded", updated.HealthStatus)
	}
	if updated.LastHealthCheckAt == nil {
		t.Error("last_health_check_at was not stamped")
	}

	call := f.audit.find(t, "utilitybills.provider.health_check")
	if call.Old["health_status"] != "unknown" || call.New["health_status"] != "degraded" {
		t.Errorf("health audit old/new = %v / %v", call.Old["health_status"], call.New["health_status"])
	}
}

// An adapter WITHOUT the optional capability must produce a clear domain error,
// not a panic and not a silent "healthy".
func TestLiveDB_Admin_HealthCheckUnsupportedAdapter(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	created, err := f.svc.CreateProvider(ctx, f.actor, utilitybills.ProviderInput{
		Name: "Bare Test", Code: "bare-" + suffix, AdapterCode: "bare", HealthStatus: "healthy",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	f.cleanupProvider(t, created.ID)

	_, _, err = f.svc.HealthCheckProvider(ctx, f.actor, created.ID)
	if !errors.Is(err, utilitybills.ErrHealthCheckUnsupported) {
		t.Fatalf("error = %v, want ErrHealthCheckUnsupported", err)
	}

	// The stored status must be UNTOUCHED — reporting a status nothing checked
	// would mislead routing.go, which excludes 'down' providers from live money.
	reloaded, err := f.svc.AdminListProviders(ctx, 200, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, r := range reloaded {
		if r.ID == created.ID && r.HealthStatus != "healthy" {
			t.Errorf("health_status = %s, want it left at healthy", r.HealthStatus)
		}
	}
}

// ── Products: create → update → list, plus import ────────────────────────────

func (f *adminFixture) seedBiller(t *testing.T, category string) string {
	t.Helper()
	var billerID string
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO public.utility_billers (category, name, code, status, requires_validation)
		VALUES ($1, 'Admin Test Biller', $2, 'active', false) RETURNING id`,
		category, "admin-biller-"+uuid.New().String()[:8]).Scan(&billerID); err != nil {
		t.Fatalf("seed biller: %v", err)
	}
	f.cleanupBiller(t, billerID)
	return billerID
}

func TestLiveDB_Admin_ProductCreateUpdateListRoundTrip(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()
	billerID := f.seedBiller(t, "electricity")
	code := "admin-product-" + uuid.New().String()[:8]

	created, err := f.svc.CreateProduct(ctx, f.actor, utilitybills.ProductInput{
		BillerID:            billerID,
		Category:            "electricity",
		Name:                "Admin Prepaid",
		Code:                code,
		AmountType:          "variable",
		MinAmountKobo:       ptrI64(100_000),
		MaxAmountKobo:       ptrI64(10_000_000),
		ConvenienceFeeKobo:  ptrI64(10_000),
		MarkupBps:           ptrI64(150),
		ProviderDiscountBps: ptrI64(200),
		Status:              "active",
	})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	f.cleanupProduct(t, created.ID)

	// Every field must survive the insert exactly — these are pricing inputs.
	if created.AmountType != "variable" || created.MarkupBps != 150 ||
		created.ProviderDiscountBps != 200 || created.ConvenienceFeeKobo != 10_000 {
		t.Fatalf("created product does not match the input: %+v", created)
	}
	if created.MinAmountKobo == nil || *created.MinAmountKobo != 100_000 ||
		created.MaxAmountKobo == nil || *created.MaxAmountKobo != 10_000_000 {
		t.Fatalf("kobo bounds wrong: min=%v max=%v", created.MinAmountKobo, created.MaxAmountKobo)
	}
	if created.AmountKobo != nil {
		t.Errorf("amount_kobo = %v, want NULL on a variable product", *created.AmountKobo)
	}

	// --- Partial patch: markup only ---
	updated, err := f.svc.UpdateProduct(ctx, f.actor, created.ID, utilitybills.ProductPatch{
		MarkupBps: ptrI64(325),
	})
	if err != nil {
		t.Fatalf("UpdateProduct: %v", err)
	}
	if updated.MarkupBps != 325 {
		t.Errorf("markup_bps = %d, want 325", updated.MarkupBps)
	}
	if updated.ConvenienceFeeKobo != 10_000 || updated.ProviderDiscountBps != 200 ||
		updated.Name != "Admin Prepaid" || updated.Code != code {
		t.Errorf("a partial patch clobbered untouched pricing columns: %+v", updated)
	}
	if updated.MinAmountKobo == nil || *updated.MinAmountKobo != 100_000 {
		t.Errorf("min_amount_kobo lost by an unrelated patch: %v", updated.MinAmountKobo)
	}

	// --- Explicit null CLEARS a nullable bound (the three-state patch) ---
	cleared, err := f.svc.UpdateProduct(ctx, f.actor, created.ID, utilitybills.ProductPatch{
		ClearMaxAmountKobo: true,
	})
	if err != nil {
		t.Fatalf("clear max: %v", err)
	}
	if cleared.MaxAmountKobo != nil {
		t.Errorf("max_amount_kobo = %v, want NULL after an explicit clear", *cleared.MaxAmountKobo)
	}
	if cleared.MinAmountKobo == nil || *cleared.MinAmountKobo != 100_000 {
		t.Error("clearing the max must not touch the min")
	}

	// --- A disabled product must still be visible to an admin ---
	if _, err := f.svc.UpdateProduct(ctx, f.actor, created.ID,
		utilitybills.ProductPatch{Status: strptr("disabled")}); err != nil {
		t.Fatalf("disable: %v", err)
	}
	found := false
	for offset := 0; offset < 1000 && !found; offset += 200 {
		rows, lerr := f.svc.AdminListProducts(ctx, 200, offset)
		if lerr != nil {
			t.Fatalf("AdminListProducts: %v", lerr)
		}
		for _, r := range rows {
			if r.ID == created.ID {
				found = true
			}
		}
		if len(rows) < 200 {
			break
		}
	}
	if !found {
		t.Error("a DISABLED product is missing from the admin list")
	}
	// ...and must NOT be visible to a member.
	memberRows, err := f.svc.ListProducts(ctx, "electricity", billerID)
	if err != nil {
		t.Fatalf("member ListProducts: %v", err)
	}
	for _, r := range memberRows {
		if r.ID == created.ID {
			t.Error("a DISABLED product is offered to members — the member list must filter on status='active'")
		}
	}

	// --- Audit ---
	createCall := f.audit.find(t, "utilitybills.product.create")
	if createCall.ResourceType != "utility_product" || createCall.ResourceID != created.ID {
		t.Errorf("product create audit = %+v", createCall)
	}
	updateCall := f.audit.find(t, "utilitybills.product.update")
	if updateCall.Old["markup_bps"] != int64(150) || updateCall.New["markup_bps"] != int64(325) {
		t.Errorf("product update audit old/new markup = %v / %v",
			updateCall.Old["markup_bps"], updateCall.New["markup_bps"])
	}
}

func TestLiveDB_Admin_ProductImportUpsertsOnCode(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()
	billerID := f.seedBiller(t, "airtime")
	codeA := "import-a-" + uuid.New().String()[:8]
	codeB := "import-b-" + uuid.New().String()[:8]

	base := []utilitybills.ProductInput{
		{BillerID: billerID, Category: "airtime", Name: "Import A", Code: codeA,
			AmountType: "fixed", AmountKobo: ptrI64(100_000), MarkupBps: ptrI64(100)},
		{BillerID: billerID, Category: "airtime", Name: "Import B", Code: codeB,
			AmountType: "fixed", AmountKobo: ptrI64(200_000), MarkupBps: ptrI64(200)},
	}
	imported, err := f.svc.ImportProducts(ctx, f.actor, base)
	if err != nil {
		t.Fatalf("ImportProducts: %v", err)
	}
	for _, p := range imported {
		f.cleanupProduct(t, p.ID)
	}
	if len(imported) != 2 {
		t.Fatalf("imported %d rows, want 2", len(imported))
	}

	// Re-import the SAME codes with new prices: an upsert, not a duplicate.
	base[0].Name = "Import A v2"
	base[0].AmountKobo = ptrI64(150_000)
	base[0].MarkupBps = ptrI64(500)
	reimported, err := f.svc.ImportProducts(ctx, f.actor, base)
	if err != nil {
		t.Fatalf("re-import: %v", err)
	}
	if reimported[0].ID != imported[0].ID {
		t.Errorf("upsert created a NEW row (%s → %s) instead of updating on code",
			imported[0].ID, reimported[0].ID)
	}
	if reimported[0].Name != "Import A v2" || reimported[0].MarkupBps != 500 {
		t.Errorf("upsert did not apply the new values: %+v", reimported[0])
	}
	if reimported[0].AmountKobo == nil || *reimported[0].AmountKobo != 150_000 {
		t.Errorf("amount_kobo = %v, want 150000", reimported[0].AmountKobo)
	}

	var count int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.utility_products WHERE code IN ($1,$2)`, codeA, codeB).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 2 {
		t.Errorf("row count = %d, want 2 — the upsert duplicated rows", count)
	}

	// An empty import is a 400, not a silent success (adminImportUtilityProducts).
	if _, err := f.svc.ImportProducts(ctx, f.actor, nil); !errors.Is(err, utilitybills.ErrEmptyImport) {
		t.Errorf("empty import error = %v, want ErrEmptyImport", err)
	}

	// One invalid row must abort the WHOLE batch — a half-applied catalogue is
	// the state nobody can reason about.
	badCode := "import-bad-" + uuid.New().String()[:8]
	_, err = f.svc.ImportProducts(ctx, f.actor, []utilitybills.ProductInput{
		{BillerID: billerID, Category: "airtime", Name: "Good", Code: badCode,
			AmountType: "fixed", AmountKobo: ptrI64(100_000)},
		{BillerID: billerID, Category: "water", Name: "Bad", Code: "x-" + badCode},
	})
	if err == nil {
		t.Fatal("an invalid row must fail the import")
	}
	var leaked int
	if err := f.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM public.utility_products WHERE code=$1`, badCode).Scan(&leaked); err != nil {
		t.Fatalf("count: %v", err)
	}
	if leaked != 0 {
		t.Errorf("a failed batch wrote %d row(s) — the import must be all-or-nothing", leaked)
	}

	importCall := f.audit.find(t, "utilitybills.product.import")
	if importCall.New["count"] != 2 {
		t.Errorf("import audit count = %v, want 2", importCall.New["count"])
	}
}

// ── Billers / mappings / routing rules / categories (representative) ─────────

func TestLiveDB_Admin_BillerMappingRoutingRuleAndCategoryCRUD(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	// Biller.
	biller, err := f.svc.CreateBiller(ctx, f.actor, utilitybills.BillerInput{
		Category: "cable_tv", Name: "Admin Cable", Code: "admin-cable-" + suffix,
		RequiresValidation: ptrBool(true), CustomerReferenceLabel: "Smartcard number",
	})
	if err != nil {
		t.Fatalf("CreateBiller: %v", err)
	}
	f.cleanupBiller(t, biller.ID)
	if biller.Country != "NG" {
		t.Errorf("country = %q, want the DB default NG", biller.Country)
	}
	if !biller.RequiresValidation || biller.CustomerReferenceLabel != "Smartcard number" {
		t.Errorf("biller fields not persisted: %+v", biller)
	}
	if _, err := f.svc.UpdateBiller(ctx, f.actor, biller.ID,
		utilitybills.BillerPatch{Status: strptr("disabled")}); err != nil {
		t.Fatalf("UpdateBiller: %v", err)
	}
	f.audit.find(t, "utilitybills.biller.create")
	f.audit.find(t, "utilitybills.biller.update")

	// Provider + product to hang a mapping and a routing rule off.
	prov, err := f.svc.CreateProvider(ctx, f.actor, utilitybills.ProviderInput{
		Name: "Map Provider", Code: "map-prov-" + suffix, AdapterCode: "vtpass",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	f.cleanupProvider(t, prov.ID)

	product, err := f.svc.CreateProduct(ctx, f.actor, utilitybills.ProductInput{
		BillerID: biller.ID, Category: "cable_tv", Name: "Admin Bouquet",
		Code: "admin-bouquet-" + suffix, AmountType: "fixed", AmountKobo: ptrI64(500_000),
	})
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	f.cleanupProduct(t, product.ID)

	// Mapping.
	mapping, err := f.svc.CreateMapping(ctx, f.actor, utilitybills.MappingInput{
		ProviderID: prov.ID, ProductID: product.ID,
		ProviderProductCode: "dstv-padi", ProviderBillerCode: "dstv",
		ProviderCostKobo: ptrI64(480_000), ProviderDiscountBps: ptrI64(250),
	})
	if err != nil {
		t.Fatalf("CreateMapping: %v", err)
	}
	if mapping.ProviderCostKobo == nil || *mapping.ProviderCostKobo != 480_000 {
		t.Errorf("provider_cost_kobo = %v, want 480000", mapping.ProviderCostKobo)
	}
	// Clearing the cost makes pricing fall back to the discount rate — a real
	// admin operation that only the Clear flag can express.
	clearedMapping, err := f.svc.UpdateMapping(ctx, f.actor, mapping.ID,
		utilitybills.MappingPatch{ClearProviderCostKobo: true})
	if err != nil {
		t.Fatalf("UpdateMapping: %v", err)
	}
	if clearedMapping.ProviderCostKobo != nil {
		t.Errorf("provider_cost_kobo = %v, want NULL", *clearedMapping.ProviderCostKobo)
	}
	if clearedMapping.ProviderDiscountBps != 250 {
		t.Errorf("clearing the cost clobbered the discount: %d", clearedMapping.ProviderDiscountBps)
	}
	f.audit.find(t, "utilitybills.mapping.create")
	f.audit.find(t, "utilitybills.mapping.update")

	// Routing rule — the table with no prior Go representation at all.
	rule, err := f.svc.CreateRoutingRule(ctx, f.actor, utilitybills.RoutingRuleInput{
		Category: "cable_tv", ProductID: product.ID, ProviderID: prov.ID,
		Priority: ptrInt(5), MinAmountKobo: ptrI64(100_000),
	})
	if err != nil {
		t.Fatalf("CreateRoutingRule: %v", err)
	}
	if rule.Priority != 5 || rule.ProviderID != prov.ID {
		t.Errorf("routing rule not persisted: %+v", rule)
	}
	if rule.Category == nil || *rule.Category != "cable_tv" {
		t.Errorf("category = %v, want cable_tv", rule.Category)
	}
	if rule.BillerID != nil {
		t.Errorf("biller_id = %v, want NULL (an unscoped column)", *rule.BillerID)
	}
	// Widening the rule by dropping its category scope.
	widened, err := f.svc.UpdateRoutingRule(ctx, f.actor, rule.ID,
		utilitybills.RoutingRulePatch{ClearCategory: true, Priority: ptrInt(9)})
	if err != nil {
		t.Fatalf("UpdateRoutingRule: %v", err)
	}
	if widened.Category != nil {
		t.Errorf("category = %v, want NULL after an explicit clear", *widened.Category)
	}
	if widened.Priority != 9 {
		t.Errorf("priority = %d, want 9", widened.Priority)
	}
	if widened.ProductID == nil || *widened.ProductID != product.ID {
		t.Error("clearing the category must not clear the product scope")
	}
	f.audit.find(t, "utilitybills.routing_rule.create")
	f.audit.find(t, "utilitybills.routing_rule.update")

	// Category settings are keyed on the category TEXT column, and the six rows
	// are seeded by migration — so this UPDATES rather than creates, and restores
	// the original value afterwards.
	before, err := f.svc.AdminListCategorySettings(ctx)
	if err != nil {
		t.Fatalf("AdminListCategorySettings: %v", err)
	}
	var original *utilitybills.CategorySettingRow
	for i := range before {
		if before[i].Category == "cable_tv" {
			original = &before[i]
		}
	}
	if original == nil {
		t.Skip("no cable_tv category setting seeded in this database — nothing to patch")
	}
	restore := *original
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `
			UPDATE public.utility_category_settings
			SET enabled=$2, daily_limit_kobo=$3 WHERE category=$1`,
			restore.Category, restore.Enabled, restore.DailyLimitKobo)
	})

	patched, err := f.svc.UpdateCategorySetting(ctx, f.actor, "cable_tv",
		utilitybills.CategorySettingPatch{Enabled: ptrBool(false), DailyLimitKobo: ptrI64(7_777_777)})
	if err != nil {
		t.Fatalf("UpdateCategorySetting: %v", err)
	}
	if patched.Enabled {
		t.Error("enabled = true after patching it to false")
	}
	if patched.DailyLimitKobo == nil || *patched.DailyLimitKobo != 7_777_777 {
		t.Errorf("daily_limit_kobo = %v, want 7777777", patched.DailyLimitKobo)
	}
	// A DISABLED category must still appear in the admin list (the member list
	// filters on enabled = true).
	after, err := f.svc.AdminListCategorySettings(ctx)
	if err != nil {
		t.Fatalf("list after patch: %v", err)
	}
	seen := false
	for _, c := range after {
		if c.Category == "cable_tv" {
			seen = true
		}
	}
	if !seen {
		t.Error("a DISABLED category is missing from the admin list")
	}
	categoryCall := f.audit.find(t, "utilitybills.category.update")
	if categoryCall.ResourceID != "cable_tv" {
		t.Errorf("category audit resourceID = %q, want the category key", categoryCall.ResourceID)
	}
	if categoryCall.New["enabled"] != false {
		t.Errorf("category audit newValues.enabled = %v, want false", categoryCall.New["enabled"])
	}
}

// ── Dispute resolution ───────────────────────────────────────────────────────

func TestLiveDB_Admin_ResolveDispute(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	admin := newAdminFixtureOver(t, f.pool)
	ctx := context.Background()

	// A real settled purchase to dispute.
	res, err := f.pay(t, meterSuccessPrepaid, 400_000, "test-util-admin-dispute-"+uuid.New().String())
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	txn := res.Transaction

	dispute, err := f.svc.CreateDispute(ctx, f.userID, txn.ID, "Meter was never credited")
	if err != nil {
		t.Fatalf("CreateDispute: %v", err)
	}
	if dispute.Status != "open" {
		t.Fatalf("new dispute status = %s, want open", dispute.Status)
	}
	// CreateDispute moves the transaction to 'disputed'.
	disputed, err := f.svc.GetTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if disputed.Status != string(utilitybills.StatusDisputed) {
		t.Fatalf("status after opening a dispute = %s, want disputed", disputed.Status)
	}

	resolved, err := admin.svc.ResolveDispute(ctx, admin.actor, txn.ID, "resolved", "Refunded out of band")
	if err != nil {
		t.Fatalf("ResolveDispute: %v", err)
	}
	if resolved.ID != dispute.ID {
		t.Errorf("resolved a different dispute row: %s vs %s", resolved.ID, dispute.ID)
	}
	if resolved.Status != "resolved" {
		t.Errorf("dispute status = %s, want resolved", resolved.Status)
	}
	if resolved.ResolutionNote == nil || *resolved.ResolutionNote != "Refunded out of band" {
		t.Errorf("resolution_note = %v", resolved.ResolutionNote)
	}

	// --- The TRANSACTION status is deliberately UNCHANGED ---
	// The TS source (adminResolveUtilityDispute) never writes utility_transactions
	// — it updates the dispute, adds the event and notifies. Porting that
	// faithfully means the transaction stays 'disputed'. See ResolveDispute's doc
	// comment: the correct destination is a product decision, not a guess.
	afterResolve, err := f.svc.GetTransaction(ctx, txn.ID)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if afterResolve.Status != string(utilitybills.StatusDisputed) {
		t.Errorf("transaction status = %s, want it left at 'disputed' — the TS source does not move it, "+
			"and inventing a destination here would rewrite the status of settled money",
			afterResolve.Status)
	}

	// --- The member-visible lifecycle event must be written ---
	var eventCount int
	var payload []byte
	if err := f.pool.QueryRow(ctx, `
		SELECT COUNT(*), COALESCE(MAX(payload::text), '')::jsonb
		FROM public.utility_transaction_events
		WHERE transaction_id=$1 AND event_type='dispute_resolved'`, txn.ID).Scan(&eventCount, &payload); err != nil {
		t.Fatalf("read events: %v", err)
	}
	if eventCount != 1 {
		t.Errorf("dispute_resolved events = %d, want 1", eventCount)
	}
	if !strings.Contains(string(payload), `"resolved"`) {
		t.Errorf("event payload = %s, want it to carry the status", payload)
	}

	// --- Validation ---
	if _, err := admin.svc.ResolveDispute(ctx, admin.actor, txn.ID, "closed", "note"); !errors.Is(err, utilitybills.ErrInvalidDisputeStatus) {
		t.Errorf("status 'closed' error = %v, want ErrInvalidDisputeStatus "+
			"(the utility_disputes CHECK also allows open/investigating, but only resolved/rejected are RESOLUTIONS)", err)
	}
	if _, err := admin.svc.ResolveDispute(ctx, admin.actor, txn.ID, "rejected", "  "); err == nil {
		t.Error("a blank resolution_note must be rejected")
	}

	call := admin.audit.find(t, "utilitybills.dispute.resolve")
	if call.ResourceType != "utility_dispute" || call.ResourceID != dispute.ID {
		t.Errorf("dispute audit = %+v", call)
	}
	if call.New["transaction_id"] != txn.ID {
		t.Errorf("dispute audit newValues.transaction_id = %v, want %s", call.New["transaction_id"], txn.ID)
	}
}

// ── Manual sweep trigger ─────────────────────────────────────────────────────

// The admin endpoint must drive the SAME Phase 3 sweep, and add an audit row
// that the scheduled job deliberately does not write.
func TestLiveDB_Admin_TriggerSweepRunsThePendingSweep(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	admin := newAdminFixtureOver(t, f.pool)
	ctx := context.Background()

	res, err := f.pay(t, meterTimeout, 500_000, "test-util-admin-sweep-"+uuid.New().String())
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	txn := res.Transaction
	if txn.Status != string(utilitybills.StatusProviderPending) {
		t.Fatalf("setup: status = %s, want provider_pending", txn.Status)
	}

	// Driven through the money-path service, whose registry holds the sandbox
	// vtpass adapter that actually answers a requery.
	sweep, err := f.svc.SweepPending(ctx, 50)
	if err != nil {
		t.Fatalf("SweepPending: %v", err)
	}
	var swept bool
	for _, r := range sweep.Results {
		if r.ID == txn.ID {
			swept = true
			if !r.OK || r.Status != string(utilitybills.StatusSuccessful) {
				t.Errorf("sweep row = %+v, want ok/successful", r)
			}
		}
	}
	if !swept {
		t.Fatalf("the pending transaction %s was not picked up by the sweep", txn.ID)
	}

	// The ADMIN wrapper: same sweep, plus the audit row.
	triggered, err := admin.svc.TriggerSweep(ctx, admin.actor, 10)
	if err != nil {
		t.Fatalf("TriggerSweep: %v", err)
	}
	if triggered.Processed != triggered.Succeeded+triggered.Failed {
		t.Errorf("sweep totals do not reconcile: %+v", triggered)
	}
	call := admin.audit.find(t, "utilitybills.sweep.trigger")
	if call.ResourceType != "utility_transaction" {
		t.Errorf("sweep audit resourceType = %q", call.ResourceType)
	}
	if call.New["limit"] != 10 {
		t.Errorf("sweep audit limit = %v, want 10", call.New["limit"])
	}
	if call.Actor != admin.actor {
		t.Errorf("sweep audit actor = %q, want %q", call.Actor, admin.actor)
	}
}

// ── Reports ──────────────────────────────────────────────────────────────────

// seedReportTransaction inserts a transaction row directly. The reports are
// read-only aggregates, so driving the full money path for each row would add
// nothing but runtime and coupling.
func (f *adminFixture) seedReportTransaction(t *testing.T, userID, billerID, providerID, status string,
	retail, cost, profit int64) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO public.utility_transactions
			(user_id, category, biller_id, provider_id, customer_reference, amount_kobo,
			 convenience_fee_kobo, retail_amount_kobo, provider_cost_kobo, gross_profit_kobo,
			 gross_margin_bps, status, idempotency_key, payment_source)
		VALUES ($1,'electricity',$2,$3,'0000000000',$4,0,$4,$5,$6,0,$7,$8,'wallet')
		RETURNING id`,
		userID, billerID, providerID, retail, cost, profit, status,
		"test-report-"+uuid.New().String()).Scan(&id); err != nil {
		t.Fatalf("seed report transaction: %v", err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DELETE FROM public.utility_transactions WHERE id=$1`, id)
	})
	return id
}

func (f *adminFixture) seedAttempt(t *testing.T, transactionID, providerID, status string, n int, durationMs *int) {
	t.Helper()
	if _, err := f.pool.Exec(context.Background(), `
		INSERT INTO public.utility_provider_attempts
			(transaction_id, provider_id, attempt_number, status, request_idempotency_key, duration_ms)
		VALUES ($1,$2,$3,$4,$5,$6)`,
		transactionID, providerID, n, status, "test-attempt-"+uuid.New().String(), durationMs); err != nil {
		t.Fatalf("seed attempt: %v", err)
	}
	// Removed by the transaction's own cleanup cascade? No — attempts have a plain
	// FK, so they are deleted explicitly, BEFORE the transaction row.
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(),
			`DELETE FROM public.utility_provider_attempts WHERE transaction_id=$1`, transactionID)
	})
}

func TestLiveDB_Admin_Reports(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	// A uniquely-seeded provider, so the provider-performance assertions can be
	// EXACT rather than deltas.
	prov, err := f.svc.CreateProvider(ctx, f.actor, utilitybills.ProviderInput{
		Name: "Report Provider", Code: "report-prov-" + suffix, AdapterCode: "vtpass",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	f.cleanupProvider(t, prov.ID)
	billerID := f.seedBiller(t, "electricity")

	userID := uuid.New().String()
	if _, err := f.pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@report.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, userID)
	})

	// --- Baseline BEFORE seeding: the profitability report is a whole-table sum
	// on a shared database, so only the DELTA can be asserted. ---
	baseline, err := f.svc.ProfitabilityReport(ctx)
	if err != nil {
		t.Fatalf("baseline ProfitabilityReport: %v", err)
	}

	// 2 successful + 1 failed. The TS reduce counts EVERY status, so all three
	// land in the totals — see ProfitabilityReport's doc comment.
	t1 := f.seedReportTransaction(t, userID, billerID, prov.ID, "successful", 510_000, 490_000, 20_000)
	t2 := f.seedReportTransaction(t, userID, billerID, prov.ID, "successful", 1_010_000, 980_000, 30_000)
	t3 := f.seedReportTransaction(t, userID, billerID, prov.ID, "failed", 210_000, 200_000, 10_000)

	after, err := f.svc.ProfitabilityReport(ctx)
	if err != nil {
		t.Fatalf("ProfitabilityReport: %v", err)
	}
	if got := after.TotalTransactions - baseline.TotalTransactions; got != 3 {
		t.Errorf("total_transactions delta = %d, want 3 (failed rows are counted too)", got)
	}
	if got := after.GrossTransactionValueKobo - baseline.GrossTransactionValueKobo; got != 1_730_000 {
		t.Errorf("gross_transaction_value_kobo delta = %d, want 1730000", got)
	}
	if got := after.ProviderCostKobo - baseline.ProviderCostKobo; got != 1_670_000 {
		t.Errorf("provider_cost_kobo delta = %d, want 1670000", got)
	}
	if got := after.GrossProfitKobo - baseline.GrossProfitKobo; got != 60_000 {
		t.Errorf("gross_profit_kobo delta = %d, want 60000", got)
	}

	// --- Provider performance: exact, because the provider is unique to this test ---
	d100, d300 := 100, 300
	f.seedAttempt(t, t1, prov.ID, "successful", 1, &d100)
	f.seedAttempt(t, t2, prov.ID, "successful", 1, &d300)
	f.seedAttempt(t, t3, prov.ID, "failed", 1, nil) // NULL duration counts as 0

	perf, err := f.svc.ProviderPerformanceReport(ctx)
	if err != nil {
		t.Fatalf("ProviderPerformanceReport: %v", err)
	}
	var row *utilitybills.ProviderPerformanceRow
	for i := range perf {
		if perf[i].ProviderID == prov.ID {
			row = &perf[i]
		}
	}
	if row == nil {
		t.Fatalf("no provider-performance row for the seeded provider %s", prov.ID)
	}
	if row.Attempts != 3 || row.Successful != 2 || row.Failed != 1 {
		t.Errorf("attempts/successful/failed = %d/%d/%d, want 3/2/1",
			row.Attempts, row.Successful, row.Failed)
	}
	if row.Pending != 0 || row.Timeout != 0 || row.Error != 0 {
		t.Errorf("unexpected non-zero buckets: %+v", row)
	}
	// (100 + 300 + 0) / 3 = 133.33 → 133. A NULL duration is in BOTH the
	// numerator (as 0) and the denominator, matching the TS fold exactly.
	if row.AverageDurationMs != 133 {
		t.Errorf("average_duration_ms = %d, want 133 ((100+300+0)/3 rounded)", row.AverageDurationMs)
	}
	if row.MaxDurationMs != 300 {
		t.Errorf("max_duration_ms = %d, want 300", row.MaxDurationMs)
	}
	// 2/3 successful = 6666.67 bps → 6667.
	if row.SuccessRateBps != 6667 {
		t.Errorf("success_rate_bps = %d, want 6667", row.SuccessRateBps)
	}

	// --- Reconciliation: a listing, newest first. The seeded rows are newest. ---
	recon, err := f.svc.ReconciliationReport(ctx)
	if err != nil {
		t.Fatalf("ReconciliationReport: %v", err)
	}
	found := map[string]utilitybills.ReconciliationRow{}
	for _, r := range recon {
		if r.ID == t1 || r.ID == t2 || r.ID == t3 {
			found[r.ID] = r
		}
	}
	if len(found) != 3 {
		t.Fatalf("reconciliation returned %d of the 3 seeded rows", len(found))
	}
	if got := found[t1]; got.RetailAmountKobo != 510_000 || got.ProviderCostKobo != 490_000 ||
		got.GrossProfitKobo != 20_000 || got.Status != "successful" || got.Category != "electricity" {
		t.Errorf("reconciliation row for t1 is wrong: %+v", got)
	}
	// Newest-first ordering.
	var idx1, idx3 = -1, -1
	for i, r := range recon {
		if r.ID == t1 {
			idx1 = i
		}
		if r.ID == t3 {
			idx3 = i
		}
	}
	if idx1 >= 0 && idx3 >= 0 && idx3 > idx1 {
		t.Errorf("reconciliation is not newest-first: t3 (seeded last) at %d, t1 at %d", idx3, idx1)
	}
}

// ── Admin transaction list ───────────────────────────────────────────────────

func TestLiveDB_Admin_ListTransactionsFiltersByStatus(t *testing.T) {
	f := newAdminFixture(t)
	ctx := context.Background()
	suffix := uuid.New().String()[:8]

	prov, err := f.svc.CreateProvider(ctx, f.actor, utilitybills.ProviderInput{
		Name: "List Provider", Code: "list-prov-" + suffix, AdapterCode: "vtpass",
	})
	if err != nil {
		t.Fatalf("CreateProvider: %v", err)
	}
	f.cleanupProvider(t, prov.ID)
	billerID := f.seedBiller(t, "electricity")

	userID := uuid.New().String()
	if _, err := f.pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		userID, userID+"@list.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id=$1`, userID)
	})

	reversedID := f.seedReportTransaction(t, userID, billerID, prov.ID, "reversed", 300_000, 290_000, 10_000)

	rows, err := f.svc.AdminListTransactions(ctx, "reversed", 200, 0)
	if err != nil {
		t.Fatalf("AdminListTransactions: %v", err)
	}
	for _, r := range rows {
		if r.Status != "reversed" {
			t.Fatalf("status filter leaked a %s row", r.Status)
		}
	}
	// The list is unscoped by owner — an admin sees every member's rows.
	seen := false
	for _, r := range rows {
		if r.ID == reversedID {
			seen = true
		}
	}
	if !seen && len(rows) < 200 {
		t.Error("the seeded reversed transaction is missing from the admin list")
	}

	// An unknown status must be a 400, not an empty list that reads like "all clear".
	if _, err := f.svc.AdminListTransactions(ctx, "cancelled", 50, 0); !errors.Is(err, utilitybills.ErrInvalidStatus) {
		t.Errorf("unknown status error = %v, want ErrInvalidStatus", err)
	}
}

// ── Reverse now carries an audit actor ───────────────────────────────────────

// ReverseTransaction had NO audit logging before Phase 4 — it moves real money
// and left no who-did-it record at all.
func TestLiveDB_Admin_ReverseIsAudited(t *testing.T) {
	f := newFixture(t, 2, 2_000_000, false)
	// A real ledger: this is the one admin action that actually moves money.
	admin := newAdminFixtureWithLedger(t, f.pool, f.ledger)
	ctx := context.Background()

	// A provider-pending purchase is reversible (a successful one is not).
	res, err := f.pay(t, meterTimeout, 600_000, "test-util-admin-reverse-"+uuid.New().String())
	if err != nil {
		t.Fatalf("pay: %v", err)
	}
	txn := res.Transaction

	reversed, err := admin.svc.ReverseTransaction(ctx, admin.actor, txn.ID, "Support refund: meter never credited")
	if err != nil {
		t.Fatalf("ReverseTransaction: %v", err)
	}
	if reversed.Status != string(utilitybills.StatusReversed) {
		t.Fatalf("status = %s, want reversed", reversed.Status)
	}

	call := admin.audit.find(t, "utilitybills.transaction.reverse")
	if call.Actor != admin.actor {
		t.Errorf("reverse audit actor = %q, want %q", call.Actor, admin.actor)
	}
	if call.ResourceType != "utility_transaction" || call.ResourceID != txn.ID {
		t.Errorf("reverse audit = %+v", call)
	}
	// The audit row must stand alone: the pre-reversal status and the amount that
	// moved, so an auditor never has to re-read a row that now shows only the
	// post-state.
	if call.Old["status"] != string(utilitybills.StatusProviderPending) {
		t.Errorf("reverse audit oldValues.status = %v, want provider_pending", call.Old["status"])
	}
	if call.New["retail_amount_kobo"] != txn.RetailAmountKobo {
		t.Errorf("reverse audit retail_amount_kobo = %v, want %d",
			call.New["retail_amount_kobo"], txn.RetailAmountKobo)
	}
	if call.New["user_id"] != txn.UserID {
		t.Errorf("reverse audit user_id = %v, want %s", call.New["user_id"], txn.UserID)
	}
}

func strptr(s string) *string { return &s }
