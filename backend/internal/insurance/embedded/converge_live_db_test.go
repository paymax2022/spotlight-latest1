package embedded

// LIVE-DB convergence tests for the embedded-bind saga — the money path itself:
// a replayed source_event_id must converge to ONE debit and ONE provider
// purchase, and a crashed saga must RESUME rather than claim ACTIVE while the
// premium sits parked in provider_clearing. Skipped unless TEST_DATABASE_URL
// is set. The provider side is a fake adapter behind the real gateway.Router;
// everything from the wallet down (debit, premium tx, bind registry, policy
// FSM) is the real Postgres-backed code.

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/insurance/gateway"
	"spotlight/backend/internal/insurance/policy"
	"spotlight/backend/internal/testsupport"
)

// fakeGateway is a scripted UnderwriterGateway — the saga must not need real
// provider credentials to prove its own convergence.
type fakeGateway struct {
	quote       gateway.Quote
	bound       gateway.Policy
	bindErr     error
	bindCalls   int
	lastBindReq gateway.BindRequest
}

func (f *fakeGateway) Name() string { return "fakegw" }

func (f *fakeGateway) GetQuote(_ context.Context, _ gateway.QuoteRequest) (gateway.Quote, error) {
	return f.quote, nil
}

func (f *fakeGateway) BindPolicy(_ context.Context, req gateway.BindRequest) (gateway.Policy, error) {
	f.bindCalls++
	f.lastBindReq = req
	if f.bindErr != nil {
		return gateway.Policy{}, f.bindErr
	}
	return f.bound, nil
}

func (f *fakeGateway) GetPolicy(_ context.Context, ref string) (gateway.Policy, error) {
	p := f.bound
	p.ProviderPolicyRef = ref
	return p, nil
}

func (f *fakeGateway) CancelPolicy(ctx context.Context, ref, _ string) (gateway.Policy, error) {
	return f.GetPolicy(ctx, ref)
}

func (f *fakeGateway) SubmitClaim(_ context.Context, _ gateway.ClaimRequest) (gateway.Claim, error) {
	return gateway.Claim{}, nil
}

func (f *fakeGateway) GetClaim(_ context.Context, _ string) (gateway.Claim, error) {
	return gateway.Claim{}, nil
}

func (f *fakeGateway) UploadEvidence(_ context.Context, _ gateway.EvidenceUpload) error {
	return nil
}

func (f *fakeGateway) VerifyWebhook(_ context.Context, _ []byte, _ string) (gateway.WebhookEvent, error) {
	return gateway.WebhookEvent{SignatureValid: true}, nil
}

func (f *fakeGateway) WebhookSignatureHeader() string { return "" }

// fakeResolver maps every product code to the fake adapter. failCode, when
// non-nil and non-empty, is the ONE code that fails resolution — used to drive
// the unresolvable-product convergence paths.
type fakeResolver struct {
	product  gateway.ProviderProduct
	failCode *string
}

func (f fakeResolver) ResolveProduct(_ context.Context, code string) (string, gateway.ProviderProduct, bool) {
	if f.failCode != nil && *f.failCode != "" && code == *f.failCode {
		return "", gateway.ProviderProduct{}, false
	}
	return "fakegw", f.product, true
}

func livePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB embedded-saga test")
	}
	pool, err := pgxpool.New(t.Context(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(t.Context()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

type liveSaga struct {
	svc      *Service
	gw       *fakeGateway
	led      *ledger.Service
	wal      *wallet.Service
	repo     *policy.Repository
	clearing *ledger.Account
	// failCode is shared with the saga's resolver — set *failCode to a product
	// code to make ResolveProduct fail for it (unresolvable-product tests).
	failCode *string
}

func newLiveSaga(t *testing.T, pool *pgxpool.Pool) *liveSaga {
	t.Helper()
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	wal := wallet.NewService(led, tiers.NewService(pool))
	gw := &fakeGateway{
		quote: gateway.Quote{ProviderQuoteRef: "q-" + uuid.NewString(), PremiumKobo: 25_000, Currency: "NGN"},
		bound: gateway.Policy{ProviderPolicyRef: "prov-" + uuid.NewString(), PremiumKobo: 25_000, Currency: "NGN"},
	}
	failCode := ""
	router := gateway.NewRouter(fakeResolver{product: gateway.ProviderProduct{Code: "fake-prod"}, failCode: &failCode}, gw)
	polRepo := policy.NewRepository(pool)
	clearing, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		t.Fatalf("clearing account: %v", err)
	}
	svc := NewService(Deps{
		Repo:       NewRepository(pool),
		PolicyRepo: polRepo,
		Router:     router,
		Wallet:     wal,
		Ledger:     led,
		Binds:      policy.NewBindRegistry(pool),
	})
	return &liveSaga{svc: svc, gw: gw, led: led, wal: wal, repo: polRepo, clearing: clearing, failCode: &failCode}
}

// seedFundedUser creates a synthetic user with an unlimited KYC tier and a
// funded wallet.
func seedFundedUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, led *ledger.Service, fundKobo int64) string {
	t.Helper()
	u := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, u)
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email, kyc_tier) VALUES ($1,$2,3)
		 ON CONFLICT (id) DO UPDATE SET kyc_tier = 3`, u, u+"@seed.test"); err != nil {
		t.Fatalf("seed kyc tier: %v", err)
	}
	if fundKobo > 0 {
		clearing, err := led.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
		if err != nil {
			t.Fatalf("clearing: %v", err)
		}
		if err := led.Credit(ctx, u, "seed-fund", "seedfund-"+uuid.NewString(), clearing.ID, fundKobo); err != nil {
			t.Fatalf("fund wallet: %v", err)
		}
	}
	return u
}

func seedProduct(t *testing.T, ctx context.Context, pool *pgxpool.Pool, code, line string) {
	t.Helper()
	// updated_at nudged forward so ResolveCoverByLine's newest-active ordering
	// always picks THIS row over any pre-seeded embedded product for the line.
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.insurance_products
			(code, display_name, product_line, provider, provider_product_code,
			 binding_mode, underwriter_display, active, updated_at)
		VALUES ($1,'Embedded Saga Test',$2,'fakegw','fake-prod','embedded','Test UW',true, now()+interval '1 hour')
		ON CONFLICT (code) DO UPDATE SET
			product_line = EXCLUDED.product_line, provider = EXCLUDED.provider,
			binding_mode = 'embedded', active = true, updated_at = EXCLUDED.updated_at`,
		code, line); err != nil {
		t.Fatalf("seed product: %v", err)
	}
	t.Cleanup(func() {
		// Detached ctx — t.Context() is already cancelled inside Cleanup.
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM public.insurance_products WHERE code=$1`, code)
	})
}

// walletDebitCount counts the DEBIT legs this user's wallet carries under the
// derived premium key — the proof a replay never double-debits.
func walletDebitCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID, premiumKey string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM ledger_entries le
		JOIN ledger_accounts la ON la.id = le.account_id
		WHERE la.user_id = $1 AND le.type = 'DEBIT' AND le.idempotency_key = $2`,
		userID, premiumKey+":debit").Scan(&n); err != nil {
		t.Fatalf("count premium debit legs: %v", err)
	}
	return n
}

func policyState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, policyID string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(ctx, `SELECT state FROM public.insurance_policy WHERE id=$1`, policyID).Scan(&st); err != nil {
		t.Fatalf("read policy state: %v", err)
	}
	return st
}

// The headline invariant: bind once, replay → same policy, ONE debit pair,
// ONE provider purchase.
func TestLiveDB_EmbeddedBindReplayConverges(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	s := newLiveSaga(t, pool)

	u := seedFundedUser(t, ctx, pool, s.led, 1_000_000)
	seedProduct(t, ctx, pool, "emb.test.converge", "transport")

	src := "ev-converge-" + uuid.NewString()
	ev := EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: u}

	res, err := s.svc.Handle(ctx, ev)
	if err != nil {
		t.Fatalf("first handle: %v", err)
	}
	if res.State != StateActive || res.PolicyID == "" {
		t.Fatalf("expected ACTIVE bind, got %+v", res)
	}
	if s.gw.bindCalls != 1 {
		t.Fatalf("expected 1 provider purchase, got %d", s.gw.bindCalls)
	}

	// Replay the same event — must be a no-op, not a second bind.
	res2, err := s.svc.Handle(ctx, ev)
	if err != nil {
		t.Fatalf("replay handle: %v", err)
	}
	if !res2.Replayed || res2.PolicyID != res.PolicyID || res2.State != StateActive {
		t.Fatalf("expected replayed ACTIVE on same policy, got %+v", res2)
	}
	if s.gw.bindCalls != 1 {
		t.Fatalf("replay bought a second policy (bind calls=%d)", s.gw.bindCalls)
	}
	if n := walletDebitCount(t, ctx, pool, u, "embedded:"+src+":premium"); n != 1 {
		t.Fatalf("expected exactly 1 premium debit leg, got %d", n)
	}
}

