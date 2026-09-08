package association_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// deleteOrganisation removes a seeded organisation and everything hanging off
// it, so a live-DB test does not leave an association behind in the shared
// local database.
//
// Depth-first over the real foreign-key graph, not a fixed number of levels.
// The first version unwound two levels and still could not delete anything with
// dues attached, because the chain is four deep:
//
//	assoc_organisations -> assoc_memberships -> assoc_dues_invoices
//	                    -> assoc_payments -> assoc_revenue_splits
//
// (one chain, five tables — the split across two lines is wrapping, not a fork)
//
// Children come from pg_catalog, so a new association table needs no change
// here. ledger_entries is never touched: ledger rows are immutable by rule.
func deleteOrganisation(ctx context.Context, pool *pgxpool.Pool, orgID string) {
	if pool == nil || orgID == "" {
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		return
	}
	cascadeDelete(ctx, pool, "assoc_organisations", "id", []string{orgID}, 0)
	_, _ = pool.Exec(ctx, `DELETE FROM assoc_organisations WHERE id=$1`, orgID)
}

// cascadeDelete removes every row that transitively references
// table.keyCol IN ids, deepest first. It does NOT delete the parent rows
// themselves — that is the caller's job once the children are gone.
func cascadeDelete(ctx context.Context, pool *pgxpool.Pool, table, keyCol string, ids []string, depth int) {
	// The association graph is a handful of levels deep; the bound is a stop
	// against a cycle, not a real limit.
	if len(ids) == 0 || depth > 8 {
		return
	}

	type child struct{ table, col string }
	var children []child
	rows, err := pool.Query(ctx, `
		SELECT fk.conrelid::regclass::text, att.attname
		  FROM pg_constraint fk
		  JOIN pg_attribute att ON att.attrelid = fk.conrelid AND att.attnum = fk.conkey[1]
		  JOIN pg_attribute pk  ON pk.attrelid  = fk.confrelid AND pk.attnum  = fk.confkey[1]
		 WHERE fk.contype = 'f'
		   AND fk.confrelid = $1::regclass
		   AND pk.attname = $2
		   AND fk.conrelid::regclass::text NOT LIKE '%ledger_entries'`,
		table, keyCol)
	if err != nil {
		return
	}
	for rows.Next() {
		var c child
		if err := rows.Scan(&c.table, &c.col); err == nil {
			children = append(children, c)
		}
	}
	rows.Close()

	for _, c := range children {
		// Recurse on the child's own key before deleting it, so its dependants
		// go first. A table with no `id` column cannot be recursed into that
		// way; deleting it directly is still right when nothing references it.
		var childIDs []string
		idRows, err := pool.Query(ctx,
			fmt.Sprintf(`SELECT id::text FROM %s WHERE %s = ANY($1)`, c.table, c.col), ids)
		if err == nil {
			for idRows.Next() {
				var id string
				if err := idRows.Scan(&id); err == nil {
					childIDs = append(childIDs, id)
				}
			}
			idRows.Close()
			cascadeDelete(ctx, pool, c.table, "id", childIDs, depth+1)
		}
		_, _ = pool.Exec(ctx,
			fmt.Sprintf(`DELETE FROM %s WHERE %s = ANY($1)`, c.table, c.col), ids)
	}
}

// seedFounder used to leave its organisation AND its founder behind on every
// call: it returned pool.Close as the whole teardown and registered the user
// delete with testsupport.CleanupUser, a t.Cleanup. Callers all say
// `defer done()`, and Go runs deferred calls BEFORE t.Cleanup callbacks — so
// the pool was shut first and the user delete no-opped against a dead pool.
// The organisation had no teardown at all. 149 organisations and 19 users had
// accumulated in the shared local database.
//
// These assert on the SPECIFIC rows the helper created, never on table counts.
// The first version compared global counts before and after and was flaky
// everywhere it mattered: `go test ./...` runs packages in parallel against one
// database, and several dev sessions share one local Supabase, so other work
// adds and removes rows inside the measurement window. It failed in CI with
// "auth.users 49 -> 47 ... left -2 user(s) behind" — a NEGATIVE leak, which is
// the tell that the assertion was measuring other people's rows.
func TestLiveDB_SeedFounder_LeavesNothingBehind(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	var orgID, userID string
	func() {
		u, o, _, done := seedFounder(t, ctx, "leakguard")
		defer done()
		userID, orgID = u, o
		if orgID == "" || userID == "" {
			t.Fatal("seedFounder returned no ids")
		}
	}()

	var orgLeft, userLeft int
	if err := pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM assoc_organisations WHERE id=$1),
		(SELECT count(*) FROM auth.users WHERE id=$2)`, orgID, userID).Scan(&orgLeft, &userLeft); err != nil {
		t.Fatalf("recount: %v", err)
	}
	if orgLeft != 0 {
		t.Errorf("organisation %s still present — seedFounder did not clean it up", orgID)
	}
	if userLeft != 0 {
		t.Errorf("founder %s still present — the user teardown did not run", userID)
	}
}

// seedOrganisation backs 63 call sites, so it is the one worth pinning: a
// regression here re-leaks most of the suite at once. It also proves the
// cascade reaches the bottom of the chain — the two-level version this replaced
// could not delete an organisation that had dues on it, because
// assoc_revenue_splits sits four levels below assoc_organisations.
func TestLiveDB_SeedOrganisation_LeavesNothingBehind(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	orgID := seedOrganisation(t, ctx, pool, "cleanupguard "+uuid.New().String())
	_, membershipID := seedActiveMembership(t, ctx, pool, orgID)

	// Build the full four-level chain the old unwind could not clear:
	//   organisation -> membership -> dues invoice -> payment -> revenue split
	// An invoice alone only reaches three levels, which a two-level cascade
	// still clears — so the fixture has to go all the way down, or the guard
	// passes against the very bug it exists to catch. It did, once.
	invoiceID := seedDuesInvoice(t, ctx, pool, membershipID, 5_000_00)
	var paymentID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO assoc_payments (id, invoice_id, membership_id, amount_kobo, method, reference, status)
		VALUES (gen_random_uuid(), $1, $2, 5000000, 'WALLET', $3, 'SUCCESS') RETURNING id::text`,
		invoiceID, membershipID, "cleanupguard-"+uuid.New().String()[:8]).Scan(&paymentID); err != nil {
		t.Fatalf("seed payment: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO assoc_revenue_splits (id, payment_id, label, amount_kobo)
		VALUES (gen_random_uuid(), $1, 'ORGANISATION', 5000000)`, paymentID); err != nil {
		t.Fatalf("seed revenue split: %v", err)
	}

	deleteOrganisation(ctx, pool, orgID)

	var orgLeft, splitsLeft int
	if err := pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM assoc_organisations WHERE id=$1),
		(SELECT count(*) FROM assoc_revenue_splits WHERE payment_id=$2)`,
		orgID, paymentID).Scan(&orgLeft, &splitsLeft); err != nil {
		t.Fatalf("recount: %v", err)
	}
	if orgLeft != 0 {
		t.Errorf("organisation %s survived — the cascade did not reach the bottom of the chain", orgID)
	}
	if splitsLeft != 0 {
		t.Errorf("revenue splits for payment %s survived — the cascade stopped short", paymentID)
	}

	// Ledger rows are immutable by rule and cleanup must never remove one. That
	// is enforced by construction — cascadeDelete excludes ledger_entries from
	// its child query — and was verified by measurement across a full suite run
	// (ledger_entries and ledger_accounts only ever grew). It is deliberately
	// NOT asserted here as a table count: that is the racy shape this file has
	// just had to unlearn.
}
