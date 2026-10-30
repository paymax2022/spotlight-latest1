package healthpharmacy

import (
	"bytes"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestMaskName(t *testing.T) {
	cases := map[[2]string]string{
		{"pt", "Chioma Okafor"}: "pt Chioma•••",
		{"", "Alexandria B"}:    "Alexan•••",
		{"Pharm.", ""}:          "Pharm.•••",
	}
	for in, want := range cases {
		if got := maskName(in[0], in[1]); got != want {
			t.Errorf("maskName(%q,%q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

func TestPayoutStatusFor(t *testing.T) {
	if payoutStatusFor(false, 0, 100) != "kyc_hold" || payoutStatusFor(true, 0, 100) != "pending" ||
		payoutStatusFor(true, 500, 0) != "paid" {
		t.Fatal("payout status mapping wrong")
	}
}

func TestAdminReporting_BadPeriod(t *testing.T) {
	if _, err := (&Service{}).AdminReporting(t.Context(), "1y"); !errors.Is(err, ErrBadPeriod) {
		t.Fatalf("want ErrBadPeriod, got %v", err)
	}
}

func TestWriteReportCSV_IntegerKobo(t *testing.T) {
	var buf bytes.Buffer
	r := &AdminReport{Period: "7d", GeneratedAt: time.Unix(0, 0).UTC(), GMVKobo: 123456789,
		Monthly: []ReportMonth{{Month: "Oct 27", GMVKobo: 5, NetKobo: 1, Orders: 2}}}
	if err := WriteReportCSV(&buf, r); err != nil {
		t.Fatal(err)
	}
	out := buf.String()
	if !strings.Contains(out, "gmv_kobo,123456789\n") || !strings.Contains(out, "Oct 27,5,1,2\n") {
		t.Fatalf("csv: %q", out)
	}
}

// Bad enum filters are 400 before any query (nil-db Service would panic).
func TestAdminConsole_RejectsUnknownFilters(t *testing.T) {
	r, h := uuidGuardRouter()
	r.GET("/pcn/applications", h.AdminPcnApplications)
	r.GET("/catalog", h.AdminCatalog)
	r.GET("/rx-audit", h.AdminRxAudit)
	r.GET("/payouts", h.AdminPayouts)
	r.GET("/reporting", h.AdminReporting)
	for _, p := range []string{
		"/pcn/applications?status=bogus", "/catalog?status=bogus", "/catalog?pom=maybe",
		"/rx-audit?status=bogus", "/payouts?payout_status=bogus", "/reporting?format=xml", "/reporting?period=1y",
	} {
		if w := get(t, r, p); w.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", p, w.Code)
		}
	}
}
