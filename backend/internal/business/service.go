package business

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"spotlight/backend/internal/finance/ledger"
	"spotlight/backend/internal/finance/wallet"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/provider/cac"
)

// DefaultRegistrationFeeKobo is the CAC business-registration fee charged to the
// user's wallet on PayRegistrationFee. Integer kobo (₦15,000). Overridable per
// Service via Deps.FeeKobo (e.g. a settings row) without touching the money path.
const DefaultRegistrationFeeKobo int64 = 1_500_000

// DefaultPlatformFeeKobo is the Paymax/Spotlight processing charge levied on top of
// the CAC registration fee. Integer kobo (₦2,000). The CAC fee is a pass-through to
// the registry (credited to provider_clearing); the platform fee is Paymax revenue
// (credited to paymax_revenue). Total charged = registration fee + platform fee.
const DefaultPlatformFeeKobo int64 = 200_000

// Sentinel errors map to HTTP statuses in the handler.
var (
	ErrConflict          = errors.New("business: illegal state transition")        // 409
	ErrDuplicate         = errors.New("business: business already exists")         // 409
	ErrForbidden         = errors.New("business: not the owner")                   // 403
	ErrValidation        = errors.New("business: validation failed")               // 422
	ErrMissingIdemKey    = errors.New("business: Idempotency-Key header required") // 400
	ErrFeeNotPaid        = errors.New("business: registration fee not paid")       // 409
	ErrProvider          = errors.New("business: registry provider error")         // 502
	ErrInsufficientFunds = errors.New("business: insufficient wallet balance")     // 402
	ErrCertNotReady      = errors.New("business: certificate not available yet")   // 404
)

// Deps injects the collaborators. Ledger resolves the revenue standing account;
// Wallet performs the tier-checked, idempotent fee debit; Provider is the CAC port.
type Deps struct {
	Repo     *Repository
	Ledger   *ledger.Service
	Wallet   *wallet.Service
	Provider cac.BusinessRegistryProvider
	// Payment is the payment gateway (Paystack) used for the gateway-funded fee
	// alternative to the wallet debit. Optional — when nil, only wallet pay works.
	Payment provider.PaymentProvider
	FeeKobo int64
	// PlatformFeeKobo is the Paymax processing charge added on top of the CAC fee.
	// Zero falls back to DefaultPlatformFeeKobo.
	PlatformFeeKobo int64
}

// Service holds the business-registry domain logic. It depends on the CAC provider
// ONLY through the cac.BusinessRegistryProvider port — no HTTP/DTO detail leaks in.
type Service struct {
	repo            *Repository
	ledger          *ledger.Service
	wallet          *wallet.Service
	provider        cac.BusinessRegistryProvider
	payment         provider.PaymentProvider
	feeKobo         int64
	platformFeeKobo int64
}

func NewService(d Deps) *Service {
	fee := d.FeeKobo
	if fee <= 0 {
		fee = DefaultRegistrationFeeKobo
	}
	// Zero (unset) falls back to the default; callers wanting a genuinely free
	// registration can set a negative sentinel is not supported — 0 means default.
	platformFee := d.PlatformFeeKobo
	if platformFee <= 0 {
		platformFee = DefaultPlatformFeeKobo
	}
	return &Service{repo: d.Repo, ledger: d.Ledger, wallet: d.Wallet, provider: d.Provider, payment: d.Payment, feeKobo: fee, platformFeeKobo: platformFee}
}

// totalFeeKobo is the full amount charged to the user: CAC registration fee (a
// pass-through to the registry) plus the Paymax platform processing fee.
func (s *Service) totalFeeKobo() int64 { return s.feeKobo + s.platformFeeKobo }

// ── Register-new flow ─────────────────────────────────────────────────────────

