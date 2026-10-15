package restaurant

// LIVE-DB integration test for merchant KYB onboarding (Phase 8): the owner
// save→document→submit flow (with validation), the admin decision driving the KYB
// state machine + go-live, and the needs_more_info bounce. Skipped unless
// TEST_DATABASE_URL is set. Requires the restaurant + KYB migrations.

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/platform/r2"
	"spotlight/backend/internal/testsupport"
)

func kybLivePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL set — skipping live-DB KYB test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return pool
}

func TestLiveDB_KYBOnboarding(t *testing.T) {
	pool := kybLivePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	stranger := uuid.New().String()
	admin := uuid.New().String()
	for _, u := range []string{owner, stranger, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	// Restaurant starts CLOSED (not yet approved).
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'KYB Kitchen','1 St',FALSE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}

	// A stranger cannot touch KYB.
	if _, err := svc.SaveKYB(ctx, restID, stranger, KYB{LegalName: "x"}); err == nil {
		t.Fatal("stranger must not save KYB")
	}

	// Owner saves a registered-company KYB but tries to submit before it's complete →
	// blocked with ErrKYBIncomplete (missing rc_number + cac_certificate).
	reg := KYB{
		LegalName: "KYB Kitchen Ltd", BusinessType: "limited_company",
		ContactEmail: "owner@kyb.ng", ContactPhone: "08011112222",
		BankCode: "058", AccountNumber: "0123456789", AccountName: "KYB Kitchen",
	}
	if _, err := svc.SaveKYB(ctx, restID, owner, reg); err != nil {
		t.Fatalf("save kyb: %v", err)
	}
	if _, err := svc.SubmitKYB(ctx, restID, owner); !errors.Is(err, ErrKYBIncomplete) {
		t.Fatalf("incomplete submit should return ErrKYBIncomplete, got %v", err)
	}

	// Supply the RC number + certificate, then submit cleanly.
	reg.RCNumber = "RC7654321"
	if _, err := svc.SaveKYB(ctx, restID, owner, reg); err != nil {
		t.Fatalf("save kyb 2: %v", err)
	}
	if err := svc.AddKYBDocument(ctx, restID, owner, "cac_certificate", kybKeyPrefix(restID)+"cac_certificate/cac.pdf", "cac.pdf"); err != nil {
		t.Fatalf("add doc: %v", err)
	}
	if k, err := svc.SubmitKYB(ctx, restID, owner); err != nil || k.Status != KYBSubmitted {
		t.Fatalf("submit: status=%v err=%v", statusOf(k), err)
	}

	// Reviewer bounces it back for more info; the owner may edit + resubmit.
	if err := svc.AdminDecideApplication(ctx, restID, admin, "needs_info", "Please upload proof of address"); err != nil {
		t.Fatalf("needs_info: %v", err)
	}
	if st := kybStatusOf(t, ctx, pool, restID); st != "needs_more_info" {
		t.Fatalf("after needs_info, kyb status = %s, want needs_more_info", st)
	}
	if _, err := svc.SubmitKYB(ctx, restID, owner); err != nil { // resubmit
		t.Fatalf("resubmit: %v", err)
	}

	// Approve → KYB approved AND the restaurant goes live (is_open=true).
	if err := svc.AdminDecideApplication(ctx, restID, admin, "approve", ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if st := kybStatusOf(t, ctx, pool, restID); st != "approved" {
		t.Fatalf("after approve, kyb status = %s, want approved", st)
	}
	var isOpen bool
	var snap *string
	if err := pool.QueryRow(ctx, `SELECT is_open, kyb_status FROM restaurants WHERE id=$1`, restID).Scan(&isOpen, &snap); err != nil {
		t.Fatalf("read restaurant: %v", err)
	}
	if !isOpen {
		t.Error("approval should take the restaurant live (is_open=true)")
	}
	if snap == nil || *snap != "approved" {
		t.Errorf("restaurant kyb_status snapshot = %v, want approved", snap)
	}

	// Editing an approved KYB is blocked.
	if _, err := svc.SaveKYB(ctx, restID, owner, reg); err == nil {
		t.Error("editing an approved KYB should be blocked")
	}
}

// TestLiveDB_AdminApproveWithNoKYBRowMakesOutletPayable covers FOOD-003 Part B:
// the owner-facing KYB submission routes were never mounted (Part A) until this
// fix, so every restaurant approved through the admin console today has NO
// restaurant_kyb row. Before the fix, AdminDecideApplication only wrote
// restaurants.kyb_status inside the `hasKYB` branch, so approving such a
// restaurant opened it for orders (is_open=true) while leaving kyb_status
// NULL forever — payout.go's `AND res.kyb_status = 'approved'` gate then refused
// its payouts permanently, with PayoutReadinessForOwner reporting "Business
// verification not started" even after admin approval. The fix must move
// kyb_status on approve/reject even with no formal KYB submission.
func TestLiveDB_AdminApproveWithNoKYBRowMakesOutletPayable(t *testing.T) {
	pool := kybLivePool(t)
	defer pool.Close()
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	admin := uuid.New().String()
	for _, u := range []string{owner, admin} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'No-KYB Kitchen','1 St',FALSE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.WithoutCancel(t.Context()), `DELETE FROM restaurants WHERE id=$1`, restID)
	})

	// Sanity: reproduces the ORIGINAL bug's starting point — no restaurant_kyb row.
	if _, hasKYB, err := svc.loadKYB(ctx, restID); err != nil || hasKYB {
		t.Fatalf("expected no KYB row before approval, hasKYB=%v err=%v", hasKYB, err)
	}
	before, err := svc.PayoutReadinessForOwner(ctx, owner)
	if err != nil || len(before) != 1 || before[0].Payable {
		t.Fatalf("expected the unapproved outlet to start not-payable, got %+v err=%v", before, err)
	}

	// Admin approves with no formal KYB submission — the common case today.
	if err := svc.AdminDecideApplication(ctx, restID, admin, "approve", ""); err != nil {
		t.Fatalf("approve: %v", err)
	}

	var isOpen bool
	var kybStatus *string
	if err := pool.QueryRow(context.WithoutCancel(ctx), `SELECT is_open, kyb_status FROM restaurants WHERE id=$1`, restID).Scan(&isOpen, &kybStatus); err != nil {
		t.Fatalf("read restaurant: %v", err)
	}
	if !isOpen {
		t.Error("approval should take the restaurant live (is_open=true)")
	}
	if kybStatus == nil || *kybStatus != "approved" {
		t.Fatalf("kyb_status = %v, want \"approved\" — this is the FOOD-003 Part B bug: approval must move the payout gate's snapshot even with no formal KYB row", kybStatus)
	}

	// The concrete acceptance bar: payout-readiness must now report payable, not
	// permanently stuck on "Business verification not started".
	after, err := svc.PayoutReadinessForOwner(ctx, owner)
	if err != nil {
		t.Fatalf("PayoutReadinessForOwner: %v", err)
	}
	if len(after) != 1 || !after[0].Payable {
		t.Fatalf("expected the approved outlet to be payable, got %+v", after)
	}
	if after[0].Reason != "" {
		t.Errorf("a payable outlet must carry no blocking reason, got %q", after[0].Reason)
	}

	// Rejecting with no KYB row must symmetrically move the snapshot to rejected.
	if err := svc.AdminDecideApplication(ctx, restID, admin, "reject", "closing"); err != nil {
		t.Fatalf("reject: %v", err)
	}
	if err := pool.QueryRow(context.WithoutCancel(ctx), `SELECT kyb_status FROM restaurants WHERE id=$1`, restID).Scan(&kybStatus); err != nil {
		t.Fatalf("read restaurant after reject: %v", err)
	}
	if kybStatus == nil || *kybStatus != "rejected" {
		t.Fatalf("kyb_status after reject = %v, want \"rejected\"", kybStatus)
	}
}

