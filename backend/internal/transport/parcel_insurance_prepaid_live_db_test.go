package transport

// LIVE-DB tests for parcel insurance paid AT BOOKING (FEATURE_PARCEL_PREPAID_INSURANCE).
// Skipped unless TEST_DATABASE_URL is set. The bind runs through the REAL
// insurance policy saga (policy.BindFromQuotePrepaid) against a fake
// underwriter, so the ledger keys transport reads are the ones the saga writes.
// Pins:
//  1. Ticked: the wallet pays fare + premium; the premium goes to the insurance
//     hold, NEVER into the fare escrow / courier settlement.
//  2. Not ticked (or flag off): no premium, nothing held.
//  3. Ineligible (profile incomplete, no declared value, insurer unwired, card
//     rail) is refused BEFORE any money moves.
//  4. At courier accept: bound → hold drained to provider clearing, wallet
//     untouched; provider refusal → the saga refunds what was paid; cannot
//     start (no plate) → transport refunds it from the hold.
//  5. Cancel before bind refunds the held premium with the fare.

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/insurance/consent"
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/insurance/policy"
	"spotlight/backend/internal/testsupport"
)

const prepaidRateBps = 200 // 2% of declared value

// ── a test InsuranceBinder over the REAL policy saga ────────────────────────

type prepaidUnderwriter struct {
	premiumKobo int64
	bindErr     error
}

func (u *prepaidUnderwriter) Name() string { return "prepaiduw" }
func (u *prepaidUnderwriter) GetQuote(context.Context, gateway.QuoteRequest) (gateway.Quote, error) {
	return gateway.Quote{}, errors.New("unused")
}
func (u *prepaidUnderwriter) BindPolicy(context.Context, gateway.BindRequest) (gateway.Policy, error) {
	if u.bindErr != nil {
		return gateway.Policy{}, u.bindErr
	}
	return gateway.Policy{ProviderPolicyRef: "pol-" + uuid.NewString(), Status: "active", PremiumKobo: u.premiumKobo}, nil
}
func (u *prepaidUnderwriter) GetPolicy(context.Context, string) (gateway.Policy, error) {
	return gateway.Policy{}, nil
}
func (u *prepaidUnderwriter) CancelPolicy(context.Context, string, string) (gateway.Policy, error) {
	return gateway.Policy{}, nil
}
func (u *prepaidUnderwriter) SubmitClaim(context.Context, gateway.ClaimRequest) (gateway.Claim, error) {
	return gateway.Claim{}, nil
}
func (u *prepaidUnderwriter) GetClaim(context.Context, string) (gateway.Claim, error) {
	return gateway.Claim{}, nil
}
func (u *prepaidUnderwriter) UploadEvidence(context.Context, gateway.EvidenceUpload) error {
	return nil
}
func (u *prepaidUnderwriter) VerifyWebhook(context.Context, []byte, string) (gateway.WebhookEvent, error) {
	return gateway.WebhookEvent{}, nil
}
func (u *prepaidUnderwriter) WebhookSignatureHeader() string { return "" }

type prepaidResolver struct{}

func (prepaidResolver) ResolveProduct(context.Context, string) (string, gateway.ProviderProduct, bool) {
	return "prepaiduw", gateway.ProviderProduct{Code: "git"}, true
}

type prepaidTestBinder struct {
	pool    *pgxpool.Pool
	pol     *policy.Service
	cons    *consent.Service
	uw      *prepaidUnderwriter
	quoteFn func() error // optional: fail CreateQuote
}

