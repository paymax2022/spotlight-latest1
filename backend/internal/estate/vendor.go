package estate

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"spotlight/backend/internal/finance/ledger"
)

// vendor.go — Block 42 vendor/contractor app: self-onboarding, job lifecycle
// (available→accepted→en_route→in_progress→completed→paid) and idempotent payout
// (wallet credit) via the finance ledger.

type VendorProfile struct {
	ID           string          `json:"id"`
	EstateID     string          `json:"estate_id"`
	UserID       *string         `json:"user_id,omitempty"`
	Name         string          `json:"name"`
	BusinessName string          `json:"business_name,omitempty"`
	Category     string          `json:"category"`
	Phone        string          `json:"phone,omitempty"`
	Specialties  []string        `json:"specialties"`
	BankAccount  json.RawMessage `json:"bank_account,omitempty"`
	Status       string          `json:"status"` // pending|verified|suspended
	Verified     bool            `json:"verified"`
	Rating       float64         `json:"rating"`
	CreatedAt    time.Time       `json:"created_at"`
}

type VendorJob struct {
	ID            string     `json:"id"`
	EstateID      string     `json:"estate_id"`
	VendorID      string     `json:"vendor_id"`
	RepairID      *string    `json:"repair_request_id,omitempty"`
	Title         string     `json:"title,omitempty"`
	Status        string     `json:"status"`
	AmountKobo    int64      `json:"amount_kobo"`
	QuoteKobo     *int64     `json:"quote_kobo,omitempty"`
	InvoiceURL    string     `json:"invoice_url,omitempty"`
	CompletionURL string     `json:"completion_url,omitempty"`
	AcceptedAt    *time.Time `json:"accepted_at,omitempty"`
	CompletedAt   *time.Time `json:"completed_at,omitempty"`
	PaidAt        *time.Time `json:"paid_at,omitempty"`
	PayoutRef     string     `json:"payout_ref,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

type OnboardVendorRequest struct {
	BusinessName string          `json:"business_name" binding:"required,min=2,max=200"`
	Category     string          `json:"category"`
	Phone        string          `json:"phone"`
	Specialties  []string        `json:"specialties"`
	BankAccount  json.RawMessage `json:"bank_account"`
}

type AssignJobRequest struct {
	VendorID   string `json:"vendor_id" binding:"required"`
	RepairID   string `json:"repair_request_id"`
	Title      string `json:"title"`
	AmountKobo int64  `json:"amount_kobo"`
}

const vendorJobCols = `id, estate_id, vendor_id, repair_request_id, COALESCE(title,''), status, amount_kobo,
	quote_kobo, COALESCE(invoice_url,''), COALESCE(completion_url,''), accepted_at, completed_at, paid_at, COALESCE(payout_ref,''), created_at`

func scanVendorJob(row interface{ Scan(...any) error }) (*VendorJob, error) {
	var j VendorJob
	if err := row.Scan(&j.ID, &j.EstateID, &j.VendorID, &j.RepairID, &j.Title, &j.Status, &j.AmountKobo,
		&j.QuoteKobo, &j.InvoiceURL, &j.CompletionURL, &j.AcceptedAt, &j.CompletedAt, &j.PaidAt, &j.PayoutRef, &j.CreatedAt); err != nil {
		return nil, err
	}
	return &j, nil
}

// OnboardVendor registers the caller as a vendor for an estate (status pending).
func (s *Service) OnboardVendor(ctx context.Context, estateID, userID string, req OnboardVendorRequest) (*VendorProfile, error) {
	if userID == "" {
		return nil, fmt.Errorf("estate: unauthenticated")
	}
	cat := req.Category
	if cat == "" {
		cat = "general"
	}
	spec := req.Specialties
	if spec == nil {
		spec = []string{}
	}
	bank := req.BankAccount
	if len(bank) == 0 {
		bank = json.RawMessage("{}")
	}
	id := uuid.New().String()
	const q = `INSERT INTO estate_vendors (id, estate_id, user_id, name, business_name, category, phone, specialties, bank_account, status, verified)
		VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,'pending',FALSE)`
	if _, err := s.db.Exec(ctx, q, id, estateID, userID, req.BusinessName, cat, req.Phone, spec, bank); err != nil {
		return nil, fmt.Errorf("estate: onboard vendor: %w", err)
	}
	_ = s.audit(ctx, estateID, userID, "VENDOR_ONBOARD", "vendor", id, nil)
	return s.GetVendorProfile(ctx, estateID, userID)
}

// GetVendorProfile returns the caller's vendor profile in an estate.
func (s *Service) GetVendorProfile(ctx context.Context, estateID, userID string) (*VendorProfile, error) {
	v := &VendorProfile{}
	const q = `SELECT id, estate_id, user_id, name, COALESCE(business_name,''), category, COALESCE(phone,''),
		specialties, bank_account, status, verified, rating, created_at
		FROM estate_vendors WHERE estate_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1`
	if err := s.db.QueryRow(ctx, q, estateID, userID).Scan(
		&v.ID, &v.EstateID, &v.UserID, &v.Name, &v.BusinessName, &v.Category, &v.Phone,
		&v.Specialties, &v.BankAccount, &v.Status, &v.Verified, &v.Rating, &v.CreatedAt); err != nil {
		return nil, fmt.Errorf("estate: vendor profile not found")
	}
	return v, nil
}

func (s *Service) resolveVendorID(ctx context.Context, estateID, userID string) (string, error) {
	var id string
	if err := s.db.QueryRow(ctx, `SELECT id FROM estate_vendors WHERE estate_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1`, estateID, userID).Scan(&id); err != nil {
		return "", fmt.Errorf("estate: caller is not a vendor in this estate")
	}
	return id, nil
}

// AssignJob creates a job for a vendor (estate admin only).
func (s *Service) AssignJob(ctx context.Context, estateID, adminID string, req AssignJobRequest) (*VendorJob, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	if req.AmountKobo < 0 {
		return nil, fmt.Errorf("estate: amount must be non-negative kobo")
	}
	id := uuid.New().String()
	var repair any
	if req.RepairID != "" {
		repair = req.RepairID
	}
	const q = `INSERT INTO vendor_jobs (id, estate_id, vendor_id, repair_request_id, title, status, amount_kobo)
		VALUES ($1,$2,$3,$4,$5,'available',$6)`
	if _, err := s.db.Exec(ctx, q, id, estateID, req.VendorID, repair, req.Title, req.AmountKobo); err != nil {
		return nil, fmt.Errorf("estate: assign job: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "VENDOR_JOB_ASSIGN", "vendor_job", id, map[string]any{"vendor_id": req.VendorID})
	// Notify the vendor's user, if linked.
	var vuid *string
	_ = s.db.QueryRow(ctx, `SELECT user_id FROM estate_vendors WHERE id=$1 AND estate_id=$2`, req.VendorID, estateID).Scan(&vuid)
	if vuid != nil {
		s.notify(ctx, estateID, *vuid, NotifVendorAssigned, "New job assigned", req.Title, map[string]any{"job_id": id})
	}
	return s.getJob(ctx, estateID, id)
}

func (s *Service) getJob(ctx context.Context, estateID, jobID string) (*VendorJob, error) {
	row := s.db.QueryRow(ctx, `SELECT `+vendorJobCols+` FROM vendor_jobs WHERE id=$1 AND estate_id=$2`, jobID, estateID)
	j, err := scanVendorJob(row)
	if err != nil {
		return nil, fmt.Errorf("estate: job not found in this estate")
	}
	return j, nil
}

// GetAssignedJobs lists jobs for the caller's vendor (optionally by status).
func (s *Service) GetAssignedJobs(ctx context.Context, estateID, userID, status string) ([]VendorJob, error) {
	vendorID, err := s.resolveVendorID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	q := `SELECT ` + vendorJobCols + ` FROM vendor_jobs WHERE estate_id=$1 AND vendor_id=$2`
	args := []any{estateID, vendorID}
	if status != "" {
		q += " AND status=$3"
		args = append(args, status)
	}
	q += " ORDER BY created_at DESC LIMIT 200"
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []VendorJob
	for rows.Next() {
		j, err := scanVendorJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *j)
	}
	return out, rows.Err()
}

// jobTransition moves a job owned by the caller's vendor from one of `froms` to
// `to`, optionally stamping a timestamp column. Returns the updated job.
func (s *Service) jobTransition(ctx context.Context, estateID, userID, jobID, to string, froms []string, tsCol string) (*VendorJob, error) {
	vendorID, err := s.resolveVendorID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	set := "status=$4"
	if tsCol != "" {
		set += ", " + tsCol + "=NOW()"
	}
	q := `UPDATE vendor_jobs SET ` + set + `
		WHERE id=$1 AND estate_id=$2 AND vendor_id=$3 AND status = ANY($5)
		RETURNING ` + vendorJobCols
	row := s.db.QueryRow(ctx, q, jobID, estateID, vendorID, to, froms)
	j, err := scanVendorJob(row)
	if err != nil {
		return nil, fmt.Errorf("estate: job not found or not in a valid state for '%s'", to)
	}
	_ = s.audit(ctx, estateID, userID, "VENDOR_JOB_"+to, "vendor_job", jobID, nil)
	return j, nil
}

func (s *Service) AcceptJob(ctx context.Context, estateID, userID, jobID string) (*VendorJob, error) {
	return s.jobTransition(ctx, estateID, userID, jobID, "accepted", []string{"available"}, "accepted_at")
}
func (s *Service) RejectJob(ctx context.Context, estateID, userID, jobID string) (*VendorJob, error) {
	return s.jobTransition(ctx, estateID, userID, jobID, "rejected", []string{"available"}, "")
}
func (s *Service) CheckInAtGate(ctx context.Context, estateID, userID, jobID string) (*VendorJob, error) {
	return s.jobTransition(ctx, estateID, userID, jobID, "en_route", []string{"accepted"}, "")
}
func (s *Service) StartJob(ctx context.Context, estateID, userID, jobID string) (*VendorJob, error) {
	return s.jobTransition(ctx, estateID, userID, jobID, "in_progress", []string{"accepted", "en_route"}, "")
}
func (s *Service) MarkJobComplete(ctx context.Context, estateID, userID, jobID string) (*VendorJob, error) {
	return s.jobTransition(ctx, estateID, userID, jobID, "completed", []string{"in_progress"}, "completed_at")
}

// SubmitQuote sets the vendor's quote/agreed amount on a job (own, not yet paid).
func (s *Service) SubmitQuote(ctx context.Context, estateID, userID, jobID string, amountKobo int64) (*VendorJob, error) {
	if amountKobo < 0 {
		return nil, fmt.Errorf("estate: quote must be non-negative kobo")
	}
	vendorID, err := s.resolveVendorID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx,
		`UPDATE vendor_jobs SET quote_kobo=$4, amount_kobo=$4 WHERE id=$1 AND estate_id=$2 AND vendor_id=$3 AND status <> 'paid' RETURNING `+vendorJobCols,
		jobID, estateID, vendorID, amountKobo)
	j, err := scanVendorJob(row)
	if err != nil {
		return nil, fmt.Errorf("estate: job not found or already paid")
	}
	return j, nil
}

// SetJobURL sets invoice_url or completion_url (column is a trusted literal).
func (s *Service) setJobURL(ctx context.Context, estateID, userID, jobID, col, url string) (*VendorJob, error) {
	vendorID, err := s.resolveVendorID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	row := s.db.QueryRow(ctx,
		`UPDATE vendor_jobs SET `+col+`=$4 WHERE id=$1 AND estate_id=$2 AND vendor_id=$3 RETURNING `+vendorJobCols,
		jobID, estateID, vendorID, url)
	j, err := scanVendorJob(row)
	if err != nil {
		return nil, fmt.Errorf("estate: job not found")
	}
	return j, nil
}
func (s *Service) SubmitInvoice(ctx context.Context, estateID, userID, jobID, url string) (*VendorJob, error) {
	return s.setJobURL(ctx, estateID, userID, jobID, "invoice_url", url)
}
func (s *Service) UploadCompletionEvidence(ctx context.Context, estateID, userID, jobID, url string) (*VendorJob, error) {
	return s.setJobURL(ctx, estateID, userID, jobID, "completion_url", url)
}

// RequestPayout pays a completed job to the vendor's wallet (idempotent).
//
// Iron rules: Idempotency-Key required (fail-closed); balanced double-entry
// (DEBIT estate settlement → CREDIT vendor wallet) via the ledger; idempotent on
// the key (ledger + payout_idempotency_key unique index); audited.
func (s *Service) RequestPayout(ctx context.Context, estateID, userID, jobID, idempotencyKey string) (*VendorJob, error) {
	if idempotencyKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if s.ledger == nil {
		return nil, ErrLedgerUnavailable
	}
	vendorID, err := s.resolveVendorID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	var amount int64
	var status string
	if err := s.db.QueryRow(ctx, `SELECT amount_kobo, status FROM vendor_jobs WHERE id=$1 AND estate_id=$2 AND vendor_id=$3`, jobID, estateID, vendorID).Scan(&amount, &status); err != nil {
		return nil, fmt.Errorf("estate: job not found for this vendor")
	}
	if status == "paid" {
		return s.getJob(ctx, estateID, jobID) // idempotent: already paid
	}
	if status != "completed" {
		return nil, fmt.Errorf("estate: job must be completed before payout (is %q)", status)
	}
	if amount <= 0 {
		return nil, fmt.Errorf("estate: job has no payable amount")
	}
	settle, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, fmt.Errorf("estate: settlement account: %w", err)
	}
	ref := "estate_vendor_payout:" + estateID + ":" + jobID
	if err := s.ledger.Credit(ctx, userID, ref, idempotencyKey, settle.ID, amount); err != nil && err != ledger.ErrDuplicate {
		return nil, fmt.Errorf("estate: vendor payout credit: %w", err)
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	ct, err := tx.Exec(ctx,
		`UPDATE vendor_jobs SET status='paid', paid_at=NOW(), payout_ref=$1, payout_idempotency_key=$2
		 WHERE id=$3 AND estate_id=$4 AND status='completed'`,
		ref, idempotencyKey, jobID, estateID)
	if err != nil {
		return nil, fmt.Errorf("estate: mark job paid: %w", err)
	}
	if ct.RowsAffected() == 0 {
		// Lost a race; return the canonical row.
		return s.getJob(ctx, estateID, jobID)
	}
	if err := s.auditTx(ctx, tx, estateID, userID, "VENDOR_PAYOUT", "vendor_job", jobID, map[string]any{"amount_kobo": amount, "reference": ref}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.getJob(ctx, estateID, jobID)
}

// GetVendorEarnings summarises a vendor's paid jobs.
func (s *Service) GetVendorEarnings(ctx context.Context, estateID, userID string) (map[string]any, error) {
	vendorID, err := s.resolveVendorID(ctx, estateID, userID)
	if err != nil {
		return nil, err
	}
	var paidCount int
	var paidKobo int64
	if err := s.db.QueryRow(ctx, `SELECT count(*), COALESCE(sum(amount_kobo),0) FROM vendor_jobs WHERE estate_id=$1 AND vendor_id=$2 AND status='paid'`, estateID, vendorID).Scan(&paidCount, &paidKobo); err != nil {
		return nil, err
	}
	var openCount int
	_ = s.db.QueryRow(ctx, `SELECT count(*) FROM vendor_jobs WHERE estate_id=$1 AND vendor_id=$2 AND status NOT IN ('paid','rejected')`, estateID, vendorID).Scan(&openCount)
	return map[string]any{"paid_jobs": paidCount, "total_earned_kobo": paidKobo, "open_jobs": openCount}, nil
}
