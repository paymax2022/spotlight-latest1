package doctor

import (
	"context"
	"encoding/json"
)

// repository_vet_tail.go — pgx data access for the VET licence / verification /
// profile-publish / profile-draft "tail" endpoints. Additive to repository_vet.go
// (separate file to avoid colliding with concurrent edits there).
//
// Every method targets the single per-vet row in doctor_vet_profiles
// (user_id UNIQUE — migration 20260625000000_doctor_module.sql:797) and is scoped
// by user_id (defence in depth on top of RLS). None post ledger entries — these are
// onboarding / document writes, not value movements.
//
// doctor_vet_profiles has NO idempotency_key column (migration :795-807), so these
// mutations cannot ON CONFLICT-dedupe on a key; the Idempotency-Key header is still
// required at the service layer (mirrors the human-side RenewLicence / SubmitVerification
// / SaveProfileDraft / PublishProfile, whose backing tables likewise lack the column).
// The UPDATEs are naturally idempotent: re-applying the same patch / status transition
// yields the same row.

// RenewVetLicenceRecord re-enters vet verification on licence renewal: it records the
// (optional) new licence number and flips verification back to 'pending', merging any
// supplied renewal detail into the detail jsonb. Mirrors the human-side
// repository_account.go RenewLicence path (which re-submits a 'renewal' verification).
// Scoped to the owning vet (user_id). Returns ErrNotFound when no vet row exists.
func (r *Repository) RenewVetLicenceRecord(ctx context.Context, userID string, licenceNumber *string, detail []byte) (*VetProfile, error) {
	const q = `
		UPDATE doctor_vet_profiles
		SET licence_number = COALESCE($2, licence_number),
		    verification   = 'pending',
		    detail         = detail || $3::jsonb,
		    updated_at     = now()
		WHERE user_id = $1`
	tag, err := r.db.Exec(ctx, q, userID, licenceNumber, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetVetProfile(ctx, userID)
}

// SubmitVetVerificationRecord submits the vet's verification: it flips the vet-scoped
// verification column to 'pending' and merges the submitted documents / notes into the
// detail jsonb. Mirrors the human-side InsertVerification ('pending' on submit), but
// targets the vet profile column rather than doctor_verifications — that shared table's
// kind CHECK is limited to ('initial','renewal','resubmission') (migration :80-81) and
// has no vet/role column, so the correct vet-scoped sink is doctor_vet_profiles.verification.
// Scoped to the owning vet (user_id). Returns ErrNotFound when no vet row exists.
func (r *Repository) SubmitVetVerificationRecord(ctx context.Context, userID string, detail []byte) (*VetProfile, error) {
	const q = `
		UPDATE doctor_vet_profiles
		SET verification = 'pending',
		    detail       = detail || $2::jsonb,
		    updated_at   = now()
		WHERE user_id = $1`
	tag, err := r.db.Exec(ctx, q, userID, jsonOrEmptyObject(detail))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetVetProfile(ctx, userID)
}

// PublishVetProfile marks the vet profile live (is_published = true). Fail-closed:
// the row is only published when its verification is 'approved' (mirrors the human-side
// repository_account.go PublishProfile guard). Scoped to the owning vet (user_id).
// Returns ErrNotEligible when no vet row exists or verification is not approved.
func (r *Repository) PublishVetProfile(ctx context.Context, userID string) (*VetProfile, error) {
	const q = `
		UPDATE doctor_vet_profiles
		SET is_published = true, updated_at = now()
		WHERE user_id = $1 AND verification = 'approved'`
	tag, err := r.db.Exec(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		// Either no vet profile row or verification not approved → caller maps to 403/404.
		return nil, ErrNotEligible
	}
	return r.GetVetProfile(ctx, userID)
}

// SaveVetProfileDraftRecord patch-merges the supplied JSON into profile_draft
// (jsonb || jsonb). Mirrors the human-side repository_account.go SaveProfileDraft.
// Idempotent: a replayed / empty patch is a no-op merge. Scoped to the owning vet
// (user_id). Returns ErrNotFound when no vet row exists.
func (r *Repository) SaveVetProfileDraftRecord(ctx context.Context, userID string, patch []byte) (*VetProfile, error) {
	const q = `
		UPDATE doctor_vet_profiles
		SET profile_draft = profile_draft || $2::jsonb, updated_at = now()
		WHERE user_id = $1`
	tag, err := r.db.Exec(ctx, q, userID, jsonOrEmptyObject(patch))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrNotFound
	}
	return r.GetVetProfile(ctx, userID)
}

// marshalVetRenewalDetail builds the detail jsonb merged on licence renewal from the
// typed verification request (notes + documents), so the renewal artefacts are retained
// on the vet row even though there is no separate vet verifications table.
func marshalVetRenewalDetail(req SubmitVerificationRequest) []byte {
	m := map[string]any{}
	if req.Notes != nil {
		m["renewalNotes"] = *req.Notes
	}
	if len(req.Documents) > 0 {
		m["renewalDocuments"] = req.Documents
	}
	if len(m) == 0 {
		return nil
	}
	b, _ := json.Marshal(m)
	return b
}

// marshalVetVerificationDetail builds the detail jsonb merged on verification submit
// from the typed verification request (kind + notes + documents).
func marshalVetVerificationDetail(req SubmitVerificationRequest) []byte {
	m := map[string]any{}
	if req.Kind != "" {
		m["verificationKind"] = req.Kind
	}
	if req.MDCNNumber != nil {
		m["verificationLicenceNumber"] = *req.MDCNNumber
	}
	if req.Notes != nil {
		m["verificationNotes"] = *req.Notes
	}
	if len(req.Documents) > 0 {
		m["verificationDocuments"] = req.Documents
	}
	if len(m) == 0 {
		return nil
	}
	b, _ := json.Marshal(m)
	return b
}