// StartRegisterNew opens a new register_new draft with the supplied details +
// proprietors. Proprietor raw BVN/NIN are NEVER persisted — only a masked tail.
func (s *Service) StartRegisterNew(ctx context.Context, userID string, req RegisterNewRequest) (*BusinessProfile, error) {
	if strings.TrimSpace(req.ProposedName) == "" || req.EntityType == "" {
		return nil, ErrValidation
	}
	meta := map[string]any{}
	if req.Address != "" {
		meta["address"] = req.Address
	}
	if req.Objects != "" {
		meta["objects"] = req.Objects
	}
	if len(req.DocumentRefs) > 0 {
		meta["documentRefs"] = req.DocumentRefs
	}
	id, err := s.repo.InsertProfile(ctx, userID, req.EntityType, ModeRegisterNew, req.ProposedName, "", req.LineOfBusiness, StatusDraft, meta)
	if err != nil {
		return nil, err
	}
	// Persist proprietors with masked identity tails only.
	props := make([]Proprietor, 0, len(req.Proprietors))
	for _, p := range req.Proprietors {
		props = append(props, Proprietor{
			FullName:  p.FullName,
			Role:      p.Role,
			BVNMasked: maskTail(p.BVN),
			NINMasked: maskTail(p.NIN),
			SharePct:  p.SharePct,
			Phone:     p.Phone,
			Email:     p.Email,
		})
	}
	if err := s.repo.InsertProprietors(ctx, id, props); err != nil {
		return nil, err
	}
	return s.repo.GetProfile(ctx, id)
}

// CheckName runs a CAC availability search. When a BusinessID owned by the caller is
// provided, the profile transitions draft/name_check → name_check and records the
// result. Otherwise it is a stateless availability preview.
func (s *Service) CheckName(ctx context.Context, userID string, req NameCheckRequest) (*NameCheckResult, error) {
	if strings.TrimSpace(req.ProposedName) == "" {
		return nil, ErrValidation
	}
	av, err := s.provider.CheckNameAvailability(ctx, req.ProposedName, req.LineOfBusiness)
	if err != nil {
		return nil, wrapProvider(err)
	}
	res := &NameCheckResult{
		Available:   av.Available,
		Status:      av.Status,
		Reason:      av.Reason,
		Suggestions: av.Suggestions,
	}
	if strings.TrimSpace(req.BusinessID) == "" {
		return res, nil
	}
	// Stateful path: attach to an owned register_new draft.
	prof, err := s.ownedProfile(ctx, userID, req.BusinessID)
	if err != nil {
		return nil, err
	}
	setters := map[string]any{
		"proposed_name": req.ProposedName,
		"metadata":      mergeMetaJSON(prof.Metadata, "nameCheck", map[string]any{"status": av.Status, "available": av.Available}),
	}
	// metadata is a jsonb column — pass encoded bytes, not a Go map.
	setters["metadata"] = mustJSON(setters["metadata"])
	if req.LineOfBusiness != "" {
		setters["line_of_business"] = req.LineOfBusiness
	}
	if err := s.repo.transition(ctx, prof.ID, StatusNameCheck, []Status{StatusDraft, StatusNameCheck}, userID, "name.checked", map[string]any{"status": av.Status}, setters); err != nil {
		return nil, err
	}
	res.Business, err = s.repo.GetProfile(ctx, prof.ID)
	return res, err
}

// ReserveName reserves the profile's proposed name with CAC (name_check → name_reserved).
func (s *Service) ReserveName(ctx context.Context, userID, email, phone, businessID string) (*BusinessProfile, error) {
	prof, err := s.ownedProfile(ctx, userID, businessID)
	if err != nil {
		return nil, err
	}
	if prof.ProposedName == "" {
		return nil, ErrValidation
	}
	// Idempotent / resume-safe: if this profile already holds a reservation ref it is
	// at (or beyond) name_reserved — the name is already reserved, so return it as-is
	// instead of attempting an illegal re-transition (409). Covers retries and resuming
	// a business left in name_reserved / registration_submitted / under_review from an
	// earlier attempt.
	if prof.CACReservationRef != "" {
		return prof, nil
	}
	// A terminal profile (rejected/failed) cannot be reserved — surface clearly.
	if IsTerminal(prof.Status) {
		return nil, ErrConflict
	}
	rsv, err := s.provider.ReserveName(ctx, prof.ProposedName, cac.Applicant{
		FullName: prof.LegalName, Email: email, Phone: phone,
	})
	if err != nil {
		return nil, wrapProvider(err)
	}
	setters := map[string]any{
		"cac_reservation_ref": rsv.Ref,
		"verification_source": s.provider.Name(),
	}
	// Reserve is valid from draft OR name_check: clients may call reserve directly after
	// creating the draft (they don't have to run the id-scoped name-check first), and a
	// reservation inherently confirms the name. Both source states move → name_reserved.
	if err := s.repo.transition(ctx, prof.ID, StatusNameReserved, []Status{StatusDraft, StatusNameCheck}, userID, "name.reserved",
		map[string]any{"ref": rsv.Ref, "expiresAt": rsv.ExpiresAt}, setters); err != nil {
		return nil, err
	}
	return s.repo.GetProfile(ctx, prof.ID)
}