func (b *prepaidTestBinder) IndicativeRateBps(context.Context, string) (int64, error) {
	return prepaidRateBps, nil
}
func (b *prepaidTestBinder) GrantConsent(ctx context.Context, userID, productCode string) error {
	_, err := b.cons.Grant(ctx, userID, productCode, "")
	return err
}
func (b *prepaidTestBinder) CreateQuote(ctx context.Context, userID, productCode string, sum int64, _ map[string]any) (string, int64, error) {
	if b.quoteFn != nil {
		if err := b.quoteFn(); err != nil {
			return "", 0, err
		}
	}
	var id string
	err := b.pool.QueryRow(ctx, `
		INSERT INTO public.insurance_quote (user_id, product_code, provider, underwriter, provider_quote_ref,
		       premium_kobo, sum_insured_kobo, currency, commission_kobo, terms, inputs, expires_at)
		VALUES ($1,$2,'prepaiduw','STI',$3,$4,$5,'NGN',0,'{}','{}',$6) RETURNING id`,
		userID, productCode, "q-"+uuid.NewString(), b.uw.premiumKobo, sum, time.Now().Add(time.Hour)).Scan(&id)
	return id, b.uw.premiumKobo, err
}
func (b *prepaidTestBinder) BindFromQuote(ctx context.Context, userID, quoteID, key string) (string, int64, error) {
	p, err := b.pol.BindFromQuote(ctx, userID, quoteID, key)
	if err != nil {
		return "", 0, err
	}
	return p.ID, p.PremiumKobo, nil
}
func (b *prepaidTestBinder) BindFromQuotePrepaid(ctx context.Context, userID, quoteID string, paid int64, key string) (string, int64, error) {
	p, err := b.pol.BindFromQuotePrepaid(ctx, userID, quoteID, paid, key)
	if err != nil {
		return "", 0, err
	}
	return p.ID, p.PremiumKobo, nil
}
func (b *prepaidTestBinder) CancelPolicy(context.Context, string, string, string) error { return nil }

// ── fixture ─────────────────────────────────────────────────────────────────

type prepaidParcelFixture struct {
	svc    *Service
	led    *ledger.Service
	pool   *pgxpool.Pool
	sender string
	binder *prepaidTestBinder
}

