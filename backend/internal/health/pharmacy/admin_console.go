package healthpharmacy

// Platform-wide admin console reads (PHARMACY admin): PCN application queue,
// catalog governance view, Rx audit, controlled log, payouts and reporting.
// Every handler sits behind per-route health.pharmacy.* RBAC. Patient and
// pharmacist identities are masked server-side (HL-8); amounts are int kobo.

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

const adminListLimit = 500

// Console vocabulary shared by the admin filters and derived statuses.
const (
	statusApproved   = "approved"
	statusPending    = "pending"
	statusRejected   = "rejected"
	catalogOTC       = "otc"
	nafdacRegistered = "REGISTERED"
)

// maskName keeps the first word and up to 6 runes of it, then "•••" (HL-8).
func maskName(prefix, name string) string {
	n := strings.TrimSpace(name)
	if n == "" {
		return prefix + "•••"
	}
	first := strings.Fields(n)[0]
	if utf8.RuneCountInString(first) > 6 {
		first = string([]rune(first)[:6])
	}
	return strings.TrimSpace(prefix+" "+first) + "•••"
}

// AdminPcnApplication is a PHARMACY provider application in the review queue.
type AdminPcnApplication struct {
	ID                 string             `json:"id"`
	PharmacyName       string             `json:"pharmacy_name"`
	SuperintendentMask string             `json:"superintendent_masked"`
	PcnPremisesNo      string             `json:"pcn_premises_no"`
	PcnPharmacistNo    string             `json:"pcn_pharmacist_no"`
	CacRcNo            string             `json:"cac_rc_no"`
	State              string             `json:"state"`
	LGA                string             `json:"lga"`
	Status             string             `json:"status"`
	PremisesVerified   bool               `json:"premises_verified"`
	PharmacistVerified bool               `json:"pharmacist_verified"`
	LicenceExpiresAt   *time.Time         `json:"licence_expires_at"`
	Docs               []AdminPcnDocument `json:"docs"`
	SubmittedAt        *time.Time         `json:"submitted_at"`
	CreatedAt          time.Time          `json:"created_at"`
}

// AdminPcnDocument is one credential document on an application.
type AdminPcnDocument struct {
	Kind      string     `json:"kind"`
	Reference string     `json:"reference"`
	ExpiresAt *time.Time `json:"expires_at"`
	Verified  bool       `json:"verified"`
}

var pcnStatuses = map[string]bool{"draft": true, "submitted": true, "under_review": true, "needs_info": true,
	statusApproved: true, "suspended": true, statusRejected: true}

