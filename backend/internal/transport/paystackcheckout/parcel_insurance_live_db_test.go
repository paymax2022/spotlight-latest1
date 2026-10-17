package paystackcheckout

// LIVE-DB end-to-end: card-direct parcel checkout WITH insurance. Real Engine +
// PGStore + transport.Service + settlement + ledger; only Paystack is faked.
// Pins: the charge is fare + premium; confirm escrows the fare and holds the
// premium (one hold, however many confirms race); a cancel refunds BOTH back to
// the card as two exact pieces that sum to the charge; the wallet is never
// touched and the hold nets to zero.

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/transport"
)

const liveInsuredParcelBody = `{"pickup":{"lat":6.5,"lng":3.4,"address":"A, Lagos"},"dropoff":{"lat":6.6,"lng":3.35,"address":"B, Lagos"},
 "receiver_name":"Ada","receiver_phone":"+2348000000000","size":"small","speed":"standard","prohibited_ack":true,
 "declared_value_kobo":10000000,"insure":true}`

const livePremium = 200_000 // 2% of ₦100,000

// displayOnlyBinder is enough insurance for booking + cancel-before-bind: a
// rate, consent, and nothing bound.
type displayOnlyBinder struct{}

func (displayOnlyBinder) IndicativeRateBps(context.Context, string) (int64, error) { return 200, nil }
func (displayOnlyBinder) GrantConsent(context.Context, string, string) error       { return nil }
func (displayOnlyBinder) CreateQuote(context.Context, string, string, int64, map[string]any) (string, int64, error) {
	return "", 0, errors.New("unused")
}
func (displayOnlyBinder) BindFromQuote(context.Context, string, string, string) (string, int64, error) {
	return "", 0, errors.New("unused")
}
func (displayOnlyBinder) BindFromQuotePrepaid(context.Context, string, string, int64, string) (string, int64, error) {
	return "", 0, errors.New("unused")
}
func (displayOnlyBinder) BindOutcome(context.Context, string) (string, string, error) {
	return "", "", nil
}
func (displayOnlyBinder) CancelPolicy(context.Context, string, string, string) error { return nil }

func newInsuredLiveRig(t *testing.T) *liveRig {
	t.Helper()
	r := newLiveRig(t)
	ctx := context.Background()
	st := NewPGStore(r.pool)
	r.gw.ev = &events{}
	r.e.EnablePartialRefunds(r.gw, st)
	r.svc.WithInsurance(displayOnlyBinder{}).WithPrepaidInsurance(true) // the engine's parcel domain holds this same *Service
	if _, err := r.pool.Exec(ctx, `
		INSERT INTO public.user_profiles (id, first_name, last_name, email, phone, gender, date_of_birth, address)
		VALUES ($1,'Ada','Okafor',$2,'2348012345678','Female','1990-01-01','12 Marina Rd, Lagos')
		ON CONFLICT (id) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
		  email=EXCLUDED.email, phone=EXCLUDED.phone, gender=EXCLUDED.gender,
		  date_of_birth=EXCLUDED.date_of_birth, address=EXCLUDED.address`, r.sender, r.sender+"@cdparcel.test"); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	t.Cleanup(func() {
		_, _ = r.pool.Exec(context.WithoutCancel(ctx), `DELETE FROM public.transport_paystack_intent_refunds WHERE reference IN (SELECT reference FROM public.transport_paystack_intents WHERE payer_id=$1)`, r.sender)
	})
	return r
}

