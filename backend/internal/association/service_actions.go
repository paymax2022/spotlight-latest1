package association

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

// Write-path (mutation) service methods for the association module, kept
// separate from service.go to reduce merge surface. All sensitive actions
// write an assoc_audit_log row. Money mutations require an Idempotency-Key
// (iron rule: fail-closed). Amounts are kobo. Schema: 20260628000000_association_module.sql.

// primaryMembership resolves the caller's membership id + organisation id.
func (s *Service) primaryMembership(ctx context.Context, userID string) (membershipID, orgID string, err error) {
	const q = `SELECT id, organisation_id FROM assoc_memberships WHERE user_id=$1 ORDER BY created_at LIMIT 1`
	if err = s.db.QueryRow(ctx, q, userID).Scan(&membershipID, &orgID); err != nil {
		return "", "", fmt.Errorf("association: membership not found: %w", err)
	}
	return membershipID, orgID, nil
}

// ─── Engagement ───────────────────────────────────────────────────────────────

func (s *Service) AcknowledgeAnnouncement(ctx context.Context, userID, announcementID string) error {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO assoc_announcement_reads (announcement_id, membership_id, read_at, acknowledged_at)
		VALUES ($1, $2, now(), now())
		ON CONFLICT (announcement_id, membership_id)
		DO UPDATE SET acknowledged_at = now(),
		             read_at = COALESCE(assoc_announcement_reads.read_at, now())`
	if _, err := s.db.Exec(ctx, q, announcementID, mid); err != nil {
		return fmt.Errorf("association: acknowledge announcement: %w", err)
	}
	return nil
}

func (s *Service) MarkNotificationsRead(ctx context.Context, userID string) error {
	const q = `
		UPDATE assoc_notifications SET read = true
		WHERE membership_id IN (SELECT id FROM assoc_memberships WHERE user_id = $1)`
	if _, err := s.db.Exec(ctx, q, userID); err != nil {
		return fmt.Errorf("association: mark notifications read: %w", err)
	}
	return nil
}

// ─── Meetings ─────────────────────────────────────────────────────────────────

func (s *Service) RsvpMeeting(ctx context.Context, userID, meetingID, status string) error {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO assoc_meeting_attendance (meeting_id, membership_id, rsvp)
		VALUES ($1, $2, $3)
		ON CONFLICT (meeting_id, membership_id) DO UPDATE SET rsvp = $3`
	if _, err := s.db.Exec(ctx, q, meetingID, mid, status); err != nil {
		return fmt.Errorf("association: rsvp meeting: %w", err)
	}
	return nil
}

// CheckInMeeting is idempotent: a repeated call keeps the first check-in time.
func (s *Service) CheckInMeeting(ctx context.Context, userID, meetingID string) error {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO assoc_meeting_attendance (meeting_id, membership_id, checked_in_at)
		VALUES ($1, $2, now())
		ON CONFLICT (meeting_id, membership_id)
		DO UPDATE SET checked_in_at = COALESCE(assoc_meeting_attendance.checked_in_at, now())`
	if _, err := s.db.Exec(ctx, q, meetingID, mid); err != nil {
		return fmt.Errorf("association: meeting check-in: %w", err)
	}
	return nil
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

func (s *Service) UpdateTaskStatus(ctx context.Context, userID, taskID, status string) error {
	const q = `
		UPDATE assoc_tasks SET status = $3
		WHERE id = $1 AND assignee_id IN (SELECT id FROM assoc_memberships WHERE user_id = $2)`
	tag, err := s.db.Exec(ctx, q, taskID, userID, status)
	if err != nil {
		return fmt.Errorf("association: update task: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrForbidden
	}
	return nil
}

// ─── Documents ────────────────────────────────────────────────────────────────

func (s *Service) AcknowledgeDocument(ctx context.Context, userID, documentID string) error {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO assoc_document_acks (document_id, membership_id)
		VALUES ($1, $2) ON CONFLICT (document_id, membership_id) DO NOTHING`
	if _, err := s.db.Exec(ctx, q, documentID, mid); err != nil {
		return fmt.Errorf("association: acknowledge document: %w", err)
	}
	return nil
}

// ─── Committees ───────────────────────────────────────────────────────────────

