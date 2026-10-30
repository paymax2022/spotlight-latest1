package healthpharmacy_test

// LIVE-DB smoke + shape tests for the admin console reads. Skips unless
// TEST_DATABASE_URL is set.

import (
	"bytes"
	"context"
	"strings"
	"testing"

	healthpharmacy "spotlight/backend/internal/health/pharmacy"
)

func TestLiveDB_AdminConsoleReads(t *testing.T) {
	pool := ownerOrdersPool(t)
	t.Cleanup(func() { pool.Close() })
	ctx := context.Background()
	f := newInboxFixture(t, ctx, pool)

	banned := seedProduct(t, ctx, f, f.pharmacy, "Banned Tonic", "BANNED", true, 10_000, 3)
	ok := seedProduct(t, ctx, f, f.pharmacy, "Paracetamol", "REGISTERED", true, 10_000, 3)

	cat, err := f.svc.AdminListCatalog(ctx, "rejected", "", "Banned Tonic")
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	if len(cat) != 1 || cat[0].ID != banned || cat[0].FlaggedReason == nil || cat[0].NafdacValid {
		t.Fatalf("banned product must be listed as rejected+flagged: %+v", cat)
	}
	approved, err := f.svc.AdminListCatalog(ctx, "approved", "otc", "")
	if err != nil {
		t.Fatalf("catalog approved: %v", err)
	}
	found := false
	for _, it := range approved {
		found = found || it.ID == ok
		if it.Status != "approved" {
			t.Fatalf("status filter leaked %q", it.Status)
		}
	}
	if !found {
		t.Fatal("registered active product missing from approved filter")
	}

	if _, err := f.svc.AdminListPcnApplications(ctx, "submitted", "x"); err != nil {
		t.Fatalf("pcn: %v", err)
	}
	if _, err := f.svc.AdminRxAudit(ctx, "verified", ""); err != nil {
		t.Fatalf("rx audit: %v", err)
	}
	if _, err := f.svc.AdminControlledLog(ctx, ""); err != nil {
		t.Fatalf("controlled log: %v", err)
	}
	payouts, err := f.svc.AdminListPayouts(ctx, "", "Inbox Pharmacy")
	if err != nil {
		t.Fatalf("payouts: %v", err)
	}
	if len(payouts) == 0 || payouts[0].ID != f.pharmacy {
		t.Fatalf("pharmacy missing from payouts: %+v", payouts)
	}

	r, err := f.svc.AdminReporting(ctx, "90d")
	if err != nil {
		t.Fatalf("reporting: %v", err)
	}
	if r.Orders < 2 || len(r.Monthly) != 6 || r.OTCOrders != r.Orders-r.RxOrders {
		t.Fatalf("unexpected report: %+v", r)
	}
	var buf bytes.Buffer
	if err := healthpharmacy.WriteReportCSV(&buf, r); err != nil {
		t.Fatalf("csv: %v", err)
	}
	if !strings.HasPrefix(buf.String(), "metric,value\n") || !strings.Contains(buf.String(), "gmv_kobo,") {
		t.Fatalf("csv shape: %q", buf.String())
	}
}
