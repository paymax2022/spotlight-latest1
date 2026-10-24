package top5events_test

// Live-DB tests for the Paystack card checkout rail for ticket orders
// (EVTB-D013). Skip unless TEST_DATABASE_URL is set (via ticketTokenPool).
//
// Ledger assertions read the journal legs by idempotency key rather than
// standing-account balance deltas: escrow/provider_clearing are shared standing
// accounts that other packages' tests post to concurrently.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/cryptox"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/paystack"
	"spotlight/backend/internal/top5events"
	"spotlight/backend/internal/webhooks"
)

// fakeCardGateway is an in-memory Paystack stand-in: initialize records the
// reference, verify answers from the charges map (absent ⇒ "abandoned"), refund
// records the call. Concurrency-safe.
type fakeCardGateway struct {
	mu        sync.Mutex
	charges   map[string]provider.PaymentStatus
	inits     map[string]int
	initAmt   map[string]int64
	refunds   []fakeRefund
	refundErr error // returned (once) by the next RefundPayment
	verifyErr error
}

type fakeRefund struct {
	reference string
	amount    int64
}

func newFakeCardGateway() *fakeCardGateway {
	return &fakeCardGateway{charges: map[string]provider.PaymentStatus{}, inits: map[string]int{}, initAmt: map[string]int64{}}
}

func (g *fakeCardGateway) InitializePayment(_ context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.inits[req.Reference]++
	g.initAmt[req.Reference] = req.AmountKobo
	return &provider.InitializePaymentResponse{
		Reference:        req.Reference,
		AuthorizationURL: "https://checkout.paystack.test/" + req.Reference,
		AccessCode:       "ac_" + req.Reference,
	}, nil
}

func (g *fakeCardGateway) VerifyPayment(_ context.Context, reference string) (*provider.PaymentStatus, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.verifyErr != nil {
		return nil, g.verifyErr
	}
	if st, ok := g.charges[reference]; ok {
		return &st, nil
	}
	return &provider.PaymentStatus{Reference: reference, Status: "abandoned", Currency: "NGN"}, nil
}

func (g *fakeCardGateway) RefundPayment(_ context.Context, reference string, amountKobo int64) (*provider.RefundResult, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.refundErr != nil {
		err := g.refundErr
		g.refundErr = nil
		return nil, err
	}
	g.refunds = append(g.refunds, fakeRefund{reference, amountKobo})
	return &provider.RefundResult{Reference: reference, Status: provider.RefundStatusProcessed, AmountKobo: amountKobo, ID: "rf_" + reference}, nil
}

func (g *fakeCardGateway) LookupRefund(_ context.Context, reference string) (*provider.RefundResult, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, r := range g.refunds {
		if r.reference == reference {
			return &provider.RefundResult{Reference: reference, Status: provider.RefundStatusProcessed, AmountKobo: r.amount}, nil
		}
	}
	return nil, nil
}

// pay marks reference as a successful charge of amount in currency.
func (g *fakeCardGateway) pay(reference string, amount int64, currency string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.charges[reference] = provider.PaymentStatus{Reference: reference, Status: "success", AmountKobo: amount, Currency: currency, Channel: "card"}
}

func (g *fakeCardGateway) refundCalls() []fakeRefund {
	g.mu.Lock()
	defer g.mu.Unlock()
	return append([]fakeRefund(nil), g.refunds...)
}

func cardService(t *testing.T, pool *pgxpool.Pool) (*top5events.Service, *fakeCardGateway) {
	t.Helper()
	svc := ticketTokenService(pool)
	gw := newFakeCardGateway()
	svc.EnableCardCheckout(gw, top5events.CardCheckoutOptions{
		InitiateEnabled: true,
		HoldTTL:         15 * time.Minute,
		StaleClaimAfter: 2 * time.Minute,
	})
	return svc, gw
}

func cardKey() string { return "card-" + uuid.New().String() }

