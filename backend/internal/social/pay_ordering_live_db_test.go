package social

// LIVE-DB regression tests for the pay-ordering residual surfaced by the
// wave-6 money/authz review: PayRequest and PayShare used to flip their row to
// a settled state BEFORE posting the ledger legs. A debit that then failed
// (insufficient funds is the common one) left a settled-looking row that was
// never paid — and PayShare's idempotent re-entry returned nil over the lie,
// so the share could never be collected.
// Each test proves:
//   1. a failed debit leaves the row UNSETTLED (PENDING), not settled;
//   2. a retry after the failure cause is fixed completes the payment — the
//      failed attempt is retryable, not a tombstone;
//   3. a stale settled claim with no ledger legs (crash between the old
//      claim-flip and the debit) is healed on re-entry — reverted and paid
//      through the normal path rather than reported "paid" forever.
// ⚠️ GATED ON TEST_DATABASE_URL — these move money. Run:
//	TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres' \
//	  go test ./internal/social/ -run 'TestLiveDB_' -v

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

func TestLiveDB_SocialPayRequest_FailedDebit_StaysPendingRetryable(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	requester := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "fdr" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	req, err := svc.CreateRequest(ctx, requester, handle, "owed", 700_00)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	// Payer tiered but UNFUNDED — the ledger debit must fail.
	if err := svc.PayRequest(ctx, payer, req.ID); !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("unfunded pay request err = %v, want ledger.ErrInsufficientFunds", err)
	}
	got, err := svc.getRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("re-read request: %v", err)
	}
	if got.State != RequestPending {
		t.Fatalf("request state = %q after failed debit, want PENDING (a failed debit must never mark the debt paid)", got.State)
	}

	// Fund and retry — the failed attempt must be retryable.
	fundWallet(t, ctx, led, payer, 5_000_00)
	if err := svc.PayRequest(ctx, payer, req.ID); err != nil {
		t.Fatalf("retry pay request err = %v, want nil", err)
	}
	got, err = svc.getRequest(ctx, req.ID)
	if err != nil || got.State != RequestPaid {
		t.Fatalf("request state = %v err=%v after retry, want PAID", got, err)
	}
	if bal, _ := led.GetBalance(ctx, requester); bal != 700_00 {
		t.Fatalf("requester balance = %d, want 70000", bal)
	}
}

func TestLiveDB_SocialPayShare_FailedDebit_StaysPendingRetryable(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "fds" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	_, shares, err := svc.CreateSplit(ctx, organiser, "taxi", 900_00, SplitCustom,
		[]ShareInput{{Handle: handle, AmountKobo: 900_00}})
	if err != nil {
		t.Fatalf("create split: %v", err)
	}
	if len(shares) != 1 {
		t.Fatalf("want 1 share, got %d", len(shares))
	}
	shareID := shares[0].ID

	// Unfunded payer: debit fails; the share MUST stay PENDING.
	if err := svc.PayShare(ctx, payer, shareID, "share-"+shortTag()); !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("unfunded pay share err = %v, want ledger.ErrInsufficientFunds", err)
	}
	var state string
	if err := pool.QueryRow(ctx, `SELECT state FROM split_shares WHERE id=$1`, shareID).Scan(&state); err != nil {
		t.Fatalf("read share state: %v", err)
	}
	if state != "PENDING" {
		t.Fatalf("share state = %q after failed debit, want PENDING", state)
	}

	fundWallet(t, ctx, led, payer, 5_000_00)
	if err := svc.PayShare(ctx, payer, shareID, "share-"+shortTag()); err != nil {
		t.Fatalf("retry pay share err = %v, want nil", err)
	}
	if err := pool.QueryRow(ctx, `SELECT state FROM split_shares WHERE id=$1`, shareID).Scan(&state); err != nil {
		t.Fatalf("re-read share state: %v", err)
	}
	if state != "PAID" {
		t.Fatalf("share state = %q after retry, want PAID", state)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 900_00 {
		t.Fatalf("organiser balance = %d, want 90000", bal)
	}
}

