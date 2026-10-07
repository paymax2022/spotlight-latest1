package social

// LIVE-DB regression tests for the ledger-audit CONDITIONAL findings on
// PR #525 (deploy-boundary + crash-residue convergence):
//
//  525-D1 — the PR namespaced journal keys ("social:p2p:K", "social:pool:P:K",
//           groups "groups:dues:K") while on main the SAME operations posted
//           under the RAW caller key (K:dr / K:cr / K). A crash post-legs /
//           pre-row on the old build leaves raw-key legs + no row; a post-
//           deploy retry used to miss both lookups and post a SECOND debit.
//           The service must probe the legacy keys and converge (write the
//           row, post no new legs).
//  525-D2 — ContributePool's row insert did not re-check pool state: a
//           contribution in-flight across a PayoutPool claim landed after the
//           balance freeze — contributor debited into escrow, excluded from
//           payout. The insert is now fenced on state='OPEN'; a fenced-out
//           debit is reversed (PostReversal). The PAID_OUT heal writes the
//           drain for the ACTUAL posted credit, not the recomputed row sum.
//  525-D3 — Send: a crash after both legs commit but before the
//           social_payments row made every retry error on Credit's
//           ErrDuplicate forever. The duplicate now verifies the posted leg
//           and converges to the row insert.
//  525-D4 — PayShare heal probed organiser credit by reference+amount —
//           an equal-amount SIBLING share of the same bill satisfied it and
//           phantom-settled the un-paid share. Probes now use the
//           deterministic per-share ledger keys.
//  525-D7 — replay lookups swallow errors and skipped material-param
//           comparison; a divergent replay must surface
//           ErrIdempotencyKeyConflict.
// ⚠️ GATED ON TEST_DATABASE_URL — these move money. Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/social/ -run 'TestLiveDB_' -v

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// countContributionRows returns the number of positive pool_contributions rows
// for a user on a pool — a wedged/refused attempt must leave ZERO.
func countContributionRows(t *testing.T, ctx context.Context, pool *pgxpool.Pool, poolID, userID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM pool_contributions WHERE pool_id=$1 AND user_id=$2 AND amount_kobo>0`,
		poolID, userID).Scan(&n); err != nil {
		t.Fatalf("count contributions: %v", err)
	}
	return n
}

// ─── 525-D1: legacy raw-key residue must converge, not double-debit ─────────

// Old-build Send posted debit <K>:dr / credit <K>:cr under reference "p2p:<K>"
// and crashed before the social_payments row. A post-deploy retry with the
// SAME Idempotency-Key must converge onto those legs — record the row, move
// nothing twice.
func TestLiveDB_SocialSend_LegacyKeyResidue_Converges(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	sender := socialTestUser(t, pool)
	setKycTier(t, pool, sender, 1)
	recipient := socialTestUser(t, pool)
	handle := "leg" + shortTag()
	if _, err := svc.tags.Claim(ctx, recipient, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	fundWallet(t, ctx, led, sender, 10_000_00)
	escrow, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}

	key := "legacy-send-" + shortTag()
	// Seed the OLD-convention residue: both legs under the raw caller key, no row.
	if err := led.Debit(ctx, sender, "p2p:"+key, key+":dr", escrow.ID, 300_00); err != nil {
		t.Fatalf("seed legacy debit: %v", err)
	}
	if err := led.Credit(ctx, recipient, "p2p:"+key, key+":cr", escrow.ID, 300_00); err != nil {
		t.Fatalf("seed legacy credit: %v", err)
	}

	p, err := svc.Send(ctx, sender, handle, "t", key, 300_00)
	if err != nil {
		t.Fatalf("send over legacy residue err = %v, want nil (converge, not double-debit)", err)
	}
	if p.RecipientID != recipient || p.AmountKobo != 300_00 {
		t.Fatalf("payment = %+v, want recipient %s amount 30000", p, recipient)
	}
	if bal, _ := led.GetBalance(ctx, sender); bal != 9_700_00 {
		t.Fatalf("sender balance = %d, want 970000 — legacy debit must be reused, not posted twice", bal)
	}
	if bal, _ := led.GetBalance(ctx, recipient); bal != 300_00 {
		t.Fatalf("recipient balance = %d, want 30000 — exactly one credit", bal)
	}
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM social_payments WHERE idempotency_key=$1`, key).Scan(&rows); err != nil {
		t.Fatalf("count payments: %v", err)
	}
	if rows != 1 {
		t.Fatalf("social_payments rows = %d, want 1 (converge writes the missing row)", rows)
	}
	// A further retry is a plain replay.
	if _, err := svc.Send(ctx, sender, handle, "t", key, 300_00); err != nil {
		t.Fatalf("replay err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, sender); bal != 9_700_00 {
		t.Fatalf("sender balance after replay = %d, want 970000", bal)
	}
}

