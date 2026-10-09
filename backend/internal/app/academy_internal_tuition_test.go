package app_test

// LIVE-DB integration test for the internal, service-authenticated academy
// tuition confirm endpoint (AUD-FE-003 residual). It drives the same wiring
// RegisterAcademy mounts — RequireServiceToken + Handler.ConfirmPaymentInternal
// — against a real Postgres + the real finance ledger.Service, proving:
//   (1) Missing / wrong / unconfigured service token is rejected BEFORE the
//       money path runs (fail-closed, constant-time compare).
//   (2) The payer is resolved FROM the payment row (no user JWT exists in a
//       webhook/recover context), the provider charge is re-verified, the
//       amount must cover the instalment, and the balanced journal posts.
//   (3) The derived idempotency key (academy-tuition-confirm:{paymentId}:{ref},
//       identical to the Next.js member route's) makes a replay a no-op.
//   (4) Provider under-collection fails closed — the row stays pending.
// SKIPPED whenever TEST_DATABASE_URL is unset — the SAME gate the other
// finance live-DB tests use. Point it at a disposable, migrated Postgres —
// NEVER production.
//	export TEST_DATABASE_URL="postgres://postgres:postgres@localhost:54322/postgres"
//	cd backend && go test ./internal/app/... -run AcademyInternal -v

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/academy/tuition"
	financeledger "spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/middleware"
	providerInterfaces "spotlight/backend/internal/provider"
	"spotlight/backend/internal/testsupport"
)

const academyTestServiceToken = "test-academy-service-token-abc123"

func academyTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping academy internal tuition live-DB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	return pool
}

