package kyc_test

import (
	"context"
	"errors"
	"testing"

	"spotlight/backend/internal/finance/kyc"
)

// Initiate must reject document_type values outside the
// user_profiles_document_type_check enum (20260613000000_kyc_fields.sql:
// BVN/NIN/PASSPORT/DRIVERS_LICENSE) BEFORE opening a transaction — the check
// runs first, so a nil pool must never be dereferenced on this path. Passing
// one through anyway surfaces as an opaque 500 check-constraint violation at
// the UPDATE (this is what "failed to submit kyc" on /api/v1/kyc/tier2+3 was:
// the connect handler hardcoded 'government_id'/'liveness').
func TestInitiateRejectsOutOfEnumDocumentType(t *testing.T) {
	svc := kyc.NewService(nil)

	for _, bad := range []string{"government_id", "liveness", "voters_card", ""} {
		bad := bad
		_, err := svc.Initiate(context.Background(), "user-1", kyc.InitiateRequest{
			RequestedTier: 2,
			DocumentType:  &bad,
			DocumentRef:   ptr("r2://probe/doc.png"),
		})
		if !errors.Is(err, kyc.ErrInvalidDocumentType) {
			t.Fatalf("document_type %q: expected ErrInvalidDocumentType, got %v", bad, err)
		}
	}
}

// In-enum document types must NOT be rejected by validation — they proceed to
// the transaction, so with a nil pool the call panics at Begin; recover and
// treat a panic as proof the value passed validation.
func TestInitiateAcceptsEnumDocumentTypes(t *testing.T) {
	for _, good := range []string{"BVN", "NIN", "PASSPORT", "DRIVERS_LICENSE"} {
		good := good
		func() {
			defer func() { _ = recover() }()
			svc := kyc.NewService(nil)
			_, err := svc.Initiate(context.Background(), "user-1", kyc.InitiateRequest{
				RequestedTier: 2,
				DocumentType:  &good,
			})
			if errors.Is(err, kyc.ErrInvalidDocumentType) {
				t.Fatalf("document_type %q: in-enum value was rejected", good)
			}
		}()
	}
}

// A nil DocumentType (tier-2/3 submissions carry only a document_ref URI) must
// pass validation — pinned so a future "required" regression can't re-break
// the tier2/tier3 submit path.
func TestInitiateAllowsNilDocumentType(t *testing.T) {
	func() {
		defer func() { _ = recover() }()
		svc := kyc.NewService(nil)
		_, err := svc.Initiate(context.Background(), "user-1", kyc.InitiateRequest{
			RequestedTier: 2,
			DocumentRef:   ptr("r2://probe/doc.png"),
		})
		if errors.Is(err, kyc.ErrInvalidDocumentType) {
			t.Fatal("nil document_type must pass validation")
		}
	}()
}

func ptr(s string) *string { return &s }
