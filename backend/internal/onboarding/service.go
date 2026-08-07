package onboarding

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Sentinel errors map to HTTP statuses in the handler.
var (
	ErrConflict       = errors.New("onboarding: illegal state transition")                     // -> 409
	ErrDuplicate      = errors.New("onboarding: active application or profile already exists") // -> 409
	ErrValidation     = errors.New("onboarding: submission failed validation")                 // -> 422
	ErrForbidden      = errors.New("onboarding: not the owner")                                // -> 403
	ErrModuleClosed   = errors.New("onboarding: merchant type not open")                       // -> 409
	ErrMissingIdemKey = errors.New("onboarding: Idempotency-Key header required")              // -> 400
)

// ValidationError carries per-field messages.
type ValidationError struct{ Fields map[string]string }

func (e *ValidationError) Error() string { return "validation failed" }

// BusinessGate reports whether a user holds a verified/registered CAC business.
// Declared locally so onboarding does not import the business package; the concrete
// *business.Service satisfies it. A nil gate disables the check (old behavior).
type BusinessGate interface {
	HasVerifiedBusiness(ctx context.Context, userID string) bool
}

// Service holds the onboarding business logic.
type Service struct {
	repo         *Repository
	businessGate BusinessGate // optional; nil = business gate disabled
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{repo: NewRepository(db)}
}

// SetBusinessGate injects the optional CAC-business gate. When set, merchant types
// flagged requires_business demand a verified/registered CAC business before a user
// can submit or be approved for that merchant role. Passing nil leaves it disabled.
func (s *Service) SetBusinessGate(g BusinessGate) { s.businessGate = g }

// ─── Catalogue reads ─────────────────────────────────────────────────────────

func (s *Service) ListOpenModules(ctx context.Context) ([]Module, error) {
	return s.repo.ListOpenModules(ctx)
}

func (s *Service) ListMerchantTypes(ctx context.Context, moduleID string) ([]MerchantType, error) {
	return s.repo.ListMerchantTypes(ctx, moduleID)
}

func (s *Service) GetMerchantType(ctx context.Context, id string) (*MerchantType, error) {
	return s.repo.GetMerchantType(ctx, id)
}

func (s *Service) GetFormSchema(ctx context.Context, id string) (*FormSchema, error) {
	return s.repo.GetFormSchema(ctx, id)
}

// ─── Application lifecycle ───────────────────────────────────────────────────

// CreateApplication starts a DRAFT, blocking a duplicate active app/profile for the
// same merchant type. The merchant type must be open.
func (s *Service) CreateApplication(ctx context.Context, userID string, req CreateApplicationRequest) (*Application, error) {
	mt, err := s.repo.GetMerchantType(ctx, req.MerchantTypeID)
	if err != nil {
		return nil, err
	}
	if mt.Status != "open" {
		return nil, ErrModuleClosed
	}
	dup, err := s.repo.HasActiveApplicationOrProfile(ctx, userID, req.MerchantTypeID)
	if err != nil {
		return nil, err
	}
	if dup {
		return nil, ErrDuplicate
	}
	data := req.Data
	if data == nil {
		data = map[string]interface{}{}
	}
	id, err := s.repo.InsertApplication(ctx, userID, req.MerchantTypeID, data)
	if err != nil {
		// Unique partial index may catch a race.
		if isUniqueViolation(err) {
			return nil, ErrDuplicate
		}
		return nil, err
	}
	return s.repo.GetApplication(ctx, id)
}

// SaveDraft updates a DRAFT's data. Owner-only; non-DRAFT returns 409.
func (s *Service) SaveDraft(ctx context.Context, userID, id string, req SaveDraftRequest) (*Application, error) {
	app, err := s.repo.GetApplication(ctx, id)
	if err != nil {
		return nil, err
	}
	if app.UserID != userID {
		return nil, ErrForbidden
	}
	if app.Status != "DRAFT" {
		return nil, ErrConflict
	}
	n, err := s.repo.UpdateDraftData(ctx, id, userID, req.Data)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrConflict
	}
	return s.repo.GetApplication(ctx, id)
}