// PayRegistrationFee performs the tier-checked, idempotent wallet debit for the CAC
// registration fee: DR user_wallet → CR paymax_revenue. Requires an Idempotency-Key.
// Fee-first: the profile must be name_reserved and the fee must be unpaid (a replay
// with the same key is a safe no-op). Status is unchanged (fee gates submit).
func (s *Service) PayRegistrationFee(ctx context.Context, userID, businessID, idemKey string) (*BusinessProfile, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, ErrMissingIdemKey
	}
	prof, err := s.ownedProfile(ctx, userID, businessID)
	if err != nil {
		return nil, err
	}
	// Idempotent: already paid → return current state.
	if prof.FeeLedgerRef != "" {
		return prof, nil
	}
	if prof.Status != StatusNameReserved {
		return nil, ErrConflict
	}
	total := s.totalFeeKobo()
	// Affordability pre-check: the charge is posted as two balanced legs (CAC
	// pass-through + platform fee); verify the wallet covers the TOTAL first so we
	// never leave the user charged for one leg but not the other.
	bal, err := s.wallet.GetBalance(ctx, userID)
	if err != nil {
		return nil, err
	}
	if bal.BalanceKobo < total {
		return nil, ErrInsufficientFunds
	}
	// CR sides: the CAC registration fee is a pass-through to the registry, so it
	// lands in provider_clearing; the platform fee is Paymax revenue.
	clearingAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return nil, err
	}
	revAcc, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return nil, err
	}
	// Leg 1 — CAC registration fee (pass-through). The wallet service applies the
	// tier-limit check (fail-closed) then posts the balanced double-entry.
	cacRef := "cac_registration_fee:" + prof.ID
	if err := s.wallet.Debit(ctx, userID, cacRef, idemKey, clearingAcc.ID, s.feeKobo); err != nil {
		switch {
		case errors.Is(err, ledger.ErrDuplicate):
			// Already posted under this key — fall through to the platform leg.
		case errors.Is(err, ledger.ErrInsufficientFunds):
			return nil, ErrInsufficientFunds
		default:
			return nil, err
		}
	}
	// Leg 2 — Paymax platform processing fee (revenue). Distinct idempotency key so
	// each leg dedupes independently on replay.
	if s.platformFeeKobo > 0 {
		platRef := "cac_platform_fee:" + prof.ID
		if err := s.wallet.Debit(ctx, userID, platRef, idemKey+":platform", revAcc.ID, s.platformFeeKobo); err != nil {
			switch {
			case errors.Is(err, ledger.ErrDuplicate):
				// Already posted — safe.
			case errors.Is(err, ledger.ErrInsufficientFunds):
				return nil, ErrInsufficientFunds
			default:
				return nil, err
			}
		}
	}
	setters := map[string]any{
		"fee_kobo":       s.feeKobo,
		"fee_ledger_ref": idemKey,
		"metadata": mustJSON(mergeMetaJSON(prof.Metadata, "feeBreakdown", map[string]any{
			"registrationFeeKobo": s.feeKobo,
			"platformFeeKobo":     s.platformFeeKobo,
			"totalKobo":           total,
			"source":              "wallet",
		})),
	}
	if err := s.repo.updateFields(ctx, prof.ID, userID, "fee.paid", map[string]any{"feeKobo": s.feeKobo, "platformFeeKobo": s.platformFeeKobo, "totalKobo": total, "reference": cacRef}, setters); err != nil {
		return nil, err
	}
	return s.repo.GetProfile(ctx, prof.ID)
}