func newPrepaidParcelFixture(t *testing.T, completeProfile bool) *prepaidParcelFixture {
	t.Helper()
	pool := paystackRidePool(t)
	ctx := context.Background()
	svc, led, sender := paystackRideFixture(t, ctx, pool, 50_000_000)
	testsupport.SetKycTier(t, ctx, pool, sender, testsupport.KycTierUnlimited)
	if completeProfile {
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.user_profiles (id, first_name, last_name, email, phone, gender, date_of_birth, address)
			VALUES ($1,'Ada','Okafor',$2,'2348012345678','Female','1990-01-01','12 Marina Rd, Lagos')
			ON CONFLICT (id) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
			  email=EXCLUDED.email, phone=EXCLUDED.phone, gender=EXCLUDED.gender,
			  date_of_birth=EXCLUDED.date_of_birth, address=EXCLUDED.address`, sender, sender+"@pfride.test"); err != nil {
			t.Fatalf("seed profile: %v", err)
		}
	}
	uw := &prepaidUnderwriter{premiumKobo: 250_000}
	cons := consent.NewService(pool)
	pol := policy.NewService(policy.Deps{
		Repo: policy.NewRepository(pool), Router: gateway.NewRouter(prepaidResolver{}, uw),
		Consent: cons, Ledger: led, Binds: policy.NewBindRegistry(pool),
	})
	binder := &prepaidTestBinder{pool: pool, pol: pol, cons: cons, uw: uw}
	svc = svc.WithInsurance(binder).WithPrepaidInsurance(true)
	return &prepaidParcelFixture{svc: svc, led: led, pool: pool, sender: sender, binder: binder}
}

func insuredReq() ParcelBookRequest {
	r := parcelReq()
	r.DeclaredValueKobo = 10_000_000 // ₦100,000 → 2% = ₦2,000 premium
	r.Insure = true
	return r
}

// wallet is the ledger's authoritative balance (REVERSAL_DEBIT counts as money
// in). riderWalletBalance predates reversals and would show a refund as a debit.
func (f *prepaidParcelFixture) wallet(t *testing.T) int64 {
	t.Helper()
	b, err := f.led.GetBalance(context.Background(), f.sender)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b
}

func (f *prepaidParcelFixture) parcel(t *testing.T, id string) parcelRow {
	t.Helper()
	var p parcelRow
	if err := f.svc.loadParcel(context.Background(), id, &p); err != nil {
		t.Fatalf("load parcel: %v", err)
	}
	return p
}

func entryAccountType(t *testing.T, pool *pgxpool.Pool, key string) (string, int64) {
	t.Helper()
	var typ string
	var amt int64
	_ = pool.QueryRow(context.Background(), `
		SELECT a.type, e.amount_kobo FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.account_id
		WHERE e.idempotency_key=$1`, key).Scan(&typ, &amt)
	return typ, amt
}

var completeVehicle = parcelDriverVehicle{PlateNumber: "LND-238-KJA", VehicleType: "bike"}

func (f *prepaidParcelFixture) book(t *testing.T, req ParcelBookRequest) (parcelRow, string) {
	t.Helper()
	key := "insured-" + uuid.NewString()
	out, err := f.svc.BookParcel(context.Background(), f.sender, req, key)
	if err != nil {
		t.Fatalf("book: %v", err)
	}
	id, _ := out["id"].(string)
	return f.parcel(t, id), key
}

// ── tests ───────────────────────────────────────────────────────────────────

func TestLiveDB_PrepaidInsurance_BookingChargesFarePlusPremiumIntoTheHold(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	fare, err := f.svc.QuoteParcelBooking(context.Background(), parcelReq())
	if err != nil {
		t.Fatal(err)
	}
	before := f.wallet(t)
	p, key := f.book(t, insuredReq())

	const premium = 200_000
	if got := f.wallet(t); got != before-fare-premium {
		t.Fatalf("wallet %d, want %d (fare %d + premium %d)", got, before-fare-premium, fare, premium)
	}
	if typ, amt := entryAccountType(t, f.pool, key+":insurance:credit"); typ != string(ledger.AccountInsurancePremiumHold) || amt != premium {
		t.Fatalf("premium leg = %s %d, want insurance hold %d", typ, amt, premium)
	}
	var settled int64
	if err := f.pool.QueryRow(context.Background(), `SELECT total_kobo FROM settlements WHERE id=$1`, *p.SettlementID).Scan(&settled); err != nil {
		t.Fatal(err)
	}
	if settled != fare {
		t.Fatalf("fare escrow %d, want the fare %d only — the premium must never reach the courier settlement", settled, fare)
	}
	if !p.InsuranceOpted || p.InsurancePaidKobo != premium || p.InsuranceStatus != "held" || p.InsuranceKobo != premium {
		t.Fatalf("parcel insurance state %+v", p)
	}
}

func TestLiveDB_PrepaidInsurance_NotTickedChargesNoPremium(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	fare, _ := f.svc.QuoteParcelBooking(context.Background(), parcelReq())
	before := f.wallet(t)
	req := insuredReq()
	req.Insure = false // declared a value, but did not tick insurance
	p, key := f.book(t, req)
	if got := f.wallet(t); got != before-fare {
		t.Fatalf("wallet %d, want fare-only %d", got, before-fare)
	}
	if typ, _ := entryAccountType(t, f.pool, key+":insurance:credit"); typ != "" {
		t.Fatal("no premium may be held when insurance is not ticked")
	}
	if p.InsuranceOpted || p.InsurancePaidKobo != 0 || p.InsuranceStatus != "none" || p.InsuranceKobo != 0 {
		t.Fatalf("unticked parcel insurance state %+v", p)
	}
}

func TestLiveDB_PrepaidInsurance_IneligibleIsRefusedBeforeMoneyMoves(t *testing.T) {
	f := newPrepaidParcelFixture(t, false) // no gender / DOB / address on file
	before := f.wallet(t)
	_, err := f.svc.BookParcel(context.Background(), f.sender, insuredReq(), "inelig-"+uuid.NewString())
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusUnprocessableEntity || ce.Code != CodeInsuranceProfileIncomplete {
		t.Fatalf("want 422 %s, got %v", CodeInsuranceProfileIncomplete, err)
	}
	if missing, _ := ce.Body()["missing"].([]string); len(missing) == 0 {
		t.Fatalf("the refusal must list the missing profile fields, got %v", ce.Body())
	}

	noValue := insuredReq()
	noValue.DeclaredValueKobo = 0
	if _, err := f.svc.BookParcel(context.Background(), f.sender, noValue, "noval-"+uuid.NewString()); !errors.As(err, &ce) || ce.Code != CodeInsuranceDeclaredValueRequired {
		t.Fatalf("want %s, got %v", CodeInsuranceDeclaredValueRequired, err)
	}
	if got := f.wallet(t); got != before {
		t.Fatalf("a refused insured booking moved the wallet: %d → %d", before, got)
	}
}

func TestLiveDB_PrepaidInsurance_CardRailRefusesInsureForNow(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	var ce *CodedError
	if _, err := f.svc.QuoteParcelBooking(context.Background(), insuredReq()); !errors.As(err, &ce) || ce.Code != CodeInsuranceCardNotSupported {
		t.Fatalf("card quote with insure: want %s, got %v", CodeInsuranceCardNotSupported, err)
	}
}

func TestLiveDB_PrepaidInsurance_FlagOffIgnoresTheTick(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	f.svc = f.svc.WithPrepaidInsurance(false)
	fare, _ := f.svc.QuoteParcelBooking(context.Background(), parcelReq())
	before := f.wallet(t)
	p, _ := f.book(t, insuredReq())
	if got := f.wallet(t); got != before-fare {
		t.Fatalf("flag off: wallet %d, want fare-only %d", got, before-fare)
	}
	if p.InsuranceStatus != "none" || p.InsurancePaidKobo != 0 {
		t.Fatalf("flag off must keep legacy behaviour, got %+v", p)
	}
}

func TestLiveDB_PrepaidInsurance_BindAtAcceptUsesTheHeldPremium(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	p, _ := f.book(t, insuredReq())
	afterBooking := f.wallet(t)

	f.svc.settleParcelInsuranceAtAccept(context.Background(), &p, f.svc.loadParcelSenderProfile(context.Background(), f.sender), completeVehicle)

	got := f.parcel(t, p.ID)
	if got.InsuranceStatus != "bound" || got.InsurancePolicyID == nil || *got.InsurancePolicyID == "" {
		t.Fatalf("after bind: %+v", got)
	}
	if got.InsuranceKobo != 200_000 {
		t.Fatalf("the customer-facing premium must stay what they paid (200000), got %d", got.InsuranceKobo)
	}
	if w := f.wallet(t); w != afterBooking {
		t.Fatalf("bind must not touch the wallet again: %d → %d", afterBooking, w)
	}
	if typ, amt := entryAccountType(t, f.pool, "parcel:insurance:"+p.ID+":premium:debit"); typ != string(ledger.AccountInsurancePremiumHold) || amt != 200_000 {
		t.Fatalf("hold drain = %s %d, want hold 200000", typ, amt)
	}
}

func TestLiveDB_PrepaidInsurance_ProviderRefusalRefundsThePremium(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	f.binder.uw.bindErr = errors.New("provider rejected")
	p, _ := f.book(t, insuredReq())
	afterBooking := f.wallet(t)

	f.svc.settleParcelInsuranceAtAccept(context.Background(), &p, f.svc.loadParcelSenderProfile(context.Background(), f.sender), completeVehicle)

	if got := f.parcel(t, p.ID); got.InsuranceStatus != "refunded" || got.InsurancePolicyID != nil {
		t.Fatalf("after a refused bind: %+v", got)
	}
	if w := f.wallet(t); w != afterBooking+200_000 {
		t.Fatalf("refund: wallet %d, want %d", w, afterBooking+200_000)
	}
}

func TestLiveDB_PrepaidInsurance_CannotStartRefundsFromTheHold(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	p, _ := f.book(t, insuredReq())
	afterBooking := f.wallet(t)

	// The courier has no plate on file: the insurer's form cannot be filled.
	f.svc.settleParcelInsuranceAtAccept(context.Background(), &p, f.svc.loadParcelSenderProfile(context.Background(), f.sender), parcelDriverVehicle{})

	if got := f.parcel(t, p.ID); got.InsuranceStatus != "refunded" {
		t.Fatalf("after a bind that could not start: %+v", got)
	}
	if w := f.wallet(t); w != afterBooking+200_000 {
		t.Fatalf("refund: wallet %d, want %d", w, afterBooking+200_000)
	}
	// Idempotent: a second settle moves nothing more.
	f.svc.settleParcelInsuranceAtAccept(context.Background(), &p, parcelSenderProfile{}, parcelDriverVehicle{})
	if w := f.wallet(t); w != afterBooking+200_000 {
		t.Fatalf("second settle moved the wallet again: %d", w)
	}
}

func TestLiveDB_PrepaidInsurance_CancelBeforeBindRefundsPremiumAndFare(t *testing.T) {
	f := newPrepaidParcelFixture(t, true)
	before := f.wallet(t)
	p, _ := f.book(t, insuredReq())
	if _, err := f.svc.CancelParcelWithRefund(context.Background(), p.ID, f.sender, "changed my mind"); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if w := f.wallet(t); w != before {
		t.Fatalf("after cancel the wallet is %d, want fully restored %d (fare + premium)", w, before)
	}
	if got := f.parcel(t, p.ID); got.InsuranceStatus != "refunded" {
		t.Fatalf("insurance status after cancel = %s, want refunded", got.InsuranceStatus)
	}
}
