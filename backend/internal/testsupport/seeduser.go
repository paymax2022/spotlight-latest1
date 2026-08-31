// Package testsupport holds helpers shared by the live-DB test suites. It is a
// normal package rather than a _test.go file because the suites that need it live
// in ~50 different packages under both internal/ and tests/; nothing in the
// production build imports it.
package testsupport

import (
	"context"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CleanupUser registers teardown for a synthetic auth.users row seeded by a test.
//
// WHY THIS EXISTS. The live-DB suites seed users as '<uuid>@seed.test' and file
// real rows under them. Most never deleted them, and the reason is structural
// rather than careless: auth.users has 183 referencing foreign keys that are
// NO ACTION rather than CASCADE, so a correct teardown would need each test to
// know its own write set across the whole schema. 88% of auth.users on a
// developer's database was this residue.
//
// This does the knowing instead. The common case costs ONE statement — most
// seeded users touch only CASCADE-ing tables, so the plain delete succeeds. The
// expensive dependency unwind runs only when that delete is actually blocked.
//
// MUST be registered while the pool is still open. Cleanups are last-in-first-out,
// so the pool's own close has to be registered FIRST — the live-DB constructors do
// that with t.Cleanup(pool.Close). A `defer pool.Close()` in the test would fire
// before every cleanup here and silently no-op the lot, which is exactly the bug
// that let this residue build up in the first place.
func CleanupUser(t *testing.T, pool *pgxpool.Pool, userID string) {
	t.Helper()
	if pool == nil || userID == "" {
		return
	}
	t.Cleanup(func() { DeleteUser(context.Background(), pool, userID) })
}

// CleanupUsers registers teardown for several seeded users at once.
func CleanupUsers(t *testing.T, pool *pgxpool.Pool, userIDs ...string) {
	t.Helper()
	for _, id := range userIDs {
		CleanupUser(t, pool, id)
	}
}

// DeleteUser removes a seeded user, unwinding dependants only if it has to.
//
// Best-effort by design: teardown runs after a test may already have failed, and
// a cascade of secondary errors would bury the real failure. A user holding
// immutable records (ledger_entries, health_clinical_notes — both append-only by
// design) simply stays, and that is correct: the immutability guarantee outranks
// tidiness. scripts/dev/sweep-test-fixtures.sh reports what is left.
func DeleteUser(ctx context.Context, pool *pgxpool.Pool, userID string) {
	if pool == nil || userID == "" {
		return
	}
	// Fast path: CASCADE handles 356 of the referencing keys.
	if _, err := pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, userID); err == nil {
		return
	}
	// Blocked by a NO ACTION referrer. Unwind, then retry once.
	unwindDependants(ctx, pool, userID)
	_, _ = pool.Exec(ctx, `DELETE FROM auth.users WHERE id=$1`, userID)
}

// unwindDependants deletes the rows that block a user's deletion, two levels deep.
//
// Two levels, not one: a direct referrer is frequently blocked by its OWN
// dependants — `restaurants` cannot go while restaurant_staff rows point at it —
// and a single level leaves most users undeletable. The table set is read from
// pg_catalog rather than hardcoded, so a new module needs no change here.
func unwindDependants(ctx context.Context, pool *pgxpool.Pool, userID string) {
	// Validated, not escaped: the id is interpolated into a DO block (which cannot
	// take bind parameters), so it must be provably a UUID first.
	if _, err := uuid.Parse(userID); err != nil {
		return
	}
	_, _ = pool.Exec(ctx, fmt.Sprintf(unwindSQL, userID))
}

// %[1]s is the (UUID-validated) user id.
const unwindSQL = `
DO $unwind$
DECLARE c record; n bigint; freed bigint; pass int := 0;
BEGIN
  LOOP
    pass := pass + 1; freed := 0;

    -- Second level: dependants of the tables that reference auth.users.
    FOR c IN
      SELECT child.conrelid::regclass AS tbl, catt.attname AS col,
             parent.conrelid::regclass AS parent_tbl, patt.attname AS parent_col,
             pkatt.attname AS parent_key
        FROM pg_constraint parent
        JOIN pg_attribute patt ON patt.attrelid = parent.conrelid AND patt.attnum = parent.conkey[1]
        JOIN pg_constraint child ON child.confrelid = parent.conrelid AND child.contype = 'f'
        JOIN pg_attribute catt ON catt.attrelid = child.conrelid AND catt.attnum = child.conkey[1]
        JOIN pg_attribute pkatt ON pkatt.attrelid = child.confrelid AND pkatt.attnum = child.confkey[1]
       WHERE parent.contype = 'f' AND parent.confrelid = 'auth.users'::regclass
         AND parent.confdeltype IN ('a','r') AND child.confdeltype IN ('a','r')
         AND parent.conrelid::regclass::text <> 'ledger_accounts'
         AND child.conrelid::regclass::text <> 'ledger_entries'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %%s WHERE %%I IN (SELECT %%I FROM %%s WHERE %%I = %%L)',
                       c.tbl, c.col, c.parent_key, c.parent_tbl, c.parent_col, '%[1]s');
        GET DIAGNOSTICS n = ROW_COUNT; freed := freed + n;
      EXCEPTION WHEN others THEN NULL; END;
    END LOOP;

    -- First level: the direct referrers themselves.
    FOR c IN
      SELECT con.conrelid::regclass AS tbl, att.attname AS col
        FROM pg_constraint con
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
       WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass
         AND con.confdeltype IN ('a','r')
         AND con.conrelid::regclass::text <> 'ledger_accounts'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %%s WHERE %%I = %%L', c.tbl, c.col, '%[1]s');
        GET DIAGNOSTICS n = ROW_COUNT; freed := freed + n;
      EXCEPTION WHEN others THEN NULL; END;
    END LOOP;

    EXIT WHEN freed = 0 OR pass >= 4;
  END LOOP;
END
$unwind$;`