func cardReq(eventID, tierID string, qty int, key string) top5events.CardCheckoutRequest {
	return top5events.CardCheckoutRequest{
		EventID: eventID, TierID: tierID, Quantity: qty, IdempotencyKey: key,
		Email: "buyer@example.test",
	}
}

func tierSold(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tierID string) int {
	t.Helper()
	var sold int
	if err := pool.QueryRow(ctx, `SELECT sold FROM event_ticket_tiers WHERE id=$1`, tierID).Scan(&sold); err != nil {
		t.Fatalf("read sold: %v", err)
	}
	return sold
}

func intentStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ref string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT status FROM event_card_intents WHERE reference=$1`, ref).Scan(&st); err != nil {
		t.Fatalf("intent status: %v", err)
	}
	return st
}

// cardLegs sums the journal legs posted for a card intent's orders, by account
// type and entry type. A balanced settlement has DEBIT provider_clearing ==
// CREDIT escrow == the collected total, and nothing else.
func cardLegs(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ref string) map[string]int64 {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT la.type || ':' || le.type, SUM(le.amount_kobo)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id = le.account_id
		WHERE le.idempotency_key LIKE 'evtcard:%'
		  AND split_part(le.idempotency_key, ':', 2) IN (SELECT id::text FROM event_orders WHERE card_reference=$1)
		GROUP BY 1`, ref)
	if err != nil {
		t.Fatalf("legs: %v", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var k string
		var v int64
		if err := rows.Scan(&k, &v); err != nil {
			t.Fatalf("scan legs: %v", err)
		}
		out[k] = v
	}
	return out
}

func assertBalancedCardLegs(t *testing.T, legs map[string]int64, want int64) {
	t.Helper()
	if len(legs) != 2 || legs["provider_clearing:DEBIT"] != want || legs["escrow:CREDIT"] != want {
		t.Fatalf("ledger legs = %v, want exactly DEBIT provider_clearing %d / CREDIT escrow %d", legs, want, want)
	}
}

