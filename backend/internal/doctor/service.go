package doctor

import (
	"context"
	"errors"
	"fmt"

	goredis "github.com/redis/go-redis/v9"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/integrations/rtc"
	platformRedis "spotlight/backend/internal/platform/redis"
	platformWS "spotlight/backend/internal/platform/ws"
	"spotlight/backend/internal/finance/tiers"
)

// Service implements the doctor (provider) telemedicine MVP.
//
// Money path (RequestPayout) honours every iron rule:
//  1. requires + dedupes on an Idempotency-Key (Redis lock + DB UNIQUE replay),
//  2. tier-limit check (fail-closed: any error/denial rejects),
//  3. balanced double-entry post via ledger.Service.Debit (doctor wallet → settlement),
//  4. persists a doctor_payouts request row referencing the ledger (no balance column),
//  5. emits an immutable audit row,
//  6. returns the payout result.
type Service struct {
	repo   *Repository
	ledger *ledger.Service
	tiers  *tiers.Service
	redis  *goredis.Client    // optional; nil disables the fast idempotency lock
	rtc    *rtc.Issuer        // optional; nil/disabled → empty token + "not configured"
	hub    *platformWS.Hub    // optional; nil disables realtime WS push (best-effort)
}

// NewService wires the doctor service. redis may be nil (lock falls back to the
// DB UNIQUE(idempotency_key) constraint, exactly like ledger.Service does).
func NewService(db *pgxpool.Pool, ledgerSvc *ledger.Service, tiersSvc *tiers.Service, redis *goredis.Client) *Service {
	return &Service{repo: NewRepository(db), ledger: ledgerSvc, tiers: tiersSvc, redis: redis}
}

// WithRealtime attaches the RTC token Issuer and WebSocket Hub (Wave 6). Additive:
// both deps are optional — a nil Issuer yields empty tokens + a "not configured"
// flag, and a nil Hub disables realtime push (REST persistence is unaffected).
func (s *Service) WithRealtime(issuer *rtc.Issuer, hub *platformWS.Hub) *Service {
	s.rtc = issuer
	s.hub = hub
	return s
}

// Sentinel errors mapped to HTTP statuses by the handler.
var (
	ErrIdempotencyRequired = errors.New("doctor: Idempotency-Key header required")
	ErrInvalidAmount       = errors.New("doctor: amount must be a positive integer (kobo)")
	ErrDuplicateRequest    = errors.New("doctor: duplicate request (idempotency replay)")
)

// ── Reads ───────────────────────────────────────────────────────────────────

func (s *Service) GetProfile(ctx context.Context, userID string) (*Profile, error) {
	return s.repo.GetProfile(ctx, userID)
}

func (s *Service) GetVerification(ctx context.Context, userID string) (*Verification, error) {
	return s.repo.GetLatestVerification(ctx, userID)
}

func (s *Service) GetAvailability(ctx context.Context, userID string) (*Availability, error) {
	return s.repo.GetAvailability(ctx, userID)
}

func (s *Service) ListAppointments(ctx context.Context, userID, status string) ([]Appointment, error) {
	return s.repo.ListAppointments(ctx, userID, status)
}

func (s *Service) GetAppointment(ctx context.Context, userID, id string) (*Appointment, error) {
	return s.repo.GetAppointment(ctx, userID, id)
}

func (s *Service) ListNotes(ctx context.Context, userID, appointmentID string) ([]ClinicalNote, error) {
	return s.repo.ListNotes(ctx, userID, appointmentID)
}

func (s *Service) GetPatientRecord(ctx context.Context, userID, patientID string) (*PatientRecord, error) {
	return s.repo.GetPatientRecord(ctx, userID, patientID)
}

func (s *Service) ListPrescriptions(ctx context.Context, userID string) ([]Prescription, error) {
	return s.repo.ListPrescriptions(ctx, userID)
}

func (s *Service) GetPrescription(ctx context.Context, userID, id string) (*Prescription, error) {
	return s.repo.GetPrescription(ctx, userID, id)
}

func (s *Service) ListLabOrders(ctx context.Context, userID string) ([]LabOrder, error) {
	return s.repo.ListLabOrders(ctx, userID)
}

func (s *Service) GetLabResult(ctx context.Context, userID, orderID string) (*LabResult, error) {
	return s.repo.GetLabResultForOrder(ctx, userID, orderID)
}

func (s *Service) ListNotifications(ctx context.Context, userID string) ([]Notification, error) {
	return s.repo.ListNotifications(ctx, userID)
}

func (s *Service) GetSettings(ctx context.Context, userID string) (*Settings, error) {
	return s.repo.GetSettings(ctx, userID)
}

// GetEarnings PROJECTS earnings from the double-entry ledger — it never reads a
// stored balance. AvailableKobo is the doctor's current ledger wallet balance.
func (s *Service) GetEarnings(ctx context.Context, userID string) (*Earnings, error) {
	balance, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("doctor: project earnings from ledger: %w", err)
	}
	return &Earnings{
		AvailableKobo: balance,
		PendingKobo:   0,
		LifetimeKobo:  balance,
		Currency:      "NGN",
	}, nil
}

