package tuition

// service.go is the Film Academy tuition payment money path: the saga of
// validate → debit wallet → post ledger → record payment, plus plan creation
// and status queries.
//
// Architecture mirrors backend/internal/utilitybills/service.go:
//   - wallet debit goes through wallet.Service.Debit (NOT ledger.Service.Debit)
//     so tier/daily-limit checks fire;
//   - ledger posting is via commission.Service.RecordExact (balanced DR/CR);
//   - idempotency is guarded at TWO layers: redis key claim + unique constraint
//     on a dedicated table;
//   - audit trail via Auditor interface (fire-and-forget, nil-safe);
//   - domain uses whole NAIRA (int64), never kobo. Converted to kobo at ledger seam
//     (1 NGN = 100 kobo) via boundary adapter pattern.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/commission"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/platform/redis"
)

// ── Service-layer errors ────────────────────────────────────────────────────

var (
	ErrDuplicate            = errors.New("tuition: duplicate idempotency key")
	ErrInsufficientTier     = errors.New("tuition: insufficient tier for this payment")
	ErrZeroPayment          = errors.New("tuition: payment amount must be > 0")
	ErrInvalidPlanType      = errors.New("tuition: invalid plan type")
	ErrPlanNotFound         = errors.New("tuition: no active plan found")
	ErrApplicationNotFound  = errors.New("tuition: application not found")
	ErrBatchNotFound        = errors.New("tuition: batch not found")
	ErrInvalidPaymentAmount = errors.New("tuition: payment amount does not match plan")
	ErrKYCRequired          = errors.New("tuition: verified KYC required to pay tuition")
)

// Auditor is the admin-action audit sink, matching services.AuditService's LogAction.
// Deliberately nil-safe and fire-and-forget: an audit sink that could fail a money
// mutation would be a worse outcome than a missing audit row.
type Auditor interface {
	LogAction(actorUserID, targetUserID, action, module, resourceType, resourceID string,
		oldValues, newValues map[string]any, ipAddress, userAgent, severity string)
}

const auditModule = "academy_tuition"

// Audit action names.
const (
	actionPaymentRecorded = "academy_tuition.payment.recorded"
	actionPlanCreated     = "academy_tuition.plan.created"
	actionPlanCompleted   = "academy_tuition.plan.completed"
	actionPaymentWaived   = "academy_tuition.payment.waived"
)

// PaymentResult is the response from a successful payment.
type PaymentResult struct {
	PaymentID        string    `json:"paymentId"`
	PlanID           string    `json:"planId"`
	ApplicationID    string    `json:"applicationId"`
	AmountPaidNGN    int64     `json:"amountPaidNgn"`
	LedgerReference  string    `json:"ledgerReference"`
	PaidAt           time.Time `json:"paidAt"`
	NextDueDate      *time.Time `json:"nextDueDate,omitempty"`
	IsPlancompleted  bool      `json:"isPlanCompleted"`
}

// TuitionStatus is the query response for enrollment gating.
type TuitionStatus struct {
	ApplicationID    string              `json:"applicationId"`
	UserID           string              `json:"userId"`
	BatchID          string              `json:"batchId"`
	TuitionTotalNGN  int64               `json:"tuitionTotalNgn"`
	PaymentStatus    string              `json:"paymentStatus"`
	Plan             *InstallmentPlan    `json:"plan,omitempty"`
	Payments         []InstallmentPayment `json:"payments,omitempty"`
	TotalPaidNGN     int64               `json:"totalPaidNgn"`
	IsReadyForAccess bool                `json:"isReadyForAccess"`
}

// Service owns tuition payment logic.
type Service struct {
	repo          *Repository
	walletSvc     *wallet.Service
	ledgerSvc     *ledger.Service
	commissionSvc *commission.Service
	redisClient   *redis.Client
	auditor       Auditor
	db            *pgxpool.Pool
}

// NewService constructs the service. Auditor and redis client are optional (nil-safe).
func NewService(repo *Repository, walletSvc *wallet.Service, ledgerSvc *ledger.Service,
	commissionSvc *commission.Service, redisClient *redis.Client, auditor Auditor, db *pgxpool.Pool) *Service {
	return &Service{
		repo:          repo,
		walletSvc:     walletSvc,
		ledgerSvc:     ledgerSvc,
		commissionSvc: commissionSvc,
		redisClient:   redisClient,
		auditor:       auditor,
		db:            db,
	}
}

