package restaurant

// LIVE-DB integration test for FOOD-ADMIN-KYB-001. AdminListApplications read only
// `restaurants`, so the onboarding queue could never show the KYB the merchant
// actually submitted: legal name, business type, CAC number, settlement bank and
// the bank-verification result all live on `restaurant_kyb`, and the owner's name
// and email on `user_profiles`. The console rendered those panel rows against
// fixture data the server never sent, so a reviewer approved or rejected an outlet
// without ever seeing the identity and payout details on file. Skipped unless
// TEST_DATABASE_URL is set.

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	goredis "github.com/redis/go-redis/v9"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/settlement"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/testsupport"
)

func apSeedOwner(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
		owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	// DO UPDATE, not DO NOTHING: a trigger on auth.users already created this
	// profile row with full_name '', so an insert that merely skips on conflict
	// leaves the owner nameless and the assertion measures the fixture instead of
	// the projection.
	if _, err := pool.Exec(ctx,
		`INSERT INTO user_profiles (id, email, full_name, phone) VALUES ($1,$2,$3,$4)
		 ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, full_name=EXCLUDED.full_name, phone=EXCLUDED.phone`,
		owner, owner+"@profile.test", "Ada Okafor", "08000000000"); err != nil {
		t.Fatalf("seed profile: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM user_profiles WHERE id=$1`, owner)
	})
	return owner
}

