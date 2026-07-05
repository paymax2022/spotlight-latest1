package credential

import (
	"context"
	"errors"
	"fmt"
	"time"

	providers "spotlight/backend/internal/health/providers"
)

// ErrForbidden is an object-level authZ failure.
var ErrForbidden = errors.New("credential: forbidden")

// ErrIllegalTransition guards the record SM.
var ErrIllegalTransition = errors.New("credential: illegal status transition")

// ---- Ports (reuse existing platform services; never rebuilt) ----

// ProvidersPort is the slice of the providers.Service this package drives. It is
// satisfied directly by *providers.Service. The credential layer never writes the
// application state raw — it goes through these guarded transitions (HL: guarded
// SM only) and the idempotent capability grant on Decision("approve").
type ProvidersPort interface {
	GetApplication(ctx context.Context, ownerID, applicationID string) (*providers.Application, error)
	AddCredential(ctx context.Context, ownerID, applicationID string, d providers.CredentialDoc) (*providers.CredentialDoc, error)
	Submit(ctx context.Context, ownerID, applicationID string) (*providers.Application, error)
	Decision(ctx context.Context, actorID, applicationID, action, note string) (*providers.Application, error)
	SuspendExpired(ctx context.Context, now time.Time) (int, error)
}

// IdentityReader exposes the Paymax KYC identity snapshot for cross-checking the
// vet's entered name/DOB. NDPA: read-only; never persisted as a register copy.
type IdentityReader interface {
	Snapshot(ctx context.Context, userID string) (IdentitySnapshot, error)
}

// IdentitySnapshot is the minimal identity view from KYC + profile.
type IdentitySnapshot struct {
	FullName string
	DOB      *string // ISO YYYY-MM-DD if known
	KYCTier  int
	HasNIN   bool
	HasBVN   bool
}

// Signer turns an R2 storage key into a short-lived signed URL (HL-8 delivery).
type Signer interface {
	SignGet(ctx context.Context, storageKey string) (string, error)
}

// SchedulerPort schedules the licence-expiry re-verify/auto-suspend job. ownerID
// owns the job row (scheduler_jobs.owner_user_id FK auth.users); entityRef is the
// application id the sweep concerns.
type SchedulerPort interface {
	ScheduleAt(ctx context.Context, jobType, ownerID, entityRef string, runAt time.Time, payload map[string]any) error
}

// Auditor writes the immutable audit trail (HL-12).
type Auditor interface {
	Log(actorID, action, entityType, entityID string, meta map[string]any)
}

// Store is the data layer the service depends on (satisfied by *Repository).
// Decoupled as an interface so the service is unit-testable with fakes (no DB).
type Store interface {
	CreateRecord(ctx context.Context, rec *VerificationRecord) error
	GetRecord(ctx context.Context, id string) (*VerificationRecord, error)
	LatestByApplication(ctx context.Context, applicationID string) (*VerificationRecord, error)
	ListQueue(ctx context.Context, status Status, limit int) ([]QueueItem, error)
	DecideRecord(ctx context.Context, id string, from, to Status, reviewerID, notes string, licenceExpiry *time.Time) (bool, error)
	SetLicenceExpiryOnDoc(ctx context.Context, applicationID string, expiry time.Time) error
	GetDoc(ctx context.Context, docID string) (*DocRef, error)
	LogDocAccess(ctx context.Context, docID, accessorID, basis string) error
	GetApplicationMeta(ctx context.Context, applicationID string) (*AppMeta, error)
}

// SystemActor is the actor recorded when the system (not a human) advances state
// (e.g. auto-advance SUBMITTED→UNDER_REVIEW on submit).
const SystemActor = "system"

// JobLicenceSweep is the scheduler job type that runs SuspendExpired (HL-2).
const JobLicenceSweep = "health.vcn.licence_sweep"

// Service orchestrates Mode-B VCN verification on top of the providers SM.
type Service struct {
	repo      Store
	verifier  CredentialVerifier
	providers ProvidersPort
	identity  IdentityReader
	signer    Signer
	sched     SchedulerPort
	audit     Auditor
}

