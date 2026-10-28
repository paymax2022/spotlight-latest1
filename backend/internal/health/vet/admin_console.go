package healthvet

// Read-only admin console surface for the vet vertical (frontend-admin
// /admin/health/vet/*). Every method here is a SELECT: nothing in this file
// moves money, changes a state or writes a row. Response rows are shaped for the
// console's own types (frontend-admin/src/types/healthVetAdmin.ts), snake_case.
//
// Honesty rules, same as AdminDashboard:
//   - owners are masked (HL-8): "Owner ····" + the last four of the id; vets show
//     their professional display name, never contact details;
//   - a field the backend has no source for is omitted or zero, not invented —
//     there is no vet moderation store, so ListModeration answers an empty list;
//   - the payout view is DERIVED from the escrow legs (vet_appointment_payments
//     RELEASED) and the commission rows already recorded; deciding a payout is
//     not built here (it is a money mutation and needs its own spec).

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func maskedOwner(id string) string {
	if len(id) < 4 {
		return "Owner ····"
	}
	return "Owner ····" + id[len(id)-4:]
}

func lowerState(s string) string { return strings.ToLower(s) }

// AdminConsoleAppointment is VetAppointment in the console's types.
type AdminConsoleAppointment struct {
	ID             string    `json:"id"`
	PetName        string    `json:"pet_name"`
	PetSpecies     string    `json:"pet_species"`
	OwnerMasked    string    `json:"owner_masked"`
	VetMasked      string    `json:"vet_masked"`
	ClinicMasked   string    `json:"clinic_masked"`
	Mode           string    `json:"mode"`
	ServiceSummary string    `json:"service_summary"`
	Status         string    `json:"status"`
	PaymentState   string    `json:"payment_state"`
	FeeKobo        int64     `json:"fee_kobo"`
	IsEmergency    bool      `json:"is_emergency"`
	ScheduledAt    time.Time `json:"scheduled_at"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

const consoleAppointmentSelect = `
	SELECT vp.appointment_id::text, COALESCE(pt.name,''), COALESCE(lower(pt.species),''),
	       vp.owner_id::text, COALESCE(hp.display_name,''),
	       COALESCE(dv.profile_draft->'draft'->'affiliations'->0->>'name',''),
	       lower(vp.visit_type), COALESCE(sv.name,''), lower(ap.state), lower(vp.pay_state),
	       vp.total_kobo, ap.slot_start, vp.created_at, ap.updated_at
	FROM vet_appointment_payments vp
	JOIN health_appointments ap ON ap.id = vp.appointment_id
	LEFT JOIN pets pt ON pt.id = vp.pet_id
	LEFT JOIN health_providers hp ON hp.id = vp.provider_id
	LEFT JOIN doctor_vet_profiles dv ON dv.user_id = hp.owner_user_id
	LEFT JOIN vet_services sv ON sv.id = vp.service_id`

func scanConsoleAppointment(row interface{ Scan(...any) error }) (AdminConsoleAppointment, error) {
	var a AdminConsoleAppointment
	var owner string
	err := row.Scan(&a.ID, &a.PetName, &a.PetSpecies, &owner, &a.VetMasked, &a.ClinicMasked,
		&a.Mode, &a.ServiceSummary, &a.Status, &a.PaymentState, &a.FeeKobo,
		&a.ScheduledAt, &a.CreatedAt, &a.UpdatedAt)
	a.OwnerMasked = maskedOwner(owner)
	return a, err
}

// AdminConsoleAppointments lists vet appointments, newest first.
func (s *Service) AdminConsoleAppointments(ctx context.Context) ([]AdminConsoleAppointment, error) {
	rows, err := s.db.Query(ctx, consoleAppointmentSelect+` ORDER BY vp.created_at DESC LIMIT 500`)
	if err != nil {
		return nil, fmt.Errorf("vet: console appointments: %w", err)
	}
	defer rows.Close()
	out := []AdminConsoleAppointment{}
	for rows.Next() {
		a, err := scanConsoleAppointment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// AdminConsoleAppointmentDetail is the list row plus the lifecycle facts the
// backend actually records. Intake, consent and timeline have no source row yet.
type AdminConsoleAppointmentDetail struct {
	AdminConsoleAppointment
	TriageSummary      *string  `json:"triage_summary"`
	ConsultNotePresent bool     `json:"consult_note_present"`
	EprescriptionRef   *string  `json:"eprescription_ref"`
	LabOrderRef        *string  `json:"lab_order_ref"`
	ConsentOnFile      bool     `json:"consent_on_file"`
	Timeline           []string `json:"timeline"`
}

func (s *Service) AdminConsoleAppointment(ctx context.Context, id string) (*AdminConsoleAppointmentDetail, error) {
	a, err := scanConsoleAppointment(s.db.QueryRow(ctx, consoleAppointmentSelect+` WHERE vp.appointment_id = $1`, id))
	if err != nil {
		return nil, ErrAppointmentNotFound
	}
	d := &AdminConsoleAppointmentDetail{AdminConsoleAppointment: a, Timeline: []string{}}
	var consultID *string
	_ = s.db.QueryRow(ctx, `SELECT consult_id::text FROM vet_appointment_payments WHERE appointment_id=$1`, id).Scan(&consultID)
	if consultID != nil {
		var rx string
		if err := s.db.QueryRow(ctx, `SELECT id::text FROM health_prescriptions WHERE consult_id=$1 ORDER BY created_at DESC LIMIT 1`, *consultID).Scan(&rx); err == nil {
			d.EprescriptionRef = &rx
		}
		_ = s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vet_consult_summary_extras WHERE consult_id=$1)`, *consultID).Scan(&d.ConsultNotePresent)
	}
	return d, nil
}