// verifiedKYCTier returns the user's verified KYC tier (0 when not verified or
// when no matching row exists — fail-closed). Queries user_profiles.kyc_tier
// where kyc_status = 'verified'.
func (s *Service) verifiedKYCTier(ctx context.Context, userID string) (int, error) {
	if s.db == nil {
		// db is required for the KYC gate; treat as unverified rather than fail open.
		return 0, nil
	}
	const q = `SELECT COALESCE(kyc_tier, 0) FROM user_profiles WHERE id = $1 AND kyc_status = 'verified'`
	var tier int
	err := s.db.QueryRow(ctx, q, userID).Scan(&tier)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("kyc tier: %w", err)
	}
	return tier, nil
}

// PayTuition orchestrates the payment saga:
// 1. Idempotency check (redis key claim)
// 2. KYC gate (fail-closed: tier must be >= 1)
// 3. Fetch application + batch + plan
// 4. Wallet debit (in KOBO, converted from domain NAIRA)
// 5. Ledger posting (balanced, with commission leg)
// 6. Record payment
// 7. Check plan completion
// 8. Emit audit trail
//
// REVERSAL STRATEGY: If wallet.Debit succeeds but any later step fails,
// PostReversal is called to recover funds (user_wallet CR / tuition_account DR).
func (s *Service) PayTuition(ctx context.Context, idempotencyKey string, appID string,
	amountNaira int64, userID string) (*PaymentResult, error) {

	if idempotencyKey == "" {
		return nil, fmt.Errorf("tuition: Idempotency-Key header is required")
	}

	if amountNaira <= 0 {
		return nil, ErrZeroPayment
	}

	// Idempotency: claim the key in Redis BEFORE any writes.
	// On collision, return ErrDuplicate (handled as a 200 with cached result in handler).
	if s.redisClient != nil {
		idempKey := fmt.Sprintf("tuition:idempotency:%s", idempotencyKey)
		claimed, err := redis.SetNX(ctx, s.redisClient, idempKey, "claimed", 24*time.Hour)
		if err != nil {
			return nil, fmt.Errorf("idempotency check failed: %w", err)
		}
		if !claimed {
			return nil, ErrDuplicate
		}
	}

	// Fetch application
	app, err := s.repo.GetApplication(ctx, appID)
	if err != nil {
		return nil, fmt.Errorf("fetch application: %w", err)
	}
	if app.UserID != userID {
		return nil, fmt.Errorf("tuition: user mismatch")
	}

	// KYC gate: verified tier >= 1 required to move money for tuition. Fail-closed —
	// any lookup error or missing/unverified profile is treated as "not eligible".
	tier, err := s.verifiedKYCTier(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("kyc check: %w", err)
	}
	if tier < 1 {
		return nil, ErrKYCRequired
	}

	// Fetch batch
	batch, err := s.repo.GetBatch(ctx, app.BatchID)
	if err != nil {
		return nil, fmt.Errorf("fetch batch: %w", err)
	}

	// Fetch or create plan
	plan, err := s.repo.GetPlanByApplicationID(ctx, appID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, fmt.Errorf("fetch plan: %w", err)
	}

	if plan == nil {
		// Plan doesn't exist yet, create it (and its full payment schedule, atomically).
		planType := app.PaymentPreference
		if planType == "" {
			planType = "installment"
		}
		installments := batch.InstallmentsCount
		discountedAmount := batch.FeeNGN
		if planType == "one_off" {
			installments = 1
			discountedAmount = CalculateLumpSumDiscount(batch.FeeNGN, batch.DiscountPct)
		}
		plan, err = s.repo.CreateInstallmentPlan(ctx, appID, app.BatchID, batch.FeeNGN, discountedAmount,
			installments, batch.FeeFrequency, planType)
		if err != nil {
			return nil, fmt.Errorf("create plan: %w", err)
		}
		plan.UserID = userID

		// Audit: plan creation
		if s.auditor != nil {
			s.auditor.LogAction(userID, userID, actionPlanCreated, auditModule,
				"academy_tuition_plan", plan.ID, nil,
				map[string]any{"total_ngn": plan.TotalAmountNGN, "installments": plan.InstallmentsCount},
				"", "", "info")
		}
	}

	// Fetch all payments for the plan
	payments, err := s.repo.ListInstallmentPayments(ctx, plan.ID)
	if err != nil {
		return nil, fmt.Errorf("fetch payments: %w", err)
	}

	// Find first unpaid payment
	var nextPayment *InstallmentPayment
	for i := range payments {
		if payments[i].Status == PaymentStatusPending {
			nextPayment = &payments[i]
			break
		}
	}

	if nextPayment == nil {
		return nil, fmt.Errorf("tuition: no pending payment found")
	}

	// Validate payment amount matches
	if amountNaira != nextPayment.AmountNGN {
		return nil, ErrInvalidPaymentAmount
	}

	// Convert NAIRA to KOBO for ledger (1 NGN = 100 kobo) — boundary adapter
	amountKobo := amountNaira * 100
	ledgerRef := uuid.New().String()

	// Wallet debit (tier checks fire here) — credit to Academy tuition holding account
	// For Phase 1, use Settlement account as the collection point
	tuitionAccount, err := s.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, fmt.Errorf("get tuition account failed: %w", err)
	}

	debitErr := s.walletSvc.Debit(ctx, userID, ledgerRef, idempotencyKey, tuitionAccount.ID, amountKobo)
	if debitErr != nil {
		return nil, fmt.Errorf("wallet debit failed: %w", debitErr)
	}

	// REVERSAL STRATEGY: wallet.Debit just posted a balanced pair (user_wallet DR /
	// tuition_account CR). Every step below is independent of that pair — if any of
	// them fails, the debited funds would otherwise sit stranded in tuition_account
	// with no payment ever recorded. reverseDebit() restores them to the user's
	// wallet (tuition_account DR / user_wallet CR) before returning the error.
	reverseDebit := func(cause error) error {
		userWallet, wErr := s.ledgerSvc.GetOrCreateUserWallet(ctx, userID)
		if wErr != nil {
			return fmt.Errorf("%w (reversal lookup also failed: %v)", cause, wErr)
		}
		revErr := s.ledgerSvc.PostReversal(ctx, userWallet.ID, tuitionAccount.ID, amountKobo,
			ledgerRef+"_reversal", idempotencyKey+"_reversal")
		if revErr != nil {
			return fmt.Errorf("%w (reversal also failed: %v)", cause, revErr)
		}
		return cause
	}

	// Ledger posting: record as commission for accounting.
	// Since this is pure tuition revenue (no split), grossKobo = recordedRevenueKobo.
	_, err = s.commissionSvc.RecordExact(ctx, "academy", "tuition", "installment",
		amountKobo, amountKobo, "tuition", ledgerRef, &userID, idempotencyKey)
	if err != nil {
		return nil, reverseDebit(fmt.Errorf("ledger posting failed: %w", err))
	}

	// Record payment with ledger reference. RecordPaymentWithReference is a
	// conditional UPDATE (WHERE status='pending') — Layer 2 idempotency: if this
	// exact payment was already marked paid by a prior attempt (Redis claim lost,
	// client retried), applied is false and we treat it as an idempotent replay
	// rather than re-debiting or reversing.
	paidAt := time.Now()
	applied, err := s.repo.RecordPaymentWithReference(ctx, nextPayment.ID, paidAt, ledgerRef)
	if err != nil {
		return nil, reverseDebit(fmt.Errorf("record payment failed: %w", err))
	}
	if !applied {
		existing, gErr := s.repo.GetPaymentByID(ctx, nextPayment.ID)
		if gErr != nil {
			return nil, reverseDebit(fmt.Errorf("record payment: already processed, refetch failed: %w", gErr))
		}
		if existing.Status != PaymentStatusPaid {
			// Genuinely raced with something else (e.g. a waiver) — not our replay to claim.
			return nil, reverseDebit(fmt.Errorf("record payment failed: payment no longer pending (status=%s)", existing.Status))
		}
		nextPayment = existing
	}

	// Check if plan is complete
	updatedPayments, err := s.repo.ListInstallmentPayments(ctx, plan.ID)
	if err != nil {
		// Don't fail the whole operation, but log it
		fmt.Printf("warning: couldn't reload payments for completion check: %v\n", err)
	}

	isCompleted := HasCompletePayment(updatedPayments)
	if isCompleted {
		err = s.repo.MarkPlanCompleted(ctx, plan.ID)
		if err != nil {
			fmt.Printf("warning: couldn't mark plan complete: %v\n", err)
		}
		// Audit: plan completion
		if s.auditor != nil {
			s.auditor.LogAction(userID, userID, actionPlanCompleted, auditModule,
				"academy_tuition_plan", plan.ID, map[string]any{"status": PlanStatusActive},
				map[string]any{"status": PlanStatusCompleted}, "", "", "info")
		}
	}

	// Find next payment (if any)
	var nextDueDate *time.Time
	for i := range updatedPayments {
		if updatedPayments[i].Status == PaymentStatusPending {
			nextDueDate = &updatedPayments[i].DueDate
			break
		}
	}

	// Audit: payment recorded
	if s.auditor != nil {
		s.auditor.LogAction(userID, userID, actionPaymentRecorded, auditModule,
			"academy_tuition_payment", nextPayment.ID,
			map[string]any{"status": PaymentStatusPending, "amount_ngn": nextPayment.AmountNGN},
			map[string]any{"status": PaymentStatusPaid, "amount_ngn": nextPayment.AmountNGN, "paid_at": paidAt},
			"", "", "info")
	}

	return &PaymentResult{
		PaymentID:       nextPayment.ID,
		PlanID:          plan.ID,
		ApplicationID:   appID,
		AmountPaidNGN:   amountNaira,
		LedgerReference: ledgerRef,
		PaidAt:          paidAt,
		NextDueDate:     nextDueDate,
		IsPlancompleted: isCompleted,
	}, nil
}