func NewService(repo Store, verifier CredentialVerifier, prov ProvidersPort, id IdentityReader, signer Signer, sched SchedulerPort, audit Auditor) *Service {
	return &Service{repo: repo, verifier: verifier, providers: prov, identity: id, signer: signer, sched: sched, audit: audit}
}

func (s *Service) logf(actorID, action, entityID string, meta map[string]any) {
	if s.audit != nil {
		s.audit.Log(actorID, action, "health.verification", entityID, meta)
	}
}

// SubmitInput is the vet-entered submission.
type SubmitInput struct {
	ApplicationID string
	RegNumber     string
	FullName      string
	DOB           string // YYYY-MM-DD
	Consent       bool   // NDPA: explicit consent to verify
	// Evidence docs already uploaded to R2; each {Type ∈ VCN_CERT|ANNUAL_LICENCE|GOV_ID, StorageKey}.
	Docs []SubmitDoc
}

type SubmitDoc struct {
	Type       string // VCN_CERT | ANNUAL_LICENCE | GOV_ID
	StorageKey string
}

var validDocTypes = map[string]bool{"VCN_CERT": true, "ANNUAL_LICENCE": true, "GOV_ID": true}

// Submit is the vet-facing action: attach evidence docs, run the identity
// cross-check, create the PENDING VerificationRecord, and advance the
// ProviderApplication to UNDER_REVIEW. Object-level authZ: only the owner of the
// application may submit. NDPA: requires explicit consent; never stores register data.
func (s *Service) Submit(ctx context.Context, ownerID string, in SubmitInput) (*VerificationRecord, error) {
	if !in.Consent {
		return nil, fmt.Errorf("credential: consent required to verify (NDPA)")
	}
	if in.RegNumber == "" || in.FullName == "" {
		return nil, fmt.Errorf("credential: reg_number and full_name required")
	}
	// Object-level authZ + must be a vet application (GetApplication enforces owner).
	app, err := s.providers.GetApplication(ctx, ownerID, in.ApplicationID)
	if err != nil {
		return nil, ErrForbidden
	}
	if app.ProviderType != "vet" {
		return nil, fmt.Errorf("credential: not a vet application")
	}

	// Attach evidence docs to the vault (reuses providers.AddCredential, HL-8 —
	// storage key only, never a blob; access is logged on read).
	docIDs := make([]string, 0, len(in.Docs))
	for _, d := range in.Docs {
		if !validDocTypes[d.Type] {
			return nil, fmt.Errorf("credential: invalid doc type %q", d.Type)
		}
		cd, derr := s.providers.AddCredential(ctx, ownerID, in.ApplicationID, providers.CredentialDoc{
			CredType:    d.Type,
			ReferenceNo: in.RegNumber,
			StorageKey:  d.StorageKey,
		})
		if derr != nil {
			return nil, fmt.Errorf("credential: attach doc: %w", derr)
		}
		docIDs = append(docIDs, cd.ID)
	}

	// Identity cross-check against Paymax KYC (NIN/BVN) → reviewer flags. Does not
	// block; a mismatch is surfaced for the human reviewer.
	var matched map[string]string
	if s.identity != nil {
		if snap, ierr := s.identity.Snapshot(ctx, ownerID); ierr == nil {
			matched = computeMatchedFields(in.FullName, in.DOB, snap)
		}
	}
	if matched == nil {
		matched = map[string]string{"name": matchUnverifiable, "dob": matchUnverifiable, "kyc": matchUnverifiable}
	}

	// Kick the verifier (Mode B ⇒ PENDING; a future API adapter could return a
	// synchronous verdict and the flow below would apply it uniformly).
	res, err := s.verifier.Verify(ctx, VerifyRequest{
		ApplicationID: in.ApplicationID, OwnerUserID: ownerID, Capability: "vet",
		RegNumber: in.RegNumber, FullName: in.FullName, DOB: in.DOB, EvidenceDocs: docIDs,
	})
	if err != nil {
		return nil, fmt.Errorf("credential: verifier: %w", err)
	}

	now := time.Now()
	rec := &VerificationRecord{
		ProviderApplicationID: in.ApplicationID,
		Capability:            "vet",
		Source:                res.Source,
		Method:                res.Method,
		Status:                StatusPending,
		RegNumber:             in.RegNumber,
		MatchedFields:         matched,
		EvidenceDocIDs:        docIDs,
		ConsentAt:             &now,
	}
	if err := s.repo.CreateRecord(ctx, rec); err != nil {
		return nil, err
	}

	// Advance the application into the ops queue: DRAFT→SUBMITTED (owner) then
	// SUBMITTED→UNDER_REVIEW (system). Guarded transitions only.
	if app.State == providers.StateDraft {
		if _, err := s.providers.Submit(ctx, ownerID, in.ApplicationID); err != nil {
			return nil, fmt.Errorf("credential: submit application: %w", err)
		}
	}
	if _, err := s.providers.Decision(ctx, SystemActor, in.ApplicationID, "start_review", "assisted VCN verification submitted"); err != nil {
		// NEEDS_INFO resubmits go DRAFT→SUBMITTED→UNDER_REVIEW too; if already
		// under review this is a no-op error we can ignore for idempotency.
		_ = err
	}

	// HL-12: audit the submission (no PII / reg data in the audit meta).
	s.logf(ownerID, "health.vcn.verification.submitted", rec.ID, map[string]any{
		"application_id": in.ApplicationID, "source": string(res.Source), "method": string(res.Method),
		"doc_count": len(docIDs), "identity_flag": hasIdentityFlag(matched),
	})
	return rec, nil
}