// EVT-UAT-135 / 139: card → verified charge → orders PAID, tickets issued once,
// one balanced posting per order into the SAME escrow the wallet path uses; the
// buyer's wallet is never touched. Replays (webhook ×3, status poll, sweep) are
// no-ops.
func TestLiveDB_CardCheckout_HappyPath_IssuesOnce_LedgerBalanced(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, gw := cardService(t, pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 250000, 10, 0)

	co, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 2, cardKey()))
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	if co.AmountKobo != 500000 || co.Currency != "NGN" || co.Quantity != 2 || co.Status != "pending" || co.AuthorizationURL == "" {
		t.Fatalf("checkout = %+v", co)
	}
	if gw.initAmt[co.Reference] != 500000 {
		t.Fatalf("gateway asked to collect %d, want 500000 (server-quoted)", gw.initAmt[co.Reference])
	}
	// Hold: two seats reserved, two PENDING card orders, no money, no tickets.
	if got := tierSold(t, ctx, pool, tier); got != 2 {
		t.Fatalf("sold after hold = %d, want 2", got)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_orders WHERE card_reference=$1 AND status='PENDING' AND payment_rail='card'`, co.Reference); n != 2 {
		t.Fatalf("pending card orders = %d, want 2", n)
	}
	if legs := cardLegs(t, ctx, pool, co.Reference); len(legs) != 0 {
		t.Fatalf("money moved before payment: %v", legs)
	}
	walletBefore := buyerBalance(t, ctx, cancelLedger(pool), buyer)

	// Status poll before payment: still pending, nothing issued.
	st, err := svc.CardCheckoutStatus(ctx, buyer, co.Reference)
	if err != nil || st.Status != "pending" || len(st.Tickets) != 0 {
		t.Fatalf("pre-pay status = %+v, %v", st, err)
	}

	gw.pay(co.Reference, 500000, "NGN")
	res, err := svc.ConfirmCardCharge(ctx, co.Reference)
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if res.Status != "confirmed" || len(res.Tickets) != 2 {
		t.Fatalf("confirm result = %+v", res)
	}

	// Replays: webhook redelivered 3×, a status poll, and a sweep.
	for range 3 {
		if r, err := svc.ConfirmCardCharge(ctx, co.Reference); err != nil || r.Status != "confirmed" {
			t.Fatalf("replay = %+v, %v", r, err)
		}
	}
	if r, err := svc.CardCheckoutStatus(ctx, buyer, co.Reference); err != nil || r.Status != "confirmed" || len(r.Tickets) != 2 {
		t.Fatalf("status after confirm = %+v, %v", r, err)
	}
	if _, err := svc.ReconcileCardCheckouts(ctx, 0); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_tickets WHERE order_id IN (SELECT id FROM event_orders WHERE card_reference=$1)`, co.Reference); n != 2 {
		t.Fatalf("tickets = %d, want exactly 2", n)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_orders WHERE card_reference=$1 AND status='PAID'`, co.Reference); n != 2 {
		t.Fatalf("paid orders = %d, want 2", n)
	}
	if got := tierSold(t, ctx, pool, tier); got != 2 {
		t.Fatalf("sold after confirm = %d, want 2 (inventory committed once)", got)
	}
	assertBalancedCardLegs(t, cardLegs(t, ctx, pool, co.Reference), 500000)
	if got := buyerBalance(t, ctx, cancelLedger(pool), buyer); got != walletBefore {
		t.Fatalf("buyer wallet moved %d → %d on a card checkout", walletBefore, got)
	}
	if len(gw.refundCalls()) != 0 {
		t.Fatalf("unexpected refunds: %v", gw.refundCalls())
	}
}

// EVT-UAT-139 / 141: the SIGNED shared Paystack webhook (HMAC-SHA512) routes the
// "evtorder-" prefix here; a forged signature is rejected before any state
// change; a genuine one replayed 3× issues tickets once.
func TestLiveDB_CardCheckout_SignedWebhook_ForgedRejected_ReplayNoop(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, gw := cardService(t, pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 100000, 10, 0)

	co, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 1, cardKey()))
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	gw.pay(co.Reference, 100000, "NGN")

	const secret = "sk_test_events_card"
	wh := webhooks.NewPaystackHandler(paystack.New(secret), nil, nil, nil)
	wh.RegisterPrefixConfirmer(top5events.CardReferencePrefix, svc.CardWebhookConfirmer())
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/webhooks/paystack/go", wh.Handle)

	body, err := json.Marshal(map[string]any{
		"event": "charge.success",
		"data":  map[string]any{"reference": co.Reference, "amount": 100000, "currency": "NGN"},
	})
	if err != nil {
		t.Fatalf("marshal webhook body: %v", err)
	}
	send := func(sig string) int {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/webhooks/paystack/go", bytes.NewReader(body))
		req.Header.Set("X-Paystack-Signature", sig)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	if code := send("deadbeef"); code != http.StatusUnauthorized {
		t.Fatalf("forged signature → %d, want 401", code)
	}
	if st := intentStatus(t, ctx, pool, co.Reference); st != "pending" {
		t.Fatalf("forged webhook moved intent to %s", st)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_tickets WHERE order_id IN (SELECT id FROM event_orders WHERE card_reference=$1)`, co.Reference); n != 0 {
		t.Fatalf("forged webhook issued %d tickets", n)
	}

	sig := cryptox.HMACSHA512Hex(secret, body)
	for range 3 {
		if code := send(sig); code != http.StatusOK {
			t.Fatalf("signed webhook → %d", code)
		}
	}
	if st := intentStatus(t, ctx, pool, co.Reference); st != "confirmed" {
		t.Fatalf("intent after signed webhook = %s", st)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_tickets WHERE order_id IN (SELECT id FROM event_orders WHERE card_reference=$1)`, co.Reference); n != 1 {
		t.Fatalf("tickets = %d, want 1", n)
	}
	assertBalancedCardLegs(t, cardLegs(t, ctx, pool, co.Reference), 100000)
}

// EVT-UAT-142 / 147 / 148: a verified charge whose amount differs from the frozen
// order total (under-, over-payment) or whose currency is not NGN never issues a
// ticket and never touches escrow: the hold is released and the WHOLE collected
// amount is refunded at the gateway (never a wallet credit).
func TestLiveDB_CardCheckout_AmountOrCurrencyMismatch_Refused(t *testing.T) {
	cases := []struct {
		name     string
		amount   int64
		currency string
	}{
		{"underpaid", 99999, "NGN"},
		{"overpaid", 100001, "NGN"},
		{"wrong currency", 100000, "USD"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			pool := ticketTokenPool(t)
			svc, gw := cardService(t, pool)
			owner := seedTicketTokenUser(t, ctx, pool)
			buyer := seedTicketTokenUser(t, ctx, pool)
			ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
			tier := seedTier(t, ctx, pool, ev, 100000, 10, 0)

			co, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 1, cardKey()))
			if err != nil {
				t.Fatalf("initiate: %v", err)
			}
			gw.pay(co.Reference, tc.amount, tc.currency)
			if _, err := svc.ConfirmCardCharge(ctx, co.Reference); !errors.Is(err, top5events.ErrCardAmountMismatch) {
				t.Fatalf("confirm err = %v, want ErrCardAmountMismatch", err)
			}
			// Replay after the refusal is a no-op (no second refund).
			if r, err := svc.ConfirmCardCharge(ctx, co.Reference); err != nil || r.Status != "refunded" {
				t.Fatalf("replay = %+v, %v", r, err)
			}
			if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_tickets WHERE order_id IN (SELECT id FROM event_orders WHERE card_reference=$1)`, co.Reference); n != 0 {
				t.Fatalf("mismatch issued %d tickets", n)
			}
			if legs := cardLegs(t, ctx, pool, co.Reference); len(legs) != 0 {
				t.Fatalf("mismatch moved money into escrow: %v", legs)
			}
			if got := tierSold(t, ctx, pool, tier); got != 0 {
				t.Fatalf("sold = %d, want 0 (hold released)", got)
			}
			rf := gw.refundCalls()
			if len(rf) != 1 || rf[0].reference != co.Reference || rf[0].amount != tc.amount {
				t.Fatalf("refunds = %v, want one full refund of the collected %d", rf, tc.amount)
			}
			if st := intentStatus(t, ctx, pool, co.Reference); st != "refunded" {
				t.Fatalf("intent = %s, want refunded", st)
			}
		})
	}
}

