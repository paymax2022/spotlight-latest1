package restaurant

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/testsupport"
)

// FOOD-UAT-A-005/007/008/009/011/014 regression tests.

func testKYBPresigner() *r2.Presigner {
	return r2.New(r2.Config{
		AccountEndpoint: "https://acct.r2.cloudflarestorage.com",
		Bucket:          "kyb-test-bucket",
		AccessKeyID:     "AKIATESTTESTTESTTEST",
		SecretAccessKey: "test-secret-test-secret-test-secret",
	})
}

// stubKYBProbe replaces storage inspection for the test's duration.
func stubKYBProbe(t *testing.T, total int64, head []byte) {
	t.Helper()
	old := kybObjectProbe
	kybObjectProbe = func(context.Context, string) (int64, []byte, error) { return total, head, nil }
	t.Cleanup(func() { kybObjectProbe = old })
}

func TestKYBMagicAndErrCodes(t *testing.T) {
	if !kybMagicMatches("application/pdf", []byte("%PDF-1.4")) || kybMagicMatches("application/pdf", []byte("MZ\x90\x00")) {
		t.Error("pdf magic")
	}
	if !kybMagicMatches("image/jpeg", []byte{0xFF, 0xD8, 0xFF, 0xE0}) || kybMagicMatches("image/jpeg", []byte("GIF89a")) {
		t.Error("jpeg magic")
	}
	if !kybMagicMatches("image/png", []byte("\x89PNG\r\n\x1a\n....")) {
		t.Error("png magic")
	}
	if kybMagicMatches("image/webp", []byte("RIFF....WEBP")) {
		t.Error("webp is not on the allowlist")
	}
	if kybErrCode(ErrKYBFileTooLarge) != http.StatusRequestEntityTooLarge || kybErrCode(ErrKYBUnsupportedType) != http.StatusUnsupportedMediaType {
		t.Error("413/415 mapping")
	}
}

func TestNamesRadicallyDiffer(t *testing.T) {
	cases := []struct {
		store, legal, acct string
		want               bool
	}{
		{"Mama Put Kitchen", "Adeyemi Foods Ltd", "ADEYEMI OLUWASEUN", false},
		{"Mama Put Kitchen", "Adeyemi Foods Ltd", "Chukwu Obi", true},
		{"Mama Put", "", "", false},
		{"Mama Put", "Mama Put Limited", "MAMA PUT LIMITED", false},
	}
	for _, c := range cases {
		if got := namesRadicallyDiffer(c.store, c.legal, c.acct); got != c.want {
			t.Errorf("%+v: got %v", c, got)
		}
	}
}

func TestKYBStatusMapsWithdrawn(t *testing.T) {
	w := string(KYBWithdrawn)
	if kybStatusToApplicationStatus(&w) != "withdrawn" {
		t.Error("withdrawn must not look pending")
	}
	if kybCanTransition(KYBApproved, KYBWithdrawn) || kybCanTransition(KYBRejected, KYBWithdrawn) || kybCanTransition(KYBDraft, KYBWithdrawn) {
		t.Error("only pending states may be withdrawn")
	}
	if kybCanTransition(KYBWithdrawn, KYBApproved) {
		t.Error("reviewer cannot approve a withdrawn application")
	}
}

