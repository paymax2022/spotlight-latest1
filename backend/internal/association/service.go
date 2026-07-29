package association

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
)

// ErrIdempotencyRequired is returned when a money mutation arrives without an
// Idempotency-Key (fail-closed, per the money-handling iron rules).
var ErrIdempotencyRequired = errors.New("association: Idempotency-Key required")

// ErrForbidden is returned when a member acts on another member's record.
var ErrForbidden = errors.New("association: forbidden")

// Service manages association dues payments, receipts, and admin approvals.
type Service struct {
	db     *pgxpool.Pool
	ledger *ledger.Service
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service) *Service {
	return &Service{db: db, ledger: ledger}
}

// GetDues returns the caller's outstanding + paid dues for the current year.
func (s *Service) GetDues(ctx context.Context, userID string) (*DuesSummary, error) {
	const q = `
		SELECT i.id, i.title, i.description, i.amount_kobo, i.cadence, i.status, i.scope, i.due_date
		FROM assoc_dues_invoices i
		JOIN assoc_memberships m ON m.id = i.membership_id
		WHERE m.user_id = $1
		ORDER BY i.due_date DESC`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("association: list dues: %w", err)
	}
	defer rows.Close()

	out := &DuesSummary{Invoices: []Invoice{}}
	for rows.Next() {
		var inv Invoice
		if err := rows.Scan(&inv.ID, &inv.Title, &inv.Description, &inv.AmountKobo, &inv.Cadence, &inv.Status, &inv.Scope, &inv.DueDate); err != nil {
			return nil, err
		}
		switch inv.Status {
		case "DUE", "OVERDUE", "PROCESSING":
			out.OutstandingKobo += inv.AmountKobo
		case "PAID":
			out.PaidThisYearKobo += inv.AmountKobo
		}
		out.Invoices = append(out.Invoices, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out.Standing = "PAID"
	if out.OutstandingKobo > 0 {
		out.Standing = "DUE"
	}
	return out, nil
}

// PayInvoice debits the member's wallet and credits the settlement account,
// posting a balanced double-entry via the ledger, recording the revenue split,
// marking the invoice paid, and writing an audit event. Idempotent.
func (s *Service) PayInvoice(ctx context.Context, userID, invoiceID string, req PayInvoiceRequest) (*PayInvoiceResult, error) {
	if req.IdempotencyKey == "" {
		return nil, ErrIdempotencyRequired
	}

	// Load the invoice + its owner.
	var (
		amount     int64
		title      string
		status     string
		ownerID    string
		membership string
		orgName    string
	)
	const qInv = `
		SELECT i.amount_kobo, i.title, i.status, m.user_id, m.id, o.name
		FROM assoc_dues_invoices i
		JOIN assoc_memberships m ON m.id = i.membership_id
		JOIN assoc_organisations o ON o.id = m.organisation_id
		WHERE i.id = $1`
	if err := s.db.QueryRow(ctx, qInv, invoiceID).Scan(&amount, &title, &status, &ownerID, &membership, &orgName); err != nil {
		return nil, fmt.Errorf("association: invoice not found: %w", err)
	}
	if ownerID != userID {
		return nil, ErrForbidden
	}
	if status == "PAID" {
		// Already settled — return the existing receipt id idempotently.
		return &PayInvoiceResult{ReceiptID: "rcpt_" + invoiceID, Status: "SUCCESS"}, nil
	}

	// Settlement standing account receives the credit (balanced double-entry).
	settle, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, fmt.Errorf("association: settlement account: %w", err)
	}

	// Ledger debit (idempotent on IdempotencyKey).
	ref := "assoc_dues:" + invoiceID
	if err := s.ledger.Debit(ctx, userID, ref, req.IdempotencyKey, settle.ID, amount); err != nil {
		return nil, fmt.Errorf("association: dues debit: %w", err)
	}

	// Bookkeeping rows (payment, revenue split, invoice status, audit) in one tx.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	paymentID := uuid.New().String()
	const insPayment = `
		INSERT INTO assoc_payments (id, invoice_id, membership_id, amount_kobo, method, reference, status, offline, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,'SUCCESS',false,$7)
		ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`
	if _, err := tx.Exec(ctx, insPayment, paymentID, invoiceID, membership, amount, req.Method, ref, req.IdempotencyKey); err != nil {
		return nil, fmt.Errorf("association: insert payment: %w", err)
	}
	for _, line := range RevenueSplit(amount) {
		const insSplit = `INSERT INTO assoc_revenue_splits (id, payment_id, label, amount_kobo) VALUES ($1,$2,$3,$4)`
		if _, err := tx.Exec(ctx, insSplit, uuid.New().String(), paymentID, line.Label, line.AmountKobo); err != nil {
			return nil, fmt.Errorf("association: insert split: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE assoc_dues_invoices SET status='PAID' WHERE id=$1`, invoiceID); err != nil {
		return nil, fmt.Errorf("association: mark invoice paid: %w", err)
	}
	if err := s.audit(ctx, tx, "", userID, "DUES_PAY", "invoice", invoiceID, map[string]any{"amountKobo": amount, "method": req.Method}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("association: commit: %w", err)
	}

	return &PayInvoiceResult{ReceiptID: "rcpt_" + invoiceID, Status: "SUCCESS"}, nil
}

// GetReceipt rebuilds a receipt for a settled invoice (receiptID = rcpt_<invoiceID>).
func (s *Service) GetReceipt(ctx context.Context, userID, receiptID string) (*Receipt, error) {
	invoiceID := receiptID
	if len(receiptID) > 5 && receiptID[:5] == "rcpt_" {
		invoiceID = receiptID[5:]
	}
	var (
		r          Receipt
		ownerID    string
		paymentID  string
		method     string
		paidAt     time.Time
		memberName *string
	)
	const q = `
		SELECT p.id, p.reference, i.title, p.amount_kobo, p.method, p.created_at,
		       m.user_id, o.name, mp.full_name
		FROM assoc_payments p
		JOIN assoc_dues_invoices i ON i.id = p.invoice_id
		JOIN assoc_memberships m ON m.id = p.membership_id
		JOIN assoc_organisations o ON o.id = m.organisation_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id = m.id
		WHERE p.invoice_id = $1
		ORDER BY p.created_at DESC LIMIT 1`
	if err := s.db.QueryRow(ctx, q, invoiceID).Scan(
		&paymentID, &r.Reference, &r.InvoiceTitle, &r.AmountKobo, &method, &paidAt,
		&ownerID, &r.OrganisationName, &memberName,
	); err != nil {
		return nil, fmt.Errorf("association: receipt not found: %w", err)
	}
	if ownerID != userID {
		return nil, ErrForbidden
	}
	r.ID = receiptID
	r.Method = method
	r.PaidAt = paidAt
	if memberName != nil {
		r.MemberName = *memberName
	}
	r.Split = RevenueSplit(r.AmountKobo)
	return &r, nil
}

// DecideApplication records an admin approval decision and audits it.
func (s *Service) DecideApplication(ctx context.Context, adminID, appID string, req ApprovalDecisionRequest) error {
	if req.IdempotencyKey == "" {
		return ErrIdempotencyRequired
	}
	next := "PENDING"
	switch req.Decision {
	case "APPROVE":
		next = "APPROVED"
	case "REJECT":
		next = "REJECTED"
	case "REQUEST_INFO":
		next = "INFO_REQUESTED"
	default:
		return fmt.Errorf("association: invalid decision %q", req.Decision)
	}

	// Authorization (was previously ABSENT — any caller could decide any
	// application): the caller must be a ManageMembers admin OF THE APPLICATION'S
	// organisation. Resolve the org from the application, then org-scope the check.
	var appOrg string
	if err := s.db.QueryRow(ctx, `SELECT organisation_id FROM assoc_applications WHERE id=$1`, appID).Scan(&appOrg); err != nil {
		return fmt.Errorf("association: application not found: %w", err)
	}
	if err := s.requireCapInOrg(ctx, adminID, appOrg, func(c AdminCapabilities) bool { return c.ManageMembers }); err != nil {
		return err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE assoc_applications SET status=$2 WHERE id=$1`, appID, next); err != nil {
		return fmt.Errorf("association: update application: %w", err)
	}
	// On approval, activate (or create) the membership from the application.
	if req.Decision == "APPROVE" {
		const activate = `
			UPDATE assoc_memberships m
			SET status='ACTIVE'
			FROM assoc_applications a
			WHERE a.id = $1 AND m.organisation_id = a.organisation_id AND m.user_id = a.user_id`
		if _, err := tx.Exec(ctx, activate, appID); err != nil {
			return fmt.Errorf("association: activate membership: %w", err)
		}
	}
	if err := s.audit(ctx, tx, "", adminID, "APPROVAL_DECISION", "application", appID, map[string]any{"decision": req.Decision, "note": req.Note}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── Discovery ────────────────────────────────────────────────────────────────

// GetOrganisations lists published organisations, optionally filtered by search term.
func (s *Service) GetOrganisations(ctx context.Context, search string) ([]OrganisationSummary, error) {
	q := `
		SELECT o.id, o.name, o.acronym, o.category, o.logo_url, o.cover_url,
		       o.group_type, o.verified, o.location,
		       (SELECT count(*) FROM assoc_memberships m WHERE m.organisation_id=o.id AND m.status='ACTIVE') AS member_count,
		       (SELECT count(*) FROM assoc_chapters c WHERE c.organisation_id=o.id) AS chapter_count
		FROM assoc_organisations o
		WHERE o.published = true
		  AND o.group_type <> 'INVITE_ONLY'`
	args := []any{}
	if search != "" {
		args = append(args, "%"+search+"%")
		q += fmt.Sprintf(` AND (o.name ILIKE $%d OR o.acronym ILIKE $%d OR o.category ILIKE $%d)`, len(args), len(args), len(args))
	}
	q += ` ORDER BY o.name LIMIT 100`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("association: list orgs: %w", err)
	}
	defer rows.Close()
	var out []OrganisationSummary
	for rows.Next() {
		var o OrganisationSummary
		if err := rows.Scan(&o.ID, &o.Name, &o.Acronym, &o.Category, &o.LogoURL, &o.CoverURL,
			&o.GroupType, &o.Verified, &o.Location, &o.MemberCount, &o.ChapterCount); err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

// GetOrganisation returns the detail page for one organisation. INVITE_ONLY
// organisations are undiscoverable: their detail is only served to a caller who
// already holds a membership row in them (any status). Everyone else gets a
// not-found error — the same response as a non-existent id, so existence is not
// leaked (GR-004 / privacy invariant §4.9).
func (s *Service) GetOrganisation(ctx context.Context, viewerID, orgID string) (*Organisation, error) {
	const q = `
		SELECT o.id, o.name, o.acronym, o.category, o.logo_url, o.cover_url,
		       o.group_type, o.verified, o.location, o.description,
		       o.founded_year, o.requires_payment, o.registration_fee_kobo,
		       (SELECT count(*) FROM assoc_memberships m WHERE m.organisation_id=o.id AND m.status='ACTIVE'),
		       (SELECT count(*) FROM assoc_chapters c WHERE c.organisation_id=o.id)
		FROM assoc_organisations o
		WHERE o.id=$1 AND o.published=true
		  AND (o.group_type <> 'INVITE_ONLY'
		       OR EXISTS (SELECT 1 FROM assoc_memberships mm
		                  WHERE mm.organisation_id=o.id AND mm.user_id=$2))`
	var org Organisation
	if err := s.db.QueryRow(ctx, q, orgID, viewerID).Scan(
		&org.ID, &org.Name, &org.Acronym, &org.Category, &org.LogoURL, &org.CoverURL,
		&org.GroupType, &org.Verified, &org.Location, &org.Description,
		&org.FoundedYear, &org.RequiresPayment, &org.RegistrationFeeKobo,
		&org.MemberCount, &org.ChapterCount,
	); err != nil {
		return nil, fmt.Errorf("association: org not found: %w", err)
	}

	catRows, err := s.db.Query(ctx, `SELECT id, label, description, dues_kobo, cadence FROM assoc_membership_categories WHERE organisation_id=$1`, orgID)
	if err == nil {
		defer catRows.Close()
		for catRows.Next() {
			var c MembershipCategory
			if err := catRows.Scan(&c.ID, &c.Label, &c.Description, &c.DuesKobo, &c.DuesCadence); err == nil {
				org.MembershipCategories = append(org.MembershipCategories, c)
			}
		}
	}
	if org.MembershipCategories == nil {
		org.MembershipCategories = []MembershipCategory{}
	}

	chRows, err := s.db.Query(ctx, `SELECT id, name, level, parent_id, (SELECT count(*) FROM assoc_memberships m WHERE m.chapter_id=c.id AND m.status='ACTIVE') FROM assoc_chapters c WHERE organisation_id=$1`, orgID)
	if err == nil {
		defer chRows.Close()
		for chRows.Next() {
			var ch Chapter
			if err := chRows.Scan(&ch.ID, &ch.Name, &ch.Level, &ch.ParentID, &ch.MemberCount); err == nil {
				org.Chapters = append(org.Chapters, ch)
			}
		}
	}
	if org.Chapters == nil {
		org.Chapters = []Chapter{}
	}
	return &org, nil
}

// ── Member identity & dashboard ───────────────────────────────────────────────

// GetDashboard returns the authenticated member's overview dashboard.
func (s *Service) GetDashboard(ctx context.Context, userID string) (*MemberDashboard, error) {
	card, err := s.GetCard(ctx, userID)
	if err != nil {
		return nil, err
	}
	var out int64
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(i.amount_kobo),0)
		FROM assoc_dues_invoices i
		JOIN assoc_memberships m ON m.id=i.membership_id
		WHERE m.user_id=$1 AND i.status IN ('DUE','OVERDUE')`, userID).Scan(&out)

	var unread, openTasks int
	_ = s.db.QueryRow(ctx, `
		SELECT count(*) FROM assoc_announcements a
		JOIN assoc_memberships m ON m.organisation_id=a.organisation_id
		WHERE m.user_id=$1 AND m.status='ACTIVE'
		  AND NOT EXISTS (SELECT 1 FROM assoc_announcement_reads r WHERE r.announcement_id=a.id AND r.membership_id=m.id AND r.read_at IS NOT NULL)`,
		userID).Scan(&unread)
	_ = s.db.QueryRow(ctx, `
		SELECT count(*) FROM assoc_tasks t
		WHERE t.assignee_id=$1 AND t.status NOT IN ('COMPLETED','CANCELLED')`, userID).Scan(&openTasks)

	return &MemberDashboard{
		Card:                card,
		OutstandingKobo:     out,
		UnreadAnnouncements: unread,
		OpenTasks:           openTasks,
	}, nil
}

// GetCard builds the digital membership card for the authenticated user.
func (s *Service) GetCard(ctx context.Context, userID string) (MembershipCard, error) {
	const q = `
		SELECT m.id, m.member_code, m.status, m.payment_standing, m.verified, m.valid_through,
		       o.name, o.acronym,
		       COALESCE(mc.label,'Member'),
		       ch.name,
		       mp.full_name, mp.photo_url
		FROM assoc_memberships m
		JOIN assoc_organisations o ON o.id=m.organisation_id
		LEFT JOIN assoc_membership_categories mc ON mc.id=m.category_id
		LEFT JOIN assoc_chapters ch ON ch.id=m.chapter_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		WHERE m.user_id=$1 AND m.status='ACTIVE'
		LIMIT 1`
	var card MembershipCard
	var validThrough *string
	if err := s.db.QueryRow(ctx, q, userID).Scan(
		&card.MemberID, &card.MemberID, &card.Status, &card.PaymentStanding, &card.Verified, &validThrough,
		&card.OrganisationName, &card.OrganisationAcronym,
		&card.CategoryLabel, &card.ChapterName,
		&card.FullName, &card.PhotoURL,
	); err != nil {
		return card, fmt.Errorf("association: membership not found: %w", err)
	}
	card.ValidThrough = validThrough
	card.QRPayload = "assoc:" + card.MemberID
	return card, nil
}

// GetProfile returns the caller's full editable profile.
func (s *Service) GetProfile(ctx context.Context, userID string) (*MyProfile, error) {
	const q = `
		SELECT mp.full_name, m.member_code, mp.photo_url, mp.email, mp.phone,
		       mp.profession, mp.location, mp.dob::text, mp.bio,
		       mp.emergency, mp.next_of_kin,
		       COALESCE(mc.label,'Member'), ch.name
		FROM assoc_memberships m
		JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		LEFT JOIN assoc_membership_categories mc ON mc.id=m.category_id
		LEFT JOIN assoc_chapters ch ON ch.id=m.chapter_id
		WHERE m.user_id=$1 AND m.status='ACTIVE'
		LIMIT 1`
	var p MyProfile
	var emergency, nextOfKin []byte
	if err := s.db.QueryRow(ctx, q, userID).Scan(
		&p.FullName, &p.MemberID, &p.PhotoURL, &p.Email, &p.Phone,
		&p.Profession, &p.Location, &p.DOB, &p.Bio,
		&emergency, &nextOfKin,
		&p.CategoryLabel, &p.ChapterName,
	); err != nil {
		return nil, fmt.Errorf("association: profile not found: %w", err)
	}
	json.Unmarshal(emergency, &p.Emergency) //nolint:errcheck
	json.Unmarshal(nextOfKin, &p.NextOfKin) //nolint:errcheck
	if p.Emergency == nil {
		p.Emergency = map[string]any{}
	}
	if p.NextOfKin == nil {
		p.NextOfKin = map[string]any{}
	}
	return &p, nil
}

// GetPrivacy returns the caller's privacy settings (stored in assoc_member_profiles.privacy jsonb).
func (s *Service) GetPrivacy(ctx context.Context, userID string) (*PrivacySettings, error) {
	var raw []byte
	if err := s.db.QueryRow(ctx, `
		SELECT mp.privacy FROM assoc_member_profiles mp
		JOIN assoc_memberships m ON m.id=mp.membership_id
		WHERE m.user_id=$1 LIMIT 1`, userID).Scan(&raw); err != nil {
		return nil, fmt.Errorf("association: privacy not found: %w", err)
	}
	var ps PrivacySettings
	json.Unmarshal(raw, &ps) //nolint:errcheck
	return &ps, nil
}

// UpdatePrivacy persists privacy settings for the caller.
func (s *Service) UpdatePrivacy(ctx context.Context, userID string, ps PrivacySettings) (*PrivacySettings, error) {
	b, err := json.Marshal(ps)
	if err != nil {
		return nil, err
	}
	_, err = s.db.Exec(ctx, `
		UPDATE assoc_member_profiles SET privacy=$2, updated_at=now()
		WHERE membership_id=(SELECT id FROM assoc_memberships WHERE user_id=$1 AND status='ACTIVE' LIMIT 1)`,
		userID, b)
	if err != nil {
		return nil, fmt.Errorf("association: update privacy: %w", err)
	}
	return &ps, nil
}

// GetActivity returns recent audit/activity entries for the caller.
func (s *Service) GetActivity(ctx context.Context, userID string) ([]ActivityEntry, error) {
	rows, err := s.db.Query(ctx, `
		SELECT id, action, subject_type, created_at::text
		FROM assoc_audit_log
		WHERE actor_id=$1
		ORDER BY created_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, fmt.Errorf("association: activity: %w", err)
	}
	defer rows.Close()
	var out []ActivityEntry
	for rows.Next() {
		var e ActivityEntry
		var action, subjectType string
		if err := rows.Scan(&e.ID, &action, &subjectType, &e.At); err != nil {
			continue
		}
		e.Type = action
		e.Text = action + " " + subjectType
		out = append(out, e)
	}
	if out == nil {
		out = []ActivityEntry{}
	}
	return out, rows.Err()
}

// ── RBAC ──────────────────────────────────────────────────────────────────────

// GetAdminAccess reads the caller's assoc_member_roles entry and maps it to capabilities.
func (s *Service) GetAdminAccess(ctx context.Context, userID string) (*AdminAccess, error) {
	const q = `
		SELECT r.role, r.jurisdiction
		FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id=r.membership_id
		WHERE m.user_id=$1
		ORDER BY CASE r.role
		  WHEN 'SUPER_ADMIN'    THEN 1
		  WHEN 'NATIONAL_ADMIN' THEN 2
		  WHEN 'FINANCE_ADMIN'  THEN 3
		  WHEN 'CHAPTER_ADMIN'  THEN 4
		  WHEN 'SECRETARY'      THEN 5
		  ELSE 6 END
		LIMIT 1`
	var role, jurisdiction string
	if err := s.db.QueryRow(ctx, q, userID).Scan(&role, &jurisdiction); err != nil {
		// No role row → not an admin
		return &AdminAccess{IsAdmin: false, Role: "NONE", RoleLabel: "Member", Jurisdiction: "CHAPTER"}, nil
	}
	caps := capabilitiesFor(role)
	labels := map[string]string{
		"SUPER_ADMIN":    "Super Admin",
		"NATIONAL_ADMIN": "National Admin",
		"FINANCE_ADMIN":  "Finance Admin",
		"CHAPTER_ADMIN":  "Chapter Admin",
		"SECRETARY":      "Secretary",
	}
	return &AdminAccess{
		IsAdmin:      true,
		Role:         role,
		RoleLabel:    labels[role],
		Jurisdiction: jurisdiction,
		Can:          caps,
	}, nil
}

// requireAssocAdmin checks that the caller holds an admin role; returns ErrForbidden otherwise.
func (s *Service) requireAssocAdmin(ctx context.Context, userID string) error {
	var count int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id=r.membership_id
		WHERE m.user_id=$1 AND r.role != 'NONE'`, userID).Scan(&count); err != nil || count == 0 {
		return ErrForbidden
	}
	return nil
}

// requireCap fetches the caller's highest-privilege role and checks that the
// requested capability is set. Returns ErrForbidden when not an admin or when
// the role lacks the capability.
func (s *Service) requireCap(ctx context.Context, userID string, check func(AdminCapabilities) bool) error {
	const q = `
		SELECT r.role FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id = r.membership_id
		WHERE m.user_id = $1 AND r.role != 'NONE'
		ORDER BY CASE r.role
			WHEN 'SUPER_ADMIN'    THEN 1
			WHEN 'NATIONAL_ADMIN' THEN 2
			WHEN 'FINANCE_ADMIN'  THEN 3
			WHEN 'CHAPTER_ADMIN'  THEN 4
			WHEN 'SECRETARY'      THEN 5
			ELSE 6 END
		LIMIT 1`
	var role string
	if err := s.db.QueryRow(ctx, q, userID).Scan(&role); err != nil {
		return ErrForbidden
	}
	if !check(capabilitiesFor(role)) {
		return ErrForbidden
	}
	return nil
}

func capabilitiesFor(role string) AdminCapabilities {
	switch role {
	case "SUPER_ADMIN", "NATIONAL_ADMIN":
		return AdminCapabilities{true, true, true, true}
	case "FINANCE_ADMIN":
		return AdminCapabilities{false, false, true, false}
	case "CHAPTER_ADMIN":
		return AdminCapabilities{true, true, false, true}
	case "SECRETARY":
		return AdminCapabilities{false, false, false, false}
	default:
		return AdminCapabilities{}
	}
}

// requireCapInOrg is the organisation-scoped counterpart to requireCap: it checks
// the caller holds an admin role WITH the requested capability IN the specified
// organisation. This is the guard for admin mutations that target a resource
// belonging to a particular org, and closes the cross-org admin IDOR where an
// admin of org A could act on org B via requireCap (which is org-agnostic).
// Fail-closed: empty org, no admin role in that org, or a role lacking the
// capability all return ErrForbidden.
func (s *Service) requireCapInOrg(ctx context.Context, userID, orgID string, check func(AdminCapabilities) bool) error {
	if orgID == "" {
		return ErrForbidden
	}
	const q = `
		SELECT r.role FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id = r.membership_id
		WHERE m.user_id = $1 AND m.organisation_id = $2 AND r.role != 'NONE'
		ORDER BY CASE r.role
			WHEN 'SUPER_ADMIN'    THEN 1
			WHEN 'NATIONAL_ADMIN' THEN 2
			WHEN 'FINANCE_ADMIN'  THEN 3
			WHEN 'CHAPTER_ADMIN'  THEN 4
			WHEN 'SECRETARY'      THEN 5
			ELSE 6 END
		LIMIT 1`
	var role string
	if err := s.db.QueryRow(ctx, q, userID, orgID).Scan(&role); err != nil {
		return ErrForbidden
	}
	if !check(capabilitiesFor(role)) {
		return ErrForbidden
	}
	return nil
}

// requireAdminInOrg checks the caller holds ANY admin role (role != NONE) in the
// specified organisation. Org-scoped counterpart to requireAssocAdmin.
func (s *Service) requireAdminInOrg(ctx context.Context, userID, orgID string) error {
	if orgID == "" {
		return ErrForbidden
	}
	var count int
	if err := s.db.QueryRow(ctx, `
		SELECT count(*) FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id = r.membership_id
		WHERE m.user_id = $1 AND m.organisation_id = $2 AND r.role != 'NONE'`,
		userID, orgID).Scan(&count); err != nil || count == 0 {
		return ErrForbidden
	}
	return nil
}

// membershipOrg resolves the organisation a membership row belongs to. Returns
// ErrForbidden when the membership does not exist (fail-closed for scoping).
func (s *Service) membershipOrg(ctx context.Context, membershipID string) (string, error) {
	var orgID string
	if err := s.db.QueryRow(ctx, `SELECT organisation_id FROM assoc_memberships WHERE id=$1`, membershipID).Scan(&orgID); err != nil {
		return "", ErrForbidden
	}
	return orgID, nil
}

// ── Directory ─────────────────────────────────────────────────────────────────

// GetDirectory returns the member directory, optionally filtered.
func (s *Service) GetDirectory(ctx context.Context, userID string, q MemberDirectoryQuery) ([]MemberProfileSummary, error) {
	query := `
		SELECT m.id, mp.full_name, m.member_code, mp.photo_url,
		       COALESCE(mc.label,'Member'), ch.name, m.status, mp.profession
		FROM assoc_memberships m
		JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		LEFT JOIN assoc_membership_categories mc ON mc.id=m.category_id
		LEFT JOIN assoc_chapters ch ON ch.id=m.chapter_id
		WHERE m.status='ACTIVE'`
	args := []any{}
	if q.Search != "" {
		args = append(args, "%"+q.Search+"%")
		n := len(args)
		query += fmt.Sprintf(` AND (mp.full_name ILIKE $%d OR m.member_code ILIKE $%d)`, n, n)
	}
	if q.ChapterID != "" {
		args = append(args, q.ChapterID)
		query += fmt.Sprintf(` AND m.chapter_id=$%d`, len(args))
	}
	if q.Status != "" {
		args = append(args, q.Status)
		query += fmt.Sprintf(` AND m.status=$%d`, len(args))
	}
	// Cross-group isolation (DR-004 / GR-010): restrict to organisations where the
	// caller holds an ACTIVE membership — a viewer never sees a foreign org's roll.
	args = append(args, userID)
	uidPos := len(args)
	query += fmt.Sprintf(` AND m.organisation_id IN (SELECT organisation_id FROM assoc_memberships WHERE user_id=$%d AND status='ACTIVE')`, uidPos)
	// Respect the viewer's privacy: don't expose contact-restricted profiles to non-self.
	query += fmt.Sprintf(` AND (mp.contact_restricted=false OR m.user_id=$%d)`, uidPos)
	query += ` ORDER BY mp.full_name LIMIT 200`

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("association: directory: %w", err)
	}
	defer rows.Close()
	var out []MemberProfileSummary
	for rows.Next() {
		var m MemberProfileSummary
		if err := rows.Scan(&m.ID, &m.FullName, &m.MemberID, &m.PhotoURL,
			&m.CategoryLabel, &m.ChapterName, &m.Status, &m.Profession); err != nil {
			continue
		}
		out = append(out, m)
	}
	if out == nil {
		out = []MemberProfileSummary{}
	}
	return out, rows.Err()
}

// GetMember returns a single member profile, respecting privacy restrictions.
func (s *Service) GetMember(ctx context.Context, viewerID, targetID string) (*MemberProfile, error) {
	const q = `
		SELECT m.id, mp.full_name, m.member_code, mp.photo_url,
		       COALESCE(mc.label,'Member'), ch.name, m.status, mp.profession,
		       mp.email, mp.phone, mp.location, m.joined_at::text,
		       m.payment_standing, mp.bio, mp.contact_restricted
		FROM assoc_memberships m
		JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		LEFT JOIN assoc_membership_categories mc ON mc.id=m.category_id
		LEFT JOIN assoc_chapters ch ON ch.id=m.chapter_id
		WHERE m.id=$1 AND m.status='ACTIVE'
		  AND EXISTS (SELECT 1 FROM assoc_memberships v
		              WHERE v.user_id=$2 AND v.status='ACTIVE'
		                AND v.organisation_id = m.organisation_id)`
	var mp MemberProfile
	var restricted bool
	if err := s.db.QueryRow(ctx, q, targetID, viewerID).Scan(
		&mp.ID, &mp.FullName, &mp.MemberID, &mp.PhotoURL,
		&mp.CategoryLabel, &mp.ChapterName, &mp.Status, &mp.Profession,
		&mp.Email, &mp.Phone, &mp.Location, &mp.JoinedAt,
		&mp.PaymentStanding, &mp.Bio, &restricted,
	); err != nil {
		return nil, fmt.Errorf("association: member not found: %w", err)
	}
	mp.ContactRestricted = restricted
	if restricted && viewerID != targetID {
		mp.Email = nil
		mp.Phone = nil
	}
	return &mp, nil
}

// ── Announcements & notifications ─────────────────────────────────────────────

// GetAnnouncements returns announcements for the caller's organisations.
func (s *Service) GetAnnouncements(ctx context.Context, userID string) ([]AnnouncementSummary, error) {
	rows, err := s.db.Query(ctx, `
		SELECT a.id, a.title, LEFT(COALESCE(a.body,''),120), COALESCE(a.audience,''), a.posted_at::text,
		       COALESCE(a.author,''), a.urgent, a.requires_ack,
		       EXISTS(SELECT 1 FROM assoc_announcement_reads r WHERE r.announcement_id=a.id AND r.membership_id=m.id AND r.read_at IS NOT NULL),
		       EXISTS(SELECT 1 FROM assoc_announcement_reads r WHERE r.announcement_id=a.id AND r.membership_id=m.id AND r.acknowledged_at IS NOT NULL)
		FROM assoc_announcements a
		JOIN assoc_memberships m ON m.organisation_id=a.organisation_id
		WHERE m.user_id=$1 AND m.status='ACTIVE'
		ORDER BY a.urgent DESC, a.posted_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, fmt.Errorf("association: announcements: %w", err)
	}
	defer rows.Close()
	var out []AnnouncementSummary
	for rows.Next() {
		var a AnnouncementSummary
		if err := rows.Scan(&a.ID, &a.Title, &a.Preview, &a.Audience, &a.PostedAt,
			&a.Author, &a.Urgent, &a.RequiresAck, &a.Read, &a.Acknowledged); err != nil {
			continue
		}
		out = append(out, a)
	}
	if out == nil {
		out = []AnnouncementSummary{}
	}
	return out, rows.Err()
}

// GetNotifications returns the in-app notification center for the caller.
func (s *Service) GetNotifications(ctx context.Context, userID string) ([]AppNotification, error) {
	rows, err := s.db.Query(ctx, `
		SELECT n.id, n.kind, n.title, COALESCE(n.body,''), n.created_at::text, n.read, n.route
		FROM assoc_notifications n
		JOIN assoc_memberships m ON m.id=n.membership_id
		WHERE m.user_id=$1
		ORDER BY n.created_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, fmt.Errorf("association: notifications: %w", err)
	}
	defer rows.Close()
	var out []AppNotification
	for rows.Next() {
		var n AppNotification
		if err := rows.Scan(&n.ID, &n.Kind, &n.Title, &n.Body, &n.CreatedAt, &n.Read, &n.Route); err != nil {
			continue
		}
		out = append(out, n)
	}
	if out == nil {
		out = []AppNotification{}
	}
	return out, rows.Err()
}

// ── Meetings ──────────────────────────────────────────────────────────────────

// GetMeetings returns upcoming and recent meetings for the caller's organisations.
func (s *Service) GetMeetings(ctx context.Context, userID string) ([]MeetingSummary, error) {
	rows, err := s.db.Query(ctx, `
		SELECT mt.id, mt.title, mt.mode, mt.starts_at::text, mt.ends_at::text, mt.location,
		       CASE WHEN mt.starts_at > now() THEN 'UPCOMING'
		            WHEN mt.ends_at IS NULL OR mt.ends_at > now() THEN 'LIVE'
		            ELSE 'PAST' END,
		       (SELECT count(*) FROM assoc_meeting_attendance ma WHERE ma.meeting_id=mt.id)
		FROM assoc_meetings mt
		JOIN assoc_memberships m ON m.organisation_id=mt.organisation_id
		WHERE m.user_id=$1 AND m.status='ACTIVE'
		ORDER BY mt.starts_at DESC LIMIT 50`, userID)
	if err != nil {
		return nil, fmt.Errorf("association: meetings: %w", err)
	}
	defer rows.Close()
	var out []MeetingSummary
	for rows.Next() {
		var mt MeetingSummary
		if err := rows.Scan(&mt.ID, &mt.Title, &mt.Mode, &mt.StartsAt, &mt.EndsAt,
			&mt.Location, &mt.State, &mt.AttendeeCount); err != nil {
			continue
		}
		out = append(out, mt)
	}
	if out == nil {
		out = []MeetingSummary{}
	}
	return out, rows.Err()
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

// GetTasks returns tasks assigned to or created by the caller.
func (s *Service) GetTasks(ctx context.Context, userID, scope string) ([]TaskSummary, error) {
	q := `
		SELECT t.id, t.title, t.status, t.priority, t.due_date::text,
		       COALESCE(mp.full_name, 'Unassigned'), c.name
		FROM assoc_tasks t
		LEFT JOIN assoc_memberships ma ON ma.id=t.assignee_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=ma.id
		LEFT JOIN assoc_committees c ON c.id=t.committee_id
		WHERE t.assignee_id IN (SELECT id FROM assoc_memberships WHERE user_id=$1)`
	switch scope {
	case "overdue":
		q += ` AND t.due_date < now() AND t.status NOT IN ('COMPLETED')`
	case "completed":
		q += ` AND t.status='COMPLETED'`
	default: // mine
		q += ` AND t.status NOT IN ('COMPLETED')`
	}
	q += ` ORDER BY t.due_date NULLS LAST LIMIT 100`
	rows, err := s.db.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("association: tasks: %w", err)
	}
	defer rows.Close()
	var out []TaskSummary
	for rows.Next() {
		var t TaskSummary
		if err := rows.Scan(&t.ID, &t.Title, &t.Status, &t.Priority, &t.DueDate,
			&t.AssigneeName, &t.Committee); err != nil {
			continue
		}
		out = append(out, t)
	}
	if out == nil {
		out = []TaskSummary{}
	}
	return out, rows.Err()
}

// ── Documents ─────────────────────────────────────────────────────────────────

// GetDocuments returns accessible documents for the caller's organisations.
func (s *Service) GetDocuments(ctx context.Context, userID string) ([]DocumentSummary, error) {
	rows, err := s.db.Query(ctx, `
		SELECT d.id, d.title, d.category, d.kind, COALESCE(d.size_label,''), d.updated_at::text,
		       d.restricted, d.requires_ack,
		       EXISTS(SELECT 1 FROM assoc_document_acks a WHERE a.document_id=d.id AND a.membership_id=m.id)
		FROM assoc_documents d
		JOIN assoc_memberships m ON m.organisation_id=d.organisation_id
		WHERE m.user_id=$1 AND m.status='ACTIVE'
		  AND (d.restricted=false OR m.status='ACTIVE')
		ORDER BY d.updated_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, fmt.Errorf("association: documents: %w", err)
	}
	defer rows.Close()
	var out []DocumentSummary
	for rows.Next() {
		var doc DocumentSummary
		if err := rows.Scan(&doc.ID, &doc.Title, &doc.Category, &doc.Kind, &doc.SizeLabel,
			&doc.UpdatedAt, &doc.Restricted, &doc.RequiresAck, &doc.Acknowledged); err != nil {
			continue
		}
		out = append(out, doc)
	}
	if out == nil {
		out = []DocumentSummary{}
	}
	return out, rows.Err()
}

// ── Community ─────────────────────────────────────────────────────────────────

// GetCommittees returns committees for the caller's organisations.
func (s *Service) GetCommittees(ctx context.Context, userID string) ([]CommitteeSummary, error) {
	rows, err := s.db.Query(ctx, `
		SELECT c.id, c.name, COALESCE(c.purpose,''),
		       (SELECT count(*) FROM assoc_committee_members cm WHERE cm.committee_id=c.id),
		       COALESCE((SELECT cm2.status FROM assoc_committee_members cm2
		                 JOIN assoc_memberships m2 ON m2.id=cm2.membership_id
		                 WHERE cm2.committee_id=c.id AND m2.user_id=$1 LIMIT 1), 'NONE'),
		       (SELECT cm3.role FROM assoc_committee_members cm3
		        JOIN assoc_memberships m3 ON m3.id=cm3.membership_id
		        WHERE cm3.committee_id=c.id AND m3.user_id=$1 LIMIT 1)
		FROM assoc_committees c
		JOIN assoc_memberships m ON m.organisation_id=c.organisation_id
		WHERE m.user_id=$1 AND m.status='ACTIVE'
		GROUP BY c.id
		ORDER BY c.name LIMIT 100`, userID)
	if err != nil {
		return nil, fmt.Errorf("association: committees: %w", err)
	}
	defer rows.Close()
	var out []CommitteeSummary
	for rows.Next() {
		var c CommitteeSummary
		if err := rows.Scan(&c.ID, &c.Name, &c.Purpose, &c.MemberCount,
			&c.JoinStatus, &c.MyRole); err != nil {
			continue
		}
		out = append(out, c)
	}
	if out == nil {
		out = []CommitteeSummary{}
	}
	return out, rows.Err()
}

// GetEvents returns events for the caller's organisations.
func (s *Service) GetEvents(ctx context.Context, userID string) ([]EventSummary, error) {
	rows, err := s.db.Query(ctx, `
		SELECT e.id, e.title, e.starts_at::text, e.location,
		       CASE WHEN e.starts_at > now() THEN 'UPCOMING' ELSE 'PAST' END,
		       e.paid, e.fee_kobo, e.cover_url,
		       EXISTS(SELECT 1 FROM assoc_event_registrations er
		              JOIN assoc_memberships m2 ON m2.id=er.membership_id
		              WHERE er.event_id=e.id AND m2.user_id=$1)
		FROM assoc_events e
		JOIN assoc_memberships m ON m.organisation_id=e.organisation_id
		WHERE m.user_id=$1 AND m.status='ACTIVE'
		GROUP BY e.id
		ORDER BY e.starts_at DESC LIMIT 100`, userID)
	if err != nil {
		return nil, fmt.Errorf("association: events: %w", err)
	}
	defer rows.Close()
	var out []EventSummary
	for rows.Next() {
		var e EventSummary
		if err := rows.Scan(&e.ID, &e.Title, &e.StartsAt, &e.Location,
			&e.State, &e.Paid, &e.FeeKobo, &e.CoverURL, &e.Registered); err != nil {
			continue
		}
		out = append(out, e)
	}
	if out == nil {
		out = []EventSummary{}
	}
	return out, rows.Err()
}

// ── Admin reads ───────────────────────────────────────────────────────────────

// GetAdminKpis returns high-level KPIs for the first org the admin manages.
func (s *Service) GetAdminKpis(ctx context.Context, adminID string) (*AdminKpis, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	// Scope to the admin's organisation.
	var orgID string
	if err := s.db.QueryRow(ctx, `
		SELECT m.organisation_id FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id=r.membership_id
		WHERE m.user_id=$1 LIMIT 1`, adminID).Scan(&orgID); err != nil {
		return nil, fmt.Errorf("association: admin org: %w", err)
	}
	var kpi AdminKpis
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_memberships WHERE organisation_id=$1`, orgID).Scan(&kpi.TotalMembers)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_memberships WHERE organisation_id=$1 AND status='ACTIVE'`, orgID).Scan(&kpi.ActiveMembers)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_applications WHERE organisation_id=$1 AND status IN ('PENDING','PENDING_CHAPTER','PENDING_NATIONAL','INFO_REQUESTED')`, orgID).Scan(&kpi.PendingApprovals)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_memberships WHERE organisation_id=$1 AND payment_standing!='PAID' AND status='ACTIVE'`, orgID).Scan(&kpi.UnpaidMembers)
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(p.amount_kobo),0) FROM assoc_payments p JOIN assoc_memberships m ON m.id=p.membership_id WHERE m.organisation_id=$1 AND p.status='SUCCESS'`, orgID).Scan(&kpi.DuesCollectedKobo)
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(i.amount_kobo),0) FROM assoc_dues_invoices i JOIN assoc_memberships m ON m.id=i.membership_id WHERE m.organisation_id=$1 AND i.status IN ('DUE','OVERDUE')`, orgID).Scan(&kpi.DuesOutstandingKobo)
	return &kpi, nil
}

// GetApprovalQueue returns applications awaiting the admin's decision.
func (s *Service) GetApprovalQueue(ctx context.Context, adminID, jurisdiction string) ([]AdminApplicationSummary, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	q := `
		SELECT a.id, COALESCE(mp.full_name, u.email, a.user_id::text),
		       COALESCE(mc.label,''), COALESCE(ch.name,''), a.submitted_at::text,
		       a.status, a.jurisdiction, a.paid
		FROM assoc_applications a
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=(SELECT id FROM assoc_memberships WHERE user_id=a.user_id AND organisation_id=a.organisation_id LIMIT 1)
		LEFT JOIN assoc_membership_categories mc ON mc.id=a.category_id
		LEFT JOIN assoc_chapters ch ON ch.id=a.chapter_id
		LEFT JOIN auth.users u ON u.id=a.user_id
		WHERE a.status IN ('PENDING','PENDING_CHAPTER','PENDING_NATIONAL','INFO_REQUESTED')`
	args := []any{}
	if jurisdiction != "" && jurisdiction != "ALL" {
		args = append(args, jurisdiction)
		q += fmt.Sprintf(` AND a.jurisdiction=$%d`, len(args))
	}
	q += ` ORDER BY a.submitted_at DESC LIMIT 200`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("association: approval queue: %w", err)
	}
	defer rows.Close()
	var out []AdminApplicationSummary
	for rows.Next() {
		var a AdminApplicationSummary
		if err := rows.Scan(&a.ID, &a.ApplicantName, &a.Category, &a.Chapter,
			&a.SubmittedAt, &a.Status, &a.Jurisdiction, &a.Paid); err != nil {
			continue
		}
		out = append(out, a)
	}
	if out == nil {
		out = []AdminApplicationSummary{}
	}
	return out, rows.Err()
}

// GetApplication returns a single application with full detail for the admin review screen.
func (s *Service) GetApplication(ctx context.Context, adminID, appID string) (*AdminApplication, error) {
	// Org-scoped: the caller must be an admin of the application's own
	// organisation (not merely an admin of some org). Prevents cross-org PII read.
	var appOrg string
	if err := s.db.QueryRow(ctx, `SELECT organisation_id FROM assoc_applications WHERE id=$1`, appID).Scan(&appOrg); err != nil {
		return nil, fmt.Errorf("association: application not found: %w", err)
	}
	if err := s.requireAdminInOrg(ctx, adminID, appOrg); err != nil {
		return nil, err
	}
	const q = `
		SELECT a.id, COALESCE(mp.full_name, u.email, a.user_id::text),
		       COALESCE(mc.label,''), COALESCE(ch.name,''), a.submitted_at::text,
		       a.status, a.jurisdiction, a.paid,
		       COALESCE(u.email,''), COALESCE(mp.phone,''), COALESCE(mp.profession,''),
		       a.sponsor_name, COALESCE(mc.dues_kobo,0)
		FROM assoc_applications a
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=(SELECT id FROM assoc_memberships WHERE user_id=a.user_id AND organisation_id=a.organisation_id LIMIT 1)
		LEFT JOIN assoc_membership_categories mc ON mc.id=a.category_id
		LEFT JOIN assoc_chapters ch ON ch.id=a.chapter_id
		LEFT JOIN auth.users u ON u.id=a.user_id
		WHERE a.id=$1`
	var app AdminApplication
	if err := s.db.QueryRow(ctx, q, appID).Scan(
		&app.ID, &app.ApplicantName, &app.Category, &app.Chapter,
		&app.SubmittedAt, &app.Status, &app.Jurisdiction, &app.Paid,
		&app.Email, &app.Phone, &app.Profession,
		&app.Sponsor, &app.RegistrationFeeKobo,
	); err != nil {
		return nil, fmt.Errorf("association: application not found: %w", err)
	}
	return &app, nil
}

// GetFinanceSummary returns aggregate finance stats for the admin's organisation.
func (s *Service) GetFinanceSummary(ctx context.Context, adminID string) (*FinanceSummary, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	var orgID string
	if err := s.db.QueryRow(ctx, `
		SELECT m.organisation_id FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id=r.membership_id WHERE m.user_id=$1 LIMIT 1`, adminID).Scan(&orgID); err != nil {
		return nil, fmt.Errorf("association: admin org: %w", err)
	}
	var fs FinanceSummary
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(p.amount_kobo),0) FROM assoc_payments p JOIN assoc_memberships m ON m.id=p.membership_id WHERE m.organisation_id=$1 AND p.status='SUCCESS'`, orgID).Scan(&fs.CollectedKobo)
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(i.amount_kobo),0) FROM assoc_dues_invoices i JOIN assoc_memberships m ON m.id=i.membership_id WHERE m.organisation_id=$1 AND i.status IN ('DUE','OVERDUE')`, orgID).Scan(&fs.OutstandingKobo)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_memberships WHERE organisation_id=$1 AND payment_standing='PAID' AND status='ACTIVE'`, orgID).Scan(&fs.PaidMembers)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_memberships WHERE organisation_id=$1 AND payment_standing!='PAID' AND status='ACTIVE'`, orgID).Scan(&fs.UnpaidMembers)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_payments p JOIN assoc_memberships m ON m.id=p.membership_id WHERE m.organisation_id=$1 AND p.offline=true AND p.status='PENDING'`, orgID).Scan(&fs.OfflinePending)
	return &fs, nil
}

