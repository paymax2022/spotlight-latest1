package paystackcheckout

// LIVE-DB (TEST_DATABASE_URL) proofs for PARTIAL refunds: the SQL invariants
// (refund cap CHECK, one piece in flight, fence, whole-charge guard) and the
// end-to-end shape car hire will use — ONE charge, TWO external settlements
// ("<ref>:fare", "<ref>:deposit"), each refunded to the card on its own — with a
// real Engine + PGStore + ledger and only the gateway faked. The test domain
// below stands in for car hire (WP-B); it exercises the engine, not car hire.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/testsupport"
)

const (
	liveFare    = int64(700_000)
	liveDeposit = int64(300_000)
	liveTotal   = liveFare + liveDeposit
)

// twoDomain books "entities" that each hold a fare and a deposit settlement.
type twoDomain struct {
	mu      sync.Mutex
	settle  *settlement.Service
	byKey   map[string]string // idem → entity id
	failEnd bool              // escrow both, THEN fail (order_failed unwind)
}

func (d *twoDomain) Name() string            { return "twosettle" }
func (d *twoDomain) ReferencePrefix() string { return "twosettleorder:" }
func (d *twoDomain) RoutePrefix() string     { return "/twosettle/paystack" }
func (d *twoDomain) EntityIDKey() string     { return "bookingId" }
func (d *twoDomain) Quote(context.Context, string, json.RawMessage) (Quoted, error) {
	return Quoted{AmountKobo: liveTotal}, nil
}
func (d *twoDomain) Find(_ context.Context, _, idem string) (string, bool, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	id, ok := d.byKey[idem]
	return id, ok, nil
}
func (d *twoDomain) Book(ctx context.Context, payer string, _ json.RawMessage, _ json.RawMessage, idem string, verified int64) (string, error) {
	if verified != liveTotal {
		return "", fmt.Errorf("amount mismatch")
	}
	id := uuid.NewSHA1(uuid.NameSpaceOID, []byte(idem)).String()
	if _, err := d.settle.EscrowExternal(ctx, payer, "twosettle:"+id, idem+":fare", "transport", liveFare); err != nil {
		return "", err
	}
	if _, err := d.settle.EscrowExternal(ctx, payer, "twosettle:"+id+":deposit", idem+":deposit", "transport", liveDeposit); err != nil {
		return "", err
	}
	if d.failEnd {
		return "", errors.New("insert failed after both escrows")
	}
	d.mu.Lock()
	d.byKey[idem] = id
	d.mu.Unlock()
	return id, nil
}

type twoRig struct {
	e      *Engine
	st     *PGStore
	gw     *fakeGW
	dom    *twoDomain
	pool   *pgxpool.Pool
	settle *settlement.Service
	payer  string
}

func newTwoRig(t *testing.T) *twoRig {
	t.Helper()
	ctx := context.Background()
	pool := livePool(t)
	ledgerSvc := ledger.NewService(ledger.NewRepository(pool), nil)
	settleSvc := settlement.NewService(pool, ledgerSvc)
	payer := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, payer, payer+"@twosettle.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, pool, payer)
	gw := &fakeGW{ev: &events{}}
	st := NewPGStore(pool)
	e := NewEngine(gw, st, settleSvc)
	dom := &twoDomain{settle: settleSvc, byKey: map[string]string{}}
	e.Register(dom)
	e.EnablePartialRefunds(gw, st)
	t.Cleanup(func() {
		c := context.WithoutCancel(ctx)
		_, _ = pool.Exec(c, `DELETE FROM public.transport_paystack_intent_refunds WHERE reference IN (SELECT reference FROM public.transport_paystack_intents WHERE payer_id=$1)`, payer)
		_, _ = pool.Exec(c, `DELETE FROM public.transport_paystack_intents WHERE payer_id=$1`, payer)
	})
	return &twoRig{e: e, st: st, gw: gw, dom: dom, pool: pool, settle: settleSvc, payer: payer}
}

