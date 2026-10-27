package estate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/internal/health/makercheck"
)

// dual_control.go — ESTD-D027 (S1): maker-checker + versioned approval
// thresholds for HIGH-RISK estate admin actions (UAT EST-UAT-0421 / -0428).
//
// Gated by FEATURE_ESTATE_DUAL_CONTROL_ENABLED (Service.WithDualControl). With
// the flag OFF every existing endpoint behaves exactly as before and the
// approval routes are not mounted.
//
// Dual-controlled actions (flag ON):
//
//	vendor_payout     releasing a completed vendor job's payout (money out of
//	                  estate settlement). Requires a checker when the job amount
//	                  is >= the estate's vendor_payout_kobo threshold; below it
//	                  the request executes immediately (ADR-005 shape: the row
//	                  is still written, for audit). The vendor's own
//	                  /vendor/jobs/:jid/payout is refused at/above threshold.
//	resident_ban      always dual-controlled; POST /admin/residents/:uid/ban
//	                  files a pending request (202) instead of banning.
//	role_grant        escalating a resident to estate_admin — always
//	                  dual-controlled (only reachable through an approval).
//	threshold_change  changing the thresholds themselves — always
//	                  dual-controlled; activates a NEW version row in the
//	                  append-only estate_approval_thresholds history.
//
// Not dual-controlled (reversible / low blast radius, still audited):
// resident restore, dues restrictions, estate rules/subscription config.
//
// Four-eyes decision reuses internal/health/makercheck (as marketplace does);
// the DB CHECK estate_admin_approvals_no_self_approve is the second line.
// Exactly-once: approve → execute → 'executed' runs under a FOR UPDATE lock on
// the request row, so a replayed or concurrent approve sees 'executed' and
// returns the stored result; executors are themselves idempotent (ledger
// idempotency key "estate_approval:<id>", status-guarded UPDATEs) so a crash
// between side effect and commit cannot double-post on retry.

// ApprovalAction names a dual-controlled estate admin action.
type ApprovalAction string

const (
	ApprovalVendorPayout    ApprovalAction = "vendor_payout"
	ApprovalResidentBan     ApprovalAction = "resident_ban"
	ApprovalRoleGrant       ApprovalAction = "role_grant"
	ApprovalThresholdChange ApprovalAction = "threshold_change"
)

// Approval request lifecycle (DB values).
const (
	ApprovalPending  = "pending"
	ApprovalApproved = "approved"
	ApprovalRejected = "rejected"
	ApprovalExecuted = "executed"
	ApprovalExpired  = "expired"
)

// DefaultVendorPayoutThresholdKobo applies until an estate activates its own
// threshold version: ₦100,000, the same line ADR-005 draws for manual wallet
// adjustments.
const DefaultVendorPayoutThresholdKobo int64 = 10_000_000

var (
	ErrDualControlDisabled = errors.New("estate: dual-control approvals are not enabled")
	ErrApprovalNotFound    = errors.New("estate: approval request not found")
	ErrApprovalSelf        = errors.New("estate: a different estate admin must approve this action (maker-checker)")
	ErrApprovalNotPending  = errors.New("estate: approval request is not pending")
	ErrApprovalExpired     = errors.New("estate: approval request has expired")
	ErrApprovalOpen        = errors.New("estate: an open approval request already exists for this action")
	ErrApprovalInvalid     = errors.New("estate: invalid approval request")
	ErrApprovalKeyReused   = errors.New("estate: Idempotency-Key already used for a different approval request")
	// ErrDualControlRequired is returned by a direct path that is now gated.
	ErrDualControlRequired = errors.New("estate: this action needs two-admin approval — file it under /admin/approvals")
)

// PendingApprovalError is returned by a direct admin path (e.g. BanResident)
// that, with dual control on, filed an approval request instead of acting.
type PendingApprovalError struct{ Request *ApprovalRequest }

func (e *PendingApprovalError) Error() string {
	return "estate: action filed for second-admin approval"
}