// MyStatus returns the SANITISED, vet-facing status — never VCN/register data,
// matched-field detail, reviewer identity, or notes (NDPA minimisation).
// Object-level authZ: only the application owner may read.
func (s *Service) MyStatus(ctx context.Context, ownerID, applicationID string) (*PublicStatus, error) {
	if _, err := s.providers.GetApplication(ctx, ownerID, applicationID); err != nil {
		return nil, ErrForbidden // owner check
	}
	rec, err := s.repo.LatestByApplication(ctx, applicationID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return &PublicStatus{ApplicationID: applicationID, Capability: "vet", Stage: "pending_review"}, nil
		}
		return nil, err
	}
	return &PublicStatus{ApplicationID: applicationID, Capability: rec.Capability, Stage: publicStage(rec.Status)}, nil
}

// ListQueue returns the ops review queue (PENDING vet verifications).
func (s *Service) ListQueue(ctx context.Context, limit int) ([]QueueItem, error) {
	return s.repo.ListQueue(ctx, StatusPending, limit)
}

// GetRecordAdmin returns the full record for a reviewer (no owner scoping).
func (s *Service) GetRecordAdmin(ctx context.Context, recordID string) (*VerificationRecord, error) {
	return s.repo.GetRecord(ctx, recordID)
}

// DocSignedURL returns a short-lived signed URL for an evidence doc and writes an
// access-log row (NDPA: every read logged). Object-level authZ: the document's
// application owner, OR a reviewer (isReviewer=true) — enforced by the caller's
// route RBAC + this owner/reviewer check.
func (s *Service) DocSignedURL(ctx context.Context, accessorID, docID string, isReviewer bool) (string, error) {
	doc, err := s.repo.GetDoc(ctx, docID)
	if err != nil {
		return "", err
	}
	basis := ""
	switch {
	case doc.OwnerUserID == accessorID:
		basis = "OWNER"
	case isReviewer:
		basis = "REVIEWER"
	default:
		return "", ErrForbidden
	}
	// Access-log BEFORE returning any URL (HL-12 / NDPA).
	if err := s.repo.LogDocAccess(ctx, docID, accessorID, basis); err != nil {
		return "", err
	}
	s.logf(accessorID, "health.vcn.document.accessed", docID, map[string]any{"basis": basis, "cred_type": doc.CredType})
	if s.signer == nil {
		return "", nil
	}
	return s.signer.SignGet(ctx, doc.StorageKey)
}