// confirmedTwo initiates + confirms one charge and returns the reference and
// the ids of its fare and deposit settlements.
func (r *twoRig) confirmedTwo(t *testing.T) (ref, entity, fareID, depID string) {
	t.Helper()
	ctx := context.Background()
	co, err := r.e.Initiate(ctx, "twosettle", r.payer, json.RawMessage(`{}`), "two-"+uuid.NewString(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: liveTotal, Currency: "NGN"}
	res, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference)
	if err != nil || res.Status != StatusConfirmed || res.EntityID == nil {
		t.Fatalf("confirm: %+v %v", res, err)
	}
	for _, c := range []struct {
		suffix string
		out    *string
	}{{":fare", &fareID}, {":deposit", &depID}} {
		if err := r.pool.QueryRow(ctx, `SELECT id::text FROM settlements WHERE idempotency_key=$1`, co.Reference+c.suffix).Scan(c.out); err != nil {
			t.Fatalf("settlement %s: %v", c.suffix, err)
		}
	}
	return co.Reference, *res.EntityID, fareID, depID
}

func (r *twoRig) settStatus(t *testing.T, id string) string {
	t.Helper()
	var s string
	if err := r.pool.QueryRow(context.Background(), `SELECT status FROM settlements WHERE id=$1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func (r *twoRig) intent(t *testing.T, ref string) *Intent {
	t.Helper()
	in, err := r.st.Get(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	return in
}

func (r *twoRig) refund(entity, settID string) error {
	return r.e.RefunderFor("twosettle").RefundExternalSettlement(context.Background(), entity, settID, "test")
}

func (r *twoRig) walletBalance(t *testing.T) int64 {
	t.Helper()
	var b int64
	if err := r.pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN le.type='CREDIT' THEN le.amount_kobo ELSE -le.amount_kobo END),0)
		FROM ledger_entries le JOIN ledger_accounts la ON la.id=le.account_id WHERE la.user_id=$1`, r.payer).Scan(&b); err != nil {
		t.Fatal(err)
	}
	return b
}

