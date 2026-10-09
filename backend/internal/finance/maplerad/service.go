package maplerad

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/va"
	"spotlight/backend/internal/provider"
)

const keyUnauthenticated = "unauthenticated"

const keyError = "error"

// Service is the Maplerad WaaS DOMAIN service (ADR-012, NGN v1). It orchestrates
// the money path on top of:
//   - the pgx repository (provider_customers / provider_reference / webhook_event
//     / reconciliation_drift),
//   - the internal ledger (the immutable source of truth),
//   - the tiers gate (fail-closed KYC-tier + daily-limit checks),
//   - the va service (collections virtual-account provisioning),
//   - the provider GATEWAY PORTS only (Identity/Wallet/Bills/Disbursement/VA).
//
// INVARIANT: this service imports the `provider` ports package, NEVER the
// internal/provider/maplerad adapter. The adapter is injected as the port set.
type Service struct {
	pool   *pgxpool.Pool
	repo   *Repository
	ledger *ledger.Service
	tiers  *tiers.Service
	va     *va.Service

	// Gateway ports (the maplerad.Client satisfies all of these; injected as
	// interfaces so the domain never names a Maplerad type).
	identity     provider.IdentityProvider
	wallet       provider.WalletProvider
	bills        provider.BillsProvider
	disbursement provider.DisbursementProvider
	vaPort       provider.VirtualAccountProvider

	// referralEmitter is an OPTIONAL, nil-safe seam into the Direct Referral Rewards
	// engine (PRD §2.5/§7.1). Wired post-construction via WithReferralEmitter when
	// FEATURE_REFERRAL_REWARDS_ENABLED is on; nil otherwise, in which case every emit
	// is skipped and the bills money path is unchanged.
	referralEmitter ReferralEmitter
}

// ReferralEmitter is the local seam the Maplerad bills path uses to notify the
// Direct Referral Rewards engine. *referrals.RewardService satisfies it. Kept as an
// interface so the emit is nil-safe/testable; no import cycle (referrals never
// imports maplerad).
type ReferralEmitter interface {
	OnPurchaseSettled(ctx context.Context, in referrals.PurchaseSettled) error
	OnPurchaseRefunded(ctx context.Context, in referrals.PurchaseRefunded) error
}

// Deps bundles the Maplerad domain service dependencies. The five ports are
// usually one concrete *maplerad.Client passed five times (it satisfies all),
// but kept separate so each can be swapped/mocked.
type Deps struct {
	Pool         *pgxpool.Pool
	Ledger       *ledger.Service
	Tiers        *tiers.Service
	VA           *va.Service
	Identity     provider.IdentityProvider
	Wallet       provider.WalletProvider
	Bills        provider.BillsProvider
	Disbursement provider.DisbursementProvider
	VAPort       provider.VirtualAccountProvider
}

// NewService builds the Maplerad domain service.
func NewService(d Deps) *Service {
	return &Service{
		pool:         d.Pool,
		repo:         NewRepository(d.Pool),
		ledger:       d.Ledger,
		tiers:        d.Tiers,
		va:           d.VA,
		identity:     d.Identity,
		wallet:       d.Wallet,
		bills:        d.Bills,
		disbursement: d.Disbursement,
		vaPort:       d.VAPort,
	}
}

// WithReferralEmitter attaches the OPTIONAL Direct Referral Rewards emitter
// (PRD §2.5/§7.1). A nil emitter (flag off) is safe: the bill-settle emit guards
// `if s.referralEmitter != nil` and swallows the emitter's error, so the referral
// engine can never fail a bill purchase/settlement.
func (s *Service) WithReferralEmitter(e ReferralEmitter) *Service {
	s.referralEmitter = e
	return s
}

// billMarginKobo is the platform margin (kobo) attributed to a settled bill for
// referral-reward purposes. Maplerad bills in v1 post no ledger hold and carry
// no explicit margin, so the banded TransferFee is reused as the closest proxy
// (PRD §7.1). Replace with a true per-bill margin when one exists.
// Flagged for ledger-auditor.
func billMarginKobo(amountKobo int64) int64 {
	return TransferFee(amountKobo)
}

// gateConfigured fails closed if the identity/disbursement gateway is missing.
func (s *Service) gateConfigured() error {
	if s.identity == nil || s.disbursement == nil {
		return ErrProviderUnavailable
	}
	return nil
}

func (s *Service) requireTier(ctx context.Context, userID string, min tiers.Tier) error {
	t, err := s.tiers.GetUserTier(ctx, userID)
	if err != nil {
		// Fail closed — if we can't determine tier, block.
		return ErrTierTooLow
	}
	if t < min {
		return ErrTierTooLow
	}
	return nil
}

// EnsureCustomer maps a Paymax user to a Maplerad customer, idempotently. The
// KYC-tier gate runs BEFORE the adapter call; BVN/NIN are forwarded to Identity
// only and are NEVER logged.
func (s *Service) EnsureCustomer(ctx context.Context, userID string) (*CustomerRow, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	if s.identity == nil {
		return nil, ErrProviderUnavailable
	}
	if existing, err := s.repo.GetCustomer(ctx, userID); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}
	if err := s.requireTier(ctx, userID, RequiredTransferTier); err != nil {
		return nil, err
	}
	kr, err := s.loadKYC(ctx, userID)
	if err != nil {
		return nil, err
	}
	cust, err := s.identity.CreateCustomer(ctx, provider.CustomerRequest{
		UserID:    userID,
		FirstName: kr.FirstName,
		LastName:  kr.LastName,
		Email:     kr.Email,
		Phone:     kr.Phone,
		BVN:       kr.BVN,
		NIN:       kr.NIN,
		Country:   "NG",
	})
	if err != nil {
		return nil, fmt.Errorf("maplerad: create customer: %w", err)
	}
	row, err := s.repo.InsertCustomer(ctx, userID, cust.ID, cust.Status)
	if err != nil {
		return nil, err
	}
	s.audit(ctx, "maplerad.customer.ensured", userID, "", 0)
	return row, nil
}