// RequestJoinCommittee creates a PENDING committee-member row and audit-logs
// the request. Idempotent (ON CONFLICT DO NOTHING).
func (s *Service) RequestJoinCommittee(ctx context.Context, userID, committeeID string) error {
	membershipID, orgID, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	const ins = `
		INSERT INTO assoc_committee_members (committee_id, membership_id, status)
		VALUES ($1, $2, 'PENDING')
		ON CONFLICT (committee_id, membership_id) DO NOTHING`
	if _, err := tx.Exec(ctx, ins, committeeID, membershipID); err != nil {
		return fmt.Errorf("association: committee join: %w", err)
	}
	if err := s.audit(ctx, tx, orgID, userID, "COMMITTEE_JOIN_REQUEST", "committee", committeeID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Events ───────────────────────────────────────────────────────────────────

func (s *Service) RsvpEvent(ctx context.Context, userID, eventID, rsvp string) error {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO assoc_event_registrations (event_id, membership_id, rsvp)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_id, membership_id) DO UPDATE SET rsvp = $3`
	if _, err := s.db.Exec(ctx, q, eventID, mid, rsvp); err != nil {
		return fmt.Errorf("association: rsvp event: %w", err)
	}
	return nil
}

// RegisterEvent marks the member registered and issues a ticket code. Idempotent.
func (s *Service) RegisterEvent(ctx context.Context, userID, eventID string) (string, error) {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return "", err
	}
	ticket := "SPOTLIGHT:EVT:" + eventID + ":ticket"
	const q = `
		INSERT INTO assoc_event_registrations (event_id, membership_id, registered, ticket_code)
		VALUES ($1, $2, true, $3)
		ON CONFLICT (event_id, membership_id)
		DO UPDATE SET registered = true, ticket_code = EXCLUDED.ticket_code`
	if _, err := s.db.Exec(ctx, q, eventID, mid, ticket); err != nil {
		return "", fmt.Errorf("association: register event: %w", err)
	}
	return ticket, nil
}

func (s *Service) SubmitEventFeedback(ctx context.Context, userID, eventID string, rating int, comment string) error {
	mid, _, err := s.primaryMembership(ctx, userID)
	if err != nil {
		return err
	}
	fb, err := json.Marshal(map[string]any{"rating": rating, "comment": comment})
	if err != nil {
		return fmt.Errorf("association: feedback marshal: %w", err)
	}
	const q = `UPDATE assoc_event_registrations SET feedback = $3 WHERE event_id = $1 AND membership_id = $2`
	if _, err := s.db.Exec(ctx, q, eventID, mid, fb); err != nil {
		return fmt.Errorf("association: event feedback: %w", err)
	}
	return nil
}

// ─── Admin: offline payments ──────────────────────────────────────────────────

// DecideOfflinePayment approves or rejects an offline payment submission.
// Approval posts a balanced double-entry: DR provider_clearing → CR settlement.
// Requires Idempotency-Key for the approve path (iron rule: fail-closed).
func (s *Service) DecideOfflinePayment(ctx context.Context, adminID, paymentID, idempotencyKey string, approve bool) error {
	if approve && idempotencyKey == "" {
		return ErrIdempotencyRequired
	}
	// Org-scoped finance authorization (cross-org IDOR fix): resolve the payment's
	// organisation via its membership and require ManageFinance IN THAT org, so a
	// finance admin of another org cannot approve/reject this org's payment.
	var payOrg string
	if err := s.db.QueryRow(ctx, `
		SELECT m.organisation_id FROM assoc_payments p
		JOIN assoc_memberships m ON m.id = p.membership_id
		WHERE p.id=$1`, paymentID).Scan(&payOrg); err != nil {
		return fmt.Errorf("association: payment not found: %w", err)
	}
	if err := s.requireCapInOrg(ctx, adminID, payOrg, func(c AdminCapabilities) bool { return c.ManageFinance }); err != nil {
		return err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var invoiceID string
	var amountKobo int64
	if err := tx.QueryRow(ctx,
		`SELECT invoice_id, amount_kobo FROM assoc_payments WHERE id=$1`, paymentID,
	).Scan(&invoiceID, &amountKobo); err != nil {
		return fmt.Errorf("association: payment not found: %w", err)
	}

	if approve {
		if _, err := tx.Exec(ctx, `UPDATE assoc_payments SET status='SUCCESS', approved_by=$2 WHERE id=$1`, paymentID, adminID); err != nil {
			return fmt.Errorf("association: approve payment: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE assoc_dues_invoices SET status='PAID' WHERE id=$1`, invoiceID); err != nil {
			return fmt.Errorf("association: mark invoice paid: %w", err)
		}
		// Commit DB changes before posting to ledger (ledger is its own tx).
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("association: commit approval: %w", err)
		}

		// Double-entry: DR provider_clearing (external cash received) → CR settlement.
		clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
		if err != nil {
			return fmt.Errorf("association: clearing account: %w", err)
		}
		settle, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
		if err != nil {
			return fmt.Errorf("association: settlement account: %w", err)
		}
		if err := s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference:       "assoc_offline_approval:" + paymentID,
			IdempotencyKey:  idempotencyKey,
			AmountKobo:      amountKobo,
			DebitAccountID:  clearing.ID,
			CreditAccountID: settle.ID,
		}); err != nil && !errors.Is(err, ledger.ErrDuplicate) {
			return fmt.Errorf("association: offline payment ledger: %w", err)
		}
		return nil
	}

	// Reject path: no money movement, just status update + audit.
	if _, err := tx.Exec(ctx, `UPDATE assoc_payments SET status='FAILED' WHERE id=$1`, paymentID); err != nil {
		return fmt.Errorf("association: reject payment: %w", err)
	}
	if err := s.audit(ctx, tx, "", adminID, "OFFLINE_PAYMENT_REJECTED", "payment", paymentID, nil); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Admin: member lifecycle ──────────────────────────────────────────────────

