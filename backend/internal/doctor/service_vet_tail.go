package doctor

import (
	"context"
	"encoding/json"
)

// service_vet_tail.go — business logic for the VET licence / verification /
// profile-publish / profile-draft "tail" endpoints. Additive to service_vet.go
// (separate file to avoid colliding with concurrent edits there).
//
// These mirror the human-side service_account.go methods (RenewLicence,
// PublishProfile, SaveProfileDraft) and service.go SubmitVerification, but operate on
// the vet profile (doctor_vet_profiles) and use vet-unique names so nothing is
// redeclared. All four are mutations: those that re-enter verification or upsert the
// draft require an Idempotency-Key (ErrIdempotencyRequired); doctor_vet_profiles has no
// idempotency_key column, so the underlying UPDATEs are naturally idempotent on replay.
// None touch the money ledger.

// RenewVetLicence records a vet licence renewal: it stores the (optional) new licence
// number and re-enters verification (verification → 'pending'), retaining any renewal
// notes / documents on the vet row. Mirrors service_account.go RenewLicence (which
// re-submits a 'renewal' verification). Requires an Idempotency-Key.
func (s *Service) RenewVetLicence(ctx context.Context, userID, idemKey string, req SubmitVerificationRequest) (*VetProfile, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	// On the human side the licence number rides in on MDCNNumber; reuse the same field.
	return s.repo.RenewVetLicenceRecord(ctx, userID, req.MDCNNumber, marshalVetRenewalDetail(req))
}

// SubmitVetVerification submits the vet's verification, flipping the vet-scoped
// verification column to 'pending' and retaining the submitted documents / notes.
// Mirrors service.go SubmitVerification (which inserts a 'pending' doctor_verifications
// row) but targets the vet profile column. Requires an Idempotency-Key.
func (s *Service) SubmitVetVerification(ctx context.Context, userID, idemKey string, req SubmitVerificationRequest) (*VetProfile, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.SubmitVetVerificationRecord(ctx, userID, marshalVetVerificationDetail(req))
}

// PublishVetProfile marks the vet profile live. Fail-closed: the repository only
// publishes when verification == 'approved'. Mirrors service_account.go PublishProfile.
// Requires an Idempotency-Key.
func (s *Service) PublishVetProfile(ctx context.Context, userID, idemKey string) (*VetProfile, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.PublishVetProfile(ctx, userID)
}

// SaveVetProfileDraft patch-merges the supplied JSON into the vet profile_draft.
// Mirrors service_account.go SaveProfileDraft. Requires an Idempotency-Key.
func (s *Service) SaveVetProfileDraft(ctx context.Context, userID, idemKey string, patch json.RawMessage) (*VetProfile, error) {
	if idemKey == "" {
		return nil, ErrIdempotencyRequired
	}
	return s.repo.SaveVetProfileDraftRecord(ctx, userID, patch)
}
