package extranet

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// ErrVerificationIncomplete is returned by SubmitForReview when a required
// checklist item is not yet approved. Wrapped with the specific missing items so
// the caller/handler can surface them, but errors.Is still matches the sentinel.
var ErrVerificationIncomplete = errors.New("extranet: required checklist items are not yet complete")

// ErrBadDecision / ErrDecisionNoteRequired are AdminDecideKYB input-validation errors.
var (
	ErrBadDecision          = errors.New("extranet: decision must be approve, reject, or needs_changes")
	ErrDecisionNoteRequired = errors.New("extranet: a note is required to reject or request changes")
)

// GetVerificationStatus builds the go-live checklist for the caller's primary
// property (routes here carry no :propertyId — onboarding is scoped to "my one
// property in progress").
func (s *Service) GetVerificationStatus(ctx context.Context, userID string) (VerificationStatus, error) {
	propertyID, err := s.repo.ResolvePrimaryProperty(ctx, userID)
	if err != nil {
		return VerificationStatus{}, err
	}
	return s.buildVerificationStatus(ctx, propertyID)
}

// GetBusinessVerification returns the caller's business/KYC record (a zero-value,
// all-pending record if none has been entered yet).
func (s *Service) GetBusinessVerification(ctx context.Context, userID string) (BusinessVerification, error) {
	propertyID, err := s.repo.ResolvePrimaryProperty(ctx, userID)
	if err != nil {
		return BusinessVerification{}, err
	}
	k, _, err := s.repo.GetKYB(ctx, propertyID)
	if err != nil {
		return BusinessVerification{}, err
	}
	return toBusinessVerification(k), nil
}

// SubmitForReview validates the operationally-required checklist items (property
// details, content, availability — everything the owner can self-complete) and, if
// complete, moves the KYB record to 'submitted' for ops review. Business identity/
// document verification is deliberately NOT gated here (there is no self-serve way
// to enter it yet — see AdminDecideKYB) but DOES gate go_live_eligible, so a
// property can be submitted for review without it while still failing closed on
// actually going live. Re-validates independently of the frontend's own gate (the
// client's "remaining === 0" check is convenience only).
func (s *Service) SubmitForReview(ctx context.Context, userID string) (VerificationStatus, error) {
	propertyID, err := s.repo.ResolvePrimaryProperty(ctx, userID)
	if err != nil {
		return VerificationStatus{}, err
	}
	vs, err := s.buildVerificationStatus(ctx, propertyID)
	if err != nil {
		return VerificationStatus{}, err
	}
	var missing []string
	for _, item := range vs.Checklist {
		if item.Required && item.Status != VerifApproved {
			missing = append(missing, item.Label)
		}
	}
	if len(missing) > 0 {
		return VerificationStatus{}, fmt.Errorf("%w: %s", ErrVerificationIncomplete, strings.Join(missing, "; "))
	}
	if err := s.repo.SubmitKYB(ctx, propertyID); err != nil {
		return VerificationStatus{}, err
	}
	return s.buildVerificationStatus(ctx, propertyID)
}

// AdminDecideKYB is the ops review action (stays.admin.hotelier-gated, called from
// the admin console — not object-scoped, no owner grant check). It transcribes any
// business fields supplied and records approve/reject/needs_changes.
func (s *Service) AdminDecideKYB(ctx context.Context, propertyID, reviewerID string, in BusinessVerificationInput, decision, note string) (VerificationStatus, error) {
	verdict, ok := kybDecisionStatus(decision)
	if !ok {
		return VerificationStatus{}, ErrBadDecision
	}
	if (verdict == VerifRejected || verdict == VerifNeedsChanges) && strings.TrimSpace(note) == "" {
		return VerificationStatus{}, ErrDecisionNoteRequired
	}
	if err := s.repo.AdminDecideKYB(ctx, propertyID,
		in.LegalName, in.BusinessType, in.RCNumber, in.TIN, in.DirectorName, in.DirectorBVN,
		in.ContactEmail, in.ContactPhone, reviewerID, note, verdict); err != nil {
		return VerificationStatus{}, err
	}
	return s.buildVerificationStatus(ctx, propertyID)
}

// BusinessVerificationInput is the ops-entered business record (AdminDecideKYB).
// Blank fields leave the existing stored value untouched.
type BusinessVerificationInput struct {
	LegalName    string
	BusinessType string
	RCNumber     string
	TIN          string
	DirectorName string
	DirectorBVN  string
	ContactEmail string
	ContactPhone string
}