// A policy parked in PENDING_PAYMENT (premium already held, crash before bind)
// must RESUME to ACTIVE on the retry — never falsely report ACTIVE beforehand,
// never debit a second time.
func TestLiveDB_EmbeddedResumeFromPendingPayment(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	s := newLiveSaga(t, pool)

	u := seedFundedUser(t, ctx, pool, s.led, 1_000_000)
	seedProduct(t, ctx, pool, "emb.test.resume", "transport")

	src := "ev-resume-" + uuid.NewString()

	// Simulate the crash state: debit already posted under the derived key,
	// policy row sitting in PENDING_PAYMENT, no premium-tx record.
	premiumKey := "embedded:" + src + ":premium"
	if err := s.wal.Debit(ctx, u, "insurance:embedded_premium:"+src, premiumKey, s.clearing.ID, 25_000); err != nil {
		t.Fatalf("seed held premium: %v", err)
	}
	var policyID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.insurance_policy
			(policyholder_user_id, product_code, provider, underwriter, binding_mode,
			 state, sum_insured_kobo, premium_amount_kobo, currency, source_event_id)
		VALUES ($1,'emb.test.resume','fakegw','Test UW','embedded','PENDING_PAYMENT',1_000_000,25000,'NGN',$2)
		RETURNING id`, u, src).Scan(&policyID); err != nil {
		t.Fatalf("seed pending policy: %v", err)
	}

	res, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: u})
	if err != nil {
		t.Fatalf("resume handle: %v", err)
	}
	if res.State != StateActive || res.PolicyID != policyID {
		t.Fatalf("expected resume to ACTIVE on the same row, got %+v", res)
	}
	if s.gw.bindCalls != 1 {
		t.Fatalf("expected exactly 1 bind on resume, got %d", s.gw.bindCalls)
	}
	if got := policyState(t, ctx, pool, policyID); got != "ACTIVE" {
		t.Fatalf("policy state = %s, want ACTIVE", got)
	}
	if n := walletDebitCount(t, ctx, pool, u, premiumKey); n != 1 {
		t.Fatalf("resume double-debited: %d premium debit legs", n)
	}
}

// Same convergence for a policy parked mid-bind (BINDING state): the claim
// registry claims fresh and the bind runs once.
func TestLiveDB_EmbeddedResumeFromBinding(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	s := newLiveSaga(t, pool)

	u := seedFundedUser(t, ctx, pool, s.led, 1_000_000)
	seedProduct(t, ctx, pool, "emb.test.binding", "transport")

	src := "ev-binding-" + uuid.NewString()
	premiumKey := "embedded:" + src + ":premium"
	if err := s.wal.Debit(ctx, u, "insurance:embedded_premium:"+src, premiumKey, s.clearing.ID, 25_000); err != nil {
		t.Fatalf("seed held premium: %v", err)
	}
	var policyID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.insurance_policy
			(policyholder_user_id, product_code, provider, underwriter, binding_mode,
			 state, sum_insured_kobo, premium_amount_kobo, currency, source_event_id)
		VALUES ($1,'emb.test.binding','fakegw','Test UW','embedded','BINDING',1_000_000,25000,'NGN',$2)
		RETURNING id`, u, src).Scan(&policyID); err != nil {
		t.Fatalf("seed binding policy: %v", err)
	}

	res, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: u})
	if err != nil {
		t.Fatalf("resume-from-binding handle: %v", err)
	}
	if res.State != StateActive || res.PolicyID != policyID {
		t.Fatalf("expected ACTIVE on resume, got %+v", res)
	}
	if s.gw.bindCalls != 1 {
		t.Fatalf("expected 1 bind, got %d", s.gw.bindCalls)
	}
}

// Cross-user anchor probing must refuse: an event id another policyholder
// already claimed is a conflict, and the second user's wallet is untouched.
func TestLiveDB_EmbeddedForeignEventRefused(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	s := newLiveSaga(t, pool)

	a := seedFundedUser(t, ctx, pool, s.led, 1_000_000)
	b := seedFundedUser(t, ctx, pool, s.led, 1_000_000)
	seedProduct(t, ctx, pool, "emb.test.foreign", "transport")

	src := "ev-foreign-" + uuid.NewString()
	if _, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: a}); err != nil {
		t.Fatalf("user A bind: %v", err)
	}

	_, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: b})
	if !errors.Is(err, ErrSourceEventConflict) {
		t.Fatalf("foreign source_event_id err = %v, want ErrSourceEventConflict", err)
	}
	if n := walletDebitCount(t, ctx, pool, b, "embedded:"+src+":premium"); n != 0 {
		t.Fatalf("foreign user's wallet was debited: %d legs", n)
	}
	if s.gw.bindCalls != 1 {
		t.Fatalf("foreign trigger caused a second bind (calls=%d)", s.gw.bindCalls)
	}
}