// Submit validates the draft against the merchant type's current published schema,
// pins the schema version, and moves DRAFT->SUBMITTED. Requires an Idempotency-Key.
func (s *Service) Submit(ctx context.Context, userID, id, idemKey string) (*Application, error) {
	if strings.TrimSpace(idemKey) == "" {
		return nil, ErrMissingIdemKey
	}
	app, err := s.repo.GetApplication(ctx, id)
	if err != nil {
		return nil, err
	}
	if app.UserID != userID {
		return nil, ErrForbidden
	}
	// Idempotent replay: same key, already submitted -> return current state.
	if app.Status != "DRAFT" {
		if app.Status == "SUBMITTED" || app.Status == "UNDER_REVIEW" {
			// Allow only if this is a retry; otherwise illegal.
			return app, nil
		}
		return nil, ErrConflict
	}
	// Merchant-upgrade gate: a merchant type flagged requires_business cannot be
	// applied for without a verified/registered CAC business. Nil gate = disabled.
	mt, err := s.repo.GetMerchantType(ctx, app.MerchantTypeID)
	if err != nil {
		return nil, err
	}
	if mt.RequiresBusiness && s.businessGate != nil && !s.businessGate.HasVerifiedBusiness(ctx, userID) {
		return nil, &ValidationError{Fields: map[string]string{
			"business": "A verified CAC business is required to become a merchant. Verify or register your business first.",
		}}
	}
	schema, err := s.repo.GetPublishedSchemaForType(ctx, app.MerchantTypeID)
	if err != nil {
		return nil, err
	}
	if verr := ValidateSubmission(schema, app.Data); verr != nil {
		return nil, verr
	}
	checks := buildChecks(schema, app.Data)
	n, err := s.repo.SubmitApplication(ctx, id, userID, schema.ID, schema.Version, checks, idemKey)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrConflict
	}
	_ = s.repo.writeAudit(ctx, userID, userID, "application.submitted", id, map[string]any{
		"formSchemaId": schema.ID, "version": schema.Version,
	})
	return s.repo.GetApplication(ctx, id)
}

// Resubmit moves NEEDS_MORE_INFO -> UNDER_REVIEW (owner-only).
func (s *Service) Resubmit(ctx context.Context, userID, id string) (*Application, error) {
	app, err := s.repo.GetApplication(ctx, id)
	if err != nil {
		return nil, err
	}
	if app.UserID != userID {
		return nil, ErrForbidden
	}
	if app.Status != "NEEDS_MORE_INFO" {
		return nil, ErrConflict
	}
	n, err := s.repo.ResubmitApplication(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrConflict
	}
	_ = s.repo.writeAudit(ctx, userID, userID, "application.resubmitted", id, nil)
	return s.repo.GetApplication(ctx, id)
}

func (s *Service) GetApplication(ctx context.Context, userID, id string, isReviewer bool) (*Application, error) {
	app, err := s.repo.GetApplication(ctx, id)
	if err != nil {
		return nil, err
	}
	if !isReviewer && app.UserID != userID {
		return nil, ErrForbidden
	}
	return app, nil
}

// ─── Capabilities ────────────────────────────────────────────────────────────

func (s *Service) Capabilities(ctx context.Context, userID, displayName string, kycTier int) (*Capabilities, error) {
	merchants, err := s.repo.ListMerchantProfiles(ctx, userID)
	if err != nil {
		return nil, err
	}
	apps, err := s.repo.ListActiveApplications(ctx, userID)
	if err != nil {
		return nil, err
	}
	if merchants == nil {
		merchants = []MerchantProfile{}
	}
	if apps == nil {
		apps = []Application{}
	}
	return &Capabilities{
		UserID:             userID,
		DisplayName:        displayName,
		KycTier:            kycTier,
		Customer:           true,
		Merchants:          merchants,
		ActiveApplications: apps,
	}, nil
}

// ─── Admin review ────────────────────────────────────────────────────────────

func (s *Service) ReviewQueue(ctx context.Context, moduleID, typeID, status string, maxAgeHours int) ([]Application, error) {
	apps, err := s.repo.ReviewQueue(ctx, moduleID, typeID, status, maxAgeHours)
	if err != nil {
		return nil, err
	}
	if apps == nil {
		apps = []Application{}
	}
	return apps, nil
}

// Approve idempotently activates the merchant profile, grants the role, and writes
// an audit event. Legal from SUBMITTED or UNDER_REVIEW. A retry on an already-APPROVED
// application re-runs the idempotent grant/activation and returns 200.
func (s *Service) Approve(ctx context.Context, reviewerID, id string) (*Application, error) {
	app, err := s.repo.GetApplication(ctx, id)
	if err != nil {
		return nil, err
	}
	if app.Status != "SUBMITTED" && app.Status != "UNDER_REVIEW" && app.Status != "APPROVED" {
		return nil, ErrConflict
	}
	mt, err := s.repo.GetMerchantType(ctx, app.MerchantTypeID)
	if err != nil {
		return nil, err
	}
	// Defense-in-depth: a stale application must not be approved into a merchant role
	// if the applicant lacks the required verified/registered CAC business. Nil gate =
	// disabled (old behavior). Uses the applicant's user id, not the reviewer's.
	if mt.RequiresBusiness && s.businessGate != nil && !s.businessGate.HasVerifiedBusiness(ctx, app.UserID) {
		return nil, &ValidationError{Fields: map[string]string{
			"business": "A verified CAC business is required to become a merchant. Verify or register your business first.",
		}}
	}
	workspaceRoute := fmt.Sprintf("/merchant/%s", mt.Slug)

	// 1) idempotent profile activation
	if _, err := s.repo.activateProfile(ctx, app.UserID, mt.ModuleID, mt.ID, id, mt.RoleToGrant, workspaceRoute); err != nil {
		return nil, err
	}
	// 2) idempotent role grant
	granted, err := s.repo.grantRole(ctx, app.UserID, mt.RoleToGrant)
	if err != nil {
		return nil, err
	}
	if !granted {
		return nil, fmt.Errorf("onboarding: role %q not provisioned", mt.RoleToGrant)
	}
	// 3) move to APPROVED (no-op if already approved)
	if app.Status != "APPROVED" {
		if _, err := s.repo.TransitionStatus(ctx, id, "APPROVED",
			[]string{"SUBMITTED", "UNDER_REVIEW"}, "", nil, true); err != nil {
			return nil, err
		}
		_ = s.repo.writeAudit(ctx, reviewerID, app.UserID, "application.approved", id, map[string]any{
			"roleGranted": mt.RoleToGrant, "merchantTypeId": mt.ID,
		})
	}
	// 4) notification stub
	notifyApproved(app.UserID, mt.Name)
	return s.repo.GetApplication(ctx, id)
}