// GetTuitionStatus returns the full payment and plan status for an application.
// Used for enrollment gating and dashboard display.
func (s *Service) GetTuitionStatus(ctx context.Context, appID, userID string) (*TuitionStatus, error) {
	app, err := s.repo.GetApplication(ctx, appID)
	if err != nil {
		return nil, fmt.Errorf("fetch application: %w", err)
	}

	if app.UserID != userID {
		return nil, fmt.Errorf("tuition: user mismatch")
	}

	plan, err := s.repo.GetPlanByApplicationID(ctx, appID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, fmt.Errorf("fetch plan: %w", err)
	}

	status := &TuitionStatus{
		ApplicationID:   app.ID,
		UserID:          app.UserID,
		BatchID:         app.BatchID,
		TuitionTotalNGN: app.TuitionTotalNGN,
		PaymentStatus:   app.PaymentStatus,
		Plan:            plan,
	}

	// Fetch payments if plan exists
	if plan != nil {
		payments, err := s.repo.ListInstallmentPayments(ctx, plan.ID)
		if err != nil {
			return nil, fmt.Errorf("fetch payments: %w", err)
		}
		status.Payments = payments
		status.TotalPaidNGN = CalculateTotalPaidSoFar(payments)
		status.IsReadyForAccess = IsApplicationReadyForEnrollment(payments)
	}

	return status, nil
}