// ApprovalRequest is one maker-checker request.
type ApprovalRequest struct {
	ID               string          `json:"id"`
	EstateID         string          `json:"estate_id"`
	Action           ApprovalAction  `json:"action"`
	SubjectID        string          `json:"subject_id"`
	AmountKobo       int64           `json:"amount_kobo"`
	Payload          json.RawMessage `json:"payload"`
	Status           string          `json:"status"`
	RequiresChecker  bool            `json:"requires_checker"`
	ThresholdVersion int             `json:"threshold_version"`
	ThresholdKobo    *int64          `json:"threshold_kobo,omitempty"`
	InitiatedBy      string          `json:"initiated_by"`
	InitiatorNote    string          `json:"initiator_note,omitempty"`
	DecidedBy        *string         `json:"decided_by,omitempty"`
	DecidedAt        *time.Time      `json:"decided_at,omitempty"`
	DecisionNote     string          `json:"decision_note,omitempty"`
	ExecutedAt       *time.Time      `json:"executed_at,omitempty"`
	ExecutionResult  json.RawMessage `json:"execution_result,omitempty"`
	CreatedAt        time.Time       `json:"created_at"`
	ExpiresAt        time.Time       `json:"expires_at"`
}

// CreateApprovalInput is the maker's request body.
type CreateApprovalInput struct {
	Action         ApprovalAction  `json:"action" binding:"required"`
	SubjectID      string          `json:"subject_id"`
	Payload        json.RawMessage `json:"payload"`
	Note           string          `json:"note"`
	IdempotencyKey string          `json:"-"`
}

// ApprovalThresholds is one version of an estate's threshold policy. Version 0
// is the built-in default (no row yet).
type ApprovalThresholds struct {
	EstateID          string     `json:"estate_id"`
	Version           int        `json:"version"`
	VendorPayoutKobo  int64      `json:"vendor_payout_kobo"`
	ApprovalRequestID *string    `json:"approval_request_id,omitempty"`
	CreatedBy         *string    `json:"created_by,omitempty"`
	CreatedAt         *time.Time `json:"created_at,omitempty"`
}

// WithDualControl turns the maker-checker gate on (FEATURE_ESTATE_DUAL_CONTROL_ENABLED).
func (s *Service) WithDualControl(enabled bool) *Service {
	s.dualControl = enabled
	return s
}

// requiresChecker is the pure threshold policy: which requests need a second
// admin. Unknown actions fail closed (always need a checker).
func requiresChecker(action ApprovalAction, amountKobo int64, th ApprovalThresholds) bool {
	switch action {
	case ApprovalVendorPayout:
		return amountKobo >= th.VendorPayoutKobo
	case ApprovalResidentBan, ApprovalRoleGrant, ApprovalThresholdChange:
		return true
	default:
		return true
	}
}

// approvalToMakercheck maps a DB status onto the shared makercheck state machine.
func approvalToMakercheck(status string) makercheck.State {
	switch status {
	case ApprovalPending:
		return makercheck.StatePending
	case ApprovalApproved:
		return makercheck.StateApproved
	case ApprovalExecuted:
		return makercheck.StateConsumed
	default:
		return makercheck.StateRejected
	}
}

// thresholdPayload is the threshold_change body. Kobo integers only: a JSON
// float (or string) is rejected rather than truncated.
type thresholdPayload struct {
	VendorPayoutKobo int64 `json:"vendor_payout_kobo"`
}

func parseThresholdPayload(raw json.RawMessage) (thresholdPayload, error) {
	var p thresholdPayload
	if len(raw) == 0 {
		return p, fmt.Errorf("%w: payload.vendor_payout_kobo is required", ErrApprovalInvalid)
	}
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return p, fmt.Errorf("%w: payload must be an object", ErrApprovalInvalid)
	}
	v, ok := probe["vendor_payout_kobo"]
	if !ok {
		return p, fmt.Errorf("%w: payload.vendor_payout_kobo is required", ErrApprovalInvalid)
	}
	if err := json.Unmarshal(v, &p.VendorPayoutKobo); err != nil {
		return p, fmt.Errorf("%w: vendor_payout_kobo must be an integer number of kobo", ErrApprovalInvalid)
	}
	if p.VendorPayoutKobo < 0 {
		return p, fmt.Errorf("%w: vendor_payout_kobo must be >= 0", ErrApprovalInvalid)
	}
	return p, nil
}

