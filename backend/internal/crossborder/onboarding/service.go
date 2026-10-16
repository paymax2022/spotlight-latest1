package onboarding

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"spotlight/backend/internal/finance/tiers"
)

// ProviderName is the provider key stored on provider_accounts.
const ProviderName = "verto"

// MinActivationTier is the Spotlight KYC tier required to open a Global Account
// (spec D2). Anything lower, or any failure to read the tier, is refused.
const MinActivationTier = tiers.Tier2

// WalletCurrencies is the D4 currency set provisioned on approval.
var WalletCurrencies = []string{"USD", "EUR", "GBP", "NGN"}

var (
	// ErrTierTooLow: the user's KYC tier is below MinActivationTier.
	ErrTierTooLow = errors.New("onboarding: KYC tier too low for a global account")
	// ErrTierUnavailable: the tier could not be determined (fail closed).
	ErrTierUnavailable = errors.New("onboarding: cannot determine KYC tier")
	// ErrActivationConflict: the account collides with an existing record
	// (e.g. the same company is already registered to another user).
	ErrActivationConflict = errors.New("onboarding: a global account already exists for this identity")
	// ErrNoAccount: the user has no global account.
	ErrNoAccount = errors.New("onboarding: no global account")
	// ErrWrongState: the operation is not valid in the account's current status.
	ErrWrongState = errors.New("onboarding: operation not valid in current account status")
	// ErrDocumentsIncomplete: required documents are missing (see Deps.RequiredDocs).
	ErrDocumentsIncomplete = errors.New("onboarding: required documents missing")
	// ErrIncompleteAccount: a local account row exists without a provider company.
	ErrIncompleteAccount = errors.New("onboarding: account has no provider company")
)

// TierReader is the tier read seam, satisfied by *tiers.Service.
type TierReader interface {
	GetUserTier(ctx context.Context, userID string) (tiers.Tier, error)
}

// ProfileReader supplies the contact/company profile needed to (re)build the
// provider payload when documents are submitted after activation.
type ProfileReader interface {
	GetProfile(ctx context.Context, userID string) (Profile, error)
}

// Store is the persistence seam, satisfied by *Repository.
type Store interface {
	CreateAccount(ctx context.Context, a *GlobalAccount, idempotencyKey string, tier int) (*GlobalAccount, error)
	GetAccountByUser(ctx context.Context, userID, provider string) (*GlobalAccount, error)
	UpdateStatus(ctx context.Context, id string, from, to Status, u StatusUpdate) error
	UpsertWallet(ctx context.Context, w *ProviderWallet) (*ProviderWallet, error)
	UpsertFundingDetail(ctx context.Context, f *FundingDetail) (*FundingDetail, error)
	RecordSubmission(ctx context.Context, accountID string, version int, payloadRef string, documentsJSON []byte, result string) error
	RecordConsent(ctx context.Context, c *Consent) error
}

var _ Store = (*Repository)(nil)

// Deps wires the Service.
type Deps struct {
	Store    Store
	Accounts SubAccountProvider
	Wallets  WalletProvisioner
	KYC      KYCReader
	Tiers    TierReader
	Profiles ProfileReader
	Clock    Clock
	MinTier  tiers.Tier // defaults to MinActivationTier
	Currency []string   // defaults to WalletCurrencies
	// DocTypeID maps DocumentKind to the provider document-type id (config).
	DocTypeID map[DocumentKind]string
	// RiskAnswers are used when the payload is rebuilt in SubmitDocuments.
	RiskAnswers []RiskAnswer
	// RequiredDocs gates submission to the provider per subject type. Empty
	// (the default) means "submit as soon as the payload maps"; whether Verto
	// demands an identity document before review is a config decision, not a
	// guess baked in here. When set and unmet, Activate leaves the account
	// NOT_STARTED (awaiting documents) and SubmitDocuments finishes it.
	RequiredDocs map[SubjectType][]DocumentKind
}

// ActivateInput is the user-supplied activation data.
type ActivateInput struct {
	SubjectType SubjectType
	Profile     Profile
	Extras      ActivateExtras
}

// TnCAcceptance records the terms acceptance context.
type TnCAcceptance struct {
	Document string
	Version  string
	IP       string
	Device   string
}

