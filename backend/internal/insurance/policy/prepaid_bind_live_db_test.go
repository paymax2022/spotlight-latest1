package policy

// LIVE-DB tests for BindFromQuotePrepaid: binding a policy whose premium the
// customer ALREADY paid (into ledger.AccountInsurancePremiumHold, e.g. with a
// parcel fare at booking). Skipped unless TEST_DATABASE_URL is set. Pins:
//  1. The premium moves hold → provider_clearing for exactly what the customer
//     paid; their wallet is never debited again.
//  2. The platform absorbs the gap to the insurer's real premium AFTER the
//     bind succeeds: real > paid is paymax_revenue → clearing; real < paid is
//     clearing → paymax_revenue. Customer pays exactly what they were shown.
//  3. A failed bind refunds what the customer PAID (not the quote) to their
//     wallet, posts no gap, and leaves the policy VOID.
//  4. A replay with the same key moves no more money.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/insurance/consent"
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/testsupport"
)

const prepaidTestProduct = "test:prepaid-git"

// fakeUnderwriter binds at a fixed real premium, or fails.
type fakeUnderwriter struct {
	premiumKobo int64
	bindErr     error
	binds       int
}

func (f *fakeUnderwriter) Name() string { return "fakeuw" }
func (f *fakeUnderwriter) GetQuote(context.Context, gateway.QuoteRequest) (gateway.Quote, error) {
	return gateway.Quote{}, errors.New("not used")
}
func (f *fakeUnderwriter) BindPolicy(_ context.Context, req gateway.BindRequest) (gateway.Policy, error) {
	f.binds++
	if f.bindErr != nil {
		return gateway.Policy{}, f.bindErr
	}
	return gateway.Policy{ProviderPolicyRef: "pol-" + uuid.NewString(), Status: "active", PremiumKobo: f.premiumKobo}, nil
}
func (f *fakeUnderwriter) GetPolicy(context.Context, string) (gateway.Policy, error) {
	return gateway.Policy{}, nil
}
func (f *fakeUnderwriter) CancelPolicy(context.Context, string, string) (gateway.Policy, error) {
	return gateway.Policy{}, nil
}
func (f *fakeUnderwriter) SubmitClaim(context.Context, gateway.ClaimRequest) (gateway.Claim, error) {
	return gateway.Claim{}, nil
}
func (f *fakeUnderwriter) GetClaim(context.Context, string) (gateway.Claim, error) {
	return gateway.Claim{}, nil
}
func (f *fakeUnderwriter) UploadEvidence(context.Context, gateway.EvidenceUpload) error { return nil }
func (f *fakeUnderwriter) VerifyWebhook(context.Context, []byte, string) (gateway.WebhookEvent, error) {
	return gateway.WebhookEvent{}, nil
}
func (f *fakeUnderwriter) WebhookSignatureHeader() string { return "" }

type fakeResolver struct{}

func (fakeResolver) ResolveProduct(context.Context, string) (string, gateway.ProviderProduct, bool) {
	return "fakeuw", gateway.ProviderProduct{Code: "fake-git"}, true
}

type prepaidFixture struct {
	svc    *Service
	ledger *ledger.Service
	pool   *pgxpool.Pool
	user   string
	uw     *fakeUnderwriter
}