// CurrentThresholds returns the active threshold version (or the default).
func (s *Service) CurrentThresholds(ctx context.Context, estateID string) (ApprovalThresholds, error) {
	th := ApprovalThresholds{EstateID: estateID, VendorPayoutKobo: DefaultVendorPayoutThresholdKobo}
	var reqID, by *string
	var at time.Time
	err := s.db.QueryRow(ctx, `SELECT version, vendor_payout_kobo, approval_request_id::text, created_by::text, created_at
		FROM estate_approval_thresholds WHERE estate_id=$1 ORDER BY version DESC LIMIT 1`, estateID).
		Scan(&th.Version, &th.VendorPayoutKobo, &reqID, &by, &at)
	if errors.Is(err, pgx.ErrNoRows) {
		return th, nil
	}
	if err != nil {
		return th, fmt.Errorf("estate: load approval thresholds: %w", err)
	}
	th.ApprovalRequestID, th.CreatedBy, th.CreatedAt = reqID, by, &at
	return th, nil
}

// GetApprovalThresholds returns the active version plus full history, newest
// first (estate admin only).
func (s *Service) GetApprovalThresholds(ctx context.Context, estateID, adminID string) (ApprovalThresholds, []ApprovalThresholds, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return ApprovalThresholds{}, nil, err
	}
	cur, err := s.CurrentThresholds(ctx, estateID)
	if err != nil {
		return cur, nil, err
	}
	rows, err := s.db.Query(ctx, `SELECT version, vendor_payout_kobo, approval_request_id::text, created_by::text, created_at
		FROM estate_approval_thresholds WHERE estate_id=$1 ORDER BY version DESC`, estateID)
	if err != nil {
		return cur, nil, err
	}
	defer rows.Close()
	history := []ApprovalThresholds{}
	for rows.Next() {
		h := ApprovalThresholds{EstateID: estateID}
		var at time.Time
		if err := rows.Scan(&h.Version, &h.VendorPayoutKobo, &h.ApprovalRequestID, &h.CreatedBy, &at); err != nil {
			return cur, nil, err
		}
		h.CreatedAt = &at
		history = append(history, h)
	}
	return cur, history, rows.Err()
}

const approvalCols = `id, estate_id, action, subject_id, amount_kobo, payload, status, requires_checker,
	threshold_version, threshold_kobo, initiated_by::text, COALESCE(initiator_note,''), decided_by::text, decided_at,
	COALESCE(decision_note,''), executed_at, execution_result, created_at, expires_at`

// Shared lister fragments (the literals recur across the package's queries).
const (
	sqlAndStatusEq    = ` AND status=$2`
	sqlNewestFirst200 = ` ORDER BY created_at DESC LIMIT 200`
)

func scanApproval(row interface{ Scan(dest ...any) error }) (*ApprovalRequest, error) {
	var a ApprovalRequest
	var action string
	if err := row.Scan(&a.ID, &a.EstateID, &action, &a.SubjectID, &a.AmountKobo, &a.Payload, &a.Status,
		&a.RequiresChecker, &a.ThresholdVersion, &a.ThresholdKobo, &a.InitiatedBy, &a.InitiatorNote,
		&a.DecidedBy, &a.DecidedAt, &a.DecisionNote, &a.ExecutedAt, &a.ExecutionResult, &a.CreatedAt, &a.ExpiresAt); err != nil {
		return nil, err
	}
	a.Action = ApprovalAction(action)
	return &a, nil
}

func (s *Service) approvalByID(ctx context.Context, estateID, id string) (*ApprovalRequest, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, ErrApprovalNotFound
	}
	a, err := scanApproval(s.db.QueryRow(ctx, `SELECT `+approvalCols+` FROM estate_admin_approvals WHERE id=$1 AND estate_id=$2`, id, estateID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrApprovalNotFound
	}
	return a, err
}