// A share stuck PAID with NO ledger legs — exactly what a crash between the
// old claim-flip and the debit left behind, and what PayShare used to answer
// "nil" to forever — must be healed on re-entry: the stale claim reverts and
// the payment completes through the normal path.
func TestLiveDB_SocialPayShare_StalePaidClaim_Heals(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "stl" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	_, shares, err := svc.CreateSplit(ctx, organiser, "heal", 600_00, SplitCustom,
		[]ShareInput{{Handle: handle, AmountKobo: 600_00}})
	if err != nil {
		t.Fatalf("create split: %v", err)
	}
	shareID := shares[0].ID
	fundWallet(t, ctx, led, payer, 5_000_00)

	// Simulate the pre-fix crash residue: settled row, zero ledger legs.
	if _, err := pool.Exec(ctx, `UPDATE split_shares SET state='PAID', paid_at=now() WHERE id=$1`, shareID); err != nil {
		t.Fatalf("seed stale claim: %v", err)
	}
	if err := svc.PayShare(ctx, payer, shareID, "heal-"+shortTag()); err != nil {
		t.Fatalf("heal-entry pay share err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 600_00 {
		t.Fatalf("organiser balance = %d, want 60000 — the stale claim must be healed, not returned as paid", bal)
	}
	if bal, _ := led.GetBalance(ctx, payer); bal != 4_400_00 {
		t.Fatalf("payer balance = %d, want 440000 (exactly one debit)", bal)
	}
}

// A stale-PAID share must never be settled by a SIBLING share's legs. Every
// share of one bill posts under the same "split:<bill>" reference, so a
// (reference, amount) probe treats an equal-amount sibling's posted legs as
// this share's — the wave-10 equal-amount PayShare false-positive: the second
// share reads "paid" while no money ever moved for it. The heal probes must
// key on the share's own deterministic ledger keys (split:<shareID>:…), never
// on (reference, amount).
func TestLiveDB_SocialPayShare_EqualSibling_DoesNotPhantomSettle(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	organiser := socialTestUser(t, pool)
	payerA := socialTestUser(t, pool)
	payerB := socialTestUser(t, pool)
	setKycTier(t, pool, payerA, 1)
	setKycTier(t, pool, payerB, 1)
	handleA := "esa" + shortTag()
	handleB := "esb" + shortTag()
	if _, err := svc.tags.Claim(ctx, payerA, handleA); err != nil {
		t.Fatalf("claim handle A: %v", err)
	}
	if _, err := svc.tags.Claim(ctx, payerB, handleB); err != nil {
		t.Fatalf("claim handle B: %v", err)
	}

	// EQUAL split, two identical 400_00 shares — the collision shape.
	_, shares, err := svc.CreateSplit(ctx, organiser, "dinner", 800_00, SplitEqual,
		[]ShareInput{{Handle: handleA}, {Handle: handleB}})
	if err != nil {
		t.Fatalf("create split: %v", err)
	}
	var shareA, shareB string
	for _, sh := range shares {
		switch sh.UserID {
		case payerA:
			shareA = sh.ID
		case payerB:
			shareB = sh.ID
		}
	}
	if shareA == "" || shareB == "" {
		t.Fatalf("shares not mapped to payers: %+v", shares)
	}

	fundWallet(t, ctx, led, payerA, 5_000_00)
	fundWallet(t, ctx, led, payerB, 5_000_00)

	// Share A settles genuinely — posts "split:<bill>" legs of 400_00.
	if err := svc.PayShare(ctx, payerA, shareA, "a-"+shortTag()); err != nil {
		t.Fatalf("pay share A err = %v, want nil", err)
	}

	// Pre-fix crash residue on share B: a settled row with zero legs of its
	// own (the old claim-flip-then-debit ordering left exactly this).
	if _, err := pool.Exec(ctx, `UPDATE split_shares SET state='PAID', paid_at=now() WHERE id=$1`, shareB); err != nil {
		t.Fatalf("seed stale claim: %v", err)
	}

	// Re-entry must heal share B by moving B's money — never read A's legs as
	// B's and report "paid" over an uncollected share.
	if err := svc.PayShare(ctx, payerB, shareB, "b-"+shortTag()); err != nil {
		t.Fatalf("heal-entry pay share B err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, organiser); bal != 800_00 {
		t.Fatalf("organiser balance = %d, want 80000 — sibling legs must not phantom-settle share B", bal)
	}
	if bal, _ := led.GetBalance(ctx, payerB); bal != 4_600_00 {
		t.Fatalf("payer B balance = %d, want 460000 (exactly one debit)", bal)
	}
}

func TestLiveDB_SocialPayRequest_StalePaidClaim_Heals(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	svc := socialService(pool)

	requester := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "stq" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	req, err := svc.CreateRequest(ctx, requester, handle, "stale", 300_00)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	fundWallet(t, ctx, led, payer, 5_000_00)

	if _, err := pool.Exec(ctx, `UPDATE social_requests SET state='PAID', resolved_at=now() WHERE id=$1`, req.ID); err != nil {
		t.Fatalf("seed stale claim: %v", err)
	}
	if err := svc.PayRequest(ctx, payer, req.ID); err != nil {
		t.Fatalf("heal-entry pay request err = %v, want nil", err)
	}
	if bal, _ := led.GetBalance(ctx, requester); bal != 300_00 {
		t.Fatalf("requester balance = %d, want 30000", bal)
	}
	if bal, _ := led.GetBalance(ctx, payer); bal != 4_700_00 {
		t.Fatalf("payer balance = %d, want 470000 (exactly one debit)", bal)
	}
}

// shortTag returns a short unique suffix for handles/keys.
func shortTag() string {
	return uuid.NewString()[:8]
}

// R-2: a heal credit that reports ErrDuplicate is never trusted — the durable
// requester credit leg is re-probed before the row may settle. A phantom
// claim (foreign legs parked under the heal's ":cr" key — the durable proxy
// for a bare Redis-lock claim) must answer ErrReconPending, leave the row
// PENDING and emit NO heal audit — never PAID over a credit that doesn't
// exist on the requester's wallet.
func TestLiveDB_SocialPayRequest_PhantomDupCredit_StaysPending(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	requester := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	decoy := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "pdc" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	req, err := svc.CreateRequest(ctx, requester, handle, "owed", 700_00)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}

	key := "req:" + req.ID
	escrow, err := svc.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}
	// Plant the payer's debit journal — the durable half of a crashed payment
	// that the heal path must complete.
	fundWallet(t, ctx, svc.led, payer, 1_000_00)
	if err := svc.led.DebitGated(ctx, payer, key, key+":dr", escrow.ID, 700_00); err != nil {
		t.Fatalf("plant payer debit: %v", err)
	}
	// Plant a FOREIGN journal claiming the heal's ":cr" key — its legs land on
	// the decoy's wallet, so the requester credit the heal must prove is
	// absent even though the key is held.
	decoyWallet, err := svc.led.GetOrCreateUserWallet(ctx, decoy)
	if err != nil {
		t.Fatalf("decoy wallet: %v", err)
	}
	if err := svc.led.PostJournal(ctx, ledger.JournalEntry{
		Reference: key, IdempotencyKey: key + ":cr", AmountKobo: 700_00,
		DebitAccountID: escrow.ID, CreditAccountID: decoyWallet.ID,
	}); err != nil {
		t.Fatalf("plant phantom credit claim: %v", err)
	}

	err = svc.PayRequest(ctx, payer, req.ID)
	if !errors.Is(err, ErrReconPending) {
		t.Fatalf("phantom dup credit must answer ErrReconPending, got %v", err)
	}
	got, err := svc.getRequest(ctx, req.ID)
	if err != nil {
		t.Fatalf("re-read request: %v", err)
	}
	if got.State != RequestPending {
		t.Fatalf("request state = %q after phantom credit claim, want PENDING (a dup claim must never settle on legs that aren't the requester's)", got.State)
	}
	// The requester's wallet shows no credit — the phantom legs went to decoy.
	if bal, _ := svc.led.GetBalance(ctx, requester); bal != 0 {
		t.Fatalf("requester balance = %d, want 0 — phantom credit must never settle", bal)
	}
}

