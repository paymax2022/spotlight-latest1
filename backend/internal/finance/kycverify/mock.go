package kycverify

import (
	"context"
	"spotlight/backend/internal/provider"
)

// MockProvider implements all KYC ports with deterministic results for local dev.
type MockProvider struct{}

func NewMockProvider() *MockProvider {
	return &MockProvider{}
}

func (m *MockProvider) Name() string { return "mock" }

func (m *MockProvider) VerifyIDNumber(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	return provider.KycCheckResult{
		Status:     provider.KycPassed,
		Match:      true,
		Confidence: 100,
		Reason:     "mock: identity verified",
		// Deterministic "registered identity" so the dev flow can DISPLAY the
		// returned value and affirm it, exactly like a real NIN/BVN lookup.
		ExtractedFields: map[string]string{
			"first_name":    "Mock",
			"last_name":     "Testuser",
			"full_name":     "Mock Testuser",
			"date_of_birth": "1990-01-01",
		},
		Terminal: true,
	}, nil
}

func (m *MockProvider) VerifyIDFacial(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	return provider.KycCheckResult{
		Status:     provider.KycPassed,
		Match:      true,
		Confidence: 100,
		Reason:     "mock: facial match passed",
		Terminal:   true,
	}, nil
}

func (m *MockProvider) VerifyLiveness(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	return provider.KycCheckResult{
		Status:     provider.KycPassed,
		Match:      true,
		Confidence: 100,
		Reason:     "mock: liveness passed",
		Terminal:   true,
	}, nil
}

func (m *MockProvider) VerifyDocument(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	return provider.KycCheckResult{
		Status:     provider.KycPassed,
		Match:      true,
		Confidence: 100,
		Reason:     "mock: document verified",
		Terminal:   true,
	}, nil
}

func (m *MockProvider) ScreenAML(ctx context.Context, req provider.KycVerifyRequest) (provider.KycCheckResult, error) {
	return provider.KycCheckResult{
		Status:     provider.KycPassed,
		Match:      true,
		Confidence: 100,
		Reason:     "mock: aml screening passed",
		Terminal:   true,
	}, nil
}

func (m *MockProvider) VerifyKycSignature(payload []byte, signature string) bool {
	return true
}

func (m *MockProvider) ParseKycWebhook(payload []byte) (*provider.KycWebhookEvent, error) {
	return &provider.KycWebhookEvent{
		Status:     provider.KycPassed,
		ClientRef:  "mock-ref",
		Match:      true,
		Confidence: 100,
	}, nil
}