func (r *twoRig) nets(t *testing.T, refs ...string) (debit, credit int64) {
	t.Helper()
	if err := r.pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(amount_kobo) FILTER (WHERE type='DEBIT'),0), COALESCE(SUM(amount_kobo) FILTER (WHERE type='CREDIT'),0)
		FROM ledger_entries WHERE reference = ANY($1)`, refs).Scan(&debit, &credit); err != nil {
		t.Fatal(err)
	}
	return
}

// ── SQL invariants ──────────────────────────────────────────────────────────

func TestLiveDB_PGStore_PartialCapEnforcedByCheckConstraint(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, _, fareID, depID := r.confirmedTwo(t)

	// The application path refuses to over-reserve ...
	if _, err := r.st.BeginPartialRefund(ctx, ref, "x", "x", liveTotal+1, staleClaimAfter); !errors.Is(err, ErrPartialCapExceeded) {
		t.Fatalf("over-reserve err = %v, want ErrPartialCapExceeded", err)
	}
	// ... and so does the DATABASE, whatever the application does.
	for name, q := range map[string]string{
		"reserved > amount":   `UPDATE public.transport_paystack_intents SET refund_reserved_kobo = amount_kobo + 1 WHERE reference=$1`,
		"refunded > reserved": `UPDATE public.transport_paystack_intents SET refunded_kobo = 1 WHERE reference=$1`,
		"negative":            `UPDATE public.transport_paystack_intents SET refund_reserved_kobo = -1 WHERE reference=$1`,
	} {
		if _, err := r.pool.Exec(ctx, q, ref); err == nil {
			t.Errorf("%s: the CHECK constraint let it through", name)
		}
	}
	// Reserve fare, then a deposit sized to overshoot by one kobo.
	if _, err := r.st.BeginPartialRefund(ctx, ref, fareID, fareID, liveFare, staleClaimAfter); err != nil {
		t.Fatal(err)
	}
	if ok, err := r.st.MarkPartialRefunded(ctx, ref, fareID, 1, "g1"); err != nil || !ok {
		t.Fatalf("mark: %v %v", ok, err)
	}
	if _, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit+1, staleClaimAfter); !errors.Is(err, ErrPartialCapExceeded) {
		t.Fatalf("err = %v, want ErrPartialCapExceeded", err)
	}
	if in := r.intent(t, ref); in.RefundReservedKobo != liveFare || in.RefundedKobo != liveFare || in.Status != StatusConfirmed {
		t.Errorf("intent %s reserved=%d refunded=%d", in.Status, in.RefundReservedKobo, in.RefundedKobo)
	}
}

func TestLiveDB_PGStore_PartialFencedTakeover(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, _, _, depID := r.confirmedTwo(t)

	a, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter)
	if err != nil || a.Prev != "" || a.ExpectedRefundedKobo != 0 {
		t.Fatalf("begin A: %+v %v", a, err)
	}
	// A fresh claim is not takeable.
	if _, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter); !errors.Is(err, ErrPartialInFlight) {
		t.Fatalf("fresh claim err = %v, want ErrPartialInFlight", err)
	}
	if _, err := r.pool.Exec(ctx, `UPDATE public.transport_paystack_intent_refunds SET claimed_at = now() - interval '3 minutes' WHERE reference=$1`, ref); err != nil {
		t.Fatal(err)
	}
	b, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter)
	if err != nil || b.Fence == a.Fence || b.Prev != PartialRefunding || b.Row.Attempts != 2 {
		t.Fatalf("takeover B: %+v %v (A fence %d)", b, err, a.Fence)
	}
	if ok, _ := r.st.MarkPartialRefunded(ctx, ref, depID, a.Fence, "stale"); ok {
		t.Error("stale owner recorded a refund over its successor")
	}
	if ok, _ := r.st.MarkPartialFailed(ctx, ref, depID, a.Fence); ok {
		t.Error("stale owner released its successor's reservation")
	}
	if in := r.intent(t, ref); in.RefundReservedKobo != liveDeposit || in.RefundedKobo != 0 {
		t.Errorf("stale writes leaked: reserved=%d refunded=%d", in.RefundReservedKobo, in.RefundedKobo)
	}
	if ok, err := r.st.MarkPartialRefunded(ctx, ref, depID, b.Fence, "gw-B"); err != nil || !ok {
		t.Fatalf("successor mark %v %v", ok, err)
	}
	// Terminal: nothing stale may move it again; a replay Begin reports done.
	if ok, _ := r.st.MarkPartialFailed(ctx, ref, depID, b.Fence); ok {
		t.Error("a refunded piece was failed afterwards")
	}
	again, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter)
	if err != nil || !again.AlreadyDone {
		t.Fatalf("replay: %+v %v", again, err)
	}
	if in := r.intent(t, ref); in.RefundedKobo != liveDeposit || in.Status != StatusConfirmed {
		t.Errorf("intent %s refunded=%d", in.Status, in.RefundedKobo)
	}
}

func TestLiveDB_PGStore_OneInflightPartialIndex(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, _, fareID, depID := r.confirmedTwo(t)

	if _, err := r.st.BeginPartialRefund(ctx, ref, fareID, fareID, liveFare, staleClaimAfter); err != nil {
		t.Fatal(err)
	}
	if _, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter); !errors.Is(err, ErrPartialInFlight) {
		t.Fatalf("second in-flight piece err = %v, want ErrPartialInFlight", err)
	}
	// The unique index is the backstop even for a writer that skips the check.
	if _, err := r.pool.Exec(ctx, `INSERT INTO public.transport_paystack_intent_refunds (reference, refund_key, settlement_id, amount_kobo, status)
		VALUES ($1,'rogue','rogue',1,'refunding')`, ref); err == nil {
		t.Error("two 'refunding' pieces of one intent were accepted by the database")
	}
}

func TestLiveDB_PGStore_ConcurrentBegins_ExactlyOneWins(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, _, _, _ := r.confirmedTwo(t)
	var wg sync.WaitGroup
	var mu sync.Mutex
	wins := 0
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			k := fmt.Sprintf("piece-%d", i)
			if _, err := r.st.BeginPartialRefund(ctx, ref, k, k, 10_000, staleClaimAfter); err == nil {
				mu.Lock()
				wins++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("%d concurrent pieces began, want exactly 1", wins)
	}
	if in := r.intent(t, ref); in.RefundReservedKobo != 10_000 {
		t.Errorf("reserved %d, want 10000 (losers must not reserve)", in.RefundReservedKobo)
	}
}

func TestLiveDB_PGStore_WholeChargeRefundBlockedByReservedPieces(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, _, _, depID := r.confirmedTwo(t)
	if _, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := r.st.BeginRefund(ctx, ref, []string{StatusConfirmed, StatusAmountMismatch, StatusOrderFailed}, staleClaimAfter); err != nil || ok {
		t.Fatalf("whole-charge BeginRefund over a reserved piece: ok=%v err=%v — it would over-refund", ok, err)
	}
	if in := r.intent(t, ref); in.Status != StatusConfirmed {
		t.Errorf("status %s", in.Status)
	}
}

func TestLiveDB_PGStore_FailedPieceReleasesReservationAndReactivates(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, _, _, depID := r.confirmedTwo(t)
	a, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := r.st.MarkPartialFailed(ctx, ref, depID, a.Fence); err != nil || !ok {
		t.Fatalf("fail: %v %v", ok, err)
	}
	if in := r.intent(t, ref); in.RefundReservedKobo != 0 {
		t.Fatalf("reserved %d after failure", in.RefundReservedKobo)
	}
	b, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter)
	if err != nil || b.Prev != PartialFailed || b.Fence <= a.Fence {
		t.Fatalf("reactivate: %+v %v", b, err)
	}
	// A different amount for an existing key is refused.
	if _, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit-1, staleClaimAfter); err == nil {
		t.Error("an existing piece key accepted a different amount")
	}
}

// ── end to end ──────────────────────────────────────────────────────────────

func TestLiveDB_Engine_TwoSettlements_CancelRefundsFareAndDepositToCard_LedgerBalanced(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, entity, fareID, depID := r.confirmedTwo(t)

	if err := r.refund(entity, fareID); err != nil {
		t.Fatalf("fare: %v", err)
	}
	if got := r.intent(t, ref); got.Status != StatusConfirmed || got.RefundedKobo != liveFare {
		t.Fatalf("after fare: %s refunded=%d", got.Status, got.RefundedKobo)
	}
	if err := r.refund(entity, depID); err != nil {
		t.Fatalf("deposit: %v", err)
	}

	if len(r.gw.pCalls) != 2 || r.gw.pCalls[0].Amt != liveFare || r.gw.pCalls[1].Amt != liveDeposit {
		t.Fatalf("gateway calls %+v, want fare then deposit", r.gw.pCalls)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Errorf("whole-charge refund used: %v", r.gw.refundCalls)
	}
	in := r.intent(t, ref)
	if in.Status != StatusRefunded || in.RefundedKobo != liveTotal || in.RefundReservedKobo != liveTotal {
		t.Errorf("intent %s refunded=%d reserved=%d", in.Status, in.RefundedKobo, in.RefundReservedKobo)
	}
	if r.settStatus(t, fareID) != "refunded" || r.settStatus(t, depID) != "refunded" {
		t.Error("settlements not both reversed ledger-side")
	}
	// Ledger: escrow in (T) and each piece reversed (fare, deposit) — balanced,
	// escrow nets to zero, and the payer's wallet was never touched.
	d, c := r.nets(t, "escrow:twosettle:"+entity, "escrow:twosettle:"+entity+":deposit",
		"refund:twosettle:"+entity, "refund:twosettle:"+entity+":deposit")
	if d != c || d != 2*liveTotal {
		t.Errorf("ledger debit=%d credit=%d, want balanced at %d", d, c, 2*liveTotal)
	}
	if bal := r.walletBalance(t); bal != 0 {
		t.Errorf("wallet %d: card money must never reach a wallet", bal)
	}
	// Replays are no-ops.
	_ = r.refund(entity, fareID)
	_ = r.refund(entity, depID)
	if len(r.gw.pCalls) != 2 {
		t.Errorf("replay issued more gateway refunds: %d", len(r.gw.pCalls))
	}
	_ = ctx
}

func TestLiveDB_Engine_TwoSettlements_DepositOnlyRefund_LeavesBookingConfirmed(t *testing.T) {
	r := newTwoRig(t)
	ref, entity, fareID, depID := r.confirmedTwo(t)
	if err := r.refund(entity, depID); err != nil {
		t.Fatal(err)
	}
	if len(r.gw.pCalls) != 1 || r.gw.pCalls[0].Amt != liveDeposit {
		t.Fatalf("gateway calls %+v", r.gw.pCalls)
	}
	in := r.intent(t, ref)
	if in.Status != StatusConfirmed || in.RefundedKobo != liveDeposit {
		t.Errorf("intent %s refunded=%d", in.Status, in.RefundedKobo)
	}
	if r.settStatus(t, depID) != "refunded" || r.settStatus(t, fareID) != "escrowed" {
		t.Errorf("settlements fare=%s deposit=%s", r.settStatus(t, fareID), r.settStatus(t, depID))
	}
}

func TestLiveDB_Engine_PieceRefund_RefusesAForeignSettlement(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	_, entity, _, _ := r.confirmedTwo(t)
	// A settlement of ANOTHER charge/payer must not be refundable through this intent.
	other := uuid.New().String()
	if _, err := r.pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, other, other+"@twosettle.test"); err != nil {
		t.Fatal(err)
	}
	testsupport.CleanupUser(t, r.pool, other)
	foreign, err := r.settle.EscrowExternal(ctx, other, "twosettle:foreign", "twosettleorder:someoneelse1:deposit", "transport", liveDeposit)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.refund(entity, foreign.ID); err == nil {
		t.Fatal("a foreign settlement was refunded through this booking")
	}
	if len(r.gw.pCalls) != 0 {
		t.Error("gateway called for a foreign settlement")
	}
	if r.settStatus(t, foreign.ID) != "escrowed" {
		t.Error("foreign settlement altered")
	}
}

func TestLiveDB_Engine_ConcurrentRefundOfOnePiece_OneGatewayRefund(t *testing.T) {
	r := newTwoRig(t)
	_, entity, _, depID := r.confirmedTwo(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _ = r.refund(entity, depID) }()
	}
	wg.Wait()
	// Racers that lost may have been refused; one retry converges.
	if err := r.refund(entity, depID); err != nil {
		t.Fatal(err)
	}
	if len(r.gw.pCalls) != 1 {
		t.Fatalf("%d gateway refunds for one piece", len(r.gw.pCalls))
	}
	if r.settStatus(t, depID) != "refunded" {
		t.Error("settlement not reversed")
	}
}

func TestLiveDB_Engine_OrderFailed_TwoSettlements_BothReversedBeforeGatewayRefund(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	r.dom.failEnd = true // Book escrows fare + deposit, then fails: both must be unwound
	co, err := r.e.Initiate(ctx, "twosettle", r.payer, json.RawMessage(`{}`), "two-of-"+uuid.NewString(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: liveTotal, Currency: "NGN"}
	var atRefund []string
	r.gw.onRefund = func(string) {
		rows, _ := r.pool.Query(ctx, `SELECT idempotency_key || '=' || status FROM settlements WHERE idempotency_key = ANY($1)`,
			[]string{co.Reference + ":fare", co.Reference + ":deposit"})
		defer rows.Close()
		for rows.Next() {
			var s string
			_ = rows.Scan(&s)
			atRefund = append(atRefund, s)
		}
	}
	if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
		t.Fatal("want the failed order to surface")
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != liveTotal {
		t.Fatalf("gateway refund %v, want one whole refund of %d", r.gw.refundCalls, liveTotal)
	}
	if len(atRefund) != 2 {
		t.Fatalf("settlements seen at gateway-refund time: %v", atRefund)
	}
	for _, s := range atRefund {
		if len(s) < 8 || s[len(s)-8:] != "refunded" {
			t.Errorf("at the instant of the gateway refund %q — the ledger must already be unwound (H6 for multi-settlement)", s)
		}
	}
	if in := r.intent(t, co.Reference); in.Status != StatusRefunded {
		t.Errorf("intent %s", in.Status)
	}
	var id string
	_ = r.pool.QueryRow(ctx, `SELECT reference FROM settlements WHERE idempotency_key=$1`, co.Reference+":fare").Scan(&id)
	d, c := r.nets(t, "escrow:"+id, "escrow:"+id+":deposit", "refund:"+id, "refund:"+id+":deposit")
	if d != c || d != 2*liveTotal {
		t.Errorf("ledger debit=%d credit=%d, want balanced at %d", d, c, 2*liveTotal)
	}
}

func TestLiveDB_Reconcile_StrandedPiece_FinishedWithoutASecondRefund(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, _, _, depID := r.confirmedTwo(t)
	// A previous owner began, the gateway accepted, then the process died.
	if _, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter); err != nil {
		t.Fatal(err)
	}
	r.gw.pRefunds = []provider.RefundResult{{Reference: ref, Status: "processed", AmountKobo: liveDeposit, ID: "gw-dead"}}
	if _, err := r.pool.Exec(ctx, `UPDATE public.transport_paystack_intent_refunds SET claimed_at = now() - interval '10 minutes' WHERE reference=$1`, ref); err != nil {
		t.Fatal(err)
	}
	if _, err := r.e.Reconcile(ctx, 0, 0); err != nil {
		t.Fatal(err)
	}
	if len(r.gw.pCalls) != 0 {
		t.Errorf("sweeper issued %d gateway refunds; the gateway already held it", len(r.gw.pCalls))
	}
	row, _ := r.st.GetPartial(ctx, ref, depID)
	if row == nil || row.Status != PartialRefunded || row.GatewayRefundID == nil || *row.GatewayRefundID != "gw-dead" {
		t.Errorf("row %+v", row)
	}
	if r.settStatus(t, depID) != "refunded" {
		t.Error("ledger reversal not finished by the sweep")
	}
}

func TestLiveDB_Reconcile_RefundedPieceWithEscrowedSettlement_FinishesLedgerViaJoin(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, _, _, depID := r.confirmedTwo(t)
	a, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter)
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := r.st.MarkPartialRefunded(ctx, ref, depID, a.Fence, "gw-1"); err != nil || !ok {
		t.Fatal(err)
	}
	pending, err := r.st.ListPartialsAwaitingLedger(ctx, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range pending {
		if p.Reference == ref && p.RefundKey == depID {
			found = true
		}
	}
	if !found {
		t.Fatal("the awaiting-ledger query missed a refunded piece with an escrowed settlement")
	}
	if _, err := r.e.Reconcile(ctx, 0, 0); err != nil {
		t.Fatal(err)
	}
	if r.settStatus(t, depID) != "refunded" || len(r.gw.pCalls) != 0 {
		t.Errorf("settlement %s gatewayCalls=%d", r.settStatus(t, depID), len(r.gw.pCalls))
	}
	pending, _ = r.st.ListPartialsAwaitingLedger(ctx, 0, 100)
	for _, p := range pending {
		if p.Reference == ref {
			t.Error("a finished piece is still listed as awaiting its ledger reversal")
		}
	}
}

// H2: post_attempted_at is persisted, fenced, survives a stale takeover, and is
// cleared only by a definite failure; Begin reports the DATABASE clock.
func TestLiveDB_PGStore_PostAttemptIsFenced_SurvivesTakeover_ClearedByFailure(t *testing.T) {
	r := newTwoRig(t)
	ctx := context.Background()
	ref, _, _, depID := r.confirmedTwo(t)

	a, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter)
	if err != nil || a.Row.PostAttemptedAt != nil || a.Now.IsZero() {
		t.Fatalf("begin: %+v %v", a, err)
	}
	if ok, err := r.st.MarkPartialPostAttempt(ctx, ref, depID, a.Fence+1); err != nil || ok {
		t.Fatalf("a wrong fence stamped the attempt: %v %v", ok, err)
	}
	if ok, err := r.st.MarkPartialPostAttempt(ctx, ref, depID, a.Fence); err != nil || !ok {
		t.Fatalf("stamp: %v %v", ok, err)
	}
	if _, err := r.pool.Exec(ctx, `UPDATE public.transport_paystack_intent_refunds SET claimed_at = now() - interval '3 minutes' WHERE reference=$1`, ref); err != nil {
		t.Fatal(err)
	}
	b, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter)
	if err != nil || b.Row.PostAttemptedAt == nil {
		t.Fatalf("a stale takeover must inherit post_attempted_at (the POST may be in flight): %+v %v", b, err)
	}
	if b.Now.Sub(*b.Row.PostAttemptedAt) < 0 || b.Now.Sub(*b.Row.PostAttemptedAt) > time.Minute {
		t.Errorf("clock skew between now %s and post_attempted_at %s", b.Now, b.Row.PostAttemptedAt)
	}
	if ok, err := r.st.MarkPartialFailed(ctx, ref, depID, b.Fence); err != nil || !ok {
		t.Fatalf("fail: %v %v", ok, err)
	}
	c, err := r.st.BeginPartialRefund(ctx, ref, depID, depID, liveDeposit, staleClaimAfter)
	if err != nil || c.Row.PostAttemptedAt != nil || c.Prev != PartialFailed {
		t.Fatalf("a definite failure must clear the attempt: %+v %v", c, err)
	}
}
