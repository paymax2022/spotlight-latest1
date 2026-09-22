package tuition

// service.go is the Film Academy tuition payment money path.
//
// PAYMENT RAIL: tuition is paid by card via Paystack — NOT a Paymax wallet debit.
// This mirrors the existing product behavior (frontend-web/app/api/academy/installments/pay,
// now superseded by this package) rather than introducing a new payment method. The
// service's job on confirmation is: verify the charge with the gateway (fail-closed),
// then record it — a balanced ledger journal (provider_clearing → settlement, NO user
// wallet touched, matching ledger.Service.PostJournal's documented non-wallet-posting
// use case) plus the payment row. This is what closes the ledger gap: today's Next.js
// path verifies the charge and marks the row paid, but posts nothing to the ledger at all.
//
// Idempotency is guarded at TWO layers: a Redis key claim (fast path) plus a conditional
// UPDATE on the payment row itself (durable fallback — see RecordPaymentWithReference).
// Audit trail is via the Auditor interface (fire-and-forget, nil-safe).
// Domain amounts are whole NAIRA (int64), converted to kobo only at the ledger/provider
// seam (1 NGN = 100 kobo).

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/platform/redis"
	"spotlight/backend/internal/provider"
)

// ── Service-layer errors ────────────────────────────────────────────────────

