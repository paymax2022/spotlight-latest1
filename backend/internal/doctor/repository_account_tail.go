package doctor

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// repository_account_tail.go — pgx data access for the Wave-2 "account tail"
// endpoints (bank accounts, payout reads, settlement disputes, privacy requests,
// compliance, reputation, patient projections, presence, misc).
//
// Conventions mirror repository_account.go exactly:
//   * every read/mutation is scoped to the owning doctor's user_id (defence in
//     depth on top of RLS);
//   * mutations on a table with a UNIQUE idempotency_key dedupe with
//     ON CONFLICT (idempotency_key) DO NOTHING + replay re-select, like
//     InsertReviewDispute / InsertSupportTicket;
//   * no money mutation here posts to the ledger — these are request/read rows.
//     The actual payout money path (Service.RequestPayout) is untouched.

// ── Profile: bank accounts ───────────────────────────────────────────────────

// UpsertBankAccount inserts a bank account row idempotently (UNIQUE idempotency_key).
// account_number is stored as supplied; the service masks it to last-4 in responses.
func (r *Repository) UpsertBankAccount(ctx context.Context, userID, idemKey string, req BankAccountRequest) (*BankAccount, error) {
	id := uuid.New().String()
	const q = `
		INSERT INTO doctor_bank_accounts
			(id, user_id, bank_name, bank_code, account_number, account_name, is_verified, is_default, tax_info, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,false,$7,$8,$9)
		ON CONFLICT (idempotency_key) DO NOTHING`
	isDefault := boolOrDefault(req.IsDefault, false)
	tag, err := r.db.Exec(ctx, q, id, userID, req.BankName, req.BankCode, req.AccountNumber,
		req.AccountName, isDefault, jsonOrEmptyObject(req.TaxInfo), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getBankAccountByIdem(ctx, userID, idemKey)
	}
	// If this account was flagged default, demote the others (best effort, scoped).
	if isDefault {
		if _, err := r.db.Exec(ctx,
			`UPDATE doctor_bank_accounts SET is_default = false, updated_at = now() WHERE user_id = $1 AND id <> $2`,
			userID, id); err != nil {
			return nil, err
		}
	}
	return r.getBankAccountByID(ctx, userID, id)
}

// SetDefaultBankAccount marks one account default (is_default=true) and demotes the
// rest. When accountID is empty it updates the existing default's bank details from
// the request. Returns the resulting default account. Used by PUT /payout-account.
func (r *Repository) SetDefaultBankAccount(ctx context.Context, userID string, req PayoutAccountRequest) (*BankAccount, error) {
	// Optionally patch bank details on the targeted (or current-default) account.
	if req.AccountID != nil && *req.AccountID != "" {
		const upd = `
			UPDATE doctor_bank_accounts SET
				bank_name      = COALESCE($3, bank_name),
				bank_code      = COALESCE($4, bank_code),
				account_number = COALESCE($5, account_number),
				account_name   = COALESCE($6, account_name),
				is_default     = true,
				updated_at     = now()
			WHERE id = $1 AND user_id = $2`
		tag, err := r.db.Exec(ctx, upd, *req.AccountID, userID,
			req.BankName, req.BankCode, req.AccountNumber, req.AccountName)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() == 0 {
			return nil, ErrNotFound
		}
		if _, err := r.db.Exec(ctx,
			`UPDATE doctor_bank_accounts SET is_default = false, updated_at = now() WHERE user_id = $1 AND id <> $2`,
			userID, *req.AccountID); err != nil {
			return nil, err
		}
		return r.getBankAccountByID(ctx, userID, *req.AccountID)
	}

	// No explicit account: patch the current default in place.
	const upd = `
		UPDATE doctor_bank_accounts SET
			bank_name      = COALESCE($2, bank_name),
			bank_code      = COALESCE($3, bank_code),
			account_number = COALESCE($4, account_number),
			account_name   = COALESCE($5, account_name),
			updated_at     = now()
		WHERE user_id = $1 AND is_default = true`
	tag, err := r.db.Exec(ctx, upd, userID, req.BankName, req.BankCode, req.AccountNumber, req.AccountName)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getDefaultBankAccount(ctx, userID)
}

