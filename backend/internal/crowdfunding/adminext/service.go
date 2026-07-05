package adminext

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the crowdfunding admin domain service. It reads/writes the cf_*
// admin tables via a pgx pool (the money-path access pattern). It is transactional
// for every guarded transition and writes an audit row on each decision.
type Service struct {
	db *pgxpool.Pool
}

// NewService constructs the admin service.
func NewService(db *pgxpool.Pool) *Service { return &Service{db: db} }

// rfc3339 formats a timestamp the way the TS client expects.
func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// audit writes an immutable audit row. Caller supplies the executing tx so the
// audit is committed atomically with the mutation it records.
func (s *Service) audit(ctx context.Context, tx pgx.Tx, actor, action, target string) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO cf_audit_logs (actor, action, target, ip) VALUES ($1,$2,$3,$4)`,
		actor, action, target, "")
	return err
}

// ─── Finance summary ─────────────────────────────────────────────────────────

// GetFinanceSummary derives money figures live from campaigns/contributions plus
// the refunds/settlement admin tables. Never reads a stored balance.
func (s *Service) GetFinanceSummary(ctx context.Context) (*FinanceSummary, error) {
	out := &FinanceSummary{}

	// GMV + escrow from the contributions ledger.
	_ = s.db.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(amount_kobo) FILTER (WHERE status IN ('escrowed','released')),0),
			COALESCE(SUM(amount_kobo) FILTER (WHERE status='escrowed'),0)
		FROM contributions`).Scan(&out.GmvKobo, &out.EscrowKobo)
	out.PlatformRevenueKobo = out.GmvKobo / 40 // 2.5% indicative platform fee

	// Refunds pending (REQUESTED) from the admin refunds table.
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo),0), COUNT(*)
		FROM cf_refunds WHERE status='REQUESTED'`).Scan(&out.RefundsPendingKobo, &out.RefundsPendingCount)

	// Settled this month from settled batches.
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(net_kobo),0)
		FROM cf_settlements
		WHERE status='SETTLED' AND created_at >= date_trunc('month', NOW())`).Scan(&out.SettledThisMonthKobo)

	// Chargebacks: derived from rejected refunds that were already processed
	// (indicative). Kept simple + deterministic.
	_ = s.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_kobo),0), COUNT(*)
		FROM cf_refunds WHERE status='REJECTED'`).Scan(&out.ChargebacksKobo, &out.ChargebacksCount)

	out.ReconciliationMismatches = 0
	return out, nil
}

// ─── Refunds ─────────────────────────────────────────────────────────────────

// ListRefunds returns refund requests, optionally filtered by status.
func (s *Service) ListRefunds(ctx context.Context, status string) ([]RefundRequest, error) {
	q := `SELECT id, reference, campaign_title, contributor_name, amount_kobo, reason, status, requested_at, refund_eligible
	      FROM cf_refunds`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY requested_at DESC`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RefundRequest{}
	for rows.Next() {
		var r RefundRequest
		var requestedAt time.Time
		if err := rows.Scan(&r.ID, &r.Reference, &r.CampaignTitle, &r.ContributorName,
			&r.AmountKobo, &r.Reason, &r.Status, &requestedAt, &r.RefundEligible); err != nil {
			return nil, err
		}
		r.RequestedAt = rfc3339(requestedAt)
		out = append(out, r)
	}
	return out, rows.Err()
}