// InitiateRegistrationFeePaystack starts a Paystack checkout for the CAC registration
// fee — the payment-gateway alternative to the wallet debit. It does NOT mutate the
// wallet/ledger; the fee is only marked paid on a verified callback (fee-first, same
// as the wallet path). The generated reference is stashed in metadata so the verify
// step can resolve the profile. Idempotent-ish: if the fee is already paid it returns
// the existing reference and no new checkout is created.
func (s *Service) InitiateRegistrationFeePaystack(ctx context.Context, userID, businessID, email, callbackURL string) (*PaystackInit, error) {
	if s.payment == nil {
		return nil, ErrProvider
	}
	if strings.TrimSpace(email) == "" {
		return nil, ErrValidation
	}
	prof, err := s.ownedProfile(ctx, userID, businessID)
	if err != nil {
		return nil, err
	}
	// Already paid → nothing to charge.
	if prof.FeeLedgerRef != "" {
		return &PaystackInit{Reference: prof.FeeLedgerRef, AlreadyPaid: true}, nil
	}
	if prof.Status != StatusNameReserved {
		return nil, ErrConflict
	}
	ref := "cacfee_" + prof.ID + "_" + randToken()
	resp, err := s.payment.InitializePayment(ctx, provider.InitializePaymentRequest{
		Email:          email,
		AmountKobo:     s.totalFeeKobo(), // CAC fee + platform fee
		Reference:      ref,
		CallbackURL:    callbackURL,
		IdempotencyKey: ref,
	})
	if err != nil {
		return nil, errors.Join(ErrProvider, err)
	}
	// Stash the pending reference so VerifyRegistrationFeePaystack can find this profile.
	setters := map[string]any{
		"metadata": mustJSON(mergeMetaJSON(prof.Metadata, "feePaystack", map[string]any{"reference": ref, "status": "pending"})),
	}
	if err := s.repo.updateFields(ctx, prof.ID, userID, "fee.paystack.initiated", map[string]any{"reference": ref, "amountKobo": s.feeKobo}, setters); err != nil {
		return nil, err
	}
	return &PaystackInit{Reference: resp.Reference, AuthorizationURL: resp.AuthorizationURL, AccessCode: resp.AccessCode}, nil
}

// VerifyRegistrationFeePaystack confirms a Paystack payment for the CAC fee and marks
// the fee paid (fee_ledger_ref = "paystack:<ref>"). No wallet debit — the money came
// via the gateway. Idempotent: a replay after the fee is paid returns the current
// state. Fails closed if the gateway reports anything other than a success covering
// the full fee amount.
func (s *Service) VerifyRegistrationFeePaystack(ctx context.Context, userID, reference string) (*BusinessProfile, error) {
	if s.payment == nil {
		return nil, ErrProvider
	}
	if strings.TrimSpace(reference) == "" {
		return nil, ErrValidation
	}
	prof, err := s.repo.GetProfileByFeePaystackRef(ctx, userID, reference)
	if err != nil {
		return nil, err
	}
	// Idempotent: already paid.
	if prof.FeeLedgerRef != "" {
		return prof, nil
	}
	st, err := s.payment.VerifyPayment(ctx, reference)
	if err != nil {
		return nil, errors.Join(ErrProvider, err)
	}
	// Fail closed: only a successful charge covering the full total (CAC fee +
	// platform fee) marks it paid.
	total := s.totalFeeKobo()
	if st == nil || st.Status != "success" || st.AmountKobo < total {
		return nil, ErrFeeNotPaid
	}
	// Bookkeeping: record the gateway receipt in the ledger. The full amount landed in
	// our Paystack balance (DR settlement) and splits into Paymax revenue (the platform
	// fee) and a CAC pass-through payable (provider_clearing). Best-effort — the money
	// has already moved externally, so a bookkeeping failure must NOT block the user's
	// paid status; reconciliation catches any gap. Idempotent per reference; posted
	// exactly once because a re-verify short-circuits on FeeLedgerRef above.
	s.recordPaystackFeeLedger(ctx, reference)

	setters := map[string]any{
		"fee_kobo":       s.feeKobo,
		"fee_ledger_ref": "paystack:" + reference,
		"metadata": mustJSON(mergeMetaJSON(prof.Metadata, "feePaystack", map[string]any{
			"reference":           reference,
			"status":              "success",
			"registrationFeeKobo": s.feeKobo,
			"platformFeeKobo":     s.platformFeeKobo,
			"totalKobo":           total,
		})),
	}
	if err := s.repo.updateFields(ctx, prof.ID, userID, "fee.paid", map[string]any{"feeKobo": s.feeKobo, "reference": reference, "source": "paystack"}, setters); err != nil {
		return nil, err
	}
	return s.repo.GetProfile(ctx, prof.ID)
}

