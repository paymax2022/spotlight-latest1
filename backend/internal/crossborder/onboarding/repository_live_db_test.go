package onboarding

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/platform/crypto"
)

func newRepoTest(t *testing.T) (*Repository, *pgxpool.Pool, string) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set — skipping live-DB onboarding repository test")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	t.Cleanup(pool.Close)

	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	c, err := crypto.NewCipherFromBase64Key(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}

	userID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email, created_at) VALUES ($1,$2,NOW())`,
		userID, userID+"@onboarding-repo.invalid"); err != nil {
		t.Fatalf("seed auth.users: %v", err)
	}
	t.Cleanup(func() {
		// provider_accounts (and children) cascade from auth.users.
		_, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM auth.users WHERE id=$1`, userID)
	})
	return NewRepository(pool, c), pool, userID
}

func TestRepo_AccountLifecycle(t *testing.T) {
	repo, _, userID := newRepoTest(t)
	ctx := context.Background()
	companyID := "co-" + uuid.NewString()

	acct, err := repo.CreateAccount(ctx, &GlobalAccount{
		UserID: userID, Provider: "vertofx", SubjectType: SubjectIndividual,
		ProviderCompanyID: companyID, Status: StatusSubmitted,
	}, "idem-"+userID, 2)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if acct.ID == "" || acct.Status != StatusSubmitted {
		t.Fatalf("unexpected account %+v", acct)
	}

	// Idempotent: same key returns the same row.
	again, err := repo.CreateAccount(ctx, &GlobalAccount{
		UserID: userID, Provider: "vertofx", SubjectType: SubjectIndividual,
		ProviderCompanyID: "other", Status: StatusSubmitted,
	}, "idem-"+userID, 2)
	if err != nil || again.ID != acct.ID {
		t.Fatalf("idempotent create: %+v err=%v", again, err)
	}

	byUser, err := repo.GetAccountByUser(ctx, userID, "vertofx")
	if err != nil || byUser == nil || byUser.ID != acct.ID {
		t.Fatalf("by user: %+v %v", byUser, err)
	}
	byCo, err := repo.GetAccountByCompanyID(ctx, "vertofx", companyID)
	if err != nil || byCo == nil || byCo.ID != acct.ID {
		t.Fatalf("by company: %+v %v", byCo, err)
	}
	if none, err := repo.GetAccountByCompanyID(ctx, "vertofx", "nope"); err != nil || none != nil {
		t.Fatalf("expected nil,nil got %+v %v", none, err)
	}

	// Compare-and-set: a stale `from` is rejected.
	if err := repo.UpdateStatus(ctx, acct.ID, StatusSubmitted, StatusInReview, StatusUpdate{}); err != nil {
		t.Fatalf("transition: %v", err)
	}
	err = repo.UpdateStatus(ctx, acct.ID, StatusSubmitted, StatusInReview, StatusUpdate{})
	if !errors.Is(err, ErrStaleStatus) {
		t.Fatalf("stale from must yield ErrStaleStatus, got %v", err)
	}
	// Illegal transition rejected before touching the DB.
	if err := repo.UpdateStatus(ctx, acct.ID, StatusInReview, StatusNotStarted, StatusUpdate{}); err == nil {
		t.Fatal("illegal transition must error")
	}
	now := time.Now().UTC()
	if err := repo.UpdateStatus(ctx, acct.ID, StatusInReview, StatusRejected,
		StatusUpdate{RejectionReason: "bad doc", SubmittedAt: &now}); err != nil {
		t.Fatalf("reject: %v", err)
	}
	got, _ := repo.GetAccountByUser(ctx, userID, "vertofx")
	if got == nil || got.Status != StatusRejected || got.RejectionReason != "bad doc" || got.SubmittedAt == nil {
		t.Fatalf("after reject: %+v", got)
	}
}