func (r *liveRig) holdNet(t *testing.T, ref string) (credit, debit int64) {
	t.Helper()
	if err := r.pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(e.amount_kobo) FILTER (WHERE e.type IN ('CREDIT','REVERSAL_DEBIT')),0),
		       COALESCE(SUM(e.amount_kobo) FILTER (WHERE e.type IN ('DEBIT','REVERSAL_CREDIT')),0)
		  FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id
		 WHERE a.type=$1 AND (e.idempotency_key LIKE $2 || '%')`, string(ledger.AccountInsurancePremiumHold), ref+":insurance").Scan(&credit, &debit); err != nil {
		t.Fatal(err)
	}
	return credit, debit
}

func TestLiveDB_ParcelCardDirect_Insured_ChargeSplitReplayCancel(t *testing.T) {
	r := newInsuredLiveRig(t)
	ctx := context.Background()

	plain, err := r.e.Initiate(ctx, "parcel", r.sender, json.RawMessage(liveParcelBody), "cdins-plain-"+uuid.NewString(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	key := "cdins-" + uuid.NewString()
	co, err := r.e.Initiate(ctx, "parcel", r.sender, json.RawMessage(liveInsuredParcelBody), key, "a@b.test", "")
	if err != nil {
		t.Fatalf("insured initiate: %v", err)
	}
	if co.AmountKobo != plain.AmountKobo+livePremium {
		t.Fatalf("charge %d, want fare %d + premium %d", co.AmountKobo, plain.AmountKobo, livePremium)
	}
	if last := r.gw.initCalls[len(r.gw.initCalls)-1]; last.AmountKobo != co.AmountKobo {
		t.Fatalf("Paystack asked for %d, want %d", last.AmountKobo, co.AmountKobo)
	}

	// Paid; webhook + polls race the confirm.
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo, Currency: "NGN"}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i == 0 {
				_, _ = r.e.OnChargeSuccess(ctx, co.Reference, co.Reference)
			} else {
				_, _ = r.e.CheckStatus(ctx, co.Reference)
			}
		}(i)
	}
	wg.Wait()
	res, err := r.e.CheckStatus(ctx, co.Reference)
	if err != nil || res.Status != StatusConfirmed || res.EntityID == nil {
		t.Fatalf("not confirmed: %+v %v", res, err)
	}
	parcelID := *res.EntityID

	// Split: fare → external escrow (a piece of the charge), premium → the hold, once.
	var settKey string
	var fare int64
	if err := r.pool.QueryRow(ctx, `SELECT s.idempotency_key, s.total_kobo FROM parcels p JOIN settlements s ON s.id=p.settlement_id WHERE p.id=$1`, parcelID).Scan(&settKey, &fare); err != nil {
		t.Fatal(err)
	}
	if settKey != co.Reference+":fare" || fare != co.AmountKobo-livePremium {
		t.Fatalf("fare escrow %s %d, want %s:fare %d", settKey, fare, co.Reference, co.AmountKobo-livePremium)
	}
	if credit, debit := r.holdNet(t, co.Reference); credit != livePremium || debit != 0 {
		t.Fatalf("hold credit=%d debit=%d after confirm, want exactly one hold of %d", credit, debit, livePremium)
	}
	var status string
	var paid int64
	if err := r.pool.QueryRow(ctx, `SELECT insurance_status, insurance_paid_kobo FROM parcels WHERE id=$1`, parcelID).Scan(&status, &paid); err != nil {
		t.Fatal(err)
	}
	if status != "held" || paid != livePremium {
		t.Fatalf("parcel insurance %s %d", status, paid)
	}
	if len(r.gw.refundCalls)+len(r.gw.pCalls) != 0 {
		t.Fatal("a booked parcel must not be refunded")
	}

	// Cancel: fare and premium back to the card as two exact pieces.
	cres, err := r.svc.CancelParcelWithRefund(ctx, parcelID, r.sender, "changed_mind")
	if err != nil || cres.RefundStatus != transport.RefundStatusRefunded {
		t.Fatalf("cancel: %+v %v", cres, err)
	}
	if len(r.gw.refundCalls) != 0 {
		t.Fatalf("an insured charge must never be refunded whole: %v", r.gw.refundCalls)
	}
	got := map[int64]string{}
	var sum int64
	for _, c := range r.gw.pCalls {
		if c.Ref != co.Reference {
			t.Fatalf("piece refund against %s, want %s", c.Ref, co.Reference)
		}
		got[c.Amt] = c.Note
		sum += c.Amt
	}
	if len(r.gw.pCalls) != 2 || sum != co.AmountKobo || got[livePremium] != co.Reference+"#"+transport.ParcelInsurancePieceKey || got[fare] == "" {
		t.Fatalf("card refunds %+v, want the fare %d and the premium %d (sum %d)", r.gw.pCalls, fare, livePremium, co.AmountKobo)
	}
	rec, _ := NewPGStore(r.pool).Get(ctx, co.Reference)
	if rec.Status != StatusRefunded || rec.RefundedKobo != co.AmountKobo {
		t.Fatalf("intent %s refunded=%d, want refunded %d", rec.Status, rec.RefundedKobo, co.AmountKobo)
	}
	if credit, debit := r.holdNet(t, co.Reference); credit != debit {
		t.Fatalf("hold credit=%d debit=%d after cancel, want it to net to zero", credit, debit)
	}
	if bal := r.walletBalance(t); bal != 0 {
		t.Fatalf("sender wallet = %d, want 0 (card money returns to the card)", bal)
	}
	// A repeat cancel refunds nothing more.
	_, _ = r.svc.CancelParcelWithRefund(ctx, parcelID, r.sender, "again")
	if len(r.gw.pCalls) != 2 {
		t.Fatalf("card refunds after a repeat cancel: %d", len(r.gw.pCalls))
	}
}

func TestLiveDB_ParcelCardDirect_Insured_FareOnlyChargeIsRefundedWhole(t *testing.T) {
	r := newInsuredLiveRig(t)
	ctx := context.Background()
	co, err := r.e.Initiate(ctx, "parcel", r.sender, json.RawMessage(liveInsuredParcelBody), "cdins-short-"+uuid.NewString(), "a@b.test", "")
	if err != nil {
		t.Fatal(err)
	}
	// The gateway collected only the fare: an insured parcel cannot be booked on it.
	r.gw.verify = &provider.PaymentStatus{Status: "success", AmountKobo: co.AmountKobo - livePremium, Currency: "NGN"}
	if _, err := r.e.OnChargeSuccess(ctx, co.Reference, co.Reference); err == nil {
		t.Fatal("want amount mismatch")
	}
	var n int
	_ = r.pool.QueryRow(ctx, `SELECT count(*) FROM parcels WHERE idempotency_key=$1`, co.Reference).Scan(&n)
	if credit, _ := r.holdNet(t, co.Reference); n != 0 || credit != 0 {
		t.Fatalf("parcels=%d hold=%d, want nothing booked or held", n, credit)
	}
	if len(r.gw.refundCalls) != 1 || r.gw.refundCalls[0] != co.AmountKobo-livePremium {
		t.Fatalf("refunds %v, want the collected amount back", r.gw.refundCalls)
	}
}