func seedAcademyAuthUser(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	uid := uuid.NewString()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO auth.users (id, email) VALUES ($1,$2)`, uid, "il-acad-"+uid+"@test.local"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	testsupport.CleanupUser(t, pool, uid)
	return uid
}

// stubPaymentProvider returns a canned VerifyPayment result — the provider is
// the ONE external dependency in the confirm path, everything else is real.
type stubPaymentProvider struct {
	verify *providerInterfaces.PaymentStatus
	err    error
}

func (s stubPaymentProvider) InitializePayment(context.Context, providerInterfaces.InitializePaymentRequest) (*providerInterfaces.InitializePaymentResponse, error) {
	panic("unused")
}
func (s stubPaymentProvider) VerifyPayment(context.Context, string) (*providerInterfaces.PaymentStatus, error) {
	return s.verify, s.err
}
func (s stubPaymentProvider) InitiatePayout(context.Context, providerInterfaces.PayoutRequest) (*providerInterfaces.PayoutResponse, error) {
	panic("unused")
}
func (s stubPaymentProvider) VerifyWebhookSignature([]byte, string) bool { return true }
func (s stubPaymentProvider) Name() string                               { return "stub" }

// academySeed is the fixture chain ConfirmPaymentInternal walks: auth.users →
// user_profiles → academy_batches → academy_applications → installment plan →
// pending payment. Deleting the batch cascades the whole chain.
type academySeed struct {
	userID    string
	appID     string
	planID    string
	paymentID string
	amountNGN int64
}

func seedAcademyInstallment(t *testing.T, pool *pgxpool.Pool, amountNGN int64) academySeed {
	t.Helper()
	ctx := context.Background()
	uid := seedAcademyAuthUser(t, pool) // handle_new_user trigger creates user_profiles

	batchID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.academy_batches (id, batch_name, start_date, training_schedule) VALUES ($1,$2,CURRENT_DATE,'weekdays')`,
		batchID, "test-batch-"+batchID); err != nil {
		t.Fatalf("seed batch: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.WithoutCancel(t.Context()),
			`DELETE FROM public.academy_batches WHERE id=$1`, batchID); err != nil {
			t.Errorf("cleanup batch: %v", err)
		}
	})

	appID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.academy_applications (id, batch_id, user_id, full_name, email, phone, talent_category, tuition_total_ngn, payment_preference)
		 VALUES ($1,$2,$3,$4,$5,$6,'acting',$7,'installment')`,
		appID, batchID, uid, "Academy Test User", "acad-"+uid+"@test.local", "0800000000", amountNGN); err != nil {
		t.Fatalf("seed application: %v", err)
	}

	planID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.academy_installment_plans (id, application_id, batch_id, total_amount_ngn, installments_count, frequency)
		 VALUES ($1,$2,$3,$4,1,'monthly')`,
		planID, appID, batchID, amountNGN); err != nil {
		t.Fatalf("seed plan: %v", err)
	}

	paymentID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO public.academy_installment_payments (id, plan_id, installment_number, amount_ngn, due_date)
		 VALUES ($1,$2,1,$3,CURRENT_DATE)`,
		paymentID, planID, amountNGN); err != nil {
		t.Fatalf("seed payment: %v", err)
	}

	return academySeed{userID: uid, appID: appID, planID: planID, paymentID: paymentID, amountNGN: amountNGN}
}

// newInternalTuitionRouter reproduces the exact mount RegisterAcademy performs
// when FEATURE_INTERNAL_ACADEMY_API_ENABLED is on.
func newInternalTuitionRouter(pool *pgxpool.Pool, token string, prov providerInterfaces.PaymentProvider) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(gin.Recovery())
	svc := tuition.NewService(
		tuition.NewRepository(pool),
		financeledger.NewService(financeledger.NewRepository(pool), nil),
		prov, nil, nil,
	)
	h := tuition.NewHandler(svc)
	internal := r.Group("/internal/finance/academy/tuition")
	internal.Use(middleware.RequireServiceToken(token))
	internal.POST("/confirm", h.ConfirmPaymentInternal)
	return r
}

func postInternalConfirm(t *testing.T, r *gin.Engine, token string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	req := httptest.NewRequestWithContext(t.Context(),
		http.MethodPost, "/internal/finance/academy/tuition/confirm", bytes.NewReader(buf))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestAcademyInternalTuition_ServiceTokenGuard_Integration(t *testing.T) {
	pool := academyTestPool(t)
	t.Cleanup(pool.Close)
	prov := stubPaymentProvider{verify: &providerInterfaces.PaymentStatus{
		Status: "success", AmountKobo: 150_000, Currency: "NGN",
	}}

	body := map[string]any{
		"planId":    uuid.NewString(),
		"paymentId": uuid.NewString(),
		"reference": "ref-guard-" + uuid.NewString(),
	}

	// Missing token → 401; wrong token → 401.
	r := newInternalTuitionRouter(pool, academyTestServiceToken, prov)
	if w := postInternalConfirm(t, r, "", body); w.Code != http.StatusUnauthorized {
		t.Fatalf("missing token: status=%d, want 401", w.Code)
	}
	if w := postInternalConfirm(t, r, "wrong", body); w.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token: status=%d, want 401", w.Code)
	}

	// Unconfigured token → 503 fail-closed (never silently accepts).
	rNoToken := newInternalTuitionRouter(pool, "", prov)
	if w := postInternalConfirm(t, rNoToken, academyTestServiceToken, body); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("empty configured token: status=%d, want 503", w.Code)
	}

	// Correct token reaches the handler → binding rejects the bad UUIDs (400).
	if w := postInternalConfirm(t, r, academyTestServiceToken, map[string]any{
		"planId": "x", "paymentId": "y", "reference": "z",
	}); w.Code == http.StatusUnauthorized {
		t.Fatalf("valid token rejected: status=%d", w.Code)
	}
}

func TestAcademyInternalTuition_ConfirmResolvesPayer_Integration(t *testing.T) {
	pool := academyTestPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	seed := seedAcademyInstallment(t, pool, 1_500) // ₦1,500.00
	reference := "acad-ref-" + uuid.NewString()

	prov := stubPaymentProvider{verify: &providerInterfaces.PaymentStatus{
		Reference: reference, Status: "success",
		AmountKobo: seed.amountNGN * 100, Currency: "NGN",
	}}
	r := newInternalTuitionRouter(pool, academyTestServiceToken, prov)

	// No Idempotency-Key → the handler derives academy-tuition-confirm:{id}:{ref},
	// identical to the member route — a client retry collapses onto this call.
	w := postInternalConfirm(t, r, academyTestServiceToken, map[string]any{
		"planId":    seed.planID,
		"paymentId": seed.paymentID,
		"reference": reference,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("confirm: status=%d body=%s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			ApplicationID string `json:"applicationId"`
			AmountPaidNGN int64  `json:"amountPaidNgn"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Data.ApplicationID != seed.appID {
		t.Fatalf("applicationId = %q, want %q (payer/plan resolved from the payment row)", resp.Data.ApplicationID, seed.appID)
	}

	var status, payRef string
	if err := pool.QueryRow(ctx,
		`SELECT status, payment_reference FROM public.academy_installment_payments WHERE id=$1`,
		seed.paymentID).Scan(&status, &payRef); err != nil {
		t.Fatalf("refetch payment: %v", err)
	}
	if status != "paid" || payRef != reference {
		t.Fatalf("payment row = status %q ref %q, want paid/%q", status, payRef, reference)
	}

	// Replay the same derived key: already-paid guard → idempotent no-op 200,
	// no second journal (the plan is completed, nothing re-posts).
	w = postInternalConfirm(t, r, academyTestServiceToken, map[string]any{
		"planId":    seed.planID,
		"paymentId": seed.paymentID,
		"reference": reference,
	})
	if w.Code != http.StatusOK {
		t.Fatalf("replay: status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestAcademyInternalTuition_UnderpaymentFailsClosed_Integration(t *testing.T) {
	pool := academyTestPool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	seed := seedAcademyInstallment(t, pool, 1_500)
	reference := "acad-under-" + uuid.NewString()

	// Provider reports 1 kobo under the instalment amount.
	prov := stubPaymentProvider{verify: &providerInterfaces.PaymentStatus{
		Reference: reference, Status: "success",
		AmountKobo: seed.amountNGN*100 - 1, Currency: "NGN",
	}}
	r := newInternalTuitionRouter(pool, academyTestServiceToken, prov)

	w := postInternalConfirm(t, r, academyTestServiceToken, map[string]any{
		"planId":    seed.planID,
		"paymentId": seed.paymentID,
		"reference": reference,
	})
	if w.Code == http.StatusOK {
		t.Fatalf("underpayment confirmed: status=%d body=%s", w.Code, w.Body.String())
	}

	var status string
	if err := pool.QueryRow(ctx,
		`SELECT status FROM public.academy_installment_payments WHERE id=$1`,
		seed.paymentID).Scan(&status); err != nil {
		t.Fatalf("refetch payment: %v", err)
	}
	if status != "pending" {
		t.Fatalf("payment status = %q, want pending (underpayment must not settle)", status)
	}
}