// A crash BETWEEN the old build's two legs leaves debit-only residue: the
// retry must complete the missing recipient credit and the row — not re-debit.
func TestLiveDB_SocialSend_LegacyDebitOnly_CompletesCredit(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	sender := socialTestUser(t, pool)
	setKycTier(t, pool, sender, 1)
	recipient := socialTestUser(t, pool)
	handle := "ldo" + shortTag()
	if _, err := svc.tags.Claim(ctx, recipient, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	fundWallet(t, ctx, led, sender, 10_000_00)
	escrow, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}

	key := "legacy-half-" + shortTag()
	if err := led.Debit(ctx, sender, "p2p:"+key, key+":dr", escrow.ID, 150_00); err != nil {
		t.Fatalf("seed legacy debit: %v", err)
	}

	if _, err := svc.Send(ctx, sender, handle, "t", key, 150_00); err != nil {
		t.Fatalf("send over debit-only residue err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, sender); bal != 9_850_00 {
		t.Fatalf("sender balance = %d, want 985000 — exactly one debit", bal)
	}
	if bal, _ := led.GetBalance(ctx, recipient); bal != 150_00 {
		t.Fatalf("recipient balance = %d, want 15000 — the missing credit must be completed", bal)
	}
}

// ─── 525-D3: new-convention legs without a row converge instead of wedging ──

// Crash after BOTH namespaced legs commit but before the social_payments row:
// Credit's ErrDuplicate used to fail every retry forever. The duplicate must
// verify the posted leg and proceed to the row insert.
func TestLiveDB_SocialSend_LegsNoRow_Converges(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	sender := socialTestUser(t, pool)
	setKycTier(t, pool, sender, 1)
	recipient := socialTestUser(t, pool)
	handle := "lnr" + shortTag()
	if _, err := svc.tags.Claim(ctx, recipient, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	fundWallet(t, ctx, led, sender, 10_000_00)
	escrow, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}

	key := "legs-norow-" + shortTag()
	if err := led.Debit(ctx, sender, "p2p:"+key, "social:p2p:"+key+":dr", escrow.ID, 200_00); err != nil {
		t.Fatalf("seed debit: %v", err)
	}
	if err := led.Credit(ctx, recipient, "p2p:"+key, "social:p2p:"+key+":cr", escrow.ID, 200_00); err != nil {
		t.Fatalf("seed credit: %v", err)
	}

	p, err := svc.Send(ctx, sender, handle, "t", key, 200_00)
	if err != nil {
		t.Fatalf("send over legs-no-row residue err = %v, want nil — money moved, the row must converge", err)
	}
	if p.IdempotencyKey != key {
		t.Fatalf("payment key = %q, want %q", p.IdempotencyKey, key)
	}
	if bal, _ := led.GetBalance(ctx, sender); bal != 9_800_00 {
		t.Fatalf("sender balance = %d, want 980000", bal)
	}
	if bal, _ := led.GetBalance(ctx, recipient); bal != 200_00 {
		t.Fatalf("recipient balance = %d, want 20000", bal)
	}
}

// ─── 525-D7: divergent replay is a conflict, not a silent re-read ───────────

// A retry under the same key but a DIFFERENT amount (or recipient) must be
// refused with ErrIdempotencyKeyConflict — echoing back the recorded payment
// tells the caller a different transfer succeeded.
func TestLiveDB_SocialSend_ReplayDivergent_Conflict(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	sender := socialTestUser(t, pool)
	setKycTier(t, pool, sender, 1)
	rcptA := socialTestUser(t, pool)
	rcptB := socialTestUser(t, pool)
	handleA := "dva" + shortTag()
	handleB := "dvb" + shortTag()
	if _, err := svc.tags.Claim(ctx, rcptA, handleA); err != nil {
		t.Fatalf("claim A: %v", err)
	}
	if _, err := svc.tags.Claim(ctx, rcptB, handleB); err != nil {
		t.Fatalf("claim B: %v", err)
	}
	fundWallet(t, ctx, led, sender, 10_000_00)

	key := "diverge-" + shortTag()
	if _, err := svc.Send(ctx, sender, handleA, "t", key, 100_00); err != nil {
		t.Fatalf("first send: %v", err)
	}
	if _, err := svc.Send(ctx, sender, handleA, "t", key, 200_00); !errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("divergent-amount replay err = %v, want ErrIdempotencyKeyConflict", err)
	}
	if _, err := svc.Send(ctx, sender, handleB, "t", key, 100_00); !errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("divergent-recipient replay err = %v, want ErrIdempotencyKeyConflict", err)
	}
	if bal, _ := led.GetBalance(ctx, sender); bal != 9_900_00 {
		t.Fatalf("sender balance = %d, want 990000 — refused replays must never debit", bal)
	}
}