// loadKYC reads the identity needed for customer creation. BVN/NIN plaintext are
// not retained in our store (only one-way hashes), so for sandbox/test they may
// be empty; names/email/phone come from user_profiles. This deliberately never
// logs the PII fields.
func (s *Service) loadKYC(ctx context.Context, userID string) (kycRecord, error) {
	const q = `
		SELECT COALESCE(split_part(full_name,' ',1),''),
		       COALESCE(split_part(full_name,' ',2),''),
		       COALESCE(email,''),
		       COALESCE(phone,'')
		FROM user_profiles WHERE id = $1`
	var kr kycRecord
	if err := s.pool.QueryRow(ctx, q, userID).Scan(&kr.FirstName, &kr.LastName, &kr.Email, &kr.Phone); err != nil {
		return kr, fmt.Errorf("maplerad: load identity: %w", err)
	}
	return kr, nil
}

// OpenVirtualAccount ensures the provider customer exists, gates on KYC tier,
// then provisions (idempotently) the collections virtual account via the shared
// va service with provider=maplerad.
func (s *Service) OpenVirtualAccount(ctx context.Context, userID string) (*va.VirtualAccount, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	if _, err := s.EnsureCustomer(ctx, userID); err != nil {
		return nil, err
	}
	// va.GetOrProvision re-checks the tier gate and is idempotent on
	// (user_id, provider, currency).
	acct, err := s.va.GetOrProvision(ctx, userID)
	if err != nil {
		if errors.Is(err, va.ErrTierTooLow) {
			return nil, ErrTierTooLow
		}
		if errors.Is(err, va.ErrProviderUnavailable) {
			return nil, ErrProviderUnavailable
		}
		return nil, err
	}
	s.audit(ctx, "maplerad.va.opened", userID, last4(acct.AccountNumber), 0)
	return acct, nil
}

// InitiateTransfer starts a bank payout via Maplerad. It is a MONEY path:
//  1. validate (DB-free) + KYC-tier + daily-limit gate (fail-closed),
//  2. require derived ledger balance >= amount + fee,
//  3. upsert provider_reference(ref,'transfer','INITIATED') BEFORE the call —
//     a retry with the same ref returns the stored record (idempotent),
//  4. resolve counterparty + InitiatePayout (DisbursementProvider) → PENDING,
//  5. post the PENDING hold to the ledger (DR user_wallet → CR suspense),
//  6. return PENDING (NEVER SUCCESS — terminal is webhook-driven).
func (s *Service) InitiateTransfer(ctx context.Context, userID string, req TransferRequest) (*TransferRecord, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	if err := s.gateConfigured(); err != nil {
		return nil, err
	}
	if err := req.validate(); err != nil {
		return nil, err
	}
	fee := TransferFee(req.AmountKobo)
	total := req.AmountKobo + fee

	if err := s.requireTier(ctx, userID, RequiredTransferTier); err != nil {
		return nil, err
	}
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, total); err != nil {
		return nil, err
	}
	bal, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("maplerad: read balance: %w", err)
	}
	if bal < total {
		return nil, ledger.ErrInsufficientFunds
	}

	row := RefRow{
		Ref:        req.Ref,
		OpType:     "transfer",
		UserID:     userID,
		AmountKobo: req.AmountKobo,
		Currency:   "NGN",
		Counterparty: map[string]string{
			"bank_code":            req.BankCode,
			"account_number_last4": last4(req.AccountNumber),
		},
	}
	stored, inserted, err := s.repo.InsertReference(ctx, row)
	if err != nil {
		return nil, err
	}
	if !inserted {
		// Object-level authz: a stored ref must belong to the caller.
		if stored.UserID != "" && stored.UserID != userID {
			return nil, ErrForbidden
		}
		return s.toTransferRecord(stored, fee), nil
	}

	recipientCode := req.AccountNumber
	if _, rerr := s.disbursement.ResolveAccount(ctx, req.BankCode, req.AccountNumber); rerr != nil {
		s.failTransfer(ctx, req.Ref, "account resolution failed")
		return nil, ErrInvalidAccount
	}
	if rec, cerr := s.disbursement.CreateTransferRecipient(ctx, provider.RecipientRequest{
		AccountNumber: req.AccountNumber,
		BankCode:      req.BankCode,
		Currency:      "NGN",
	}); cerr == nil && rec != nil && rec.Code != "" {
		recipientCode = rec.Code
	}

	payout, err := s.disbursement.InitiatePayout(ctx, provider.PayoutRequest{
		RecipientCode:  recipientCode,
		AmountKobo:     req.AmountKobo,
		Reference:      req.Ref,
		Narration:      req.Narration,
		IdempotencyKey: req.Ref,
	})
	if err != nil {
		// The provider rejected the move synchronously. Mark FAILED via the guard;
		// no hold was posted, so nothing to reverse.
		s.failTransfer(ctx, req.Ref, err.Error())
		return nil, fmt.Errorf("maplerad: initiate payout: %w", err)
	}
	providerRef := payout.ProviderRef
	if providerRef == "" {
		providerRef = payout.Reference
	}

	if err := s.applyTransition(ctx, req.Ref, StatusPending, providerRef); err != nil {
		return nil, err
	}
	s.audit(ctx, "maplerad.transfer.initiated", userID, req.Ref, req.AmountKobo)

	out, err := s.repo.GetByRef(ctx, req.Ref)
	if err != nil {
		return nil, err
	}
	return s.toTransferRecord(out, fee), nil
}