func toBusinessVerification(k kyb) BusinessVerification {
	kyc, doc := k.KYCStatus, k.BusinessDocStatus
	if kyc == "" {
		kyc = VerifPending
	}
	if doc == "" {
		doc = VerifPending
	}
	return BusinessVerification{
		LegalName:         k.LegalName,
		RCNumber:          k.RCNumber,
		TIN:               k.TIN,
		KYCStatus:         kyc,
		BusinessDocStatus: doc,
		DirectorName:      k.DirectorName,
		DirectorBVNLast4:  bvnLast4(k.DirectorBVN),
	}
}

// buildVerificationStatus computes the checklist from real signals: property
// content fields, room types + rate plans, upcoming availability, and the KYB
// record. Nothing here is faked — an incomplete/unbuilt signal (e.g. policies,
// which has no backing table yet) reads as pending with an explanatory detail
// rather than a fabricated pass.
func (s *Service) buildVerificationStatus(ctx context.Context, propertyID string) (VerificationStatus, error) {
	prop, err := s.repo.GetProperty(ctx, propertyID)
	if err != nil {
		return VerificationStatus{}, err
	}
	k, hasKYB, err := s.repo.GetKYB(ctx, propertyID)
	if err != nil {
		return VerificationStatus{}, err
	}
	roomTypes, err := s.repo.ListRoomTypes(ctx, propertyID)
	if err != nil {
		return VerificationStatus{}, err
	}
	ratePlans, err := s.repo.ListRatePlans(ctx, propertyID)
	if err != nil {
		return VerificationStatus{}, err
	}
	hasAvailability, err := s.repo.HasUpcomingAvailability(ctx, propertyID)
	if err != nil {
		return VerificationStatus{}, err
	}

	propertyDone := prop.Address != "" && prop.City != ""
	contentDone := prop.Description != "" && len(roomTypes) >= 1 && len(ratePlans) >= 1

	kycStatus, docStatus := VerifPending, VerifPending
	if hasKYB {
		if k.KYCStatus != "" {
			kycStatus = k.KYCStatus
		}
		if k.BusinessDocStatus != "" {
			docStatus = k.BusinessDocStatus
		}
	}

	checklist := []VerificationChecklistItem{
		{Key: "signup", Label: "Hotelier account created", Stage: "signup", Status: VerifApproved, Required: true},
		{Key: "property", Label: "Property registered (name, type, address, city)", Stage: "property",
			Status: statusIf(propertyDone), Required: true},
		{Key: "content", Label: "Property description and at least one room type with a rate plan", Stage: "content",
			Status: statusIf(contentDone), Required: true},
		{Key: "business_identity", Label: "Business identity verified (legal name, CAC, TIN, director KYC)", Stage: "verification",
			Status: kycStatus, Required: false,
			Detail: verificationDetail(kycStatus, "Send your business documents to Paymax support to begin review.")},
		{Key: "business_documents", Label: "Supporting business documents reviewed", Stage: "verification",
			Status: docStatus, Required: false,
			Detail: verificationDetail(docStatus, "Send your business documents to Paymax support to begin review.")},
		{Key: "policies", Label: "Policies configured (check-in/out, cancellation)", Stage: "policies",
			Status: VerifPending, Required: false, Detail: "Policy setup is not yet available in the extranet."},
		{Key: "availability", Label: "Availability & rates loaded (next 90 days)", Stage: "go_live",
			Status: statusIf(hasAvailability), Required: true},
	}

	overall := VerifPending
	if hasKYB && k.Status != "" {
		overall = k.Status
	}

	goLiveEligible := overall == VerifApproved && kycStatus == VerifApproved && docStatus == VerifApproved
	for _, item := range checklist {
		if item.Required && item.Status != VerifApproved {
			goLiveEligible = false
			break
		}
	}

	vs := VerificationStatus{
		PropertyID:     propertyID,
		PropertyName:   prop.Name,
		Overall:        overall,
		GoLiveEligible: goLiveEligible,
		Checklist:      checklist,
	}
	if hasKYB {
		vs.SubmittedForReviewAt = k.SubmittedForReviewAt
		vs.ReviewedAt = k.ReviewedAt
		vs.ReviewerNote = k.ReviewerNote
	}
	return vs, nil
}

func statusIf(done bool) VerificationItemStatus {
	if done {
		return VerifApproved
	}
	return VerifInProgress
}

func verificationDetail(status VerificationItemStatus, pendingDetail string) string {
	if status == VerifPending {
		return pendingDetail
	}
	return ""
}
