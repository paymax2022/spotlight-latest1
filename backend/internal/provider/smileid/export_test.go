package smileid

import "spotlight/backend/internal/provider"

// Test-only export of the callback→KycCheckResult mapper so the external
// smileid_test package can drive table-driven mapping assertions without network.
func MapCallbackResultForTest(raw []byte) provider.KycCheckResult {
	return mapCallbackResult(raw)
}