// failTransfer records a synchronous failure on a not-yet-PENDING ref. Because
// no hold was posted (we never reached PENDING), this is a direct status set —
// the guard rejects INITIATED→FAILED, so this is the documented exception for a
// pre-hold synchronous rejection. No ledger effect.
func (s *Service) failTransfer(ctx context.Context, ref, reason string) {
	if err := s.repo.SetStatus(ctx, ref, StatusFailed, "", reason); err != nil {
		log.Printf("maplerad: mark pre-hold failed ref=%s: %v", ref, err)
	}
}

// GetTransfer returns a transfer record, enforcing object-level authz.
func (s *Service) GetTransfer(ctx context.Context, userID, ref string) (*TransferRecord, error) {
	row, err := s.repo.GetByRef(ctx, ref)
	if err != nil {
		return nil, err
	}
	if row.UserID != "" && row.UserID != userID {
		return nil, ErrForbidden
	}
	return s.toTransferRecord(row, TransferFee(row.AmountKobo)), nil
}

func (s *Service) toTransferRecord(row *RefRow, fee int64) *TransferRecord {
	tr := &TransferRecord{
		Ref:           row.Ref,
		ProviderRef:   row.ProviderRef,
		Status:        row.Status,
		UserID:        row.UserID,
		AmountKobo:    row.AmountKobo,
		FeeKobo:       fee,
		Currency:      row.Currency,
		FailureReason: row.FailureReason,
	}
	if row.Counterparty != nil {
		tr.BankCode = row.Counterparty["bank_code"]
		tr.AccountLast4 = row.Counterparty["account_number_last4"]
	}
	return tr
}

// applyTransition is the single funnel for every transfer state change (sync
// initiate, webhook, orphan sweep). It:
//   - loads the current status,
//   - runs DecideTransition (pure guard); a NoOp replay is a benign success,
//     an illegal edge is ErrIllegalTransition,
//   - applies the LedgerEffect via the pure ledger plan (hold/finalize/
//     reverse/compensate), each leg keyed by ref so duplicate webhooks are
//     ledger-unique-constraint no-ops,
//   - then persists the new status (so a ledger failure leaves status unchanged
//     and the op is safely retried).
//
// Idempotent: a terminal replay (status already == target) is a no-op.
func (s *Service) applyTransition(ctx context.Context, ref string, target OpStatus, providerRef string) error {
	row, err := s.repo.GetByRef(ctx, ref)
	if err != nil {
		return err
	}
	if row.Status == target {
		return nil // idempotent terminal/intermediate replay
	}
	dec := DecideTransition(row.Status, target)
	if dec.NoOp {
		return nil
	}
	if !dec.Allowed {
		return ErrIllegalTransition
	}

	total := row.AmountKobo + TransferFee(row.AmountKobo)
	switch dec.Effect {
	case EffectHold:
		if err := s.applyLegs(ctx, row.UserID, ref, PlanHold(ref, total)); err != nil {
			return err
		}
	case EffectFinalize:
		if err := s.applyLegs(ctx, row.UserID, ref, PlanFinalize(ref, row.AmountKobo, TransferFee(row.AmountKobo))); err != nil {
			return err
		}
	case EffectReverseHold:
		if err := s.applyLegs(ctx, row.UserID, ref, PlanReverseHold(ref, total)); err != nil {
			return err
		}
	case EffectCompensate:
		if err := s.applyLegs(ctx, row.UserID, ref, PlanCompensate(ref, total)); err != nil {
			return err
		}
	case EffectNone:
	}

	if err := s.repo.SetStatus(ctx, ref, target, providerRef, ""); err != nil {
		return err
	}
	s.audit(ctx, "maplerad.transfer.transition", row.UserID, ref, row.AmountKobo)
	return nil
}

// applyLegs resolves each PlannedLeg's named accounts to ledger account IDs and
// posts via the matching ledger primitive. Duplicate keys are benign no-ops
// (ErrDuplicate is swallowed) so replays never double-post.
func (s *Service) applyLegs(ctx context.Context, userID, ref string, legs []PlannedLeg) error {
	for _, leg := range legs {
		switch leg.Kind {
		case LegJournal:
			debitID, err := s.resolveAccount(ctx, userID, leg.DebitAccount, leg.DebitIsUserWallet)
			if err != nil {
				return err
			}
			creditID, err := s.resolveAccount(ctx, userID, leg.CreditAccount, false)
			if err != nil {
				return err
			}
			err = s.ledger.PostJournal(ctx, ledger.JournalEntry{
				Reference:       ref,
				IdempotencyKey:  leg.IdempotencyKey,
				AmountKobo:      leg.AmountKobo,
				DebitAccountID:  debitID,
				CreditAccountID: creditID,
			})
			if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
				return fmt.Errorf("maplerad: post journal leg %s: %w", leg.IdempotencyKey, err)
			}
		case LegReversalPair:
			restoreID, err := s.resolveAccount(ctx, userID, leg.RestoreAccount, leg.RestoreIsUserWallet)
			if err != nil {
				return err
			}
			releaseID, err := s.resolveAccount(ctx, userID, leg.ReleaseAccount, false)
			if err != nil {
				return err
			}
			err = s.ledger.PostReversal(ctx, restoreID, releaseID, leg.AmountKobo, ref, leg.IdempotencyKey)
			if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
				return fmt.Errorf("maplerad: post reversal leg %s: %w", leg.IdempotencyKey, err)
			}
		}
	}
	return nil
}