// GetOfflinePayments returns pending offline payment proofs awaiting admin approval.
func (s *Service) GetOfflinePayments(ctx context.Context, adminID string) ([]OfflinePayment, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT p.id, COALESCE(mp.full_name,''), m.member_code,
		       p.amount_kobo, p.method, COALESCE(p.reference,''),
		       i.title, p.created_at::text, p.status
		FROM assoc_payments p
		JOIN assoc_memberships m ON m.id=p.membership_id
		JOIN assoc_dues_invoices i ON i.id=p.invoice_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		WHERE p.offline=true AND p.status='PENDING'
		ORDER BY p.created_at DESC LIMIT 200`)
	if err != nil {
		return nil, fmt.Errorf("association: offline payments: %w", err)
	}
	defer rows.Close()
	var out []OfflinePayment
	for rows.Next() {
		var op OfflinePayment
		if err := rows.Scan(&op.ID, &op.MemberName, &op.MemberID,
			&op.AmountKobo, &op.Method, &op.Reference,
			&op.ForItem, &op.SubmittedAt, &op.Status); err != nil {
			continue
		}
		out = append(out, op)
	}
	if out == nil {
		out = []OfflinePayment{}
	}
	return out, rows.Err()
}

// audit writes a sensitive-action row. orgID may be empty when not in scope.
func (s *Service) audit(ctx context.Context, tx pgx.Tx, orgID, actorID, action, subjectType, subjectID string, meta map[string]any) error {
	var org any
	if orgID != "" {
		org = orgID
	}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return fmt.Errorf("association: audit marshal: %w", err)
	}
	const ins = `
		INSERT INTO assoc_audit_log (id, organisation_id, actor_id, action, subject_type, subject_id, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`
	if _, err := tx.Exec(ctx, ins, uuid.New().String(), org, actorID, action, subjectType, subjectID, metaJSON); err != nil {
		return fmt.Errorf("association: audit: %w", err)
	}
	return nil
}
