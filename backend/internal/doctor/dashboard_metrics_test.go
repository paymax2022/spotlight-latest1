package doctor

import (
	"encoding/json"
	"math"
	"reflect"
	"spotlight/backend/go-common/ptr"
	"spotlight/backend/internal/finance/settlement"
	"strconv"
	"strings"
	"testing"
)

// dashboard_metrics_test.go — the two pieces of dashboard arithmetic that need no
// database: what a doctor's share of an escrowed consult is, and how a rating
// becomes a satisfaction percentage.

func TestConsultSplitMirrorsTelemedicine(t *testing.T) {
	// The split telemedicine.CompleteAppointment pays (service.go:700-704) is the
	// money the doctor actually gets. If either side drifts, this fails.
	if consultProviderPct+consultPlatformPct != 1.0 {
		t.Fatalf("consult split %.2f + %.2f != 1.0", consultProviderPct, consultPlatformPct)
	}
	cases := []struct {
		name         string
		total, fee   int64
		wantProvider int64
	}{
		// 200000 escrowed, no booking fee → 85% of it all.
		{"no booking fee", 200000, 0, 170000},
		// ADR-044: the 2000 platform booking fee is 100% platform and rides ON TOP,
		// so the doctor keeps 85% of the 198000 consult, not of the total.
		{"with booking fee", 200000, 2000, 168300},
		// Pre-ADR-044 rows escrowed the consult alone.
		{"legacy row", 750000, 0, 637500},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := pendingConsultKobo(c.total, c.fee)
			if err != nil {
				t.Fatalf("pendingConsultKobo: %v", err)
			}
			if got != c.wantProvider {
				t.Errorf("provider kobo = %d, want %d", got, c.wantProvider)
			}
			// Same answer from the shared definition, not a copy of it.
			legs, err := settlement.ComputeLegs(c.total, settlement.Split{
				ProviderPct: consultProviderPct, PlatformPct: consultPlatformPct, ServiceFeeKobo: c.fee,
			})
			if err != nil {
				t.Fatalf("ComputeLegs: %v", err)
			}
			if legs.ProviderKobo != got {
				t.Errorf("pendingConsultKobo %d disagrees with ComputeLegs %d", got, legs.ProviderKobo)
			}
		})
	}
}