func (s *Service) resolveAccount(ctx context.Context, userID string, at ledger.AccountType, isUserWallet bool) (string, error) {
	if isUserWallet {
		acc, err := s.ledger.GetOrCreateUserWallet(ctx, userID)
		if err != nil {
			return "", err
		}
		return acc.ID, nil
	}
	acc, err := s.ledger.GetOrCreateStandingAccount(ctx, at)
	if err != nil {
		return "", err
	}
	return acc.ID, nil
}

// PurchaseBill submits a bill purchase, idempotent on the client reference via a
// provider_reference op_type 'bill'. The sync return is PENDING; the bill webhook
// is authoritative for the terminal state.
func (s *Service) PurchaseBill(ctx context.Context, userID string, req provider.BillRequest) (*BillResult, error) {
	if userID == "" {
		return nil, ErrForbidden
	}
	if s.bills == nil {
		return nil, ErrProviderUnavailable
	}
	if req.Ref == "" {
		return nil, ErrMissingRef
	}
	if req.AmountKobo <= 0 {
		return nil, ErrInvalidAmount
	}
	if err := s.requireTier(ctx, userID, RequiredTransferTier); err != nil {
		return nil, err
	}
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, req.AmountKobo); err != nil {
		return nil, err
	}

	stored, inserted, err := s.repo.InsertReference(ctx, RefRow{
		Ref:        req.Ref,
		OpType:     "bill",
		UserID:     userID,
		AmountKobo: req.AmountKobo,
		Currency:   "NGN",
	})
	if err != nil {
		return nil, err
	}
	if !inserted {
		if stored.UserID != "" && stored.UserID != userID {
			return nil, ErrForbidden
		}
		return &BillResult{Ref: stored.Ref, ProviderRef: stored.ProviderRef, Type: req.Type, Status: stored.Status, AmountKobo: stored.AmountKobo}, nil
	}

	bill, err := s.bills.PurchaseBill(ctx, req)
	if err != nil {
		s.failTransfer(ctx, req.Ref, err.Error())
		return nil, fmt.Errorf("maplerad: purchase bill: %w", err)
	}
	// Move INITIATED→PENDING (no ledger hold for bills in v1; reconciliation via
	// the bill webhook resolves the terminal state).
	if err := s.repo.SetStatus(ctx, req.Ref, StatusPending, bill.ProviderRef, ""); err != nil {
		return nil, err
	}
	s.audit(ctx, "maplerad.bill.initiated", userID, req.Ref, req.AmountKobo)
	return &BillResult{Ref: req.Ref, ProviderRef: bill.ProviderRef, Type: bill.Type, Status: StatusPending, AmountKobo: req.AmountKobo}, nil
}

// HandleWebhookEvent is the settlement backbone: dedupe by event id, then
// dispatch. Exactly one delivery of a (provider, event_id) processes; every
// redelivery is a benign no-op. The ledger effect of each dispatch is itself
// idempotent (keyed by ref) so even a dedupe gap cannot double-post.
func (s *Service) HandleWebhookEvent(ctx context.Context, ev *provider.WebhookEvent) error {
	if ev == nil {
		return nil
	}
	eventID := ev.EventID
	if eventID == "" {
		// No event id surfaced — fall back to a deterministic key so we still
		// dedupe (provider ref + status). Never drop.
		eventID = ev.ProviderRef + ":" + ev.Status
	}
	inserted, err := s.repo.InsertWebhookEvent(ctx, eventID, ev.Type, ev.Raw)
	if err != nil {
		return err
	}
	if dec := DecideDedupe(boolToRows(inserted)); dec.AckNoOp {
		return nil // redelivery → ACK no-op
	}

	dispatchErr := s.dispatch(ctx, ev)

	status := "processed"
	if dispatchErr != nil {
		status = "failed"
	}
	if merr := s.repo.MarkWebhookProcessed(ctx, eventID, status); merr != nil {
		log.Printf("maplerad: mark webhook processed event=%s: %v", eventID, merr)
	}
	return dispatchErr
}

