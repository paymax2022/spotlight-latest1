package app

// Route-mount regression test for E2E-FIN-043: RegisterSocialPay was wired as
// RegisterSocialPay(finance.Group("/social"), ...) while social.Handler.Register
// adds its own "/social" segment — so the module was ONLY reachable at the
// double-mounted /api/finance/social/social/* and the documented
// /api/finance/social/* 404'd (the Next.js proxy at
// frontend-web/app/api/v1/social/[...path] forwards to the canonical path).
// The fix mounts the canonical path and keeps the doubled path live as a
// backward-compatible alias for already-deployed clients; this test pins both.
//
// pgxpool.New is lazy — no connection is opened until the first query, so the
// registration runs DB-free; admin routes are skipped (nil group) by design.

import (
	"context"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRegisterSocialPay_MountsCanonicalAndLegacyAlias(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://postgres:postgres@127.0.0.1:1/postgres")
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	gin.SetMode(gin.TestMode)
	r := gin.New()
	RegisterSocialPay(r.Group("/api/finance"), nil, pool, nil, nil)

	got := map[string]bool{}
	for _, rt := range r.Routes() {
		got[rt.Method+" "+rt.Path] = true
	}

	// Canonical paths the contract documents (and the web proxy + mobile call).
	for _, want := range []string{
		"POST /api/finance/social/send",
		"POST /api/finance/social/handle",
		"GET /api/finance/social/handle/me",
		"GET /api/finance/social/activity",
		"POST /api/finance/social/requests",
		"POST /api/finance/social/splits",
		"POST /api/finance/social/pools",
		"POST /api/finance/social/pools/:id/contribute",
	} {
		if !got[want] {
			t.Errorf("canonical route missing: %s", want)
		}
	}

	// The previously-only path must keep working as an alias — deployed e2e
	// suites and any shipped clients still call it.
	for _, want := range []string{
		"POST /api/finance/social/social/send",
		"GET /api/finance/social/social/activity",
		"POST /api/finance/social/social/pools/:id/contribute",
	} {
		if !got[want] {
			t.Errorf("legacy alias route missing: %s", want)
		}
	}
}