func (s *Service) SuspendMember(ctx context.Context, adminID, memberID, reason string) error {
	return s.memberStatusAction(ctx, adminID, memberID, "SUSPENDED", "MEMBER_SUSPEND", map[string]any{"reason": reason})
}

func (s *Service) RestoreMember(ctx context.Context, adminID, memberID string) error {
	return s.memberStatusAction(ctx, adminID, memberID, "ACTIVE", "MEMBER_RESTORE", nil)
}

func (s *Service) memberStatusAction(ctx context.Context, adminID, memberID, status, action string, meta map[string]any) error {
	// Org-scoped member authorization (cross-org IDOR fix): the admin must hold
	// ManageMembers in the TARGET member's organisation.
	memOrg, err := s.membershipOrg(ctx, memberID)
	if err != nil {
		return err
	}
	if err := s.requireCapInOrg(ctx, adminID, memOrg, func(c AdminCapabilities) bool { return c.ManageMembers }); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE assoc_memberships SET status=$2 WHERE id=$1`, memberID, status); err != nil {
		return fmt.Errorf("association: member status: %w", err)
	}
	if err := s.audit(ctx, tx, "", adminID, action, "member", memberID, meta); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) TransferMember(ctx context.Context, adminID, memberID, chapter string) error {
	// Org-scoped: admin must hold ManageMembers in the target member's org.
	memOrg, err := s.membershipOrg(ctx, memberID)
	if err != nil {
		return err
	}
	if err := s.requireCapInOrg(ctx, adminID, memOrg, func(c AdminCapabilities) bool { return c.ManageMembers }); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	const q = `
		UPDATE assoc_memberships
		SET chapter_id = (
			SELECT id FROM assoc_chapters
			WHERE name = $2 AND organisation_id = (SELECT organisation_id FROM assoc_memberships WHERE id = $1)
			LIMIT 1)
		WHERE id = $1`
	if _, err := tx.Exec(ctx, q, memberID, chapter); err != nil {
		return fmt.Errorf("association: transfer member: %w", err)
	}
	if err := s.audit(ctx, tx, "", adminID, "MEMBER_TRANSFER", "member", memberID, map[string]any{"chapter": chapter}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// AssignRole requires SUPER_ADMIN or NATIONAL_ADMIN (both ManageMembers and
// ManageFinance capabilities) — CHAPTER_ADMIN and FINANCE_ADMIN may not
// self-escalate or delegate.
func (s *Service) AssignRole(ctx context.Context, adminID, memberID, role string) error {
	// Org-scoped: role grants require SUPER_ADMIN/NATIONAL_ADMIN (ManageMembers &&
	// ManageFinance) IN THE TARGET member's organisation — an admin of another org
	// cannot assign roles here (cross-org IDOR fix), and lower roles cannot escalate.
	memOrg, err := s.membershipOrg(ctx, memberID)
	if err != nil {
		return err
	}
	if err := s.requireCapInOrg(ctx, adminID, memOrg, func(c AdminCapabilities) bool {
		return c.ManageMembers && c.ManageFinance // only SUPER_ADMIN / NATIONAL_ADMIN
	}); err != nil {
		return err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("association: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	const q = `INSERT INTO assoc_member_roles (id, membership_id, role, granted_by) VALUES ($1,$2,$3,$4)`
	if _, err := tx.Exec(ctx, q, uuid.New().String(), memberID, role, adminID); err != nil {
		return fmt.Errorf("association: assign role: %w", err)
	}
	if err := s.audit(ctx, tx, "", adminID, "ROLE_ASSIGN", "member", memberID, map[string]any{"role": role}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Admin: bulk import ───────────────────────────────────────────────────────

// BulkImportRow is one record from the CSV (header row is skipped).
// Required: email. Optional: name, phone, member_code, category_label, chapter_label.
type BulkImportRow struct {
	UserID        string // resolved from email; skipped if blank + no email match
	Name          string
	Email         string
	Phone         string
	MemberCode    string
	CategoryLabel string
	ChapterLabel  string
}

// BulkImportMembers parses a CSV (name,email,phone,member_code,category_label,chapter_label)
// and inserts ACTIVE memberships for rows whose email resolves to an existing user.
// Rows with no matching user are silently skipped. Requires ImportMembers capability.
// Returns the count of successfully inserted memberships.
func (s *Service) BulkImportMembers(ctx context.Context, adminID, orgID string, r io.Reader) (int, error) {
	if err := s.requireCap(ctx, adminID, func(c AdminCapabilities) bool { return c.ImportMembers }); err != nil {
		return 0, err
	}

	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true
	cr.FieldsPerRecord = -1 // allow variable column count

	// Skip header row.
	if _, err := cr.Read(); err != nil {
		return 0, fmt.Errorf("association: import: read header: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("association: import: begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	count := 0
	for {
		rec, err := cr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue // skip malformed rows
		}
		row := parseImportRow(rec)
		if row.Email == "" && row.UserID == "" {
			continue
		}

		// Resolve user by email if no user_id provided.
		userID := row.UserID
		if userID == "" {
			if err := tx.QueryRow(ctx,
				`SELECT id FROM auth.users WHERE email=$1 LIMIT 1`, row.Email,
			).Scan(&userID); err != nil {
				continue // email not in auth.users — skip
			}
		}

		// Resolve optional category.
		var categoryID *string
		if row.CategoryLabel != "" {
			var cid string
			if err := tx.QueryRow(ctx,
				`SELECT id FROM assoc_membership_categories WHERE organisation_id=$1 AND label=$2 LIMIT 1`,
				orgID, row.CategoryLabel,
			).Scan(&cid); err == nil {
				categoryID = &cid
			}
		}

		// Resolve optional chapter.
		var chapterID *string
		if row.ChapterLabel != "" {
			var chid string
			if err := tx.QueryRow(ctx,
				`SELECT id FROM assoc_chapters WHERE organisation_id=$1 AND name=$2 LIMIT 1`,
				orgID, row.ChapterLabel,
			).Scan(&chid); err == nil {
				chapterID = &chid
			}
		}

		memberCode := row.MemberCode
		if memberCode == "" {
			memberCode = "IMP-" + strings.ToUpper(uuid.New().String()[:8])
		}

		const ins = `
			INSERT INTO assoc_memberships (organisation_id, user_id, member_code, category_id, chapter_id, status, payment_standing)
			VALUES ($1,$2,$3,$4,$5,'ACTIVE','DUE')
			ON CONFLICT DO NOTHING`
		tag, err := tx.Exec(ctx, ins, orgID, userID, memberCode, categoryID, chapterID)
		if err != nil {
			continue
		}
		if tag.RowsAffected() > 0 {
			count++
		}
	}

	if err := s.audit(ctx, tx, orgID, adminID, "BULK_IMPORT", "organisation", orgID,
		map[string]any{"imported": count}); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("association: import: commit: %w", err)
	}
	return count, nil
}

// parseImportRow extracts up to 6 fields from a CSV record.
// Expected order: name, email, phone, member_code, category_label, chapter_label.
func parseImportRow(rec []string) BulkImportRow {
	get := func(i int) string {
		if i < len(rec) {
			return strings.TrimSpace(rec[i])
		}
		return ""
	}
	return BulkImportRow{
		Name:          get(0),
		Email:         get(1),
		Phone:         get(2),
		MemberCode:    get(3),
		CategoryLabel: get(4),
		ChapterLabel:  get(5),
	}
}
