package association_test

// Completion of the association IDOR-scope suite: covers three admin surfaces the
// original sweep left on org-agnostic guards (found by security review) —
//   - BulkImportMembers   (cross-org WRITE: insert ACTIVE memberships into any org)
//   - GetApprovalQueue     (cross-org READ: every org's pending applicant PII)
//   - GetOfflinePayments   (cross-org READ: every org's offline-payment financial PII)
//
// Gated on TEST_DATABASE_URL exactly like idor_scope_test.go — reuses
// its shared liveDBPool + seed helpers. Run:
//   export TEST_DATABASE_URL="postgres://postgres:postgres@127.0.0.1:54322/postgres"
//   go test ./tests/association/ -run IDOR -v

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"spotlight/backend/internal/association"
)

// BulkImportMembers must require ImportMembers IN the target org. An admin of org A
// (with the capability in A) must not be able to write memberships into org B.
func TestLiveDB_IDOR_BulkImportMembers_CrossOrgForbidden(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "ImpA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "ImpB "+uuid.New().String())
	adminA := seedAdminRole(t, ctx, pool, orgA, "NATIONAL_ADMIN") // ImportMembers-capable, but in org A only

	csv := "email,full_name\nnobody-" + uuid.New().String() + "@example.com,Nobody\n"
	if n, err := svc.BulkImportMembers(ctx, adminA, orgB, strings.NewReader(csv)); err == nil {
		t.Fatalf("CROSS-ORG IDOR: admin of org A imported into org B (n=%d, want error)", n)
	}
	// The forbidden attempt must not have written any membership into org B.
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM assoc_memberships WHERE organisation_id=$1`, orgB).Scan(&count); err != nil {
		t.Fatalf("count org B memberships: %v", err)
	}
	if count != 0 {
		t.Fatalf("org B gained %d membership(s) from a forbidden cross-org import", count)
	}
}

// GetApprovalQueue must only surface the admin's own organisation's applications.
func TestLiveDB_IDOR_GetApprovalQueue_ScopedToAdminOrg(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "QueueA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "QueueB "+uuid.New().String())
	applicantB, _ := seedActiveMembership(t, ctx, pool, orgB)
	appB := seedApplication(t, ctx, pool, orgB, applicantB) // PENDING application in org B

	// Admin of org A must NOT see org B's pending application.
	adminA := seedAdminRole(t, ctx, pool, orgA, "NATIONAL_ADMIN")
	listA, err := svc.GetApprovalQueue(ctx, adminA, "", "")
	if err != nil {
		t.Fatalf("approval queue (A): %v", err)
	}
	for _, a := range listA {
		if a.ID == appB {
			t.Fatal("CROSS-ORG IDOR: org A admin saw org B's pending application in the queue")
		}
	}
	// Positive: admin of org B DOES see org B's own pending application.
	adminB := seedAdminRole(t, ctx, pool, orgB, "NATIONAL_ADMIN")
	listB, err := svc.GetApprovalQueue(ctx, adminB, "", "")
	if err != nil {
		t.Fatalf("approval queue (B): %v", err)
	}
	found := false
	for _, a := range listB {
		if a.ID == appB {
			found = true
		}
	}
	if !found {
		t.Fatal("org B admin must see org B's own pending application")
	}
}

// GetOfflinePayments must only surface the admin's own organisation's payments.
func TestLiveDB_IDOR_GetOfflinePayments_ScopedToAdminOrg(t *testing.T) {
	pool := liveDBPool(t)
	defer pool.Close()
	svc := newLiveAssociationService(pool)
	ctx := context.Background()

	orgA := seedOrganisation(t, ctx, pool, "OffA "+uuid.New().String())
	orgB := seedOrganisation(t, ctx, pool, "OffB "+uuid.New().String())
	_, membershipB := seedActiveMembership(t, ctx, pool, orgB)
	invoiceB := seedDuesInvoice(t, ctx, pool, membershipB, 750_00)
	paymentB := seedOfflinePayment(t, ctx, pool, membershipB, invoiceB, 750_00)

	// Finance admin of org A must NOT see org B's offline payment.
	financeAdminA := seedAdminRole(t, ctx, pool, orgA, "FINANCE_ADMIN")
	listA, err := svc.GetOfflinePayments(ctx, financeAdminA, "")
	if err != nil {
		t.Fatalf("offline payments (A): %v", err)
	}
	for _, op := range listA {
		if op.ID == paymentB {
			t.Fatal("CROSS-ORG IDOR: org A finance admin saw org B's offline payment")
		}
	}
	// Positive: finance admin of org B DOES see org B's own offline payment.
	financeAdminB := seedAdminRole(t, ctx, pool, orgB, "FINANCE_ADMIN")
	listB, err := svc.GetOfflinePayments(ctx, financeAdminB, "")
	if err != nil {
		t.Fatalf("offline payments (B): %v", err)
	}
	found := false
	for _, op := range listB {
		if op.ID == paymentB {
			found = true
		}
	}
	if !found {
		t.Fatal("org B finance admin must see org B's own offline payment")
	}
}

// compile-time: keep the association import used even if the assertions above change.
var _ = association.ErrForbidden
