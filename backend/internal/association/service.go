package association

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
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

// ErrNoMembership means the caller holds no association membership at all.
// Distinct from ErrForbidden: it is a 404-shaped "nothing here for you yet"
// that the client should render as an onboarding empty state, not an error.
// Previously every such case fell through statusFor's default branch to a 500,
// which made the mobile home screen show "Couldn't load / Please try again"
// and retry forever.
var ErrNoMembership = errors.New("association: no membership")

// ErrInvalidInput marks a caller-supplied value the server rejects — an
// incoherent event price, a bad enum, a malformed timestamp. These were plain
// fmt.Errorf values, so statusFor's default branch mapped them to 500 and a
// user's typo looked like a server fault.
var ErrInvalidInput = errors.New("association: invalid input")

// Service manages association dues payments, receipts, and admin approvals.
type Service struct {
	db         *pgxpool.Pool
	ledger     *ledger.Service
	commission CommissionRecorder // optional; nil ⇒ realized-profit recording is a no-op
	cardKey    []byte             // HMAC key for membership card QR signing (set via SetCardSigningSecret)
}

func NewService(db *pgxpool.Pool, ledger *ledger.Service) *Service {
	return &Service{db: db, ledger: ledger}
}

// CommissionRecorder is the nil-safe seam into the central Commission & Profit
// module. app-wiring injects a thin adapter over the finance commission service;
// when the commission feature is off (or no recorder is wired) the field is nil and
// recording is a silent no-op. Modeled as a LOCAL interface so association never
// imports the commission package at compile time (mirrors transport/service.go). It
// records realized profit ONLY; it never moves money. The injected recorder is built
// WITHOUT a ledger so RecordFor never re-posts (the dues split above already routes
// the platform fee) — it appends the immutable earning row used by profit reports.
type CommissionRecorder interface {
	RecordFor(ctx context.Context, category, service, subtype string, grossKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
	RecordExact(ctx context.Context, category, service, subtype string, grossKobo, recordedRevenueKobo int64,
		sourceModule, sourceRef string, userID *string, idempotencyKey string) error
}

// SetCommissionRecorder injects the central profit-recording seam (app-wiring,
// post-construction). Nil is accepted and disables recording.
func (s *Service) SetCommissionRecorder(cr CommissionRecorder) { s.commission = cr }

// recordCommissionSafe records realized Spotlight profit for a settled dues payment.
// It is best-effort and MUST NEVER affect the caller's outcome: a nil recorder is a
// no-op, and any error is logged and swallowed so a profit-registry failure can never
// fail or reverse the member's dues payment. The invoice id doubles as source ref +
// idempotency key so retries and reconciliation sweeps never double-count. The
// module's ACTUAL platform cut is the 5% Platform-fee line of the RevenueSplit, NOT a
// flat 10% of the dues, so we record the EXACT platformKobo via RecordExact (grossKobo
// = the full dues amount is passed for context/throughput).
func (s *Service) recordCommissionSafe(ctx context.Context, category, service, subtype string, grossKobo, platformKobo int64,
	sourceRef string, userID *string) {
	if s.commission == nil || platformKobo <= 0 {
		return
	}
	if err := s.commission.RecordExact(ctx, category, service, subtype, grossKobo, platformKobo,
		"association", sourceRef, userID, sourceRef); err != nil {
		log.Printf("[association] commission record (source=%s gross=%d platform=%d) failed, continuing: %v", sourceRef, grossKobo, platformKobo, err)
	}
}

// platformShareKobo extracts the platform-fee line (5%) from the dues RevenueSplit —
// the exact amount actually credited to platform revenue — so profit recording uses
// the realized cut rather than the whole dues amount.
func platformShareKobo(amountKobo int64) int64 {
	for _, line := range RevenueSplit(amountKobo) {
		if line.Label == "Platform fee" {
			return line.AmountKobo
		}
	}
	return 0
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
		invoiceOrg string
	)
	const qInv = `
		SELECT i.amount_kobo, i.title, i.status, m.user_id, m.id, o.name, o.id
		FROM assoc_dues_invoices i
		JOIN assoc_memberships m ON m.id = i.membership_id
		JOIN assoc_organisations o ON o.id = m.organisation_id
		WHERE i.id = $1`
	if err := s.db.QueryRow(ctx, qInv, invoiceID).Scan(&amount, &title, &status, &ownerID, &membership, &orgName, &invoiceOrg); err != nil {
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
	if err := s.audit(ctx, tx, invoiceOrg, userID, "DUES_PAY", "invoice", invoiceID, map[string]any{"amountKobo": amount, "method": req.Method}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("association: commit: %w", err)
	}

	// Record realized Spotlight profit into the central Commission & Profit registry.
	// This is the dues-settlement point: the RevenueSplit above realizes the platform
	// fee (5% of the dues amount). We record that EXACT platform share (not the whole
	// dues, not a flat 10%) as the profit; gross = the full dues amount is passed for
	// throughput context. Best-effort + idempotent: the invoice id doubles as source
	// ref + idempotency key, so retries / the early PAID return never double-count. A
	// recorder failure is logged and swallowed — it must NEVER fail or reverse the dues
	// payment above.
	s.recordCommissionSafe(ctx, "Community", "Group Membership", "", amount, platformShareKobo(amount), invoiceID, &userID)

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
	// On approval, activate the membership from the application. This was an
	// UPDATE joined to assoc_memberships, which silently affected zero rows
	// whenever no membership existed yet — i.e. for every organically-joined
	// applicant. ensureMembership upserts, so approving works whether or not
	// SubmitApplication already staged a PENDING row.
	if req.Decision == "APPROVE" {
		var appUser string
		var catID, chapID *string
		if err := tx.QueryRow(ctx,
			`SELECT user_id, category_id, chapter_id FROM assoc_applications WHERE id=$1`, appID,
		).Scan(&appUser, &catID, &chapID); err != nil {
			return fmt.Errorf("association: load application: %w", err)
		}
		if _, err := s.ensureMembership(ctx, tx, appOrg, appUser, "ACTIVE", "DUE", "MBR", catID, chapID); err != nil {
			return err
		}
	}
	if err := s.audit(ctx, tx, appOrg, adminID, "APPROVAL_DECISION", "application", appID, map[string]any{"decision": req.Decision, "note": req.Note}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ── Discovery ────────────────────────────────────────────────────────────────

// GetOrganisations lists published organisations, optionally filtered by search
// term. Ordered newest-first so a freshly published organisation is immediately
// discoverable; `id` breaks created_at ties (a bare created_at sort makes
// pagination drop or repeat rows when several orgs share a timestamp).
func (s *Service) GetOrganisations(ctx context.Context, search string, limit, offset int) ([]OrganisationSummary, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
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
	args = append(args, limit, offset)
	q += fmt.Sprintf(` ORDER BY o.created_at DESC, o.id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args))
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
		       o.website, o.approval_rule,
		       o.grace_days, o.disable_voting, o.disable_events, o.disable_chat, o.disable_card,
		       (SELECT count(*) FROM assoc_memberships m WHERE m.organisation_id=o.id AND m.status='ACTIVE'),
		       (SELECT count(*) FROM assoc_chapters c WHERE c.organisation_id=o.id)
		FROM assoc_organisations o
		WHERE o.id=$1 AND o.published=true
		  AND (o.group_type <> 'INVITE_ONLY'
		       OR EXISTS (SELECT 1 FROM assoc_memberships mm
		                  WHERE mm.organisation_id=o.id AND mm.user_id=$2))`
	var org Organisation
	var approvalRule string
	if err := s.db.QueryRow(ctx, q, orgID, viewerID).Scan(
		&org.ID, &org.Name, &org.Acronym, &org.Category, &org.LogoURL, &org.CoverURL,
		&org.GroupType, &org.Verified, &org.Location, &org.Description,
		&org.FoundedYear, &org.RequiresPayment, &org.RegistrationFeeKobo,
		&org.Website, &approvalRule,
		&org.Restrictions.GraceDays, &org.Restrictions.DisableVoting, &org.Restrictions.DisableEvents,
		&org.Restrictions.DisableChat, &org.Restrictions.DisableCard,
		&org.MemberCount, &org.ChapterCount,
	); err != nil {
		return nil, fmt.Errorf("association: org not found: %w", err)
	}
	org.ApprovalSummary = approvalSummary(approvalRule, org.GroupType)

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
	// Branches are the chapter names, which is what the join screen lists.
	org.Branches = make([]string, 0, len(org.Chapters))
	for _, ch := range org.Chapters {
		org.Branches = append(org.Branches, ch.Name)
	}

	org.Rules = []string{}
	if ruleRows, err := s.db.Query(ctx,
		`SELECT body FROM assoc_organisation_rules WHERE organisation_id=$1 ORDER BY position, id`, orgID); err == nil {
		defer ruleRows.Close()
		for ruleRows.Next() {
			var body string
			if err := ruleRows.Scan(&body); err == nil {
				org.Rules = append(org.Rules, body)
			}
		}
	}

	org.CommitteeOptions = []string{}
	if cmRows, err := s.db.Query(ctx,
		`SELECT name FROM assoc_committees WHERE organisation_id=$1 ORDER BY name`, orgID); err == nil {
		defer cmRows.Close()
		for cmRows.Next() {
			var name string
			if err := cmRows.Scan(&name); err == nil {
				org.CommitteeOptions = append(org.CommitteeOptions, name)
			}
		}
	}

	// Join requirements are derived from the organisation's own configuration
	// rather than stored per-org: there is no requirements table, and inventing
	// one would put an empty list in front of every existing organisation.
	org.Requirements = []JoinRequirement{}
	if org.RequiresPayment || org.RegistrationFeeKobo > 0 {
		org.Requirements = append(org.Requirements, JoinRequirement{
			ID: "registration_fee", Kind: "PAYMENT", Required: true,
			Label: "Pay the registration fee to activate membership",
		})
	}
	if len(org.MembershipCategories) > 0 {
		org.Requirements = append(org.Requirements, JoinRequirement{
			ID: "membership_category", Kind: "CHOICE", Required: true,
			Label: "Choose a membership category",
		})
	}
	if len(org.Chapters) > 0 {
		org.Requirements = append(org.Requirements, JoinRequirement{
			ID: "chapter", Kind: "CHOICE", Required: true,
			Label: "Select your chapter",
		})
	}
	if len(org.Rules) > 0 {
		org.Requirements = append(org.Requirements, JoinRequirement{
			ID: "accept_rules", Kind: "ACKNOWLEDGEMENT", Required: true,
			Label: "Accept the group rules",
		})
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
		SELECT m.id, m.organisation_id, m.member_code, m.status, m.payment_standing, m.verified, m.valid_through,
		       o.name, o.acronym,
		       COALESCE(mc.label,'Member'),
		       ch.name,
		       COALESCE(mp.full_name,''), mp.photo_url
		FROM assoc_memberships m
		JOIN assoc_organisations o ON o.id=m.organisation_id
		LEFT JOIN assoc_membership_categories mc ON mc.id=m.category_id
		LEFT JOIN assoc_chapters ch ON ch.id=m.chapter_id
		LEFT JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		WHERE m.user_id=$1 AND m.status='ACTIVE'
		LIMIT 1`
	var card MembershipCard
	var membershipID, orgID string
	var validThrough *string
	if err := s.db.QueryRow(ctx, q, userID).Scan(
		&membershipID, &orgID, &card.MemberID, &card.Status, &card.PaymentStanding, &card.Verified, &validThrough,
		&card.OrganisationName, &card.OrganisationAcronym,
		&card.CategoryLabel, &card.ChapterName,
		&card.FullName, &card.PhotoURL,
	); err != nil {
		return card, fmt.Errorf("association: membership not found: %w", err)
	}
	card.ValidThrough = validThrough
	// Signed QR token (AMC1.<payload>.<hmac>) — VerifyCard authenticates it and
	// then re-checks the LIVE record (authenticity != validity).
	card.QRPayload = s.SignCardToken(membershipID, card.MemberID, orgID)
	return card, nil
}

// GetProfile returns the caller's full editable profile.
func (s *Service) GetProfile(ctx context.Context, userID string) (*MyProfile, error) {
	const q = `
		SELECT COALESCE(mp.full_name, ''), m.member_code, mp.photo_url,
		       COALESCE(mp.email, ''), COALESCE(mp.phone, ''),
		       COALESCE(mp.profession, ''), COALESCE(mp.location, ''),
		       mp.dob::text, COALESCE(mp.bio, ''),
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
		SELECT r.role, r.jurisdiction, m.organisation_id::text, o.name
		FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id=r.membership_id
		JOIN assoc_organisations o ON o.id=m.organisation_id
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
	var orgID, orgName *string
	if err := s.db.QueryRow(ctx, q, userID).Scan(&role, &jurisdiction, &orgID, &orgName); err != nil {
		// No assoc_member_roles row. That is not the end of the story: every
		// server-side guard (requireCapInOrg / requireAdminInOrg / requireCap)
		// first checks isPlatformSuperAdmin, so a platform super-admin holding no
		// association membership WOULD be authorized — while this endpoint told
		// the client isAdmin:false and the UI hid everything they could actually
		// do. OrganisationID stays nil: they are not scoped to one org, and the
		// console picks the org explicitly.
		if s.isPlatformSuperAdmin(ctx, userID) {
			return &AdminAccess{
				IsAdmin:      true,
				Role:         "SUPER_ADMIN",
				RoleLabel:    "Platform Super Admin",
				Jurisdiction: "NATIONAL",
				Can:          capabilitiesFor("SUPER_ADMIN"),
			}, nil
		}
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

		OrganisationID:   orgID,
		OrganisationName: orgName,
	}, nil
}

// isPlatformSuperAdmin mirrors user_has_permission()'s hard-coded bypass
// (20260527100000_enterprise_auth_rbac.sql): any user holding the platform
// public.roles 'super-admin' role passes ANY permission check regardless of
// association-specific role rows. Without this, the platform admin console
// (which authenticates via platform RBAC, not assoc_member_roles) has no way
// to reach association admin data at all — every association operator is
// scoped to organisations they personally joined as a member, which is the
// right model for association self-governance but wrong for the ops console
// this function backs.
func (s *Service) isPlatformSuperAdmin(ctx context.Context, userID string) bool {
	var ok bool
	if err := s.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.user_roles ur
			JOIN public.roles r ON r.id = ur.role_id
			WHERE ur.user_id = $1 AND ur.is_active = true AND r.is_active = true
				AND r.slug = 'super-admin' AND (ur.expires_at IS NULL OR ur.expires_at > now())
		)`, userID).Scan(&ok); err != nil {
		return false
	}
	return ok
}

// requireAssocAdmin checks that the caller holds an admin role; returns ErrForbidden otherwise.
func (s *Service) requireAssocAdmin(ctx context.Context, userID string) error {
	if s.isPlatformSuperAdmin(ctx, userID) {
		return nil
	}
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
	if s.isPlatformSuperAdmin(ctx, userID) {
		return nil
	}
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
	if s.isPlatformSuperAdmin(ctx, userID) {
		return nil
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
	// full_name is nullable and FullName is not a pointer, so an incomplete
	// profile crashed the whole listing with "cannot scan NULL into *string".
	// Falls back to the member code so a nameless member is still identifiable.
	query := `
		SELECT m.id, COALESCE(mp.full_name, m.member_code, ''), m.member_code, mp.photo_url,
		       COALESCE(mc.label,'Member'), ch.name, m.status, mp.profession,
		       m.organisation_id::text
		FROM assoc_memberships m
		JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		LEFT JOIN assoc_membership_categories mc ON mc.id=m.category_id
		LEFT JOIN assoc_chapters ch ON ch.id=m.chapter_id
		WHERE 1=1`
	args := []any{}
	// Status scoping. The ACTIVE-only filter used to be hardcoded here, which
	// made suspended members invisible to the admin console — and since the only
	// page carrying the Restore button is the member detail page reached from
	// this list, RestoreMember was unreachable. An explicit ?status= still
	// filters; an admin browsing a specific org (org_id set, authorized below)
	// sees every status. A plain member still only ever sees ACTIVE members.
	if q.Status == "" && q.OrgID == "" {
		query += ` AND m.status='ACTIVE'`
	}
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
	//
	// The admin console's org picker overrides this with an explicit org_id
	// instead — a platform admin has no ACTIVE membership of their own, so the
	// default clause would always return empty for them. requireCapInOrg
	// authorizes the override the same way every other admin mutation does
	// (platform super-admin, or a real per-org admin role in that org).
	if q.OrgID != "" {
		if err := s.requireCapInOrg(ctx, userID, q.OrgID, func(AdminCapabilities) bool { return true }); err != nil {
			return nil, err
		}
		args = append(args, q.OrgID)
		query += fmt.Sprintf(` AND m.organisation_id=$%d`, len(args))
	} else {
		args = append(args, userID)
		query += fmt.Sprintf(` AND m.organisation_id IN (SELECT organisation_id FROM assoc_memberships WHERE user_id=$%d AND status='ACTIVE')`, len(args))
	}
	// Respect the viewer's privacy: don't expose contact-restricted profiles to non-self.
	args = append(args, userID)
	query += fmt.Sprintf(` AND (mp.contact_restricted=false OR m.user_id=$%d)`, len(args))
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
			&m.CategoryLabel, &m.ChapterName, &m.Status, &m.Profession,
			&m.OrganisationID); err != nil {
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
	// Viewer scoping. The co-membership EXISTS clause is the correct rule for a
	// member-to-member lookup, but it locked out the admin console entirely: a
	// platform admin holds no association membership of their own, so this
	// always missed and statusFor mapped the generic error to a 500 — and the
	// member detail page is the ONLY page hosting suspend/restore/transfer/role,
	// so every member action was behind a page that could not load.
	//
	// An authorized admin of the target's organisation now bypasses the
	// co-membership requirement (and sees non-ACTIVE members, which is required
	// for Restore to be reachable at all). Everyone else keeps the old rule.
	var targetOrg, targetStatus string
	if err := s.db.QueryRow(ctx,
		`SELECT organisation_id::text, status FROM assoc_memberships WHERE id=$1`, targetID,
	).Scan(&targetOrg, &targetStatus); err != nil {
		return nil, fmt.Errorf("association: member not found: %w", err)
	}
	isAdminViewer := s.requireCapInOrg(ctx, viewerID, targetOrg, func(c AdminCapabilities) bool {
		return c.ManageMembers
	}) == nil

	q := `
		SELECT m.id, COALESCE(mp.full_name, m.member_code, ''), m.member_code, mp.photo_url,
		       COALESCE(mc.label,'Member'), ch.name, m.status, mp.profession,
		       mp.email, mp.phone, mp.location, m.joined_at::text,
		       m.payment_standing, mp.bio, mp.contact_restricted,
		       m.organisation_id::text
		FROM assoc_memberships m
		JOIN assoc_member_profiles mp ON mp.membership_id=m.id
		LEFT JOIN assoc_membership_categories mc ON mc.id=m.category_id
		LEFT JOIN assoc_chapters ch ON ch.id=m.chapter_id
		WHERE m.id=$1`
	if !isAdminViewer {
		q += `
		  AND m.status='ACTIVE'
		  AND EXISTS (SELECT 1 FROM assoc_memberships v
		              WHERE v.user_id=$2 AND v.status='ACTIVE'
		                AND v.organisation_id = m.organisation_id)`
	} else {
		// $2 must still be consumed so the parameter count matches.
		q += ` AND ($2 = $2)`
	}
	var mp MemberProfile
	var restricted bool
	if err := s.db.QueryRow(ctx, q, targetID, viewerID).Scan(
		&mp.ID, &mp.FullName, &mp.MemberID, &mp.PhotoURL,
		&mp.CategoryLabel, &mp.ChapterName, &mp.Status, &mp.Profession,
		&mp.Email, &mp.Phone, &mp.Location, &mp.JoinedAt,
		&mp.PaymentStanding, &mp.Bio, &restricted, &mp.OrganisationID,
	); err != nil {
		return nil, fmt.Errorf("association: member not found: %w", err)
	}
	mp.ContactRestricted = restricted
	// An admin acting on the member needs their contact details to act; a peer
	// viewer does not. Self always sees their own.
	if restricted && viewerID != targetID && !isAdminViewer {
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
		SELECT e.id, e.title, e.starts_at::text, COALESCE(e.location,''),
		       CASE WHEN e.starts_at > now() THEN 'UPCOMING' ELSE 'PAST' END,
		       e.paid, e.fee_kobo, e.cover_url,
		       EXISTS(SELECT 1 FROM assoc_event_registrations er
		              JOIN assoc_memberships m2 ON m2.id=er.membership_id
		              WHERE er.event_id=e.id AND m2.user_id=$1 AND er.registered=true),
		       (SELECT er.rsvp FROM assoc_event_registrations er
		         JOIN assoc_memberships m3 ON m3.id=er.membership_id
		        WHERE er.event_id=e.id AND m3.user_id=$1 LIMIT 1)
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
			&e.State, &e.Paid, &e.FeeKobo, &e.CoverURL, &e.Registered, &e.Rsvp); err != nil {
			// A scan failure here used to be swallowed, which silently dropped the
			// row from the caller's list; surface it instead.
			return nil, fmt.Errorf("association: events: scan: %w", err)
		}
		out = append(out, e)
	}
	if out == nil {
		out = []EventSummary{}
	}
	return out, rows.Err()
}

// ── Admin reads ───────────────────────────────────────────────────────────────

// resolveOrgID authorizes and resolves the organisation an admin console call
// is scoped to. An explicit orgID (the frontend's org picker — see
// ListAdminOrganisations) wins, after verifying the caller may act on it:
// a platform super-admin may pick any org, and a real per-org officer may
// only pick an org they hold a role in (requireCapInOrg, org-scoped, closes
// the cross-org IDOR the same way every other admin mutation already does).
//
// An empty orgID falls back to the caller's own primary admin-org
// membership — unchanged behavior for a real association officer using the
// mobile in-app admin surface, which has no org picker in front of it and
// only ever manages the one org they belong to.
func (s *Service) resolveOrgID(ctx context.Context, adminID, orgID string) (string, error) {
	if orgID != "" {
		if err := s.requireCapInOrg(ctx, adminID, orgID, func(AdminCapabilities) bool { return true }); err != nil {
			return "", err
		}
		return orgID, nil
	}
	var oid string
	if err := s.db.QueryRow(ctx, `
		SELECT m.organisation_id FROM assoc_member_roles r
		JOIN assoc_memberships m ON m.id=r.membership_id
		WHERE m.user_id=$1 LIMIT 1`, adminID).Scan(&oid); err != nil {
		return "", fmt.Errorf("association: admin org: %w", err)
	}
	return oid, nil
}

// ListAdminOrganisations feeds the admin console's org picker. A platform
// super-admin gets every organisation (optionally filtered by name search —
// there is no per-org membership to narrow the set, and the table is large
// enough in practice that an unfiltered call should still page reasonably);
// a real per-org officer gets only the organisation(s) they hold an admin
// role in, same as requireAssocAdmin/resolveOrgID's fallback path.
func (s *Service) ListAdminOrganisations(ctx context.Context, adminID string, f AdminOrgFilter) ([]AdminOrgOption, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	limit, offset := f.Limit, f.Offset
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	// One query for both audiences, differing only in the scope predicate: a
	// platform super-admin sees every organisation, a per-org officer only the
	// ones they hold a role in. (This used to be two near-identical branches.)
	args := []any{}
	scope := "TRUE"
	if !s.isPlatformSuperAdmin(ctx, adminID) {
		args = append(args, adminID)
		scope = fmt.Sprintf(`o.id IN (
			SELECT am.organisation_id FROM assoc_member_roles ar
			JOIN assoc_memberships am ON am.id=ar.membership_id
			WHERE am.user_id=$%d AND ar.role != 'NONE')`, len(args))
	}
	q := fmt.Sprintf(`
		SELECT o.id, o.name, o.acronym, o.category, o.status, o.published, o.verified,
		       (SELECT count(*) FROM assoc_memberships m WHERE m.organisation_id=o.id),
		       o.created_at::text
		FROM assoc_organisations o
		WHERE %s`, scope)

	if f.Search != "" {
		args = append(args, "%"+f.Search+"%")
		n := len(args)
		q += fmt.Sprintf(` AND (o.name ILIKE $%d OR o.acronym ILIKE $%d OR o.category ILIKE $%d)`, n, n, n)
	}
	// Filters were previously applied client-side because the service accepted
	// only a search term, which meant a filtered page could come back empty
	// purely because the matching rows were on another page.
	if f.Published != nil {
		args = append(args, *f.Published)
		q += fmt.Sprintf(` AND o.published = $%d`, len(args))
	}
	if f.Verified != nil {
		args = append(args, *f.Verified)
		q += fmt.Sprintf(` AND o.verified = $%d`, len(args))
	}
	if f.Status != "" {
		args = append(args, f.Status)
		q += fmt.Sprintf(` AND o.status = $%d`, len(args))
	}
	if f.Category != "" {
		args = append(args, f.Category)
		q += fmt.Sprintf(` AND o.category = $%d`, len(args))
	}
	args = append(args, limit, offset)
	q += fmt.Sprintf(` ORDER BY o.created_at DESC, o.id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args))

	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("association: list orgs: %w", err)
	}
	defer rows.Close()
	out := []AdminOrgOption{}
	for rows.Next() {
		var o AdminOrgOption
		if err := rows.Scan(&o.ID, &o.Name, &o.Acronym, &o.Category, &o.Status,
			&o.Published, &o.Verified, &o.MemberCount, &o.CreatedAt); err != nil {
			continue
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *Service) GetAdminKpis(ctx context.Context, adminID, orgIDOverride string) (*AdminKpis, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	orgID, err := s.resolveOrgID(ctx, adminID, orgIDOverride)
	if err != nil {
		return nil, err
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

// GetApprovalQueue returns applications awaiting the admin's decision, scoped
// to the resolved org (see resolveOrgID).
func (s *Service) GetApprovalQueue(ctx context.Context, adminID, jurisdiction, orgIDOverride string) ([]AdminApplicationSummary, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	orgID, err := s.resolveOrgID(ctx, adminID, orgIDOverride)
	if err != nil {
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
		WHERE a.status IN ('PENDING','PENDING_CHAPTER','PENDING_NATIONAL','INFO_REQUESTED')
		  AND a.organisation_id=$1`
	args := []any{orgID}
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

	app.Documents = []ApplicationDocument{}
	if rows, err := s.db.Query(ctx,
		`SELECT id, label, url, kind FROM assoc_application_documents
		 WHERE application_id=$1 ORDER BY created_at`, appID); err == nil {
		defer rows.Close()
		for rows.Next() {
			var d ApplicationDocument
			if err := rows.Scan(&d.ID, &d.Label, &d.URL, &d.Kind); err == nil {
				app.Documents = append(app.Documents, d)
			}
		}
	}

	// Review SLA: hours remaining in the review window, negative once breached.
	// Only meaningful while the application is still awaiting a decision.
	if strings.HasPrefix(app.Status, "PENDING") || app.Status == "INFO_REQUESTED" {
		var hoursElapsed *float64
		if err := s.db.QueryRow(ctx,
			`SELECT EXTRACT(EPOCH FROM (now() - submitted_at)) / 3600.0
			   FROM assoc_applications WHERE id=$1`, appID).Scan(&hoursElapsed); err == nil && hoursElapsed != nil {
			left := applicationSLAHours - int(*hoursElapsed)
			app.SLAHoursLeft = &left
		}
	}
	return &app, nil
}

// applicationSLAHours is the review window a membership application is expected
// to be decided within.
const applicationSLAHours = 72

// GetFinanceSummary returns aggregate finance stats for the resolved org (see resolveOrgID).
func (s *Service) GetFinanceSummary(ctx context.Context, adminID, orgIDOverride string) (*FinanceSummary, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	orgID, err := s.resolveOrgID(ctx, adminID, orgIDOverride)
	if err != nil {
		return nil, err
	}
	var fs FinanceSummary
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(p.amount_kobo),0) FROM assoc_payments p JOIN assoc_memberships m ON m.id=p.membership_id WHERE m.organisation_id=$1 AND p.status='SUCCESS'`, orgID).Scan(&fs.CollectedKobo)
	_ = s.db.QueryRow(ctx, `SELECT COALESCE(SUM(i.amount_kobo),0) FROM assoc_dues_invoices i JOIN assoc_memberships m ON m.id=i.membership_id WHERE m.organisation_id=$1 AND i.status IN ('DUE','OVERDUE')`, orgID).Scan(&fs.OutstandingKobo)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_memberships WHERE organisation_id=$1 AND payment_standing='PAID' AND status='ACTIVE'`, orgID).Scan(&fs.PaidMembers)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_memberships WHERE organisation_id=$1 AND payment_standing!='PAID' AND status='ACTIVE'`, orgID).Scan(&fs.UnpaidMembers)
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM assoc_payments p JOIN assoc_memberships m ON m.id=p.membership_id WHERE m.organisation_id=$1 AND p.offline=true AND p.status='PENDING'`, orgID).Scan(&fs.OfflinePending)

	// Breakdowns. Collected counts SUCCESS payments; outstanding counts invoices
	// still DUE/OVERDUE. Members with no chapter/category roll up to a labelled
	// bucket rather than being dropped, so the lines always reconcile with the
	// headline totals.
	fs.ByChapter = s.financeBreakdown(ctx, orgID, `COALESCE(ch.name, 'Unassigned')`,
		`LEFT JOIN assoc_chapters ch ON ch.id = m.chapter_id`)
	fs.ByCategory = s.financeBreakdown(ctx, orgID, `COALESCE(mc.label, 'Uncategorised')`,
		`LEFT JOIN assoc_membership_categories mc ON mc.id = m.category_id`)
	return &fs, nil
}

// financeBreakdown groups collected/outstanding kobo by an arbitrary label
// expression. `labelExpr` and `join` are internal constants, never user input.
func (s *Service) financeBreakdown(ctx context.Context, orgID, labelExpr, join string) []FinanceBreakdownLine {
	q := fmt.Sprintf(`
		SELECT %s AS label,
		       COALESCE(SUM(paid.amt), 0)::bigint      AS collected,
		       COALESCE(SUM(owing.amt), 0)::bigint     AS outstanding,
		       count(DISTINCT m.id)                    AS members
		FROM assoc_memberships m
		%s
		LEFT JOIN LATERAL (
		  SELECT COALESCE(SUM(p.amount_kobo),0) AS amt FROM assoc_payments p
		   WHERE p.membership_id = m.id AND p.status = 'SUCCESS'
		) paid ON true
		LEFT JOIN LATERAL (
		  SELECT COALESCE(SUM(i.amount_kobo),0) AS amt FROM assoc_dues_invoices i
		   WHERE i.membership_id = m.id AND i.status IN ('DUE','OVERDUE')
		) owing ON true
		WHERE m.organisation_id = $1
		GROUP BY 1
		ORDER BY 1`, labelExpr, join)
	rows, err := s.db.Query(ctx, q, orgID)
	if err != nil {
		return []FinanceBreakdownLine{}
	}
	defer rows.Close()
	out := []FinanceBreakdownLine{}
	for rows.Next() {
		var l FinanceBreakdownLine
		if err := rows.Scan(&l.Label, &l.CollectedKobo, &l.OutstandingKobo, &l.MemberCount); err == nil {
			out = append(out, l)
		}
	}
	return out
}

// GetOfflinePayments returns pending offline payment proofs awaiting admin
// approval, scoped to the resolved org (see resolveOrgID).
func (s *Service) GetOfflinePayments(ctx context.Context, adminID, orgIDOverride string) ([]OfflinePayment, error) {
	if err := s.requireAssocAdmin(ctx, adminID); err != nil {
		return nil, err
	}
	orgID, err := s.resolveOrgID(ctx, adminID, orgIDOverride)
	if err != nil {
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
		  AND m.organisation_id=$1
		ORDER BY p.created_at DESC LIMIT 200`, orgID)
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