// ── Mutations (require Idempotency-Key) ─────────────────────────────────────

func (s *Service) SubmitVerification(ctx context.Context, userID string, req SubmitVerificationRequest) (*Verification, error) {
	return s.repo.InsertVerification(ctx, userID, req)
}

func (s *Service) UpdateAvailability(ctx context.Context, userID string, req UpdateAvailabilityRequest) (*Availability, error) {
	return s.repo.UpsertAvailability(ctx, userID, req)
}

func (s *Service) UpdateAppointmentStatus(ctx context.Context, userID, id string, req UpdateAppointmentStatusRequest) (*Appointment, error) {
	return s.repo.UpdateAppointmentStatus(ctx, userID, id, req.Status)
}

func (s *Service) SaveNote(ctx context.Context, userID, appointmentID, idemKey string, req SaveNoteRequest) (*ClinicalNote, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertNote(ctx, userID, appointmentID, idemKey, req)
}

func (s *Service) CreatePrescription(ctx context.Context, userID, idemKey string, req CreatePrescriptionRequest) (*Prescription, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertPrescription(ctx, userID, idemKey, req)
}

func (s *Service) CreateLabOrder(ctx context.Context, userID, idemKey string, req CreateLabOrderRequest) (*LabOrder, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.InsertLabOrder(ctx, userID, idemKey, req)
}

func (s *Service) ReviewLabResult(ctx context.Context, userID, resultID, idemKey string, req ReviewLabResultRequest) (*LabResult, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.ReviewLabResult(ctx, userID, resultID, idemKey, req)
}

func (s *Service) UpdateSettings(ctx context.Context, userID string, req UpdateSettingsRequest) (*Settings, error) {
	return s.repo.UpsertSettings(ctx, userID, req)
}

func (s *Service) MarkNotificationRead(ctx context.Context, userID, id string) error {
	return s.repo.MarkNotificationRead(ctx, userID, id)
}

// ── Money path ──────────────────────────────────────────────────────────────

// RequestPayout withdraws funds from the doctor's wallet to the settlement clearing
// account. Satisfies the six money requirements (see Service doc comment).
func (s *Service) RequestPayout(ctx context.Context, userID, idemKey string, req RequestPayoutRequest) (*RequestPayoutResult, error) {
	// (1) Idempotency-Key required.
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if req.AmountKobo <= 0 {
		return nil, ErrInvalidAmount
	}

	// (1) Dedupe — fast path: if a payout already exists for this key, replay it.
	if prior, err := s.repo.FindPayoutByIdem(ctx, userID, idemKey); err == nil {
		return &RequestPayoutResult{PayoutID: prior.ID, Ref: derefStr(prior.Ref), Status: prior.Status}, ErrDuplicateRequest
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	// (1) Redis lock guards against concurrent in-flight duplicates (best-effort;
	// the DB UNIQUE(idempotency_key) on doctor_payouts is the durable guarantee).
	if s.redis != nil {
		ok, _, lockErr := platformRedis.AcquireLock(ctx, s.redis, "doctor:payout:"+idemKey, 0)
		if lockErr == nil && !ok {
			return nil, ErrDuplicateRequest
		}
	}

	// (2) Tier-limit check — fail-closed: any error or denial rejects the payout.
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, req.AmountKobo); err != nil {
		return nil, fmt.Errorf("doctor: payout tier check (fail closed): %w", err)
	}

	// (3) Balanced double-entry: debit the doctor's wallet, credit the settlement
	//     clearing account. ledger.Debit posts both legs atomically (kobo int64),
	//     enforces positive amount, checks funds, and is itself idempotency-keyed.
	settlementAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return nil, fmt.Errorf("doctor: resolve settlement account: %w", err)
	}
	ledgerRef := "doctor:payout:" + idemKey
	if err := s.ledger.Debit(ctx, userID, ledgerRef, idemKey, settlementAcc.ID, req.AmountKobo); err != nil {
		// Insufficient funds / duplicate ledger key surface to the handler.
		return nil, err
	}

	// (4)+(5) Persist the payout REQUEST row AND its immutable audit row in ONE
	//     transaction. The audit is now DURABLE on the money path: if the audit
	//     insert fails it rolls back the payout row and returns an error, instead
	//     of the previous best-effort `_ = InsertAudit(...)` which silently
	//     swallowed audit failures. No balance column is written.
	payout, err := s.repo.InsertPayoutWithAudit(ctx, userID, idemKey, ledgerRef, req.AmountKobo, req.BankAccountID)
	if err != nil {
		return nil, fmt.Errorf("doctor: persist payout request + audit: %w", err)
	}

	// (6) Return the result.
	return &RequestPayoutResult{PayoutID: payout.ID, Ref: derefStr(payout.Ref), Status: payout.Status}, nil
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