// The debit-only heal — a PENDING request whose payer debit is durable but
// the requester credit never posted (crash between the legs). PayRequest must
// post ONLY the missing credit, flip PAID, and not re-charge the payer.
func TestLiveDB_SocialPayRequest_DebitOnlyHeal_Completes(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	requester := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "doh" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	req, err := svc.CreateRequest(ctx, requester, handle, "owed", 700_00)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}

	key := "req:" + req.ID
	escrow, err := svc.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}
	fundWallet(t, ctx, svc.led, payer, 1_000_00)
	if err := svc.led.DebitGated(ctx, payer, key, key+":dr", escrow.ID, 700_00); err != nil {
		t.Fatalf("plant payer debit: %v", err)
	}

	if err := svc.PayRequest(ctx, payer, req.ID); err != nil {
		t.Fatalf("heal must converge, got %v", err)
	}
	got, err := svc.getRequest(ctx, req.ID)
	if err != nil || got.State != RequestPaid {
		t.Fatalf("request state = %v err=%v after heal, want PAID", got, err)
	}
	if bal, _ := svc.led.GetBalance(ctx, requester); bal != 700_00 {
		t.Fatalf("requester balance = %d, want 70000", bal)
	}
	// Exactly ONE debit leg on the payer — the heal never re-charges.
	if n := ledgerLegs(t, pool, key); n != 4 {
		t.Fatalf("healed request must hold exactly 4 ledger legs (dr pair + cr pair), got %d", n)
	}
}