// ─── 525-D1 (pool rail): legacy contribution debit converges ────────────────

// Old-build ContributePool debited under raw key <K>:dr (reference
// "pool:contrib:<pool>") and crashed before the row. A post-deploy retry must
// record the row off the existing leg — never debit again.
func TestLiveDB_SocialContributePool_LegacyKeyResidue_Converges(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	contributor := fundedContributor(t, ctx, pool, led, 10_000_00)
	escrow, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}

	p, err := svc.CreatePool(ctx, organiser, "legacy-pool", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	key := "legacy-pool-" + shortTag()
	if err := led.Debit(ctx, contributor, "pool:contrib:"+p.ID, key+":dr", escrow.ID, 250_00); err != nil {
		t.Fatalf("seed legacy debit: %v", err)
	}

	bal, err := svc.ContributePool(ctx, contributor, p.ID, 250_00, key)
	if err != nil {
		t.Fatalf("contribute over legacy residue err = %v, want nil", err)
	}
	if bal != 250_00 {
		t.Fatalf("pool balance = %d, want 25000", bal)
	}
	if bal, _ := led.GetBalance(ctx, contributor); bal != 9_750_00 {
		t.Fatalf("contributor balance = %d, want 975000 — exactly one debit", bal)
	}
	if n := countContributionRows(t, ctx, pool, p.ID, contributor); n != 1 {
		t.Fatalf("contribution rows = %d, want 1", n)
	}
}

// ─── 525-D2: closed-pool race — fenced insert + refund of the wedged debit ──

