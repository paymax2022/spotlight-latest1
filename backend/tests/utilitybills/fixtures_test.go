package utilitybills_test

// Shared fixture teardown for the live-DB utility bills suites.
// WHY THIS EXISTS. newFixture seeds a real catalogue (utility_providers →
// utility_billers → utility_products → mappings) with a random suffix per run,
// and the mobile DISCO picker reads utility_billers straight from the database,
// so every run that never finished its teardown left another "Eko Electric Test"
// tile on screen. On 2026-11-11 the local dev DB held 69 of them, so
// /services/electricity showed 12 real DISCOs plus 69 junk cards.
// The teardown could not have worked as written, for two compounding reasons:
//   - utility_transactions pins the biller, product, provider AND mapping with
//     NO ACTION foreign keys (only its own children cascade), so the catalogue
//     cannot go while the run's purchase rows exist.
//   - those purchase rows belong to a seed user, and a seed user that has posted
//     immutable ledger_entries is left in place on purpose by
//     testsupport.CleanupUser. Its cascade therefore never fires, and the
//     transactions outlive every test that made them.
// So teardown has to remove the purchase rows itself, bottom-up, before the
// catalogue. Anything it still misses — a killed run, a panic, a fixture seeded
// before this existed — is swept at the START of the next run, never at the end,
// because an end-of-run sweep races a concurrently running package.
// scripts/dev/sweep-test-fixtures.sql mirrors these statements so one command
// gives a developer a clean catalogue.

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fixtureCodePatterns are the code prefixes this package owns. Kept in one place
// so the start-of-run sweep cannot reach a catalogue row a real merchant or
// another suite seeded. Its products ('eko-prepaid-test-%') are reached through
// their biller rather than matched here.
var fixtureCodePatterns = []string{
	"vtpass-eko-electric-%", // utility_billers.code
	"vtpass-test-%",         // utility_providers.code
}

// fixtureID renders an id as a Postgres literal. These statements are assembled
// rather than parameterised because each one uses a DIFFERENT subset of the two
// ids, and pgx rejects a call whose argument list does not line up with the
// placeholders — which is how the first version of this helper no-op'd the biller
// and provider deletes while reporting nothing. An empty id becomes NULL, which
// matches nothing, so a run that died before seeding its biller can still have
// its provider swept. Anything that is not a UUID is refused, so the
// interpolation cannot carry SQL (the same guard testsupport.DeleteUser uses).
func fixtureID(id string) (string, bool) {
	if id == "" {
		return "NULL", true
	}
	parsed, err := uuid.Parse(id)
	if err != nil {
		return "", false
	}
	return "'" + parsed.String() + "'::uuid", true
}

// deleteFixtureTree removes one seeded catalogue and everything filed under it.
// Order matters twice over: the purchase rows go before the rows they pin, and
// mappings go before the products and providers they join.
// Errors are deliberately ignored — teardown runs after a test may already have
// failed, and a cascade of secondary errors would bury the real failure. The
// start-of-run sweep is the backstop for anything this misses.
func deleteFixtureTree(ctx context.Context, pool *pgxpool.Pool, billerID, providerID string) {
	biller, okB := fixtureID(billerID)
	provider, okP := fixtureID(providerID)
	if !okB || !okP {
		return
	}
	products := `SELECT id FROM public.utility_products
	                 WHERE biller_id = ` + biller + `
	                    OR id IN (SELECT product_id FROM public.utility_provider_product_mappings
	                              WHERE provider_id = ` + provider + `)`
	mappings := `SELECT id FROM public.utility_provider_product_mappings
	                 WHERE product_id IN (` + products + `)
	                    OR provider_id = ` + provider

	for _, q := range []string{
		// Money rows first: they are what NO ACTION holds the catalogue with.
		`DELETE FROM public.utility_transactions WHERE biller_id = ` + biller + `
		      OR provider_id = ` + provider + `
		      OR product_id IN (` + products + `)
		      OR provider_mapping_id IN (` + mappings + `)`,
		`DELETE FROM public.utility_paystack_intents WHERE biller_id = ` + biller + `
		      OR product_id IN (` + products + `)`,
		`DELETE FROM public.saved_utility_beneficiaries WHERE biller_id = ` + biller,
		`DELETE FROM public.utility_routing_rules WHERE provider_id = ` + provider,
		`DELETE FROM public.utility_provider_attempts WHERE provider_id = ` + provider + `
		      OR provider_mapping_id IN (` + mappings + `)`,
		`DELETE FROM public.utility_provider_product_mappings WHERE id IN (` + mappings + `)`,
		`DELETE FROM public.utility_products WHERE id IN (` + products + `)`,
		`DELETE FROM public.utility_billers WHERE id = ` + biller,
		`DELETE FROM public.utility_providers WHERE id = ` + provider,
	} {
		_, _ = pool.Exec(ctx, q)
	}
}

// cleanupFixture registers deleteFixtureTree for a seeded catalogue.
// Registered as a Cleanup, never a defer, and always while the pool is still
// open — a `defer pool.Close()` in the test would fire before every cleanup and
// silently no-op the lot.
func cleanupFixture(t *testing.T, pool *pgxpool.Pool, billerID, providerID string) {
	t.Helper()
	t.Cleanup(func() {
		deleteFixtureTree(context.WithoutCancel(context.Background()), pool, billerID, providerID)
	})
}

// sweepStaleFixtures deletes catalogue rows an earlier run left behind, matching
// on this package's code patterns.
func sweepStaleFixtures(ctx context.Context, pool *pgxpool.Pool) {
	// One row per seeded biller, with the provider its mapping points at.
	// Products are read through the biller, so a biller whose mapping is already
	// gone still has its own rows swept, and the provider pass below finishes it.
	rows, err := pool.Query(ctx, `
		SELECT b.id::text, COALESCE(pm.provider_id::text, '')
		  FROM public.utility_billers b
		  LEFT JOIN public.utility_products pr ON pr.biller_id = b.id
		  LEFT JOIN public.utility_provider_product_mappings pm ON pm.product_id = pr.id
		 WHERE b.code LIKE $1`, fixtureCodePatterns[0])
	if err == nil {
		type orphan struct{ biller, provider string }
		var found []orphan
		for rows.Next() {
			var o orphan
			if rows.Scan(&o.biller, &o.provider) == nil {
				found = append(found, o)
			}
		}
		rows.Close()
		for _, o := range found {
			deleteFixtureTree(ctx, pool, o.biller, o.provider)
		}
	}

	// Providers whose biller was never seeded — the run died between the two.
	prows, err := pool.Query(ctx, `SELECT id::text FROM public.utility_providers
	                                WHERE code LIKE $1`, fixtureCodePatterns[1])
	if err == nil {
		var ids []string
		for prows.Next() {
			var id string
			if prows.Scan(&id) == nil {
				ids = append(ids, id)
			}
		}
		prows.Close()
		for _, id := range ids {
			deleteFixtureTree(ctx, pool, "", id)
		}
	}
}

// TestMain sweeps before this run starts, so a developer who ran `go test` and
// had it killed does not keep the residue on their screen until they notice.
func TestMain(m *testing.M) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn != "" {
		ctx := context.Background()
		if pool, err := pgxpool.New(ctx, dsn); err == nil {
			sweepStaleFixtures(ctx, pool)
			pool.Close()
		}
	}
	os.Exit(m.Run())
}