var (
	ErrDuplicate            = errors.New("tuition: duplicate idempotency key")
	ErrZeroPayment          = errors.New("tuition: payment amount must be > 0")
	ErrInvalidPlanType      = errors.New("tuition: invalid plan type")
	ErrPlanNotFound         = errors.New("tuition: no active plan found")
	ErrApplicationNotFound  = errors.New("tuition: application not found")
	ErrBatchNotFound        = errors.New("tuition: batch not found")
	ErrInvalidPaymentAmount = errors.New("tuition: payment amount does not match plan")
	ErrForbidden            = errors.New("tuition: payment does not belong to this user")
	ErrPaymentNotConfirmed  = errors.New("tuition: payment not confirmed by provider")
	ErrReferenceReused      = errors.New("tuition: payment reference already used for a different installment")
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

// PaymentResult is the response from a successful payment confirmation.
type PaymentResult struct {
	PaymentID       string     `json:"paymentId"`
	PlanID          string     `json:"planId"`
	ApplicationID   string     `json:"applicationId"`
	AmountPaidNGN   int64      `json:"amountPaidNgn"`
	LedgerReference string     `json:"ledgerReference"`
	PaidAt          time.Time  `json:"paidAt"`
	NextDueDate     *time.Time `json:"nextDueDate,omitempty"`
	IsPlanCompleted bool       `json:"isPlanCompleted"`
}

// TuitionStatus is the query response for enrollment gating.
type TuitionStatus struct {
	ApplicationID    string                `json:"applicationId"`
	UserID           string                `json:"userId"`
	BatchID          string                `json:"batchId"`
	TuitionTotalNGN  int64                 `json:"tuitionTotalNgn"`
	PaymentStatus    string                `json:"paymentStatus"`
	Plan             *InstallmentPlan      `json:"plan,omitempty"`
	Payments         []InstallmentPayment  `json:"payments,omitempty"`
	TotalPaidNGN     int64                 `json:"totalPaidNgn"`
	IsReadyForAccess bool                  `json:"isReadyForAccess"`
}

// Service owns tuition payment logic.
type Service struct {
	repo            *Repository
	ledgerSvc       *ledger.Service
	paymentProvider provider.PaymentProvider
	redisClient     *redis.Client
	auditor         Auditor
}

// NewService constructs the service. redisClient and auditor are optional (nil-safe).
func NewService(repo *Repository, ledgerSvc *ledger.Service, paymentProvider provider.PaymentProvider,
	redisClient *redis.Client, auditor Auditor) *Service {
	return &Service{
		repo:            repo,
		ledgerSvc:       ledgerSvc,
		paymentProvider: paymentProvider,
		redisClient:     redisClient,
		auditor:         auditor,
	}
}

// ConfirmPayment verifies a Paystack charge for one installment and, once confirmed,
// records it: a balanced ledger journal (provider_clearing DR / settlement CR — no user
// wallet involved) plus the payment row itself. Mirrors (and replaces) the Next.js path
// at app/api/academy/installments/pay/route.ts.
//
// Steps:
//  1. Idempotency Layer 1 (redis key claim, if configured)
//  2. Fetch + ownership check (payment must belong to userID and to planID)
//  3. Already-paid guard (idempotent no-op, not an error — matches prior behavior)
//  4. Verify the reference with the payment gateway (fail-closed on any non-success)
//  5. Amount match (gateway-reported kobo >= expected kobo for this installment)
//  6. Reference-reuse guard (this exact reference must not already settle a DIFFERENT
//     installment — prevents a ₦100 charge's reference being replayed against a
//     ₦255,000 installment)
//  7. Post the ledger journal
//  8. Record the payment (Layer 2 idempotency: conditional UPDATE WHERE status='pending')
//  9. Plan-completion check + audit trail
//
// REVERSAL: if the ledger journal posts but recording the payment then fails, the
// journal is reversed (provider_clearing restored, settlement drained) rather than
// leaving revenue recognized for a payment that was never actually marked paid.
func (s *Service) ConfirmPayment(ctx context.Context, idempotencyKey, planID, paymentID, reference, userID string) (*PaymentResult, error) {
	if idempotencyKey == "" {
		return nil, fmt.Errorf("tuition: Idempotency-Key header is required")
	}
	if planID == "" || paymentID == "" || reference == "" {
		return nil, fmt.Errorf("tuition: planId, paymentId, and reference are required")
	}

	if s.redisClient != nil {
		idemKey := fmt.Sprintf("tuition:confirm:%s", idempotencyKey)
		claimed, err := redis.SetNX(ctx, s.redisClient, idemKey, "claimed", 24*time.Hour)
		if err != nil {
			return nil, fmt.Errorf("idempotency check failed: %w", err)
		}
		if !claimed {
			return nil, ErrDuplicate
		}
	}

	payment, err := s.repo.GetPaymentByID(ctx, paymentID)
	if err != nil {
		return nil, fmt.Errorf("fetch payment: %w", err)
	}
	if payment.InstallmentPlanID != planID {
		return nil, ErrNotFound
	}
	if payment.UserID != userID {
		return nil, ErrForbidden
	}

	// Already paid: idempotent no-op (matches the prior Next.js behavior exactly —
	// a retried confirm for an already-settled installment is not an error).
	if payment.Status == PaymentStatusPaid {
		return &PaymentResult{
			PaymentID:       payment.ID,
			PlanID:          planID,
			AmountPaidNGN:   payment.AmountNGN,
			LedgerReference: derefStr(payment.PaymentReference),
			PaidAt:          derefTime(payment.PaidAt),
		}, nil
	}
	if IsTerminalStatus(payment.Status) {
		// Waived — nothing left to confirm.
		return nil, fmt.Errorf("tuition: installment is %s, not payable", payment.Status)
	}

	status, err := s.paymentProvider.VerifyPayment(ctx, reference)
	if err != nil {
		return nil, fmt.Errorf("verify payment: %w", err)
	}
	if status == nil || strings.ToLower(status.Status) != "success" {
		return nil, ErrPaymentNotConfirmed
	}
	// Currency is populated when the adapter supports it (Paystack does). A charge
	// settled in anything but NGN must never be accepted against a NAIRA installment.
	if status.Currency != "" && !strings.EqualFold(status.Currency, "NGN") {
		return nil, ErrInvalidPaymentAmount
	}

	expectedKobo := payment.AmountNGN * 100
	if status.AmountKobo < expectedKobo {
		return nil, ErrInvalidPaymentAmount
	}

	reused, err := s.repo.IsPaymentReferenceUsed(ctx, reference, paymentID)
	if err != nil {
		return nil, fmt.Errorf("reference reuse check: %w", err)
	}
	if reused {
		return nil, ErrReferenceReused
	}

	providerClearing, err := s.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, fmt.Errorf("get provider clearing account: %w", err)
	}
	settlement, err := s.ledgerSvc.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, fmt.Errorf("get settlement account: %w", err)
	}

	ledgerRef := "academy_tuition:" + reference
	if err := s.ledgerSvc.PostJournal(ctx, ledger.JournalEntry{
		Reference:       ledgerRef,
		IdempotencyKey:  idempotencyKey,
		AmountKobo:      expectedKobo,
		DebitAccountID:  providerClearing.ID,
		CreditAccountID: settlement.ID,
	}); err != nil {
		if errors.Is(err, ledger.ErrDuplicate) {
			// Idempotent replay of a journal already posted by an earlier attempt at
			// this same idempotency key — proceed to (re)record the payment below.
		} else {
			return nil, fmt.Errorf("ledger posting failed: %w", err)
		}
	}

	reverseJournal := func(cause error) error {
		revErr := s.ledgerSvc.PostReversal(ctx, providerClearing.ID, settlement.ID, expectedKobo,
			ledgerRef+"_reversal", idempotencyKey+"_reversal")
		if revErr != nil {
			return fmt.Errorf("%w (reversal also failed: %v)", cause, revErr)
		}
		return cause
	}

	paidAt := time.Now()
	applied, err := s.repo.RecordPaymentWithReference(ctx, paymentID, paidAt, reference)
	if err != nil {
		return nil, reverseJournal(fmt.Errorf("record payment failed: %w", err))
	}
	if !applied {
		existing, gErr := s.repo.GetPaymentByID(ctx, paymentID)
		if gErr != nil {
			return nil, reverseJournal(fmt.Errorf("record payment: already processed, refetch failed: %w", gErr))
		}
		if existing.Status != PaymentStatusPaid {
			return nil, reverseJournal(fmt.Errorf("record payment failed: payment no longer pending (status=%s)", existing.Status))
		}
		payment = existing
	} else {
		payment.Status = PaymentStatusPaid
		payment.PaidAt = &paidAt
		payment.PaymentReference = &reference
	}

	// Plan completion check.
	plan, err := s.repo.GetInstallmentPlan(ctx, planID)
	if err != nil {
		return nil, fmt.Errorf("fetch plan: %w", err)
	}
	updatedPayments, err := s.repo.ListInstallmentPayments(ctx, planID)
	if err != nil {
		return nil, fmt.Errorf("fetch payments: %w", err)
	}
	isCompleted := HasCompletePayment(updatedPayments)
	if isCompleted && plan.Status != PlanStatusCompleted {
		if err := s.repo.MarkPlanCompleted(ctx, planID); err != nil {
			fmt.Printf("warning: couldn't mark plan complete: %v\n", err)
		}
		if s.auditor != nil {
			s.auditor.LogAction(userID, userID, actionPlanCompleted, auditModule,
				"academy_tuition_plan", planID, map[string]any{"status": PlanStatusActive},
				map[string]any{"status": PlanStatusCompleted}, "", "", "info")
		}
	}

	var nextDueDate *time.Time
	for i := range updatedPayments {
		if updatedPayments[i].Status == PaymentStatusPending {
			nextDueDate = &updatedPayments[i].DueDate
			break
		}
	}

	if s.auditor != nil {
		s.auditor.LogAction(userID, userID, actionPaymentRecorded, auditModule,
			"academy_tuition_payment", paymentID,
			map[string]any{"status": PaymentStatusPending},
			map[string]any{"status": PaymentStatusPaid, "amount_ngn": payment.AmountNGN, "reference": reference},
			"", "", "info")
	}

	return &PaymentResult{
		PaymentID:       paymentID,
		PlanID:          planID,
		ApplicationID:   plan.ApplicationID,
		AmountPaidNGN:   payment.AmountNGN,
		LedgerReference: ledgerRef,
		PaidAt:          paidAt,
		NextDueDate:     nextDueDate,
		IsPlanCompleted: isCompleted,
	}, nil
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

