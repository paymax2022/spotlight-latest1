package restaurant

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"spotlight/backend/go-common/fsm"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// ErrKYBIncomplete is returned when a KYB submission is missing required fields or
// documents. The handler maps it to HTTP 422.
var ErrKYBIncomplete = errors.New("restaurant: KYB submission is incomplete")

// ErrKYBNotApproved is returned when an action requires an approved KYB
// verification and the restaurant doesn't have one (FOOD-010). The handler
// maps it to HTTP 403.
var ErrKYBNotApproved = errors.New("restaurant: business verification must be approved before opening for orders")

// KYBStatus is the merchant Know-Your-Business verification state.
type KYBStatus string

const (
	KYBDraft       KYBStatus = "draft"           // owner is still filling it in
	KYBSubmitted   KYBStatus = "submitted"       // owner submitted; awaiting review
	KYBUnderReview KYBStatus = "under_review"    // a reviewer picked it up
	KYBNeedsInfo   KYBStatus = "needs_more_info" // reviewer bounced it back for more info
	KYBApproved    KYBStatus = "approved"        // verified — restaurant may go live
	KYBRejected    KYBStatus = "rejected"        // declined (with a reason)
	KYBWithdrawn   KYBStatus = "withdrawn"       // applicant pulled a pending application (FOOD-UAT-A-014)
)

// Allowed business types (mirrors the DB CHECK).
var kybBusinessTypes = map[string]bool{
	"sole_proprietor": true,
	"limited_company": true,
	"partnership":     true,
	"ngo":             true,
}

// KYB is a restaurant's business-verification record. Bank fields are the merchant's
// OWN settlement (payout) account — business data they provide, not a credential.
type KYB struct {
	RestaurantID                  string    `json:"restaurant_id"`
	LegalName                     string    `json:"legal_name"`
	BusinessType                  string    `json:"business_type"`
	RCNumber                      string    `json:"rc_number,omitempty"` // CAC RC/BN number
	TIN                           string    `json:"tin,omitempty"`
	ContactEmail                  string    `json:"contact_email"`
	ContactPhone                  string    `json:"contact_phone"`
	BankCode                      string    `json:"bank_code"`
	AccountNumber                 string    `json:"account_number"` // 10-digit NUBAN
	AccountName                   string    `json:"account_name"`
	Status                        KYBStatus `json:"status"`
	DecisionReason                *string   `json:"decision_reason,omitempty"`
	BankAccountVerifiedAt         *time.Time `json:"bank_account_verified_at,omitempty"`
	BankAccountVerified           *bool     `json:"bank_account_verified,omitempty"`
	BankAccountVerificationError  *string   `json:"bank_account_verification_error,omitempty"`
	// FOOD-UAT-A-009: set on submit responses. Duplicate is true when the application
	// was already in the review queue and this call changed nothing.
	SubmissionID string `json:"submission_id,omitempty"`
	Duplicate    bool   `json:"duplicate,omitempty"`
}

// kybTransitions is the KYB lifecycle's legal-move table. Owner-driven:
// draft/needs_more_info/rejected → submitted (submit or re-submit).
// Reviewer-driven: submitted → under_review, and submitted/under_review/
// needs_more_info → approved | rejected | needs_more_info. rejected may
// resubmit (re-application). approved is terminal (no entry = no outgoing
// moves); same-state and unknown moves are denied by Table.Can.
var kybTransitions = fsm.Table[KYBStatus]{
	KYBDraft:       fsm.Set(KYBSubmitted),
	KYBSubmitted:   fsm.Set(KYBUnderReview, KYBApproved, KYBRejected, KYBNeedsInfo, KYBWithdrawn),
	KYBUnderReview: fsm.Set(KYBApproved, KYBRejected, KYBNeedsInfo, KYBWithdrawn),
	KYBNeedsInfo:   fsm.Set(KYBSubmitted, KYBApproved, KYBRejected, KYBWithdrawn),
	KYBRejected:    fsm.Set(KYBSubmitted),
	// Withdrawn is final for reviewers (no approve/reject); the owner may re-apply.
	KYBWithdrawn: fsm.Set(KYBSubmitted),
}

func kybCanTransition(from, to KYBStatus) bool {
	return kybTransitions.Can(from, to)
}