// Insufficient funds voids the policy (no parked premium, no fake cover) and a
// replay stays UNCOVERED — no silent second attempt.
func TestLiveDB_EmbeddedInsufficientFundsVoids(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	s := newLiveSaga(t, pool)

	u := seedFundedUser(t, ctx, pool, s.led, 0) // empty wallet
	seedProduct(t, ctx, pool, "emb.test.broke", "transport")

	src := "ev-broke-" + uuid.NewString()
	res, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: u})
	if err != nil {
		t.Fatalf("insufficient-funds handle: %v", err)
	}
	if res.State != StateInsufficientFunds {
		t.Fatalf("expected INSUFFICIENT_FUNDS, got %+v", res)
	}
	if got := policyState(t, ctx, pool, res.PolicyID); got != "VOID" {
		t.Fatalf("failed-payment policy state = %s, want VOID", got)
	}
	if n := walletDebitCount(t, ctx, pool, u, "embedded:"+src+":premium"); n != 0 {
		t.Fatalf("debit legs posted on an unfundable wallet: %d", n)
	}
	if s.gw.bindCalls != 0 {
		t.Fatalf("bind attempted without premium (calls=%d)", s.gw.bindCalls)
	}

	// Replay converges to the same terminal outcome.
	res2, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: u})
	if err != nil {
		t.Fatalf("replay of voided event: %v", err)
	}
	if !res2.Replayed || res2.State != StateUncovered {
		t.Fatalf("expected UNCOVERED replay, got %+v", res2)
	}
}

// The replay-with-depleted-wallet interleave: the first attempt's premium
// debit COMMITTED and the policy row crashed in PENDING_PAYMENT; before the
// retry landed, the member spent the rest of the wallet. The replayed
// wallet.Debit therefore returns ErrInsufficientFunds — but the premium leg
// is durably posted, so the saga must read the ledger of record, treat the
// leg as paid, and converge to ACTIVE. Voiding here is the audited defect:
// it strands captured premium in provider_clearing forever.
func TestLiveDB_EmbeddedReplayWithDepletedWallet(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	s := newLiveSaga(t, pool)

	u := seedFundedUser(t, ctx, pool, s.led, 25_000) // exactly the premium
	seedProduct(t, ctx, pool, "emb.test.depleted", "transport")

	src := "ev-depleted-" + uuid.NewString()
	premiumKey := "embedded:" + src + ":premium"

	// First attempt: premium debited into provider_clearing, then the crash —
	// the row is left in PENDING_PAYMENT with no premium-tx record.
	if err := s.wal.Debit(ctx, u, "insurance:embedded_premium:"+src, premiumKey, s.clearing.ID, 25_000); err != nil {
		t.Fatalf("seed held premium: %v", err)
	}
	var policyID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.insurance_policy
			(policyholder_user_id, product_code, provider, underwriter, binding_mode,
			 state, sum_insured_kobo, premium_amount_kobo, currency, source_event_id)
		VALUES ($1,'emb.test.depleted','fakegw','Test UW','embedded','PENDING_PAYMENT',1_000_000,25000,'NGN',$2)
		RETURNING id`, u, src).Scan(&policyID); err != nil {
		t.Fatalf("seed pending policy: %v", err)
	}
	// The wallet is now empty — a naive replayed Debit returns
	// ErrInsufficientFunds even though the premium is already captured.

	res, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: u})
	if err != nil {
		t.Fatalf("depleted-wallet replay: %v", err)
	}
	if res.State != StateActive || res.PolicyID != policyID {
		t.Fatalf("expected depleted-wallet replay to converge ACTIVE, got %+v", res)
	}
	if got := policyState(t, ctx, pool, policyID); got != "ACTIVE" {
		t.Fatalf("policy state = %s, want ACTIVE — a captured premium must never be voided", got)
	}
	if n := walletDebitCount(t, ctx, pool, u, premiumKey); n != 1 {
		t.Fatalf("expected exactly 1 premium debit leg, got %d", n)
	}
	if s.gw.bindCalls != 1 {
		t.Fatalf("expected 1 provider purchase on resume, got %d", s.gw.bindCalls)
	}
}

// A PENDING_PAYMENT row whose product can never resolve must reverse the held
// premium and exit PENDING_PAYMENT→PAYMENT_FAILED→VOID — never wedge on the
// illegal PENDING_PAYMENT→VOID jump the old release path attempted (D3).
func TestLiveDB_EmbeddedUnresolvablePendingPaymentVoids(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	s := newLiveSaga(t, pool)

	u := seedFundedUser(t, ctx, pool, s.led, 25_000)
	src := "ev-gonepend-" + uuid.NewString()
	premiumKey := "embedded:" + src + ":premium"
	if err := s.wal.Debit(ctx, u, "insurance:embedded_premium:"+src, premiumKey, s.clearing.ID, 25_000); err != nil {
		t.Fatalf("seed held premium: %v", err)
	}
	var policyID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.insurance_policy
			(policyholder_user_id, product_code, provider, underwriter, binding_mode,
			 state, sum_insured_kobo, premium_amount_kobo, currency, source_event_id)
		VALUES ($1,'emb.test.gone','fakegw','Test UW','embedded','PENDING_PAYMENT',1_000_000,25000,'NGN',$2)
		RETURNING id`, u, src).Scan(&policyID); err != nil {
		t.Fatalf("seed pending policy: %v", err)
	}
	*s.failCode = "emb.test.gone" // resume's router.Resolve now fails

	res, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: u})
	if err != nil {
		t.Fatalf("unresolvable resume: %v", err)
	}
	if res.State != StateUncovered {
		t.Fatalf("expected UNCOVERED for an unresolvable product, got %+v", res)
	}
	if got := policyState(t, ctx, pool, policyID); got != "VOID" {
		t.Fatalf("policy state = %s, want VOID via PAYMENT_FAILED", got)
	}
	// The held premium must be back with the member — the reversal pair is
	// durable under the derived key.
	walAcc, err := s.led.GetOrCreateUserWallet(ctx, u)
	if err != nil {
		t.Fatalf("wallet account: %v", err)
	}
	if _, ok, err := s.led.EntryAmount(ctx, walAcc.ID, "embedded:"+src+":reversal:rev_debit"); err != nil || !ok {
		t.Fatalf("premium reversal missing/not durable (ok=%v err=%v)", ok, err)
	}
	if bal, err := s.led.GetBalance(ctx, u); err != nil || bal != 25_000 {
		t.Fatalf("wallet balance after release = %d, want 25000 restored (err=%v)", bal, err)
	}

	// Idempotent: a second replay must converge, not wedge or double-reverse.
	res2, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: u})
	if err != nil {
		t.Fatalf("replay of voided unresolvable: %v", err)
	}
	if !res2.Replayed || res2.State != StateUncovered {
		t.Fatalf("expected UNCOVERED replay, got %+v", res2)
	}
	if bal, err := s.led.GetBalance(ctx, u); err != nil || bal != 25_000 {
		t.Fatalf("wallet balance after replay = %d, want 25000 (err=%v)", bal, err)
	}
}