// GetApproval returns one request (estate admin only).
func (s *Service) GetApproval(ctx context.Context, estateID, adminID, id string) (*ApprovalRequest, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	return s.approvalByID(ctx, estateID, id)
}

// ListApprovals lists an estate's requests, newest first (estate admin only).
func (s *Service) ListApprovals(ctx context.Context, estateID, adminID, status string) ([]ApprovalRequest, error) {
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	q := `SELECT ` + approvalCols + ` FROM estate_admin_approvals WHERE estate_id=$1`
	args := []any{estateID}
	if status != "" {
		q += sqlAndStatusEq
		args = append(args, status)
	}
	q += sqlNewestFirst200
	rows, err := s.db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ApprovalRequest{}
	for rows.Next() {
		a, err := scanApproval(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}

// prepareApproval validates the action against current state and resolves the
// server-side amount (never trusted from the client).
func (s *Service) prepareApproval(ctx context.Context, estateID, adminID string, in *CreateApprovalInput) (int64, error) {
	in.SubjectID = strings.TrimSpace(in.SubjectID)
	switch in.Action {
	case ApprovalVendorPayout:
		return s.preparePayoutApproval(ctx, estateID, in)
	case ApprovalResidentBan:
		return s.prepareBanApproval(ctx, estateID, adminID, in)
	case ApprovalRoleGrant:
		return s.prepareRoleGrantApproval(ctx, estateID, adminID, in)
	case ApprovalThresholdChange:
		p, err := parseThresholdPayload(in.Payload)
		if err != nil {
			return 0, err
		}
		in.SubjectID = estateID
		in.Payload = mustJSON(p)
		return 0, nil
	default:
		return 0, fmt.Errorf("%w: unknown action %q", ErrApprovalInvalid, in.Action)
	}
}

func (s *Service) preparePayoutApproval(ctx context.Context, estateID string, in *CreateApprovalInput) (int64, error) {
	if _, err := uuid.Parse(in.SubjectID); err != nil {
		return 0, fmt.Errorf("%w: subject_id must be the vendor job id", ErrApprovalInvalid)
	}
	var amount int64
	var status string
	if err := s.db.QueryRow(ctx, `SELECT amount_kobo, status FROM vendor_jobs WHERE id=$1 AND estate_id=$2`, in.SubjectID, estateID).Scan(&amount, &status); err != nil {
		return 0, fmt.Errorf("%w: vendor job not found in this estate", ErrApprovalInvalid)
	}
	if status != vendorJobDone {
		return 0, fmt.Errorf("%w: job must be completed before payout (is %q)", ErrApprovalInvalid, status)
	}
	if amount <= 0 {
		return 0, fmt.Errorf("%w: job has no payable amount", ErrApprovalInvalid)
	}
	in.Payload = json.RawMessage("{}")
	return amount, nil
}

// residentRoleTarget is the shared shape for ban/role-grant requests: the
// subject must be a different resident of the estate.
func (s *Service) residentRoleTarget(ctx context.Context, estateID, adminID string, in *CreateApprovalInput) (string, error) {
	if _, err := uuid.Parse(in.SubjectID); err != nil {
		return "", fmt.Errorf("%w: subject_id must be the resident's user id", ErrApprovalInvalid)
	}
	if in.SubjectID == adminID {
		return "", fmt.Errorf("%w: you cannot file this action against yourself", ErrApprovalInvalid)
	}
	role, err := s.roleIn(ctx, estateID, in.SubjectID)
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrApprovalInvalid, err)
	}
	return role, nil
}

func (s *Service) prepareBanApproval(ctx context.Context, estateID, adminID string, in *CreateApprovalInput) (int64, error) {
	if _, err := s.residentRoleTarget(ctx, estateID, adminID, in); err != nil {
		return 0, err
	}
	var p struct {
		Reason string `json:"reason"`
	}
	if len(in.Payload) > 0 {
		_ = json.Unmarshal(in.Payload, &p)
	}
	in.Payload = mustJSON(map[string]string{auditKeyReason: p.Reason})
	return 0, nil
}

