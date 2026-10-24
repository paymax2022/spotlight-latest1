package transport

// LIVE-DB tests for parcel insurance paid AT BOOKING on the CARD-DIRECT rail.
// Skipped unless TEST_DATABASE_URL is set. The bind runs through the REAL policy
// saga; the card gateway is a fake ExternalPieceRefunder that records what it
// would refund. Pins:
//  1. The card quote is fare + premium, and the premium is FROZEN with it.
//  2. Confirm splits the verified charge: fare → the external escrow (a piece
//     "<ref>:fare"), premium → the insurance hold; the wallet is never touched.
//  3. A replayed confirm never holds the premium twice.
//  4. Every premium refund of a card-funded parcel (bind failed, cancelled
//     before/after the bind, reconciler) goes back to the CARD as one piece,
//     never to the wallet, and is posted on the ledger exactly once.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/insurance/policy"
)

const cardPremium = 200_000 // 2% of insuredReq's ₦100,000

// fakeCardPieceRefunder is the parcel domain's card refunder: whole/fare
// settlements via RefundExternalSettlement, the premium via RefundExternalPiece.
// It is idempotent per (entity, piece) like the engine.
type fakeCardPieceRefunder struct {
	mu          sync.Mutex
	settlements []string
	pieces      []cardPiece
	done        map[string]bool
	pieceErr    error
}

type cardPiece struct {
	entityID, key string
	amount        int64
}

func (f *fakeCardPieceRefunder) RefundExternalSettlement(_ context.Context, _, settlementID, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.settlements = append(f.settlements, settlementID)
	return nil
}

func (f *fakeCardPieceRefunder) RefundExternalPiece(_ context.Context, entityID, key string, amount int64) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.pieceErr != nil {
		return f.pieceErr
	}
	if f.done == nil {
		f.done = map[string]bool{}
	}
	if f.done[entityID+"|"+key] {
		return nil
	}
	f.done[entityID+"|"+key] = true
	f.pieces = append(f.pieces, cardPiece{entityID, key, amount})
	return nil
}

func (f *fakeCardPieceRefunder) premiumRefunds() []cardPiece {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]cardPiece(nil), f.pieces...)
}

// BindFromQuotePrepaidToHold runs the REAL saga in its card mode (a refused
// bind returns the premium to the hold).
func (b *prepaidTestBinder) BindFromQuotePrepaidToHold(ctx context.Context, userID, quoteID string, paid int64, key string) (string, int64, error) {
	if b.beforeBind != nil {
		b.beforeBind()
	}
	if b.forceErr != nil {
		return "", 0, b.forceErr
	}
	p, err := b.pol.BindFromQuotePrepaidToHold(ctx, userID, quoteID, paid, key)
	if errors.Is(err, policy.ErrBindPersistedPartially) || errors.Is(err, policy.ErrBindOutcomeUnknown) || errors.Is(err, policy.ErrBindInFlight) {
		return "", 0, fmt.Errorf("%w: %w", ErrInsuranceBindUnconfirmed, err) // as the app adapter maps it
	}
	if err != nil {
		return "", 0, err
	}
	return p.ID, p.PremiumKobo, nil
}

func newCardInsuranceFixture(t *testing.T) (*prepaidParcelFixture, *fakeCardPieceRefunder) {
	t.Helper()
	f := newPrepaidParcelFixture(t, true)
	r := &fakeCardPieceRefunder{}
	f.svc.SetDomainExternalRefunder(RefundDomainParcel, r)
	return f, r
}

// bookCard runs the card-direct quote → book pair the engine runs (initiate,
// then confirm with the verified amount and the frozen pricing).
func (f *prepaidParcelFixture) bookCard(t *testing.T, req ParcelBookRequest) (parcelRow, string, int64) {
	t.Helper()
	ctx := context.Background()
	amount, frozen, err := f.svc.QuoteParcelBookingFrozenFor(ctx, f.sender, req)
	if err != nil {
		t.Fatalf("card quote: %v", err)
	}
	ref := "parcelorder-" + uuid.NewString()
	id, err := f.svc.BookParcelPaystackFundedFrozen(ctx, f.sender, req, ref, amount, frozen)
	if err != nil {
		t.Fatalf("card book: %v", err)
	}
	return f.parcel(t, id), ref, amount
}

