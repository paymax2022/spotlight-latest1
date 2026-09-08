package extranet

import (
	"context"
	"fmt"
)

// ResolvePrimaryProperty returns the property the caller should act on when a
// route carries no :propertyId (the onboarding/verification screens are scoped to
// "my one property in progress" rather than a specific id). Prefers an OWNER grant,
// then falls back to the earliest ACTIVE grant of any role.
func (r *Repository) ResolvePrimaryProperty(ctx context.Context, userID string) (string, error) {
	var propertyID string
	err := r.db.QueryRow(ctx, `
		SELECT property_id FROM public.stays_hotelier_profile
		WHERE user_id = $1 AND status = 'ACTIVE'
		ORDER BY (role = 'OWNER') DESC, created_at ASC
		LIMIT 1`, userID).Scan(&propertyID)
	if err != nil {
		return "", ErrNotFound
	}
	return propertyID, nil
}

// GetKYB returns the property's KYB record, or (zero, false, nil) if none exists
// yet (every field then reads as its zero value / VerifPending downstream).
func (r *Repository) GetKYB(ctx context.Context, propertyID string) (kyb, bool, error) {
	var k kyb
	var businessType, rcNumber, tin, directorName, directorBVN, contactEmail, contactPhone *string
	err := r.db.QueryRow(ctx, `
		SELECT property_id, COALESCE(legal_name,''), business_type, rc_number, tin,
		       director_name, director_bvn, contact_email, contact_phone,
		       kyc_status, business_doc_status, status,
		       submitted_for_review_at, reviewed_at, reviewed_by, reviewer_note
		FROM public.stays_hotelier_kyb WHERE property_id = $1`, propertyID).Scan(
		&k.PropertyID, &k.LegalName, &businessType, &rcNumber, &tin,
		&directorName, &directorBVN, &contactEmail, &contactPhone,
		&k.KYCStatus, &k.BusinessDocStatus, &k.Status,
		&k.SubmittedForReviewAt, &k.ReviewedAt, &k.ReviewedBy, &k.ReviewerNote)
	if err != nil {
		return kyb{}, false, nil // no row yet — not a hard error, caller defaults
	}
	k.BusinessType = derefStr(businessType)
	k.RCNumber = derefStr(rcNumber)
	k.TIN = derefStr(tin)
	k.DirectorName = derefStr(directorName)
	k.DirectorBVN = derefStr(directorBVN)
	k.ContactEmail = derefStr(contactEmail)
	k.ContactPhone = derefStr(contactPhone)
	return k, true, nil
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// HasUpcomingAvailability reports whether the property has any open (allotment>0)
// availability in the next 90 days — the go-live "rates & availability loaded" signal.
func (r *Repository) HasUpcomingAvailability(ctx context.Context, propertyID string) (bool, error) {
	var ok bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.stays_availability_day ad
			JOIN public.stays_room_type rt ON rt.id = ad.room_type_id
			WHERE rt.property_id = $1
			  AND ad.date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
			  AND ad.allotment > 0
		)`, propertyID).Scan(&ok)
	return ok, err
}

// SubmitKYB moves the KYB record to 'submitted' (creating it if none exists yet).
// A record already 'submitted' or 'approved' is left untouched (idempotent resubmit).
func (r *Repository) SubmitKYB(ctx context.Context, propertyID string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.stays_hotelier_kyb (property_id, status, submitted_for_review_at)
		VALUES ($1, 'submitted', now())
		ON CONFLICT (property_id) DO UPDATE
		SET status = 'submitted', submitted_for_review_at = now(), updated_at = now()
		WHERE stays_hotelier_kyb.status IN ('pending','needs_changes','rejected')`,
		propertyID)
	return err
}

// AdminDecideKYB records an ops decision on a property's KYB record: it upserts any
// business fields supplied (transcribed from whatever channel the hotelier used to
// submit documents — self-serve upload is a later increment), sets both sub-statuses
// and the overall verdict to the decision, and snapshots the verdict onto
// stays_property.kyb_status for fast reads elsewhere. Blank field values leave the
// existing stored value untouched (COALESCE(NULLIF(...))), matching
// UpdatePropertyContent's edit semantics.
func (r *Repository) AdminDecideKYB(ctx context.Context, propertyID, legalName, businessType, rcNumber, tin, directorName, directorBVN, contactEmail, contactPhone, reviewerID, note string, verdict VerificationItemStatus) error {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("extranet: begin kyb decision tx: %w", err)
	}
	defer tx.Rollback(ctx)

	_, err = tx.Exec(ctx, `
		INSERT INTO public.stays_hotelier_kyb
			(property_id, legal_name, business_type, rc_number, tin, director_name, director_bvn,
			 contact_email, contact_phone, kyc_status, business_doc_status, status,
			 submitted_for_review_at, reviewed_at, reviewed_by, reviewer_note)
		VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''),
		        NULLIF($8,''), NULLIF($9,''), $10, $10, $10, now(), now(), $11, NULLIF($12,''))
		ON CONFLICT (property_id) DO UPDATE SET
			legal_name = COALESCE(NULLIF($2,''), stays_hotelier_kyb.legal_name),
			business_type = COALESCE(NULLIF($3,''), stays_hotelier_kyb.business_type),
			rc_number = COALESCE(NULLIF($4,''), stays_hotelier_kyb.rc_number),
			tin = COALESCE(NULLIF($5,''), stays_hotelier_kyb.tin),
			director_name = COALESCE(NULLIF($6,''), stays_hotelier_kyb.director_name),
			director_bvn = COALESCE(NULLIF($7,''), stays_hotelier_kyb.director_bvn),
			contact_email = COALESCE(NULLIF($8,''), stays_hotelier_kyb.contact_email),
			contact_phone = COALESCE(NULLIF($9,''), stays_hotelier_kyb.contact_phone),
			kyc_status = $10,
			business_doc_status = $10,
			status = $10,
			submitted_for_review_at = COALESCE(stays_hotelier_kyb.submitted_for_review_at, now()),
			reviewed_at = now(),
			reviewed_by = $11,
			reviewer_note = NULLIF($12,''),
			updated_at = now()`,
		propertyID, legalName, businessType, rcNumber, tin, directorName, directorBVN,
		contactEmail, contactPhone, string(verdict), reviewerID, note)
	if err != nil {
		return fmt.Errorf("extranet: upsert kyb decision: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE public.stays_property SET kyb_status = $2, updated_at = now() WHERE id = $1`,
		propertyID, string(verdict)); err != nil {
		return fmt.Errorf("extranet: snapshot kyb_status: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("extranet: commit kyb decision tx: %w", err)
	}
	return nil
}