// recordPaystackFeeLedger posts the balanced double-entry for a Paystack-funded CAC
// registration fee. Two legs, both DR the settlement (gateway-held funds) account:
//   - platform fee → CR paymax_revenue (income recognised)
//   - CAC fee      → CR provider_clearing (a pass-through payable to the registry)
// Best-effort and idempotent (unique per-leg idempotency keys); errors are logged via
// the ledger's own duplicate-tolerant path and never surfaced to the caller.
func (s *Service) recordPaystackFeeLedger(ctx context.Context, reference string) {
	settle, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountSettlement)
	if err != nil {
		return
	}
	rev, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountPaymaxRevenue)
	if err != nil {
		return
	}
	clearing, err := s.ledger.GetOrCreateStandingAccount(ctx, ledger.AccountProviderClearing)
	if err != nil {
		return
	}
	ref := "cac_fee_paystack:" + reference
	if s.platformFeeKobo > 0 {
		_ = s.ledger.PostJournal(ctx, ledger.JournalEntry{
			Reference: ref, IdempotencyKey: reference + ":platform", AmountKobo: s.platformFeeKobo,
			DebitAccountID: settle.ID, CreditAccountID: rev.ID,
			Description: "CAC registration platform fee (Paystack)",
		})
	}
	_ = s.ledger.PostJournal(ctx, ledger.JournalEntry{
		Reference: ref, IdempotencyKey: reference + ":cac", AmountKobo: s.feeKobo,
		DebitAccountID: settle.ID, CreditAccountID: clearing.ID,
		Description: "CAC registration fee pass-through (Paystack)",
	})
}

// randToken returns a short random hex token for uniqueifying a payment reference.
func randToken() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("150405.000")))
	}
	return hex.EncodeToString(b)
}

// SubmitRegistration submits the reserved name + details to CAC (name_reserved →
// registration_submitted, then → under_review when the provider queues review).
// Requires the fee to be paid. Idempotent on the Idempotency-Key at the wallet layer;
// a re-submit after a provider ref exists returns the current state.
func (s *Service) SubmitRegistration(ctx context.Context, userID, businessID, idemKey string) (*BusinessProfile, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, ErrMissingIdemKey
	}
	prof, err := s.ownedProfile(ctx, userID, businessID)
	if err != nil {
		return nil, err
	}
	// Idempotent replay: already submitted → return current state.
	if prof.CACRegistrationRef != "" {
		return prof, nil
	}
	if prof.FeeLedgerRef == "" {
		return nil, ErrFeeNotPaid
	}
	if prof.Status != StatusNameReserved {
		return nil, ErrConflict
	}
	props, err := s.repo.ListProprietors(ctx, prof.ID)
	if err != nil {
		return nil, err
	}
	cprops := make([]cac.Proprietor, 0, len(props))
	for _, p := range props {
		cprops = append(cprops, cac.Proprietor{
			FullName: p.FullName, Role: p.Role, SharePct: p.SharePct, Phone: p.Phone, Email: p.Email,
			// Masked tails only — raw BVN/NIN are not persisted; a production submit
			// re-collects raw identity at capture time and forwards it here.
			BVN: "", NIN: "",
		})
	}
	sub, err := s.provider.SubmitRegistration(ctx, cac.RegistrationRequest{
		EntityType:     cac.EntityType(prof.EntityType),
		ProposedName:   prof.ProposedName,
		LineOfBusiness: prof.LineOfBusiness,
		ReservationRef: prof.CACReservationRef,
		Address:        metaString(prof.Metadata, "address"),
		Objects:        metaString(prof.Metadata, "objects"),
		Proprietors:    cprops,
		FeeKobo:        prof.FeeKobo, // the ₦15,000 registration fee, forwarded to CAC in the submission payload
	})
	if err != nil {
		return nil, wrapProvider(err)
	}
	setters := map[string]any{"cac_registration_ref": sub.Ref}
	if err := s.repo.transition(ctx, prof.ID, StatusRegistrationSubmitted, []Status{StatusNameReserved}, userID, "registration.submitted",
		map[string]any{"ref": sub.Ref, "status": sub.Status}, setters); err != nil {
		return nil, err
	}
	// Provider may immediately queue review.
	if sub.Status == "under_review" {
		_ = s.repo.transition(ctx, prof.ID, StatusUnderReview, []Status{StatusRegistrationSubmitted}, userID, "registration.under_review", nil, nil)
	}
	return s.repo.GetProfile(ctx, prof.ID)
}