// A contribution whose debit posted while PayoutPool froze the pool must NOT
// land its row (it would be excluded from the payout yet real money) — the
// orphaned debit is reversed back to the contributor and the call errors.
func TestLiveDB_SocialContributePool_PoolClosed_DebitRefunded(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	contributor := fundedContributor(t, ctx, pool, led, 10_000_00)
	escrow, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}

	p, err := svc.CreatePool(ctx, organiser, "race-pool", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	key := "raced-" + shortTag()
	// The in-flight debit that lost the payout race (namespaced key), then the
	// freeze lands before the row insert.
	if err := led.Debit(ctx, contributor, "pool:contrib:"+p.ID, "social:pool:"+p.ID+":"+key+":dr", escrow.ID, 400_00); err != nil {
		t.Fatalf("seed in-flight debit: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE group_pools SET state='PAID_OUT' WHERE id=$1`, p.ID); err != nil {
		t.Fatalf("freeze pool: %v", err)
	}

	if _, err := svc.ContributePool(ctx, contributor, p.ID, 400_00, key); err == nil {
		t.Fatal("contribution into a paid-out pool must be refused, not recorded")
	}
	if bal, _ := led.GetBalance(ctx, contributor); bal != 10_000_00 {
		t.Fatalf("contributor balance = %d, want 1000000 — the orphaned debit must be reversed", bal)
	}
	if n := countContributionRows(t, ctx, pool, p.ID, contributor); n != 0 {
		t.Fatalf("pool_contributions rows = %d, want 0 — a post-freeze row misstates the drain", n)
	}
}

// The PAID_OUT heal must drain the ACTUAL posted credit, not the recomputed
// row sum: a contribution row that slipped in post-freeze (pre-fix residue)
// must not inflate the drain — and the mismatch must surface loudly.
func TestLiveDB_SocialPayoutPool_HealDrainsActualCredit(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	contributor := fundedContributor(t, ctx, pool, led, 10_000_00)
	escrow, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}

	p, err := svc.CreatePool(ctx, organiser, "heal-drain", nil)
	if err != nil {
		t.Fatalf("create pool: %v", err)
	}
	if _, err := svc.ContributePool(ctx, contributor, p.ID, 400_00, "c-"+shortTag()); err != nil {
		t.Fatalf("contribute: %v", err)
	}
	// Residue: beneficiary credit posted for the frozen balance (400), drain
	// row missing, and a late 100 contribution row leaked in behind the freeze.
	key := "pool:payout:" + p.ID
	if err := led.Credit(ctx, organiser, key, key+":cr", escrow.ID, 400_00); err != nil {
		t.Fatalf("seed payout credit: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO pool_contributions (id, pool_id, user_id, amount_kobo, idempotency_key)
		 VALUES (gen_random_uuid(), $1, $2, 10000, $3)`,
		p.ID, contributor, "late-"+shortTag()); err != nil {
		t.Fatalf("seed late contribution row: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE group_pools SET state='PAID_OUT' WHERE id=$1`, p.ID); err != nil {
		t.Fatalf("freeze pool: %v", err)
	}

	err = svc.PayoutPool(ctx, organiser, p.ID, "retry-"+shortTag())
	if err == nil {
		t.Fatal("heal with a recomputed-sum mismatch must refuse loudly, not write a misstated drain")
	}
	var drain int64
	if err := pool.QueryRow(ctx,
		`SELECT amount_kobo FROM pool_contributions WHERE pool_id=$1 AND amount_kobo<0`, p.ID).Scan(&drain); err != nil {
		t.Fatalf("read drain row: %v", err)
	}
	if drain != -400_00 {
		t.Fatalf("drain = %d, want -40000 (the ACTUAL posted credit — the leaked row must not inflate it)", drain)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 400_00 {
		t.Fatalf("beneficiary balance = %d, want 40000 — no second credit", bal)
	}
}

// ─── 525-D4: equal-amount sibling share must not satisfy the heal probe ─────

// Two shares of the same bill at the same amount share the leg reference
// "split:<bill>". Share A paying must NOT mark share B settled — the heal
// probes the per-share deterministic keys, not (reference, amount).
func TestLiveDB_SocialPayShare_SiblingSameAmount_NotPhantomSettled(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	payerA := socialTestUser(t, pool)
	payerB := socialTestUser(t, pool)
	setKycTier(t, pool, payerA, 1)
	setKycTier(t, pool, payerB, 1)
	handleA := "sba" + shortTag()
	handleB := "sbb" + shortTag()
	if _, err := svc.tags.Claim(ctx, payerA, handleA); err != nil {
		t.Fatalf("claim A: %v", err)
	}
	if _, err := svc.tags.Claim(ctx, payerB, handleB); err != nil {
		t.Fatalf("claim B: %v", err)
	}
	fundWallet(t, ctx, led, payerA, 5_000_00)
	fundWallet(t, ctx, led, payerB, 5_000_00)

	_, shares, err := svc.CreateSplit(ctx, organiser, "siblings", 1_000_00, SplitCustom,
		[]ShareInput{{Handle: handleA, AmountKobo: 500_00}, {Handle: handleB, AmountKobo: 500_00}})
	if err != nil {
		t.Fatalf("create split: %v", err)
	}
	var shareA, shareB string
	for _, sh := range shares {
		if sh.UserID == payerA {
			shareA = sh.ID
		} else {
			shareB = sh.ID
		}
	}
	// A pays for real — posts legs under "split:<bill>" reference.
	if err := svc.PayShare(ctx, payerA, shareA, "sa-"+shortTag()); err != nil {
		t.Fatalf("pay share A: %v", err)
	}
	// Crash residue on B: settled-looking row, zero legs.
	if _, err := pool.Exec(ctx, `UPDATE split_shares SET state='PAID', paid_at=now() WHERE id=$1`, shareB); err != nil {
		t.Fatalf("seed stale claim B: %v", err)
	}

	if err := svc.PayShare(ctx, payerB, shareB, "sb-"+shortTag()); err != nil {
		t.Fatalf("pay share B err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, payerB); bal != 4_500_00 {
		t.Fatalf("payer B balance = %d, want 450000 — a sibling's credit must not phantom-settle B's share", bal)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 1_000_00 {
		t.Fatalf("organiser balance = %d, want 100000 — BOTH shares really paid", bal)
	}
}

// ─── 525-D5: heal paths emit audit events ───────────────────────────────────

// A debit-only residue healed by completing the credit emits
// social.split.pay.heal — heal credits are money mutations (iron rule).
func TestLiveDB_SocialPayShare_DebitOnlyHeal_EmitsAudit(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	rec := &recordingAuditor{}
	svc := socialServiceWithAudit(pool, rec)

	organiser := socialTestUser(t, pool)
	setKycTier(t, pool, organiser, 1)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "hea" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim: %v", err)
	}
	fundWallet(t, ctx, led, payer, 5_000_00)
	_, shares, err := svc.CreateSplit(ctx, organiser, "heal-audit", 600_00, SplitCustom,
		[]ShareInput{{Handle: handle, AmountKobo: 600_00}})
	if err != nil {
		t.Fatalf("create split: %v", err)
	}
	shareID := shares[0].ID
	escrow, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}
	// Residue: PAID row + payer debit, no organiser credit.
	if _, err := pool.Exec(ctx, `UPDATE split_shares SET state='PAID', paid_at=now() WHERE id=$1`, shareID); err != nil {
		t.Fatalf("seed claim: %v", err)
	}
	if err := led.Debit(ctx, payer, "split:"+shares[0].SplitID, "split:"+shareID+":dr", escrow.ID, 600_00); err != nil {
		t.Fatalf("seed debit leg: %v", err)
	}

	if err := svc.PayShare(ctx, payer, shareID, "heal-"+shortTag()); err != nil {
		t.Fatalf("heal pay share err = %v, want nil", err)
	}
	var seen bool
	for _, a := range rec.actions {
		if a == "social.split.pay.heal" {
			seen = true
		}
	}
	if !seen {
		t.Fatalf("heal credit emitted no audit — want social.split.pay.heal in %v", rec.actions)
	}
}

func TestLiveDB_SocialPayRequest_DebitOnlyHeal_EmitsAudit(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	rec := &recordingAuditor{}
	svc := socialServiceWithAudit(pool, rec)

	requester := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "hra" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim: %v", err)
	}
	req, err := svc.CreateRequest(ctx, requester, handle, "owed", 450_00)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	fundWallet(t, ctx, led, payer, 5_000_00)
	escrow, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow: %v", err)
	}
	// Residue: PAID row + payer debit, no requester credit.
	if _, err := pool.Exec(ctx, `UPDATE social_requests SET state='PAID', resolved_at=now() WHERE id=$1`, req.ID); err != nil {
		t.Fatalf("seed claim: %v", err)
	}
	if err := led.Debit(ctx, payer, "req:"+req.ID, "req:"+req.ID+":dr", escrow.ID, 450_00); err != nil {
		t.Fatalf("seed debit leg: %v", err)
	}

	if err := svc.PayRequest(ctx, payer, req.ID); err != nil {
		t.Fatalf("heal pay request err = %v, want nil", err)
	}
	var seen bool
	for _, a := range rec.actions {
		if a == "social.request.pay.heal" {
			seen = true
		}
	}
	if !seen {
		t.Fatalf("heal credit emitted no audit — want social.request.pay.heal in %v", rec.actions)
	}
}
