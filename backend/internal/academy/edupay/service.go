package edupay

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the Spotlight Academy EduPay domain (fees, savings pots, disbursements,
// scholarships). It owns the GUARDED disbursement state machine
// (fee_due→funding→collected→disbursed→reconciled) and local entitlement-style state.
//
// Money NEVER moves here directly: collection from the payer and payout to the school
// are delegated to the INJECTED CollectRail / DisburseRail / BNPLRail (paymax-rails.md
// §1 — adapter, not SDK leak). Pot balances are DERIVED from the append-only
// contributions table (no shadow balance). Every pay/fund/disburse op is idempotent
// (academy_idempotency_keys) and audit-logged; every disbursement is reconciled + audited
// (golden rule 6).
type Service struct {
	repo     *Repository
	collect  CollectRail
	disburse DisburseRail
	bnpl     BNPLRail
}

// NewService wires the EduPay service. nil rails fall back to dev stubs so the package
// runs end-to-end without a vendor bound (deterministic + idempotent).
func NewService(db *pgxpool.Pool, collect CollectRail, disburse DisburseRail, bnpl BNPLRail) *Service {
	if collect == nil {
		collect = StubCollectRail{}
	}
	if disburse == nil {
		disburse = StubDisburseRail{}
	}
	if bnpl == nil {
		bnpl = StubBNPLRail{}
	}
	return &Service{repo: NewRepository(db), collect: collect, disburse: disburse, bnpl: bnpl}
}

// Idempotency scopes (namespace keys per operation so keys cannot collide).
const (
	scopePay        = "edupay.pay"
	scopePotFund    = "edupay.pot_fund"
	scopePotPay     = "edupay.pot_pay"
	scopeDisburse   = "edupay.disburse"
	scopeReconcile  = "edupay.reconcile"
	scopeScholAward = "edupay.scholarship_award"
)

// requestHash binds an idempotency key to its request body so the same key with a
// different body is rejected (idempotency_key_reused) rather than silently replayed.
func requestHash(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// ── School / fee catalog (reads + admin CRUD) ────────────────────────────────────

func (s *Service) ListSchools(ctx context.Context) ([]School, error) { return s.repo.ListSchools(ctx) }

// ListFeeSchedules filters by school and/or class code (either may be empty).
func (s *Service) ListFeeSchedules(ctx context.Context, schoolID, classCode string) ([]FeeSchedule, error) {
	return s.repo.ListFeeSchedules(ctx, schoolID, classCode)
}

// LinkSchool links the payer to a school for a named student.
func (s *Service) LinkSchool(ctx context.Context, userID string, req LinkSchoolRequest) (*EduPayAccount, error) {
	if userID == "" {
		return nil, ErrNotFound
	}
	sch, err := s.repo.GetSchool(ctx, req.SchoolID)
	if err != nil {
		return nil, err
	}
	if sch.Status != "active" {
		return nil, ErrSchoolInactive
	}
	acct, err := s.repo.LinkAccount(ctx, userID, req.SchoolID, req.StudentName, req.StudentClass)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, userID, "edupay.school_linked", "academy_edupay_account", "", "", "active", "",
		map[string]any{"schoolId": req.SchoolID, "studentName": req.StudentName})
	return acct, nil
}

// CreateSchool (admin) registers a school.
func (s *Service) CreateSchool(ctx context.Context, adminID string, req CreateSchoolRequest) (*School, error) {
	sch, err := s.repo.InsertSchool(ctx, req.Name, req.Code, req.VirtualAccountRef, req.Contact)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, adminID, "edupay.school_created", "academy_school", sch.ID, "", "active", "", map[string]any{"name": req.Name})
	return sch, nil
}

