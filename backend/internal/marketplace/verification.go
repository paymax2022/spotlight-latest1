package marketplace

// verification.go — self-serve trust-badge verification requests.
//
// P0 trust-badge forgery fix: POST /verification/{id,business} used to take an
// EMPTY body and permanently set verified_id_badge / verified_business_badge
// synchronously — no document, no provider check, no review. The OpenAPI
// contract (MktVerificationIdRequest / MktVerificationBusinessRequest →
// 202 {status:"pending"}) always described a queued, reviewed flow; the
// implementation now honors it:
//
//   - the POST must carry a real artifact (id_type + document_url, or
//     cac_number + document_url); an empty body is a 400;
//   - the request lands in mkt_verification_requests as status='pending' and
//     flags mkt_user_moderation.kyc_pending so it surfaces in the existing
//     admin user-review queue;
//   - the badge itself is granted ONLY inside Service.ReviewKYC on an
//     admin "approve" decision — never synchronously from a self-serve POST.

import (
	"context"
	"net/http"
	"strings"
	"time"
)

// VerificationKind is mkt_verification_requests.kind — which badge the
// submission is asking for.
type VerificationKind string

const (
	VerificationKindID       VerificationKind = "id"
	VerificationKindBusiness VerificationKind = "business"
)

// Verification request lifecycle (mkt_verification_requests.status).
const (
	VerificationStatusPending  = "pending"
	VerificationStatusApproved = "approved"
	VerificationStatusRejected = "rejected"
)

// validVerificationIDTypes mirrors the contract's id_type enum.
var validVerificationIDTypes = map[string]bool{
	"nin":             true,
	"bvn":             true,
	"drivers_license": true,
	"passport":        true,
	"voters_card":     true,
}

// maxVerificationFieldLen bounds every free-text artifact field.
const maxVerificationFieldLen = 2048

// VerificationIDInput is the POST /verification/id body
// (contract: MktVerificationIdRequest — required: id_type, document_url).
type VerificationIDInput struct {
	IDType      string  `json:"id_type"`
	DocumentURL string  `json:"document_url"`
	SelfieURL   *string `json:"selfie_url,omitempty"`
}

// VerificationBusinessInput is the POST /verification/business body
// (contract: MktVerificationBusinessRequest — required: cac_number, document_url).
type VerificationBusinessInput struct {
	CACNumber   string `json:"cac_number"`
	DocumentURL string `json:"document_url"`
}

// VerificationRequest mirrors one mkt_verification_requests row.
type VerificationRequest struct {
	ID        string           `json:"id"`
	UserID    string           `json:"-"`
	MarketID  string           `json:"market_id"`
	Kind      VerificationKind `json:"kind"`
	Status    string           `json:"status"`
	CreatedAt time.Time        `json:"created_at"`
}

// ErrVerificationPending — a second self-serve submit while one request of the
// same kind is still awaiting review (enforced by the
// mkt_verification_requests_one_pending partial unique index).
var ErrVerificationPending = newErr(http.StatusConflict, CodeConflict,
	"a verification request is already pending review")

// validateVerificationArtifact checks a submitted document reference: required,
// bounded, and free of control bytes (a NUL/invalid-UTF8 string would otherwise
// abort at Postgres with a 500 rather than a caller-visible 400).
func validateVerificationArtifact(v, field string) error {
	if v == "" {
		return fieldErr(CodeValidation, field+" is required", field)
	}
	if len(v) > maxVerificationFieldLen {
		return fieldErr(CodeValidation, field+" is too long", field)
	}
	for _, r := range v {
		if r < 0x20 || r == 0x7f {
			return fieldErr(CodeValidation, field+" contains invalid characters", field)
		}
	}
	return nil
}

// submitVerification is the shared tail of both submit endpoints: file the
// pending request, then flag kyc_pending so the existing admin KYC queue sees
// it (ReviewKYC clears the flag AND resolves the request — see service_admin.go).
func (s *Service) submitVerification(ctx context.Context, userID string, kind VerificationKind, payload map[string]any) (*VerificationRequest, error) {
	req, err := s.repo.InsertVerificationRequest(ctx, userID, DefaultMarketID, kind, payload)
	if err != nil {
		return nil, err
	}
	// kyc_pending is the queue flag the admin users screen already reads;
	// GetOrInit first because a user with no prior moderation touch has no row.
	if _, err := s.repo.GetOrInitUserModeration(ctx, userID, DefaultMarketID); err != nil {
		return nil, err
	}
	if _, err := s.repo.MarkKYCPending(ctx, userID, DefaultMarketID); err != nil {
		return nil, err
	}
	return req, nil
}

// SubmitIDVerification files a pending ID-verification request. The badge is
// NOT set here — a self-serve POST can only queue evidence for review.
func (s *Service) SubmitIDVerification(ctx context.Context, userID string, in VerificationIDInput) (*VerificationRequest, error) {
	idType := strings.ToLower(strings.TrimSpace(in.IDType))
	if !validVerificationIDTypes[idType] {
		return nil, fieldErr(CodeValidation, "id_type must be one of nin, bvn, drivers_license, passport, voters_card", "id_type")
	}
	doc := strings.TrimSpace(in.DocumentURL)
	if err := validateVerificationArtifact(doc, "document_url"); err != nil {
		return nil, err
	}
	payload := map[string]any{"id_type": idType, "document_url": doc}
	if in.SelfieURL != nil {
		selfie := strings.TrimSpace(*in.SelfieURL)
		if selfie != "" {
			if err := validateVerificationArtifact(selfie, "selfie_url"); err != nil {
				return nil, err
			}
			payload["selfie_url"] = selfie
		}
	}
	return s.submitVerification(ctx, userID, VerificationKindID, payload)
}

// SubmitBusinessVerification files a pending business (CAC) verification
// request. Same pending-review contract as SubmitIDVerification.
func (s *Service) SubmitBusinessVerification(ctx context.Context, userID string, in VerificationBusinessInput) (*VerificationRequest, error) {
	cac := strings.TrimSpace(in.CACNumber)
	if cac == "" {
		return nil, fieldErr(CodeValidation, "cac_number is required", "cac_number")
	}
	if len(cac) > 64 {
		return nil, fieldErr(CodeValidation, "cac_number is too long", "cac_number")
	}
	doc := strings.TrimSpace(in.DocumentURL)
	if err := validateVerificationArtifact(doc, "document_url"); err != nil {
		return nil, err
	}
	return s.submitVerification(ctx, userID, VerificationKindBusiness,
		map[string]any{"cac_number": cac, "document_url": doc})
}