// GetTuitionStatus returns the full payment and plan status for an application.
// Used for enrollment gating and dashboard display.
func (s *Service) GetTuitionStatus(ctx context.Context, appID, userID string) (*TuitionStatus, error) {
	app, err := s.repo.GetApplication(ctx, appID)
	if err != nil {
		return nil, fmt.Errorf("fetch application: %w", err)
	}
	if app.UserID != userID {
		return nil, ErrForbidden
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

// ValidatePayment checks if a payment amount is valid (quote endpoint).
func (s *Service) ValidatePayment(ctx context.Context, appID, userID string, amountNaira int64) error {
	if amountNaira <= 0 {
		return ErrZeroPayment
	}

	app, err := s.repo.GetApplication(ctx, appID)
	if err != nil {
		return fmt.Errorf("fetch application: %w", err)
	}
	if app.UserID != userID {
		return ErrForbidden
	}

	plan, err := s.repo.GetPlanByApplicationID(ctx, appID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return fmt.Errorf("fetch plan: %w", err)
	}

	if plan == nil {
		batch, err := s.repo.GetBatch(ctx, app.BatchID)
		if err != nil {
			return fmt.Errorf("fetch batch: %w", err)
		}
		if amountNaira > batch.FeeNGN {
			return fmt.Errorf("tuition: payment exceeds batch fee")
		}
		return nil
	}

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

	if err := s.repo.WaivePayment(ctx, paymentID); err != nil {
		return fmt.Errorf("waive payment: %w", err)
	}

	plan, err := s.repo.GetInstallmentPlan(ctx, payment.InstallmentPlanID)
	if err != nil {
		return fmt.Errorf("fetch plan: %w", err)
	}
	payments, err := s.repo.ListInstallmentPayments(ctx, plan.ID)
	if err != nil {
		return fmt.Errorf("fetch payments: %w", err)
	}
	if HasCompletePayment(payments) {
		if err := s.repo.MarkPlanCompleted(ctx, plan.ID); err != nil {
			fmt.Printf("warning: couldn't mark plan complete after waiver: %v\n", err)
		}
	}

	if s.auditor != nil {
		s.auditor.LogAction(actorUserID, payment.UserID, actionPaymentWaived, auditModule,
			"academy_tuition_payment", paymentID,
			map[string]any{"status": payment.Status},
			map[string]any{"status": PaymentStatusWaived},
			"", "", "info")
	}
	return nil
}

// CreateTuitionPlan creates a new installment plan (and its full payment schedule) for
// an application. Called by the approval trigger, or manually by an admin.
func (s *Service) CreateTuitionPlan(ctx context.Context, appID, userID string) (*InstallmentPlan, error) {
	app, err := s.repo.GetApplication(ctx, appID)
	if err != nil {
		return nil, fmt.Errorf("fetch application: %w", err)
	}

	batch, err := s.repo.GetBatch(ctx, app.BatchID)
	if err != nil {
		return nil, fmt.Errorf("fetch batch: %w", err)
	}

	existingPlan, err := s.repo.GetPlanByApplicationID(ctx, appID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, fmt.Errorf("check existing plan: %w", err)
	}
	if existingPlan != nil {
		return existingPlan, nil
	}

	// The applicant's tuition is the sum of the priced interest areas they chose at
	// application time (TuitionTotalNGN). The batch's flat FeeNGN is the fallback for
	// batches that predate per-area pricing. Billing the batch fee to someone who
	// selected areas would charge them a figure they were never shown — see
	// autoCreateInstallmentPlan in frontend-web (the primary plan-creation path,
	// which this mirrors as a fallback for the rare case no plan exists yet).
	tuitionFee := app.TuitionTotalNGN
	if tuitionFee <= 0 {
		tuitionFee = batch.FeeNGN
	}
	if tuitionFee <= 0 {
		return nil, ErrZeroTuition // genuinely free batch — no plan to create
	}

	planType := app.PaymentPreference
	if planType != "one_off" {
		planType = "installment"
	}
	frequency, installments := NormalizePlanFrequency(planType, batch.FeeFrequency, batch.InstallmentsCount)
	discountPct := int32(0)
	if planType == "one_off" {
		discountPct = batch.DiscountPct
	}
	discountedAmount := CalculateLumpSumDiscount(tuitionFee, discountPct)

	plan, err := s.repo.CreateInstallmentPlan(ctx, appID, app.BatchID, tuitionFee, discountedAmount,
		installments, frequency, planType)
	if err != nil {
		return nil, fmt.Errorf("create plan: %w", err)
	}
	plan.UserID = app.UserID

	if s.auditor != nil {
		s.auditor.LogAction(userID, app.UserID, actionPlanCreated, auditModule,
			"academy_tuition_plan", plan.ID, nil,
			map[string]any{"total_ngn": plan.TotalAmountNGN, "installments": plan.InstallmentsCount},
			"", "", "info")
	}

	return plan, nil
}

// MarkPlanCompleted is an admin action to force-complete a plan (e.g. after manual
// reconciliation). Ordinary completion happens automatically once every installment
// is paid or waived — see ConfirmPayment/WaiveTuition.
func (s *Service) MarkPlanCompleted(ctx context.Context, planID, actorUserID string) error {
	plan, err := s.repo.GetInstallmentPlan(ctx, planID)
	if err != nil {
		return fmt.Errorf("fetch plan: %w", err)
	}
	if err := s.repo.MarkPlanCompleted(ctx, planID); err != nil {
		return fmt.Errorf("mark plan completed: %w", err)
	}
	if s.auditor != nil {
		s.auditor.LogAction(actorUserID, plan.UserID, actionPlanCompleted, auditModule,
			"academy_tuition_plan", planID, map[string]any{"status": plan.Status},
			map[string]any{"status": PlanStatusCompleted}, "", "", "info")
	}
	return nil
}
