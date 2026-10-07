package crowdfunding

// Tests for the settlement-adoption guard Contribute runs after Escrow
// (post-merge audit follow-up to the caller-scoped replay fix).
//
// Escrow dedupes on the GLOBAL key namespace and is NOT atomic across its two
// writes (the ":escrow" ledger debit and the settlements row) — a crash
// between them leaves an ORPHAN debit any later caller can adopt with the
// same key+amount, because the row insert then succeeds carrying the new
// caller's payer_id. Checking only the stored settlements row is therefore
// insufficient on three axes:
//
//	D1 — a failed re-read must FAIL CLOSED, not skip the ownership check and
//	     bind an unverified settlement;
//	D2 — provenance must be verified on the escrow DEBIT LEG: the
//	     "<key>:escrow:debit" entry must exist on THIS caller's wallet with
//	     the settlement's amount — the row's payer_id is just a claim;
//	D3 — the stored total_kobo must equal this request's amount.
//
// The helper is exercised directly (in-package) so the scan-error branch —
// unreachable through Contribute's happy path — is pinned too. Gated on
// TEST_DATABASE_URL, same as the sibling idempotency_scope live tests.
//
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/crowdfunding/ -run LiveDB_AdoptionGuard -v

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/testsupport"
)

func adoptionGuardPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL — skipping crowdfunding adoption-guard live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedSettlementRow inserts a settlements row directly — simulating the
// committed (or partially-committed) state Escrow leaves behind — and returns
// its id. No ledger legs are posted; tests that need the debit leg post it
// themselves or go through settlement.Escrow.
func seedSettlementRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool, payerID, moduleType string, totalKobo int64, idemKey string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := pool.Exec(ctx, `
		INSERT INTO settlements (id, reference, module_type, payer_id, total_kobo, status, escrowed_at, idempotency_key, funding_source)
		VALUES ($1, $2, $3, $4, $5, 'escrowed', now(), $6, 'wallet')`,
		id, "adoption-guard:"+idemKey, moduleType, payerID, totalKobo, idemKey); err != nil {
		t.Fatalf("seed settlement: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM settlements WHERE id = $1`, id)
	})
	return id
}

// TestLiveDB_AdoptionGuard_ScanErrorFailsClosed pins D1: when the settlement
// re-read itself fails (row gone, bad id), the guard must return an error —
// the old code swallowed the scan error and skipped the ownership check
// entirely, binding an unverified settlement id to the contribution.
func TestLiveDB_AdoptionGuard_ScanErrorFailsClosed(t *testing.T) {
	ctx := context.Background()
	pool := adoptionGuardPool(t)
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := &Service{db: pool, ledger: ledgerSvc}

	payer := uuid.NewString()
	testsupport.CleanupUsers(t, pool, payer)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, payer, "cf-guard-"+payer+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	err := svc.verifyAdoptedSettlement(ctx, payer, ContributeRequest{
		AmountKobo:     100_000,
		IdempotencyKey: "cf-guard-missing-" + uuid.NewString(),
	}, uuid.NewString() /* no such settlements row */)
	if err == nil {
		t.Fatal("a failed settlement re-read must fail closed — the contribution would bind an unverified settlement id")
	}
	if errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("a scan failure is a fault, not a 409 conflict: %v", err)
	}
}

// TestLiveDB_AdoptionGuard_RowMismatchConflicts pins the row-level checks:
// a stored settlement whose payer, module or amount does not match this
// request is a cross-user key clash (or tampered replay) → 409 sentinel.
// D3: the total_kobo comparison is part of this same gate.
func TestLiveDB_AdoptionGuard_RowMismatchConflicts(t *testing.T) {
	ctx := context.Background()
	pool := adoptionGuardPool(t)
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := &Service{db: pool, ledger: ledgerSvc}

	payer := uuid.NewString()
	other := uuid.NewString()
	testsupport.CleanupUsers(t, pool, payer, other)
	for _, id := range []string{payer, other} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "cf-guard-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}

	req := ContributeRequest{AmountKobo: 250_000, IdempotencyKey: "cf-guard-row-" + uuid.NewString()}

	// Wrong payer.
	settID := seedSettlementRow(t, ctx, pool, other, "crowdfunding", req.AmountKobo, req.IdempotencyKey)
	if err := svc.verifyAdoptedSettlement(ctx, payer, req, settID); !errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("foreign-payer settlement must conflict, got %v", err)
	}

	// Wrong module (another vertical's settlement row under the same key).
	settID2 := seedSettlementRow(t, ctx, pool, payer, "transport", req.AmountKobo, req.IdempotencyKey+"-m")
	req2 := req
	req2.IdempotencyKey += "-m"
	if err := svc.verifyAdoptedSettlement(ctx, payer, req2, settID2); !errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("foreign-module settlement must conflict, got %v", err)
	}

	// D3: right payer, right module, WRONG amount — the stored settlement is
	// not what this request asked to escrow.
	settID3 := seedSettlementRow(t, ctx, pool, payer, "crowdfunding", req.AmountKobo+50_000, req.IdempotencyKey+"-a")
	req3 := req
	req3.IdempotencyKey += "-a"
	if err := svc.verifyAdoptedSettlement(ctx, payer, req3, settID3); !errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("amount-mismatched settlement must conflict, got %v", err)
	}
}