// A QUOTED row whose product can never resolve must exit through QUOTED→EXPIRED
// — QUOTED has no VOID exit in the lifecycle FSM, so the old code wedged
// retrying an illegal transition forever (D3).
func TestLiveDB_EmbeddedUnresolvableQuotedExpires(t *testing.T) {
	pool := livePool(t)
	ctx := t.Context()
	s := newLiveSaga(t, pool)

	u := seedFundedUser(t, ctx, pool, s.led, 0)
	src := "ev-gonequoted-" + uuid.NewString()
	var policyID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.insurance_policy
			(policyholder_user_id, product_code, provider, underwriter, binding_mode,
			 state, sum_insured_kobo, premium_amount_kobo, currency, source_event_id)
		VALUES ($1,'emb.test.gone','fakegw','Test UW','embedded','QUOTED',1_000_000,25000,'NGN',$2)
		RETURNING id`, u, src).Scan(&policyID); err != nil {
		t.Fatalf("seed quoted policy: %v", err)
	}
	*s.failCode = "emb.test.gone"

	res, err := s.svc.Handle(ctx, EmbeddedEvent{SourceEventID: src, EventType: "trip.started", UserID: u})
	if err != nil {
		t.Fatalf("unresolvable quoted resume: %v", err)
	}
	if res.State != StateUncovered {
		t.Fatalf("expected UNCOVERED for an unresolvable QUOTED row, got %+v", res)
	}
	if got := policyState(t, ctx, pool, policyID); got != "EXPIRED" {
		t.Fatalf("policy state = %s, want EXPIRED (QUOTED's only legal terminal)", got)
	}
	if s.gw.bindCalls != 0 {
		t.Fatalf("bind attempted for an unresolvable product (calls=%d)", s.gw.bindCalls)
	}
}