// looksLikeEmail is a deliberately-minimal sanity check (exactly one '@', a '.' after
// it, no spaces) — full RFC validation is not the job of a submit gate.
func looksLikeEmail(s string) bool {
	at := strings.IndexByte(s, '@')
	if at <= 0 || strings.ContainsAny(s, " \t") {
		return false
	}
	dot := strings.LastIndexByte(s, '.')
	return dot > at+1 && dot < len(s)-1
}

// isNUBAN reports whether s is a 10-digit Nigerian bank account number.
func isNUBAN(s string) bool {
	if len(s) != 10 {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// validateKYBForSubmit returns the list of problems that block submission (empty ⇒ OK).
// It is PURE (no DB): the required business fields, the business-type/RC rule (a
// registered entity needs its CAC RC number AND certificate), the settlement account
// format, and a basic contact-email check. `docTypes` is the set of document types the
// applicant has uploaded, so the "certificate required" rule is testable without a DB.
func validateKYBForSubmit(k KYB, docTypes map[string]bool) []string {
	var problems []string
	req := func(field, val string) {
		if strings.TrimSpace(val) == "" {
			problems = append(problems, "missing "+field)
		}
	}
	req("legal_name", k.LegalName)
	req("contact_phone", k.ContactPhone)
	req("bank_code", k.BankCode)
	req("account_name", k.AccountName)

	if !kybBusinessTypes[k.BusinessType] {
		problems = append(problems, "invalid business_type")
	}
	if strings.TrimSpace(k.ContactEmail) == "" || !looksLikeEmail(k.ContactEmail) {
		problems = append(problems, "invalid contact_email")
	}
	if !isNUBAN(k.AccountNumber) {
		problems = append(problems, "account_number must be a 10-digit NUBAN")
	}
	// A registered entity (anything other than a sole proprietor) must supply its CAC
	// RC/BN number and upload the certificate; a sole proprietor is exempt.
	if k.BusinessType != "sole_proprietor" && kybBusinessTypes[k.BusinessType] {
		if strings.TrimSpace(k.RCNumber) == "" {
			problems = append(problems, "rc_number is required for a registered business")
		}
		if !docTypes["cac_certificate"] {
			problems = append(problems, "cac_certificate document is required for a registered business")
		}
	}
	return problems
}

// kybIncompleteErr wraps the submit-validation problems into one ErrKYBIncomplete.
func kybIncompleteErr(problems []string) error {
	return fmt.Errorf("%w: %s", ErrKYBIncomplete, strings.Join(problems, "; "))
}

// verifyBankAccount calls the disbursement provider to resolve the account name and
// stores the verification result in the database. Returns true if verified successfully.
func (s *Service) verifyBankAccount(ctx context.Context, restaurantID, bankCode, accountNumber, accountName string) error {
	if s.disbursement == nil {
		// Bank verification not configured; skip silently
		now := time.Now()
		_, err := s.db.Exec(ctx,
			`UPDATE restaurant_kyb SET bank_account_verified_at=$2, bank_account_verified=NULL, bank_account_verification_error='bank verification not configured'
			 WHERE restaurant_id=$1`,
			restaurantID, now)
		return err
	}

	resolved, err := s.disbursement.ResolveAccount(ctx, bankCode, accountNumber)
	if err != nil {
		// Verification failed; store the error but don't fail submission
		errMsg := err.Error()
		now := time.Now()
		_, dbErr := s.db.Exec(ctx,
			`UPDATE restaurant_kyb SET bank_account_verified_at=$2, bank_account_verified=FALSE, bank_account_verification_error=$3
			 WHERE restaurant_id=$1`,
			restaurantID, now, errMsg)
		return dbErr
	}

	// Account resolved; check if the name matches
	verified := strings.EqualFold(strings.TrimSpace(resolved.AccountName), strings.TrimSpace(accountName))
	now := time.Now()
	_, err = s.db.Exec(ctx,
		`UPDATE restaurant_kyb SET bank_account_verified_at=$2, bank_account_verified=$3, bank_account_verification_error=NULL
		 WHERE restaurant_id=$1`,
		restaurantID, now, verified)
	return err
}

// loadKYB returns a restaurant's KYB record, or a zero-value draft when none exists
// yet (so callers always get a consistent shape). ok is false when there is no row.
func (s *Service) loadKYB(ctx context.Context, restaurantID string) (KYB, bool, error) {
	const q = `
		SELECT COALESCE(legal_name,''), COALESCE(business_type,''), COALESCE(rc_number,''),
		       COALESCE(tin,''), COALESCE(contact_email,''), COALESCE(contact_phone,''),
		       COALESCE(bank_code,''), COALESCE(account_number,''), COALESCE(account_name,''),
		       status, decision_reason, bank_account_verified_at, bank_account_verified, bank_account_verification_error
		FROM restaurant_kyb WHERE restaurant_id=$1`
	k := KYB{RestaurantID: restaurantID, Status: KYBDraft}
	err := s.db.QueryRow(ctx, q, restaurantID).Scan(
		&k.LegalName, &k.BusinessType, &k.RCNumber, &k.TIN, &k.ContactEmail, &k.ContactPhone,
		&k.BankCode, &k.AccountNumber, &k.AccountName, &k.Status, &k.DecisionReason,
		&k.BankAccountVerifiedAt, &k.BankAccountVerified, &k.BankAccountVerificationError)
	if err != nil {
		// No row yet → an empty draft (not an error).
		return KYB{RestaurantID: restaurantID, Status: KYBDraft}, false, nil
	}
	return k, true, nil
}

// loadKYBDocTypes returns the set of document types uploaded for a restaurant.
func (s *Service) loadKYBDocTypes(ctx context.Context, restaurantID string) (map[string]bool, error) {
	rows, err := s.db.Query(ctx, `SELECT doc_type FROM restaurant_kyb_documents WHERE restaurant_id=$1 AND superseded_at IS NULL`, restaurantID)
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
	return st == KYBDraft || st == KYBNeedsInfo || st == KYBRejected || st == KYBWithdrawn
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
// storage (owner only). It stores the type + file reference, not the file. One
// CURRENT document per (restaurant, type) — re-adding a type supersedes the prior
// version, which is retained (FOOD-UAT-A-007).
//
// The reference is either an http(s) link or an object key minted for THIS
// restaurant by PresignKYBDocument (see kyb_documents.go); anything else is
// rejected, because the reviewer console renders it as a link. Documents are
// locked once the KYB is submitted/under review/approved, same as the details —
// otherwise the evidence a reviewer saw could be swapped after the fact.
func (s *Service) AddKYBDocument(ctx context.Context, restaurantID, userID, docType, fileURL, fileName string) error {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageBanking); err != nil {
		return err
	}
	docType, fileURL = strings.TrimSpace(docType), strings.TrimSpace(fileURL)
	if docType == "" || fileURL == "" {
		return errors.New("restaurant: doc_type and file_url are required")
	}
	if !kybDocTypeRE.MatchString(docType) {
		return errors.New("restaurant: invalid doc_type")
	}
	rid, err := canonicalRestaurantID(restaurantID)
	if err != nil {
		return err
	}
	isKey, err := classifyKYBFileRef(rid, fileURL)
	if err != nil {
		return err
	}
	// FOOD-UAT-A-005: an uploaded object is checked for size and real content type
	// before it becomes evidence (pasted links cannot be inspected).
	if isKey {
		if err := s.verifyKYBObject(ctx, fileURL); err != nil {
			return err
		}
	}
	// Check the lock and write in ONE transaction, holding a share lock on the KYB row
	// for its duration. SubmitKYB's UPDATE of that row has to wait for us, so a
	// submit cannot land between "is it still editable?" and the write and leave a
	// document replaced just after the lock.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit
	status := KYBDraft     // no row yet ⇒ a fresh draft, which is editable
	if err := tx.QueryRow(ctx,
		`SELECT status FROM restaurant_kyb WHERE restaurant_id=$1 FOR SHARE`, restaurantID).Scan(&status); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if !editableKYB(status) {
		return fmt.Errorf("restaurant: KYB cannot be edited while %s", status)
	}
	// FOOD-UAT-A-007: a replacement never destroys the prior evidence. The current row
	// (superseded_at IS NULL) is stamped superseded and a new version is inserted.
	newID := uuid.New().String()
	version := 1
	var prevID string
	var prevVersion int
	switch qerr := tx.QueryRow(ctx,
		`SELECT id::text, version FROM restaurant_kyb_documents
		  WHERE restaurant_id=$1 AND doc_type=$2 AND superseded_at IS NULL FOR UPDATE`,
		restaurantID, docType).Scan(&prevID, &prevVersion); {
	case qerr == nil:
		version = prevVersion + 1
		if _, err := tx.Exec(ctx,
			`UPDATE restaurant_kyb_documents SET superseded_at=now(), superseded_by=$2 WHERE id=$1`,
			prevID, newID); err != nil {
			return err
		}
	case !errors.Is(qerr, pgx.ErrNoRows):
		return qerr
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO restaurant_kyb_documents (id, restaurant_id, doc_type, file_url, file_name, version)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		newID, restaurantID, docType, fileURL, nullIfEmpty(fileName), version); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
		return nil, errors.New("restaurant: fill in your KYB details before submitting")
	}
	// FOOD-UAT-A-009: a repeat submit of an application that is already in the queue is
	// a no-op that returns the same submission, not an error and not a second row.
	if dup, derr := s.recentSubmission(ctx, restaurantID, k.Status); derr != nil {
		return nil, derr
	} else if dup {
		k.SubmissionID, k.Duplicate = restaurantID, true
		return &k, nil
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
	// Verify bank account (doesn't fail submission, just records the result)
	_ = s.verifyBankAccount(ctx, restaurantID, k.BankCode, k.AccountNumber, k.AccountName)

	// Compare-and-set on the editable statuses: two concurrent submits cannot both win.
	tag, err := s.db.Exec(ctx,
		`UPDATE restaurant_kyb SET status='submitted', decision_reason=NULL, submitted_at=now(), updated_at=now()
		  WHERE restaurant_id=$1 AND status IN ('draft','needs_more_info','rejected','withdrawn')`,
		restaurantID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		cur, _, lerr := s.loadKYB(ctx, restaurantID)
		if lerr != nil {
			return nil, lerr
		}
		if dup, derr := s.recentSubmission(ctx, restaurantID, cur.Status); derr == nil && dup {
			cur.SubmissionID, cur.Duplicate = restaurantID, true
			return &cur, nil
		}
		return nil, fmt.Errorf("restaurant: KYB cannot be submitted from %s", cur.Status)
	}
	_, _ = s.db.Exec(ctx, `UPDATE restaurants SET kyb_status='submitted', updated_at=now() WHERE id=$1`, restaurantID)
	k.Status = KYBSubmitted
	k.SubmissionID = restaurantID
	return &k, nil
}

// kybSubmitDedupeWindow bounds how long a repeat submit is treated as a duplicate.
const kybSubmitDedupeWindow = 24 * time.Hour

// recentSubmission reports whether the application is already submitted/under review
// and was submitted within kybSubmitDedupeWindow.
func (s *Service) recentSubmission(ctx context.Context, restaurantID string, st KYBStatus) (bool, error) {
	if st != KYBSubmitted && st != KYBUnderReview {
		return false, nil
	}
	var recent bool
	err := s.db.QueryRow(ctx,
		`SELECT COALESCE(submitted_at > now() - make_interval(secs => $2), false) FROM restaurant_kyb WHERE restaurant_id=$1`,
		restaurantID, kybSubmitDedupeWindow.Seconds()).Scan(&recent)
	if err != nil {
		return false, err
	}
	return recent, nil
}

// WithdrawKYB lets the owner pull a pending application (FOOD-UAT-A-014). Only
// submitted / under_review / needs_more_info can be withdrawn; approved and rejected
// decisions are final here, and a draft has nothing to withdraw. Withdrawing an
// already-withdrawn application is an idempotent success.
func (s *Service) WithdrawKYB(ctx context.Context, restaurantID, userID string) (*KYB, error) {
	if err := s.AssertStaffPermission(ctx, restaurantID, userID, PermManageBanking); err != nil {
		return nil, err
	}
	k, exists, err := s.loadKYB(ctx, restaurantID)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, errors.New("restaurant: no KYB application to withdraw")
	}
	if k.Status == KYBWithdrawn {
		return &k, nil
	}
	if !kybCanTransition(k.Status, KYBWithdrawn) {
		return nil, fmt.Errorf("restaurant: KYB cannot be withdrawn from %s", k.Status)
	}
	tag, err := s.db.Exec(ctx,
		`UPDATE restaurant_kyb SET status='withdrawn', updated_at=now()
		  WHERE restaurant_id=$1 AND status IN ('submitted','under_review','needs_more_info')`, restaurantID)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, errors.New("restaurant: KYB changed state; reload and try again")
	}
	_, _ = s.db.Exec(ctx, `UPDATE restaurants SET kyb_status='withdrawn', updated_at=now() WHERE id=$1`, restaurantID)
	if s.audit != nil {
		s.audit.LogAction(userID, "", "restaurant.application.withdraw", "restaurant", "restaurant", restaurantID,
			map[string]any{"kyb_status": string(k.Status)}, map[string]any{"kyb_status": string(KYBWithdrawn)},
			"", "", "info")
	}
	k.Status = KYBWithdrawn
	return &k, nil
}

