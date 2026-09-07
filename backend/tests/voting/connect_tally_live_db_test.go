package voting_test

// The connect tally follows the credit — guards migrations 20270140000000 and
// 20270143000000.
//
// A money-path audit found the first attempt at this (a TypeScript bridge called
// from two routes) covered ONE of four entry points: voting/payment/webhook.ts
// calls verifyAndCreditPaidVote() directly and app/vote-callback still posts to
// the v1 verify route, and all of those files are brownfield-protected. Every
// rail ends at vote_transactions.vote_credit_status = 'credited', so the
// projection is driven from there instead and cannot be bypassed by a new caller.
//
// These tests exercise the rails through the TABLE, which is what the webhook
// does — not through a route, which is what only one rail does.

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// tallyFixture is one contest with a roster of one and a borrowed voter.
type tallyFixture struct {
	pool       *pgxpool.Pool
	contest    string
	contestant string
	voter      string
}

func newTallyFixture(t *testing.T) (context.Context, tallyFixture) {
	t.Helper()
	pool := votingPool(t)
	ctx := context.Background()
	// Priced and open, because that is the shape a real paid vote arrives on.
	contest := newContest(t, ctx, pool, contestOpts{status: "open", paidVoteKobo: 10_000})
	return ctx, tallyFixture{
		pool:       pool,
		contest:    contest,
		contestant: newContestant(t, ctx, pool, contest),
		voter:      anyVoter(t, ctx, pool),
	}
}