// EVT-UAT-137 / 153: a charge the gateway does not report as successful (failed,
// abandoned 3DS) moves nothing and keeps the hold for a genuine retry; the client
// redirect is never trusted — only the server-side verify.
func TestLiveDB_CardCheckout_NotSuccessful_NoTickets(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, gw := cardService(t, pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 100000, 10, 0)

	co, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 1, cardKey()))
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	gw.mu.Lock()
	gw.charges[co.Reference] = provider.PaymentStatus{Reference: co.Reference, Status: "failed", AmountKobo: 100000, Currency: "NGN"}
	gw.mu.Unlock()
	if _, err := svc.ConfirmCardCharge(ctx, co.Reference); !errors.Is(err, top5events.ErrCardChargeNotSuccessful) {
		t.Fatalf("err = %v, want ErrCardChargeNotSuccessful", err)
	}
	if st := intentStatus(t, ctx, pool, co.Reference); st != "pending" {
		t.Fatalf("intent = %s, want pending", st)
	}
	if tierSold(t, ctx, pool, tier) != 1 {
		t.Fatal("hold must survive a failed attempt until it expires")
	}
	// Retry succeeds on the same reference.
	gw.pay(co.Reference, 100000, "NGN")
	if r, err := svc.ConfirmCardCharge(ctx, co.Reference); err != nil || r.Status != "confirmed" {
		t.Fatalf("retry = %+v, %v", r, err)
	}

	// Unknown reference (EVT-UAT-143): benign, nothing settles.
	if _, err := svc.ConfirmCardCharge(ctx, top5events.CardReferencePrefix+"does-not-exist"); !errors.Is(err, top5events.ErrCardUnknownReference) {
		t.Fatalf("unknown ref err = %v", err)
	}
}