// TestLiveDB_AdoptionGuard_DebitLegProvenance pins D2 end-to-end at the
// helper: a perfectly consistent settlements row (right payer, module,
// amount) must still be refused when the ":escrow:debit" ledger leg is not on
// THIS caller's wallet — the orphan-debit adoption window. And the converse:
// the leg posted by a real Escrow call on the caller's wallet verifies clean.
func TestLiveDB_AdoptionGuard_DebitLegProvenance(t *testing.T) {
	ctx := context.Background()
	pool := adoptionGuardPool(t)
	ledgerSvc := financeledger.NewService(financeledger.NewRepository(pool), (*goredis.Client)(nil))
	settlementSvc := settlement.NewService(pool, ledgerSvc)
	svc := &Service{db: pool, ledger: ledgerSvc}

	payer := uuid.NewString()
	testsupport.CleanupUsers(t, pool, payer)
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, payer, "cf-guard-"+payer+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.SetKycTier(t, ctx, pool, payer, testsupport.KycTierUnlimited)
	// Fund the wallet so Escrow's balance-checked debit posts for real.
	walletAcc, err := ledgerSvc.GetOrCreateUserWallet(ctx, payer)
	if err != nil {
		t.Fatalf("wallet: %v", err)
	}
	clearing, err := ledgerSvc.GetOrCreateStandingAccount(ctx, financeledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing: %v", err)
	}
	fundRef := "cf-guard-fund-" + payer
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1,'CREDIT',$3,$4,$5), ($2,'DEBIT',$3,$4,$6)`,
		walletAcc.ID, clearing.ID, 1_000_000, fundRef, fundRef+":credit", fundRef+":debit"); err != nil {
		t.Fatalf("fund wallet: %v", err)
	}

	// A row that claims payer=payer but has NO debit leg on payer's wallet —
	// e.g. a row written after adopting someone else's orphan debit.
	keyOrphan := "cf-guard-orphan-" + uuid.NewString()
	orphanRow := seedSettlementRow(t, ctx, pool, payer, "crowdfunding", 250_000, keyOrphan)
	if err := svc.verifyAdoptedSettlement(ctx, payer,
		ContributeRequest{AmountKobo: 250_000, IdempotencyKey: keyOrphan}, orphanRow); !errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("settlement without this caller's escrow debit leg must conflict, got %v", err)
	}

	// A leg posted for a DIFFERENT amount than the settlement row claims is
	// equally foreign — the probe compares amounts, not just presence.
	keySkew := "cf-guard-skew-" + uuid.NewString()
	// Balanced foreign journal — the guard probes the DEBIT leg's amount while
	// the credit keeps global conservation clean (ledger_entries is append-only;
	// a single-sided fixture would leak into the invariant).
	if _, err := pool.Exec(ctx, `
		INSERT INTO ledger_entries (account_id, type, amount_kobo, reference, idempotency_key)
		VALUES ($1,'DEBIT',100000,$2,$3), ($4,'CREDIT',100000,$2,$5)`,
		walletAcc.ID, "escrow:skew", keySkew+":escrow:debit", clearing.ID, keySkew+":escrow:credit"); err != nil {
		t.Fatalf("post skewed leg: %v", err)
	}
	skewRow := seedSettlementRow(t, ctx, pool, payer, "crowdfunding", 250_000, keySkew)
	if err := svc.verifyAdoptedSettlement(ctx, payer,
		ContributeRequest{AmountKobo: 250_000, IdempotencyKey: keySkew}, skewRow); !errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("settlement whose debit leg amount differs must conflict, got %v", err)
	}

	// Happy path: a real Escrow posts the leg + the row; the guard must pass.
	keyReal := "cf-guard-real-" + uuid.NewString()
	sett, err := settlementSvc.Escrow(ctx, payer, "escrow:adoption-guard", keyReal, "crowdfunding", 250_000)
	if err != nil {
		t.Fatalf("seed escrow: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM settlements WHERE id = $1`, sett.ID)
	})
	if err := svc.verifyAdoptedSettlement(ctx, payer,
		ContributeRequest{AmountKobo: 250_000, IdempotencyKey: keyReal}, sett.ID); err != nil {
		t.Fatalf("a genuine caller-owned escrow must verify clean, got %v", err)
	}
}