// ValidatePayment checks if a payment is valid (quote endpoint).
func (s *Service) ValidatePayment(ctx context.Context, appID, userID string, amountNaira int64) error {
	if amountNaira <= 0 {
		return ErrZeroPayment
	}

	app, err := s.repo.GetApplication(ctx, appID)
	if err != nil {
		return fmt.Errorf("fetch application: %w", err)
	}

	if app.UserID != userID {
		return fmt.Errorf("tuition: user mismatch")
	}

	plan, err := s.repo.GetPlanByApplicationID(ctx, appID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return fmt.Errorf("fetch plan: %w", err)
	}

	// If no plan yet, we can't validate specific amounts until the plan is created
	if plan == nil {
		// Just check the amount is positive and doesn't exceed batch fee
		batch, err := s.repo.GetBatch(ctx, app.BatchID)
		if err != nil {
			return fmt.Errorf("fetch batch: %w", err)
		}
		if amountNaira > batch.FeeNGN {
			return fmt.Errorf("tuition: payment exceeds batch fee")
		}
		return nil
	}

	// If plan exists, check amount matches next payment
	payments, err := s.repo.ListInstallmentPayments(ctx, plan.ID)
	if err != nil {
		return fmt.Errorf("fetch payments: %w", err)
	}

	for _, p := range payments {
		if p.Status == PaymentStatusPending {
			if amountNaira != p.AmountNGN {
				return fmt.Errorf("tuition: payment amount (%d) does not match next installment (%d)",
					amountNaira, p.AmountNGN)
			}
			return nil
		}
	}

	return fmt.Errorf("tuition: no pending payments")
}