func (r *Repository) getDefaultBankAccount(ctx context.Context, userID string) (*BankAccount, error) {
	const q = `
		SELECT id, user_id, bank_name, bank_code, account_number, account_name,
		       is_verified, is_default, tax_info, created_at, updated_at
		FROM doctor_bank_accounts WHERE user_id = $1 AND is_default = true
		ORDER BY updated_at DESC LIMIT 1`
	return r.scanBankAccountRow(r.db.QueryRow(ctx, q, userID))
}

func (r *Repository) getBankAccountByID(ctx context.Context, userID, id string) (*BankAccount, error) {
	const q = `
		SELECT id, user_id, bank_name, bank_code, account_number, account_name,
		       is_verified, is_default, tax_info, created_at, updated_at
		FROM doctor_bank_accounts WHERE id = $1 AND user_id = $2`
	return r.scanBankAccountRow(r.db.QueryRow(ctx, q, id, userID))
}

func (r *Repository) getBankAccountByIdem(ctx context.Context, userID, idemKey string) (*BankAccount, error) {
	const q = `
		SELECT id, user_id, bank_name, bank_code, account_number, account_name,
		       is_verified, is_default, tax_info, created_at, updated_at
		FROM doctor_bank_accounts WHERE user_id = $1 AND idempotency_key = $2`
	return r.scanBankAccountRow(r.db.QueryRow(ctx, q, userID, idemKey))
}