func (s *Service) prepareRoleGrantApproval(ctx context.Context, estateID, adminID string, in *CreateApprovalInput) (int64, error) {
	role, err := s.residentRoleTarget(ctx, estateID, adminID, in)
	if err != nil {
		return 0, err
	}
	var p struct {
		Role string `json:"role"`
	}
	if len(in.Payload) > 0 {
		_ = json.Unmarshal(in.Payload, &p)
	}
	if p.Role == "" {
		p.Role = roleEstateAdmin
	}
	if p.Role != roleEstateAdmin {
		return 0, fmt.Errorf("%w: only escalation to estate_admin is supported", ErrApprovalInvalid)
	}
	if role == roleEstateAdmin {
		return 0, fmt.Errorf("%w: user is already an estate admin", ErrApprovalInvalid)
	}
	in.Payload = mustJSON(map[string]string{payloadKeyRole: p.Role})
	return 0, nil
}

// CreateApproval files a maker request (estate admin only, Idempotency-Key
// required). A request that does not need a checker (vendor payout below the
// threshold) executes immediately and is returned already 'executed'.
func (s *Service) CreateApproval(ctx context.Context, estateID, adminID string, in CreateApprovalInput) (*ApprovalRequest, error) {
	if !s.dualControl {
		return nil, ErrDualControlDisabled
	}
	in.IdempotencyKey = strings.TrimSpace(in.IdempotencyKey)
	if in.IdempotencyKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if err := s.assertEstateAdmin(ctx, estateID, adminID); err != nil {
		return nil, err
	}
	// Replay of the same create → the same request, nothing re-filed.
	if prev, err := s.approvalByIdemKey(ctx, estateID, in.IdempotencyKey); err != nil || prev != nil {
		if prev != nil && (prev.Action != in.Action || prev.InitiatedBy != adminID) {
			return nil, ErrApprovalKeyReused
		}
		return prev, err
	}
	amount, err := s.prepareApproval(ctx, estateID, adminID, &in)
	if err != nil {
		return nil, err
	}
	th, err := s.CurrentThresholds(ctx, estateID)
	if err != nil {
		return nil, err
	}
	need := requiresChecker(in.Action, amount, th)
	var thKobo *int64
	if in.Action == ApprovalVendorPayout {
		v := th.VendorPayoutKobo
		thKobo = &v
	}
	id := uuid.New().String()
	_, err = s.db.Exec(ctx, `INSERT INTO estate_admin_approvals
		(id, estate_id, action, subject_id, amount_kobo, payload, status, requires_checker, threshold_version, threshold_kobo,
		 initiated_by, initiator_note, idempotency_key)
		VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,NULLIF($11,''),$12)`,
		id, estateID, string(in.Action), in.SubjectID, amount, in.Payload, need, th.Version, thKobo,
		adminID, in.Note, in.IdempotencyKey)
	if err != nil {
		if dbutil.IsUniqueViolation(err) {
			if prev, perr := s.approvalByIdemKey(ctx, estateID, in.IdempotencyKey); perr == nil && prev != nil {
				return prev, nil // lost a replay race
			}
			return nil, ErrApprovalOpen
		}
		return nil, fmt.Errorf("estate: file approval: %w", err)
	}
	_ = s.audit(ctx, estateID, adminID, "APPROVAL_REQUESTED", "approval_request", id, map[string]any{
		keyAction: string(in.Action), keySubjectID: in.SubjectID, keyAmountKobo: amount,
		"requires_checker": need, "threshold_version": th.Version,
	})
	if !need {
		a, _, err := s.runApproval(ctx, estateID, adminID, id, "", false)
		return a, err
	}
	return s.approvalByID(ctx, estateID, id)
}