func statusOf(k *KYB) KYBStatus {
	if k == nil {
		return ""
	}
	return k.Status
}

func kybStatusOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, restID string) string {
	t.Helper()
	var st string
	if err := pool.QueryRow(context.WithoutCancel(ctx), `SELECT status FROM restaurant_kyb WHERE restaurant_id=$1`, restID).Scan(&st); err != nil {
		t.Fatalf("read kyb status: %v", err)
	}
	return st
}

// TestLiveDB_KYBDocumentUploads covers the presigned-upload path end to end at the
// service layer: who may mint an upload URL, what the server will sign, which
// references AddKYBDocument accepts (own key or http(s) link — nothing else), that
// documents lock with the rest of the KYB, and that the reviewer console receives
// signed URLs for stored keys while pasted links pass through untouched.
func TestLiveDB_KYBDocumentUploads(t *testing.T) {
	pool := kybLivePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()

	// Fake-but-complete creds: Configured() is true and PresignPut/PresignGet are
	// pure local HMAC, so no network is involved. Healthy() does no probe because
	// EnableHealthCheck is deliberately not called.
	presigner := r2.New(r2.Config{
		AccountEndpoint: "https://acct.r2.cloudflarestorage.com",
		Bucket:          "kyb-test-bucket",
		AccessKeyID:     "AKIATESTTESTTESTTEST",
		SecretAccessKey: "test-secret-test-secret-test-secret",
	})
	svc := NewService(pool, nil).WithKYBStorage(presigner)
	noStorage := NewService(pool, nil)

	owner, stranger := uuid.New().String(), uuid.New().String()
	for _, u := range []string{owner, stranger} {
		if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, u, u+"@seed.test"); err != nil {
			t.Fatalf("seed user: %v", err)
		}
		testsupport.CleanupUser(t, pool, u)
	}
	restID, otherRestID := uuid.New().String(), uuid.New().String()
	for i, id := range []string{restID, otherRestID} {
		o := owner
		if i == 1 {
			o = stranger
		}
		if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'KYB Docs Kitchen','1 St',FALSE)`, id, o); err != nil {
			t.Fatalf("seed restaurant: %v", err)
		}
	}

	// Only someone who may manage banking for the outlet can mint an upload URL.
	if _, err := svc.PresignKYBDocument(ctx, restID, stranger, "cac_certificate", "cac.pdf", "application/pdf"); err == nil {
		t.Fatal("stranger must not mint an upload URL for someone else's outlet")
	}

	p, err := svc.PresignKYBDocument(ctx, restID, owner, "cac_certificate", "My CAC.PDF", "application/pdf")
	if err != nil {
		t.Fatalf("presign: %v", err)
	}
	wantPrefix := kybKeyPrefix(restID) + "cac_certificate/"
	if !strings.HasPrefix(p.ObjectKey, wantPrefix) || !strings.HasSuffix(p.ObjectKey, ".pdf") {
		t.Errorf("object key %q must live under %q and end .pdf (extension lower-cased)", p.ObjectKey, wantPrefix)
	}
	if p.ContentType != "application/pdf" || p.Method != "PUT" || p.ExpiresIn <= 0 {
		t.Errorf("unexpected presign envelope: %+v", p)
	}
	if !strings.Contains(p.UploadURL, "X-Amz-Signature=") || !strings.Contains(p.UploadURL, "kyb-test-bucket") {
		t.Errorf("upload URL is not a signed URL for the configured bucket: %s", p.UploadURL)
	}

	// What the server will and won't sign.
	for name, c := range map[string][3]string{
		"extension not allowed": {"cac_certificate", "run.exe", "application/pdf"},
		"type must match ext":   {"cac_certificate", "cac.pdf", "image/png"},
		"doc_type is a slug":    {"../escape", "cac.pdf", "application/pdf"},
		"doc_type no uppercase": {"CAC", "cac.pdf", "application/pdf"},
		"no extension at all":   {"cac_certificate", "cac", "application/pdf"},
	} {
		if _, err := svc.PresignKYBDocument(ctx, restID, owner, c[0], c[1], c[2]); err == nil {
			t.Errorf("%s: presign should be refused", name)
		}
	}

	// R2 unset ⇒ fail closed with the sentinel the handler maps to 503.
	if _, err := noStorage.PresignKYBDocument(ctx, restID, owner, "cac_certificate", "cac.pdf", "application/pdf"); !errors.Is(err, ErrKYBUploadsUnavailable) {
		t.Errorf("no presigner: err = %v, want ErrKYBUploadsUnavailable", err)
	}

	// AddKYBDocument: own key and plain web links are fine ...
	if err := svc.AddKYBDocument(ctx, restID, owner, "cac_certificate", p.ObjectKey, "cac.pdf"); err != nil {
		t.Fatalf("attach own uploaded key: %v", err)
	}
	if err := svc.AddKYBDocument(ctx, restID, owner, "proof_of_address", "https://example.com/utility-bill.pdf", ""); err != nil {
		t.Fatalf("attach pasted https link: %v", err)
	}
	// ... nothing else is: another outlet's key, non-web schemes, traversal, garbage.
	otherKey := kybKeyPrefix(otherRestID) + "cac_certificate/stolen.pdf"
	for name, ref := range map[string]string{
		"another outlet's key": otherKey,
		"javascript scheme":    "javascript:alert(1)",
		"data scheme":          "data:text/html;base64,PHNjcmlwdD4=",
		"legacy r2 scheme":     "r2://kyb/cac.pdf",
		"bare path":            "cac.pdf",
		"traversal":            kybKeyPrefix(restID) + "../" + otherRestID + "/kyb/x.pdf",
	} {
		if err := svc.AddKYBDocument(ctx, restID, owner, "director_id", ref, ""); err == nil {
			t.Errorf("%s: AddKYBDocument should reject %q", name, ref)
		}
	}
	if err := svc.AddKYBDocument(ctx, restID, stranger, "director_id", "https://example.com/id.pdf", ""); err == nil {
		t.Error("stranger must not attach a document")
	}

	// The reviewer console gets a signed URL for the stored key and the pasted link as-is.
	apps, err := svc.AdminListApplications(ctx, "")
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	var docs []AdminApplicationDoc
	for _, a := range apps {
		if a.ID == restID {
			docs = a.Documents
		}
	}
	if len(docs) != 2 {
		t.Fatalf("reviewer sees %d documents, want 2: %+v", len(docs), docs)
	}
	byKind := map[string]AdminApplicationDoc{}
	for _, d := range docs {
		byKind[d.Kind] = d
	}
	if d := byKind["cac"]; d.Label != "CAC certificate" || !strings.Contains(d.URL, "X-Amz-Signature=") {
		t.Errorf("stored key should reach the reviewer as a signed URL, got %+v", d)
	}
	if d := byKind["other"]; d.URL != "https://example.com/utility-bill.pdf" {
		t.Errorf("pasted link should pass through unchanged, got %+v", d)
	}
	// Without storage the key is not exposed raw: the doc is dropped, the link kept.
	appsNoStorage, err := noStorage.AdminListApplications(ctx, "")
	if err != nil {
		t.Fatalf("admin list (no storage): %v", err)
	}
	for _, a := range appsNoStorage {
		if a.ID != restID {
			continue
		}
		if len(a.Documents) != 1 || a.Documents[0].URL != "https://example.com/utility-bill.pdf" {
			t.Errorf("with R2 unset only the pasted link should be listed, got %+v", a.Documents)
		}
	}

	// Documents lock with the rest of the KYB once it is submitted.
	reg := KYB{
		LegalName: "KYB Docs Kitchen Ltd", BusinessType: "limited_company", RCNumber: "RC1234567",
		ContactEmail: "owner@kyb.ng", ContactPhone: "08011112222",
		BankCode: "058", AccountNumber: "0123456789", AccountName: "KYB Docs Kitchen",
	}
	if _, err := svc.SaveKYB(ctx, restID, owner, reg); err != nil {
		t.Fatalf("save kyb: %v", err)
	}
	if k, err := svc.SubmitKYB(ctx, restID, owner); err != nil || k.Status != KYBSubmitted {
		t.Fatalf("submit: status=%v err=%v", statusOf(k), err)
	}
	if _, err := svc.PresignKYBDocument(ctx, restID, owner, "cac_certificate", "cac.pdf", "application/pdf"); err == nil {
		t.Error("presign must be refused once the KYB is submitted")
	}
	if err := svc.AddKYBDocument(ctx, restID, owner, "cac_certificate", "https://example.com/swapped.pdf", ""); err == nil {
		t.Error("a document must not be replaceable after submission")
	}
}

// TestLiveDB_KYBDocumentWriteSerialisesWithSubmit pins the lock: AddKYBDocument must
// not be able to replace a document in the gap between a submit deciding to lock the
// KYB and that submit committing. A submit in flight is simulated by an open
// transaction that has already flipped the row to 'submitted'; AddKYBDocument has to
// WAIT for it (its share lock conflicts with the update) and then see the locked
// status. A plain read-then-write would have read 'draft' and succeeded immediately.
func TestLiveDB_KYBDocumentWriteSerialisesWithSubmit(t *testing.T) {
	pool := kybLivePool(t)
	t.Cleanup(pool.Close)
	ctx := context.Background()
	svc := NewService(pool, nil)

	owner := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO auth.users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING`, owner, owner+"@seed.test"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	testsupport.CleanupUser(t, pool, owner)
	restID := uuid.New().String()
	if _, err := pool.Exec(ctx, `INSERT INTO restaurants (id, owner_id, name, address, is_open) VALUES ($1,$2,'KYB Race Kitchen','1 St',FALSE)`, restID, owner); err != nil {
		t.Fatalf("seed restaurant: %v", err)
	}
	if _, err := svc.SaveKYB(ctx, restID, owner, KYB{LegalName: "Race Kitchen", BusinessType: "sole_proprietor"}); err != nil {
		t.Fatalf("save kyb: %v", err)
	}
	if err := svc.AddKYBDocument(ctx, restID, owner, "proof_of_address", "https://example.com/original.pdf", ""); err != nil {
		t.Fatalf("seed original document: %v", err)
	}

	// A submit that has taken the row lock but not yet committed.
	submitTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = submitTx.Rollback(ctx) })
	if _, err := submitTx.Exec(ctx, `UPDATE restaurant_kyb SET status='submitted' WHERE restaurant_id=$1`, restID); err != nil {
		t.Fatalf("simulate in-flight submit: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		done <- svc.AddKYBDocument(ctx, restID, owner, "proof_of_address", "https://example.com/swapped.pdf", "")
	}()
	select {
	case err := <-done:
		t.Fatalf("AddKYBDocument returned (%v) while a submit was in flight; it must wait for the row lock", err)
	case <-time.After(400 * time.Millisecond):
		// still blocked on the lock — what we want
	}
	if err := submitTx.Commit(ctx); err != nil {
		t.Fatalf("commit submit: %v", err)
	}
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "cannot be edited") {
			t.Fatalf("after the submit committed, AddKYBDocument err = %v, want 'cannot be edited'", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("AddKYBDocument never returned after the submit committed")
	}

	var ref string
	if err := pool.QueryRow(ctx, `SELECT file_url FROM restaurant_kyb_documents WHERE restaurant_id=$1 AND doc_type='proof_of_address'`, restID).Scan(&ref); err != nil {
		t.Fatalf("read document: %v", err)
	}
	if ref != "https://example.com/original.pdf" {
		t.Errorf("document was replaced across the lock: file_url = %q", ref)
	}
}