// The PAID-variant of the debit-only heal — the row flipped PAID but the
// requester credit never landed. The heal must still post the credit.
func TestLiveDB_SocialPayRequest_PaidDebitOnlyHeal_Completes(t *testing.T) {
	pool := socialTestPool(t)
	ctx := context.Background()
	svc := socialService(pool)

	requester := socialTestUser(t, pool)
	payer := socialTestUser(t, pool)
	setKycTier(t, pool, payer, 1)
	handle := "pdh" + shortTag()
	if _, err := svc.tags.Claim(ctx, payer, handle); err != nil {
		t.Fatalf("claim handle: %v", err)
	}
	req, err := svc.CreateRequest(ctx, requester, handle, "owed", 700_00)
	if err != nil {
		t.Fatalf("create request: %v", err)
	}

	key := "req:" + req.ID
	escrow, err := svc.led.GetOrCreateStandingAccount(ctx, ledger.AccountEscrow)
	if err != nil {
		t.Fatalf("escrow account: %v", err)
	}
	fundWallet(t, ctx, svc.led, payer, 1_000_00)
	if err := svc.led.DebitGated(ctx, payer, key, key+":dr", escrow.ID, 700_00); err != nil {
		t.Fatalf("plant payer debit: %v", err)
	}
	// Force the stale claim: PAID with only the debit leg durable.
	if _, err := pool.Exec(ctx,
		`UPDATE social_requests SET state='PAID', resolved_at=now() WHERE id=$1`, req.ID); err != nil {
		t.Fatalf("force stale paid: %v", err)
	}

	if err := svc.PayRequest(ctx, payer, req.ID); err != nil {
		t.Fatalf("heal of stale PAID must converge, got %v", err)
	}
	if bal, _ := svc.led.GetBalance(ctx, requester); bal != 700_00 {
		t.Fatalf("requester balance = %d, want 70000", bal)
	}
	if n := ledgerLegs(t, pool, key); n != 4 {
		t.Fatalf("healed request must hold exactly 4 ledger legs (dr pair + cr pair), got %d", n)
	}
}