func (f *prepaidParcelFixture) entryCount(t *testing.T, key string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), `SELECT count(*) FROM ledger_entries WHERE idempotency_key=$1`, key).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLiveDB_CardInsurance_QuoteIsFarePlusPremium_AndFreezesThePremium(t *testing.T) {
	f, _ := newCardInsuranceFixture(t)
	ctx := context.Background()
	fare, _, err := f.svc.QuoteParcelBookingFrozenFor(ctx, f.sender, parcelReq())
	if err != nil {
		t.Fatal(err)
	}
	amount, frozen, err := f.svc.QuoteParcelBookingFrozenFor(ctx, f.sender, insuredReq())
	if err != nil {
		t.Fatalf("insured card quote: %v", err)
	}
	if amount != fare+cardPremium {
		t.Fatalf("card charge %d, want fare %d + premium %d", amount, fare, cardPremium)
	}
	var fp struct {
		InsuranceKobo int64 `json:"insuranceKobo"`
	}
	if err := json.Unmarshal(frozen, &fp); err != nil || fp.InsuranceKobo != cardPremium {
		t.Fatalf("frozen pricing must carry the premium (%d), got %s", cardPremium, frozen)
	}

	// The catalog rate moves between initiate and confirm: the booking still
	// prices the premium the customer was charged, from the frozen quote.
	f.svc = f.svc.WithInsurance(&rateOverrideBinder{prepaidTestBinder: f.binder, bps: 900})
	ref := "parcelorder-" + uuid.NewString()
	id, err := f.svc.BookParcelPaystackFundedFrozen(ctx, f.sender, insuredReq(), ref, amount, frozen)
	if err != nil {
		t.Fatalf("book from a frozen premium after a rate change: %v", err)
	}
	if p := f.parcel(t, id); p.InsurancePaidKobo != cardPremium {
		t.Fatalf("premium paid %d, want the frozen %d", p.InsurancePaidKobo, cardPremium)
	}
}

type rateOverrideBinder struct {
	*prepaidTestBinder
	bps int64
}

func (b *rateOverrideBinder) IndicativeRateBps(context.Context, string) (int64, error) {
	return b.bps, nil
}

func TestLiveDB_CardInsurance_IneligibleIsRefusedAtQuote(t *testing.T) {
	f := newPrepaidParcelFixture(t, false) // profile incomplete
	var ce *CodedError
	if _, _, err := f.svc.QuoteParcelBookingFrozenFor(context.Background(), f.sender, insuredReq()); !errors.As(err, &ce) || ce.Code != CodeInsuranceProfileIncomplete {
		t.Fatalf("want 422 %s at initiate, got %v", CodeInsuranceProfileIncomplete, err)
	}
	noValue := insuredReq()
	noValue.DeclaredValueKobo = 0
	if _, _, err := f.svc.QuoteParcelBookingFrozenFor(context.Background(), f.sender, noValue); !errors.As(err, &ce) || ce.Status != http.StatusUnprocessableEntity || ce.Code != CodeInsuranceDeclaredValueRequired {
		t.Fatalf("want 422 %s at initiate, got %v", CodeInsuranceDeclaredValueRequired, err)
	}
}