// WaiveTuition marks a payment as waived (admin action).
func (s *Service) WaiveTuition(ctx context.Context, paymentID, actorUserID string) error {
	payment, err := s.repo.GetPaymentByID(ctx, paymentID)
	if err != nil {
		return fmt.Errorf("fetch payment: %w", err)
	}

	if IsTerminalStatus(payment.Status) {
		return fmt.Errorf("tuition: cannot waive payment with status %s", payment.Status)
	}

	err = s.repo.WaivePayment(ctx, paymentID)
	if err != nil {
		return fmt.Errorf("waive payment: %w", err)
	}

	// Check if plan is now complete
	plan, err := s.repo.GetInstallmentPlan(ctx, payment.InstallmentPlanID)
	if err != nil {
		return fmt.Errorf("fetch plan: %w", err)
	}

	payments, err := s.repo.ListInstallmentPayments(ctx, plan.ID)
	if err != nil {
		return fmt.Errorf("fetch payments: %w", err)
	}

	if HasCompletePayment(payments) {
		err = s.repo.MarkPlanCompleted(ctx, plan.ID)
		if err != nil {
			fmt.Printf("warning: couldn't mark plan complete after waiver: %v\n", err)
		}
	}

	// Audit
	if s.auditor != nil {
		s.auditor.LogAction(actorUserID, payment.UserID, actionPaymentWaived, auditModule,
			"academy_tuition_payment", paymentID,
			map[string]any{"status": payment.Status},
			map[string]any{"status": PaymentStatusWaived},
			"", "", "info")
	}

	return nil
}

// CreateTuitionPlan creates a new installment plan for an application.
// Called by approval trigger or manually during onboarding.
func (s *Service) CreateTuitionPlan(ctx context.Context, appID, userID string) (*InstallmentPlan, error) {
	app, err := s.repo.GetApplication(ctx, appID)
	if err != nil {
		return nil, fmt.Errorf("fetch application: %w", err)
	}

	if app.UserID != userID {
		return nil, fmt.Errorf("tuition: user mismatch")
	}

	batch, err := s.repo.GetBatch(ctx, app.BatchID)
	if err != nil {
		return nil, fmt.Errorf("fetch batch: %w", err)
	}

	// Check if plan already exists
	existingPlan, err := s.repo.GetPlanByApplicationID(ctx, appID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, fmt.Errorf("check existing plan: %w", err)
	}

	if existingPlan != nil {
		return existingPlan, nil // Return existing plan
	}

	// Create new plan (and its full payment schedule, atomically).
	planType := app.PaymentPreference
	if planType == "" {
		planType = "installment"
	}
	installments := batch.InstallmentsCount
	discountedAmount := batch.FeeNGN
	if planType == "one_off" {
		installments = 1
		discountedAmount = CalculateLumpSumDiscount(batch.FeeNGN, batch.DiscountPct)
	}
	plan, err := s.repo.CreateInstallmentPlan(ctx, appID, app.BatchID, batch.FeeNGN, discountedAmount,
		installments, batch.FeeFrequency, planType)
	if err != nil {
		return nil, fmt.Errorf("create plan: %w", err)
	}
	plan.UserID = userID

	// Audit
	if s.auditor != nil {
		s.auditor.LogAction(userID, userID, actionPlanCreated, auditModule,
			"academy_tuition_plan", plan.ID, nil,
			map[string]any{"total_ngn": plan.TotalAmountNGN, "installments": plan.InstallmentsCount},
			"", "", "info")
	}

	return plan, nil
}