func (s *Service) approvalByIdemKey(ctx context.Context, estateID, key string) (*ApprovalRequest, error) {
	a, err := scanApproval(s.db.QueryRow(ctx, `SELECT `+approvalCols+` FROM estate_admin_approvals WHERE estate_id=$1 AND idempotency_key=$2`, estateID, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return a, err
}

// ApproveApproval is the checker step: a DIFFERENT estate admin approves and the
// action executes exactly once. replayed=true means it had already executed and
// nothing ran again.
func (s *Service) ApproveApproval(ctx context.Context, estateID, checkerID, id, note string) (*ApprovalRequest, bool, error) {
	if !s.dualControl {
		return nil, false, ErrDualControlDisabled
	}
	if err := s.assertEstateAdmin(ctx, estateID, checkerID); err != nil {
		return nil, false, err
	}
	return s.runApproval(ctx, estateID, checkerID, id, note, true)
}

// RejectApproval is the checker declining (a different admin than the maker).
func (s *Service) RejectApproval(ctx context.Context, estateID, checkerID, id, note string) (*ApprovalRequest, error) {
	if !s.dualControl {
		return nil, ErrDualControlDisabled
	}
	if err := s.assertEstateAdmin(ctx, estateID, checkerID); err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(id); err != nil {
		return nil, ErrApprovalNotFound
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	a, err := scanApproval(tx.QueryRow(ctx, `SELECT `+approvalCols+` FROM estate_admin_approvals WHERE id=$1 AND estate_id=$2 FOR UPDATE`, id, estateID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrApprovalNotFound
	}
	if err != nil {
		return nil, err
	}
	if _, err := makercheck.Approve(a.InitiatedBy, checkerID, approvalToMakercheck(a.Status), false); err != nil {
		return nil, mapMakercheckErr(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE estate_admin_approvals SET status='rejected', decided_by=$2, decided_at=NOW(), decision_note=NULLIF($3,'')
		WHERE id=$1 AND status='pending'`, id, checkerID, note); err != nil {
		return nil, fmt.Errorf("estate: reject approval: %w", err)
	}
	if err := s.auditTx(ctx, tx, estateID, checkerID, "APPROVAL_REJECTED", "approval_request", id, map[string]any{
		keyAction: string(a.Action), keySubjectID: a.SubjectID, keyInitiatedBy: a.InitiatedBy, "note": note,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.approvalByID(ctx, estateID, id)
}

func mapMakercheckErr(err error) error {
	switch {
	case errors.Is(err, makercheck.ErrSelfApproval), errors.Is(err, makercheck.ErrMissingActor):
		return ErrApprovalSelf
	case errors.Is(err, makercheck.ErrNotPending), errors.Is(err, makercheck.ErrNotApproved):
		return ErrApprovalNotPending
	default:
		return err
	}
}

// beneficiary is the user who gains from / is targeted by the action; the
// checker must not be them either (an admin cannot approve their own payout,
// ban or promotion even when someone else filed it).
func (s *Service) beneficiary(ctx context.Context, a *ApprovalRequest) (string, error) {
	switch a.Action {
	case ApprovalResidentBan, ApprovalRoleGrant:
		return a.SubjectID, nil
	case ApprovalVendorPayout:
		var uid string
		err := s.db.QueryRow(ctx, `SELECT v.user_id::text FROM vendor_jobs j JOIN estate_vendors v ON v.id=j.vendor_id
			WHERE j.id=$1 AND j.estate_id=$2`, a.SubjectID, a.EstateID).Scan(&uid)
		if err != nil {
			return "", fmt.Errorf("estate: resolve payout beneficiary: %w", err)
		}
		return uid, nil
	case ApprovalThresholdChange:
		return "", nil
	default:
		return "", nil
	}
}

// runApproval moves a request to 'executed' exactly once. asChecker=false is
// the below-threshold immediate path (maker only, requires_checker=false).
func (s *Service) runApproval(ctx context.Context, estateID, actorID, id, note string, asChecker bool) (*ApprovalRequest, bool, error) {
	if _, err := uuid.Parse(id); err != nil {
		return nil, false, ErrApprovalNotFound
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	a, err := scanApproval(tx.QueryRow(ctx, `SELECT `+approvalCols+` FROM estate_admin_approvals WHERE id=$1 AND estate_id=$2 FOR UPDATE`, id, estateID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, ErrApprovalNotFound
	}
	if err != nil {
		return nil, false, err
	}
	switch a.Status {
	case ApprovalExecuted:
		// Replay (or a concurrent checker who waited on the row lock): the
		// action already ran — return the stored outcome, execute nothing.
		return a, true, nil
	case ApprovalPending:
	default:
		return nil, false, ErrApprovalNotPending
	}
	if time.Now().After(a.ExpiresAt) {
		if _, err := tx.Exec(ctx, `UPDATE estate_admin_approvals SET status='expired' WHERE id=$1 AND status='pending'`, id); err == nil {
			_ = s.auditTx(ctx, tx, estateID, actorID, "APPROVAL_EXPIRED", "approval_request", id, nil)
			_ = tx.Commit(ctx)
		}
		return nil, false, ErrApprovalExpired
	}
	if asChecker || a.RequiresChecker {
		if !asChecker {
			return nil, false, ErrApprovalSelf
		}
		if _, err := makercheck.Approve(a.InitiatedBy, actorID, makercheck.StatePending, true); err != nil {
			return nil, false, mapMakercheckErr(err)
		}
		ben, err := s.beneficiary(ctx, a)
		if err != nil {
			return nil, false, err
		}
		if ben != "" && strings.EqualFold(ben, actorID) {
			return nil, false, ErrApprovalSelf
		}
		if _, err := tx.Exec(ctx, `UPDATE estate_admin_approvals SET status='approved', decided_by=$2, decided_at=NOW(), decision_note=NULLIF($3,'')
			WHERE id=$1 AND status='pending'`, id, actorID, note); err != nil {
			return nil, false, fmt.Errorf("estate: approve: %w", err)
		}
		if err := s.auditTx(ctx, tx, estateID, actorID, "APPROVAL_APPROVED", "approval_request", id, map[string]any{
			keyAction: string(a.Action), keySubjectID: a.SubjectID, keyInitiatedBy: a.InitiatedBy, keyAmountKobo: a.AmountKobo,
		}); err != nil {
			return nil, false, err
		}
	} else {
		// Immediate path: still a recorded approve→consume transition.
		if _, err := tx.Exec(ctx, `UPDATE estate_admin_approvals SET status='approved' WHERE id=$1 AND status='pending'`, id); err != nil {
			return nil, false, err
		}
	}
	if _, err := makercheck.Consume(makercheck.StateApproved); err != nil {
		return nil, false, mapMakercheckErr(err)
	}
	result, execErr := s.executeApproval(ctx, tx, a, actorID)
	if execErr != nil {
		_ = tx.Rollback(ctx)
		_ = s.audit(ctx, estateID, actorID, "APPROVAL_EXECUTION_FAILED", "approval_request", id, map[string]any{
			keyAction: string(a.Action), keyError: execErr.Error(),
		})
		return nil, false, execErr
	}
	resJSON := mustJSON(result)
	if _, err := tx.Exec(ctx, `UPDATE estate_admin_approvals SET status='executed', executed_at=NOW(), execution_result=$2
		WHERE id=$1 AND status='approved'`, id, resJSON); err != nil {
		return nil, false, fmt.Errorf("estate: mark approval executed: %w", err)
	}
	if err := s.auditTx(ctx, tx, estateID, actorID, "APPROVAL_EXECUTED", "approval_request", id, map[string]any{
		keyAction: string(a.Action), keySubjectID: a.SubjectID, keyInitiatedBy: a.InitiatedBy,
		keyAmountKobo: a.AmountKobo, "requires_checker": a.RequiresChecker,
	}); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	out, err := s.approvalByID(ctx, estateID, id)
	return out, false, err
}

// executeApproval performs the approved action. Every branch is idempotent.
func (s *Service) executeApproval(ctx context.Context, tx pgx.Tx, a *ApprovalRequest, actorID string) (map[string]any, error) {
	switch a.Action {
	case ApprovalVendorPayout:
		vendorUserID, err := s.beneficiary(ctx, a)
		if err != nil {
			return nil, err
		}
		job, err := s.payVendorJob(ctx, a.EstateID, actorID, vendorUserID, a.SubjectID, "estate_approval:"+a.ID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"job_id": job.ID, "job_status": job.Status, "payout_ref": job.PayoutRef}, nil
	case ApprovalResidentBan:
		var p struct {
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(a.Payload, &p)
		if err := s.banResident(ctx, a.EstateID, actorID, a.SubjectID, p.Reason); err != nil {
			return nil, err
		}
		return map[string]any{"banned_user_id": a.SubjectID}, nil
	case ApprovalRoleGrant:
		ct, err := tx.Exec(ctx, `UPDATE estate_residents SET role='estate_admin'
			WHERE estate_id=$1 AND user_id=$2 AND role='resident' AND banned_at IS NULL AND deleted_at IS NULL`, a.EstateID, a.SubjectID)
		if err != nil {
			return nil, fmt.Errorf("estate: grant role: %w", err)
		}
		if ct.RowsAffected() == 0 {
			var role string
			if err := tx.QueryRow(ctx, `SELECT role FROM estate_residents WHERE estate_id=$1 AND user_id=$2 AND banned_at IS NULL AND deleted_at IS NULL`,
				a.EstateID, a.SubjectID).Scan(&role); err != nil || role != roleEstateAdmin {
				return nil, errors.New("estate: resident is no longer eligible for the role grant")
			}
		}
		if err := s.auditTx(ctx, tx, a.EstateID, actorID, "ROLE_GRANT", "resident", a.SubjectID, map[string]any{
			payloadKeyRole: roleEstateAdmin, "approval_request_id": a.ID, keyInitiatedBy: a.InitiatedBy,
		}); err != nil {
			return nil, err
		}
		return map[string]any{keyUserID: a.SubjectID, payloadKeyRole: roleEstateAdmin}, nil
	case ApprovalThresholdChange:
		p, err := parseThresholdPayload(a.Payload)
		if err != nil {
			return nil, err
		}
		// Append-only: a new version row; ON CONFLICT on the activating request
		// makes a re-run a no-op (DO NOTHING — an UPDATE would trip the
		// append-only trigger), then the existing version is read back.
		var version int
		err = tx.QueryRow(ctx, `INSERT INTO estate_approval_thresholds (estate_id, version, vendor_payout_kobo, approval_request_id, created_by)
			SELECT $1, COALESCE(MAX(version),0)+1, $2, $3, $4 FROM estate_approval_thresholds WHERE estate_id=$1
			ON CONFLICT (approval_request_id) DO NOTHING
			RETURNING version`, a.EstateID, p.VendorPayoutKobo, a.ID, a.InitiatedBy).Scan(&version)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `SELECT version FROM estate_approval_thresholds WHERE approval_request_id=$1`, a.ID).Scan(&version)
		}
		if err != nil {
			return nil, fmt.Errorf("estate: activate threshold version: %w", err)
		}
		if err := s.auditTx(ctx, tx, a.EstateID, actorID, "APPROVAL_THRESHOLD_ACTIVATED", "approval_thresholds", a.EstateID, map[string]any{
			"version": version, "vendor_payout_kobo": p.VendorPayoutKobo, "approval_request_id": a.ID,
		}); err != nil {
			return nil, err
		}
		return map[string]any{"version": version, "vendor_payout_kobo": p.VendorPayoutKobo}, nil
	default:
		return nil, fmt.Errorf("%w: unknown action %q", ErrApprovalInvalid, a.Action)
	}
}

// openApproval returns the pending request for (action, subject), used when a
// direct path collides with one already filed.
func (s *Service) openApproval(ctx context.Context, estateID string, action ApprovalAction, subjectID string) (*ApprovalRequest, error) {
	a, err := scanApproval(s.db.QueryRow(ctx, `SELECT `+approvalCols+` FROM estate_admin_approvals
		WHERE estate_id=$1 AND action=$2 AND subject_id=$3 AND status IN ('pending','approved')`, estateID, string(action), subjectID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrApprovalOpen
	}
	return a, err
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}
