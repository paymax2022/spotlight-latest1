package maplerad

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/referrals"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/finance/va"
	"spotlight/backend/internal/provider"
)

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
// referral-reward purposes.
//
// CALIBRATION POINT (PRD §7.1 margin source): Maplerad bills in v1 post NO ledger
// hold and the domain computes NO explicit bill fee/commission/markup — the only
// fee schedule the module exposes is TransferFee (the banded money-movement fee).
// We reuse it here as the CLOSEST-AVAILABLE margin proxy so the referral share is
// non-zero and deterministic. This is a known over-/under-estimate: when a real
// per-bill margin (biller commission minus provider cost) is wired, replace this
// single function. Flagged for ledger-auditor.
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

// ── KYC-tier gate (fail-closed, BEFORE any adapter call) ─────────────────────

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

// ── EnsureCustomer ───────────────────────────────────────────────────────────

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
	// Fast path: already mapped.
	if existing, err := s.repo.GetCustomer(ctx, userID); err != nil {
		return nil, err
	} else if existing != nil {
		return existing, nil
	}
	// Gate BEFORE the adapter call.
	if err := s.requireTier(ctx, userID, RequiredTransferTier); err != nil {
		return nil, err
	}
	// Read the KYC-bearing identity from the store (BVN/NIN never logged).
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

// ── OpenVirtualAccount ───────────────────────────────────────────────────────

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
	s.audit(ctx, "maplerad.va.opened", userID, acct.AccountNumber, 0)
	return acct, nil
}

// ── InitiateTransfer ─────────────────────────────────────────────────────────

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

	// KYC-tier + daily-limit gate (fail-closed) BEFORE any adapter call.
	if err := s.requireTier(ctx, userID, RequiredTransferTier); err != nil {
		return nil, err
	}
	if err := s.tiers.EnforceWalletDebitLimit(ctx, userID, total); err != nil {
		return nil, err
	}
	// Derived balance must cover amount + fee.
	bal, err := s.ledger.GetBalance(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("maplerad: read balance: %w", err)
	}
	if bal < total {
		return nil, ledger.ErrInsufficientFunds
	}

	// Persist the ref at INITIATED BEFORE the call. Idempotent on the UNIQUE ref:
	// a duplicate returns the stored row and we short-circuit.
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

	// Resolve + register counterparty, then initiate the payout.
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

	// Advance INITIATED→PENDING through the guard; this posts the hold to the
	// ledger (DR user_wallet → CR suspense) keyed by ref.
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

// ── applyTransition (the guarded state machine → ledger bridge) ──────────────

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
		// nothing to post
	}

	// Persist the new state after the ledger effect succeeded.
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
			// RestoreAccount is credited back (+balance); ReleaseAccount drained.
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

// ── PurchaseBill ─────────────────────────────────────────────────────────────

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

// ── HandleWebhookEvent (dedupe + dispatch) ───────────────────────────────────

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

	// ── Direct Referral Rewards emit (PRD §2.5/§7.1) — POST-COMMIT, best-effort ──
	// The bill's terminal state is now committed. Only a SUCCESSFUL settlement is a
	// revenue-bearing purchase; a FAILED bill posts no reward. We emit SYNCHRONOUSLY
	// here (right after the settle commits) with MarginKobo from billMarginKobo (see
	// the calibration note on that function). The engine is idempotent on the bill
	// reference (TransactionID), so a redelivered webhook is safe; the error is
	// swallowed so the referral engine can never fail bill reconciliation.
	//
	// LEDGER-AUDITOR NOTE: (1) MarginKobo is a PROXY (billMarginKobo → TransferFee),
	// not a true per-bill platform margin — recalibrate when a real bill-margin field
	// exists. (2) Maplerad bills v1 have NO reversal/refund state (a settled bill is
	// terminal-once; there is no SUCCESS→REVERSED edge), so there is currently NO
	// OnPurchaseRefunded call-site for bills — add one here if/when a bill refund path
	// is introduced. (3) The PRD's "same-transaction reversal" ideal is APPROXIMATED
	// by this synchronous idempotent post-commit call (reward is a separate posting).
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

// ── Reconciliation + orphan sweep (jobs) ─────────────────────────────────────

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
