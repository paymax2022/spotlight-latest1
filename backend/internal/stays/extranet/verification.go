package extranet

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/dbutil"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const (
	keyData    = "data"
	keyError   = "error"
	keyContent = "content"
)

// VerificationItemStatus mirrors the frontend's VerificationItemStatus vocabulary
// exactly (frontend-admin/src/types/staysExtranet.ts) — reused for individual
// checklist items, the two KYB sub-statuses, and the overall verdict alike, so the
// Go layer needs no translation mapping to a different enum.
type VerificationItemStatus string

const (
	VerifPending      VerificationItemStatus = "pending"
	VerifInProgress   VerificationItemStatus = "in_progress"
	VerifSubmitted    VerificationItemStatus = "submitted"
	VerifApproved     VerificationItemStatus = "approved"
	VerifRejected     VerificationItemStatus = "rejected"
	VerifNeedsChanges VerificationItemStatus = "needs_changes"
)

// VerificationChecklistItem is one row of the go-live checklist.
type VerificationChecklistItem struct {
	Key      string                 `json:"key"`
	Label    string                 `json:"label"`
	Stage    string                 `json:"stage"`
	Status   VerificationItemStatus `json:"status"`
	Detail   string                 `json:"detail,omitempty"`
	Required bool                   `json:"required"`
}

// VerificationStatus is the go-live checklist + overall review verdict for a property.
type VerificationStatus struct {
	PropertyID           string                      `json:"property_id"`
	PropertyName         string                      `json:"property_name"`
	Overall              VerificationItemStatus      `json:"overall"`
	GoLiveEligible       bool                        `json:"go_live_eligible"`
	SubmittedForReviewAt *time.Time                  `json:"submitted_for_review_at,omitempty"`
	ReviewedAt           *time.Time                  `json:"reviewed_at,omitempty"`
	ReviewerNote         *string                     `json:"reviewer_note,omitempty"`
	Checklist            []VerificationChecklistItem `json:"checklist"`
}

// BusinessVerification is the hotelier's business/KYC record. DirectorBVNLast4 is
// the ONLY fragment of the director's BVN ever returned to the client — the full
// BVN never leaves the database.
type BusinessVerification struct {
	LegalName         string                 `json:"legal_name"`
	RCNumber          string                 `json:"rc_number"`
	TIN               string                 `json:"tin"`
	KYCStatus         VerificationItemStatus `json:"kyc_status"`
	BusinessDocStatus VerificationItemStatus `json:"business_doc_status"`
	DirectorName      string                 `json:"director_name"`
	DirectorBVNLast4  string                 `json:"director_bvn_last4"`
}

// kyb is the internal (full-fidelity) record read from stays_hotelier_kyb — it
// carries the full director BVN, which BusinessVerification must never expose.
type kyb struct {
	PropertyID           string
	LegalName            string
	BusinessType         string
	RCNumber             string
	TIN                  string
	DirectorName         string
	DirectorBVN          string
	ContactEmail         string
	ContactPhone         string
	KYCStatus            VerificationItemStatus
	BusinessDocStatus    VerificationItemStatus
	Status               VerificationItemStatus
	SubmittedForReviewAt *time.Time
	ReviewedAt           *time.Time
	ReviewedBy           *string
	ReviewerNote         *string
}

func bvnLast4(bvn string) string {
	if len(bvn) < 4 {
		return ""
	}
	return bvn[len(bvn)-4:]
}

// kybDecisionStatus maps an admin decision string to the resulting verdict.
func kybDecisionStatus(decision string) (VerificationItemStatus, bool) {
	switch decision {
	case "approve":
		return VerifApproved, true
	case "reject":
		return VerifRejected, true
	case "needs_changes":
		return VerifNeedsChanges, true
	default:
		return "", false
	}
}

// RegisterAdmin wires the ops KYB review route onto the admin group. guard is the
// per-route RBAC middleware factory the aggregator supplies. Reuses the existing
// stays.admin.hotelier permission ("Approve/suspend hotelier profiles + grants") —
// deciding a property's business verification is exactly that.
func (h *Handler) RegisterAdmin(g *gin.RouterGroup, guard func(permission string) gin.HandlerFunc) {
	g.POST("/hoteliers/:propertyId/kyb/decision", guard("stays.admin.hotelier"), h.AdminDecideKYB)
}

