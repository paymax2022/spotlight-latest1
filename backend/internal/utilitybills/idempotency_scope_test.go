package utilitybills

// Tests for the caller-scoped idempotency replay fix (issue #500 class —
// caller-scoped replay + crash windows). PayUtility's pre-check and
// InsertTransaction's 23505 fallback used to look up idempotency_key
// GLOBALLY: a caller reusing a key another member already used got that
// member's transaction — amount, token, customer reference — replayed back as
// "already_processed". The lookup is now scoped to user_id, and a foreign-key
// collision at the unique constraint maps to ErrIdempotencyKeyConflict → 409
// "idempotency_key_conflict", mirroring finance/transfers (the wave-6 M16
// pattern).
//
// The writeErr assertion is pure (gin test context). The repository
// semantics run against the live DB only when TEST_DATABASE_URL is set,
// mirroring admin_category_conflict_test.go's gating.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TestWriteErr_IdempotencyKeyConflictIs409WithCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/finance/utilitybills/pay", nil)

	writeErr(c, fmt.Errorf("service layer: %w", ErrIdempotencyKeyConflict))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"idempotency_key_conflict"`) {
		t.Fatalf("body must carry the stable code idempotency_key_conflict, got %s", rec.Body.String())
	}
}

// TestLiveDB_InsertTransaction_IdempotencyKeyScopedToCaller pins the foreign-
// key semantics end to end at the repository layer:
//   - the caller-scoped lookup returns the OWNER's row only to the owner;
//   - a different member's insert under the same key gets
//     ErrIdempotencyKeyConflict, never the other member's row;
//   - the SAME member's duplicate insert still replays (AlreadyProcessed).
func TestLiveDB_InsertTransaction_IdempotencyKeyScopedToCaller(t *testing.T) {
	ctx := context.Background()
	pool := livePoolUtilitybills(t)
	repo := NewRepository(pool)

	userA := uuid.NewString()
	userB := uuid.NewString()
	billerID := uuid.NewString()
	key := "ub-idem-scope-" + uuid.NewString()

	for _, id := range []string{userA, userB} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO auth.users (id, email, aud, role)
			VALUES ($1, $2, 'authenticated', 'authenticated')
			ON CONFLICT (id) DO NOTHING`, id, "ub-idem-"+id+"@test.local"); err != nil {
			t.Fatalf("seed user %s: %v", id, err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.utility_billers (id, category, name, code)
		VALUES ($1, 'airtime', 'Scope Test Biller', $2)`, billerID, "ub-scope-"+billerID[:8]); err != nil {
		t.Fatalf("seed biller: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_transactions WHERE idempotency_key = $1`, key)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_billers WHERE id = $1`, billerID)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM auth.users WHERE id = ANY($1)`, []string{userA, userB})
	})

	rowFor := func(userID, receipt string) *TransactionRow {
		return &TransactionRow{
			UserID:            userID,
			Category:          "airtime",
			BillerID:          billerID,
			CustomerReference: "08030000000",
			AmountKobo:        100_000,
			RetailAmountKobo:  100_000,
			ProviderCostKobo:  95_000,
			Status:            "initiated",
			ReceiptNumber:     &receipt,
			IdempotencyKey:    key,
			PaymentSource:     "wallet",
		}
	}

	inserted, dup, err := repo.InsertTransaction(ctx, rowFor(userA, "RCP-A-"+key[len(key)-8:]))
	if err != nil {
		t.Fatalf("insert for owner: %v", err)
	}
	if dup {
		t.Fatal("first insert must not be reported as a duplicate")
	}

	// Caller-scoped pre-check: the foreign member sees NOTHING under this key.
	if got, err := repo.GetTransactionByIdempotencyKey(ctx, userB, key); err != nil {
		t.Fatalf("scoped lookup for foreign member: %v", err)
	} else if got != nil {
		t.Fatalf("scoped lookup returned ANOTHER member's transaction %s — the leak is back", got.ID)
	}
	// The owner still finds their own row.
	if got, err := repo.GetTransactionByIdempotencyKey(ctx, userA, key); err != nil {
		t.Fatalf("scoped lookup for owner: %v", err)
	} else if got == nil || got.ID != inserted.ID {
		t.Fatalf("scoped lookup for owner returned %v, want row %s", got, inserted.ID)
	}

	// Foreign member inserting under the same key → 409 sentinel, no row back.
	conflicted, dup, err := repo.InsertTransaction(ctx, rowFor(userB, "RCP-B-"+key[len(key)-8:]))
	if !errors.Is(err, ErrIdempotencyKeyConflict) {
		t.Fatalf("foreign-key insert must return ErrIdempotencyKeyConflict, got row=%v dup=%v err=%v", conflicted, dup, err)
	}
	if conflicted != nil || dup {
		t.Fatalf("a foreign-key conflict must return no row and duplicate=false, got row=%v dup=%v", conflicted, dup)
	}

	// Same member, same key → a genuine replay of their own row.
	again, dup, err := repo.InsertTransaction(ctx, rowFor(userA, "RCP-A-"+key[len(key)-8:]))
	if err != nil {
		t.Fatalf("same-caller duplicate insert: %v", err)
	}
	if !dup || again == nil || again.ID != inserted.ID {
		t.Fatalf("same-caller insert must replay the original row %s, got row=%v dup=%v", inserted.ID, again, dup)
	}
}