// StatusView is the user-facing onboarding status.
type StatusView struct {
	Exists          bool
	Status          Status
	SubjectType     SubjectType
	RejectionReason string
	TnCRequired     bool
	SubmittedAt     *time.Time
	ApprovedAt      *time.Time
	TnCAcceptedAt   *time.Time
}

// Service orchestrates Global Account onboarding.
type Service struct {
	d     Deps
	locks keyedMutex
}

// NewService builds a Service, applying defaults.
func NewService(d Deps) *Service {
	if d.MinTier == 0 {
		d.MinTier = MinActivationTier
	}
	if len(d.Currency) == 0 {
		d.Currency = WalletCurrencies
	}
	return &Service{d: d}
}

// keyedMutex serialises work per string key within this process. Cross-process
// safety additionally relies on the DB's idempotent upserts / compare-and-set.
type keyedMutex struct{ m sync.Map }

func (k *keyedMutex) lock(key string) func() {
	v, _ := k.m.LoadOrStore(key, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// Activate opens (or returns the existing) Global Account. Tier >= 2 is
// required and fails closed. It is idempotent per user.
func (s *Service) Activate(ctx context.Context, userID string, in ActivateInput) (GlobalAccount, error) {
	tier, err := s.d.Tiers.GetUserTier(ctx, userID)
	if err != nil {
		return GlobalAccount{}, fmt.Errorf("%w: %v", ErrTierUnavailable, err)
	}
	if tier < s.d.MinTier {
		return GlobalAccount{}, ErrTierTooLow
	}
	defer s.locks.lock("user:" + userID)()

	existing, err := s.d.Store.GetAccountByUser(ctx, userID, ProviderName)
	if err != nil {
		return GlobalAccount{}, err
	}
	in.Profile.UserID = userID
	extras := s.extras(in.Extras)

	if existing != nil {
		if existing.Status != StatusNotStarted {
			return *existing, nil
		}
		if existing.ProviderCompanyID == "" {
			return *existing, ErrIncompleteAccount
		}
		// Resume an activation that stopped before submission.
		return s.submitIfReady(ctx, existing, in.SubjectType, in.Profile, extras, 1)
	}

	kyc, err := s.d.KYC.GetKYCView(ctx, userID)
	if err != nil {
		return GlobalAccount{}, fmt.Errorf("onboarding: read kyc: %w", err)
	}
	// Map first: a bad payload must not leave an orphan provider account.
	if _, err := BuildOnboardingData(in.SubjectType, in.Profile, kyc, extras); err != nil {
		return GlobalAccount{}, err
	}
	pa, err := s.d.Accounts.CreateSubAccount(ctx, subAccountInput(in, kyc, userID))
	if err != nil {
		return GlobalAccount{}, fmt.Errorf("onboarding: create sub-account: %w", err)
	}
	acct, err := s.d.Store.CreateAccount(ctx, &GlobalAccount{
		UserID:            userID,
		Provider:          ProviderName,
		SubjectType:       in.SubjectType,
		ProviderCompanyID: pa.CompanyID,
		Status:            StatusNotStarted,
	}, "activate:"+ProviderName+":"+userID, int(tier))
	if err != nil {
		// Crash window: the provider sub-account exists but is not recorded
		// locally. Provider-side dedupe on IdentificationNumber is unverified,
		// so log the CompanyID for manual reconciliation (carried to sandbox
		// verification / a later reconcile sweep).
		log.Printf("ERROR onboarding: orphaned provider sub-account (company_id=%s user_id=%s): local persist failed: %v",
			pa.CompanyID, userID, err)
		if errors.Is(err, ErrAccountConflict) {
			return GlobalAccount{}, ErrActivationConflict
		}
		return GlobalAccount{}, err
	}
	if acct.Status != StatusNotStarted {
		return *acct, nil
	}
	return s.submitIfReady(ctx, acct, in.SubjectType, in.Profile, extras, 1)
}

func subAccountInput(in ActivateInput, k KYCView, userID string) SubAccountInput {
	if in.SubjectType == SubjectBusiness && in.Profile.Business != nil {
		b := in.Profile.Business
		return SubAccountInput{Name: b.LegalName, Country: b.Country,
			IdentificationNumber: b.RegistrationNumber, SubjectType: in.SubjectType}
	}
	return SubAccountInput{Name: k.FirstName + " " + k.LastName, Country: k.Address.Country,
		IdentificationNumber: userID, SubjectType: in.SubjectType}
}

func (s *Service) extras(e ActivateExtras) ActivateExtras {
	if e.DocumentTypeIDs == nil {
		e.DocumentTypeIDs = s.d.DocTypeID
	}
	if e.RiskAnswers == nil {
		e.RiskAnswers = s.d.RiskAnswers
	}
	return e
}

func (s *Service) missingDocs(st SubjectType, docs []DocumentRef) []DocumentKind {
	have := map[DocumentKind]bool{}
	for _, d := range docs {
		have[d.Kind] = true
	}
	var missing []DocumentKind
	for _, k := range s.d.RequiredDocs[st] {
		if !have[k] {
			missing = append(missing, k)
		}
	}
	return missing
}

// submitIfReady submits the payload when the document gate is satisfied and
// moves NOT_STARTED -> SUBMITTED. Otherwise the account is returned unchanged
// (awaiting documents).
func (s *Service) submitIfReady(ctx context.Context, acct *GlobalAccount, st SubjectType, p Profile, ex ActivateExtras, version int) (GlobalAccount, error) {
	if len(s.missingDocs(st, ex.Documents)) > 0 {
		return *acct, nil
	}
	return s.submit(ctx, acct, st, p, ex, version)
}

func (s *Service) submit(ctx context.Context, acct *GlobalAccount, st SubjectType, p Profile, ex ActivateExtras, version int) (GlobalAccount, error) {
	kyc, err := s.d.KYC.GetKYCView(ctx, acct.UserID)
	if err != nil {
		return *acct, fmt.Errorf("onboarding: read kyc: %w", err)
	}
	payload, err := BuildOnboardingData(st, p, kyc, ex)
	if err != nil {
		return *acct, err
	}
	if err := s.d.Accounts.SubmitOnboarding(ctx, acct.ProviderCompanyID, payload); err != nil {
		return *acct, fmt.Errorf("onboarding: submit: %w", err)
	}
	now := s.d.Clock.Now()
	if err := s.d.Store.UpdateStatus(ctx, acct.ID, acct.Status, StatusSubmitted, StatusUpdate{SubmittedAt: &now}); err != nil {
		return *acct, err
	}
	docsJSON, _ := json.Marshal(ex.Documents)
	if err := s.d.Store.RecordSubmission(ctx, acct.ID, version, "", docsJSON, "submitted"); err != nil {
		return *acct, err
	}
	acct.Status, acct.SubmittedAt = StatusSubmitted, &now
	return *acct, nil
}

// SubmitDocuments supplies already-uploaded documents and (re)submits. Valid
// from NOT_STARTED (awaiting documents) and REJECTED (fix & resubmit).
func (s *Service) SubmitDocuments(ctx context.Context, userID string, docs []DocumentRef) error {
	defer s.locks.lock("user:" + userID)()
	acct, err := s.d.Store.GetAccountByUser(ctx, userID, ProviderName)
	if err != nil {
		return err
	}
	if acct == nil {
		return ErrNoAccount
	}
	if acct.Status != StatusNotStarted && acct.Status != StatusRejected {
		return fmt.Errorf("%w: %s", ErrWrongState, acct.Status)
	}
	if missing := s.missingDocs(acct.SubjectType, docs); len(missing) > 0 {
		return fmt.Errorf("%w: %v", ErrDocumentsIncomplete, missing)
	}
	if acct.ProviderCompanyID == "" {
		return ErrIncompleteAccount
	}
	prof, err := s.d.Profiles.GetProfile(ctx, userID)
	if err != nil {
		return fmt.Errorf("onboarding: read profile: %w", err)
	}
	prof.UserID = userID
	ex := s.extras(ActivateExtras{Documents: docs})
	version := 1
	if acct.Status == StatusRejected {
		version = int(s.d.Clock.Now().Unix()) // attempt id; version 1 is the initial submit
	}
	_, err = s.submit(ctx, acct, acct.SubjectType, prof, ex, version)
	return err
}

// AcceptTnC records consent and moves AWAITING_TNC -> ACTIVE, then provisions
// wallets. Idempotent for an already ACTIVE account (re-runs provisioning, so
// a wallet failure after activation can be retried by calling again).
func (s *Service) AcceptTnC(ctx context.Context, userID string, in TnCAcceptance) error {
	defer s.locks.lock("user:" + userID)()
	acct, err := s.d.Store.GetAccountByUser(ctx, userID, ProviderName)
	if err != nil {
		return err
	}
	if acct == nil {
		return ErrNoAccount
	}
	switch acct.Status {
	case StatusActive:
		return s.ensureWallets(ctx, acct)
	case StatusAwaitingTnC:
	default:
		return fmt.Errorf("%w: %s", ErrWrongState, acct.Status)
	}
	now := s.d.Clock.Now()
	if err := s.d.Store.RecordConsent(ctx, &Consent{AccountID: acct.ID, Document: in.Document,
		Version: in.Version, AcceptedAt: now, IP: in.IP, Device: in.Device}); err != nil {
		return err
	}
	u := StatusUpdate{TnCAcceptedAt: &now}
	if acct.ApprovedAt == nil {
		u.ApprovedAt = &now
	}
	if err := s.d.Store.UpdateStatus(ctx, acct.ID, StatusAwaitingTnC, StatusActive, u); err != nil {
		return err
	}
	acct.Status = StatusActive
	return s.ensureWallets(ctx, acct)
}

// GetStatus returns the user's onboarding status (NOT_STARTED view if none).
func (s *Service) GetStatus(ctx context.Context, userID string) (StatusView, error) {
	acct, err := s.d.Store.GetAccountByUser(ctx, userID, ProviderName)
	if err != nil {
		return StatusView{}, err
	}
	if acct == nil {
		return StatusView{Status: StatusNotStarted}, nil
	}
	return StatusView{
		Exists: true, Status: acct.Status, SubjectType: acct.SubjectType,
		RejectionReason: acct.RejectionReason, TnCRequired: acct.Status == StatusAwaitingTnC,
		SubmittedAt: acct.SubmittedAt, ApprovedAt: acct.ApprovedAt, TnCAcceptedAt: acct.TnCAcceptedAt,
	}, nil
}

// ensureWallets provisions every configured currency wallet and stores its
// funding details. Idempotent and serialised per provider company because
// the provider's EnsureWallet is check-then-create. A failure on one currency
// does not stop the others; errors are joined.
func (s *Service) ensureWallets(ctx context.Context, acct *GlobalAccount) error {
	if acct.ProviderCompanyID == "" {
		return ErrIncompleteAccount
	}
	defer s.locks.lock("company:" + acct.ProviderCompanyID)()
	var errs []error
	for _, cur := range s.d.Currency {
		ref, err := s.d.Wallets.EnsureWallet(ctx, acct.ProviderCompanyID, cur)
		if err != nil {
			errs = append(errs, fmt.Errorf("ensure %s wallet: %w", cur, err))
			continue
		}
		w, err := s.d.Store.UpsertWallet(ctx, &ProviderWallet{AccountID: acct.ID, Currency: cur, ProviderWalletID: ref.WalletID})
		if err != nil {
			errs = append(errs, fmt.Errorf("store %s wallet: %w", cur, err))
			continue
		}
		fi, err := s.d.Wallets.GetFundingDetails(ctx, acct.ProviderCompanyID, cur)
		if err != nil {
			errs = append(errs, fmt.Errorf("funding %s: %w", cur, err))
			continue
		}
		if _, err := s.d.Store.UpsertFundingDetail(ctx, &FundingDetail{WalletID: w.ID, Currency: cur,
			AccountName: fi.AccountName, AccountNumber: fi.AccountNumber, BankName: fi.BankName,
			BankCode: fi.BankCode, Reference: fi.Reference}); err != nil {
			errs = append(errs, fmt.Errorf("store %s funding: %w", cur, err))
		}
	}
	return errors.Join(errs...)
}
