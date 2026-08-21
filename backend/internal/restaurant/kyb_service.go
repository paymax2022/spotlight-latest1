package restaurant

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// loadKYB returns a restaurant's KYB record, or a zero-value draft when none exists
// yet (so callers always get a consistent shape). ok is false when there is no row.
func (s *Service) loadKYB(ctx context.Context, restaurantID string) (KYB, bool, error) {
	const q = `
		SELECT COALESCE(legal_name,''), COALESCE(business_type,''), COALESCE(rc_number,''),
		       COALESCE(tin,''), COALESCE(contact_email,''), COALESCE(contact_phone,''),
		       COALESCE(bank_code,''), COALESCE(account_number,''), COALESCE(account_name,''),
		       status, decision_reason
		FROM restaurant_kyb WHERE restaurant_id=$1`
	k := KYB{RestaurantID: restaurantID, Status: KYBDraft}
	err := s.db.QueryRow(ctx, q, restaurantID).Scan(
		&k.LegalName, &k.BusinessType, &k.RCNumber, &k.TIN, &k.ContactEmail, &k.ContactPhone,
		&k.BankCode, &k.AccountNumber, &k.AccountName, &k.Status, &k.DecisionReason)
	if err != nil {
		// No row yet → an empty draft (not an error).
		return KYB{RestaurantID: restaurantID, Status: KYBDraft}, false, nil
	}
	return k, true, nil
}

// loadKYBDocTypes returns the set of document types uploaded for a restaurant.
func (s *Service) loadKYBDocTypes(ctx context.Context, restaurantID string) (map[string]bool, error) {
	rows, err := s.db.Query(ctx, `SELECT doc_type FROM restaurant_kyb_documents WHERE restaurant_id=$1`, restaurantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out[t] = true
	}
	return out, rows.Err()
}

// editableKYB reports whether a KYB in the given status may be edited/submitted by the
// owner (only before/after review, never mid-review or once approved).
func editableKYB(st KYBStatus) bool {
	return st == KYBDraft || st == KYBNeedsInfo || st == KYBRejected
}

// SaveKYB upserts the owner's KYB business details (owner only). Editing is blocked
// once the record is submitted/under review/approved — the owner must wait for the
// reviewer (or a needs_more_info bounce) before changing it.
func (s *Service) SaveKYB(ctx context.Context, restaurantID, userID string, in KYB) (*KYB, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageBanking); err != nil {
		return nil, err
	}
	cur, _, err := s.loadKYB(ctx, restaurantID)
	if err != nil {
		return nil, err
	}
	if !editableKYB(cur.Status) {
		return nil, fmt.Errorf("restaurant: KYB cannot be edited while %s", cur.Status)
	}
	const up = `
		INSERT INTO restaurant_kyb (restaurant_id, legal_name, business_type, rc_number, tin,
		    contact_email, contact_phone, bank_code, account_number, account_name, status, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',now())
		ON CONFLICT (restaurant_id) DO UPDATE SET
		    legal_name=$2, business_type=$3, rc_number=$4, tin=$5, contact_email=$6,
		    contact_phone=$7, bank_code=$8, account_number=$9, account_name=$10, updated_at=now()`
	if _, err := s.db.Exec(ctx, up, restaurantID,
		nullIfEmpty(in.LegalName), nullIfEmpty(in.BusinessType), nullIfEmpty(in.RCNumber), nullIfEmpty(in.TIN),
		nullIfEmpty(in.ContactEmail), nullIfEmpty(in.ContactPhone), nullIfEmpty(in.BankCode),
		nullIfEmpty(in.AccountNumber), nullIfEmpty(in.AccountName)); err != nil {
		return nil, err
	}
	// Keep the restaurant snapshot in sync (draft until submitted).
	_, _ = s.db.Exec(ctx, `UPDATE restaurants SET kyb_status=COALESCE(kyb_status,'draft'), updated_at=now() WHERE id=$1`, restaurantID)
	k, _, err := s.loadKYB(ctx, restaurantID)
	return &k, err
}

// AddKYBDocument records a reference to a document the owner has already uploaded to
// storage (owner only). It stores the type + file URL, not the file. One document per
// (restaurant, type) — re-adding a type replaces it.
func (s *Service) AddKYBDocument(ctx context.Context, restaurantID, userID, docType, fileURL, fileName string) error {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageBanking); err != nil {
		return err
	}
	if docType == "" || fileURL == "" {
		return fmt.Errorf("restaurant: doc_type and file_url are required")
	}
	const q = `
		INSERT INTO restaurant_kyb_documents (id, restaurant_id, doc_type, file_url, file_name)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (restaurant_id, doc_type) DO UPDATE SET file_url=$4, file_name=$5`
	_, err := s.db.Exec(ctx, q, uuid.New().String(), restaurantID, docType, fileURL, nullIfEmpty(fileName))
	return err
}

// SubmitKYB validates the owner's KYB and moves it to `submitted` for review (owner
// only). Fails with the list of problems when required business/settlement/document
// fields are missing. Idempotent-safe: a resubmit from needs_more_info/rejected is a
// legal transition.
func (s *Service) SubmitKYB(ctx context.Context, restaurantID, userID string) (*KYB, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageBanking); err != nil {
		return nil, err
	}
	k, exists, err := s.loadKYB(ctx, restaurantID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, fmt.Errorf("restaurant: fill in your KYB details before submitting")
	}
	if !kybCanTransition(k.Status, KYBSubmitted) {
		return nil, fmt.Errorf("restaurant: KYB cannot be submitted from %s", k.Status)
	}
	docTypes, err := s.loadKYBDocTypes(ctx, restaurantID)
	if err != nil {
		return nil, err
	}
	if problems := validateKYBForSubmit(k, docTypes); len(problems) > 0 {
		return nil, kybIncompleteErr(problems)
	}
	if _, err := s.db.Exec(ctx,
		`UPDATE restaurant_kyb SET status='submitted', decision_reason=NULL, submitted_at=now(), updated_at=now() WHERE restaurant_id=$1`,
		restaurantID); err != nil {
		return nil, err
	}
	_, _ = s.db.Exec(ctx, `UPDATE restaurants SET kyb_status='submitted', updated_at=now() WHERE id=$1`, restaurantID)
	k.Status = KYBSubmitted
	return &k, nil
}

// GetKYB returns the owner's KYB record + uploaded document types (owner only).
func (s *Service) GetKYB(ctx context.Context, restaurantID, userID string) (*KYB, []string, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageBanking); err != nil {
		return nil, nil, err
	}
	k, _, err := s.loadKYB(ctx, restaurantID)
	if err != nil {
		return nil, nil, err
	}
	docs, err := s.loadKYBDocTypes(ctx, restaurantID)
	if err != nil {
		return nil, nil, err
	}
	types := make([]string, 0, len(docs))
	for t := range docs {
		types = append(types, t)
	}
	return &k, types, nil
}