func boolToRows(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// dispatch routes a deduped webhook to its handler per the pure classification.
func (s *Service) dispatch(ctx context.Context, ev *provider.WebhookEvent) error {
	kind := classifyWebhook(ev)
	switch kind {
	case EventVACredit:
		return s.creditInbound(ctx, ev)
	case EventTransferSuccess:
		return s.transitionByProviderRef(ctx, ev, StatusSuccess)
	case EventTransferFailed:
		return s.transitionByProviderRef(ctx, ev, StatusFailed)
	case EventTransferReverse:
		return s.transitionByProviderRef(ctx, ev, StatusReversed)
	case EventBillResult:
		return s.resolveBill(ctx, ev)
	default:
		// Unknown — already stored in webhook_event; log + no-op (never dropped).
		log.Printf("maplerad: unknown webhook type=%q ref=%s — stored, no action", ev.Type, ev.ProviderRef)
		return nil
	}
}

// classifyWebhook maps the normalized provider.WebhookEvent onto an EventKind by
// reusing the pure ClassifyEvent vocabulary plus the adapter's Type/Status.
func classifyWebhook(ev *provider.WebhookEvent) EventKind {
	switch ev.Type {
	case "collection":
		return EventVACredit
	case "bill":
		return EventBillResult
	case "transfer":
		st, _ := NormalizeWebhookStatus(ev.Status)
		switch st {
		case StatusSuccess:
			return EventTransferSuccess
		case StatusFailed:
			return EventTransferFailed
		case StatusReversed:
			return EventTransferReverse
		}
	}
	return EventUnknown
}

// creditInbound posts an exactly-once ledger CREDIT for an inbound collection /
// VA credit, keyed by the event reference, then best-effort notifies.
func (s *Service) creditInbound(ctx context.Context, ev *provider.WebhookEvent) error {
	ref := ev.Reference
	if ref == "" {
		ref = ev.ProviderRef
	}
	err := s.va.CreditInbound(ctx, va.InboundTransfer{
		AccountNumber:  accountFromEvent(ev),
		AmountKobo:     ev.AmountKobo,
		Reference:      ref,
		IdempotencyKey: "maplerad:inbound:" + ref,
	})
	if err != nil && !errors.Is(err, ledger.ErrDuplicate) {
		return fmt.Errorf("maplerad: credit inbound: %w", err)
	}
	s.audit(ctx, "maplerad.collection.credited", "", ref, ev.AmountKobo)
	return nil
}

// accountFromEvent reads the destination VA account number from the raw event.
// The normalized WebhookEvent does not carry it, so we parse the raw payload
// (data.account_number / data.virtual_account.account_number). The va service
// then resolves the user by account number and credits keyed by the reference.
func accountFromEvent(ev *provider.WebhookEvent) string {
	if len(ev.Raw) > 0 {
		var env struct {
			Data struct {
				AccountNumber  string `json:"account_number"`
				VirtualAccount struct {
					AccountNumber string `json:"account_number"`
				} `json:"virtual_account"`
			} `json:"data"`
		}
		if json.Unmarshal(ev.Raw, &env) == nil {
			if env.Data.AccountNumber != "" {
				return env.Data.AccountNumber
			}
			if env.Data.VirtualAccount.AccountNumber != "" {
				return env.Data.VirtualAccount.AccountNumber
			}
		}
	}
	return ev.ProviderRef
}

// transitionByProviderRef routes a transfer webhook to its provider_reference by
// the provider ref (falling back to the echoed client ref) and drives the guard.
func (s *Service) transitionByProviderRef(ctx context.Context, ev *provider.WebhookEvent, target OpStatus) error {
	row, err := s.lookupTransferRow(ctx, ev)
	if err != nil {
		return err
	}
	return s.applyTransition(ctx, row.Ref, target, ev.ProviderRef)
}

func (s *Service) lookupTransferRow(ctx context.Context, ev *provider.WebhookEvent) (*RefRow, error) {
	if ev.ProviderRef != "" {
		if row, err := s.repo.GetByProviderRef(ctx, ev.ProviderRef); err == nil {
			return row, nil
		}
	}
	if ev.Reference != "" {
		return s.repo.GetByRef(ctx, ev.Reference)
	}
	return nil, ErrNotFound
}

// resolveBill reconciles a bill webhook with the stored provider_reference. v1
// records the terminal state on the ref (no separate ledger hold for bills).
func (s *Service) resolveBill(ctx context.Context, ev *provider.WebhookEvent) error {
	ref := ev.Reference
	if ref == "" {
		ref = ev.ProviderRef
	}
	row, err := s.repo.GetByRef(ctx, ref)
	if err != nil {
		return err
	}
	if row.Status.IsTerminal() {
		return nil // idempotent
	}
	target := StatusSuccess
	if st, ok := NormalizeWebhookStatus(ev.Status); ok {
		target = st
	}
	if !target.IsTerminal() {
		return nil // still pending
	}
	if err := s.repo.SetStatus(ctx, ref, target, ev.ProviderRef, ""); err != nil {
		return err
	}
	s.audit(ctx, "maplerad.bill.resolved", row.UserID, ref, row.AmountKobo)

	// Only a SUCCESSFUL settlement is a revenue-bearing purchase. Emit
	// synchronously post-commit (approximating the PRD's same-transaction
	// reversal ideal); the engine is idempotent on TransactionID and errors are
	// swallowed so rewards can never fail reconciliation. LEDGER-AUDITOR:
	// MarginKobo is a TransferFee proxy, and bills v1 have no reversal state, so
	// there is no OnPurchaseRefunded call-site — add one if refunds arrive.
	if target == StatusSuccess && row.UserID != "" {
		if s.referralEmitter != nil {
			if emErr := s.referralEmitter.OnPurchaseSettled(ctx, referrals.PurchaseSettled{
				Module:        "bills",
				TransactionID: ref,
				PayerUserID:   row.UserID,
				MarginKobo:    billMarginKobo(row.AmountKobo),
				Currency:      "NGN",
				SettledAt:     time.Now(),
			}); emErr != nil {
				log.Printf("[maplerad] referral OnPurchaseSettled bill ref=%s: %v (swallowed)", ref, emErr)
			}
		}
	}
	return nil
}

// ReconcileWallets compares each user's internal derived balance against the
// provider custody balance. Any drift is quarantined in reconciliation_drift +
// logged; balances are NEVER auto-corrected.
func (s *Service) ReconcileWallets(ctx context.Context) error {
	if s.wallet == nil {
		return ErrProviderUnavailable
	}
	customers, err := s.repo.ListCustomers(ctx, 0)
	if err != nil {
		return err
	}
	for _, c := range customers {
		internal, err := s.ledger.GetBalance(ctx, c.UserID)
		if err != nil {
			log.Printf("maplerad recon: read internal balance user=%s: %v", c.UserID, err)
			continue
		}
		// The provider wallet id maps to the provider customer in v1.
		pb, err := s.wallet.GetProviderBalance(ctx, c.CustomerID)
		if err != nil {
			log.Printf("maplerad recon: read provider balance customer=%s: %v", c.CustomerID, err)
			continue
		}
		dec := DetectDrift(internal, pb.AmountKobo)
		if dec.InSync {
			continue
		}
		if err := s.repo.InsertDrift(ctx, "wallet:"+c.UserID, c.UserID, internal, pb.AmountKobo, dec.DiffKobo,
			"automated reconciliation drift — quarantined for human review (never auto-corrected)"); err != nil {
			log.Printf("maplerad recon: quarantine drift user=%s: %v", c.UserID, err)
			continue
		}
		log.Printf("ALERT maplerad recon: DRIFT user=%s internal=%d provider=%d diff=%d", c.UserID, internal, pb.AmountKobo, dec.DiffKobo)
	}
	return nil
}

// SweepOrphans finds PENDING transfers with no terminal webhook past the TTL,
// re-queries the provider, and drives the guarded transition accordingly.
func (s *Service) SweepOrphans(ctx context.Context, ttl time.Duration) error {
	if s.disbursement == nil {
		return ErrProviderUnavailable
	}
	rows, err := s.repo.ListPendingOlderThan(ctx, ttl, 0)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if row.OpType != "transfer" || row.ProviderRef == "" {
			continue
		}
		st, err := s.disbursement.GetTransferStatus(ctx, row.ProviderRef)
		if err != nil {
			log.Printf("maplerad sweep: get transfer status ref=%s: %v", row.Ref, err)
			continue
		}
		target, known := NormalizeWebhookStatus(st.Status)
		if !known || !target.IsTerminal() {
			continue // still pending — leave it
		}
		if err := s.applyTransition(ctx, row.Ref, target, row.ProviderRef); err != nil {
			log.Printf("maplerad sweep: transition ref=%s → %s: %v", row.Ref, target, err)
		}
	}
	return nil
}

