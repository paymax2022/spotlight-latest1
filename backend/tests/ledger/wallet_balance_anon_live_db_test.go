package ledger_test

// LIVE test: the anon API role must NOT be able to read public.wallet_balance.
//
// WHY THIS EXISTS (w9 prod incident, 2026-10-07)
// Migration 20271008000000 set security_invoker=true on the view and revoked
// anon/PUBLIC; production verified anon -> 42501. Hours later the same probe
// returned real rows (HTTP 200). The reverted state is exactly what a FRESH
// CREATE VIEW produces on Supabase: the platform's default privileges grant
// SELECT to anon/authenticated on every new object in public, and reloptions
// (security_invoker) are lost — so an out-of-band DROP+CREATE silently
// re-exposed every account's balance as a definer-rights view.
// Migration 20271011000000 re-locks the view and asserts the lock in-tx; this
// test is the regression sentinel that fails if the view is ever recreated
// permissively again, without needing a manual PostgREST probe.
// Gated on TEST_DATABASE_URL only, same as the conservation suite.

import (
	"context"
	"testing"
)

// TestLiveDB_WalletBalanceDeniesAnon runs the exact role switch PostgREST
// performs for an apikey-only caller (SET ROLE anon) and asserts the view is
// unreadable. A permissive recreate fails here even if the fix migration's
// assert was bypassed or the file was later edited.
func TestLiveDB_WalletBalanceDeniesAnon(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()

	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	defer conn.Release()

	// What PostgREST does with an anon-key request.
	if _, err := conn.Exec(ctx, "SET ROLE anon"); err != nil {
		t.Skipf("SET ROLE anon unsupported on this database (%v) — local fixture lacks the Supabase API roles", err)
	}
	defer func() { _, _ = conn.Exec(ctx, "RESET ROLE") }()

	var n int
	err = conn.QueryRow(ctx, "SELECT count(*) FROM public.wallet_balance").Scan(&n)
	if err == nil {
		t.Fatalf("anon read wallet_balance (%d rows) — view is exposed; expected 42501 permission denied", n)
	}
}

// TestLiveDB_WalletBalanceInvokerAndGrants pins the two structural properties
// without needing the anon role to exist: security_invoker in reloptions and
// no SELECT privilege path for anon (has_table_privilege already includes
// PUBLIC grants).
func TestLiveDB_WalletBalanceInvokerAndGrants(t *testing.T) {
	pool := liveDBPool(t)
	ctx := context.Background()

	var invoker bool
	err := pool.QueryRow(ctx,
		`SELECT coalesce(c.reloptions::text,'') LIKE '%security_invoker=true%'
		 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname='public' AND c.relname='wallet_balance' AND c.relkind='v'`).Scan(&invoker)
	if err != nil {
		t.Fatalf("reloptions lookup: %v", err)
	}
	if !invoker {
		t.Fatal("public.wallet_balance lost security_invoker=true — it is definer-rights again (a recreated view leaks every balance)")
	}

	var anonSelect, authedSelect bool
	if err := pool.QueryRow(ctx,
		`SELECT has_table_privilege('anon','public.wallet_balance','SELECT'),
		        has_table_privilege('authenticated','public.wallet_balance','SELECT')`).Scan(&anonSelect, &authedSelect); err != nil {
		t.Skipf("privilege probe unsupported (%v) — local fixture lacks the Supabase API roles", err)
	}
	if anonSelect {
		t.Fatal("anon holds SELECT on public.wallet_balance — PostgREST will serve every balance to apikey-only callers")
	}
	if !authedSelect {
		t.Fatal("authenticated lost SELECT on public.wallet_balance — authenticated balance reads via PostgREST would 401")
	}
}