// CreateFeeSchedule (admin) publishes a fee schedule.
func (s *Service) CreateFeeSchedule(ctx context.Context, adminID string, req CreateFeeScheduleRequest) (*FeeSchedule, error) {
	if req.AmountMinor < 0 {
		return nil, ErrInvalidAmount
	}
	var due *time.Time
	if req.DueDate != "" {
		t, err := time.Parse("2006-01-02", req.DueDate)
		if err != nil {
			return nil, ErrInvalidAmount
		}
		due = &t
	}
	fs, err := s.repo.InsertFeeSchedule(ctx, req.SchoolID, req.Name, req.ClassCode, req.Term, req.AmountMinor, req.Currency, due)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, adminID, "edupay.fee_schedule_created", "academy_fee_schedule", fs.ID, "", "active", "",
		map[string]any{"schoolId": req.SchoolID, "amountMinor": req.AmountMinor})
	return fs, nil
}

// ── PayFees (collect from payer → disburse to school) ───────────────────────────

// PayFees pays a fee schedule. Funds flow: COLLECT from the payer (CollectRail, or
// BNPLRail when source=bnpl) → mark collected → DISBURSE to the school's virtual
// account (DisburseRail) → mark disbursed. The disbursement runs the guarded SM
// fee_due→funding→collected→disbursed. Idempotent END-TO-END on idemKey: a replay
// returns the original disbursement with NO second collect and NO second payout.
func (s *Service) PayFees(ctx context.Context, userID, feeScheduleID, studentRef, source, idemKey string) (*Disbursement, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if userID == "" {
		return nil, ErrNotFound
	}
	if source == "" {
		source = "pay"
	}
	if source != "pay" && source != "bnpl" {
		return nil, ErrInvalidSource
	}
	rh := requestHash(scopePay, userID, feeScheduleID, source)

	// Idempotency replay: same key returns the stored disbursement; different body ⇒ reuse.
	if prior, err := s.repo.FindIdem(ctx, idemKey, scopePay); err == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		if prior.ResultRef != "" {
			return s.repo.GetDisbursement(ctx, prior.ResultRef)
		}
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	fs, err := s.repo.GetFeeSchedule(ctx, feeScheduleID)
	if err != nil {
		return nil, err
	}
	if fs.Status != "active" {
		return nil, ErrFeeScheduleInactive
	}
	if fs.AmountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	sch, err := s.repo.GetSchool(ctx, fs.SchoolID)
	if err != nil {
		return nil, err
	}
	if sch.VirtualAccountRef == nil || *sch.VirtualAccountRef == "" {
		return nil, ErrSchoolAccountMissing
	}

	// Create the disbursement (fee_due) — this row id is the stable reference for both rails.
	var disb *Disbursement
	if err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		d, ierr := insertDisbursement(ctx, tx, feeScheduleID, fs.SchoolID, userID, studentRef, fs.AmountMinor, fs.Currency, source, idemKey)
		if ierr != nil {
			return ierr
		}
		disb = d
		return writeAudit(ctx, tx, userID, "edupay.fee_due", "academy_disbursement", d.ID, "", string(DisbFeeDue), idemKey,
			map[string]any{"feeScheduleId": feeScheduleID, "amountMinor": fs.AmountMinor, "source": source})
	}); err != nil {
		return nil, err
	}

	return s.runDisbursement(ctx, userID, disb, *sch.VirtualAccountRef, source, scopePay, rh, idemKey, "")
}