// Reject moves SUBMITTED/UNDER_REVIEW -> REJECTED. Reason required.
func (s *Service) Reject(ctx context.Context, reviewerID, id, reason string) (*Application, error) {
	if strings.TrimSpace(reason) == "" {
		return nil, ErrValidation
	}
	n, err := s.repo.TransitionStatus(ctx, id, "REJECTED",
		[]string{"SUBMITTED", "UNDER_REVIEW", "NEEDS_MORE_INFO"}, reason, nil, true)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrConflict
	}
	app, _ := s.repo.GetApplication(ctx, id)
	_ = s.repo.writeAudit(ctx, reviewerID, app.UserID, "application.rejected", id, map[string]any{"reason": reason})
	return app, nil
}

// RequestInfo moves SUBMITTED/UNDER_REVIEW -> NEEDS_MORE_INFO with a checklist.
func (s *Service) RequestInfo(ctx context.Context, reviewerID, id string, checklist []string) (*Application, error) {
	if len(checklist) == 0 {
		return nil, ErrValidation
	}
	n, err := s.repo.TransitionStatus(ctx, id, "NEEDS_MORE_INFO",
		[]string{"SUBMITTED", "UNDER_REVIEW"}, "", checklist, false)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrConflict
	}
	app, _ := s.repo.GetApplication(ctx, id)
	_ = s.repo.writeAudit(ctx, reviewerID, app.UserID, "application.info_requested", id, map[string]any{"checklist": checklist})
	return app, nil
}

// Escalate keeps the application UNDER_REVIEW but flags it (SUBMITTED->UNDER_REVIEW
// if needed) and writes an audit entry. Escalation does not change ownership.
func (s *Service) Escalate(ctx context.Context, reviewerID, id, note string) (*Application, error) {
	n, err := s.repo.TransitionStatus(ctx, id, "UNDER_REVIEW",
		[]string{"SUBMITTED", "UNDER_REVIEW"}, "", nil, false)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrConflict
	}
	app, _ := s.repo.GetApplication(ctx, id)
	_ = s.repo.writeAudit(ctx, reviewerID, app.UserID, "application.escalated", id, map[string]any{"note": note})
	return app, nil
}

// ─── Admin config ────────────────────────────────────────────────────────────

func (s *Service) CreateModule(ctx context.Context, req CreateModuleRequest) error {
	return s.repo.InsertModule(ctx, req)
}

func (s *Service) CreateMerchantType(ctx context.Context, req CreateMerchantTypeRequest) error {
	return s.repo.InsertMerchantType(ctx, req)
}

// CreateFormSchemaVersion publishes a new schema version for a merchant type. If no
// version is forced it auto-increments. Publishing repoints the type's current schema.
func (s *Service) CreateFormSchemaVersion(ctx context.Context, merchantTypeID string, req CreateFormSchemaRequest) (*FormSchema, error) {
	if _, err := s.repo.GetMerchantType(ctx, merchantTypeID); err != nil {
		return nil, err
	}
	version := req.Version
	if version <= 0 {
		max, err := s.repo.MaxSchemaVersion(ctx, merchantTypeID)
		if err != nil {
			return nil, err
		}
		version = max + 1
	}
	id := req.ID
	if id == "" {
		id = fmt.Sprintf("fs-%s-v%d", merchantTypeID, version)
	}
	status := req.Status
	if status == "" {
		status = "published"
	}
	fs := FormSchema{ID: id, MerchantTypeID: merchantTypeID, Version: version, Status: status, Steps: req.Steps}
	if err := s.repo.InsertFormSchema(ctx, fs); err != nil {
		if isUniqueViolation(err) {
			return nil, ErrConflict
		}
		return nil, err
	}
	return s.repo.GetFormSchema(ctx, id)
}

// notifyApproved fires a best-effort notification when a merchant is approved.
// Failures are logged and intentionally not propagated — the approval itself is
// already committed.
func notifyApproved(userID, merchantTypeName string) {
	log.Printf("[onboarding] merchant approved: user=%s type=%s", userID, merchantTypeName)
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}
