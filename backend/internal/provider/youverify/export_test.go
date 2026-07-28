package youverify

import "spotlight/backend/internal/provider"

// Test-only exports of unexported mappers so the external youverify_test package
// can drive table-driven mapping assertions without network.

func MapIDNumberForTest(raw []byte, clientRef string) provider.KycCheckResult {
	return mapIDNumber(raw, clientRef)
}

func MapFacialForTest(raw []byte, clientRef string, threshold int) provider.KycCheckResult {
	return mapFacial(raw, clientRef, threshold)
}