// runDisbursement drives the guarded SM fee_due→funding→collected→disbursed for a
// freshly-created disbursement. collectRef is non-empty when the collection has ALREADY
// happened (pot / scholarship draws): in that case no CollectRail/BNPL call is made.
func (s *Service) runDisbursement(ctx context.Context, actorID string, disb *Disbursement, schoolAccountRef, source, scope, rh, idemKey, preCollectedRef string) (*Disbursement, error) {
	// fee_due → funding (local guard before touching the rail).
	if err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		if err := setDisbState(ctx, tx, disb.ID, DisbFeeDue, DisbFunding, nil, nil); err != nil {
			return err
		}
		return writeAudit(ctx, tx, actorID, "edupay.funding", "academy_disbursement", disb.ID, string(DisbFeeDue), string(DisbFunding), idemKey, emptyDetail())
	}); err != nil {
		return nil, err
	}

	// COLLECT leg (money via RAIL, idempotent on idemKey). Skipped when funds already drawn.
	collectRef := preCollectedRef
	if collectRef == "" {
		var cerr error
		switch source {
		case "bnpl":
			collectRef, cerr = s.bnpl.StartPlan(ctx, actorID, disb.ID, idemKey, disb.AmountMinor)
		default:
			collectRef, cerr = s.collect.Collect(ctx, actorID, disb.ID, idemKey, disb.AmountMinor)
		}
		if cerr != nil {
			return nil, cerr
		}
	}

	// funding → collected (record the payment ref).
	if err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		if err := setDisbState(ctx, tx, disb.ID, DisbFunding, DisbCollected, &collectRef, nil); err != nil {
			return err
		}
		return writeAudit(ctx, tx, actorID, "edupay.collected", "academy_disbursement", disb.ID, string(DisbFunding), string(DisbCollected), idemKey,
			map[string]any{"paymentRef": collectRef})
	}); err != nil {
		return nil, err
	}

	// DISBURSE leg (payout to the school VA via RAIL, idempotent on idemKey).
	payoutRef, derr := s.disburse.Disburse(ctx, schoolAccountRef, disb.ID, idemKey, disb.AmountMinor)
	if derr != nil {
		return nil, derr
	}

	// collected → disbursed + persist idem result END-TO-END.
	if err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		if err := setDisbState(ctx, tx, disb.ID, DisbCollected, DisbDisbursed, nil, &payoutRef); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, actorID, "edupay.disbursed", "academy_disbursement", disb.ID, string(DisbCollected), string(DisbDisbursed), idemKey,
			map[string]any{"payoutRef": payoutRef, "schoolAccountRef": schoolAccountRef}); err != nil {
			return err
		}
		return saveIdem(ctx, tx, idemKey, scope, actorID, rh, disb.ID, map[string]any{"disbursementId": disb.ID, "state": string(DisbDisbursed)})
	}); err != nil {
		return nil, err
	}
	return s.repo.GetDisbursement(ctx, disb.ID)
}

// ── Savings pots ────────────────────────────────────────────────────────────────

// CreatePot opens a savings pot toward a goal (optionally tied to a fee schedule).
func (s *Service) CreatePot(ctx context.Context, userID string, req CreatePotRequest) (*SavingsPot, error) {
	if userID == "" {
		return nil, ErrNotFound
	}
	if req.TargetMinor < 0 {
		return nil, ErrInvalidAmount
	}
	pot, err := s.repo.InsertPot(ctx, userID, req.GoalName, req.TargetMinor, req.FeeScheduleID)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, userID, "edupay.pot_created", "academy_savings_pot", pot.ID, "", "active", "",
		map[string]any{"goalName": req.GoalName, "targetMinor": req.TargetMinor})
	return pot, nil
}

func (s *Service) GetPot(ctx context.Context, userID, potID string) (*SavingsPot, error) {
	return s.repo.GetPot(ctx, userID, potID)
}

// FundPot collects funds from the payer (CollectRail) and APPENDS a contribution. The
// pot's saved_minor is RECOMPUTED (derived) from SUM(contributions) — never mutated as
// a shadow balance. Idempotent on idemKey end-to-end: a replay collects nothing and
// appends no second row (contribution idempotency_key is globally UNIQUE).
func (s *Service) FundPot(ctx context.Context, userID, potID string, amountMinor int64, idemKey string) (*SavingsPot, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if amountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	pot, err := s.repo.GetPot(ctx, userID, potID)
	if err != nil {
		return nil, err
	}
	if pot.Status != "active" {
		return nil, ErrPotClosed
	}
	rh := requestHash(scopePotFund, userID, potID)

	if prior, ferr := s.repo.FindIdem(ctx, idemKey, scopePotFund); ferr == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		return s.repo.GetPot(ctx, userID, potID) // replay: derived balance unchanged
	} else if !errors.Is(ferr, ErrNotFound) {
		return nil, ferr
	}

	// COLLECT from the payer via the rail (idempotent on idemKey).
	walletRef, cerr := s.collect.Collect(ctx, userID, potID, idemKey, amountMinor)
	if cerr != nil {
		return nil, cerr
	}

	if err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		inserted, aerr := appendContribution(ctx, tx, potID, userID, amountMinor, walletRef, idemKey)
		if aerr != nil {
			return aerr
		}
		if err := writeAudit(ctx, tx, userID, "edupay.pot_funded", "academy_savings_pot", potID, "", "", idemKey,
			map[string]any{"amountMinor": amountMinor, "walletRef": walletRef, "inserted": inserted}); err != nil {
			return err
		}
		return saveIdem(ctx, tx, idemKey, scopePotFund, userID, rh, potID, map[string]any{"potId": potID, "amountMinor": amountMinor})
	}); err != nil {
		return nil, err
	}
	return s.repo.GetPot(ctx, userID, potID) // returns the recomputed (derived) saved_minor
}