func (r *Repository) scanBankAccountRow(row pgx.Row) (*BankAccount, error) {
	b := &BankAccount{}
	err := row.Scan(&b.ID, &b.UserID, &b.BankName, &b.BankCode, &b.AccountNumber,
		&b.AccountName, &b.IsVerified, &b.IsDefault, &b.TaxInfo, &b.CreatedAt, &b.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return b, err
}

// UpdateBankAccountTaxInfo patch-merges the tax_info JSONB on the default account
// (or the most-recent account if no default). PUT /profile/tax-info.
func (r *Repository) UpdateBankAccountTaxInfo(ctx context.Context, userID string, patch []byte) (*BankAccount, error) {
	const q = `
		UPDATE doctor_bank_accounts
		SET tax_info = COALESCE(tax_info, '{}'::jsonb) || $2::jsonb, updated_at = now()
		WHERE id = (
			SELECT id FROM doctor_bank_accounts
			WHERE user_id = $1
			ORDER BY is_default DESC, updated_at DESC
			LIMIT 1
		)`
	tag, err := r.db.Exec(ctx, q, userID, jsonOrEmptyObject(patch))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.getDefaultBankAccount(ctx, userID)
}

// ── Profile: documents / photo ───────────────────────────────────────────────

// InsertProfileDocument inserts a verification/profile document row. The table has
// no idempotency_key column, so this is a plain insert; the read shape matches
// ListVerificationDocuments (reused by Service.ListProfileDocuments).
func (r *Repository) InsertProfileDocument(ctx context.Context, userID string, req ProfileDocumentRequest) (*VerificationDocument, error) {
	id := uuid.New().String()
	required := boolOrDefault(req.Required, false)
	const q = `
		INSERT INTO doctor_verification_documents
			(id, user_id, doc_type, label, file_name, file_url, mime_type, size_bytes, required)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`
	if _, err := r.db.Exec(ctx, q, id, userID, req.DocType, req.Label, req.FileName,
		req.FileURL, req.MimeType, req.SizeBytes, required); err != nil {
		return nil, err
	}
	return r.getProfileDocumentByID(ctx, userID, id)
}

func (r *Repository) getProfileDocumentByID(ctx context.Context, userID, id string) (*VerificationDocument, error) {
	const q = `
		SELECT id, verification_id, user_id, doc_type, label, file_name, file_url,
		       mime_type, size_bytes, required, uploaded_at, created_at
		FROM doctor_verification_documents WHERE id = $1 AND user_id = $2`
	d := &VerificationDocument{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&d.ID, &d.VerificationID, &d.UserID,
		&d.DocType, &d.Label, &d.FileName, &d.FileURL, &d.MimeType, &d.SizeBytes,
		&d.Required, &d.UploadedAt, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

// SetProfilePhoto sets the avatar_url column on doctor_profiles (the canonical
// profile photo column). Returns the refreshed profile.
func (r *Repository) SetProfilePhoto(ctx context.Context, userID, photoURL string) (*Profile, error) {
	const q = `UPDATE doctor_profiles SET avatar_url = $2, updated_at = now() WHERE user_id = $1`
	tag, err := r.db.Exec(ctx, q, userID, photoURL)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetProfile(ctx, userID)
}

// ── Payouts: reads ───────────────────────────────────────────────────────────

// ListPayouts returns the doctor's payout request rows newest-first.
func (r *Repository) ListPayouts(ctx context.Context, userID string) ([]Payout, error) {
	const q = `
		SELECT id, user_id, ref, amount_kobo, currency, status, bank_account_id,
		       ledger_ref, requested_at, paid_at, idempotency_key, created_at
		FROM doctor_payouts WHERE user_id = $1 ORDER BY created_at DESC`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Payout{}
	for rows.Next() {
		p := Payout{}
		if err := rows.Scan(&p.ID, &p.UserID, &p.Ref, &p.AmountKobo, &p.Currency,
			&p.Status, &p.BankAccountID, &p.LedgerRef, &p.RequestedAt, &p.PaidAt,
			&p.IdempotencyKey, &p.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetPayout returns a single payout scoped to the doctor.
func (r *Repository) GetPayout(ctx context.Context, userID, id string) (*Payout, error) {
	const q = `
		SELECT id, user_id, ref, amount_kobo, currency, status, bank_account_id,
		       ledger_ref, requested_at, paid_at, idempotency_key, created_at
		FROM doctor_payouts WHERE id = $1 AND user_id = $2`
	p := &Payout{}
	err := r.db.QueryRow(ctx, q, id, userID).Scan(&p.ID, &p.UserID, &p.Ref, &p.AmountKobo,
		&p.Currency, &p.Status, &p.BankAccountID, &p.LedgerRef, &p.RequestedAt, &p.PaidAt,
		&p.IdempotencyKey, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return p, err
}

// GetPayoutReport aggregates the doctor's payouts: sum(amount_kobo) + count per
// status. All money is int64 kobo (no floats). Empty result => zeroed report.
func (r *Repository) GetPayoutReport(ctx context.Context, userID string) (*PayoutReport, error) {
	const q = `
		SELECT status, COALESCE(SUM(amount_kobo),0)::bigint, COUNT(*)::bigint
		FROM doctor_payouts WHERE user_id = $1 GROUP BY status`
	rows, err := r.db.Query(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	rep := &PayoutReport{Currency: "NGN", ByStatus: []PayoutReportBucket{}}
	for rows.Next() {
		var b PayoutReportBucket
		if err := rows.Scan(&b.Status, &b.TotalKobo, &b.Count); err != nil {
			return nil, err
		}
		rep.ByStatus = append(rep.ByStatus, b)
		rep.TotalKobo += b.TotalKobo
		rep.TotalCount += b.Count
		if b.Status == "paid" {
			rep.PaidKobo += b.TotalKobo
		}
		if b.Status == "pending" || b.Status == "processing" {
			rep.PendingKobo += b.TotalKobo
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return rep, nil
}

// InsertSettlementDispute records a payout/settlement dispute idempotently
// (UNIQUE idempotency_key), mirroring InsertReviewDispute.
func (r *Repository) InsertSettlementDispute(ctx context.Context, userID, payoutID, idemKey string, req SettlementDisputeRequest) (*SettlementDispute, error) {
	id := uuid.New().String()
	var payoutRef *string
	if payoutID != "" {
		payoutRef = &payoutID
	}
	const q = `
		INSERT INTO doctor_settlement_disputes (id, user_id, payout_id, status, reason, detail, idempotency_key)
		VALUES ($1,$2,$3,'open',$4,$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, payoutRef, req.Reason, jsonOrEmptyObject(req.Detail), idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getSettlementDisputeByIdem(ctx, userID, idemKey)
	}
	return r.getSettlementDisputeByID(ctx, userID, id)
}

func (r *Repository) getSettlementDisputeByID(ctx context.Context, userID, id string) (*SettlementDispute, error) {
	const q = `
		SELECT id, user_id, payout_id, status, reason, detail, created_at, updated_at
		FROM doctor_settlement_disputes WHERE id = $1 AND user_id = $2`
	return r.scanSettlementDispute(r.db.QueryRow(ctx, q, id, userID))
}

func (r *Repository) getSettlementDisputeByIdem(ctx context.Context, userID, idemKey string) (*SettlementDispute, error) {
	const q = `
		SELECT id, user_id, payout_id, status, reason, detail, created_at, updated_at
		FROM doctor_settlement_disputes WHERE user_id = $1 AND idempotency_key = $2`
	return r.scanSettlementDispute(r.db.QueryRow(ctx, q, userID, idemKey))
}

func (r *Repository) scanSettlementDispute(row pgx.Row) (*SettlementDispute, error) {
	d := &SettlementDispute{}
	err := row.Scan(&d.ID, &d.UserID, &d.PayoutID, &d.Status, &d.Reason, &d.Detail,
		&d.CreatedAt, &d.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return d, err
}

// ── Privacy: export / delete requests ────────────────────────────────────────

// RequestPrivacyExport stamps export_requested_at = now() and returns the row.
func (r *Repository) RequestPrivacyExport(ctx context.Context, userID string) (*DataPrivacySettings, error) {
	if _, err := r.GetPrivacySettings(ctx, userID); err != nil { // ensures the row exists
		return nil, err
	}
	const q = `UPDATE doctor_data_privacy_settings SET export_requested_at = now(), updated_at = now() WHERE user_id = $1`
	if _, err := r.db.Exec(ctx, q, userID); err != nil {
		return nil, err
	}
	return r.scanPrivacy(ctx, userID)
}

// RequestPrivacyDelete stamps deletion_requested_at = now() and returns the row.
func (r *Repository) RequestPrivacyDelete(ctx context.Context, userID string) (*DataPrivacySettings, error) {
	if _, err := r.GetPrivacySettings(ctx, userID); err != nil {
		return nil, err
	}
	const q = `UPDATE doctor_data_privacy_settings SET deletion_requested_at = now(), updated_at = now() WHERE user_id = $1`
	if _, err := r.db.Exec(ctx, q, userID); err != nil {
		return nil, err
	}
	return r.scanPrivacy(ctx, userID)
}

// ── Compliance projection ────────────────────────────────────────────────────

// GetComplianceStatus builds a read-only projection from doctor_mandatory_training
// (completion summary) and doctor_compliance_audit (policy acknowledgements).
func (r *Repository) GetComplianceStatus(ctx context.Context, userID string) (*ComplianceStatus, error) {
	out := &ComplianceStatus{PoliciesAcknowledged: []string{}}

	// Training completion summary.
	const tq = `
		SELECT COUNT(*)::bigint,
		       COUNT(*) FILTER (WHERE status = 'completed')::bigint
		FROM doctor_mandatory_training WHERE user_id = $1`
	if err := r.db.QueryRow(ctx, tq, userID).Scan(&out.TrainingTotal, &out.TrainingCompleted); err != nil {
		return nil, err
	}
	out.TrainingComplete = out.TrainingTotal > 0 && out.TrainingCompleted == out.TrainingTotal

	// Distinct acknowledged policy keys from the audit trail.
	const pq = `
		SELECT DISTINCT entity_id
		FROM doctor_compliance_audit
		WHERE user_id = $1 AND action = 'policy.ack' AND entity_id IS NOT NULL
		ORDER BY entity_id`
	rows, err := r.db.Query(ctx, pq, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		out.PoliciesAcknowledged = append(out.PoliciesAcknowledged, key)
	}
	return out, rows.Err()
}

// ── Reputation projection ────────────────────────────────────────────────────

// GetReputation aggregates doctor_reviews (avg rating + count) and the latest
// doctor_quality_scores row. Read-only; zeroes when no data.
func (r *Repository) GetReputation(ctx context.Context, userID string) (*ReputationSummary, error) {
	out := &ReputationSummary{}
	const rq = `
		SELECT COALESCE(AVG(rating),0)::float8, COUNT(*)::bigint
		FROM doctor_reviews WHERE user_id = $1 AND rating IS NOT NULL`
	if err := r.db.QueryRow(ctx, rq, userID).Scan(&out.AverageRating, &out.ReviewCount); err != nil {
		return nil, err
	}
	// Latest quality score (optional — absence is not an error).
	const sq = `SELECT score FROM doctor_quality_scores WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`
	var score float64
	switch err := r.db.QueryRow(ctx, sq, userID).Scan(&score); {
	case err == nil:
		out.QualityScore = score
	case errors.Is(err, pgx.ErrNoRows):
		out.QualityScore = 0
	default:
		return nil, err
	}
	return out, nil
}

// ── Misc: presence / support / emergency schedule ────────────────────────────

// SetPresence updates doctor_profiles.presence (allowed values online/offline/busy/away).
func (r *Repository) SetPresence(ctx context.Context, userID, presence string) error {
	const q = `UPDATE doctor_profiles SET presence = $2, is_online = ($2 = 'online'), updated_at = now() WHERE user_id = $1`
	tag, err := r.db.Exec(ctx, q, userID, presence)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// SetEmergencySchedule stores the emergency-availability window into
// doctor_availability.rules (JSONB) and flips emergency_enabled. The availability
// row is created lazily so a doctor who never configured a schedule can still set this.
func (r *Repository) SetEmergencySchedule(ctx context.Context, userID string, enabled bool, schedule []byte) error {
	const ensure = `INSERT INTO doctor_availability (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`
	if _, err := r.db.Exec(ctx, ensure, userID); err != nil {
		return err
	}
	const q = `
		UPDATE doctor_availability
		SET emergency_enabled = $2,
		    rules = COALESCE(rules, '{}'::jsonb) || jsonb_build_object('emergency', $3::jsonb),
		    updated_at = now()
		WHERE user_id = $1`
	if _, err := r.db.Exec(ctx, q, userID, enabled, jsonOrEmptyObject(schedule)); err != nil {
		return err
	}
	return nil
}

// InsertTechnicalSupportTicket inserts a doctor_support_tickets row with
// category='technical', idempotently (UNIQUE idempotency_key). Distinct from the
// existing InsertSupportTicket (which takes a typed CreateSupportTicketRequest).
func (r *Repository) InsertTechnicalSupportTicket(ctx context.Context, userID, idemKey string, req TechnicalSupportRequest) (*SupportTicket, error) {
	id := uuid.New().String()
	ref := "TS-" + id[0:8]
	subject := req.Subject
	if subject == "" {
		subject = "Technical issue"
	}
	const q = `
		INSERT INTO doctor_support_tickets (id, user_id, ref, subject, category, status, last_reply, idempotency_key)
		VALUES ($1,$2,$3,$4,'technical','open',$5,$6)
		ON CONFLICT (idempotency_key) DO NOTHING`
	tag, err := r.db.Exec(ctx, q, id, userID, ref, subject, req.Body, idemKey)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return r.getSupportTicketByIdem(ctx, userID, idemKey)
	}
	return r.getSupportTicketByID(ctx, userID, id)
}