func TestLiveDB_KYBWave6D(t *testing.T) {
	pool := kybLivePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	stubKYBProbe(t, 1024, []byte("%PDF-1.7"))
	svc := NewService(pool, nil).WithKYBStorage(testKYBPresigner())

	owner, admin := uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'Wave6D Kitchen','1 St',FALSE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM restaurants WHERE id=$1`, restID) })

	// A-005: oversize and wrong type are refused at presign; oversize/forged objects at record time.
	if _, err := svc.PresignKYBDocument(ctx, restID, owner, "cac_certificate", "a.pdf", "application/pdf", kybMaxDocBytes+1); !errors.Is(err, ErrKYBFileTooLarge) {
		t.Errorf("oversize presign: %v", err)
	}
	if _, err := svc.PresignKYBDocument(ctx, restID, owner, "cac_certificate", "a.webp", "image/webp", 10); !errors.Is(err, ErrKYBUnsupportedType) {
		t.Errorf("webp presign: %v", err)
	}
	if _, err := svc.PresignKYBDocument(ctx, restID, owner, "cac_certificate", "a.gif", "image/gif", 10); !errors.Is(err, ErrKYBUnsupportedType) {
		t.Errorf("gif presign: %v", err)
	}
	key := func(n string) string { return kybKeyPrefix(restID) + "cac_certificate/" + n + ".pdf" }
	stubKYBProbe(t, kybMaxDocBytes+1, []byte("%PDF"))
	if err := svc.AddKYBDocument(ctx, restID, owner, "cac_certificate", key("big"), "big.pdf"); !errors.Is(err, ErrKYBFileTooLarge) {
		t.Errorf("oversize object: %v", err)
	}
	stubKYBProbe(t, 100, []byte("MZ\x90\x00"))
	if err := svc.AddKYBDocument(ctx, restID, owner, "cac_certificate", key("fake"), "fake.pdf"); !errors.Is(err, ErrKYBUnsupportedType) {
		t.Errorf("forged content: %v", err)
	}
	stubKYBProbe(t, 100, []byte("%PDF-1.7"))

	// A-007: replacing supersedes, never destroys.
	if _, err := svc.SaveKYB(ctx, restID, owner, KYB{LegalName: "Wave6D Kitchen", BusinessType: "sole_proprietor",
		ContactEmail: "o@w6.ng", ContactPhone: "08011112222", BankCode: "058", AccountNumber: "0123456789", AccountName: "Chukwu Obi"}); err != nil {
		t.Fatalf("save: %v", err)
	}
	for _, n := range []string{"v1", "v2"} {
		if err := svc.AddKYBDocument(ctx, restID, owner, "cac_certificate", key(n), n+".pdf"); err != nil {
			t.Fatalf("add %s: %v", n, err)
		}
	}
	var total, current, maxV int
	if err := pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE superseded_at IS NULL), max(version) FROM restaurant_kyb_documents WHERE restaurant_id=$1`, restID).Scan(&total, &current, &maxV); err != nil {
		t.Fatal(err)
	}
	if total != 2 || current != 1 || maxV != 2 {
		t.Fatalf("versioning: total=%d current=%d max=%d", total, current, maxV)
	}
	var supBy *string
	_ = pool.QueryRow(ctx, `SELECT superseded_by::text FROM restaurant_kyb_documents WHERE restaurant_id=$1 AND version=1`, restID).Scan(&supBy)
	if supBy == nil {
		t.Error("v1 must point at its replacement")
	}
	docs := svc.adminDocsFor(restID, mustRefs(t, svc, restID))
	if len(docs) != 2 || !docs[0].Superseded || !strings.Contains(docs[0].Label, "superseded") {
		t.Errorf("admin should see both versions: %+v", docs)
	}

	// A-009: submit twice -> one submission, second flagged duplicate.
	k1, err := svc.SubmitKYB(ctx, restID, owner)
	if err != nil || k1.Duplicate || k1.SubmissionID != restID {
		t.Fatalf("first submit: %+v %v", k1, err)
	}
	k2, err := svc.SubmitKYB(ctx, restID, owner)
	if err != nil || !k2.Duplicate || k2.SubmissionID != k1.SubmissionID {
		t.Fatalf("second submit should be an idempotent duplicate: %+v %v", k2, err)
	}

	// A-011: names differ (account holder vs legal/storefront).
	if !svc.AdminNameMatchWarning(ctx, restID) {
		t.Error("expected name_match_warning")
	}

	// A-008: needs-changes returns it to the applicant, who can edit and resubmit.
	if err := svc.AdminRequestChanges(ctx, restID, admin, ""); err == nil {
		t.Error("reason required")
	}
	if err := svc.AdminRequestChanges(ctx, restID, admin, "Director ID is blurry"); err != nil {
		t.Fatalf("needs-changes: %v", err)
	}
	if got := kybStatusOf(t, ctx, pool, restID); got != string(KYBNeedsInfo) {
		t.Fatalf("status = %s", got)
	}
	if _, err := svc.SubmitKYB(ctx, restID, owner); err != nil {
		t.Fatalf("resubmit after needs-changes: %v", err)
	}

	// A-014: withdraw a pending application; reviewer cannot then approve; owner can re-apply.
	w, err := svc.WithdrawKYB(ctx, restID, owner)
	if err != nil || w.Status != KYBWithdrawn {
		t.Fatalf("withdraw: %+v %v", w, err)
	}
	if got := kybStatusOf(t, ctx, pool, restID); got != "withdrawn" {
		t.Fatalf("status = %s", got)
	}
	if err := svc.AdminDecideApplication(ctx, restID, admin, "approve", ""); err == nil {
		t.Error("withdrawn application must not be approvable")
	}
	if _, err := svc.WithdrawKYB(ctx, restID, owner); err != nil {
		t.Errorf("withdraw is idempotent: %v", err)
	}
	if _, err := svc.SubmitKYB(ctx, restID, owner); err != nil {
		t.Fatalf("re-apply after withdraw: %v", err)
	}
	// Approved applications cannot be withdrawn.
	if err := svc.AdminDecideApplication(ctx, restID, admin, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.WithdrawKYB(ctx, restID, owner); err == nil {
		t.Error("approved application must not be withdrawable")
	}
}

func mustRefs(t *testing.T, svc *Service, restID string) []kybDocRef {
	t.Helper()
	m, err := svc.kybDocRefsByRestaurant(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return m[restID]
}
