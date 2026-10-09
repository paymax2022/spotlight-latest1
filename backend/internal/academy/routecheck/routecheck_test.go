// routecheck_test.go — composition smoke tests for Spotlight Academy.
//
// The academy surface mounts conditionally: the master FEATURE_ACADEMY_ENABLED
// gate plus per-submodule rows in public.academy_feature_flags (each falling
// back to a FEATURE_ACADEMY_*_ENABLED compile-time default). Route registration
// happens ONCE at boot, so a Gin route conflict between two flag-gated packages
// is a boot panic that only surfaces when BOTH flags are on — the combination
// the seeded flags never exercised (academy.schools + academy.fees deadlocked
// route registration until the wildcard names were aligned).
//
// These tests build the REAL composition root (internal/app.RegisterAcademy)
// over a lazy pgx pool that never connects — the runtime flag store is
// unreadable, so the resolver falls back to the compile-time defaults passed
// in, which is exactly what we want to sweep.
package routecheck

import (
	"context"
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/app"
	"spotlight/backend/internal/finance/ledger"
	providerInterfaces "spotlight/backend/internal/provider"
)

// stubProvider satisfies provider.PaymentProvider without any network. It only
// needs to be non-nil so the fees payment + tuition money surfaces register.
type stubProvider struct{}

func (stubProvider) InitializePayment(context.Context, providerInterfaces.InitializePaymentRequest) (*providerInterfaces.InitializePaymentResponse, error) {
	return nil, nil
}
func (stubProvider) VerifyPayment(context.Context, string) (*providerInterfaces.PaymentStatus, error) {
	return nil, nil
}
func (stubProvider) InitiatePayout(context.Context, providerInterfaces.PayoutRequest) (*providerInterfaces.PayoutResponse, error) {
	return nil, nil
}
func (stubProvider) VerifyWebhookSignature([]byte, string) bool { return false }
func (stubProvider) Name() string                               { return "stub" }

func noopAuth(c *gin.Context) { c.Next() }

// lazyPool returns a pool that parses but can never dial (port 1 is refused
// instantly) — registration must not depend on a live DB, and the flag
// resolver's read failure must fall back to compile-time defaults.
func lazyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(),
		"postgres://postgres:postgres@127.0.0.1:1/postgres?connect_timeout=1")
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// register mounts the full academy surface with the given flag set over a lazy
// pool. Returns the registered route count. Any Gin tree conflict panics here —
// which is the DOA failure this test exists to catch.
func register(t *testing.T, exam, spine, edupay, credentials, live, schools, tutor, fees, tuition bool) int {
	t.Helper()
	pool := lazyPool(t)
	r := gin.New()
	finance := r.Group("/api/finance", noopAuth)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)

	app.RegisterAcademy(r, finance, pool, nil, noopAuth, ledgerSvc,
		nil /* rtcIssuer — nil → live stub */, nil /* bnplRail */, nil, /* disburseRail */
		nil /* billingRail */, nil /* payoutRail */, stubProvider{},
		exam, spine, edupay, credentials, live, schools, tutor, fees, tuition,
		nil /* webhookHandler */, true /* internalAcademyAPIEnabled */, "svc-token")
	return len(r.Routes())
}

// TestRegisterAcademyAllFlagsOn is the headline check: every sub-feature flag
// on simultaneously must not panic and must mount a substantial surface. This
// is the combination the seeded academy_feature_flags never exercised (schools
// was held OFF because of the /schools wildcard conflict documented in
// 20261030000000_academy_enable_flags.sql).
func TestRegisterAcademyAllFlagsOn(t *testing.T) {
	gin.SetMode(gin.TestMode)
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("RegisterAcademy panicked with all flags on: %v", r)
		}
	}()
	n := register(t, true, true, true, true, true, true, true, true, true)
	if n < 100 {
		t.Fatalf("expected a substantial route surface with all flags on, got %d routes", n)
	}
}

