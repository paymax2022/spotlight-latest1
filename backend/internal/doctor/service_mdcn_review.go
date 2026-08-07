package doctor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"spotlight/backend/internal/health/credential"
	"spotlight/backend/internal/platform/r2"
)

// service_mdcn_review.go — the ops (assisted) review service for MDCN doctor
// verification. AUGMENTS the existing doctor_verifications system of record with
// the Mode-B pieces the doctor flow lacked: an ops decision layer, an identity
// cross-check (name/DOB ↔ Paymax KYC), access-logged signed-URL document reads,
// idempotent capability grant (discoverability), and licence-expiry auto-suspend.
//
// The doctor never sees the MDCN portal; an ops reviewer confirms the registration
// out-of-band and records the decision here. HL-2 (credential-gated discoverability,
// auto-suspend on expiry), HL-12 (immutable audit), NDPA (access-logged docs,
// result+reference only) are enforced.

// ErrReviewForbidden is an object-level authZ failure (e.g. self-approval).
var ErrReviewForbidden = errors.New("doctor: review forbidden")

// ErrReviewIllegalTransition guards the verification status SM.
var ErrReviewIllegalTransition = errors.New("doctor: illegal verification transition")

// IdentityReader exposes the Paymax KYC identity snapshot for the cross-check.
type IdentityReader interface {
	Snapshot(ctx context.Context, userID string) (credential.IdentitySnapshot, error)
}

// LicenceScheduler schedules the licence-expiry auto-suspend sweep (HL-2).
type LicenceScheduler interface {
	ScheduleAt(ctx context.Context, jobType, ownerID, entityRef string, runAt time.Time, payload map[string]any) error
}

// JobMDCNLicenceSweep is the scheduler job type running the auto-suspend sweep.
const JobMDCNLicenceSweep = "health.mdcn.licence_sweep"

// mdcnStore is the data layer the review service depends on (satisfied by
// *Repository). Decoupled as an interface so the service is unit-testable with
// fakes (no DB).
type mdcnStore interface {
	ListPendingMDCN(ctx context.Context, limit int) ([]MDCNQueueItem, error)
	GetMDCNVerification(ctx context.Context, verificationID string) (*MDCNReviewRecord, error)
	PersistMatchedFields(ctx context.Context, verificationID string, matched map[string]string) error
	GetVerificationOwner(ctx context.Context, verificationID string) (userID, status string, err error)
	DecideMDCN(ctx context.Context, verificationID, from, to, reviewerID, notes string, licenceExpiry *time.Time, discipline *string, outcome *string) (bool, error)
	SetProfileVerification(ctx context.Context, userID, verification string, publish *bool) error
	GetVerificationDoc(ctx context.Context, docID string) (*MDCNDocRef, error)
	LogVerificationDocAccess(ctx context.Context, docID, accessorID, basis string) error
	SuspendExpiredDoctorLicences(ctx context.Context, now time.Time) (int, error)
	InsertAudit(ctx context.Context, userID, action, entityType, entityID, idemKey string, detail any) error
}

// MDCNReviewService is a standalone service over the shared Repository — it does
// not modify the large doctor Service. Constructed in the wiring layer.
type MDCNReviewService struct {
	repo      mdcnStore
	verifier  credential.CredentialVerifier // MDCNAdapter (ASSISTED)
	identity  IdentityReader
	presigner *r2.Presigner
	sched     LicenceScheduler
}

func NewMDCNReviewService(repo mdcnStore, verifier credential.CredentialVerifier, identity IdentityReader, presigner *r2.Presigner, sched LicenceScheduler) *MDCNReviewService {
	return &MDCNReviewService{repo: repo, verifier: verifier, identity: identity, presigner: presigner, sched: sched}
}

const docSignTTL = 5 * time.Minute

// allowedDoctorVerif guards the ops review transitions on doctor_verifications.
// (Resubmit needs_info→pending is the doctor's own SubmitVerification path.)
var allowedDoctorVerif = map[string]map[string]bool{
	"pending":    {"approved": true, "needs_info": true, "rejected": true},
	"needs_info": {"approved": true, "rejected": true},
	"approved":   {},
	"rejected":   {},
}

func canDoctorVerif(from, to string) bool {
	if from == to {
		return false
	}
	nx, ok := allowedDoctorVerif[from]
	return ok && nx[to]
}

// ListQueue returns the pending/needs-info MDCN review queue.
func (s *MDCNReviewService) ListQueue(ctx context.Context, limit int) ([]MDCNQueueItem, error) {
	return s.repo.ListPendingMDCN(ctx, limit)
}

// GetForReview returns the full record, computing + persisting the identity
// cross-check (name ↔ KYC) so the reviewer sees current flags.
func (s *MDCNReviewService) GetForReview(ctx context.Context, verificationID string) (*MDCNReviewRecord, error) {
	rec, err := s.repo.GetMDCNVerification(ctx, verificationID)
	if err != nil {
		return nil, err
	}
	if s.identity != nil {
		if snap, ierr := s.identity.Snapshot(ctx, rec.UserID); ierr == nil {
			matched := credential.CrossCheckIdentity(rec.DoctorName, "", snap)
			rec.MatchedFields = matched
			_ = s.repo.PersistMatchedFields(ctx, verificationID, matched)
		}
	}
	return rec, nil
}