func TestDashboardSatisfactionPct(t *testing.T) {
	cases := []struct {
		name string
		in   ReputationSummary
		want *float64
	}{
		// No reviews is NOT zero percent. The tile shows '—'; a 0 here would tell a
		// doctor their brand-new practice scores nothing.
		{"no reviews is nil", ReputationSummary{AverageRating: 0, ReviewCount: 0}, nil},
		{"4.8 of 5 is 96", ReputationSummary{AverageRating: 4.8, ReviewCount: 24}, ptr.Of(96.0)},
		{"4,5,5 rounds to 93", ReputationSummary{AverageRating: 4.6666666666666665, ReviewCount: 3}, ptr.Of(93.0)},
		// 86.66 is the case that tells ROUND from TRUNC; every other row here is a
		// number both would produce.
		{"4,4,5 rounds up to 87", ReputationSummary{AverageRating: 13.0 / 3.0, ReviewCount: 3}, ptr.Of(87.0)},
		{"perfect", ReputationSummary{AverageRating: 5, ReviewCount: 1}, ptr.Of(100.0)},
		{"one star is not nil", ReputationSummary{AverageRating: 1, ReviewCount: 2}, ptr.Of(20.0)},
		// The other half of the nil-vs-zero rule: reviews exist and every one is
		// zero stars. GetReputation's COALESCE(AVG,0) returns 0 for THIS too, so
		// only ReviewCount separates a hated practice from an unreviewed one — and
		// 0 must survive as 0, not collapse into the nil above it.
		{"zero stars with reviews is 0, not nil", ReputationSummary{AverageRating: 0, ReviewCount: 7}, ptr.Of(0.0)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := dashboardSatisfactionPct(c.in)
			if c.want == nil {
				if got != nil {
					t.Fatalf("got %v, want nil", *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("got nil, want %v", *c.want)
			}
			if math.Abs(*got-*c.want) > 1e-9 {
				t.Errorf("got %v, want %v", *got, *c.want)
			}
		})
	}
}

// TestDashboardSummaryWirePaths pins the JSON PATH each tile reads, not just that a
// key name appears somewhere in the payload. The defect this branch exists to kill
// was a payload/key mismatch every gate could miss, and the live-DB suite's two JSON
// assertions — strings.Contains(raw, `"todaysCount":2,`) at
// dashboard_metrics_live_db_test.go:779 — still pass if TodaysCount moves to the top
// level or if Metrics' tag is renamed. Either way dashboardWire.ts's
// `wire.metrics ?? {}` reads an empty object again and every tile returns to a
// literal 0 with all 13 live tests and all 48 node cases green. It runs here, with no
// database, because the live file skips on every laptop.
func TestDashboardSummaryWirePaths(t *testing.T) {
	sat := 93.0
	// Every sentinel is distinct, so two paths that trade places cannot both pass.
	full := DashboardSummary{
		AppointmentCounts:   map[string]int64{"pending": 4},
		UnreadNotifications: 5,
		WalletBalanceKobo:   96,
		Currency:            "NGN",
		Metrics: DashboardMetrics{
			TodaysCount: 2, UpcomingCount: 3, SatisfactionPct: &sat, RatingCount: 6,
			Revenue:  DashboardRevenue{PendingKobo: 7, LifetimeKobo: 8, ThisMonthKobo: 9, ConsultsThisMonth: 10},
			Timezone: "Africa/Lagos", Today: "2026-11-13",
		},
		TodaysAppointments: []DashboardQueueAppointment{{
			ID: "a1", Ref: "TM-9F2A41",
			Patient:     DashboardQueuePatient{ID: "p1", Name: "Ada Obi", Age: 30, Gender: "female"},
			ConsultType: "video", Status: "upcoming",
			SlotDate: "2026-11-13", SlotTime: "09:00 AM",
			FeeKobo: 200000, Reason: "headache", IsHMO: false, CreatedAt: "2026-11-01T00:00:00Z",
		}},
	}
	raw, err := json.Marshal(full)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	cases := []struct {
		path string
		want any
	}{
		{"appointmentCounts.pending", 4.0},
		{"unreadNotifications", 5.0},
		{"walletBalanceKobo", 96.0},
		{"currency", "NGN"},
		{"metrics.todaysCount", 2.0},
		{"metrics.upcomingCount", 3.0},
		{"metrics.satisfactionPct", 93.0},
		{"metrics.ratingCount", 6.0},
		{"metrics.revenue.pendingKobo", 7.0},
		{"metrics.revenue.lifetimeKobo", 8.0},
		{"metrics.revenue.thisMonthKobo", 9.0},
		{"metrics.revenue.consultsThisMonth", 10.0},
		{"metrics.timezone", "Africa/Lagos"},
		{"metrics.today", "2026-11-13"},
		{"todaysAppointments.0.id", "a1"},
		{"todaysAppointments.0.ref", "TM-9F2A41"},
		{"todaysAppointments.0.patient.id", "p1"},
		{"todaysAppointments.0.patient.name", "Ada Obi"},
		{"todaysAppointments.0.patient.age", 30.0},
		{"todaysAppointments.0.patient.gender", "female"},
		{"todaysAppointments.0.consultType", "video"},
		{"todaysAppointments.0.status", "upcoming"},
		{"todaysAppointments.0.slotDate", "2026-11-13"},
		{"todaysAppointments.0.slotTime", "09:00 AM"},
		{"todaysAppointments.0.feeKobo", 200000.0},
		{"todaysAppointments.0.reason", "headache"},
		{"todaysAppointments.0.isHmo", false},
		{"todaysAppointments.0.createdAt", "2026-11-01T00:00:00Z"},
	}
	for _, c := range cases {
		t.Run(c.path, func(t *testing.T) {
			got, ok := descendJSON(wire, c.path)
			if !ok {
				t.Fatalf("path %q absent from %s", c.path, raw)
			}
			if got != c.want {
				t.Errorf("path %q = %#v, want %#v", c.path, got, c.want)
			}
		})
	}

	// A doctor with nothing scheduled must still receive every tile key: `?? 0` and
	// `?? {}` cannot tell an absent key from a real zero, which is how the original
	// blanks stayed invisible.
	braw, err := json.Marshal(DashboardSummary{})
	if err != nil {
		t.Fatalf("marshal bare: %v", err)
	}
	var bare map[string]any
	if err := json.Unmarshal(braw, &bare); err != nil {
		t.Fatalf("unmarshal bare: %v", err)
	}
	for _, p := range []string{"metrics", "metrics.todaysCount", "metrics.satisfactionPct", "metrics.revenue.pendingKobo", "appointmentCounts", "todaysAppointments"} {
		if _, ok := descendJSON(bare, p); !ok {
			t.Errorf("a zero dashboard is missing %q: %s", p, braw)
		}
	}

	// The same promise, held at the tag rather than re-derived from one payload: no
	// field of these five types may grow an omitempty.
	for _, typ := range []reflect.Type{
		reflect.TypeOf(DashboardSummary{}),
		reflect.TypeOf(DashboardMetrics{}),
		reflect.TypeOf(DashboardRevenue{}),
		reflect.TypeOf(DashboardQueueAppointment{}),
		reflect.TypeOf(DashboardQueuePatient{}),
	} {
		assertNoOmitempty(t, typ)
	}
}

// descendJSON walks a dotted path through an unmarshalled payload, accepting array
// indices as segments: "todaysAppointments.0.patient.name".
func descendJSON(root any, path string) (any, bool) {
	cur := root
	for _, seg := range strings.Split(path, ".") {
		switch node := cur.(type) {
		case map[string]any:
			v, ok := node[seg]
			if !ok {
				return nil, false
			}
			cur = v
		case []any:
			i, err := strconv.Atoi(seg)
			if err != nil || i < 0 || i >= len(node) {
				return nil, false
			}
			cur = node[i]
		default:
			return nil, false
		}
	}
	return cur, true
}

func assertNoOmitempty(t *testing.T, typ reflect.Type) {
	t.Helper()
	for i := 0; i < typ.NumField(); i++ {
		tag := typ.Field(i).Tag.Get("json")
		if !strings.Contains(tag, "omitempty") {
			continue
		}
		t.Errorf("%s.%s carries omitempty in json tag %q — the client reads these keys through `?? 0`/`?? {}`, so a field Go omits for a zero value is indistinguishable from a real zero and the tile goes blank in silence",
			typ.Name(), typ.Field(i).Name, tag)
	}
}