func TestLiveDB_CardInsurance_ConfirmSplitsFareToEscrowAndPremiumToTheHold(t *testing.T) {
	f, _ := newCardInsuranceFixture(t)
	walletBefore := f.wallet(t)
	p, ref, amount := f.bookCard(t, insuredReq())
	fare := amount - cardPremium

	if typ, amt := entryAccountType(t, f.pool, ref+":insurance:credit"); typ != string(ledger.AccountInsurancePremiumHold) || amt != cardPremium {
		t.Fatalf("premium credit = %s %d, want insurance hold %d", typ, amt, cardPremium)
	}
	if typ, amt := entryAccountType(t, f.pool, ref+":insurance:debit"); typ != string(ledger.AccountProviderClearing) || amt != cardPremium {
		t.Fatalf("premium debit = %s %d, want provider clearing %d (card money, never the wallet)", typ, amt, cardPremium)
	}
	var key, funding string
	var total int64
	if err := f.pool.QueryRow(context.Background(), `SELECT idempotency_key, funding_source, total_kobo FROM settlements WHERE id=$1`, *p.SettlementID).Scan(&key, &funding, &total); err != nil {
		t.Fatal(err)
	}
	if total != fare || funding != "external" || key != ref+":fare" {
		t.Fatalf("fare escrow key=%s funding=%s total=%d, want %s:fare external %d (premium never in the courier settlement)", key, funding, total, ref, fare)
	}
	if !p.InsuranceOpted || p.InsuranceStatus != "held" || p.InsurancePaidKobo != cardPremium || p.FareKobo != fare {
		t.Fatalf("parcel %+v", p)
	}
	if w := f.wallet(t); w != walletBefore {
		t.Fatalf("a card booking moved the wallet: %d → %d", walletBefore, w)
	}
}

func TestLiveDB_CardInsurance_VerifiedAmountMustIncludeThePremium(t *testing.T) {
	f, _ := newCardInsuranceFixture(t)
	ctx := context.Background()
	amount, frozen, err := f.svc.QuoteParcelBookingFrozenFor(ctx, f.sender, insuredReq())
	if err != nil {
		t.Fatal(err)
	}
	ref := "parcelorder-" + uuid.NewString()
	_, err = f.svc.BookParcelPaystackFundedFrozen(ctx, f.sender, insuredReq(), ref, amount-cardPremium, frozen)
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Code != CodeAmountMismatch {
		t.Fatalf("a charge of the fare alone must not book an insured parcel: %v", err)
	}
	if n := f.entryCount(t, ref+":insurance:credit"); n != 0 {
		t.Fatal("nothing may be held before the amount check passes")
	}
}

