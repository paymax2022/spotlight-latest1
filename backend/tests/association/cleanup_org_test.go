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
// Two levels deep, for the same reason testsupport.unwindDependants is: a
// direct referrer is usually blocked by its OWN dependants — assoc_memberships
// cannot go while assoc_member_roles and assoc_dues_invoices point at it — so a
// single level leaves the organisation undeletable. Seventeen tables reference
// assoc_organisations directly and none of those FKs cascade.
//
// The table set is read from pg_catalog rather than hardcoded, so a new
// association table needs no change here. Failures per table are swallowed and
// the loop repeats: ordering between dependants is not knowable up front, so it
// converges by repetition instead.
func deleteOrganisation(ctx context.Context, pool *pgxpool.Pool, orgID string) {
	if pool == nil || orgID == "" {
		return
	}
	// Validated, not escaped: a DO block cannot take bind parameters, so the id
	// is interpolated and must be provably a UUID first.
	if _, err := uuid.Parse(orgID); err != nil {
		return
	}
	_, _ = pool.Exec(ctx, fmt.Sprintf(orgUnwindSQL, orgID))
	_, _ = pool.Exec(ctx, `DELETE FROM assoc_organisations WHERE id=$1`, orgID)
}

// %[1]s is the (UUID-validated) organisation id.
const orgUnwindSQL = `
DO $orgunwind$
DECLARE c record; pass int := 0;
BEGIN
  WHILE pass < 6 LOOP
    pass := pass + 1;

    -- Second level: dependants of the tables that reference the organisation.
    FOR c IN
      SELECT child.conrelid::regclass AS tbl, catt.attname AS col,
             parent.conrelid::regclass AS parent_tbl, patt.attname AS parent_col,
             pkatt.attname AS parent_key
        FROM pg_constraint parent
        JOIN pg_attribute patt ON patt.attrelid = parent.conrelid AND patt.attnum = parent.conkey[1]
        JOIN pg_constraint child ON child.confrelid = parent.conrelid AND child.contype = 'f'
        JOIN pg_attribute catt ON catt.attrelid = child.conrelid AND catt.attnum = child.conkey[1]
        JOIN pg_attribute pkatt ON pkatt.attrelid = child.confrelid AND pkatt.attnum = child.confkey[1]
       WHERE parent.contype = 'f' AND parent.confrelid = 'assoc_organisations'::regclass
         -- Ledger entries are immutable by rule; never delete them.
         AND child.conrelid::regclass::text <> 'ledger_entries'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %%s WHERE %%I IN (SELECT %%I FROM %%s WHERE %%I = %%L)',
                       c.tbl, c.col, c.parent_key, c.parent_tbl, c.parent_col, '%[1]s');
      EXCEPTION WHEN others THEN NULL;
      END;
    END LOOP;

    -- First level: the direct referrers.
    FOR c IN
      SELECT fk.conrelid::regclass AS tbl, att.attname AS col
        FROM pg_constraint fk
        JOIN pg_attribute att ON att.attrelid = fk.conrelid AND att.attnum = fk.conkey[1]
       WHERE fk.contype = 'f' AND fk.confrelid = 'assoc_organisations'::regclass
         AND fk.conrelid::regclass::text <> 'ledger_entries'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %%s WHERE %%I = %%L', c.tbl, c.col, '%[1]s');
      EXCEPTION WHEN others THEN NULL;
      END;
    END LOOP;
  END LOOP;
END
$orgunwind$;`

// seedFounder used to leave its organisation AND its founder behind on every
// call: it returned pool.Close as the whole teardown and registered the user
// delete with testsupport.CleanupUser, a t.Cleanup. Callers all say
// `defer done()`, and Go runs deferred calls BEFORE t.Cleanup callbacks — so
// the pool was shut first and the user delete no-opped against a dead pool.
// The organisation had no teardown at all. 149 organisations and 19 users had
// accumulated in the shared local database.
//
// Counting rows around a real seedFounder call is the only assertion that
// actually proves teardown ran: a cleanup that silently fails looks exactly
// like one that worked.
func TestLiveDB_SeedFounder_LeavesNothingBehind(t *testing.T) {
	ctx := context.Background()
	pool := liveDBPool(t)
	t.Cleanup(pool.Close)

	count := func() (orgs, users int) {
		t.Helper()
		if err := pool.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM assoc_organisations),
			(SELECT count(*) FROM auth.users)`).Scan(&orgs, &users); err != nil {
			t.Fatalf("count: %v", err)
		}
		return
	}

	orgsBefore, usersBefore := count()

	// Scoped so the teardown runs here, not at the end of the test.
	func() {
		_, orgID, _, done := seedFounder(t, ctx, "leakguard")
		defer done()
		if orgID == "" {
			t.Fatal("seedFounder returned no organisation id")
		}
	}()

	orgsAfter, usersAfter := count()
	if orgsAfter != orgsBefore {
		t.Errorf("assoc_organisations %d -> %d: seedFounder left %d organisation(s) behind",
			orgsBefore, orgsAfter, orgsAfter-orgsBefore)
	}
	if usersAfter != usersBefore {
		t.Errorf("auth.users %d -> %d: seedFounder left %d user(s) behind",
			usersBefore, usersAfter, usersAfter-usersBefore)
	}
}