// RefreshStatus polls CAC for a submitted registration and advances the state
// machine (registration_submitted/under_review → registered | rejected). Read-only
// for terminal profiles.
func (s *Service) RefreshStatus(ctx context.Context, userID, businessID string) (*BusinessProfile, error) {
	prof, err := s.ownedProfile(ctx, userID, businessID)
	if err != nil {
		return nil, err
	}
	if IsTerminal(prof.Status) || prof.CACRegistrationRef == "" {
		return prof, nil
	}
	st, err := s.provider.GetRegistrationStatus(ctx, prof.CACRegistrationRef)
	if err != nil {
		return nil, wrapProvider(err)
	}
	switch st.State {
	case "under_review":
		_ = s.repo.transition(ctx, prof.ID, StatusUnderReview, []Status{StatusRegistrationSubmitted}, userID, "registration.under_review", nil, nil)
	case "registered":
		setters := map[string]any{}
		if st.RCOrBNNumber != "" {
			setters["rc_or_bn_number"] = st.RCOrBNNumber
		}
		if st.RegisteredName != "" {
			setters["legal_name"] = st.RegisteredName
		}
		if st.CertificateURL != "" {
			setters["certificate_url"] = st.CertificateURL
		}
		setters["registered_at"] = time.Now()
		_ = s.repo.transition(ctx, prof.ID, StatusRegistered, []Status{StatusRegistrationSubmitted, StatusUnderReview}, userID, "registration.registered",
			map[string]any{"rcOrBnNumber": st.RCOrBNNumber}, setters)
	case "rejected":
		_ = s.repo.transition(ctx, prof.ID, StatusRejected, []Status{StatusRegistrationSubmitted, StatusUnderReview}, userID, "registration.rejected",
			map[string]any{"reason": st.Reason}, nil)
	case "failed":
		_ = s.repo.transition(ctx, prof.ID, StatusFailed, []Status{StatusRegistrationSubmitted, StatusUnderReview}, userID, "registration.failed",
			map[string]any{"reason": st.Reason}, nil)
	}
	return s.repo.GetProfile(ctx, prof.ID)
}

// ── Verify-existing flow ──────────────────────────────────────────────────────