// GetVerificationStatus: GET /verification — the caller's go-live checklist.
func (h *Handler) GetVerificationStatus(c *gin.Context) {
	out, err := h.svc.GetVerificationStatus(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// GetBusinessVerification: GET /verification/business — the caller's KYC record.
func (h *Handler) GetBusinessVerification(c *gin.Context) {
	out, err := h.svc.GetBusinessVerification(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// SubmitForReview: POST /verification/submit — re-validates required checklist
// items server-side (the frontend's own gate is convenience only) before moving
// the record to 'submitted'.
func (h *Handler) SubmitForReview(c *gin.Context) {
	out, err := h.svc.SubmitForReview(c.Request.Context(), ginutil.UserID(c))
	if err != nil {
		if errors.Is(err, ErrVerificationIncomplete) {
			c.JSON(http.StatusUnprocessableEntity, gin.H{keyError: httperr.Msg(c, http.StatusUnprocessableEntity, err)})
			return
		}
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// AdminDecideKYB (admin): POST /hoteliers/:propertyId/kyb/decision
// {legal_name, business_type, rc_number, tin, director_name, director_bvn,
//
//	contact_email, contact_phone, decision, note}. decision: approve|reject|needs_changes.
func (h *Handler) AdminDecideKYB(c *gin.Context) {
	var b struct {
		LegalName    string `json:"legal_name"`
		BusinessType string `json:"business_type"`
		RCNumber     string `json:"rc_number"`
		TIN          string `json:"tin"`
		DirectorName string `json:"director_name"`
		DirectorBVN  string `json:"director_bvn"`
		ContactEmail string `json:"contact_email"`
		ContactPhone string `json:"contact_phone"`
		Decision     string `json:"decision" binding:"required"`
		Note         string `json:"note"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.AdminDecideKYB(c.Request.Context(), c.Param("propertyId"), ginutil.UserID(c),
		BusinessVerificationInput{
			LegalName: b.LegalName, BusinessType: b.BusinessType, RCNumber: b.RCNumber, TIN: b.TIN,
			DirectorName: b.DirectorName, DirectorBVN: b.DirectorBVN,
			ContactEmail: b.ContactEmail, ContactPhone: b.ContactPhone,
		}, b.Decision, b.Note)
	if err != nil {
		if errors.Is(err, ErrBadDecision) || errors.Is(err, ErrDecisionNoteRequired) {
			c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
			return
		}
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

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
	k.BusinessType = dbutil.DerefString(businessType)
	k.RCNumber = dbutil.DerefString(rcNumber)
	k.TIN = dbutil.DerefString(tin)
	k.DirectorName = dbutil.DerefString(directorName)
	k.DirectorBVN = dbutil.DerefString(directorBVN)
	k.ContactEmail = dbutil.DerefString(contactEmail)
	k.ContactPhone = dbutil.DerefString(contactPhone)
	return k, true, nil
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
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		INSERT INTO public.stays_hotelier_kyb
			(property_id, legal_name, business_type, rc_number, tin, director_name, director_bvn,
			 contact_email, contact_phone, kyc_status, business_doc_status, status,
			 submitted_for_review_at, reviewed_at, reviewed_by, reviewer_note)
		VALUES ($1, NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), NULLIF($6,''), NULLIF($7,''),
		        NULLIF($8,''), NULLIF($9,''), $10, now(), $11, NULLIF($12,''))
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

// minPhotosForGoLive mirrors the go-live copy already shown elsewhere in the
// product ("properties with 14+ photos convert 23% better... at least 8
// photos uploaded (cover set)") — the checklist enforces the number that
// copy has always implied a listing needs.
const minPhotosForGoLive = 8

// buildVerificationStatus computes the checklist from real signals: property
// content fields, room types + rate plans, photos, policies, upcoming
// availability, and the KYB record. Nothing here is faked.
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
	photoCount, err := s.repo.CountPropertyPhotos(ctx, propertyID)
	if err != nil {
		return VerificationStatus{}, err
	}

	propertyDone := prop.Address != "" && prop.City != ""
	contentDone := prop.Description != "" && len(roomTypes) >= 1 && len(ratePlans) >= 1
	photosDone := photoCount >= minPhotosForGoLive
	// house_rules is the one policy field with no non-empty default (unlike
	// cancellation_policy/check_in_from/check_out_until, which are always
	// populated with a sensible default) — its presence is the genuine signal
	// that a host actually reviewed and set policies, not just inherited defaults.
	policiesDone := strings.TrimSpace(prop.HouseRules) != ""

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
		{Key: keyContent, Label: "Property description and at least one room type with a rate plan", Stage: keyContent,
			Status: statusIf(contentDone), Required: true},
		{Key: "photos", Label: fmt.Sprintf("At least %d photos uploaded (cover set)", minPhotosForGoLive), Stage: keyContent,
			Status: statusIf(photosDone), Required: true,
			Detail: verificationDetail(statusIf(photosDone), fmt.Sprintf("You have %d — add %d more to go live.", photoCount, max(0, minPhotosForGoLive-photoCount)))},
		{Key: "business_identity", Label: "Business identity verified (legal name, CAC, TIN, director KYC)", Stage: "verification",
			Status: kycStatus, Required: false,
			Detail: verificationDetail(kycStatus, "Send your business documents to Paymax support to begin review.")},
		{Key: "business_documents", Label: "Supporting business documents reviewed", Stage: "verification",
			Status: docStatus, Required: false,
			Detail: verificationDetail(docStatus, "Send your business documents to Paymax support to begin review.")},
		{Key: "policies", Label: "Policies configured (check-in/out, cancellation, house rules)", Stage: "policies",
			Status: statusIf(policiesDone), Required: false,
			Detail: verificationDetail(statusIf(policiesDone), "Set your house rules in the Policies section to complete this step.")},
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