// TestRegisterAcademyFlagMatrix sweeps each flag-gated submodule individually
// over the always-on baseline, plus the historically-conflicting pairs. Any
// panic identifies the flag combination that cannot ship together.
func TestRegisterAcademyFlagMatrix(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name                                             string
		exam, spine, edupay, creds, live, schools, tutor bool
		fees, tuition                                    bool
	}{
		{"baseline only", false, false, false, false, false, false, false, false, false},
		{"exam", true, false, false, false, false, false, false, false, false},
		{"spine", false, true, false, false, false, false, false, false, false},
		{"edupay", false, false, true, false, false, false, false, false, false},
		{"credentials", false, false, false, true, false, false, false, false, false},
		{"live", false, false, false, false, true, false, false, false, false},
		{"schools", false, false, false, false, false, true, false, false, false},
		{"tutor", false, false, false, false, false, false, true, false, false},
		{"fees", false, false, false, false, false, false, false, true, false},
		{"tuition", false, false, false, false, false, false, false, false, true},
		{"fees+schools (seeded pair)", false, false, false, false, false, true, false, true, false},
		{"all phase-3/4 off-seed flags", false, false, true, true, true, true, true, false, false},
		{"seeded prod state", true, true, false, false, false, false, false, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("RegisterAcademy panicked for %q: %v", tc.name, r)
				}
			}()
			if n := register(t, tc.exam, tc.spine, tc.edupay, tc.creds, tc.live, tc.schools, tc.tutor, tc.fees, tc.tuition); n == 0 {
				t.Fatalf("no routes mounted for %q", tc.name)
			}
		})
	}
}

// TestRegisterAcademyMountsExpectedRoutes spot-checks that each flag actually
// mounts its documented surface (a flag that mounts nothing would pass the
// panic check while still being DOA).
func TestRegisterAcademyMountsExpectedRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	register(t, true, true, true, true, true, true, true, true, true)

	pool := lazyPool(t)
	r := gin.New()
	finance := r.Group("/api/finance", noopAuth)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	app.RegisterAcademy(r, finance, pool, nil, noopAuth, ledgerSvc,
		nil, nil, nil, nil, nil, stubProvider{},
		true, true, true, true, true, true, true, true, true,
		nil, true, "svc-token")

	have := map[string]bool{}
	for _, ri := range r.Routes() {
		have[ri.Method+" "+ri.Path] = true
	}
	want := []string{
		// edupay member + admin
		"POST /api/finance/academy/edupay/pay",
		"GET /api/academy/admin/edupay/admin/schools",
		// credentials + trade
		"GET /api/finance/academy/credentials",
		"GET /api/finance/academy/credentials/verify/:verificationId",
		"GET /api/finance/academy/credentials/:id",
		"GET /api/finance/academy/trade/hub",
		// live + community + moderation
		"GET /api/finance/academy/live/sessions",
		"POST /api/academy/admin/moderation/reports/:id/decide",
		// schools member + admin (the historical wildcard conflict)
		"GET /api/finance/academy/schools/mine",
		"GET /api/finance/academy/schools/:schoolId/overview",
		"POST /api/academy/admin/schools/admin/institutions",
		// tutor member + admin
		"POST /api/finance/academy/tutor/onboard",
		"GET /api/finance/academy/tutors",
		"GET /api/academy/admin/tutor/payouts",
		"POST /api/academy/admin/tutor/:id/verify",
		// fees
		"POST /api/finance/academy/schools",
		"GET /api/finance/academy/schools/:schoolId/export",
		// tuition member + internal + admin
		"POST /api/finance/academy/tuition/confirm",
		"POST /internal/finance/academy/tuition/confirm",
		"POST /api/academy/admin/tuition/plans",
		// exam
		"GET /api/finance/academy/exam/arenas",
		"GET /api/finance/academy/placement",
	}
	for _, w := range want {
		if !have[w] {
			t.Errorf("expected route missing: %s", w)
		}
	}
}

// Ensure a request to a mounted route reaches a handler (not required for the
// panic check; guards against silently empty groups). We can't execute real
// handlers without a DB — presence in the route table is the assertion.
func TestRouteTableNonEmpty(t *testing.T) {
	gin.SetMode(gin.TestMode)
	n := register(t, true, true, true, true, true, true, true, true, true)
	t.Logf("all-flags-on route count: %d", n)
	if n < 200 {
		t.Fatalf("route surface suspiciously small (%d) — flag-gated packages may not have mounted", n)
	}
}

var _ = http.MethodGet // keep net/http import for future request-level checks