func newPrepaidFixture(t *testing.T, realPremium int64) *prepaidFixture {
	t.Helper()
	pool := liveBindRegistryPool(t)
	ctx := context.Background()
	user := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2)`, user, user+"@prepaid.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, user)
	led := ledger.NewService(ledger.NewRepository(pool), nil)
	cons := consent.NewService(pool)
	if _, err := cons.Grant(ctx, user, prepaidTestProduct, ""); err != nil {
		t.Fatalf("consent: %v", err)
	}
	uw := &fakeUnderwriter{premiumKobo: realPremium}
	svc := NewService(Deps{
		Repo:    NewRepository(pool),
		Router:  gateway.NewRouter(fakeResolver{}, uw),
		Consent: cons,
		Ledger:  led,
		Binds:   NewBindRegistry(pool),
	})
	return &prepaidFixture{svc: svc, ledger: led, pool: pool, user: user, uw: uw}
}

// payIntoHold simulates booking: the customer's wallet pays the premium into
// the insurance hold (the wallet is funded first).
func (f *prepaidFixture) payIntoHold(t *testing.T, paid int64) {
	t.Helper()
	ctx := context.Background()
	rev, _ := f.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err := f.ledger.Credit(ctx, f.user, "seed", "prepaid-fund-"+f.user, rev.ID, paid); err != nil {
		t.Fatalf("fund: %v", err)
	}
	hold, err := f.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountInsurancePremiumHold)
	if err != nil {
		t.Fatalf("hold account: %v", err)
	}
	wallet, err := f.ledger.GetOrCreateUserWallet(ctx, f.user)
	if err != nil {
		t.Fatalf("wallet: %v", err)
	}
	if err := f.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference: "test:booking-premium", IdempotencyKey: "prepaid-book-" + f.user,
		AmountKobo: paid, DebitAccountID: wallet.ID, CreditAccountID: hold.ID,
	}); err != nil {
		t.Fatalf("pay into hold: %v", err)
	}
}

func (f *prepaidFixture) quote(t *testing.T, premium int64) string {
	t.Helper()
	id, err := f.svc.repo.insertQuote(context.Background(), f.user, prepaidTestProduct, "fakeuw",
		gateway.Quote{ProviderQuoteRef: "q-" + uuid.NewString(), PremiumKobo: premium, SumInsuredKobo: 10_000_000, Currency: "NGN"},
		nil, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("seed quote: %v", err)
	}
	return id
}

func (f *prepaidFixture) wallet(t *testing.T) int64 {
	t.Helper()
	b, err := f.ledger.GetBalance(context.Background(), f.user)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// leg returns the (account type, amount) a ledger entry key posted, or "" if none.
func (f *prepaidFixture) leg(t *testing.T, key string) (string, int64) {
	t.Helper()
	var typ string
	var amt int64
	err := f.pool.QueryRow(context.Background(), `
		SELECT a.type, e.amount_kobo FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
		WHERE e.idempotency_key = $1`, key).Scan(&typ, &amt)
	if err != nil {
		return "", 0
	}
	return typ, amt
}

func TestPrepaidBind_PlatformAbsorbsHigherRealPremium(t *testing.T) {
	f := newPrepaidFixture(t, 250_000) // insurer charges ₦2,500
	f.payIntoHold(t, 200_000)          // customer paid ₦2,000 at booking
	before := f.wallet(t)
	key := "prepaid-" + uuid.NewString()

	p, err := f.svc.BindFromQuotePrepaid(context.Background(), f.user, f.quote(t, 250_000), 200_000, key)
	if err != nil {
		t.Fatalf("bind: %v", err)
	}
	if p.State != StateActive {
		t.Fatalf("state %s, want ACTIVE", p.State)
	}
	if got := f.wallet(t); got != before {
		t.Fatalf("customer wallet moved at bind: %d → %d", before, got)
	}
	if typ, amt := f.leg(t, key+":premium:debit"); typ != string(ledger.AccountInsurancePremiumHold) || amt != 200_000 {
		t.Fatalf("premium debit leg = %s %d, want hold 200000", typ, amt)
	}
	if typ, amt := f.leg(t, key+":premium:credit"); typ != string(ledger.AccountProviderClearing) || amt != 200_000 {
		t.Fatalf("premium credit leg = %s %d, want clearing 200000", typ, amt)
	}
	if typ, amt := f.leg(t, key+":absorb:debit"); typ != string(ledger.AccountPaymaxRevenue) || amt != 50_000 {
		t.Fatalf("absorb leg = %s %d, want revenue 50000", typ, amt)
	}
	if typ, _ := f.leg(t, key+":excess:debit"); typ != "" {
		t.Fatal("no excess leg expected when the insurer is dearer")
	}
}

func TestPrepaidBind_PlatformKeepsLowerRealPremium(t *testing.T) {
	f := newPrepaidFixture(t, 150_000)
	f.payIntoHold(t, 200_000)
	key := "prepaid-" + uuid.NewString()
	if _, err := f.svc.BindFromQuotePrepaid(context.Background(), f.user, f.quote(t, 150_000), 200_000, key); err != nil {
		t.Fatalf("bind: %v", err)
	}
	if typ, amt := f.leg(t, key+":excess:debit"); typ != string(ledger.AccountProviderClearing) || amt != 50_000 {
		t.Fatalf("excess leg = %s %d, want clearing 50000", typ, amt)
	}
	if typ, amt := f.leg(t, key+":excess:credit"); typ != string(ledger.AccountPaymaxRevenue) || amt != 50_000 {
		t.Fatalf("excess credit = %s %d, want revenue 50000", typ, amt)
	}
}

func TestPrepaidBind_FailureRefundsWhatTheCustomerPaid(t *testing.T) {
	f := newPrepaidFixture(t, 250_000)
	f.uw.bindErr = errors.New("provider rejected")
	f.payIntoHold(t, 200_000)
	before := f.wallet(t)
	key := "prepaid-" + uuid.NewString()

	p, err := f.svc.BindFromQuotePrepaid(context.Background(), f.user, f.quote(t, 250_000), 200_000, key)
	if err == nil {
		t.Fatal("want a bind error")
	}
	if p == nil || p.State != StateVoid {
		t.Fatalf("policy %+v, want VOID", p)
	}
	if got := f.wallet(t); got != before+200_000 {
		t.Fatalf("refund: wallet %d, want %d (the 200000 paid, not the 250000 quote)", got, before+200_000)
	}
	if typ, _ := f.leg(t, key+":absorb:debit"); typ != "" {
		t.Fatal("a failed bind must post no gap")
	}
}

func TestPrepaidBind_ReplayMovesNoMoreMoney(t *testing.T) {
	f := newPrepaidFixture(t, 250_000)
	f.payIntoHold(t, 200_000)
	key := "prepaid-" + uuid.NewString()
	q := f.quote(t, 250_000)
	first, err := f.svc.BindFromQuotePrepaid(context.Background(), f.user, q, 200_000, key)
	if err != nil {
		t.Fatal(err)
	}
	again, err := f.svc.BindFromQuotePrepaid(context.Background(), f.user, q, 200_000, key)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if again.ID != first.ID || f.uw.binds != 1 {
		t.Fatalf("replay returned %s (want %s), provider binds %d (want 1)", again.ID, first.ID, f.uw.binds)
	}
	var n int
	_ = f.pool.QueryRow(context.Background(), `SELECT count(*) FROM ledger_entries WHERE idempotency_key LIKE $1`, key+"%").Scan(&n)
	if n != 4 { // premium debit/credit + absorb debit/credit
		t.Fatalf("%d ledger entries under the key, want 4", n)
	}
}

func TestPrepaidBind_RejectsNonPositivePaid(t *testing.T) {
	svc := NewService(Deps{})
	for _, paid := range []int64{0, -1} {
		if _, err := svc.BindFromQuotePrepaid(context.Background(), "u", "q", paid, "k"); err == nil {
			t.Fatalf("paid %d must be refused", paid)
		}
	}
}