func TestRepo_WalletFundingSubmissionConsent(t *testing.T) {
	repo, pool, userID := newRepoTest(t)
	ctx := context.Background()
	acct, err := repo.CreateAccount(ctx, &GlobalAccount{
		UserID: userID, Provider: "vertofx", SubjectType: SubjectBusiness,
		ProviderCompanyID: "co-" + uuid.NewString(), Status: StatusActive,
	}, "idem-w-"+userID, 3)
	if err != nil {
		t.Fatal(err)
	}

	w1, err := repo.UpsertWallet(ctx, &ProviderWallet{AccountID: acct.ID, Currency: "USD", ProviderWalletID: "w-1"})
	if err != nil {
		t.Fatalf("wallet: %v", err)
	}
	w2, err := repo.UpsertWallet(ctx, &ProviderWallet{AccountID: acct.ID, Currency: "USD", ProviderWalletID: "w-1"})
	if err != nil || w2.ID != w1.ID {
		t.Fatalf("wallet upsert must be idempotent: %+v %v", w2, err)
	}

	fd := &FundingDetail{WalletID: w1.ID, Currency: "USD", AccountName: "Acme", AccountNumber: "1234567890",
		BankName: "Bank", BankCode: "B1", Reference: "ref"}
	if _, err := repo.UpsertFundingDetail(ctx, fd); err != nil {
		t.Fatalf("funding: %v", err)
	}
	fd.BankName = "Bank2"
	if _, err := repo.UpsertFundingDetail(ctx, fd); err != nil {
		t.Fatalf("funding upsert: %v", err)
	}
	list, err := repo.ListFundingDetails(ctx, w1.ID)
	if err != nil || len(list) != 1 || list[0].AccountNumber != "1234567890" || list[0].BankName != "Bank2" {
		t.Fatalf("funding list: %+v %v", list, err)
	}
	// Ciphertext at rest: the plaintext must not be stored.
	var enc string
	if err := pool.QueryRow(ctx, `SELECT account_number_enc FROM funding_details WHERE wallet_id=$1`, w1.ID).Scan(&enc); err != nil {
		t.Fatal(err)
	}
	if enc == "" || enc == "1234567890" {
		t.Fatalf("account number not encrypted: %q", enc)
	}

	if err := repo.RecordSubmission(ctx, acct.ID, 1, "ref://payload", []byte(`{"docs":[]}`), "accepted"); err != nil {
		t.Fatalf("submission: %v", err)
	}
	if err := repo.RecordConsent(ctx, &Consent{AccountID: acct.ID, Document: "tnc", Version: "v1",
		AcceptedAt: time.Now().UTC(), IP: "203.0.113.1", Device: "ios"}); err != nil {
		t.Fatalf("consent: %v", err)
	}
	// Consent log is append-only.
	if _, err := pool.Exec(ctx, `UPDATE onboarding_consents SET ip='x' WHERE provider_account_id=$1`, acct.ID); err == nil {
		t.Fatal("consent update must be rejected (append-only)")
	}
}

func TestRepo_PriorStatusSurvivesAndCompanyConflict(t *testing.T) {
	repo, pool, userID := newRepoTest(t)
	ctx := context.Background()
	companyID := "co-" + uuid.NewString()
	acct, err := repo.CreateAccount(ctx, &GlobalAccount{
		UserID: userID, Provider: "vertofx", SubjectType: SubjectIndividual,
		ProviderCompanyID: companyID, Status: StatusActive,
	}, "idem-p-"+userID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateStatus(ctx, acct.ID, StatusActive, StatusSuspended, StatusUpdate{PriorStatus: StatusActive}); err != nil {
		t.Fatalf("suspend: %v", err)
	}
	// A later transition that does not pass PriorStatus must not erase it.
	if err := repo.UpdateStatus(ctx, acct.ID, StatusSuspended, StatusActive, StatusUpdate{}); err != nil {
		t.Fatalf("reinstate: %v", err)
	}
	got, _ := repo.GetAccountByUser(ctx, userID, "vertofx")
	if got == nil || got.PriorStatus != StatusActive {
		t.Fatalf("prior_status clobbered: %+v", got)
	}

	// Same company id under a different user -> explicit conflict, never (nil, nil).
	other := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id, email, created_at) VALUES ($1,$2,NOW())`,
		other, other+"@onboarding-repo.invalid"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(context.WithoutCancel(ctx), `DELETE FROM auth.users WHERE id=$1`, other) })
	res, err := repo.CreateAccount(ctx, &GlobalAccount{
		UserID: other, Provider: "vertofx", SubjectType: SubjectIndividual,
		ProviderCompanyID: companyID, Status: StatusSubmitted,
	}, "idem-o-"+other, 2)
	if !errors.Is(err, ErrAccountConflict) || res != nil {
		t.Fatalf("want ErrAccountConflict, got %+v %v", res, err)
	}
}
