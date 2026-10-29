package healthvet

// Dashboard KPIs and the reporting period / CSV export for the admin console.
// Every figure is a read of recorded rows (integer kobo); a KPI with no source
// table stays 0 and is named in the comment below rather than invented:
//   - services_pending_governance: vet_services has no pending state;
//   - sos_routed_30d: SOS requests are audited but never persisted;
//   - activity: there is no vet event feed to read.
// moderation_open / payouts_kyc_hold read their tables only when they exist.

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// AdminDashboardKPIs is flattened into AdminDashboard's JSON (VetDashboard shape).
type AdminDashboardKPIs struct {
	AppointmentsToday         int64              `json:"appointments_today"`
	Appointments30d           int64              `json:"appointments_30d"`
	ConsultsCompleted30d      int64              `json:"consults_completed_30d"`
	CompletionRate            float64            `json:"appointment_completion_rate"`
	NoShowRate                float64            `json:"no_show_rate"`
	GMVTodayKobo              int64              `json:"gmv_today_kobo"`
	GMV30dKobo                int64              `json:"gmv_30d_kobo"`
	NetRevenue30dKobo         int64              `json:"net_revenue_30d_kobo"`
	TakeRate                  float64            `json:"take_rate"`
	AvgAppointmentValueKobo   int64              `json:"avg_appointment_value_kobo"`
	HeldBalanceKobo           int64              `json:"held_balance_kobo"`
	Released30dKobo           int64              `json:"released_30d_kobo"`
	Refunded30dKobo           int64              `json:"refunded_30d_kobo"`
	VCNPendingReview          int64              `json:"vcn_pending_review"`
	VetsSuspended             int64              `json:"vets_suspended"`
	VCNExpiring30d            int64              `json:"vcn_expiring_30d"`
	Eprescriptions30d         int64              `json:"eprescriptions_30d"`
	EprescriptionsPOM30d      int64              `json:"eprescriptions_pom_30d"`
	EprescriptionFlagsOpen    int64              `json:"eprescription_flags_open"`
	ServicesPendingGovernance int64              `json:"services_pending_governance"`
	ModerationOpen            int64              `json:"moderation_open"`
	PayoutsKYCHold            int64              `json:"payouts_kyc_hold"`
	SOSRouted30d              int64              `json:"sos_routed_30d"`
	AppointmentMix            []AppointmentMix   `json:"appointment_mix"`
	AppointmentsTrend         []AppointmentPoint `json:"appointments_trend"`
	Activity                  []any              `json:"activity"`
}

type AppointmentMix struct {
	Label        string  `json:"label"`
	Appointments int64   `json:"appointments"`
	GMVKobo      int64   `json:"gmv_kobo"`
	SharePct     float64 `json:"share_pct"` // fraction 0..1
}

type AppointmentPoint struct {
	Date         string `json:"date"`
	Appointments int64  `json:"appointments"`
}

func (s *Service) tableExists(ctx context.Context, name string) bool {
	var ok bool
	_ = s.db.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, "public."+name).Scan(&ok)
	return ok
}