// TestLiveDB_InsertTransaction_SameCallerDivergentParamsConflicts pins the
// param-checked adoption fix (post-merge audit D4): the same member replaying
// a USED key against a purchase that differs on any material param — amount,
// product, customer reference, payment rail — is idempotency-key misuse, not
// a replay. Adopting the stored row would ack a purchase the request never
// made (e.g. ₦1,000 returned for a ₦5,000 request), so divergence is
// ErrIdempotencyKeyConflict, the same 409 a cross-member clash gets.
func TestLiveDB_InsertTransaction_SameCallerDivergentParamsConflicts(t *testing.T) {
	ctx := context.Background()
	pool := livePoolUtilitybills(t)
	repo := NewRepository(pool)

	userA := uuid.NewString()
	billerID := uuid.NewString()
	productID := uuid.NewString()
	otherProductID := uuid.NewString()
	key := "ub-idem-params-" + uuid.NewString()

	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, userA, "ub-params-"+userA+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.utility_billers (id, category, name, code)
		VALUES ($1, 'airtime', 'Params Test Biller', $2)`, billerID, "ub-params-"+billerID[:8]); err != nil {
		t.Fatalf("seed biller: %v", err)
	}
	for _, pair := range [][2]string{{productID, "UBP-A"}, {otherProductID, "UBP-B"}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.utility_products (id, biller_id, category, name, code, amount_type)
			VALUES ($1, $2, 'airtime', 'Params Test Product', $3, 'variable')`,
			pair[0], billerID, pair[1]+"-"+pair[0][:8]); err != nil {
			t.Fatalf("seed product: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_transactions WHERE idempotency_key = $1`, key)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_products WHERE id = ANY($1)`, []string{productID, otherProductID})
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_billers WHERE id = $1`, billerID)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM auth.users WHERE id = $1`, userA)
	})

	receipt := "RCP-P-" + key[len(key)-8:]
	base := func() *TransactionRow {
		return &TransactionRow{
			UserID:            userA,
			Category:          "airtime",
			BillerID:          billerID,
			ProductID:         &productID,
			CustomerReference: "08030000000",
			AmountKobo:        100_000,
			RetailAmountKobo:  100_000,
			ProviderCostKobo:  95_000,
			Status:            "initiated",
			ReceiptNumber:     &receipt,
			IdempotencyKey:    key,
			PaymentSource:     "wallet",
		}
	}

	inserted, dup, err := repo.InsertTransaction(ctx, base())
	if err != nil || dup {
		t.Fatalf("first insert: row=%v dup=%v err=%v", inserted, dup, err)
	}

	// Every material-param divergence must conflict — never adopt.
	divergents := map[string]func(*TransactionRow){
		"amount":             func(r *TransactionRow) { r.AmountKobo = 500_000 },
		"retail amount":      func(r *TransactionRow) { r.RetailAmountKobo = 510_000 },
		"product":            func(r *TransactionRow) { r.ProductID = &otherProductID },
		"customer reference": func(r *TransactionRow) { r.CustomerReference = "08039999999" },
		"payment source":     func(r *TransactionRow) { r.PaymentSource = "paystack" },
		"category":           func(r *TransactionRow) { r.Category = "data" },
	}
	for name, mutate := range divergents {
		row := base()
		mutate(row)
		got, dup, err := repo.InsertTransaction(ctx, row)
		if !errors.Is(err, ErrIdempotencyKeyConflict) {
			t.Fatalf("%s-divergent same-caller insert must return ErrIdempotencyKeyConflict, got row=%v dup=%v err=%v", name, got, dup, err)
		}
		if got != nil || dup {
			t.Fatalf("%s-divergent insert must return no row and duplicate=false, got row=%v dup=%v", name, got, dup)
		}
	}

	// Identical params still replay the stored row.
	again, dup, err := repo.InsertTransaction(ctx, base())
	if err != nil || !dup || again == nil || again.ID != inserted.ID {
		t.Fatalf("identical same-caller insert must replay row %s, got row=%v dup=%v err=%v", inserted.ID, again, dup, err)
	}
}

