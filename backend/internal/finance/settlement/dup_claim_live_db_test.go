package settlement_test

// LIVE-DB regression for the F6 audit finding: an ErrDuplicate on the escrow
// debit used to be treated as "my earlier attempt committed" — key EXISTENCE
// was proof enough. A foreign journal pre-claiming the key (another payer's
// hold, or legs naming a different wallet) would converge the retry onto
// someone else's parked money and write/return a settlement row for it.
// escrow() now verifies BOTH ledger legs carry THIS payer's identity
// (verifyEscrowDebitLegs) AND re-reads the settlement row's payer_id. Pins:
//   - another payer's hold under the same idempotency key REFUSES to adopt;
//   - a settlement row under the key naming a different payer REFUSES even
//     when the ledger legs ARE this caller's;
//   - a genuine same-payer replay still converges to the original row.
// SKIPPED whenever TEST_DATABASE_URL is unset.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

func dupRig(t *testing.T) (context.Context, *pgxpool.Pool, *settlement.Service, *ledger.Service, string, string) {
	t.Helper()
	ctx := context.Background()
	pool := mustStandingPool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := settlement.NewService(pool, ledgerSvc)

	payerA := uuid.NewString()
	payerB := uuid.NewString()
	for _, u := range []string{payerA, payerB} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
			u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	rev, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		t.Fatalf("standing acct: %v", err)
	}
	for _, u := range []string{payerA, payerB} {
		if err := ledgerSvc.Credit(ctx, u, "seed-fund", "dup-fund-"+u, rev.ID, 10_000_000); err != nil {
			t.Fatalf("fund %s: %v", u, err)
		}
	}
	return ctx, pool, svc, ledgerSvc, payerA, payerB
}

// PayerB's hold under key K; payerA's later Escrow under K hits ErrDuplicate
// on the debit — the legs are payerB's, so verification must REFUSE to adopt.
func TestLiveDB_Escrow_ForeignLedgerClaimRefused(t *testing.T) {
	ctx, pool, svc, _, payerA, payerB := dupRig(t)

	key := "dupkey-" + uuid.NewString()
	settB, err := svc.Escrow(ctx, payerB, "payerB:ref", key, "test", 5_000)
	if err != nil {
		t.Fatalf("payerB escrow: %v", err)
	}

	if _, err := svc.Escrow(ctx, payerA, "payerA:ref", key, "test", 5_000); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("payerA adopting payerB's key must fail on ErrDuplicate, got %v", err)
	}

	// payerA's wallet was never debited: the refusal did not post or adopt.
	var debits int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM ledger_entries le
		JOIN ledger_accounts a ON a.id = le.account_id
		WHERE a.user_id = $1 AND a.type = 'user_wallet' AND le.type = 'DEBIT'`,
		payerA).Scan(&debits); err != nil {
		t.Fatalf("count payerA debits: %v", err)
	}
	if debits != 0 {
		t.Fatalf("payerA wallet debited %d times on a refused foreign claim", debits)
	}
	// The row still names payerB — the refusal did not re-key it.
	if got := payerOf(t, ctx, pool, settB.ID); got != payerB {
		t.Fatalf("settlement payer = %s, want payerB %s", got, payerB)
	}
}

// The ROW-level check: ledger legs under the key ARE payerA's (a crash after
// the debit, before the row) but the settlements row under the key names
// payerB — converging would attach payerA's request to payerB's row.
func TestLiveDB_Escrow_ForeignSettlementRowRefused(t *testing.T) {
	ctx, pool, svc, ledgerSvc, payerA, payerB := dupRig(t)

	key := "duprow-" + uuid.NewString()
	ref := "payerA:ref"
	escrowAcc, err := ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow acct: %v", err)
	}
	// PayerA's balanced legs under key+":escrow" — the "debit committed, row
	// insert lost" crash window.
	if err := ledgerSvc.Debit(ctx, payerA, "escrow:"+ref, key+":escrow", escrowAcc.ID, 5_000); err != nil {
		t.Fatalf("seed payerA debit: %v", err)
	}
	// …but a settlement row under the BASE key already names payerB.
	if _, err := pool.Exec(ctx, `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
		VALUES ($1,'payerB:ref','test',$2,5000,'escrowed',$3,$4,'wallet')`,
		uuid.NewString(), payerB, time.Now(), key); err != nil {
		t.Fatalf("seed payerB row: %v", err)
	}

	// Legs verify (they're payerA's) but the re-read row's payer is payerB —
	// must fail closed, NOT return payerB's settlement as payerA's.
	if _, err := svc.Escrow(ctx, payerA, ref, key, "test", 5_000); !errors.Is(err, ledger.ErrDuplicate) {
		t.Fatalf("foreign settlement row must fail on ErrDuplicate, got %v", err)
	}
}

// The happy-path counterpart of the two refusal cases above: a genuine replay
// (same payer, same key) converges to the ORIGINAL settlement — leg
// verification must not break the retry path.
func TestLiveDB_Escrow_SamePayerReplayConverges(t *testing.T) {
	ctx, _, svc, _, payerA, _ := dupRig(t)

	key := "dupreplay-" + uuid.NewString()
	first, err := svc.Escrow(ctx, payerA, "payerA:ref", key, "test", 5_000)
	if err != nil {
		t.Fatalf("first escrow: %v", err)
	}
	second, err := svc.Escrow(ctx, payerA, "payerA:ref", key, "test", 5_000)
	if err != nil {
		t.Fatalf("same-payer replay must converge: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("replay returned settlement %s, want original %s", second.ID, first.ID)
	}
}

func payerOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var p string
	if err := pool.QueryRow(ctx, `SELECT payer_id FROM settlements WHERE id=$1`, id).Scan(&p); err != nil {
		t.Fatalf("payer_of: %v", err)
	}
	return p
}