func (s *Service) fillDashboardKPIs(ctx context.Context, k *AdminDashboardKPIs) error {
	k.AppointmentMix, k.AppointmentsTrend, k.Activity = []AppointmentMix{}, []AppointmentPoint{}, []any{}

	var completed, noShow int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE vp.created_at >= date_trunc('day', now())),
		       COUNT(*) FILTER (WHERE vp.created_at >= now() - interval '30 days'),
		       COUNT(*) FILTER (WHERE vp.created_at >= now() - interval '30 days' AND ap.state='COMPLETED'),
		       COUNT(*) FILTER (WHERE vp.created_at >= now() - interval '30 days' AND ap.state='NO_SHOW'),
		       COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.created_at >= date_trunc('day', now()) AND vp.pay_state <> 'REFUNDED'),0),
		       COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.created_at >= now() - interval '30 days' AND vp.pay_state <> 'REFUNDED'),0),
		       COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.pay_state='HELD'),0),
		       COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.pay_state='RELEASED' AND vp.updated_at >= now() - interval '30 days'),0),
		       COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.pay_state='REFUNDED' AND vp.updated_at >= now() - interval '30 days'),0)
		FROM vet_appointment_payments vp JOIN health_appointments ap ON ap.id = vp.appointment_id`,
	).Scan(&k.AppointmentsToday, &k.Appointments30d, &completed, &noShow, &k.GMVTodayKobo, &k.GMV30dKobo,
		&k.HeldBalanceKobo, &k.Released30dKobo, &k.Refunded30dKobo); err != nil {
		return fmt.Errorf("vet: dashboard appointment kpis: %w", err)
	}
	k.ConsultsCompleted30d = completed
	k.CompletionRate, k.NoShowRate = ratio(completed, k.Appointments30d), ratio(noShow, k.Appointments30d)
	if k.Appointments30d > 0 {
		k.AvgAppointmentValueKobo = k.GMV30dKobo / k.Appointments30d
	}

	if err := s.db.QueryRow(ctx, `SELECT COALESCE(SUM(spotlight_revenue_kobo),0) FROM commission_earnings
		WHERE source_module='health.vet' AND created_at >= now() - interval '30 days'`).Scan(&k.NetRevenue30dKobo); err != nil {
		return fmt.Errorf("vet: dashboard revenue: %w", err)
	}
	k.TakeRate = ratio(k.NetRevenue30dKobo, k.GMV30dKobo)

	if err := s.db.QueryRow(ctx, `
		SELECT (SELECT COUNT(*) FROM health_verification_records WHERE source='VCN' AND status='PENDING'),
		       (SELECT COUNT(*) FROM health_providers WHERE domain='VET' AND status='SUSPENDED'),
		       (SELECT COUNT(DISTINCT a.provider_id) FROM health_credential_docs d
		          JOIN health_provider_applications a ON a.id = d.application_id
		          JOIN health_providers p ON p.id = a.provider_id
		         WHERE a.domain='VET' AND p.status='APPROVED'
		           AND d.expires_at >= now() AND d.expires_at < now() + interval '30 days')`,
	).Scan(&k.VCNPendingReview, &k.VetsSuspended, &k.VCNExpiring30d); err != nil {
		return fmt.Errorf("vet: dashboard vcn kpis: %w", err)
	}

	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(DISTINCT rp.id) FILTER (WHERE rp.created_at >= now() - interval '30 days'),
		       COUNT(DISTINCT rp.id) FILTER (WHERE rp.created_at >= now() - interval '30 days' AND i.is_pom),
		       COUNT(DISTINCT rp.id) FILTER (WHERE rp.refills_used > rp.refills_authorized)
		FROM health_prescriptions rp
		JOIN vet_appointment_payments vp ON vp.consult_id = rp.consult_id
		LEFT JOIN health_prescription_items i ON i.prescription_id = rp.id`,
	).Scan(&k.Eprescriptions30d, &k.EprescriptionsPOM30d, &k.EprescriptionFlagsOpen); err != nil {
		return fmt.Errorf("vet: dashboard erx kpis: %w", err)
	}

	if s.tableExists(ctx, "vet_moderation_items") {
		_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM vet_moderation_items WHERE status IN ('open','investigating')`).Scan(&k.ModerationOpen)
	}
	if s.tableExists(ctx, "vet_payout_decisions") {
		_ = s.db.QueryRow(ctx, `
			SELECT COUNT(*) FROM (
			  SELECT DISTINCT ON (provider_id) decision FROM vet_payout_decisions
			  ORDER BY provider_id, created_at DESC) d WHERE d.decision='KYC_HOLD'`).Scan(&k.PayoutsKYCHold)
	}

	rows, err := s.db.Query(ctx, `
		SELECT vp.visit_type, COUNT(*), COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.pay_state <> 'REFUNDED'),0)
		FROM vet_appointment_payments vp WHERE vp.created_at >= now() - interval '30 days'
		GROUP BY vp.visit_type ORDER BY COUNT(*) DESC`)
	if err != nil {
		return fmt.Errorf("vet: dashboard mix: %w", err)
	}
	labels := map[string]string{string(VisitTele): "Tele-consult", string(VisitHome): "Home visit", string(VisitClinic): "Clinic visit"}
	for rows.Next() {
		var m AppointmentMix
		var vt string
		if err := rows.Scan(&vt, &m.Appointments, &m.GMVKobo); err != nil {
			rows.Close()
			return err
		}
		m.Label, m.SharePct = labels[vt], ratio(m.Appointments, k.Appointments30d)
		k.AppointmentMix = append(k.AppointmentMix, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	trows, err := s.db.Query(ctx, `
		SELECT to_char(d, 'YYYY-MM-DD'),
		       (SELECT COUNT(*) FROM vet_appointment_payments vp
		         WHERE vp.created_at >= d AND vp.created_at < d + interval '1 day')
		FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d
		ORDER BY d`)
	if err != nil {
		return fmt.Errorf("vet: dashboard trend: %w", err)
	}
	defer trows.Close()
	for trows.Next() {
		var p AppointmentPoint
		if err := trows.Scan(&p.Date, &p.Appointments); err != nil {
			return err
		}
		k.AppointmentsTrend = append(k.AppointmentsTrend, p)
	}
	return trows.Err()
}

// reportingSince maps the console period to a lower bound; nil means all time.
func reportingSince(period string, now time.Time) (*time.Time, string, bool) {
	var t time.Time
	switch period {
	case "", "all":
		return nil, "All time", true
	case "7d":
		t = now.AddDate(0, 0, -7)
		return &t, "Last 7 days", true
	case "30d":
		t = now.AddDate(0, 0, -30)
		return &t, "Last 30 days", true
	case "90d":
		t = now.AddDate(0, 0, -90)
		return &t, "Last 90 days", true
	case "ytd":
		t = time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
		return &t, "Year to date", true
	}
	return nil, "", false
}

// AdminReportingExportCSV — GET /admin/reporting/export.csv?period=
func (h *Handler) AdminReportingExportCSV(c *gin.Context) {
	period := c.Query("period")
	if _, _, ok := reportingSince(period, time.Now().UTC()); !ok {
		failErr(c, http.StatusBadRequest, errors.New("vet: period must be 7d, 30d, 90d, ytd or all"))
		return
	}
	r, err := h.svc.AdminConsoleReporting(c.Request.Context(), period)
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.Header("Content-Type", "text/csv; charset=utf-8")
	slug := period
	if slug == "" {
		slug = "all"
	}
	c.Header("Content-Disposition", `attachment; filename="vet-reporting-`+slug+`.csv"`)
	w := csv.NewWriter(c.Writer)
	i := func(n int64) string { return strconv.FormatInt(n, 10) }
	f := func(x float64) string { return strconv.FormatFloat(x, 'f', 4, 64) }
	_ = w.Write(strings.Split("section,key,value,appointments,gmv_kobo,net_kobo", ","))
	for _, kv := range [][2]string{
		{"period", r.PeriodLabel}, {"generated_at", r.GeneratedAt.Format(time.RFC3339)},
		{"gmv_kobo", i(r.GMVKobo)}, {"net_revenue_kobo", i(r.NetRevenueKobo)},
		{"appointments_total", i(r.Appointments)}, {"tele_appointments", i(r.TeleAppointments)},
		{"home_appointments", i(r.HomeAppointments)}, {"clinic_appointments", i(r.ClinicAppointment)},
		{"completion_rate", f(r.CompletionRate)}, {"no_show_rate", f(r.NoShowRate)},
		{"refund_rate", f(r.RefundRate)}, {"eprescriptions", i(r.Eprescriptions)}, {"pom_share", f(r.POMShare)},
	} {
		_ = w.Write([]string{"summary", kv[0], kv[1], "", "", ""})
	}
	for _, st := range r.ByState {
		_ = w.Write([]string{"by_state", st.State, f(st.SharePct), i(st.Appointments), i(st.GMVKobo), ""})
	}
	for _, m := range r.Monthly {
		_ = w.Write([]string{"monthly", m.Month, "", i(m.Appointments), i(m.GMVKobo), i(m.NetKobo)})
	}
	w.Flush()
}