// DocSignedURL returns a short-lived signed URL for a verification document and
// writes an access-log row (NDPA: every read logged). Object-level authZ: the
// owning doctor, or a reviewer.
func (s *MDCNReviewService) DocSignedURL(ctx context.Context, accessorID, docID string, isReviewer bool) (string, error) {
	doc, err := s.repo.GetVerificationDoc(ctx, docID)
	if err != nil {
		return "", err
	}
	basis := ""
	switch {
	case doc.UserID == accessorID:
		basis = "OWNER"
	case isReviewer:
		basis = "REVIEWER"
	default:
		return "", ErrReviewForbidden
	}
	if err := s.repo.LogVerificationDocAccess(ctx, docID, accessorID, basis); err != nil {
		return "", err
	}
	_ = s.repo.InsertAudit(ctx, accessorID, "doctor.mdcn.document.accessed", "verification_document", docID, "", map[string]any{"basis": basis, "doc_type": doc.DocType})
	if s.presigner == nil || !s.presigner.Configured() || doc.FileKey == "" {
		return "", nil
	}
	return s.presigner.PresignGet(doc.FileKey, docSignTTL)
}

// MDCNDecision is the ops verdict input.
type MDCNDecision struct {
	Action        string     // approve | need_info | reject
	LicenceExpiry *time.Time // required for approve
	Discipline    *string    // medical | dental (set/confirmed on approve)
	Notes         string
}

// Decide records the ops verdict. Object-level authZ: reviewerID must NOT be the
// owning doctor (no self-approval); route RBAC enforces health.doctor.review.
// Guarded status SM + idempotent capability grant (discoverability) on approve.
func (s *MDCNReviewService) Decide(ctx context.Context, reviewerID, verificationID string, in MDCNDecision) (*MDCNReviewRecord, error) {
	ownerID, cur, err := s.repo.GetVerificationOwner(ctx, verificationID)
	if err != nil {
		return nil, err
	}
	if ownerID == reviewerID {
		return nil, ErrReviewForbidden // a doctor can NEVER self-approve
	}

	to := map[string]string{"approve": "approved", "need_info": "needs_info", "reject": "rejected"}[in.Action]
	if to == "" {
		return nil, fmt.Errorf("doctor: unknown action %q", in.Action)
	}
	if in.Action == "approve" {
		if in.LicenceExpiry == nil {
			return nil, fmt.Errorf("doctor: licence_expiry required to approve")
		}
		if in.Discipline == nil || (*in.Discipline != "medical" && *in.Discipline != "dental") {
			return nil, fmt.Errorf("doctor: discipline (medical|dental) required to approve")
		}
	}
	// Idempotency: repeated identical terminal decision is a no-op success.
	if cur == to {
		return s.repo.GetMDCNVerification(ctx, verificationID)
	}
	if !canDoctorVerif(cur, to) {
		return nil, fmt.Errorf("%w: %s→%s", ErrReviewIllegalTransition, cur, to)
	}

	var outcome *string
	if in.Action == "approve" || in.Action == "reject" {
		o := to
		outcome = &o
	}
	ok, err := s.repo.DecideMDCN(ctx, verificationID, cur, to, reviewerID, in.Notes, in.LicenceExpiry, in.Discipline, outcome)
	if err != nil {
		return nil, err
	}
	if !ok {
		// Lost the race / state moved: treat a matching state as idempotent success.
		again, gerr := s.repo.GetMDCNVerification(ctx, verificationID)
		if gerr == nil && again.Status == to {
			return again, nil
		}
		return nil, fmt.Errorf("%w (state changed)", ErrReviewIllegalTransition)
	}

	// HL-2: flip the discoverability gate on doctor_profiles. Idempotent.
	publishTrue := true
	publishFalse := false
	switch in.Action {
	case "approve":
		_ = s.repo.SetProfileVerification(ctx, ownerID, "approved", &publishTrue)
		if s.sched != nil {
			_ = s.sched.ScheduleAt(ctx, JobMDCNLicenceSweep, ownerID, verificationID, *in.LicenceExpiry, map[string]any{
				"user_id": ownerID, "reason": "licence_expiry",
			})
		}
	case "reject":
		_ = s.repo.SetProfileVerification(ctx, ownerID, "rejected", &publishFalse)
	case "need_info":
		_ = s.repo.SetProfileVerification(ctx, ownerID, "needs_info", &publishFalse)
	}

	// HL-12: immutable audit (no register data / PII in meta).
	_ = s.repo.InsertAudit(ctx, reviewerID, "doctor.mdcn.verification.decided", "doctor_verification", verificationID, "",
		map[string]any{"action": in.Action, "status": to, "doctor_user_id": ownerID})

	return s.repo.GetMDCNVerification(ctx, verificationID)
}

// RunLicenceSweep is the scheduler-invoked HL-2 auto-suspend.
func (s *MDCNReviewService) RunLicenceSweep(ctx context.Context, now time.Time) (int, error) {
	n, err := s.repo.SuspendExpiredDoctorLicences(ctx, now)
	if err != nil {
		return 0, err
	}
	if n > 0 {
		_ = s.repo.InsertAudit(ctx, "system", "doctor.mdcn.licence.auto_suspended", "doctor_profiles", "", "",
			map[string]any{"count": n, "as_of": now.UTC().Format(time.RFC3339)})
	}
	return n, nil
}