// Decide is the ops verdict. action ∈ approve | need_info | reject. Object-level
// authZ: reviewerID must NOT be the application owner (no self-approval); route
// RBAC enforces the ops role. Guarded record SM + idempotent capability grant.
func (s *Service) Decide(ctx context.Context, reviewerID, recordID, action string, licenceExpiry *time.Time, notes string) (*VerificationRecord, error) {
	rec, err := s.repo.GetRecord(ctx, recordID)
	if err != nil {
		return nil, err
	}
	meta, err := s.repo.GetApplicationMeta(ctx, rec.ProviderApplicationID)
	if err != nil {
		return nil, err
	}
	if meta.OwnerUserID == reviewerID {
		return nil, ErrForbidden // HL: a vet can NEVER self-approve
	}

	to := map[string]Status{"approve": StatusVerified, "need_info": StatusNeedsInfo, "reject": StatusRejected}[action]
	if to == "" {
		return nil, fmt.Errorf("credential: unknown action %q", action)
	}
	if action == "approve" && licenceExpiry == nil {
		return nil, fmt.Errorf("credential: licence_expiry required to approve")
	}
	// Idempotency: a repeated identical terminal decision is a no-op success.
	if rec.Status == to {
		return rec, nil
	}
	if !canTransitionStatus(rec.Status, to) {
		return nil, fmt.Errorf("%w: %s→%s", ErrIllegalTransition, rec.Status, to)
	}
	// Atomic guarded transition at the DB (WHERE status=from): only one decision
	// can win; a concurrent/duplicate decision applies nothing.
	ok, err := s.repo.DecideRecord(ctx, recordID, rec.Status, to, reviewerID, notes, licenceExpiry)
	if err != nil {
		return nil, err
	}
	if !ok {
		// Lost the race or state moved underneath us: reload and treat a matching
		// terminal state as idempotent success, otherwise a conflict.
		cur, gerr := s.repo.GetRecord(ctx, recordID)
		if gerr == nil && cur.Status == to {
			return cur, nil
		}
		return nil, fmt.Errorf("%w (state changed)", ErrIllegalTransition)
	}
	if action == "approve" {
		// Mirror licence expiry onto the ANNUAL_LICENCE doc so the existing
		// providers.SuspendExpired HL-2 sweep auto-suspends on expiry.
		if err := s.repo.SetLicenceExpiryOnDoc(ctx, rec.ProviderApplicationID, *licenceExpiry); err != nil {
			return nil, err
		}
	}

	// Drive the application SM (both guarded + idempotent capability grant).
	provAction := map[string]string{"approve": "approve", "need_info": "need_info", "reject": "reject"}[action]
	if _, err := s.providers.Decision(ctx, reviewerID, rec.ProviderApplicationID, provAction, notes); err != nil {
		// On approve, providers.Decision grants the capability idempotently. If it
		// errors because the app is already APPROVED (recovery/retry), that's fine.
		s.logf(reviewerID, "health.vcn.application.decision_warn", rec.ProviderApplicationID, map[string]any{"action": provAction, "err": err.Error()})
	}

	// On approve, schedule the licence-expiry auto-suspend sweep (HL-2). The job is
	// owned by the vet (FK) and references their application.
	if action == "approve" && s.sched != nil {
		_ = s.sched.ScheduleAt(ctx, JobLicenceSweep, meta.OwnerUserID, rec.ProviderApplicationID, *licenceExpiry, map[string]any{
			"application_id": rec.ProviderApplicationID, "reason": "licence_expiry",
		})
	}

	rec.Status = to
	rec.ReviewerID = &reviewerID
	rec.Notes = notes
	rec.LicenceExpiry = licenceExpiry
	s.logf(reviewerID, "health.vcn.verification.decided", recordID, map[string]any{
		"application_id": rec.ProviderApplicationID, "action": action, "status": string(to),
	})
	return rec, nil
}

// RunLicenceSweep is the scheduler-invoked HL-2 auto-suspend: any APPROVED vet
// whose licence has expired is suspended + de-listed. Idempotent.
func (s *Service) RunLicenceSweep(ctx context.Context, now time.Time) (int, error) {
	n, err := s.providers.SuspendExpired(ctx, now)
	if err != nil {
		return 0, err
	}
	if n > 0 {
		s.logf(SystemActor, "health.vcn.licence.auto_suspended", "", map[string]any{"count": n, "as_of": now.UTC().Format(time.RFC3339)})
	}
	return n, nil
}

func (s *Service) metaForRecord(ctx context.Context, recordID string) (*AppMeta, error) {
	rec, err := s.repo.GetRecord(ctx, recordID)
	if err != nil {
		return nil, err
	}
	return s.repo.GetApplicationMeta(ctx, rec.ProviderApplicationID)
}