// audit emits a structured, log-style audit line (mirrors the transfers path).
// It never logs PII (BVN/NIN/full account numbers).
func (s *Service) audit(_ context.Context, event, userID, ref string, amountKobo int64) {
	log.Printf("audit maplerad event=%s user=%s ref=%s amount_kobo=%d", event, userID, ref, amountKobo)
}

// StartReconcile runs daily full reconciliation of internal derived balances vs
// Maplerad custody balances. Drift → quarantine + alert (never auto-correct).
func StartReconcile(ctx context.Context, svc *Service, interval time.Duration) {
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := svc.ReconcileWallets(ctx); err != nil {
					log.Printf("maplerad: reconcile job: %v", err)
				}
			}
		}
	}()
}

// StartOrphanSweep periodically finds PENDING transfers with no terminal webhook
// past the TTL and re-queries/transitions them. The TTL equals the sweep
// interval here (a PENDING op older than one interval is an orphan candidate).
func StartOrphanSweep(ctx context.Context, svc *Service, interval time.Duration) {
	if interval <= 0 {
		interval = time.Hour
	}
	ttl := interval
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := svc.SweepOrphans(ctx, ttl); err != nil {
					log.Printf("maplerad: orphan sweep job: %v", err)
				}
			}
		}
	}()
}

// Pure webhook-pipeline + reconciliation decision logic (no DB, no network).
// The handler/service apply these decisions; keeping them pure makes the
// dedupe rule, dispatch routing, and drift policy independently unit-testable.

// EventKind classifies a parsed Maplerad webhook into the v1 dispatch buckets.
type EventKind string

const (
	EventVACredit        EventKind = "va_credit"         // inbound collection → ledger CREDIT
	EventTransferSuccess EventKind = "transfer_success"  // → state machine SUCCESS
	EventTransferFailed  EventKind = "transfer_failed"   // → state machine FAILED
	EventTransferReverse EventKind = "transfer_reversed" // → state machine REVERSED
	EventBillResult      EventKind = "bill_result"       // → bill resolution
	EventUnknown         EventKind = "unknown"           // stored + logged, never dropped
)

// ClassifyEvent maps a raw provider event-type string to an EventKind. Unknown
// types resolve to EventUnknown (the handler stores + logs them, never crashes).
func ClassifyEvent(eventType string) EventKind {
	switch eventType {
	case "collection.successful", "collection.success", "virtual_account.credit", "transfer.received":
		return EventVACredit
	case "transfer.successful", "transfer.success", "payout.successful":
		return EventTransferSuccess
	case "transfer.failed", "payout.failed":
		return EventTransferFailed
	case "transfer.reversed", "payout.reversed", "transfer.refunded":
		return EventTransferReverse
	case "bill.successful", "bill.failed", "bill.result", "bill.completed":
		return EventBillResult
	default:
		return EventUnknown
	}
}