// PayFromPot disburses a fee FROM an already-funded pot. The pot's DERIVED balance must
// be >= the fee amount; the draw runs the same disbursement SM with source=pot (no
// fresh CollectRail call — the funds are already in the pot's contributions). Idempotent.
func (s *Service) PayFromPot(ctx context.Context, userID, potID, feeScheduleID, studentRef, idemKey string) (*Disbursement, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	rh := requestHash(scopePotPay, userID, potID, feeScheduleID)

	if prior, ferr := s.repo.FindIdem(ctx, idemKey, scopePotPay); ferr == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		if prior.ResultRef != "" {
			return s.repo.GetDisbursement(ctx, prior.ResultRef)
		}
	} else if !errors.Is(ferr, ErrNotFound) {
		return nil, ferr
	}

	pot, err := s.repo.GetPot(ctx, userID, potID)
	if err != nil {
		return nil, err
	}
	fs, err := s.repo.GetFeeSchedule(ctx, feeScheduleID)
	if err != nil {
		return nil, err
	}
	if fs.Status != "active" {
		return nil, ErrFeeScheduleInactive
	}
	if fs.AmountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	// DERIVED balance check — saved_minor is SUM(contributions), never a shadow column.
	if pot.SavedMinor < fs.AmountMinor {
		return nil, ErrInsufficientPot
	}
	sch, err := s.repo.GetSchool(ctx, fs.SchoolID)
	if err != nil {
		return nil, err
	}
	if sch.VirtualAccountRef == nil || *sch.VirtualAccountRef == "" {
		return nil, ErrSchoolAccountMissing
	}

	var disb *Disbursement
	if err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		d, ierr := insertDisbursement(ctx, tx, feeScheduleID, fs.SchoolID, userID, studentRef, fs.AmountMinor, fs.Currency, "pot", idemKey)
		if ierr != nil {
			return ierr
		}
		disb = d
		return writeAudit(ctx, tx, userID, "edupay.fee_due", "academy_disbursement", d.ID, "", string(DisbFeeDue), idemKey,
			map[string]any{"feeScheduleId": feeScheduleID, "amountMinor": fs.AmountMinor, "source": "pot", "potId": potID})
	}); err != nil {
		return nil, err
	}

	// Funds already in the pot ⇒ pass a synthetic pre-collected ref (no CollectRail call).
	preCollected := "pot-" + potID
	return s.runDisbursement(ctx, userID, disb, *sch.VirtualAccountRef, "pot", scopePotPay, rh, idemKey, preCollected)
}

// ── Reconcile (disbursed → reconciled; admin) ───────────────────────────────────

