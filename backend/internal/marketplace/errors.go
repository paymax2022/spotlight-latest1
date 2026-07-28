package marketplace

import (
	"errors"
	"fmt"
	"net/http"
)

// CodedError is the uniform marketplace error shape. It carries a machine code
// (§3 taxonomy), a human message, an optional field (for validation errors), and
// the HTTP status the handler should emit. The wire shape is:
//
//	{"error":{"code","message","field","request_id"}}
//
// request_id is stamped by the handler from the gin request context, not here.
type CodedError struct {
	Status  int    `json:"-"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func (e *CodedError) Error() string { return e.Code + ": " + e.Message }

// newErr constructs a CodedError.
func newErr(status int, code, message string) *CodedError {
	return &CodedError{Status: status, Code: code, Message: message}
}

// fieldErr constructs a 400 validation CodedError bound to a field.
func fieldErr(code, message, field string) *CodedError {
	return &CodedError{Status: http.StatusBadRequest, Code: code, Message: message, Field: field}
}

// asCoded unwraps err to a *CodedError, or synthesizes a 500 for anything else.
// Sentinel ledger/redis errors are mapped to their marketplace-domain code here so
// the service layer can return raw ledger errors and still produce a clean shape.
func asCoded(err error) *CodedError {
	if err == nil {
		return nil
	}
	var ce *CodedError
	if errors.As(err, &ce) {
		return ce
	}
	return &CodedError{Status: http.StatusInternalServerError, Code: CodeInternal, Message: err.Error()}
}

// wrapInternal preserves a coded error, otherwise wraps a raw error as an internal
// CodedError with context. Used inside the service to keep the taxonomy intact.
func wrapInternal(ctx string, err error) error {
	if err == nil {
		return nil
	}
	var ce *CodedError
	if errors.As(err, &ce) {
		return ce
	}
	return &CodedError{Status: http.StatusInternalServerError, Code: CodeInternal, Message: fmt.Sprintf("%s: %v", ctx, err)}
}

// ─── Error codes (§3 taxonomy — frozen strings other agents render) ──────────
const (
	CodeInternal        = "INTERNAL_ERROR"
	CodeUnauthenticated = "UNAUTHENTICATED"
	CodeValidation      = "SCHEMA_VALIDATION_FAILED"

	// Listings
	CodeListingNotFound          = "LISTING_NOT_FOUND"
	CodeListingNotActive         = "LISTING_NOT_ACTIVE"
	CodeListingNotEscrowElig     = "LISTING_NOT_ESCROW_ELIGIBLE"
	CodeDescriptionTooShort      = "DESCRIPTION_TOO_SHORT"
	CodeInsufficientPhotos       = "INSUFFICIENT_PHOTOS"
	CodePriceOutOfBand           = "PRICE_OUT_OF_BAND"
	CodeDuplicatePhotoDetected   = "DUPLICATE_PHOTO_DETECTED"
	CodeListingHasActiveOrder    = "LISTING_HAS_ACTIVE_ORDER"
	CodeInvalidListingTransition = "INVALID_LISTING_TRANSITION"

	// Orders / escrow
	CodeInvalidDeliveryOption  = "INVALID_DELIVERY_OPTION"
	CodeBuyerKYCInsufficient   = "BUYER_KYC_TIER_INSUFFICIENT"
	CodeSelfPurchaseNotAllowed = "SELF_PURCHASE_NOT_ALLOWED"
	CodeOrderNotFound          = "ORDER_NOT_FOUND"
	CodeOrderNotInitiated      = "ORDER_NOT_IN_INITIATED_STATE"
	CodeOrderAlreadyFunded     = "ORDER_ALREADY_FUNDED"
	CodeOrderExpired           = "ORDER_EXPIRED"
	CodeInsufficientWallet     = "INSUFFICIENT_WALLET_BALANCE"
	CodeOrderNotInspection     = "ORDER_NOT_IN_INSPECTION_WINDOW"
	CodeInspectionDeadlinePast = "INSPECTION_DEADLINE_PASSED"
	CodeOrderNotAcceptable     = "ORDER_NOT_ACCEPTABLE"
	CodeOrderNotCancellable    = "ORDER_NOT_CANCELLABLE"
	CodeOrderNotDisputable     = "ORDER_NOT_DISPUTABLE"
	CodeInvalidOrderTransition = "INVALID_ORDER_TRANSITION"
	CodeNotOrderBuyer          = "NOT_ORDER_BUYER"
	CodeNotOrderSeller         = "NOT_ORDER_SELLER"
	CodeNotOrderParty          = "NOT_ORDER_PARTY"

	// Disputes
	CodeDisputeNotFound          = "DISPUTE_NOT_FOUND"
	CodeDisputeAlreadyOpen       = "DISPUTE_ALREADY_OPEN_FOR_ORDER"
	CodeInvalidDisputeTransition = "INVALID_DISPUTE_TRANSITION"
	CodeReasonCodeRequired       = "REASON_CODE_REQUIRED"
	CodeAwaitingSecondApproval   = "AWAITING_SECOND_APPROVAL"
	CodeSameApproverNotAllowed   = "SAME_APPROVER_NOT_ALLOWED"

	// Boosts
	CodeBoostNotFound          = "BOOST_NOT_FOUND"
	CodeInvalidBoostTransition = "INVALID_BOOST_TRANSITION"
	CodeInvalidBoostTier       = "INVALID_BOOST_TIER"

	// Offers / reviews / misc
	CodeOfferNotFound  = "OFFER_NOT_FOUND"
	CodeReviewNotFound = "REVIEW_NOT_FOUND"
	CodeReviewExists   = "REVIEW_ALREADY_EXISTS"
	CodeNotFound       = "NOT_FOUND"

	// Cross-cutting
	CodeForbidden           = "FORBIDDEN"
	CodeIdempotencyReplay   = "IDEMPOTENCY_KEY_REPLAY"
	CodeIdempotencyMissing  = "IDEMPOTENCY_KEY_REQUIRED"
	CodeConflict            = "CONFLICT"
	CodeWebhookBadSignature = "WEBHOOK_BAD_SIGNATURE"
	CodeSearchNotWired      = "SEARCH_NOT_WIRED"
	CodeNotImplemented      = "NOT_IMPLEMENTED"

	// Account / trust gap endpoints (media presign, saved-items, reports, blocks,
	// notification prefs, meetup safe-spots).
	CodeUploadsNotConfigured = "UPLOADS_NOT_CONFIGURED"
	CodeAlreadySaved         = "ALREADY_SAVED"
	CodeSavedItemNotFound    = "SAVED_ITEM_NOT_FOUND"
	CodeAlreadyBlocked       = "ALREADY_BLOCKED"
	CodeBlockNotFound        = "BLOCK_NOT_FOUND"
	CodeCannotBlockSelf      = "CANNOT_BLOCK_SELF"
	CodeInvalidReportTarget  = "INVALID_REPORT_TARGET"
)

// Constructor helpers for the most common coded errors.
var (
	ErrForbidden       = newErr(http.StatusForbidden, CodeForbidden, "you may not act on this resource")
	ErrUnauthenticated = newErr(http.StatusUnauthorized, CodeUnauthenticated, "authentication required")
	ErrListingNotFound = newErr(http.StatusNotFound, CodeListingNotFound, "listing not found")
	ErrOrderNotFound   = newErr(http.StatusNotFound, CodeOrderNotFound, "order not found")
	ErrDisputeNotFound = newErr(http.StatusNotFound, CodeDisputeNotFound, "dispute not found")
	ErrBoostNotFound   = newErr(http.StatusNotFound, CodeBoostNotFound, "boost not found")
	ErrOfferNotFound   = newErr(http.StatusNotFound, CodeOfferNotFound, "offer not found")
	ErrReasonRequired  = newErr(http.StatusBadRequest, CodeReasonCodeRequired, "reason_code is required")
	ErrIdemMissing     = newErr(http.StatusBadRequest, CodeIdempotencyMissing, "Idempotency-Key header required")
	ErrConflict        = newErr(http.StatusConflict, CodeConflict, "conflicting concurrent write")
	// ErrListingNotActiveRace is returned by InsertOrderAtomic when the DB-level
	// optimistic lock finds the listing is no longer purchasable (status flipped, or
	// another buyer's order already holds this single-quantity listing). The service
	// maps it to 422 LISTING_NOT_ACTIVE so the race-loser gets a clean, correct code.
	ErrListingNotActiveRace = newErr(422, CodeListingNotActive, "listing is not active")
)