// DedupeDecision is the pure outcome of the dedupe step. The handler INSERTs
// into webhook_event ON CONFLICT DO NOTHING; rowsInserted reports whether this
// delivery was new (1) or a redelivery (0).
type DedupeDecision struct {
	// Process is true only for a first-seen event (rowsInserted == 1).
	Process bool
	// AckNoOp is true for a redelivery — ACK 200 with no ledger effect.
	AckNoOp bool
}

// DecideDedupe turns the INSERT … ON CONFLICT row count into a process/ack
// decision. Exactly one delivery of a given (provider,event_id) processes;
// every redelivery is a benign ACK no-op.
func DecideDedupe(rowsInserted int64) DedupeDecision {
	if rowsInserted >= 1 {
		return DedupeDecision{Process: true}
	}
	return DedupeDecision{AckNoOp: true}
}

// DriftDecision is the pure outcome of comparing an internal derived balance to
// the provider custody balance for one wallet.
type DriftDecision struct {
	// InSync is true when the two balances match (no drift, no alert).
	InSync bool
	// DiffKobo is provider − internal (signed). Quarantined as-is; never used to
	// auto-correct — resolution is always a human-reviewed compensating entry.
	DiffKobo int64
	// Quarantine is true when drift is detected and must be recorded + alerted.
	Quarantine bool
}

// DetectDrift compares internal (ledger-derived) vs provider (custody) balances.
// Equal → in sync, no alert. Any difference → quarantine + alert, NEVER an
// automatic correction. Pure + unit-tested.
func DetectDrift(internalKobo, providerKobo int64) DriftDecision {
	diff := providerKobo - internalKobo
	if diff == 0 {
		return DriftDecision{InSync: true}
	}
	return DriftDecision{DiffKobo: diff, Quarantine: true}
}

// LegKind tags how a planned leg is posted to the ledger so the service can
// dispatch to the right ledger primitive (balanced journal vs reversal pair).
type LegKind string

const (
	// LegJournal — a balanced DR/CR posted via ledger.PostJournal.
	LegJournal LegKind = "journal"
	// LegReversalPair — a REVERSAL_DEBIT/REVERSAL_CREDIT posted via ledger.PostReversal.
	// RestoreAccount is credited back (+balance); ReleaseAccount has its hold drained.
	LegReversalPair LegKind = "reversal"
)

// PlannedLeg is one ledger posting the money path must apply for a transition.
// It is a pure description — no DB. The service resolves the named standing/
// user accounts to IDs and calls the matching ledger primitive.
type PlannedLeg struct {
	Kind           LegKind
	AmountKobo     int64
	IdempotencyKey string
	// For LegJournal: debit + credit account types.
	DebitAccount  ledger.AccountType
	CreditAccount ledger.AccountType
	// For LegReversalPair: which account is restored vs drained.
	RestoreAccount ledger.AccountType
	ReleaseAccount ledger.AccountType
	// IsUserWallet flags that DebitAccount / RestoreAccount refers to the user's
	// wallet (resolved per-user) rather than a standing account.
	DebitIsUserWallet   bool
	RestoreIsUserWallet bool
}

// PlanHold returns the single leg for INITIATED→PENDING:
//
//	DR user_wallet (amount+fee) → CR failed_transfer_suspense
//
// This reserves the funds (the suspense hold). amountKobo MUST already include
// the fee — the caller computes total = amount + fee.
func PlanHold(ref string, totalKobo int64) []PlannedLeg {
	return []PlannedLeg{{
		Kind:              LegJournal,
		AmountKobo:        totalKobo,
		IdempotencyKey:    LegKey(ref, LegHold),
		DebitAccount:      ledger.AccountUserWallet,
		DebitIsUserWallet: true,
		CreditAccount:     ledger.AccountFailedTransferSusp,
	}}
}

// PlanFinalize returns the legs for PENDING→SUCCESS:
//
//	DR suspense(amount) → CR settlement                 (money has left the building)
//	DR suspense(fee)    → CR paymax_revenue   (fee recognition, only when fee > 0)
//
// The held total (amount+fee) is swept out of suspense exactly once, split
// between settlement and revenue. Each leg has a distinct idempotency key.
func PlanFinalize(ref string, amountKobo, feeKobo int64) []PlannedLeg {
	legs := []PlannedLeg{{
		Kind:           LegJournal,
		AmountKobo:     amountKobo,
		IdempotencyKey: LegKey(ref, LegSettle),
		DebitAccount:   ledger.AccountFailedTransferSusp,
		CreditAccount:  ledger.AccountSettlement,
	}}
	if feeKobo > 0 {
		legs = append(legs, PlannedLeg{
			Kind:           LegJournal,
			AmountKobo:     feeKobo,
			IdempotencyKey: LegKey(ref, LegFee),
			DebitAccount:   ledger.AccountFailedTransferSusp,
			CreditAccount:  ledger.AccountPaymaxRevenue,
		})
	}
	return legs
}

// PlanReverseHold returns the leg for PENDING→FAILED:
//
//	REVERSAL: restore user_wallet (+amount+fee), drain failed_transfer_suspense
//
// The full held total returns to the user. This is the exact inverse of PlanHold.
func PlanReverseHold(ref string, totalKobo int64) []PlannedLeg {
	return []PlannedLeg{{
		Kind:                LegReversalPair,
		AmountKobo:          totalKobo,
		IdempotencyKey:      LegKey(ref, LegReversal),
		RestoreAccount:      ledger.AccountUserWallet,
		RestoreIsUserWallet: true,
		ReleaseAccount:      ledger.AccountFailedTransferSusp,
	}}
}