// WithdrawKYB → POST /restaurant/:id/kyb/withdraw (owner).
func (h *Handler) WithdrawKYB(c *gin.Context) {
	k, err := h.svc.WithdrawKYB(c.Request.Context(), c.Param("id"), ginutil.UserID(c))
	if err != nil {
		c.JSON(kybErrCode(err), gin.H{keyError: httperr.Msg(c, kybErrCode(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kyb": k})
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

// GetKYB → GET /restaurant/:id/kyb (owner). Returns the KYB record + uploaded doc types.
func (h *Handler) GetKYB(c *gin.Context) {
	userID := ginutil.UserID(c)
	k, docTypes, err := h.svc.GetKYB(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{keyError: httperr.Msg(c, http.StatusForbidden, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kyb": k, "documents": docTypes})
}

// SaveKYB → PUT /restaurant/:id/kyb (owner). Upserts the business/settlement details.
func (h *Handler) SaveKYB(c *gin.Context) {
	userID := ginutil.UserID(c)
	var body KYB
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	k, err := h.svc.SaveKYB(c.Request.Context(), c.Param("id"), userID, body)
	if err != nil {
		c.JSON(kybErrCode(err), gin.H{keyError: httperr.Msg(c, kybErrCode(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kyb": k})
}

// AddKYBDocument → POST /restaurant/:id/kyb/documents (owner). Records a reference to
// a document the owner has already uploaded to storage.
func (h *Handler) AddKYBDocument(c *gin.Context) {
	userID := ginutil.UserID(c)
	var body struct {
		DocType  string `json:"doc_type" binding:"required"`
		FileURL  string `json:"file_url" binding:"required"`
		FileName string `json:"file_name"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if err := h.svc.AddKYBDocument(c.Request.Context(), c.Param("id"), userID, body.DocType, body.FileURL, body.FileName); err != nil {
		c.JSON(kybErrCode(err), gin.H{keyError: httperr.Msg(c, kybErrCode(err), err)})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"ok": true})
}

// SubmitKYB → POST /restaurant/:id/kyb/submit (owner). Validates + submits for review.
func (h *Handler) SubmitKYB(c *gin.Context) {
	userID := ginutil.UserID(c)
	k, err := h.svc.SubmitKYB(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(kybErrCode(err), gin.H{keyError: httperr.Msg(c, kybErrCode(err), err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"kyb": k})
}

// kybErrCode maps KYB errors: an incomplete submission → 422, an owner-authorization
// failure → 403, anything else (illegal transition / edit-while-locked) → 400.
func kybErrCode(err error) int {
	switch {
	case errors.Is(err, ErrKYBIncomplete):
		return http.StatusUnprocessableEntity
	case errors.Is(err, ErrKYBFileTooLarge):
		return http.StatusRequestEntityTooLarge
	case errors.Is(err, ErrKYBUnsupportedType):
		return http.StatusUnsupportedMediaType
	case errors.Is(err, ErrKYBUploadsUnavailable):
		return http.StatusServiceUnavailable
	case strings.Contains(err.Error(), "only the owner"), strings.Contains(err.Error(), "not found"):
		return http.StatusForbidden
	default:
		return http.StatusBadRequest
	}
}