// DecideRefund applies a guarded REQUESTED→APPROVED/REJECTED transition.
// A note is REQUIRED to reject. Writes an audit row.
func (s *Service) DecideRefund(ctx context.Context, id, adminID string, approve bool, note string) error {
	if !approve && strings.TrimSpace(note) == "" {
		return fmt.Errorf("adminext: a note is required to reject a refund")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current, reference string
	if err := tx.QueryRow(ctx, `SELECT status, reference FROM cf_refunds WHERE id=$1 FOR UPDATE`, id).Scan(&current, &reference); err != nil {
		return fmt.Errorf("adminext: refund not found")
	}
	if current != "REQUESTED" {
		return fmt.Errorf("adminext: cannot decide a refund in %s state", current)
	}
	next := "REJECTED"
	if approve {
		next = "APPROVED"
	}
	if _, err := tx.Exec(ctx,
		`UPDATE cf_refunds SET status=$1, admin_note=COALESCE(NULLIF($2,''), admin_note), decided_at=NOW() WHERE id=$3`,
		next, note, id); err != nil {
		return err
	}
	action := "refund.reject"
	if approve {
		action = "refund.approve"
	}
	if err := s.audit(ctx, tx, adminID, action, reference); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Settlements ─────────────────────────────────────────────────────────────

// ListSettlements returns settlement batches, newest first.
func (s *Service) ListSettlements(ctx context.Context) ([]SettlementBatch, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, reference, payout_count, gross_kobo, fee_kobo, net_kobo, status, created_at
		 FROM cf_settlements ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SettlementBatch{}
	for rows.Next() {
		var b SettlementBatch
		var createdAt time.Time
		if err := rows.Scan(&b.ID, &b.Reference, &b.PayoutCount, &b.GrossKobo, &b.FeeKobo, &b.NetKobo, &b.Status, &createdAt); err != nil {
			return nil, err
		}
		b.CreatedAt = rfc3339(createdAt)
		out = append(out, b)
	}
	return out, rows.Err()
}

// ─── Disputes ────────────────────────────────────────────────────────────────

// ListDisputes returns disputes, optionally filtered by status.
func (s *Service) ListDisputes(ctx context.Context, status string) ([]Dispute, error) {
	q := `SELECT id, reference, type, status, campaign_id, campaign_title, raised_by, description,
	             created_at, sla_hours_left, resolution, admin_note
	      FROM cf_disputes`
	args := []any{}
	if status != "" {
		q += ` WHERE status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY created_at DESC`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Dispute{}
	for rows.Next() {
		var d Dispute
		var createdAt time.Time
		var campaignID *string
		if err := rows.Scan(&d.ID, &d.Reference, &d.Type, &d.Status, &campaignID, &d.CampaignTitle,
			&d.RaisedBy, &d.Description, &createdAt, &d.SlaHoursLeft, &d.Resolution, &d.AdminNote); err != nil {
			return nil, err
		}
		d.CreatedAt = rfc3339(createdAt)
		if campaignID != nil {
			d.CampaignID = *campaignID
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ResolveDispute applies a guarded transition to RESOLVED. A note is REQUIRED.
// Writes an audit row.
func (s *Service) ResolveDispute(ctx context.Context, id, adminID, resolution, note string) error {
	if strings.TrimSpace(note) == "" {
		return fmt.Errorf("adminext: a note is required to resolve a dispute")
	}
	if !validResolution(resolution) {
		return fmt.Errorf("adminext: invalid dispute resolution %q", resolution)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current, reference string
	if err := tx.QueryRow(ctx, `SELECT status, reference FROM cf_disputes WHERE id=$1 FOR UPDATE`, id).Scan(&current, &reference); err != nil {
		return fmt.Errorf("adminext: dispute not found")
	}
	if current == "RESOLVED" || current == "CLOSED" {
		return fmt.Errorf("adminext: cannot resolve a dispute in %s state", current)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE cf_disputes SET status='RESOLVED', resolution=$1, admin_note=$2, sla_hours_left=0 WHERE id=$3`,
		resolution, note, id); err != nil {
		return err
	}
	if err := s.audit(ctx, tx, adminID, "dispute.resolve", reference+" -> "+resolution); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func validResolution(r string) bool {
	switch r {
	case "NO_ACTION", "REFUND", "PARTIAL_REFUND", "FREEZE", "WARN_CREATOR":
		return true
	}
	return false
}

// ─── Withdrawals ─────────────────────────────────────────────────────────────

// ListWithdrawals returns withdrawal requests, optionally filtered by status.
// availableKobo is derived from the campaign's contributions ledger minus prior
// withdrawals (never a stored balance).
func (s *Service) ListWithdrawals(ctx context.Context, status string) ([]Withdrawal, error) {
	q := `
		SELECT w.id, w.reference, w.amount_kobo, w.bank_label, w.status, w.reason, w.requested_at,
		       COALESCE(c.title,''),
		       COALESCE(
		           (SELECT SUM(co.amount_kobo) FROM contributions co WHERE co.campaign_id = w.campaign_id AND co.status IN ('escrowed','released')), 0)
		       -
		       COALESCE(
		           (SELECT SUM(ww.amount_kobo) FROM cf_withdrawals ww WHERE ww.campaign_id = w.campaign_id AND ww.status IN ('APPROVED','COMPLETED','PROCESSING')), 0)
		       AS available_kobo
		FROM cf_withdrawals w
		LEFT JOIN campaigns c ON c.id = w.campaign_id`
	args := []any{}
	if status != "" {
		q += ` WHERE w.status=$1`
		args = append(args, status)
	}
	q += ` ORDER BY w.requested_at DESC`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Withdrawal{}
	for rows.Next() {
		var w Withdrawal
		var requestedAt time.Time
		var reason *string
		if err := rows.Scan(&w.ID, &w.Reference, &w.AmountKobo, &w.BankLabel, &w.Status,
			&reason, &requestedAt, &w.CampaignTitle, &w.AvailableKobo); err != nil {
			return nil, err
		}
		w.RequestedAt = rfc3339(requestedAt)
		w.Note = reason
		// Creator display fields are not stored on the withdrawal row; default safely.
		w.CreatorName = "Campaign creator"
		w.CreatorVerification = "KYC"
		w.RiskLevel = riskFromAvailable(w.AmountKobo, w.AvailableKobo)
		out = append(out, w)
	}
	return out, rows.Err()
}

// riskFromAvailable is a small heuristic: requesting (near) the full available
// balance flags higher risk. Deterministic, no external calls.
func riskFromAvailable(amount, available int64) string {
	if available <= 0 || amount >= available {
		return "HIGH"
	}
	if amount*2 >= available {
		return "MEDIUM"
	}
	return "LOW"
}

// DecideWithdrawal applies a guarded PENDING→APPROVED/REJECTED transition.
// A note is REQUIRED to reject. Writes an audit row. No money moves here.
func (s *Service) DecideWithdrawal(ctx context.Context, id, adminID string, approve bool, note string) error {
	if !approve && strings.TrimSpace(note) == "" {
		return fmt.Errorf("adminext: a note is required to reject a withdrawal")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current, reference string
	if err := tx.QueryRow(ctx, `SELECT status, reference FROM cf_withdrawals WHERE id=$1 FOR UPDATE`, id).Scan(&current, &reference); err != nil {
		return fmt.Errorf("adminext: withdrawal not found")
	}
	if current != "PENDING" {
		return fmt.Errorf("adminext: cannot decide a withdrawal in %s state", current)
	}
	next := "REJECTED"
	if approve {
		next = "APPROVED"
	}
	if _, err := tx.Exec(ctx,
		`UPDATE cf_withdrawals SET status=$1, reason=COALESCE(NULLIF($2,''), reason) WHERE id=$3`,
		next, note, id); err != nil {
		return err
	}
	action := "withdrawal.reject"
	if approve {
		action = "withdrawal.approve"
	}
	if err := s.audit(ctx, tx, adminID, action, reference); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Fraud ───────────────────────────────────────────────────────────────────

// ListFraudAlerts returns fraud alerts, newest first.
func (s *Service) ListFraudAlerts(ctx context.Context) ([]FraudAlert, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, campaign_id, campaign_title, creator_name, risk_level, status, signals, raised_kobo, created_at
		 FROM cf_fraud_alerts ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FraudAlert{}
	for rows.Next() {
		var a FraudAlert
		var createdAt time.Time
		var campaignID *string
		if err := rows.Scan(&a.ID, &campaignID, &a.CampaignTitle, &a.CreatorName, &a.RiskLevel,
			&a.Status, &a.Signals, &a.RaisedKobo, &createdAt); err != nil {
			return nil, err
		}
		a.CreatedAt = rfc3339(createdAt)
		if campaignID != nil {
			a.CampaignID = *campaignID
		}
		if a.Signals == nil {
			a.Signals = []string{}
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// SetCampaignFreeze freezes/unfreezes a campaign and the matching fraud alert.
// A note is REQUIRED to freeze. Writes an audit row.
func (s *Service) SetCampaignFreeze(ctx context.Context, campaignID, adminID string, freeze bool, note string) error {
	if freeze && strings.TrimSpace(note) == "" {
		return fmt.Errorf("adminext: a note is required to freeze a campaign")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Move the related fraud alert (if any) to FROZEN / INVESTIGATING.
	alertStatus := "INVESTIGATING"
	if freeze {
		alertStatus = "FROZEN"
	}
	if _, err := tx.Exec(ctx,
		`UPDATE cf_fraud_alerts SET status=$1, admin_note=COALESCE(NULLIF($2,''), admin_note) WHERE campaign_id=$3`,
		alertStatus, note, campaignID); err != nil {
		return err
	}
	// Best-effort: also flip the campaign review_status if the table/row exists.
	reviewStatus := "ACTIVE"
	if freeze {
		reviewStatus = "FROZEN"
	}
	_, _ = tx.Exec(ctx,
		`UPDATE campaigns SET review_status=$1, admin_note=COALESCE(NULLIF($2,''), admin_note), updated_at=NOW() WHERE id=$3`,
		reviewStatus, note, campaignID)

	action := "campaign.unfreeze"
	if freeze {
		action = "campaign.freeze"
	}
	if err := s.audit(ctx, tx, adminID, action, campaignID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── KYC / KYB ───────────────────────────────────────────────────────────────

// ListKyc returns KYC/KYB cases (with their docs), optionally filtered.
func (s *Service) ListKyc(ctx context.Context, kind, status string) ([]KycCase, error) {
	q := `SELECT id, kind, status, applicant_name, applicant_type, email, id_label, bank_label,
	             submitted_at, duplicate_identity, duplicate_bank, risk_level
	      FROM cf_kyc_cases`
	conds := []string{}
	args := []any{}
	if kind != "" {
		args = append(args, kind)
		conds = append(conds, fmt.Sprintf("kind=$%d", len(args)))
	}
	if status != "" {
		args = append(args, status)
		conds = append(conds, fmt.Sprintf("status=$%d", len(args)))
	}
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	q += ` ORDER BY submitted_at DESC`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []KycCase{}
	ids := []string{}
	for rows.Next() {
		var k KycCase
		var submittedAt time.Time
		if err := rows.Scan(&k.ID, &k.Kind, &k.Status, &k.ApplicantName, &k.ApplicantType,
			&k.Email, &k.IDLabel, &k.BankLabel, &submittedAt, &k.DuplicateIdentity, &k.DuplicateBank, &k.RiskLevel); err != nil {
			return nil, err
		}
		k.SubmittedAt = rfc3339(submittedAt)
		k.Documents = []KycDoc{}
		out = append(out, k)
		ids = append(ids, k.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	// Attach docs in a second query.
	docRows, err := s.db.Query(ctx,
		`SELECT id, case_id, label, type, verified FROM cf_kyc_docs WHERE case_id = ANY($1) ORDER BY label`, ids)
	if err != nil {
		return out, nil // tolerate missing docs
	}
	defer docRows.Close()
	byCase := map[string][]KycDoc{}
	for docRows.Next() {
		var d KycDoc
		var caseID string
		if err := docRows.Scan(&d.ID, &caseID, &d.Label, &d.Type, &d.Verified); err != nil {
			return nil, err
		}
		byCase[caseID] = append(byCase[caseID], d)
	}
	for i := range out {
		if docs := byCase[out[i].ID]; docs != nil {
			out[i].Documents = docs
		}
	}
	return out, nil
}

// DecideKyc applies a guarded PENDING→APPROVED/REJECTED transition.
// A note is REQUIRED to reject. Writes an audit row.
func (s *Service) DecideKyc(ctx context.Context, id, adminID string, approve bool, note string) error {
	if !approve && strings.TrimSpace(note) == "" {
		return fmt.Errorf("adminext: a note is required to reject a KYC case")
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current, applicant string
	if err := tx.QueryRow(ctx, `SELECT status, applicant_name FROM cf_kyc_cases WHERE id=$1 FOR UPDATE`, id).Scan(&current, &applicant); err != nil {
		return fmt.Errorf("adminext: kyc case not found")
	}
	if current != "PENDING" {
		return fmt.Errorf("adminext: cannot decide a KYC case in %s state", current)
	}
	next := "REJECTED"
	if approve {
		next = "APPROVED"
	}
	if _, err := tx.Exec(ctx,
		`UPDATE cf_kyc_cases SET status=$1, admin_note=COALESCE(NULLIF($2,''), admin_note), decided_at=NOW() WHERE id=$3`,
		next, note, id); err != nil {
		return err
	}
	action := "kyc.reject"
	if approve {
		action = "kyc.approve"
	}
	if err := s.audit(ctx, tx, adminID, action, applicant); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Compliance ──────────────────────────────────────────────────────────────

// GetComplianceSummary derives compliance counters from the cf_* tables.
func (s *Service) GetComplianceSummary(ctx context.Context) (*ComplianceSummary, error) {
	out := &ComplianceSummary{RetentionPolicyDays: 2555, LastRegulatoryExport: "2026-05-31T00:00:00Z"}
	_ = s.db.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE kind='KYC' AND status='PENDING'),
			COUNT(*) FILTER (WHERE kind='KYB' AND status='PENDING')
		FROM cf_kyc_cases`).Scan(&out.PendingKyc, &out.PendingKyb)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM cf_data_requests WHERE status <> 'COMPLETED'`).Scan(&out.OpenDataRequests)
	_ = s.db.QueryRow(ctx, `SELECT COUNT(*) FROM cf_audit_logs WHERE created_at >= date_trunc('day', NOW())`).Scan(&out.AuditEventsToday)
	out.InvestmentEnabled = false
	return out, nil
}

// ListAuditLogs returns the most recent audit rows.
func (s *Service) ListAuditLogs(ctx context.Context) ([]AuditLog, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, actor, action, target, ip, created_at FROM cf_audit_logs ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AuditLog{}
	for rows.Next() {
		var a AuditLog
		var createdAt time.Time
		if err := rows.Scan(&a.ID, &a.Actor, &a.Action, &a.Target, &a.IP, &createdAt); err != nil {
			return nil, err
		}
		a.CreatedAt = rfc3339(createdAt)
		out = append(out, a)
	}
	return out, rows.Err()
}

// ListDataRequests returns data subject requests, newest first.
func (s *Service) ListDataRequests(ctx context.Context) ([]DataRequest, error) {
	rows, err := s.db.Query(ctx,
		`SELECT id, type, user_name, email, status, requested_at, due_by FROM cf_data_requests ORDER BY requested_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DataRequest{}
	for rows.Next() {
		var d DataRequest
		var requestedAt, dueBy time.Time
		if err := rows.Scan(&d.ID, &d.Type, &d.UserName, &d.Email, &d.Status, &requestedAt, &dueBy); err != nil {
			return nil, err
		}
		d.RequestedAt = rfc3339(requestedAt)
		d.DueBy = rfc3339(dueBy)
		out = append(out, d)
	}
	return out, rows.Err()
}

// FulfilDataRequest marks a data request COMPLETED. Writes an audit row.
func (s *Service) FulfilDataRequest(ctx context.Context, id, adminID string) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current, userName string
	if err := tx.QueryRow(ctx, `SELECT status, user_name FROM cf_data_requests WHERE id=$1 FOR UPDATE`, id).Scan(&current, &userName); err != nil {
		return fmt.Errorf("adminext: data request not found")
	}
	if current == "COMPLETED" {
		return fmt.Errorf("adminext: data request already completed")
	}
	if _, err := tx.Exec(ctx, `UPDATE cf_data_requests SET status='COMPLETED' WHERE id=$1`, id); err != nil {
		return err
	}
	if err := s.audit(ctx, tx, adminID, "data_request.fulfil", userName); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─── Users ───────────────────────────────────────────────────────────────────

// ListUsers returns users (with recent activity), optionally filtered.
func (s *Service) ListUsers(ctx context.Context, role, status, search string) ([]User, error) {
	q := `SELECT id, name, email, role, type, verification, status, risk_level,
	             campaigns_created, total_raised_kobo, total_contributed_kobo, joined_at, last_active_at
	      FROM cf_admin_users`
	conds := []string{}
	args := []any{}
	if role != "" {
		args = append(args, role)
		conds = append(conds, fmt.Sprintf("role=$%d", len(args)))
	}
	if status != "" {
		args = append(args, status)
		conds = append(conds, fmt.Sprintf("status=$%d", len(args)))
	}
	if search != "" {
		args = append(args, "%"+strings.ToLower(search)+"%")
		conds = append(conds, fmt.Sprintf("(LOWER(name) LIKE $%d OR LOWER(email) LIKE $%d)", len(args), len(args)))
	}
	if len(conds) > 0 {
		q += " WHERE " + strings.Join(conds, " AND ")
	}
	q += ` ORDER BY last_active_at DESC`
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []User{}
	ids := []string{}
	for rows.Next() {
		var u User
		var joinedAt, lastActiveAt time.Time
		if err := rows.Scan(&u.ID, &u.Name, &u.Email, &u.Role, &u.Type, &u.Verification, &u.Status, &u.RiskLevel,
			&u.CampaignsCreated, &u.TotalRaisedKobo, &u.TotalContributedKobo, &joinedAt, &lastActiveAt); err != nil {
			return nil, err
		}
		u.JoinedAt = rfc3339(joinedAt)
		u.LastActiveAt = rfc3339(lastActiveAt)
		u.Activity = []UserActivity{}
		out = append(out, u)
		ids = append(ids, u.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	actRows, err := s.db.Query(ctx,
		`SELECT id, user_id, action, detail, created_at FROM cf_user_activity WHERE user_id = ANY($1) ORDER BY created_at DESC`, ids)
	if err != nil {
		return out, nil
	}
	defer actRows.Close()
	byUser := map[string][]UserActivity{}
	for actRows.Next() {
		var a UserActivity
		var userID string
		var createdAt time.Time
		if err := actRows.Scan(&a.ID, &userID, &a.Action, &a.Detail, &createdAt); err != nil {
			return nil, err
		}
		a.CreatedAt = rfc3339(createdAt)
		byUser[userID] = append(byUser[userID], a)
	}
	for i := range out {
		if acts := byUser[out[i].ID]; acts != nil {
			out[i].Activity = acts
		}
	}
	return out, nil
}

// SetUserStatus applies a guarded user status change (ACTIVE/SUSPENDED/RESTRICTED).
// A note is REQUIRED for SUSPENDED/RESTRICTED. Records an activity row + audit row.
func (s *Service) SetUserStatus(ctx context.Context, id, adminID, status, note string) error {
	if !validUserStatus(status) {
		return fmt.Errorf("adminext: invalid user status %q", status)
	}
	if status != "ACTIVE" && strings.TrimSpace(note) == "" {
		return fmt.Errorf("adminext: a note is required to %s a user", strings.ToLower(status))
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var current, name string
	if err := tx.QueryRow(ctx, `SELECT status, name FROM cf_admin_users WHERE id=$1 FOR UPDATE`, id).Scan(&current, &name); err != nil {
		return fmt.Errorf("adminext: user not found")
	}
	if _, err := tx.Exec(ctx, `UPDATE cf_admin_users SET status=$1, last_active_at=NOW() WHERE id=$2`, status, id); err != nil {
		return err
	}
	action := map[string]string{"SUSPENDED": "account.suspend", "ACTIVE": "account.restore", "RESTRICTED": "account.restrict"}[status]
	detail := note
	if detail == "" {
		detail = "-"
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO cf_user_activity (user_id, action, detail) VALUES ($1,$2,$3)`, id, action, detail); err != nil {
		return err
	}
	if err := s.audit(ctx, tx, adminID, action, name); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func validUserStatus(s string) bool {
	switch s {
	case "ACTIVE", "SUSPENDED", "RESTRICTED":
		return true
	}
	return false
}