// StartVerifyExisting looks up + verifies an EXISTING registered business by its
// RC/BN number (draft → submitted → verified | rejected).
func (s *Service) StartVerifyExisting(ctx context.Context, userID string, req VerifyExistingRequest) (*BusinessProfile, error) {
	if strings.TrimSpace(req.RCOrBNNumber) == "" {
		return nil, ErrValidation
	}
	entityType := req.EntityType
	if entityType == "" {
		entityType = EntityBusinessName
	}
	id, err := s.repo.InsertProfile(ctx, userID, entityType, ModeVerifyExisting, "", "", "", StatusDraft, map[string]any{"rcOrBnNumber": req.RCOrBNNumber})
	if err != nil {
		return nil, err
	}
	// draft → submitted (lookup in flight).
	if err := s.repo.transition(ctx, id, StatusSubmitted, []Status{StatusDraft}, userID, "verify.submitted", map[string]any{"rcOrBnNumber": req.RCOrBNNumber}, nil); err != nil {
		return nil, err
	}
	ver, err := s.provider.VerifyEntity(ctx, req.RCOrBNNumber)
	if err != nil {
		_ = s.repo.transition(ctx, id, StatusFailed, []Status{StatusSubmitted}, userID, "verify.failed", map[string]any{"error": err.Error()}, nil)
		return nil, wrapProvider(err)
	}
	if !ver.Found {
		_ = s.repo.transition(ctx, id, StatusRejected, []Status{StatusSubmitted}, userID, "verify.not_found", map[string]any{"rcOrBnNumber": req.RCOrBNNumber}, nil)
		return s.repo.GetProfile(ctx, id)
	}
	setters := map[string]any{
		"legal_name":          ver.Name,
		"rc_or_bn_number":     req.RCOrBNNumber,
		"verification_source": s.provider.Name(),
	}
	if ver.Type != "" {
		setters["entity_type"] = normalizeEntityType(ver.Type)
	}
	if regAt := parseDate(ver.RegisteredAt); regAt != nil {
		setters["registered_at"] = *regAt
	}
	if err := s.repo.transition(ctx, id, StatusVerified, []Status{StatusSubmitted}, userID, "verify.verified",
		map[string]any{"name": ver.Name, "status": ver.Status}, setters); err != nil {
		// A unique-violation here means this user already verified this exact number.
		if errors.Is(err, ErrDuplicate) {
			return nil, ErrDuplicate
		}
		return nil, err
	}
	return s.repo.GetProfile(ctx, id)
}

// ── Reads ─────────────────────────────────────────────────────────────────────

func (s *Service) GetMyBusiness(ctx context.Context, userID, id string) (*BusinessProfile, error) {
	return s.ownedProfile(ctx, userID, id)
}

// GetCertificate returns the CAC certificate URL for a registered business. If the
// URL isn't stored yet but the registration is complete, it polls CAC once to fetch
// it. Returns ErrCertNotReady (404) until a certificate is available.
func (s *Service) GetCertificate(ctx context.Context, userID, id string) (string, error) {
	prof, err := s.ownedProfile(ctx, userID, id)
	if err != nil {
		return "", err
	}
	if prof.CertificateURL != "" {
		return prof.CertificateURL, nil
	}
	// Registered but certificate not captured yet, or still processing — poll once.
	if prof.CACRegistrationRef != "" && !IsTerminal(prof.Status) {
		if refreshed, rErr := s.RefreshStatus(ctx, userID, id); rErr == nil && refreshed.CertificateURL != "" {
			return refreshed.CertificateURL, nil
		}
	} else if prof.Status == StatusRegistered && prof.CACRegistrationRef != "" {
		// Terminal-registered but URL missing: re-query CAC directly for the cert.
		if st, sErr := s.provider.GetRegistrationStatus(ctx, prof.CACRegistrationRef); sErr == nil && st.CertificateURL != "" {
			_ = s.repo.updateFields(ctx, id, userID, "certificate.fetched",
				map[string]any{"certificateUrl": st.CertificateURL}, map[string]any{"certificate_url": st.CertificateURL})
			return st.CertificateURL, nil
		}
	}
	return "", ErrCertNotReady
}

func (s *Service) ListMine(ctx context.Context, userID string) ([]BusinessProfile, error) {
	list, err := s.repo.ListByUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []BusinessProfile{}
	}
	return list, nil
}

// HasVerifiedBusiness is the merchant-upgrade gate: true when the user has a
// verified or registered CAC business. Called by the onboarding/grant path before
// granting a merchant role.
func (s *Service) HasVerifiedBusiness(ctx context.Context, userID string) bool {
	ok, err := s.repo.HasVerified(ctx, userID)
	if err != nil {
		return false // fail-closed
	}
	return ok
}