// TestLiveDB_PayUtility_SameCallerDivergentParamsConflicts pins the same
// param check at the SERVICE pre-check (the path a real replay actually
// takes — InsertTransaction's fallback is only the race window). A same-
// caller replay whose request diverges must 409 BEFORE any pricing or
// provider work, so a Repo-only Service suffices.
func TestLiveDB_PayUtility_SameCallerDivergentParamsConflicts(t *testing.T) {
	ctx := context.Background()
	pool := livePoolUtilitybills(t)
	repo := NewRepository(pool)
	svc := NewService(Deps{Repo: repo})

	userA := uuid.NewString()
	billerID := uuid.NewString()
	productID := uuid.NewString()
	otherBillerID := uuid.NewString()
	key := "ub-pay-params-" + uuid.NewString()

	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email, aud, role)
		VALUES ($1, $2, 'authenticated', 'authenticated')
		ON CONFLICT (id) DO NOTHING`, userA, "ub-payparams-"+userA+"@test.local"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	for _, pair := range [][2]string{{billerID, "ub-pay-a"}, {otherBillerID, "ub-pay-b"}} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.utility_billers (id, category, name, code)
			VALUES ($1, 'airtime', 'Params Test Biller', $2)`, pair[0], pair[1]+"-"+pair[0][:8]); err != nil {
			t.Fatalf("seed biller: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.utility_products (id, biller_id, category, name, code, amount_type)
		VALUES ($1, $2, 'airtime', 'Params Test Product', $3, 'variable')`,
		productID, billerID, "UBPP-"+productID[:8]); err != nil {
		t.Fatalf("seed product: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_transactions WHERE idempotency_key = $1`, key)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_products WHERE id = $1`, productID)
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM public.utility_billers WHERE id = ANY($1)`, []string{billerID, otherBillerID})
		_, _ = pool.Exec(context.WithoutCancel(ctx),
			`DELETE FROM auth.users WHERE id = $1`, userA)
	})

	// The stored purchase under this key.
	receipt := "RCP-S-" + key[len(key)-8:]
	amount := int64(100_000)
	if _, dup, err := repo.InsertTransaction(ctx, &TransactionRow{
		UserID:            userA,
		Category:          "airtime",
		BillerID:          billerID,
		ProductID:         &productID,
		CustomerReference: "08030000000",
		AmountKobo:        amount,
		RetailAmountKobo:  amount,
		ProviderCostKobo:  95_000,
		Status:            "initiated",
		ReceiptNumber:     &receipt,
		IdempotencyKey:    key,
		PaymentSource:     "wallet",
	}); err != nil || dup {
		t.Fatalf("seed transaction: dup=%v err=%v", dup, err)
	}

	good := PayInput{
		Category:          "airtime",
		BillerID:          billerID,
		ProductID:         productID,
		CustomerReference: "08030000000",
		AmountKobo:        &amount,
		PaymentSource:     "wallet",
	}
	// Identical request → clean replay (no provider wiring needed — the
	// pre-check returns before any of it).
	res, err := svc.PayUtility(ctx, userA, good, key)
	if err != nil {
		t.Fatalf("identical replay: %v", err)
	}
	if !res.AlreadyProcessed {
		t.Fatal("identical replay must report already_processed")
	}

	// Divergent requests under the used key → 409 sentinel, each BEFORE the
	// resolver would have touched an unwired dependency.
	bigger := int64(500_000)
	for name, in := range map[string]PayInput{
		"different amount":   {Category: "airtime", BillerID: billerID, ProductID: productID, CustomerReference: "08030000000", AmountKobo: &bigger, PaymentSource: "wallet"},
		"different biller":   {Category: "airtime", BillerID: otherBillerID, ProductID: productID, CustomerReference: "08030000000", AmountKobo: &amount, PaymentSource: "wallet"},
		"different meter":    {Category: "airtime", BillerID: billerID, ProductID: productID, CustomerReference: "08039999999", AmountKobo: &amount, PaymentSource: "wallet"},
		"different rail":     {Category: "airtime", BillerID: billerID, ProductID: productID, CustomerReference: "08030000000", AmountKobo: &amount, PaymentSource: "paystack"},
		"different product":  {Category: "airtime", BillerID: billerID, ProductID: uuid.NewString(), CustomerReference: "08030000000", AmountKobo: &amount, PaymentSource: "wallet"},
		"different category": {Category: "data", BillerID: billerID, ProductID: productID, CustomerReference: "08030000000", AmountKobo: &amount, PaymentSource: "wallet"},
	} {
		if _, err := svc.PayUtility(ctx, userA, in, key); !errors.Is(err, ErrIdempotencyKeyConflict) {
			t.Fatalf("%s replay must return ErrIdempotencyKeyConflict, got %v", name, err)
		}
	}
}
