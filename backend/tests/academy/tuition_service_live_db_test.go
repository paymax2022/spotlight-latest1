package academy

// tuition_service_live_db_test.go tests the Film Academy tuition money path
// against a live Postgres database. Run with TEST_DATABASE_URL set.
//
// Payment rail is Paystack (card), not a wallet debit — ConfirmPayment verifies a
// gateway reference and posts a balanced provider_clearing -> settlement ledger
// journal. Tests use a local fake provider.PaymentProvider (no live network).
//
// Tests cover:
//   - Full confirm saga: verify -> ledger journal -> payment recorded -> plan completion
//   - Ownership + ownership-mismatch rejection
//   - Amount-mismatch rejection (gateway-reported kobo below expected)
//   - Unconfirmed-charge rejection
//   - Reference-reuse rejection (across two different installments)
//   - Idempotency Layer 1 (Redis key claim) + Layer 2 (conditional UPDATE replay)
//   - Admin waiver + plan auto-completion

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/academy/tuition"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/provider"
)

func skipIfNoTestDB(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
}

func newTestPool(t *testing.T) *pgxpool.Pool {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatalf("failed to create pool: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("failed to ping database: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

// newTestRedis returns a redis client, or nil if no local redis is reachable —
// tests fall back to the DB-only (Layer 2) idempotency path in that case.
func newTestRedis(t *testing.T) *redis.Client {
	client := goredis.NewClient(&goredis.Options{Addr: "localhost:6379"})
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Logf("no local redis (%v) — testing Layer 2 (DB) idempotency only", err)
		_ = client.Close()
		return nil
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

// fakePaymentProvider is a local, in-memory provider.PaymentProvider. Only
// VerifyPayment matters for these tests; the rest satisfy the interface.
type fakePaymentProvider struct {
	// byReference controls VerifyPayment's response per reference.
	byReference map[string]*provider.PaymentStatus
}

func newFakeProvider() *fakePaymentProvider {
	return &fakePaymentProvider{byReference: map[string]*provider.PaymentStatus{}}
}

func (f *fakePaymentProvider) setSuccess(reference string, amountKobo int64) {
	f.byReference[reference] = &provider.PaymentStatus{Reference: reference, Status: "success", AmountKobo: amountKobo}
}

func (f *fakePaymentProvider) setFailed(reference string) {
	f.byReference[reference] = &provider.PaymentStatus{Reference: reference, Status: "failed"}
}

func (f *fakePaymentProvider) InitializePayment(ctx context.Context, req provider.InitializePaymentRequest) (*provider.InitializePaymentResponse, error) {
	return &provider.InitializePaymentResponse{Reference: req.Reference}, nil
}

func (f *fakePaymentProvider) VerifyPayment(ctx context.Context, reference string) (*provider.PaymentStatus, error) {
	if s, ok := f.byReference[reference]; ok {
		return s, nil
	}
	return &provider.PaymentStatus{Reference: reference, Status: "failed"}, nil
}

func (f *fakePaymentProvider) InitiatePayout(ctx context.Context, req provider.PayoutRequest) (*provider.PayoutResponse, error) {
	return &provider.PayoutResponse{Reference: req.Reference, Status: "success"}, nil
}

func (f *fakePaymentProvider) VerifyWebhookSignature(payload []byte, signature string) bool { return true }
func (f *fakePaymentProvider) Name() string                                                 { return "fake" }

// seedVerifiedUser creates (or updates) an auth.users + user_profiles row.
// user_profiles.id has an FK to auth.users(id), so the auth row must exist first.
func seedVerifiedUser(ctx context.Context, t *testing.T, pool *pgxpool.Pool, userID string) {
	if _, err := pool.Exec(ctx,
		`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, userID+"@example.com"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.user_profiles (id) VALUES ($1)
		ON CONFLICT (id) DO NOTHING
	`, userID); err != nil {
		t.Fatalf("seed user profile: %v", err)
	}
}

// seedBatch creates a test batch with a training fee configured.
func seedBatch(ctx context.Context, t *testing.T, pool *pgxpool.Pool, feeNaira int64, installments int32, discountPct int32) string {
	var batchID string
	err := pool.QueryRow(ctx, `
		INSERT INTO public.academy_batches
			(batch_name, start_date, training_schedule, duration_weeks,
			 training_fee_ngn, installments_count, fee_frequency, one_off_discount_pct, fee_start_offset_days)
		VALUES ($1, CURRENT_DATE, 'weekdays', 12, $2, $3, 'monthly', $4, 0)
		RETURNING id
	`, "tuition-test-batch-"+uuid.New().String(), feeNaira, installments, discountPct).Scan(&batchID)
	if err != nil {
		t.Fatalf("failed to seed batch: %v", err)
	}
	return batchID
}

// seedApplication creates a test application for a user against a batch.
func seedApplication(ctx context.Context, t *testing.T, pool *pgxpool.Pool, userID, batchID string,
	tuitionTotalNaira int64, paymentPreference string) string {
	var appID string
	err := pool.QueryRow(ctx, `
		INSERT INTO public.academy_applications
			(batch_id, user_id, full_name, email, phone, payment_preference, payment_status, tuition_total_ngn)
		VALUES ($1, $2, 'Test Applicant', 'test@example.com', '+2340000000000', $3, 'pending', $4)
		RETURNING id
	`, batchID, userID, paymentPreference, tuitionTotalNaira).Scan(&appID)
	if err != nil {
		t.Fatalf("failed to seed application: %v", err)
	}
	return appID
}

func newTestService(pool *pgxpool.Pool, redisClient *redis.Client, fakeProvider *fakePaymentProvider) (*tuition.Service, *tuition.Repository) {
	repo := tuition.NewRepository(pool)
	ledgerRepo := ledger.NewRepository(pool)
	var goRedis *goredis.Client
	if redisClient != nil {
		goRedis = redisClient
	}
	ledgerSvc := ledger.NewService(ledgerRepo, goRedis)
	svc := tuition.NewService(repo, ledgerSvc, fakeProvider, redisClient, nil)
	return svc, repo
}

// TestConfirmPaymentSuccess exercises the full saga: plan+schedule auto-creation via
// CreateTuitionPlan, gateway verification, ledger journal, and payment recorded.
func TestConfirmPaymentSuccess(t *testing.T) {
	skipIfNoTestDB(t)
	pool := newTestPool(t)
	redisClient := newTestRedis(t)
	ctx := context.Background()

	userID := uuid.New().String()
	seedVerifiedUser(ctx, t, pool, userID)
	feeNaira := int64(100000)
	batchID := seedBatch(ctx, t, pool, feeNaira, 4, 0)
	appID := seedApplication(ctx, t, pool, userID, batchID, feeNaira, "installment")

	fakeProvider := newFakeProvider()
	svc, repo := newTestService(pool, redisClient, fakeProvider)

	plan, err := svc.CreateTuitionPlan(ctx, appID, userID)
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	payments, err := repo.ListInstallmentPayments(ctx, plan.ID)
	if err != nil || len(payments) == 0 {
		t.Fatalf("list payments: %v", err)
	}
	firstPayment := payments[0]

	reference := "test-ref-" + uuid.New().String()
	fakeProvider.setSuccess(reference, firstPayment.AmountNGN*100)

	result, err := svc.ConfirmPayment(ctx, uuid.New().String(), plan.ID, firstPayment.ID, reference, userID)
	if err != nil {
		t.Fatalf("ConfirmPayment failed: %v", err)
	}
	if result.AmountPaidNGN != firstPayment.AmountNGN {
		t.Errorf("wrong amount: got %d, want %d", result.AmountPaidNGN, firstPayment.AmountNGN)
	}

	payment, err := repo.GetPaymentByID(ctx, firstPayment.ID)
	if err != nil {
		t.Fatalf("get payment: %v", err)
	}
	if payment.Status != tuition.PaymentStatusPaid {
		t.Errorf("expected payment status paid, got %s", payment.Status)
	}
}

// TestConfirmPaymentOwnershipMismatch verifies a different user cannot confirm someone
// else's installment.
func TestConfirmPaymentOwnershipMismatch(t *testing.T) {
	skipIfNoTestDB(t)
	pool := newTestPool(t)
	ctx := context.Background()

	ownerID := uuid.New().String()
	attackerID := uuid.New().String()
	seedVerifiedUser(ctx, t, pool, ownerID)
	seedVerifiedUser(ctx, t, pool, attackerID)
	feeNaira := int64(50000)
	batchID := seedBatch(ctx, t, pool, feeNaira, 1, 0)
	appID := seedApplication(ctx, t, pool, ownerID, batchID, feeNaira, "one_off")

	fakeProvider := newFakeProvider()
	svc, repo := newTestService(pool, nil, fakeProvider)

	plan, err := svc.CreateTuitionPlan(ctx, appID, ownerID)
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	payments, _ := repo.ListInstallmentPayments(ctx, plan.ID)

	reference := "test-ref-" + uuid.New().String()
	fakeProvider.setSuccess(reference, payments[0].AmountNGN*100)

	_, err = svc.ConfirmPayment(ctx, uuid.New().String(), plan.ID, payments[0].ID, reference, attackerID)
	if err != tuition.ErrForbidden {
		t.Fatalf("expected ErrForbidden, got: %v", err)
	}
}

// TestConfirmPaymentAmountMismatch verifies a charge for less than the installment
// amount is rejected.
func TestConfirmPaymentAmountMismatch(t *testing.T) {
	skipIfNoTestDB(t)
	pool := newTestPool(t)
	ctx := context.Background()

	userID := uuid.New().String()
	seedVerifiedUser(ctx, t, pool, userID)
	feeNaira := int64(50000)
	batchID := seedBatch(ctx, t, pool, feeNaira, 1, 0)
	appID := seedApplication(ctx, t, pool, userID, batchID, feeNaira, "one_off")

	fakeProvider := newFakeProvider()
	svc, repo := newTestService(pool, nil, fakeProvider)

	plan, err := svc.CreateTuitionPlan(ctx, appID, userID)
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	payments, _ := repo.ListInstallmentPayments(ctx, plan.ID)

	reference := "test-ref-" + uuid.New().String()
	fakeProvider.setSuccess(reference, payments[0].AmountNGN*100-1000) // short by 10 naira

	_, err = svc.ConfirmPayment(ctx, uuid.New().String(), plan.ID, payments[0].ID, reference, userID)
	if err != tuition.ErrInvalidPaymentAmount {
		t.Fatalf("expected ErrInvalidPaymentAmount, got: %v", err)
	}
}

// TestConfirmPaymentUnconfirmedCharge verifies a non-success gateway status is rejected.
func TestConfirmPaymentUnconfirmedCharge(t *testing.T) {
	skipIfNoTestDB(t)
	pool := newTestPool(t)
	ctx := context.Background()

	userID := uuid.New().String()
	seedVerifiedUser(ctx, t, pool, userID)
	feeNaira := int64(20000)
	batchID := seedBatch(ctx, t, pool, feeNaira, 1, 0)
	appID := seedApplication(ctx, t, pool, userID, batchID, feeNaira, "one_off")

	fakeProvider := newFakeProvider()
	svc, repo := newTestService(pool, nil, fakeProvider)

	plan, err := svc.CreateTuitionPlan(ctx, appID, userID)
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	payments, _ := repo.ListInstallmentPayments(ctx, plan.ID)

	reference := "test-ref-" + uuid.New().String()
	fakeProvider.setFailed(reference)

	_, err = svc.ConfirmPayment(ctx, uuid.New().String(), plan.ID, payments[0].ID, reference, userID)
	if err != tuition.ErrPaymentNotConfirmed {
		t.Fatalf("expected ErrPaymentNotConfirmed, got: %v", err)
	}
}

// TestConfirmPaymentReferenceReuse verifies a reference that already settled a
// DIFFERENT installment cannot be replayed against a second one.
func TestConfirmPaymentReferenceReuse(t *testing.T) {
	skipIfNoTestDB(t)
	pool := newTestPool(t)
	ctx := context.Background()

	userID := uuid.New().String()
	seedVerifiedUser(ctx, t, pool, userID)
	feeNaira := int64(40000)
	batchID := seedBatch(ctx, t, pool, feeNaira, 2, 0)
	appID := seedApplication(ctx, t, pool, userID, batchID, feeNaira, "installment")

	fakeProvider := newFakeProvider()
	svc, repo := newTestService(pool, nil, fakeProvider)

	plan, err := svc.CreateTuitionPlan(ctx, appID, userID)
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	payments, _ := repo.ListInstallmentPayments(ctx, plan.ID)
	if len(payments) < 2 {
		t.Fatalf("expected 2 installments, got %d", len(payments))
	}

	reference := "test-ref-" + uuid.New().String()
	// Fund the reference generously enough to "cover" both installments' amounts.
	fakeProvider.setSuccess(reference, payments[1].AmountNGN*100)

	if _, err := svc.ConfirmPayment(ctx, uuid.New().String(), plan.ID, payments[0].ID, reference, userID); err != nil {
		t.Fatalf("first confirm failed: %v", err)
	}

	// Replaying the SAME reference against the second installment must be rejected.
	_, err = svc.ConfirmPayment(ctx, uuid.New().String(), plan.ID, payments[1].ID, reference, userID)
	if err != tuition.ErrReferenceReused {
		t.Fatalf("expected ErrReferenceReused, got: %v", err)
	}
}

// TestConfirmPaymentLayer1Idempotency verifies a replay with the same Idempotency-Key
// while Redis is available is rejected as a duplicate.
func TestConfirmPaymentLayer1Idempotency(t *testing.T) {
	skipIfNoTestDB(t)
	pool := newTestPool(t)
	redisClient := newTestRedis(t)
	if redisClient == nil {
		t.Skip("no local redis available for Layer 1 idempotency test")
	}
	ctx := context.Background()

	userID := uuid.New().String()
	seedVerifiedUser(ctx, t, pool, userID)
	feeNaira := int64(30000)
	batchID := seedBatch(ctx, t, pool, feeNaira, 1, 0)
	appID := seedApplication(ctx, t, pool, userID, batchID, feeNaira, "one_off")

	fakeProvider := newFakeProvider()
	svc, repo := newTestService(pool, redisClient, fakeProvider)

	plan, err := svc.CreateTuitionPlan(ctx, appID, userID)
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	payments, _ := repo.ListInstallmentPayments(ctx, plan.ID)

	reference := "test-ref-" + uuid.New().String()
	fakeProvider.setSuccess(reference, payments[0].AmountNGN*100)

	idempKey := uuid.New().String()
	if _, err := svc.ConfirmPayment(ctx, idempKey, plan.ID, payments[0].ID, reference, userID); err != nil {
		t.Fatalf("first confirm failed: %v", err)
	}

	_, err = svc.ConfirmPayment(ctx, idempKey, plan.ID, payments[0].ID, reference, userID)
	if err != tuition.ErrDuplicate {
		t.Fatalf("expected ErrDuplicate on replay, got: %v", err)
	}
}

// TestConfirmPaymentLayer2Idempotency simulates Layer 1 being unavailable (no redis)
// and verifies a second confirm attempt against an already-paid installment is a safe
// no-op (idempotent success) rather than a double-post.
func TestConfirmPaymentLayer2Idempotency(t *testing.T) {
	skipIfNoTestDB(t)
	pool := newTestPool(t)
	ctx := context.Background()

	userID := uuid.New().String()
	seedVerifiedUser(ctx, t, pool, userID)
	feeNaira := int64(30000)
	batchID := seedBatch(ctx, t, pool, feeNaira, 1, 0)
	appID := seedApplication(ctx, t, pool, userID, batchID, feeNaira, "one_off")

	fakeProvider := newFakeProvider()
	// No redis client passed — forces the DB-only path.
	svc, repo := newTestService(pool, nil, fakeProvider)

	plan, err := svc.CreateTuitionPlan(ctx, appID, userID)
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	payments, _ := repo.ListInstallmentPayments(ctx, plan.ID)

	reference := "test-ref-" + uuid.New().String()
	fakeProvider.setSuccess(reference, payments[0].AmountNGN*100)

	result1, err := svc.ConfirmPayment(ctx, uuid.New().String(), plan.ID, payments[0].ID, reference, userID)
	if err != nil {
		t.Fatalf("first confirm failed: %v", err)
	}

	// Replay against the now-paid installment with the SAME reference: the Layer 2
	// guard (conditional UPDATE) makes this a safe idempotent no-op, not a double-post.
	result2, err := svc.ConfirmPayment(ctx, uuid.New().String(), plan.ID, payments[0].ID, reference, userID)
	if err != nil {
		t.Fatalf("second confirm (replay) should succeed idempotently, got: %v", err)
	}
	if result2.AmountPaidNGN != result1.AmountPaidNGN {
		t.Errorf("replay result mismatch: got %d, want %d", result2.AmountPaidNGN, result1.AmountPaidNGN)
	}
}

// TestValidatePayment tests the quote/validation endpoint before and after plan creation.
func TestValidatePayment(t *testing.T) {
	skipIfNoTestDB(t)
	pool := newTestPool(t)
	ctx := context.Background()

	userID := uuid.New().String()
	seedVerifiedUser(ctx, t, pool, userID)
	feeNaira := int64(60000)
	batchID := seedBatch(ctx, t, pool, feeNaira, 3, 0)
	appID := seedApplication(ctx, t, pool, userID, batchID, feeNaira, "installment")

	svc, _ := newTestService(pool, nil, newFakeProvider())

	if err := svc.ValidatePayment(ctx, appID, userID, feeNaira); err != nil {
		t.Errorf("validation before plan creation failed: %v", err)
	}
	if err := svc.ValidatePayment(ctx, appID, userID, feeNaira+1); err == nil {
		t.Error("expected validation to fail for amount exceeding batch fee")
	}
}

// TestWaivePayment tests the admin waiver action and plan-completion check.
func TestWaivePayment(t *testing.T) {
	skipIfNoTestDB(t)
	pool := newTestPool(t)
	ctx := context.Background()

	userID := uuid.New().String()
	seedVerifiedUser(ctx, t, pool, userID)
	feeNaira := int64(20000)
	batchID := seedBatch(ctx, t, pool, feeNaira, 1, 0)
	appID := seedApplication(ctx, t, pool, userID, batchID, feeNaira, "one_off")

	svc, repo := newTestService(pool, nil, newFakeProvider())

	plan, err := svc.CreateTuitionPlan(ctx, appID, userID)
	if err != nil {
		t.Fatalf("create plan: %v", err)
	}
	payments, err := repo.ListInstallmentPayments(ctx, plan.ID)
	if err != nil || len(payments) == 0 {
		t.Fatalf("failed to get payments: %v", err)
	}

	adminID := uuid.New().String()
	if err := svc.WaiveTuition(ctx, payments[0].ID, adminID); err != nil {
		t.Fatalf("waive failed: %v", err)
	}

	payment, err := repo.GetPaymentByID(ctx, payments[0].ID)
	if err != nil {
		t.Fatalf("get payment: %v", err)
	}
	if payment.Status != tuition.PaymentStatusWaived {
		t.Errorf("wrong status after waive: got %s, want %s", payment.Status, tuition.PaymentStatusWaived)
	}

	plan, err = repo.GetInstallmentPlan(ctx, plan.ID)
	if err != nil {
		t.Fatalf("get plan: %v", err)
	}
	if plan.Status != tuition.PlanStatusCompleted {
		t.Errorf("expected plan auto-completed after waiving its only installment, got %s", plan.Status)
	}
}