// Reconcile confirms a disbursed payout against the rail and flips the disbursement
// disbursed→reconciled (golden rule 6: reconcile + audit every disbursement). Idempotent.
func (s *Service) Reconcile(ctx context.Context, adminID, disbID, idemKey string) (*Disbursement, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	disb, err := s.repo.GetDisbursement(ctx, disbID)
	if err != nil {
		return nil, err
	}
	rh := requestHash(scopeReconcile, disbID)

	if prior, ferr := s.repo.FindIdem(ctx, idemKey, scopeReconcile); ferr == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		return s.repo.GetDisbursement(ctx, disbID)
	} else if !errors.Is(ferr, ErrNotFound) {
		return nil, ferr
	}

	if disb.State == DisbReconciled {
		return disb, nil // already reconciled
	}
	if !canDisb(disb.State, DisbReconciled) {
		_ = s.audit(ctx, adminID, "edupay.reconcile_rejected", "academy_disbursement", disbID, string(disb.State), string(DisbReconciled), idemKey, emptyDetail())
		return nil, ErrIllegalTransition
	}

	if err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		if err := setDisbState(ctx, tx, disbID, DisbDisbursed, DisbReconciled, nil, nil); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, adminID, "edupay.reconciled", "academy_disbursement", disbID, string(DisbDisbursed), string(DisbReconciled), idemKey,
			map[string]any{"amountMinor": disb.AmountMinor, "payoutRef": derefStr(disb.PayoutRef)}); err != nil {
			return err
		}
		return saveIdem(ctx, tx, idemKey, scopeReconcile, adminID, rh, disbID, map[string]any{"disbursementId": disbID, "state": string(DisbReconciled)})
	}); err != nil {
		return nil, err
	}
	return s.repo.GetDisbursement(ctx, disbID)
}

// ── Scholarships (admin academy.edupay / sponsor) ───────────────────────────────

func (s *Service) ListScholarships(ctx context.Context) ([]Scholarship, error) {
	return s.repo.ListScholarships(ctx)
}

// CreateScholarship funds a scholarship from a sponsor budget.
func (s *Service) CreateScholarship(ctx context.Context, adminID string, req CreateScholarshipRequest) (*Scholarship, error) {
	if req.BudgetMinor < 0 {
		return nil, ErrInvalidAmount
	}
	sc, err := s.repo.InsertScholarship(ctx, req.SponsorID, req.Name, req.Criteria, req.BudgetMinor)
	if err != nil {
		return nil, err
	}
	_ = s.audit(ctx, adminID, "edupay.scholarship_created", "academy_scholarship", sc.ID, "", "active", "",
		map[string]any{"name": req.Name, "budgetMinor": req.BudgetMinor})
	return sc, nil
}

// AwardResult bundles the award + the (sponsor-funded) disbursement it runs.
type AwardResult struct {
	Award        *ScholarshipAward `json:"award"`
	Disbursement *Disbursement     `json:"disbursement"`
}