// PlanCompensate returns the leg for PENDING→REVERSED (a debit that had already
// settled out is compensated): restore the user_wallet (+amount+fee) and drain
// the settlement account. Compensating entry, append-only — never a balance edit.
func PlanCompensate(ref string, totalKobo int64) []PlannedLeg {
	return []PlannedLeg{{
		Kind:                LegReversalPair,
		AmountKobo:          totalKobo,
		IdempotencyKey:      LegKey(ref, LegCompensate),
		RestoreAccount:      ledger.AccountUserWallet,
		RestoreIsUserWallet: true,
		ReleaseAccount:      ledger.AccountSettlement,
	}}
}

// NetEffectKobo computes the net change to a user's available wallet balance
// implied by a sequence of planned legs, for invariant testing. A hold debits
// the wallet (-total); a reverse-hold / compensate restores it (+total);
// finalize touches only standing accounts (0 wallet effect). Pure.
func NetEffectKobo(legs []PlannedLeg) int64 {
	var net int64
	for _, l := range legs {
		switch l.Kind {
		case LegJournal:
			if l.DebitIsUserWallet {
				net -= l.AmountKobo
			}
		case LegReversalPair:
			if l.RestoreIsUserWallet {
				net += l.AmountKobo
			}
		}
	}
	return net
}

// Handler exposes the member-facing Maplerad money-path endpoints. Every op
// derives the caller's user id from the auth context (set by RequireAuthContext /
// requireUserID) — never from the request body — enforcing object-level authz.
type Handler struct {
	svc *Service
}

// NewHandler builds the Maplerad member handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// errMap maps domain errors to HTTP status codes (model.go documents each).
var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusForbidden, ErrTierTooLow, ErrForbidden),
	httperr.R(http.StatusServiceUnavailable, ErrProviderUnavailable),
	httperr.R(http.StatusBadRequest, ErrMissingRef, ErrInvalidAmount),
	httperr.R(http.StatusUnprocessableEntity, ledger.ErrInsufficientFunds),
	httperr.R(http.StatusNotFound, ErrInvalidAccount, ErrNotFound),
	httperr.R(http.StatusConflict, ErrIllegalTransition),
)

func writeErr(c *gin.Context, err error) {
	body := gin.H{keyError: httperr.Msg(c, errMap.Code(err), err)}
	switch {
	case errors.Is(err, ErrTierTooLow):
		body["code"] = "tier_required"
	case errors.Is(err, ledger.ErrInsufficientFunds):
		body["code"] = "insufficient_funds"
	}
	c.JSON(errMap.Code(err), body)
}

// CreateCustomer handles POST /api/finance/maplerad/customer
func (h *Handler) CreateCustomer(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	cust, err := h.svc.EnsureCustomer(c.Request.Context(), userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"customer_id": cust.CustomerID, "status": cust.Status})
}

// OpenVirtualAccount handles POST /api/finance/maplerad/virtual-account
func (h *Handler) OpenVirtualAccount(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	acct, err := h.svc.OpenVirtualAccount(c.Request.Context(), userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, acct)
}

// transferRequestBody is the JSON shape for POST /transfers.
type transferRequestBody struct {
	BankCode      string `json:"bank_code"`
	AccountNumber string `json:"account_number"`
	AmountKobo    int64  `json:"amount_kobo"`
	Narration     string `json:"narration"`
	Ref           string `json:"ref"`
}

// InitiateTransfer handles POST /api/finance/maplerad/transfers. The
// Idempotency-Key header is the client reference (ref); a body ref is a
// fallback. The ref is the ledger posting key + provider_reference id.
func (h *Handler) InitiateTransfer(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var body transferRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid request body"})
		return
	}
	ref := body.Ref
	if k := ginutil.IdempotencyKey(c); k != "" {
		ref = k
	}
	rec, err := h.svc.InitiateTransfer(c.Request.Context(), userID, TransferRequest{
		BankCode:      body.BankCode,
		AccountNumber: body.AccountNumber,
		AmountKobo:    body.AmountKobo,
		Narration:     body.Narration,
		Ref:           ref,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, rec) // 202: PENDING, terminal via webhook
}

// GetTransfer handles GET /api/finance/maplerad/transfers/:ref
func (h *Handler) GetTransfer(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	rec, err := h.svc.GetTransfer(c.Request.Context(), userID, c.Param("ref"))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, rec)
}

// billRequestBody is the JSON shape for POST /bills.
type billRequestBody struct {
	Ref        string            `json:"ref"`
	Type       string            `json:"type"`
	AmountKobo int64             `json:"amount_kobo"`
	Params     map[string]string `json:"params"`
}

// PurchaseBill handles POST /api/finance/maplerad/bills
func (h *Handler) PurchaseBill(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: keyUnauthenticated})
		return
	}
	var body billRequestBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid request body"})
		return
	}
	ref := body.Ref
	if k := ginutil.IdempotencyKey(c); k != "" {
		ref = k
	}
	res, err := h.svc.PurchaseBill(c.Request.Context(), userID, provider.BillRequest{
		Ref:        ref,
		Type:       body.Type,
		AmountKobo: body.AmountKobo,
		Params:     body.Params,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, res)
}