func TestLiveDB_CardInsurance_ReplayNeverDoubleHolds(t *testing.T) {
	f, _ := newCardInsuranceFixture(t)
	ctx := context.Background()
	amount, frozen, err := f.svc.QuoteParcelBookingFrozenFor(ctx, f.sender, insuredReq())
	if err != nil {
		t.Fatal(err)
	}
	ref := "parcelorder-" + uuid.NewString()
	// A crashed first attempt held the premium but never wrote the parcel; then
	// webhook + polls race the confirm.
	if err := f.svc.holdParcelPremiumCard(ctx, f.sender, ref, cardPremium); err != nil {
		t.Fatalf("crashed attempt: %v", err)
	}
	var wg sync.WaitGroup
	ids := make([]string, 6)
	for i := range ids {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ids[i], _ = f.svc.BookParcelPaystackFundedFrozen(ctx, f.sender, insuredReq(), ref, amount, frozen)
		}(i)
	}
	wg.Wait()
	id, err := f.svc.BookParcelPaystackFundedFrozen(ctx, f.sender, insuredReq(), ref, amount, frozen)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	for _, got := range ids {
		if got != "" && got != id {
			t.Fatalf("two parcels for one charge: %s vs %s", got, id)
		}
	}
	if n := f.entryCount(t, ref+":insurance:credit"); n != 1 {
		t.Fatalf("premium held %d times for one charge, want 1", n)
	}
	var held int64
	if err := f.pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount_kobo),0) FROM ledger_entries WHERE reference=$1 AND type='CREDIT'`, "parcel:insurance_hold_card:"+ref).Scan(&held); err != nil {
		t.Fatal(err)
	}
	if held != cardPremium {
		t.Fatalf("hold credited %d for this charge, want %d", held, cardPremium)
	}
}

func TestLiveDB_CardInsurance_BindRefusalRefundsThePremiumToTheCard(t *testing.T) {
	f, card := newCardInsuranceFixture(t)
	f.binder.uw.bindErr = fmt.Errorf("%w: invalid plate", gateway.ErrProviderRejected) // a definite refusal
	walletBefore := f.wallet(t)
	p, ref, _ := f.bookCard(t, insuredReq())

	f.svc.settleParcelInsuranceAtAccept(context.Background(), &p, f.svc.loadParcelSenderProfile(context.Background(), f.sender), completeVehicle)

	if got := f.parcel(t, p.ID); got.InsuranceStatus != "refunded" {
		t.Fatalf("after a refused bind: %+v", got)
	}
	assertPremiumRefundedToCard(t, f, card, p.ID, ref, walletBefore)
	// The saga returned the premium to the hold (never the wallet) …
	if typ, amt := entryAccountType(t, f.pool, "parcel:insurance:"+p.ID+":reversal:rev_debit"); typ != string(ledger.AccountInsurancePremiumHold) || amt != cardPremium {
		t.Fatalf("saga reversal credited %s %d, want the insurance hold %d", typ, amt, cardPremium)
	}
}

// A bind the insurer never answered may have created cover (and taken our
// float). A card refund cannot be clawed back, so nothing is refunded: the
// premium stays with the insurer side and the parcel stays 'binding' for the
// reconciler, which also leaves it alone until the insurer's outcome is known.
func TestLiveDB_CardInsurance_UnknownBindOutcomeIsNeverRefundedOnAGuess(t *testing.T) {
	f, card := newCardInsuranceFixture(t)
	ctx := context.Background()
	f.binder.uw.bindErr = errors.New("read tcp: i/o timeout") // no answer: outcome unknown
	walletBefore := f.wallet(t)
	p, _, _ := f.bookCard(t, insuredReq())
	f.svc.settleParcelInsuranceAtAccept(ctx, &p, f.svc.loadParcelSenderProfile(ctx, f.sender), completeVehicle)
	if got := f.parcel(t, p.ID); got.InsuranceStatus != "binding" {
		t.Fatalf("status %s, want binding (left for reconciliation)", got.InsuranceStatus)
	}
	if n := f.entryCount(t, "parcel:insurance:"+p.ID+":reversal:rev_debit"); n != 0 {
		t.Fatal("the saga reversed a card premium whose bind outcome is unknown")
	}
	if _, err := f.svc.ReconcileParcelInsurance(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if len(card.premiumRefunds()) != 0 || f.wallet(t) != walletBefore {
		t.Fatalf("refunded on a guess: card %+v", card.premiumRefunds())
	}
	if got := f.parcel(t, p.ID); got.InsuranceStatus != "binding" {
		t.Fatalf("after reconcile: %s, want binding until the insurer answers", got.InsuranceStatus)
	}
}

// A flag flip between initiate and confirm must not refund a correctly-charged
// order: the card path books what the card was charged for (the frozen premium).
func TestLiveDB_CardInsurance_FlagFlipAfterInitiateStillBooksWhatWasCharged(t *testing.T) {
	f, _ := newCardInsuranceFixture(t)
	ctx := context.Background()
	amount, frozen, err := f.svc.QuoteParcelBookingFrozenFor(ctx, f.sender, insuredReq())
	if err != nil {
		t.Fatal(err)
	}
	f.svc.WithPrepaidInsurance(false)
	id, err := f.svc.BookParcelPaystackFundedFrozen(ctx, f.sender, insuredReq(), "parcelorder-"+uuid.NewString(), amount, frozen)
	if err != nil {
		t.Fatalf("flag off at confirm: %v", err)
	}
	if p := f.parcel(t, id); p.InsuranceStatus != "held" || p.InsurancePaidKobo != cardPremium {
		t.Fatalf("parcel %+v, want the charged premium held", p)
	}
}

func TestLiveDB_CardInsurance_CannotStartRefundsFromTheHoldToTheCard(t *testing.T) {
	f, card := newCardInsuranceFixture(t)
	walletBefore := f.wallet(t)
	p, ref, _ := f.bookCard(t, insuredReq())

	f.svc.settleParcelInsuranceAtAccept(context.Background(), &p, f.svc.loadParcelSenderProfile(context.Background(), f.sender), parcelDriverVehicle{})
	f.svc.settleParcelInsuranceAtAccept(context.Background(), &p, parcelSenderProfile{}, parcelDriverVehicle{}) // idempotent

	if got := f.parcel(t, p.ID); got.InsuranceStatus != "refunded" {
		t.Fatalf("after a bind that could not start: %+v", got)
	}
	assertPremiumRefundedToCard(t, f, card, p.ID, ref, walletBefore)
}

func TestLiveDB_CardInsurance_CancelBeforeBindRefundsFareAndPremiumToTheCard(t *testing.T) {
	f, card := newCardInsuranceFixture(t)
	walletBefore := f.wallet(t)
	p, ref, _ := f.bookCard(t, insuredReq())
	res, err := f.svc.CancelParcelWithRefund(context.Background(), p.ID, f.sender, "changed my mind")
	if err != nil || res.RefundStatus != RefundStatusRefunded {
		t.Fatalf("cancel: %+v %v", res, err)
	}
	if len(card.settlements) != 1 || card.settlements[0] != *p.SettlementID {
		t.Fatalf("fare refund calls %v, want the fare settlement once", card.settlements)
	}
	if got := f.parcel(t, p.ID); got.InsuranceStatus != "refunded" {
		t.Fatalf("insurance status %s, want refunded", got.InsuranceStatus)
	}
	assertPremiumRefundedToCard(t, f, card, p.ID, ref, walletBefore)
}

func TestLiveDB_CardInsurance_CancelAfterBindRefundsThePremiumToTheCard(t *testing.T) {
	f, card := newCardInsuranceFixture(t)
	ctx := context.Background()
	walletBefore := f.wallet(t)
	p, _, _ := f.bookCard(t, insuredReq())
	f.svc.settleParcelInsuranceAtAccept(ctx, &p, f.svc.loadParcelSenderProfile(ctx, f.sender), completeVehicle)
	if got := f.parcel(t, p.ID); got.InsuranceStatus != "bound" {
		t.Fatalf("bind: %+v", got)
	}
	if _, err := f.svc.CancelParcelWithRefund(ctx, p.ID, f.sender, "changed my mind"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if got := f.parcel(t, p.ID); got.InsuranceStatus != "refunded" || f.binder.cancelled != 1 {
		t.Fatalf("after cancel: %+v cancels=%d", got, f.binder.cancelled)
	}
	pieces := card.premiumRefunds()
	if len(pieces) != 1 || pieces[0].entityID != p.ID || pieces[0].key != ParcelInsurancePieceKey || pieces[0].amount != cardPremium {
		t.Fatalf("card premium refunds %+v, want one of %d", pieces, cardPremium)
	}
	// Platform absorbs it: paymax_revenue → provider clearing (the card side),
	// never a wallet credit.
	if typ, amt := entryAccountType(t, f.pool, cancelRefundKey(p.ID)+":rev_debit"); typ != string(ledger.AccountProviderClearing) || amt != cardPremium {
		t.Fatalf("cancel refund leg = %s %d, want provider clearing %d", typ, amt, cardPremium)
	}
	if w := f.wallet(t); w != walletBefore {
		t.Fatalf("a card refund moved the wallet: %d → %d", walletBefore, w)
	}
}

func TestLiveDB_CardInsurance_ReconcilerRetriesAFailedCardRefund(t *testing.T) {
	f, card := newCardInsuranceFixture(t)
	ctx := context.Background()
	walletBefore := f.wallet(t)
	p, ref, _ := f.bookCard(t, insuredReq())

	card.pieceErr = errors.New("gateway down")
	f.svc.settleParcelInsuranceAtAccept(ctx, &p, f.svc.loadParcelSenderProfile(ctx, f.sender), parcelDriverVehicle{})
	if got := f.parcel(t, p.ID); got.InsuranceStatus != "refund_failed" {
		t.Fatalf("a failed card refund must be left refund_failed, got %s", got.InsuranceStatus)
	}
	if n := f.entryCount(t, holdRefundKey(ref)+":rev_debit"); n != 0 {
		t.Fatal("the ledger refund must not post before the card refund succeeded")
	}

	card.pieceErr = nil
	if _, err := f.svc.ReconcileParcelInsurance(ctx, 0); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if got := f.parcel(t, p.ID); got.InsuranceStatus != "refunded" {
		t.Fatalf("after reconcile: %s", got.InsuranceStatus)
	}
	assertPremiumRefundedToCard(t, f, card, p.ID, ref, walletBefore)
	// A second sweep finds nothing to do.
	if _, err := f.svc.ReconcileParcelInsurance(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if len(card.premiumRefunds()) != 1 {
		t.Fatal("the reconciler refunded the card premium twice")
	}
}

// A crash after a cancel claimed the premium (held → refunded) but before the
// card refund ran leaves 'refunded' with no refund anywhere: the sweep finishes it.
func TestLiveDB_CardInsurance_ReconcilerFinishesAClaimedButUnrefundedPremium(t *testing.T) {
	f, card := newCardInsuranceFixture(t)
	ctx := context.Background()
	walletBefore := f.wallet(t)
	p, ref, _ := f.bookCard(t, insuredReq())
	if _, err := f.pool.Exec(ctx, `UPDATE parcels SET status='cancelled', insurance_status='refunded' WHERE id=$1`, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReconcileParcelInsurance(ctx, 0); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	assertPremiumRefundedToCard(t, f, card, p.ID, ref, walletBefore)
}

func TestLiveDB_CardInsurance_OrphanSweepNeverRefundsACardPremiumToTheWallet(t *testing.T) {
	f, card := newCardInsuranceFixture(t)
	ctx := context.Background()
	walletBefore := f.wallet(t)
	ref := "parcelorder-" + uuid.NewString()
	if err := f.svc.holdParcelPremiumCard(ctx, f.sender, ref, cardPremium); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReconcileParcelInsurance(ctx, 0); err != nil {
		t.Fatal(err)
	}
	if w := f.wallet(t); w != walletBefore {
		t.Fatalf("the orphan sweep credited a card premium to the wallet: %d → %d", walletBefore, w)
	}
	if n := f.entryCount(t, holdRefundKey(ref)+":rev_debit"); n != 0 {
		t.Fatal("a card hold with no parcel is the card engine's to unwind, not the wallet orphan sweep's")
	}
	// The engine's unwind (order_failed) reverses it to clearing, once.
	for i := 0; i < 2; i++ {
		if err := f.svc.UnwindParcelPremiumHold(ctx, f.sender, ref); err != nil {
			t.Fatalf("unwind: %v", err)
		}
	}
	if typ, amt := entryAccountType(t, f.pool, holdRefundKey(ref)+":rev_debit"); typ != string(ledger.AccountProviderClearing) || amt != cardPremium {
		t.Fatalf("unwind = %s %d, want provider clearing %d", typ, amt, cardPremium)
	}
	if len(card.premiumRefunds()) != 0 || f.wallet(t) != walletBefore {
		t.Fatal("the unwind is ledger-only: the engine refunds the whole charge to the card itself")
	}
}

// assertPremiumRefundedToCard: exactly one card refund of the premium, its
// ledger leg posted once (hold → provider clearing), and the wallet untouched.
func assertPremiumRefundedToCard(t *testing.T, f *prepaidParcelFixture, card *fakeCardPieceRefunder, parcelID, ref string, walletBefore int64) {
	t.Helper()
	pieces := card.premiumRefunds()
	if len(pieces) != 1 || pieces[0].entityID != parcelID || pieces[0].key != ParcelInsurancePieceKey || pieces[0].amount != cardPremium {
		t.Fatalf("card premium refunds %+v, want exactly one of %d for parcel %s", pieces, cardPremium, parcelID)
	}
	if typ, amt := entryAccountType(t, f.pool, holdRefundKey(ref)+":rev_debit"); typ != string(ledger.AccountProviderClearing) || amt != cardPremium {
		t.Fatalf("premium refund leg = %s %d, want provider clearing %d (hold → card)", typ, amt, cardPremium)
	}
	if n := f.entryCount(t, holdRefundKey(ref)+":rev_debit"); n != 1 {
		t.Fatalf("premium refund posted %d times", n)
	}
	if w := f.wallet(t); w != walletBefore {
		t.Fatalf("a card premium refund moved the wallet: %d → %d", walletBefore, w)
	}
}