// AwardScholarship grants a scholarship award (idempotent on idemKey + UNIQUE award
// idempotency_key) and runs the SAME disbursement SM with source=scholarship
// (sponsor-funded: no payer collection — the scholarship budget is the source, drawn
// against awarded_minor). Idempotent: a replay returns the original award + disbursement.
func (s *Service) AwardScholarship(ctx context.Context, adminID string, req AwardScholarshipRequest, idemKey string) (*AwardResult, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	if req.AmountMinor <= 0 {
		return nil, ErrInvalidAmount
	}
	rh := requestHash(scopeScholAward, req.ScholarshipID, req.UserID, req.FeeScheduleID)

	if prior, ferr := s.repo.FindIdem(ctx, idemKey, scopeScholAward); ferr == nil {
		if prior.RequestHash != "" && prior.RequestHash != rh {
			return nil, ErrIdempotencyKeyReused
		}
		return s.awardReplay(ctx, prior)
	} else if !errors.Is(ferr, ErrNotFound) {
		return nil, ferr
	}

	sc, err := s.repo.GetScholarship(ctx, req.ScholarshipID)
	if err != nil {
		return nil, err
	}
	if sc.Status != "active" {
		return nil, ErrScholarshipInactive
	}
	if sc.AwardedMinor+req.AmountMinor > sc.BudgetMinor {
		return nil, ErrScholarshipExhausted
	}

	// Resolve the school for disbursement (fee schedule → school VA).
	var schoolID, currency, schoolAccountRef string
	currency = "NGN"
	if req.FeeScheduleID != "" {
		fs, ferr := s.repo.GetFeeSchedule(ctx, req.FeeScheduleID)
		if ferr != nil {
			return nil, ferr
		}
		schoolID = fs.SchoolID
		currency = fs.Currency
		sch, serr := s.repo.GetSchool(ctx, fs.SchoolID)
		if serr != nil {
			return nil, serr
		}
		if sch.VirtualAccountRef == nil || *sch.VirtualAccountRef == "" {
			return nil, ErrSchoolAccountMissing
		}
		schoolAccountRef = *sch.VirtualAccountRef
	} else {
		return nil, ErrSchoolAccountMissing
	}

	// Grant the award + create the disbursement (fee_due) atomically; bump awarded_minor.
	var award *ScholarshipAward
	var disb *Disbursement
	if err := s.repo.withTx(ctx, func(tx pgx.Tx) error {
		a, _, aerr := insertAward(ctx, tx, req.ScholarshipID, req.UserID, req.FeeScheduleID, req.AmountMinor, idemKey)
		if aerr != nil {
			return aerr
		}
		award = a
		if err := addAwardedMinor(ctx, tx, req.ScholarshipID, req.AmountMinor); err != nil {
			return err
		}
		d, derr := insertDisbursement(ctx, tx, req.FeeScheduleID, schoolID, req.UserID, "", req.AmountMinor, currency, "scholarship", idemKey)
		if derr != nil {
			return derr
		}
		disb = d
		return writeAudit(ctx, tx, adminID, "edupay.scholarship_awarded", "academy_scholarship_award", a.ID, "", "granted", idemKey,
			map[string]any{"scholarshipId": req.ScholarshipID, "userId": req.UserID, "amountMinor": req.AmountMinor, "disbursementId": d.ID})
	}); err != nil {
		return nil, err
	}

	// Sponsor-funded ⇒ funds drawn from the scholarship budget (no payer collect).
	preCollected := "scholarship-" + req.ScholarshipID
	settled, err := s.runDisbursement(ctx, adminID, disb, schoolAccountRef, "scholarship", scopeScholAward, rh, idemKey, preCollected)
	if err != nil {
		return nil, err
	}
	// Mark the award disbursed (best-effort local state).
	_ = s.repo.withTx(ctx, func(tx pgx.Tx) error {
		return setAwardState(ctx, tx, award.ID, "disbursed")
	})
	award.State = "disbursed"
	return &AwardResult{Award: award, Disbursement: settled}, nil
}

func (s *Service) awardReplay(ctx context.Context, prior *idemRecord) (*AwardResult, error) {
	res := &AwardResult{}
	if prior.ResultRef != "" {
		if d, err := s.repo.GetDisbursement(ctx, prior.ResultRef); err == nil {
			res.Disbursement = d
		}
	}
	return res, nil
}

// ── Member dashboard ────────────────────────────────────────────────────────────

// GetMyEduPay returns the member's linked schools/accounts, the active fee schedules
// due for their linked schools, their savings pots (with DERIVED balances) and their
// disbursement history.
func (s *Service) GetMyEduPay(ctx context.Context, userID string) (*MyEduPay, error) {
	if userID == "" {
		return nil, ErrNotFound
	}
	accounts, err := s.repo.ListAccounts(ctx, userID)
	if err != nil {
		return nil, err
	}
	// Fee schedules due across all linked schools.
	feesDue := []FeeSchedule{}
	seen := map[string]bool{}
	for _, a := range accounts {
		if seen[a.SchoolID] {
			continue
		}
		seen[a.SchoolID] = true
		fs, ferr := s.repo.ListFeeSchedules(ctx, a.SchoolID, "")
		if ferr != nil {
			return nil, ferr
		}
		feesDue = append(feesDue, fs...)
	}
	pots, err := s.repo.ListPots(ctx, userID)
	if err != nil {
		return nil, err
	}
	disb, err := s.repo.ListDisbursements(ctx, userID)
	if err != nil {
		return nil, err
	}
	return &MyEduPay{Accounts: accounts, FeesDue: feesDue, Pots: pots, Disbursements: disb}, nil
}

// ── internal helpers ────────────────────────────────────────────────────────────

// audit writes a non-transactional audit row (best-effort, for non-tx events / rejections).
func (s *Service) audit(ctx context.Context, actorID, action, entityType, entityID, from, to, idemKey string, detail any) error {
	return writeAudit(ctx, s.repo.db, actorID, action, entityType, entityID, from, to, idemKey, detail)
}

func emptyDetail() map[string]any { return map[string]any{} }

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
