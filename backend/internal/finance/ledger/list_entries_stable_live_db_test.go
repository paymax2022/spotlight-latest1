package ledger_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

// LIVE-DB (TEST_DATABASE_URL): ListEntries OFFSET paging must be stable when
// many entries share ONE created_at (entries from a single tx do). Without an
// id tiebreaker a page boundary can skip or repeat rows, stranding a fee from
// the fee sweep.
func TestLiveDB_ListEntries_StablePagingOnEqualTimestamps(t *testing.T) {
	pool := mustLiveTxPool(t)
	ctx := context.Background()
	svc := ledger.NewService(ledger.NewRepository(pool), nil)

	typ, err := ledger.FeesUnsweptAccount(uuid.NewString(), "NGN")
	if err != nil {
		t.Fatal(err)
	}
	acct, err := svc.GetOrCreateStandingAccount(ctx, typ)
	if err != nil {
		t.Skipf("fees_unswept account type not accepted by this DB: %v", err)
	}
	const n = 1203
	k := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key, created_at)
		SELECT $1::uuid, 'CREDIT', 1, 'cb:fees_unswept:t'||g||':send', $2::text||'-'||g||':credit', '2026-01-01T00:00:00Z'
		FROM generate_series(1, $3::int) g`, acct.ID, k, n); err != nil {
		t.Skipf("cannot seed entries directly: %v", err)
	}
	seen := map[string]bool{}
	for off := 0; ; off += 500 {
		page, err := svc.ListAccountEntries(ctx, acct.ID, 500, off)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range page {
			if seen[e.ID] {
				t.Fatalf("entry %s repeated across pages", e.ID)
			}
			seen[e.ID] = true
		}
		if len(page) < 500 {
			break
		}
	}
	if len(seen) != n {
		t.Fatalf("paged %d distinct entries, want %d (rows skipped)", len(seen), n)
	}
}