// Capacity race: the last seat contested by two card buyers and one wallet buyer
// at once. The shared tier FOR UPDATE lock admits exactly one; nobody oversells.
func TestLiveDB_CardCheckout_LastSeatRace_NeverOversells(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, _ := cardService(t, pool)
	led := cancelLedger(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")

	for round := range 5 {
		tier := seedTier(t, ctx, pool, ev, 100000, 1, 0)
		cardA := seedTicketTokenUser(t, ctx, pool)
		cardB := seedTicketTokenUser(t, ctx, pool)
		walletC := seedTicketTokenUser(t, ctx, pool)
		fundBuyer(t, ctx, pool, led, walletC, 100000)

		var wg sync.WaitGroup
		start := make(chan struct{})
		errs := make([]error, 3)
		wg.Add(3)
		go func() {
			defer wg.Done()
			<-start
			_, errs[0] = svc.InitiateCardCheckout(ctx, cardA, cardReq(ev, tier, 1, cardKey()))
		}()
		go func() {
			defer wg.Done()
			<-start
			_, errs[1] = svc.InitiateCardCheckout(ctx, cardB, cardReq(ev, tier, 1, cardKey()))
		}()
		go func() {
			defer wg.Done()
			<-start
			_, errs[2] = svc.Purchase(ctx, walletC, ev, tier, "", "race-"+uuid.New().String())
		}()
		close(start)
		wg.Wait()

		wins := 0
		for i, e := range errs {
			switch {
			case e == nil:
				wins++
			case errors.Is(e, top5events.ErrSoldOut):
			default:
				t.Fatalf("round %d contender %d: unexpected error %v", round, i, e)
			}
		}
		if wins != 1 {
			t.Fatalf("round %d: %d winners for 1 seat (errs=%v)", round, wins, errs)
		}
		if got := tierSold(t, ctx, pool, tier); got != 1 {
			t.Fatalf("round %d: sold = %d, want 1", round, got)
		}
		if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_orders WHERE tier_id=$1 AND status IN ('PENDING','PAID')`, tier); n != 1 {
			t.Fatalf("round %d: live orders = %d, want 1", round, n)
		}
	}
}

// Hold expiry: an unpaid hold past its expiry is released by the sweep (verified
// unpaid first) and the seat becomes buyable on the wallet rail. A charge that
// lands AFTER the release is refunded, never ticketed.
func TestLiveDB_CardCheckout_HoldExpiry_ReleasesSeat_LateChargeRefunded(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, gw := cardService(t, pool)
	led := cancelLedger(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	other := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 100000, 1, 0)

	co, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 1, cardKey()))
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	fundBuyer(t, ctx, pool, led, other, 100000)
	if _, err := svc.Purchase(ctx, other, ev, tier, "", "held-"+uuid.New().String()); !errors.Is(err, top5events.ErrSoldOut) {
		t.Fatalf("seat should be held: %v", err)
	}

	// Not yet expired: the sweep leaves an unpaid hold alone.
	if _, err := svc.ReconcileCardCheckouts(ctx, 0); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if st := intentStatus(t, ctx, pool, co.Reference); st != "pending" {
		t.Fatalf("unexpired hold swept to %s", st)
	}

	if _, err := pool.Exec(ctx, `UPDATE event_card_intents SET hold_expires_at = now() - interval '1 minute' WHERE reference=$1`, co.Reference); err != nil {
		t.Fatal(err)
	}
	stats, err := svc.ReconcileCardCheckouts(ctx, 0)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if stats.Expired != 1 {
		t.Fatalf("stats = %+v, want Expired=1", stats)
	}
	if st := intentStatus(t, ctx, pool, co.Reference); st != "expired" {
		t.Fatalf("intent = %s, want expired", st)
	}
	if got := tierSold(t, ctx, pool, tier); got != 0 {
		t.Fatalf("sold = %d, want 0 after release", got)
	}
	if _, err := svc.Purchase(ctx, other, ev, tier, "", "after-"+uuid.New().String()); err != nil {
		t.Fatalf("released seat not buyable: %v", err)
	}

	// The buyer pays on the stale Paystack page after the release.
	gw.pay(co.Reference, 100000, "NGN")
	if _, err := svc.ConfirmCardCharge(ctx, co.Reference); !errors.Is(err, top5events.ErrCardHoldExpired) {
		t.Fatalf("late charge err = %v, want ErrCardHoldExpired", err)
	}
	if st := intentStatus(t, ctx, pool, co.Reference); st != "refunded" {
		t.Fatalf("late charge intent = %s, want refunded", st)
	}
	if rf := gw.refundCalls(); len(rf) != 1 || rf[0].amount != 100000 {
		t.Fatalf("refunds = %v", rf)
	}
	if got := tierSold(t, ctx, pool, tier); got != 1 {
		t.Fatalf("sold = %d, want 1 (only the wallet buyer)", got)
	}
	if legs := cardLegs(t, ctx, pool, co.Reference); len(legs) != 0 {
		t.Fatalf("late charge moved money into escrow: %v", legs)
	}
}

// D-005 analogue: the process died right after claiming the intent (status
// 'processing', nothing else done). Webhook redelivery inside the claim window
// is a no-op; the sweep takes over the STALE claim and settles exactly once.
func TestLiveDB_CardCheckout_StrandedClaim_SweepRecovers(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, gw := cardService(t, pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 70000, 10, 0)

	co, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 3, cardKey()))
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	gw.pay(co.Reference, 210000, "NGN")
	// Simulate the crash: claimed a moment ago, then the process vanished.
	if _, err := pool.Exec(ctx, `UPDATE event_card_intents SET status='processing', claim_gen=claim_gen+1, claimed_at=now() WHERE reference=$1`, co.Reference); err != nil {
		t.Fatal(err)
	}
	if r, err := svc.ConfirmCardCharge(ctx, co.Reference); err != nil || r.Status != "processing" {
		t.Fatalf("redelivery inside a live claim = %+v, %v (must not double-run)", r, err)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_tickets WHERE order_id IN (SELECT id FROM event_orders WHERE card_reference=$1)`, co.Reference); n != 0 {
		t.Fatalf("tickets issued under someone else's live claim: %d", n)
	}

	// Claim goes stale.
	if _, err := pool.Exec(ctx, `UPDATE event_card_intents SET claimed_at = now() - interval '1 hour' WHERE reference=$1`, co.Reference); err != nil {
		t.Fatal(err)
	}
	stats, err := svc.ReconcileCardCheckouts(ctx, 0)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if stats.Confirmed != 1 {
		t.Fatalf("stats = %+v, want Confirmed=1", stats)
	}
	if st := intentStatus(t, ctx, pool, co.Reference); st != "confirmed" {
		t.Fatalf("intent = %s", st)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_tickets WHERE order_id IN (SELECT id FROM event_orders WHERE card_reference=$1)`, co.Reference); n != 3 {
		t.Fatalf("tickets = %d, want 3", n)
	}
	assertBalancedCardLegs(t, cardLegs(t, ctx, pool, co.Reference), 210000)

	// A second sweep and a late webhook change nothing.
	if _, err := svc.ReconcileCardCheckouts(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ConfirmCardCharge(ctx, co.Reference); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_tickets WHERE order_id IN (SELECT id FROM event_orders WHERE card_reference=$1)`, co.Reference); n != 3 {
		t.Fatalf("tickets after replay = %d", n)
	}
	assertBalancedCardLegs(t, cardLegs(t, ctx, pool, co.Reference), 210000)
}

// The sweep also settles a paid charge whose webhook never arrived and whose
// client stopped polling.
func TestLiveDB_CardCheckout_LostWebhook_SweepSettles(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, gw := cardService(t, pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 50000, 10, 0)

	co, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 1, cardKey()))
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	gw.pay(co.Reference, 50000, "NGN")
	stats, err := svc.ReconcileCardCheckouts(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if stats.Confirmed != 1 || intentStatus(t, ctx, pool, co.Reference) != "confirmed" {
		t.Fatalf("stats = %+v", stats)
	}
	assertBalancedCardLegs(t, cardLegs(t, ctx, pool, co.Reference), 50000)
}