// purchase writes a vote_transactions row the way a checkout does: successful
// payment, credit still pending. It returns the transaction id.
func (f tallyFixture) purchase(t *testing.T, ctx context.Context, ref string, opts purchaseOpts) string {
	t.Helper()
	if opts.contestant == "" {
		opts.contestant = f.contestant
	}
	if opts.votes == 0 {
		opts.votes = 50
	}
	if opts.naira == 0 {
		opts.naira = 5000.00
	}
	var id string
	err := f.pool.QueryRow(ctx, `
		INSERT INTO public.vote_transactions (
			contest_id, contestant_id, voter_user_id, payment_provider, payment_reference,
			amount_expected, votes_purchased, bonus_votes, total_votes_to_credit,
			payment_status, vote_credit_status, voter_email, voter_name)
		VALUES ($1, $2, $3, 'paystack', $4, $5, $6, 0, $6, 'successful', 'pending', 'zz@example.com', 'ZZ')
		RETURNING id::text`,
		f.contest, opts.contestant, f.voter, ref, opts.naira, opts.votes).Scan(&id)
	if err != nil {
		t.Fatalf("seed purchase: %v", err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DELETE FROM public.vote_transactions WHERE id=$1`, id)
	})
	return id
}

type purchaseOpts struct {
	contestant string
	votes      int
	naira      float64
}

func (f tallyFixture) setCreditStatus(t *testing.T, ctx context.Context, id, status string) {
	t.Helper()
	if _, err := f.pool.Exec(ctx,
		`UPDATE public.vote_transactions SET vote_credit_status=$2 WHERE id=$1`, id, status); err != nil {
		t.Fatalf("set vote_credit_status=%s: %v", status, err)
	}
}

// mirrorRows reads the projection the mobile roster actually sums.
type mirrorRow struct {
	quantity   int
	amountKobo int64
	paid       bool
	optionRef  string
}

func (f tallyFixture) mirrorRows(t *testing.T, ctx context.Context, ref string) []mirrorRow {
	t.Helper()
	rows, err := f.pool.Query(ctx, `
		SELECT quantity, amount_kobo, paid, option_ref
		  FROM public.connect_votes WHERE ledger_ref=$1`, ref)
	if err != nil {
		t.Fatalf("read connect_votes: %v", err)
	}
	defer rows.Close()
	var out []mirrorRow
	for rows.Next() {
		var r mirrorRow
		if err := rows.Scan(&r.quantity, &r.amountKobo, &r.paid, &r.optionRef); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate: %v", err)
	}
	return out
}

// skipReasons reads why the trigger declined to project a purchase. A buyer who
// paid and cannot be shown their votes must never be invisible.
func (f tallyFixture) skipReasons(t *testing.T, ctx context.Context, ref string) []outboxSkip {
	t.Helper()
	rows, err := f.pool.Query(ctx, `
		SELECT status, last_error
		  FROM public.bridge_outbox
		 WHERE event_type='votes.paid.tally_skipped'
		   AND payload->>'paymentReference' = $1`, ref)
	if err != nil {
		t.Fatalf("read bridge_outbox: %v", err)
	}
	defer rows.Close()
	var out []outboxSkip
	for rows.Next() {
		var s outboxSkip
		if err := rows.Scan(&s.status, &s.lastError); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out = append(out, s)
	}
	return out
}

type outboxSkip struct {
	status    string
	lastError string
}

func TestTally_DoesNotCountAPurchaseThatHasNotBeenCredited(t *testing.T) {
	ctx, f := newTallyFixture(t)
	ref := fixtureRef("PENDING")
	f.purchase(t, ctx, ref, purchaseOpts{})

	if rows := f.mirrorRows(t, ctx, ref); len(rows) != 0 {
		t.Errorf("projected %d rows for an uncredited purchase, want 0", len(rows))
	}
}

// The webhook rail is brownfield-protected, so this is the shape that matters:
// the table changes, and the projection follows with no route involved.
func TestTally_CountsThePurchaseWhenTheWebhookCreditsIt(t *testing.T) {
	ctx, f := newTallyFixture(t)
	ref := fixtureRef("WEBHOOK")
	id := f.purchase(t, ctx, ref, purchaseOpts{})
	f.setCreditStatus(t, ctx, id, "credited")

	rows := f.mirrorRows(t, ctx, ref)
	if len(rows) != 1 {
		t.Fatalf("projected %d rows, want 1", len(rows))
	}
	got := rows[0]
	if got.quantity != 50 {
		t.Errorf("quantity = %d, want 50", got.quantity)
	}
	// amount_expected is NAIRA (5000.00); connect_votes.amount_kobo is minor units.
	if got.amountKobo != 500_000 {
		t.Errorf("amount_kobo = %d, want 500000 — NGN 5000 in minor units", got.amountKobo)
	}
	if !got.paid {
		t.Error("paid = false on a paid vote")
	}
	if got.optionRef != f.contestant {
		t.Errorf("option_ref = %q, want the contestant id %q", got.optionRef, f.contestant)
	}
}

// A webhook and a browser redirect can both credit the same transaction. They
// must collapse on the partial idempotency index, not double somebody's votes.
func TestTally_DoesNotDoubleWhenAWebhookAndARedirectBothCredit(t *testing.T) {
	ctx, f := newTallyFixture(t)
	ref := fixtureRef("RACE")
	id := f.purchase(t, ctx, ref, purchaseOpts{})
	f.setCreditStatus(t, ctx, id, "credited")
	f.setCreditStatus(t, ctx, id, "credited")

	if rows := f.mirrorRows(t, ctx, ref); len(rows) != 1 {
		t.Errorf("projected %d rows after two credits, want 1", len(rows))
	}
}

// Money back, tally back. Before this, a refunded purchase kept its votes on the
// mobile roster permanently, because connect_votes has no reversal concept.
func TestTally_StopsCountingReversedVotes(t *testing.T) {
	ctx, f := newTallyFixture(t)
	ref := fixtureRef("REVERSE")
	id := f.purchase(t, ctx, ref, purchaseOpts{})

	f.setCreditStatus(t, ctx, id, "credited")
	if rows := f.mirrorRows(t, ctx, ref); len(rows) != 1 {
		t.Fatalf("projected %d rows before the reversal, want 1", len(rows))
	}

	f.setCreditStatus(t, ctx, id, "reversed")
	if rows := f.mirrorRows(t, ctx, ref); len(rows) != 0 {
		t.Errorf("projected %d rows after the reversal, want 0", len(rows))
	}
}

// A refund is terminal — guards 20270143000000. Reachable, not theoretical:
// paid-vote.service short-circuits only on 'credited' and bails only on
// payment_status failed/abandoned — not 'refunded' — a refunded Paystack charge
// still verifies as success, and /vote-callback sits in the buyer's history.
func TestTally_RefusesToReCreditAfterARefundAndRecordsWhy(t *testing.T) {
	ctx, f := newTallyFixture(t)
	ref := fixtureRef("REFUND")
	id := f.purchase(t, ctx, ref, purchaseOpts{votes: 120, naira: 10_000})

	f.setCreditStatus(t, ctx, id, "credited")
	if rows := f.mirrorRows(t, ctx, ref); len(rows) != 1 {
		t.Fatalf("projected %d rows on the first credit, want 1", len(rows))
	}

	if _, err := f.pool.Exec(ctx, `
		UPDATE public.vote_transactions
		   SET payment_status='refunded', vote_credit_status='reversed'
		 WHERE id=$1`, id); err != nil {
		t.Fatalf("refund: %v", err)
	}
	if rows := f.mirrorRows(t, ctx, ref); len(rows) != 0 {
		t.Fatalf("projected %d rows after the refund, want 0", len(rows))
	}

	// The buyer re-opens the callback URL and the transaction is credited again.
	f.setCreditStatus(t, ctx, id, "credited")
	if rows := f.mirrorRows(t, ctx, ref); len(rows) != 0 {
		t.Errorf("projected %d rows after a re-credit; refunded votes must not return", len(rows))
	}

	skips := f.skipReasons(t, ctx, ref)
	if !hasReason(skips, "recredit_after_refund") {
		t.Errorf("bridge_outbox reasons = %v, want one of them 'recredit_after_refund'", skips)
	}
	for _, s := range skips {
		// 'pending', not 'failed': processPendingOutboxEvents only selects
		// 'pending', so a 'failed' row is invisible to the drainer meant to retry it.
		if s.status != "pending" {
			t.Errorf("outbox status = %q, want 'pending' or the drainer never sees it", s.status)
		}
	}
}

// ListRoster filters on connect_contest_id ALONE, so projecting a vote onto a
// contestant who is not on this contest would report success for a vote the
// roster can never display — a false green.
func TestTally_RefusesAContestantNotOnTheContestAndRecordsWhy(t *testing.T) {
	ctx, f := newTallyFixture(t)
	ref := fixtureRef("STRANGER")
	stranger := newContestant(t, ctx, f.pool, "") // on no contest at all

	id := f.purchase(t, ctx, ref, purchaseOpts{contestant: stranger})
	f.setCreditStatus(t, ctx, id, "credited")

	if rows := f.mirrorRows(t, ctx, ref); len(rows) != 0 {
		t.Errorf("projected %d rows for an off-roster contestant, want 0", len(rows))
	}
	if skips := f.skipReasons(t, ctx, ref); !hasReason(skips, "contestant_not_in_contest") {
		t.Errorf("bridge_outbox reasons = %v, want one of them 'contestant_not_in_contest'", skips)
	}
}

func hasReason(skips []outboxSkip, want string) bool {
	for _, s := range skips {
		if s.lastError == want {
			return true
		}
	}
	return false
}