// ── Admin ─────────────────────────────────────────────────────────────────────

func (s *Service) AdminList(ctx context.Context, status, mode string, limit int) ([]BusinessProfile, error) {
	list, err := s.repo.AdminList(ctx, status, mode, limit)
	if err != nil {
		return nil, err
	}
	if list == nil {
		list = []BusinessProfile{}
	}
	return list, nil
}

func (s *Service) AdminGet(ctx context.Context, id string) (*BusinessProfile, error) {
	return s.repo.GetProfile(ctx, id)
}

// AdminApprove is a manual override: it moves a business to its success terminal
// (verified for verify_existing, registered for register_new) and audits the action.
func (s *Service) AdminApprove(ctx context.Context, adminID, id string) (*BusinessProfile, error) {
	prof, err := s.repo.GetProfile(ctx, id)
	if err != nil {
		return nil, err
	}
	if prof.Mode == ModeVerifyExisting {
		if err := s.repo.transition(ctx, id, StatusVerified, []Status{StatusSubmitted, StatusUnderReview}, adminID, "admin.approved", map[string]any{"override": true}, nil); err != nil {
			return nil, err
		}
	} else {
		setters := map[string]any{"registered_at": time.Now()}
		if err := s.repo.transition(ctx, id, StatusRegistered, []Status{StatusRegistrationSubmitted, StatusUnderReview}, adminID, "admin.approved", map[string]any{"override": true}, setters); err != nil {
			return nil, err
		}
	}
	return s.repo.GetProfile(ctx, id)
}

// AdminReject moves any non-terminal profile to rejected with a reason (audited).
func (s *Service) AdminReject(ctx context.Context, adminID, id, reason string) (*BusinessProfile, error) {
	if strings.TrimSpace(reason) == "" {
		return nil, ErrValidation
	}
	prof, err := s.repo.GetProfile(ctx, id)
	if err != nil {
		return nil, err
	}
	if IsTerminal(prof.Status) {
		return nil, ErrConflict
	}
	from := []Status{StatusDraft, StatusNameCheck, StatusNameReserved, StatusRegistrationSubmitted, StatusUnderReview, StatusSubmitted}
	if err := s.repo.transition(ctx, id, StatusRejected, from, adminID, "admin.rejected", map[string]any{"reason": reason}, nil); err != nil {
		return nil, err
	}
	return s.repo.GetProfile(ctx, id)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func (s *Service) ownedProfile(ctx context.Context, userID, id string) (*BusinessProfile, error) {
	prof, err := s.repo.GetProfile(ctx, id)
	if err != nil {
		return nil, err
	}
	if prof.UserID != userID {
		return nil, ErrForbidden
	}
	return prof, nil
}

func wrapProvider(err error) error {
	if err == nil {
		return nil
	}
	return errors.Join(ErrProvider, err)
}

// maskTail returns a masked identity tail (last 4 chars) e.g. '*******1234'. Empty
// input yields empty output. Never stores/returns the full identity number.
func maskTail(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if len(s) <= 4 {
		return strings.Repeat("*", len(s))
	}
	return strings.Repeat("*", len(s)-4) + s[len(s)-4:]
}

func normalizeEntityType(t string) string {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "company", "rc":
		return string(EntityCompany)
	case "incorporated_trustee", "trustee", "it":
		return string(EntityIncorporatedTrustee)
	default:
		return string(EntityBusinessName)
	}
}

func parseDate(s string) *time.Time {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	for _, layout := range []string{"2006-01-02", time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return &t
		}
	}
	return nil
}

func metaString(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

// mergeMetaJSON returns a JSON-serialisable metadata map with key set to val,
// preserving existing entries (used as a transition setter for metadata).
func mergeMetaJSON(existing map[string]any, key string, val any) map[string]any {
	out := map[string]any{}
	for k, v := range existing {
		out[k] = v
	}
	out[key] = val
	return out
}

// mustJSON marshals v to []byte for a jsonb column. On error it returns an empty
// JSON object so a metadata encode failure never aborts a transition.
func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return b
}