// AdminListPcnApplications lists PHARMACY applications (newest first).
func (s *Service) AdminListPcnApplications(ctx context.Context, status, q string) ([]AdminPcnApplication, error) {
	args := []any{adminListLimit}
	where := ""
	if status != "" {
		args = append(args, strings.ToUpper(status))
		where += fmt.Sprintf(" AND a.state = $%d", len(args))
	}
	if q = strings.TrimSpace(q); q != "" {
		args = append(args, q)
		where += fmt.Sprintf(` AND (a.display_name ILIKE '%%'||$%d||'%%' OR a.id::text = $%d OR EXISTS (
			SELECT 1 FROM health_credential_docs d WHERE d.application_id = a.id AND d.reference_no ILIKE '%%'||$%d||'%%'))`,
			len(args), len(args), len(args))
	}
	query := fmt.Sprintf(`
		SELECT a.id, a.display_name, COALESCE(up.full_name, ''), lower(a.state), a.created_at,
		       CASE WHEN a.state <> 'DRAFT' THEN a.updated_at END
		FROM health_provider_applications a
		LEFT JOIN user_profiles up ON up.id = a.owner_user_id
		WHERE a.domain = 'PHARMACY'%s
		ORDER BY a.created_at DESC
		LIMIT $1`, where)
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: admin pcn applications: %w", err)
	}
	out := []AdminPcnApplication{}
	idx := map[string]int{}
	for rows.Next() {
		var a AdminPcnApplication
		var owner string
		if err := rows.Scan(&a.ID, &a.PharmacyName, &owner, &a.Status, &a.CreatedAt, &a.SubmittedAt); err != nil {
			rows.Close()
			return nil, err
		}
		a.SuperintendentMask = maskName("", owner)
		a.Docs = []AdminPcnDocument{}
		idx[a.ID] = len(out)
		out = append(out, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	ids := make([]string, 0, len(out))
	for _, a := range out {
		ids = append(ids, a.ID)
	}
	drows, err := s.db.Query(ctx, `
		SELECT application_id::text, cred_type, reference_no, expires_at, verified
		FROM health_credential_docs WHERE application_id = ANY($1::uuid[])
		ORDER BY created_at ASC`, ids)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: admin pcn docs: %w", err)
	}
	defer drows.Close()
	for drows.Next() {
		var appID string
		var d AdminPcnDocument
		if err := drows.Scan(&appID, &d.Kind, &d.Reference, &d.ExpiresAt, &d.Verified); err != nil {
			return nil, err
		}
		a := &out[idx[appID]]
		a.Docs = append(a.Docs, d)
		switch d.Kind {
		case "PREMISES":
			a.PcnPremisesNo, a.PremisesVerified = d.Reference, d.Verified
		case "PCN":
			a.PcnPharmacistNo, a.PharmacistVerified = d.Reference, d.Verified
		}
		if d.ExpiresAt != nil && (a.LicenceExpiresAt == nil || d.ExpiresAt.Before(*a.LicenceExpiresAt)) {
			a.LicenceExpiresAt = d.ExpiresAt
		}
	}
	return out, drows.Err()
}

// AdminCatalogItem is one catalog product with its governance status.
type AdminCatalogItem struct {
	ID             string    `json:"id"`
	ProductName    string    `json:"product_name"`
	Brand          string    `json:"brand"`
	PharmacyMasked string    `json:"pharmacy_masked"`
	NafdacRegNo    *string   `json:"nafdac_reg_no"`
	NafdacValid    bool      `json:"nafdac_valid"`
	Form           string    `json:"form"`
	Strength       string    `json:"strength"`
	POM            bool      `json:"pom"`
	Controlled     bool      `json:"controlled"`
	PriceKobo      int64     `json:"price_kobo"`
	Stock          int       `json:"stock"`
	Status         string    `json:"status"`
	FlaggedReason  *string   `json:"flagged_reason"`
	CreatedAt      time.Time `json:"created_at"`
}

// catalogStatusSQL derives the console status from nafdac_status + active.
const catalogStatusSQL = `CASE
	WHEN pr.nafdac_status = 'BANNED' THEN 'rejected'
	WHEN pr.nafdac_status = 'SUSPENDED' OR (pr.active = false AND pr.nafdac_status = 'REGISTERED') THEN 'suspended'
	WHEN pr.nafdac_status = 'REGISTERED' THEN 'approved'
	ELSE 'pending' END`

var catalogStatuses = map[string]bool{statusPending: true, statusApproved: true, statusRejected: true, "suspended": true}