// A refund that failed at the gateway stays 'refunding' and the sweep finishes
// it — checking the gateway first so a refund is never issued twice.
func TestLiveDB_CardCheckout_FailedRefund_SweepRetries(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, gw := cardService(t, pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 100000, 10, 0)

	co, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 1, cardKey()))
	if err != nil {
		t.Fatalf("initiate: %v", err)
	}
	gw.pay(co.Reference, 1, "NGN")
	gw.mu.Lock()
	gw.refundErr = errors.New("paystack 502")
	gw.mu.Unlock()
	if _, err := svc.ConfirmCardCharge(ctx, co.Reference); !errors.Is(err, top5events.ErrCardAmountMismatch) {
		t.Fatalf("err = %v", err)
	}
	if st := intentStatus(t, ctx, pool, co.Reference); st != "refunding" {
		t.Fatalf("intent = %s, want refunding (refund outcome failed)", st)
	}
	if _, err := svc.ReconcileCardCheckouts(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if st := intentStatus(t, ctx, pool, co.Reference); st != "refunded" {
		t.Fatalf("intent after sweep = %s", st)
	}
	if _, err := svc.ReconcileCardCheckouts(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if rf := gw.refundCalls(); len(rf) != 1 || rf[0].amount != 1 {
		t.Fatalf("refunds = %v, want exactly one", rf)
	}
}

// Idempotent initiate: the same key replays the same reference and hold; the
// key reused for a different request or by a different buyer is refused.
func TestLiveDB_CardCheckout_InitiateIdempotency(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, gw := cardService(t, pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	stranger := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 100000, 10, 0)
	key := cardKey()

	a, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 2, key))
	if err != nil {
		t.Fatal(err)
	}
	b, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 2, key))
	if err != nil {
		t.Fatal(err)
	}
	if a.Reference != b.Reference || b.AmountKobo != a.AmountKobo || b.AuthorizationURL != a.AuthorizationURL {
		t.Fatalf("replay diverged: %+v vs %+v", a, b)
	}
	if got := tierSold(t, ctx, pool, tier); got != 2 {
		t.Fatalf("sold = %d, want 2 (replay must not re-hold)", got)
	}
	if gw.inits[a.Reference] != 1 {
		t.Fatalf("gateway initialised %d times, want 1", gw.inits[a.Reference])
	}
	if _, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 3, key)); !errors.Is(err, top5events.ErrCardIdempotencyConflict) {
		t.Fatalf("different body same key: %v", err)
	}
	if _, err := svc.InitiateCardCheckout(ctx, stranger, cardReq(ev, tier, 2, key)); !errors.Is(err, top5events.ErrCardIdempotencyConflict) {
		t.Fatalf("different buyer same key: %v", err)
	}
	if _, err := svc.CardCheckoutStatus(ctx, stranger, a.Reference); !errors.Is(err, top5events.ErrCardUnknownReference) {
		t.Fatalf("stranger status read: %v (must look unknown)", err)
	}
	if _, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 1, "bad key!")); !errors.Is(err, top5events.ErrCardInvalidKey) {
		t.Fatalf("unsafe key: %v", err)
	}
}