// AdminConsoleVCN is VcnApplication, drawn from the vet provider + its profile.
type AdminConsoleVCN struct {
	ID               string     `json:"id"`
	VetNameMasked    string     `json:"vet_name_masked"`
	ClinicName       string     `json:"clinic_name"`
	VCNLicenceNo     string     `json:"vcn_licence_no"`
	VCNRegisterYear  int        `json:"vcn_register_year"`
	CacRcNo          string     `json:"cac_rc_no"`
	Specialties      []string   `json:"specialties"`
	State            string     `json:"state"`
	LGA              string     `json:"lga"`
	Status           string     `json:"status"`
	VCNVerified      bool       `json:"vcn_verified"`
	LicenceExpiresAt *time.Time `json:"licence_expires_at"`
	Docs             []string   `json:"docs"`
	SubmittedAt      *time.Time `json:"submitted_at"`
	CreatedAt        time.Time  `json:"created_at"`
}

func (s *Service) AdminConsoleVCN(ctx context.Context) ([]AdminConsoleVCN, error) {
	rows, err := s.db.Query(ctx, `
		SELECT hp.id::text, hp.display_name,
		       COALESCE(dv.profile_draft->'draft'->'affiliations'->0->>'name',''),
		       COALESCE(dv.licence_number,''), hp.status, COALESCE(dv.verification,''), hp.created_at
		FROM health_providers hp
		LEFT JOIN doctor_vet_profiles dv ON dv.user_id = hp.owner_user_id
		WHERE hp.domain='VET'
		ORDER BY hp.created_at DESC LIMIT 500`)
	if err != nil {
		return nil, fmt.Errorf("vet: console vcn: %w", err)
	}
	defer rows.Close()
	out := []AdminConsoleVCN{}
	for rows.Next() {
		var v AdminConsoleVCN
		var status, verification string
		if err := rows.Scan(&v.ID, &v.VetNameMasked, &v.ClinicName, &v.VCNLicenceNo, &status, &verification, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Specialties, v.Docs = []string{}, []string{}
		switch {
		case status == "APPROVED" && verification == "approved":
			v.Status, v.VCNVerified = "approved", true
		case status == "SUSPENDED":
			v.Status = "suspended"
		case status == "REJECTED":
			v.Status = "rejected"
		case verification == "pending":
			v.Status = "under_review"
		default:
			v.Status = "submitted"
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// AdminConsoleERx is EprescriptionAuditItem.
type AdminConsoleERx struct {
	ID             string     `json:"id"`
	AppointmentRef string     `json:"appointment_ref"`
	PetName        string     `json:"pet_name"`
	PetSpecies     string     `json:"pet_species"`
	OwnerMasked    string     `json:"owner_masked"`
	VetMasked      string     `json:"vet_masked"`
	VCNLicenceNo   string     `json:"vcn_licence_no"`
	DrugSummary    string     `json:"drug_summary"`
	IsPOM          bool       `json:"is_pom"`
	IsControlled   bool       `json:"is_controlled"`
	Status         string     `json:"status"`
	DispenseOnceOK bool       `json:"dispense_once_ok"`
	Flagged        bool       `json:"flagged"`
	FlagReason     *string    `json:"flag_reason"`
	IssuedAt       time.Time  `json:"issued_at"`
	DispensedAt    *time.Time `json:"dispensed_at"`
}

func (s *Service) AdminConsoleERx(ctx context.Context) ([]AdminConsoleERx, error) {
	rows, err := s.db.Query(ctx, `
		SELECT rp.id::text, COALESCE(vp.appointment_id::text,''), COALESCE(pt.name,''), COALESCE(lower(pt.species),''),
		       rp.patient_id::text, COALESCE(hp.display_name,''), COALESCE(dv.licence_number,''),
		       COALESCE((SELECT string_agg(i.drug_name || COALESCE(' '||i.dosage,'') || ' ×' || i.quantity, ', ')
		                 FROM health_prescription_items i WHERE i.prescription_id = rp.id),''),
		       COALESCE((SELECT bool_or(i.is_pom) FROM health_prescription_items i WHERE i.prescription_id = rp.id), false),
		       COALESCE((SELECT bool_or(i.is_controlled) FROM health_prescription_items i WHERE i.prescription_id = rp.id), false),
		       lower(rp.state), rp.refills_used <= rp.refills_authorized, rp.created_at, rp.dispensed_at
		FROM health_prescriptions rp
		JOIN vet_appointment_payments vp ON vp.consult_id = rp.consult_id
		LEFT JOIN pets pt ON pt.id = vp.pet_id
		LEFT JOIN health_providers hp ON hp.id = vp.provider_id
		LEFT JOIN doctor_vet_profiles dv ON dv.user_id = hp.owner_user_id
		ORDER BY rp.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("vet: console erx: %w", err)
	}
	defer rows.Close()
	out := []AdminConsoleERx{}
	for rows.Next() {
		var e AdminConsoleERx
		var owner string
		if err := rows.Scan(&e.ID, &e.AppointmentRef, &e.PetName, &e.PetSpecies, &owner, &e.VetMasked, &e.VCNLicenceNo,
			&e.DrugSummary, &e.IsPOM, &e.IsControlled, &e.Status, &e.DispenseOnceOK, &e.IssuedAt, &e.DispensedAt); err != nil {
			return nil, err
		}
		e.OwnerMasked = maskedOwner(owner)
		if !e.DispenseOnceOK {
			reason := "refills used exceed refills authorised"
			e.Flagged, e.FlagReason = true, &reason
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// AdminConsoleService is VetService (the console's governance row).
type AdminConsoleService struct {
	ID              string    `json:"id"`
	ServiceName     string    `json:"service_name"`
	Mode            string    `json:"mode"`
	Category        string    `json:"category"`
	VetMasked       string    `json:"vet_masked"`
	ClinicMasked    string    `json:"clinic_masked"`
	DurationMinutes int       `json:"duration_minutes"`
	FeeKobo         int64     `json:"fee_kobo"`
	PlatformFeePct  float64   `json:"platform_fee_pct"`
	Status          string    `json:"status"`
	FlaggedReason   *string   `json:"flagged_reason"`
	CreatedAt       time.Time `json:"created_at"`
}

func (s *Service) AdminConsoleServices(ctx context.Context) ([]AdminConsoleService, error) {
	rows, err := s.db.Query(ctx, `
		SELECT sv.id::text, sv.name, lower(sv.visit_type), COALESCE(hp.display_name,''),
		       COALESCE(dv.profile_draft->'draft'->'affiliations'->0->>'name',''),
		       sv.price_kobo, sv.active, sv.created_at
		FROM vet_services sv
		LEFT JOIN health_providers hp ON hp.id = sv.provider_id
		LEFT JOIN doctor_vet_profiles dv ON dv.user_id = hp.owner_user_id
		ORDER BY sv.created_at DESC LIMIT 500`)
	if err != nil {
		return nil, fmt.Errorf("vet: console services: %w", err)
	}
	defer rows.Close()
	out := []AdminConsoleService{}
	for rows.Next() {
		var v AdminConsoleService
		var active bool
		if err := rows.Scan(&v.ID, &v.ServiceName, &v.Mode, &v.VetMasked, &v.ClinicMasked, &v.FeeKobo, &active, &v.CreatedAt); err != nil {
			return nil, err
		}
		v.Category = "consult"
		// vet_services carries only active/inactive; a deactivated service is
		// "suspended" (AdminDeactivateService is the only way it goes false).
		v.Status = "approved"
		if !active {
			v.Status = "suspended"
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// AdminConsolePayout is VetPayoutRecord, derived per vet from RELEASED escrow legs.
type AdminConsolePayout struct {
	ID             string    `json:"id"`
	VetMasked      string    `json:"vet_masked"`
	ClinicMasked   string    `json:"clinic_masked"`
	KYCTier        string    `json:"kyc_tier"`
	KYCVerified    bool      `json:"kyc_verified"`
	ReleasedKobo   int64     `json:"released_kobo"`
	FeesKobo       int64     `json:"fees_kobo"`
	NetPayableKobo int64     `json:"net_payable_kobo"`
	PayoutStatus   string    `json:"payout_status"`
	AMLFlag        bool      `json:"aml_flag"`
	CreatedAt      time.Time `json:"created_at"`
}

func (s *Service) AdminConsolePayouts(ctx context.Context) ([]AdminConsolePayout, error) {
	rows, err := s.db.Query(ctx, `
		SELECT hp.id::text, hp.display_name,
		       COALESCE(dv.profile_draft->'draft'->'affiliations'->0->>'name',''),
		       SUM(vp.total_kobo), MIN(vp.created_at),
		       COALESCE((SELECT SUM(ce.spotlight_revenue_kobo) FROM commission_earnings ce
		                 WHERE ce.source_module='health.vet' AND ce.source_ref = ANY(array_agg(vp.appointment_id::text))),0)
		FROM vet_appointment_payments vp
		JOIN health_providers hp ON hp.id = vp.provider_id
		LEFT JOIN doctor_vet_profiles dv ON dv.user_id = hp.owner_user_id
		WHERE vp.pay_state = 'RELEASED'
		GROUP BY hp.id, hp.display_name, dv.profile_draft
		ORDER BY MIN(vp.created_at) DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("vet: console payouts: %w", err)
	}
	defer rows.Close()
	out := []AdminConsolePayout{}
	for rows.Next() {
		var p AdminConsolePayout
		if err := rows.Scan(&p.ID, &p.VetMasked, &p.ClinicMasked, &p.ReleasedKobo, &p.CreatedAt, &p.FeesKobo); err != nil {
			return nil, err
		}
		p.NetPayableKobo = p.ReleasedKobo - p.FeesKobo
		// No payout-run table exists for vets: every row is an accrual awaiting one.
		p.PayoutStatus, p.KYCTier = "pending", "unknown"
		out = append(out, p)
	}
	return out, rows.Err()
}

// AdminConsoleReporting aggregates vet_appointment_payments. gmv is the sum of
// total_kobo over non-cancelled legs; net is the recorded commission revenue.
type AdminConsoleReporting struct {
	GeneratedAt       time.Time              `json:"generated_at"`
	PeriodLabel       string                 `json:"period_label"`
	GMVKobo           int64                  `json:"gmv_kobo"`
	NetRevenueKobo    int64                  `json:"net_revenue_kobo"`
	Appointments      int64                  `json:"appointments"`
	TeleAppointments  int64                  `json:"tele_appointments"`
	HomeAppointments  int64                  `json:"home_appointments"`
	ClinicAppointment int64                  `json:"clinic_appointments"`
	CompletionRate    float64                `json:"completion_rate"`
	NoShowRate        float64                `json:"no_show_rate"`
	RefundRate        float64                `json:"refund_rate"`
	Eprescriptions    int64                  `json:"eprescriptions"`
	POMShare          float64                `json:"pom_share"`
	SOSRouted         int64                  `json:"sos_routed"`
	PayoutsKYCHold    int64                  `json:"payouts_kyc_hold"`
	ByState           []AdminConsoleStateRow `json:"by_state"`
	Monthly           []AdminConsoleMonthRow `json:"monthly"`
}

type AdminConsoleStateRow struct {
	State        string  `json:"state"`
	Appointments int64   `json:"appointments"`
	GMVKobo      int64   `json:"gmv_kobo"`
	SharePct     float64 `json:"share_pct"`
}

type AdminConsoleMonthRow struct {
	Month        string `json:"month"`
	GMVKobo      int64  `json:"gmv_kobo"`
	NetKobo      int64  `json:"net_kobo"`
	Appointments int64  `json:"appointments"`
}

func ratio(n, d int64) float64 {
	if d == 0 {
		return 0
	}
	return float64(n) / float64(d)
}

func (s *Service) AdminConsoleReporting(ctx context.Context) (*AdminConsoleReporting, error) {
	r := &AdminConsoleReporting{GeneratedAt: time.Now().UTC(), PeriodLabel: "All time", ByState: []AdminConsoleStateRow{}, Monthly: []AdminConsoleMonthRow{}}

	var completed, noShow, refunded int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(*),
		       COUNT(*) FILTER (WHERE vp.visit_type='TELE'), COUNT(*) FILTER (WHERE vp.visit_type='HOME'), COUNT(*) FILTER (WHERE vp.visit_type='CLINIC'),
		       COUNT(*) FILTER (WHERE ap.state='COMPLETED'), COUNT(*) FILTER (WHERE ap.state='NO_SHOW'), COUNT(*) FILTER (WHERE vp.pay_state='REFUNDED'),
		       COALESCE(SUM(vp.total_kobo) FILTER (WHERE vp.pay_state <> 'REFUNDED'),0)
		FROM vet_appointment_payments vp JOIN health_appointments ap ON ap.id = vp.appointment_id`,
	).Scan(&r.Appointments, &r.TeleAppointments, &r.HomeAppointments, &r.ClinicAppointment, &completed, &noShow, &refunded, &r.GMVKobo); err != nil {
		return nil, fmt.Errorf("vet: console reporting totals: %w", err)
	}
	r.CompletionRate, r.NoShowRate, r.RefundRate = ratio(completed, r.Appointments), ratio(noShow, r.Appointments), ratio(refunded, r.Appointments)

	if err := s.db.QueryRow(ctx, `SELECT COALESCE(SUM(spotlight_revenue_kobo),0) FROM commission_earnings WHERE source_module='health.vet'`).Scan(&r.NetRevenueKobo); err != nil {
		return nil, fmt.Errorf("vet: console reporting revenue: %w", err)
	}

	var pom int64
	if err := s.db.QueryRow(ctx, `
		SELECT COUNT(DISTINCT rp.id), COUNT(DISTINCT rp.id) FILTER (WHERE i.is_pom)
		FROM health_prescriptions rp
		JOIN vet_appointment_payments vp ON vp.consult_id = rp.consult_id
		LEFT JOIN health_prescription_items i ON i.prescription_id = rp.id`).Scan(&r.Eprescriptions, &pom); err != nil {
		return nil, fmt.Errorf("vet: console reporting erx: %w", err)
	}
	r.POMShare = ratio(pom, r.Eprescriptions)

	rows, err := s.db.Query(ctx, `
		SELECT lower(ap.state), COUNT(*), COALESCE(SUM(vp.total_kobo),0)
		FROM vet_appointment_payments vp JOIN health_appointments ap ON ap.id = vp.appointment_id
		GROUP BY ap.state ORDER BY COUNT(*) DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var st AdminConsoleStateRow
		if err := rows.Scan(&st.State, &st.Appointments, &st.GMVKobo); err != nil {
			return nil, err
		}
		st.SharePct = ratio(st.Appointments, r.Appointments) * 100
		r.ByState = append(r.ByState, st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	mrows, err := s.db.Query(ctx, `
		WITH m AS (
			SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month, COUNT(*) AS n, COALESCE(SUM(total_kobo),0) AS gmv
			FROM vet_appointment_payments GROUP BY 1
		), c AS (
			SELECT to_char(date_trunc('month', created_at),'YYYY-MM') AS month, SUM(spotlight_revenue_kobo) AS net
			FROM commission_earnings WHERE source_module='health.vet' GROUP BY 1
		)
		SELECT m.month, m.n, m.gmv, COALESCE(c.net,0) FROM m LEFT JOIN c USING (month) ORDER BY m.month DESC LIMIT 12`)
	if err != nil {
		return nil, err
	}
	defer mrows.Close()
	for mrows.Next() {
		var m AdminConsoleMonthRow
		if err := mrows.Scan(&m.Month, &m.Appointments, &m.GMVKobo, &m.NetKobo); err != nil {
			return nil, err
		}
		r.Monthly = append(r.Monthly, m)
	}
	return r, mrows.Err()
}

// ── handlers ────────────────────────────────────────────────────────────────

func consoleOK(c *gin.Context, data any, err error) {
	if err != nil {
		failErr(c, 500, err)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": data})
}

func (h *Handler) AdminConsoleAppointments(c *gin.Context) {
	d, err := h.svc.AdminConsoleAppointments(c.Request.Context())
	consoleOK(c, d, err)
}

func (h *Handler) AdminConsoleAppointment(c *gin.Context) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(400, gin.H{"success": false, "error": "id must be a uuid"})
		return
	}
	d, err := h.svc.AdminConsoleAppointment(c.Request.Context(), id)
	if err != nil {
		c.JSON(404, gin.H{"success": false, "error": "appointment not found"})
		return
	}
	c.JSON(200, gin.H{"success": true, "data": d})
}

func (h *Handler) AdminConsoleVCN(c *gin.Context) {
	d, err := h.svc.AdminConsoleVCN(c.Request.Context())
	consoleOK(c, d, err)
}

func (h *Handler) AdminConsoleERx(c *gin.Context) {
	d, err := h.svc.AdminConsoleERx(c.Request.Context())
	consoleOK(c, d, err)
}

func (h *Handler) AdminConsoleServices(c *gin.Context) {
	d, err := h.svc.AdminConsoleServices(c.Request.Context())
	consoleOK(c, d, err)
}

func (h *Handler) AdminConsolePayouts(c *gin.Context) {
	d, err := h.svc.AdminConsolePayouts(c.Request.Context())
	consoleOK(c, d, err)
}

// AdminConsoleModeration: there is no vet moderation store, so the honest
// answer is an empty queue, not a fabricated one.
func (h *Handler) AdminConsoleModeration(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": []any{}})
}

func (h *Handler) AdminConsoleReporting(c *gin.Context) {
	d, err := h.svc.AdminConsoleReporting(c.Request.Context())
	consoleOK(c, d, err)
}