// apSeedRestaurant creates an outlet with the given restaurants.kyb_status
// snapshot. SubmitKYB/SaveKYB move that snapshot alongside the `restaurant_kyb`
// row (kyb.go), and FOOD-010 derives the queue's Status from it, so a fixture that
// filed a KYB without it would be describing a state the app cannot produce.
func apSeedRestaurant(t *testing.T, ctx context.Context, pool *pgxpool.Pool, owner, name string, kybStatus *string) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurants (id, owner_id, name, address, is_open, kyb_status) VALUES ($1,$2,$3,'1 St',FALSE,$4)`,
		id, owner, name, kybStatus); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM restaurant_kyb WHERE restaurant_id=$1`, id)
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM restaurants WHERE id=$1`, id)
	})
	return id
}

func apAppFor(t *testing.T, svc *Service, ctx context.Context, id string) AdminApplication {
	t.Helper()
	apps, err := svc.AdminListApplications(ctx, "")
	if err != nil {
		t.Fatalf("AdminListApplications: %v", err)
	}
	for _, a := range apps {
		if a.ID == id {
			return a
		}
	}
	t.Fatalf("restaurant %s missing from the admin queue", id)
	return AdminApplication{}
}

func apStr(t *testing.T, label string, p *string) string {
	t.Helper()
	if p == nil {
		t.Fatalf("%s = nil, want a value", label)
	}
	return *p
}

// apWithinTime compares instants either way round: a one-sided difference would
// pass for a timestamp that is badly EARLIER than the stored one.
func apWithinTime(got, want time.Time) bool {
	diff := got.Sub(want)
	if diff < 0 {
		diff = -diff
	}
	return diff <= 2*time.Second
}

// A submitted KYB is the reviewer's only view of the merchant's identity and
// payout details, so every field the console's review panel renders has to come
// off the real rows.
func TestLiveDB_AdminListApplications_ProjectsSubmittedKYBAndOwner(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := apSeedOwner(t, ctx, pool)
	restID := apSeedRestaurant(t, ctx, pool, owner, "Projects Kitchen", new("submitted"))

	// A code the bank lookup can resolve, without assuming which seed rows exist.
	var bankCode, bankName string
	if err := pool.QueryRow(ctx, `SELECT code, name FROM payment_banks WHERE active ORDER BY code LIMIT 1`).Scan(&bankCode, &bankName); err != nil {
		t.Fatalf("seed bank lookup: %v", err)
	}

	submittedAt := time.Now().Add(-3 * time.Hour).UTC().Truncate(time.Second)
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurant_kyb (restaurant_id, legal_name, business_type, rc_number,
			contact_phone, contact_email, bank_code, account_number, account_name,
			status, decision_reason, submitted_at, bank_account_verified, bank_account_verified_at)
		 VALUES ($1,'Projects Kitchen Ltd','sole_proprietor','','09091112222','projects@example.test',
			$2,'1234567890','PROJECTS KITCHEN LTD','submitted','',$3,TRUE,$3)`,
		restID, bankCode, submittedAt); err != nil {
		t.Fatalf("seed kyb: %v", err)
	}

	a := apAppFor(t, svc, ctx, restID)

	if got := apStr(t, "owner_name", a.OwnerName); got != "Ada Okafor" {
		t.Errorf("owner_name = %q, want %q", got, "Ada Okafor")
	}
	// The KYB contact details are the ones the merchant nominated for this
	// application, so they win over the account's own phone/email.
	if got := apStr(t, "phone", a.Phone); got != "09091112222" {
		t.Errorf("phone = %q, want the KYB contact_phone", got)
	}
	if got := apStr(t, "email", a.Email); got != "projects@example.test" {
		t.Errorf("email = %q, want the KYB contact_email", got)
	}
	if got := apStr(t, "legal_name", a.LegalName); got != "Projects Kitchen Ltd" {
		t.Errorf("legal_name = %q, want %q", got, "Projects Kitchen Ltd")
	}
	if got := apStr(t, "business_type", a.BusinessType); got != "sole_proprietor" {
		t.Errorf("business_type = %q, want %q", got, "sole_proprietor")
	}
	if a.CACNumber != nil {
		t.Errorf("cac_number = %q, want nil — a sole proprietor is not asked for one, and an empty string renders as the red 'missing' flag", *a.CACNumber)
	}
	if got := apStr(t, "bank_name", a.BankName); got != bankName {
		t.Errorf("bank_name = %q, want the payment_banks name %q for code %s", got, bankName, bankCode)
	}
	if got := apStr(t, "bank_account_number", a.BankAccountNumber); got != "1234567890" {
		t.Errorf("bank_account_number = %q, want %q", got, "1234567890")
	}
	if got := apStr(t, "bank_account_name", a.BankAccountName); got != "PROJECTS KITCHEN LTD" {
		t.Errorf("bank_account_name = %q, want %q", got, "PROJECTS KITCHEN LTD")
	}
	if a.BankAccountVerified == nil || !*a.BankAccountVerified {
		t.Errorf("bank_account_verified = %v, want true", a.BankAccountVerified)
	}
	if a.BankAccountVerifiedAt == nil {
		t.Error("bank_account_verified_at = nil, want the stored timestamp")
	}
	if a.BankAccountVerificationError != nil {
		t.Errorf("bank_account_verification_error = %q, want nil on a clean match", *a.BankAccountVerificationError)
	}
	// submitted_at is the application date the queue sorts and ages on; before this
	// it was restaurants.created_at (when the storefront was made), not the KYB
	// submission.
	if !apWithinTime(a.SubmittedAt, submittedAt) {
		t.Errorf("submitted_at = %s, want the KYB submitted_at %s", a.SubmittedAt.Format(time.RFC3339), submittedAt.Format(time.RFC3339))
	}
	if a.ReviewNote != nil {
		t.Errorf("review_note = %q, want nil when no reviewer has written one", *a.ReviewNote)
	}

	// A registered business IS asked for its CAC number, and it is the item the
	// reviewer checks against the certificate.
	regID := apSeedRestaurant(t, ctx, pool, owner, "Registered Kitchen", new("under_review"))
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurant_kyb (restaurant_id, legal_name, business_type, rc_number, status)
		 VALUES ($1,'Registered Kitchen Ltd','limited_company','RC-1234567','under_review')`,
		regID); err != nil {
		t.Fatalf("seed registered kyb: %v", err)
	}
	reg := apAppFor(t, svc, ctx, regID)
	if got := apStr(t, "cac_number", reg.CACNumber); got != "RC-1234567" {
		t.Errorf("cac_number = %q, want %q", got, "RC-1234567")
	}
	if reg.BankName != nil {
		t.Errorf("bank_name = %q, want nil when no bank was chosen", *reg.BankName)
	}
	if reg.SubmittedAt.IsZero() {
		t.Error("submitted_at is zero for a KYB row that never submitted")
	}
}

// An outlet with no KYB row at all is the common case for a brand-new restaurant.
// It must stay visibly un-submitted rather than being projected as empty strings,
// and its queue date still has to come from somewhere.
func TestLiveDB_AdminListApplications_NoKYBRowLeavesFieldsUnset(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := apSeedOwner(t, ctx, pool)
	restID := apSeedRestaurant(t, ctx, pool, owner, "No KYB Kitchen", nil)

	a := apAppFor(t, svc, ctx, restID)
	for label, p := range map[string]*string{
		"legal_name": a.LegalName, "business_type": a.BusinessType, "cac_number": a.CACNumber,
		"bank_name": a.BankName, "bank_account_number": a.BankAccountNumber,
		"bank_account_name": a.BankAccountName, "review_note": a.ReviewNote,
	} {
		if p != nil {
			t.Errorf("%s = %q, want nil — no KYB row exists, so there is nothing to show", label, *p)
		}
	}
	if a.KYBStatus != nil {
		t.Errorf("kyb_status = %q, want nil", *a.KYBStatus)
	}
	if a.Status != "pending" {
		t.Errorf("status = %q, want pending", a.Status)
	}
	// The owner's name still resolves: it lives on user_profiles, not the KYB.
	if got := apStr(t, "owner_name", a.OwnerName); got != "Ada Okafor" {
		t.Errorf("owner_name = %q, want %q", got, "Ada Okafor")
	}
	if a.SubmittedAt.IsZero() {
		t.Error("submitted_at is zero — a restaurant with no KYB falls back to its creation date")
	}
	if a.Phone == nil || *a.Phone != "08000000000" {
		t.Errorf("phone = %v, want the profile phone as the fallback", a.Phone)
	}
}

// A bounced application's reason is the only thing telling the reviewer what was
// already wrong; it lives in restaurant_kyb.decision_reason.
func TestLiveDB_AdminListApplications_CarriesReviewerDecision(t *testing.T) {
	pool := processRunPool(t)
	t.Cleanup(pool.Close)
	ctx := t.Context()
	led := ledger.NewService(ledger.NewRepository(pool), (*goredis.Client)(nil))
	svc := NewService(pool, settlement.NewService(pool, led)).WithLedger(led).WithTiers(tiers.NewService(pool))

	owner := apSeedOwner(t, ctx, pool)
	restID := apSeedRestaurant(t, ctx, pool, owner, "Bounced Kitchen", new("under_review"))
	decidedAt := time.Now().Add(-time.Hour).UTC().Truncate(time.Second)
	if _, err := pool.Exec(ctx,
		`INSERT INTO restaurant_kyb (restaurant_id, legal_name, business_type, status, decision_reason, decided_at)
		 VALUES ($1,'Bounced Kitchen Ltd','limited_company','needs_more_info','Upload a current CAC certificate',$2)`,
		restID, decidedAt); err != nil {
		t.Fatalf("seed bounced kyb: %v", err)
	}

	a := apAppFor(t, svc, ctx, restID)
	if got := apStr(t, "review_note", a.ReviewNote); got != "Upload a current CAC certificate" {
		t.Errorf("review_note = %q, want the stored decision_reason", got)
	}
	if a.ReviewedAt == nil || !apWithinTime(*a.ReviewedAt, decidedAt) {
		t.Errorf("reviewed_at = %v, want the stored decided_at %s", a.ReviewedAt, decidedAt.Format(time.RFC3339))
	}
	if a.Status != "in_review" {
		t.Errorf("status = %q, want in_review for needs_more_info", a.Status)
	}
}