// The wallet rail never touches a card hold: the wallet crash-reconciler leaves
// it PENDING (no wallet debit) and a wallet Purchase replaying a card order's key
// is refused rather than wallet-charging it.
func TestLiveDB_CardCheckout_WalletPathsNeverChargeCardHolds(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, _ := cardService(t, pool)
	led := cancelLedger(pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 100000, 10, 0)
	fundBuyer(t, ctx, pool, led, buyer, 500000)

	co, err := svc.InitiateCardCheckout(ctx, buyer, cardReq(ev, tier, 1, cardKey()))
	if err != nil {
		t.Fatal(err)
	}
	before := buyerBalance(t, ctx, led, buyer)
	if _, err := pool.Exec(ctx, `UPDATE event_orders SET created_at = now() - interval '1 day' WHERE card_reference=$1`, co.Reference); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.ReconcilePendingOrders(ctx, time.Minute); err != nil {
		t.Fatal(err)
	}
	if got := buyerBalance(t, ctx, led, buyer); got != before {
		t.Fatalf("wallet reconciler debited a card hold: %d → %d", before, got)
	}
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM event_orders WHERE card_reference=$1 AND status='PENDING'`, co.Reference); n != 1 {
		t.Fatalf("card hold disturbed by wallet reconciler")
	}
	var orderKey string
	if err := pool.QueryRow(ctx, `SELECT idempotency_key FROM event_orders WHERE card_reference=$1`, co.Reference).Scan(&orderKey); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Purchase(ctx, buyer, ev, tier, "", orderKey); err == nil {
		t.Fatal("wallet Purchase replaying a card order key must be refused")
	}
	if got := buyerBalance(t, ctx, led, buyer); got != before {
		t.Fatalf("wallet Purchase charged a card hold: %d → %d", before, got)
	}
}

// A promo applies identically on both rails, and an expired card hold gives its
// promo use back.
func TestLiveDB_CardCheckout_PromoAppliedAndReleasedOnExpiry(t *testing.T) {
	ctx := context.Background()
	pool := ticketTokenPool(t)
	svc, _ := cardService(t, pool)
	owner := seedTicketTokenUser(t, ctx, pool)
	buyer := seedTicketTokenUser(t, ctx, pool)
	ev := seedManageEvent(t, ctx, pool, owner, "LIVE")
	tier := seedTier(t, ctx, pool, ev, 100000, 10, 0)
	code := fmt.Sprintf("CARD%d", time.Now().UnixNano()%100000)
	var promoID string
	if err := pool.QueryRow(ctx, `INSERT INTO event_promo_codes (event_id, code, percent_off, max_uses) VALUES ($1,$2,10,5) RETURNING id`, ev, code).Scan(&promoID); err != nil {
		t.Fatal(err)
	}
	req := cardReq(ev, tier, 2, cardKey())
	req.Promo = code
	co, err := svc.InitiateCardCheckout(ctx, buyer, req)
	if err != nil {
		t.Fatal(err)
	}
	if co.AmountKobo != 180000 {
		t.Fatalf("amount = %d, want 180000 (10%% off ×2)", co.AmountKobo)
	}
	if n := countRows(t, ctx, pool, `SELECT used FROM event_promo_codes WHERE id=$1`, promoID); n != 2 {
		t.Fatalf("promo used = %d, want 2", n)
	}
	if _, err := pool.Exec(ctx, `UPDATE event_card_intents SET hold_expires_at = now() - interval '1 minute' WHERE reference=$1`, co.Reference); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReconcileCardCheckouts(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if n := countRows(t, ctx, pool, `SELECT used FROM event_promo_codes WHERE id=$1`, promoID); n != 0 {
		t.Fatalf("promo used after expiry = %d, want 0", n)
	}
}