// AdminListCatalog lists every product across pharmacies (no sellable filter).
func (s *Service) AdminListCatalog(ctx context.Context, status, pom, q string) ([]AdminCatalogItem, error) {
	args := []any{adminListLimit}
	where := ""
	if status != "" {
		args = append(args, status)
		where += fmt.Sprintf(" AND (%s) = $%d", catalogStatusSQL, len(args))
	}
	switch pom {
	case "pom":
		where += " AND pr.rx_required = true"
	case catalogOTC:
		where += " AND pr.rx_required = false"
	}
	if q = strings.TrimSpace(q); q != "" {
		args = append(args, q)
		where += fmt.Sprintf(" AND (pr.name ILIKE '%%'||$%d||'%%' OR pr.nafdac_ref ILIKE '%%'||$%d||'%%' OR pr.id::text = $%d)",
			len(args), len(args), len(args))
	}
	query := fmt.Sprintf(`
		SELECT pr.id, pr.name, COALESCE(hp.display_name, ''), NULLIF(btrim(COALESCE(pr.nafdac_ref, '')), ''),
		       pr.nafdac_status, pr.rx_required, pr.is_controlled, pr.price_kobo, pr.stock_qty, %s, pr.created_at
		FROM pharmacy_products pr
		LEFT JOIN health_providers hp ON hp.id = pr.pharmacy_provider_id
		WHERE true%s
		ORDER BY pr.created_at DESC
		LIMIT $1`, catalogStatusSQL, where)
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: admin catalog: %w", err)
	}
	defer rows.Close()
	out := []AdminCatalogItem{}
	for rows.Next() {
		var it AdminCatalogItem
		var nafdacStatus, pharmacy string
		if err := rows.Scan(&it.ID, &it.ProductName, &pharmacy, &it.NafdacRegNo, &nafdacStatus, &it.POM,
			&it.Controlled, &it.PriceKobo, &it.Stock, &it.Status, &it.CreatedAt); err != nil {
			return nil, err
		}
		it.PharmacyMasked = pharmacy
		it.NafdacValid = it.NafdacRegNo != nil && nafdacStatus == nafdacRegistered
		if reason := catalogFlag(nafdacStatus, it.NafdacRegNo == nil, it.Controlled); reason != "" {
			it.FlaggedReason = &reason
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

func catalogFlag(nafdacStatus string, noRef, controlled bool) string {
	switch {
	case controlled:
		return "Controlled substance — excluded at MVP (HL-4)"
	case noRef:
		return "No NAFDAC registration number (HL-5)"
	case nafdacStatus == "BANNED":
		return "NAFDAC: banned"
	case nafdacStatus == "SUSPENDED":
		return "NAFDAC: suspended"
	case nafdacStatus == "UNREGISTERED":
		return "NAFDAC: not registered"
	}
	return ""
}

// AdminRxAuditItem is one prescription's verification/dispense trail.
type AdminRxAuditItem struct {
	ID              string     `json:"id"`
	PatientMasked   string     `json:"patient_masked"`
	PrescriberMask  string     `json:"prescriber_masked"`
	PharmacyMasked  string     `json:"pharmacy_masked"`
	PharmacistMask  *string    `json:"pharmacist_masked"`
	Status          string     `json:"status"`
	PomItems        int        `json:"pom_items"`
	ControlledItems int        `json:"controlled_items"`
	DispenseOnceOK  bool       `json:"dispense_once_ok"`
	VerifyMinutes   *int       `json:"verify_minutes"`
	OrderRef        *string    `json:"order_ref"`
	IssuedAt        time.Time  `json:"issued_at"`
	VerifiedAt      *time.Time `json:"verified_at"`
	DispensedAt     *time.Time `json:"dispensed_at"`
}

var rxAuditStatuses = map[string]bool{"issued": true, "sent_to_pharmacy": true, "verifying": true,
	"verified": true, "dispensed": true, "fulfilled": true, statusRejected: true}

// AdminRxAudit lists prescriptions with their dispense trail (newest first).
// dispense_once_ok is false when more than one dispense record cites the Rx.
func (s *Service) AdminRxAudit(ctx context.Context, status, q string) ([]AdminRxAuditItem, error) {
	args := []any{adminListLimit}
	where := ""
	if status != "" {
		args = append(args, strings.ToUpper(status))
		where += fmt.Sprintf(" AND rx.state = $%d", len(args))
	}
	if q = strings.TrimSpace(q); q != "" {
		args = append(args, q)
		where += fmt.Sprintf(" AND (rx.id::text = $%d OR hp.display_name ILIKE '%%'||$%d||'%%')", len(args), len(args))
	}
	query := fmt.Sprintf(`
		SELECT rx.id, COALESCE(pt.full_name, ''), COALESCE(pb.full_name, ''), COALESCE(hp.display_name, ''),
		       vf.full_name, lower(rx.state),
		       (SELECT COUNT(*) FROM health_prescription_items it WHERE it.prescription_id = rx.id AND it.is_pom),
		       (SELECT COUNT(*) FROM health_prescription_items it WHERE it.prescription_id = rx.id AND it.is_controlled),
		       (SELECT COUNT(*) FROM dispense_records dr WHERE dr.prescription_id = rx.id),
		       (SELECT o.id::text FROM pharmacy_orders o WHERE o.prescription_id = rx.id ORDER BY o.created_at DESC LIMIT 1),
		       rx.created_at, rx.dispensed_at
		FROM health_prescriptions rx
		LEFT JOIN health_providers hp ON hp.id = rx.pharmacy_provider_id
		LEFT JOIN user_profiles pt ON pt.id = rx.patient_id
		LEFT JOIN user_profiles pb ON pb.id = rx.prescriber_id
		LEFT JOIN user_profiles vf ON vf.id = rx.verified_by
		WHERE true%s
		ORDER BY rx.created_at DESC
		LIMIT $1`, where)
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: admin rx audit: %w", err)
	}
	defer rows.Close()
	out := []AdminRxAuditItem{}
	for rows.Next() {
		var it AdminRxAuditItem
		var patient, prescriber string
		var pharmacist *string
		var dispenses int
		if err := rows.Scan(&it.ID, &patient, &prescriber, &it.PharmacyMasked, &pharmacist, &it.Status,
			&it.PomItems, &it.ControlledItems, &dispenses, &it.OrderRef, &it.IssuedAt, &it.DispensedAt); err != nil {
			return nil, err
		}
		it.PatientMasked = maskName("pt", patient)
		it.PrescriberMask = maskName("", prescriber)
		if pharmacist != nil {
			m := maskName("Pharm.", *pharmacist)
			it.PharmacistMask = &m
		}
		it.DispenseOnceOK = dispenses <= 1
		out = append(out, it)
	}
	return out, rows.Err()
}

// AdminControlledEntry is one controlled-substance dispense (HL-4 register).
type AdminControlledEntry struct {
	ID             string    `json:"id"`
	Substance      string    `json:"substance"`
	Schedule       string    `json:"schedule"`
	PharmacyMasked string    `json:"pharmacy_masked"`
	AttemptedBy    string    `json:"attempted_by_masked"`
	Outcome        string    `json:"outcome"`
	Reason         string    `json:"reason"`
	CreatedAt      time.Time `json:"created_at"`
}

// AdminControlledLog lists dispensed controlled lines platform-wide. Controlled
// products are CHECK-excluded at MVP, so this is empty until they are enabled.
func (s *Service) AdminControlledLog(ctx context.Context, q string) ([]AdminControlledEntry, error) {
	args := []any{adminListLimit}
	where := ""
	if q = strings.TrimSpace(q); q != "" {
		args = append(args, q)
		where = fmt.Sprintf(" AND (ol.product_name ILIKE '%%'||$%d||'%%' OR hp.display_name ILIKE '%%'||$%d||'%%')", len(args), len(args))
	}
	query := fmt.Sprintf(`
		SELECT ol.id, ol.product_name, COALESCE(hp.display_name, ''), COALESCE(ph.full_name, ''), dr.created_at
		FROM dispense_records dr
		JOIN pharmacy_orders o       ON o.id = dr.order_id
		JOIN pharmacy_order_lines ol ON ol.order_id = o.id
		JOIN pharmacy_products pr    ON pr.id = ol.product_id
		LEFT JOIN health_providers hp ON hp.id = o.pharmacy_provider_id
		LEFT JOIN user_profiles ph   ON ph.id = dr.pharmacist_id
		WHERE pr.is_controlled = true%s
		ORDER BY dr.created_at DESC
		LIMIT $1`, where)
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: admin controlled log: %w", err)
	}
	defer rows.Close()
	out := []AdminControlledEntry{}
	for rows.Next() {
		var e AdminControlledEntry
		var pharmacist string
		if err := rows.Scan(&e.ID, &e.Substance, &e.PharmacyMasked, &pharmacist, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Schedule = "Schedule (controlled)"
		e.AttemptedBy = maskName("Pharm.", pharmacist)
		e.Outcome = "logged"
		e.Reason = "Controlled-substance dispense recorded"
		out = append(out, e)
	}
	return out, rows.Err()
}

// AdminPayout is one pharmacy's settlement position (released escrow to date).
// Release is automatic on order completion (HL-9) behind the KYC gate (HL-10),
// so there is no pending payout to approve — status reflects the gate.
type AdminPayout struct {
	ID             string    `json:"id"` // pharmacy provider id
	PharmacyMasked string    `json:"pharmacy_masked"`
	KycTier        string    `json:"kyc_tier"`
	KycVerified    bool      `json:"kyc_verified"`
	CollectedKobo  int64     `json:"collected_kobo"`
	FeesKobo       int64     `json:"fees_kobo"`
	NetPayableKobo int64     `json:"net_payable_kobo"`
	HeldKobo       int64     `json:"held_kobo"`
	PayoutStatus   string    `json:"payout_status"`
	AmlFlag        bool      `json:"aml_flag"`
	CreatedAt      time.Time `json:"created_at"`
}

// AdminListPayouts aggregates released/held escrow per pharmacy. fees_kobo is
// the platform commission recorded for those orders (commission_earnings).
func (s *Service) AdminListPayouts(ctx context.Context, payoutStatus, q string) ([]AdminPayout, error) {
	args := []any{adminListLimit}
	where := ""
	if q = strings.TrimSpace(q); q != "" {
		args = append(args, q)
		where = fmt.Sprintf(" AND (hp.display_name ILIKE '%%'||$%d||'%%' OR hp.id::text = $%d)", len(args), len(args))
	}
	query := fmt.Sprintf(`
		SELECT hp.id, hp.display_name, COALESCE(kp.kyc_tier, 0), hp.created_at,
		       COALESCE(SUM(eh.amount_kobo) FILTER (WHERE eh.state = 'RELEASED'), 0),
		       COALESCE(SUM(eh.amount_kobo) FILTER (WHERE eh.state = 'HELD'), 0),
		       COALESCE((SELECT SUM(ce.spotlight_revenue_kobo) FROM commission_earnings ce
		                 WHERE ce.source_module = 'health.pharmacy'
		                   AND ce.source_ref IN (SELECT o2.id::text FROM pharmacy_orders o2 WHERE o2.pharmacy_provider_id = hp.id)), 0)
		FROM health_providers hp
		LEFT JOIN user_profiles kp   ON kp.id = hp.owner_user_id
		LEFT JOIN pharmacy_orders o  ON o.pharmacy_provider_id = hp.id
		LEFT JOIN escrow_holds eh    ON eh.id = o.escrow_id
		WHERE hp.domain = 'PHARMACY'%s
		GROUP BY hp.id, hp.display_name, kp.kyc_tier, hp.created_at
		ORDER BY hp.display_name ASC
		LIMIT $1`, where)
	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("pharmacy: admin payouts: %w", err)
	}
	defer rows.Close()
	out := []AdminPayout{}
	for rows.Next() {
		var p AdminPayout
		var tier int
		if err := rows.Scan(&p.ID, &p.PharmacyMasked, &tier, &p.CreatedAt, &p.CollectedKobo, &p.HeldKobo, &p.FeesKobo); err != nil {
			return nil, err
		}
		p.KycTier = fmt.Sprintf("tier%d", tier)
		p.KycVerified = tier >= 1
		p.NetPayableKobo = p.CollectedKobo
		p.PayoutStatus = payoutStatusFor(p.KycVerified, p.CollectedKobo, p.HeldKobo)
		if payoutStatus != "" && p.PayoutStatus != payoutStatus {
			continue
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func payoutStatusFor(kycOK bool, released, held int64) string {
	switch {
	case !kycOK && held > 0:
		return "kyc_hold"
	case held > 0:
		return statusPending
	case released > 0:
		return "paid"
	}
	return statusPending
}
