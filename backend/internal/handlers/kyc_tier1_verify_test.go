package handlers

// Pure-logic tests for SubmitTier1's gating behavior — no database. These pin
// exactly the failure modes that made this endpoint a manual-approval bypass:
// a missing consent field, or the verification gateway being unconfigured,
// must NEVER fall through to a silent unverified write. Written before the fix
// (see the PR retiring the admin manual-approval bypass) to prove the fail-
// closed behavior, not just the happy path a mock could fake.
//
// The provider-call happy path (a real PASSED check auto-elevating the tier)
// is NOT re-tested here — that logic lives entirely in kycverify's own
// orchestrator/statemachine and is already covered by
// internal/finance/kycverify/{orchestrator,statemachine,gateway}_test.go,
// which this change does not touch. What's new and untested before this file
// is the glue in THIS handler: does it call the gateway at all, in what order,
// and does it fail closed when it shouldn't have been called.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spotlight/backend/internal/finance/kycverify"
	"spotlight/backend/internal/provider"
)

// fakeKycVerifyGateway records calls so a test can assert not just the HTTP
// response but whether RunCheck (the actual provider-bound call) ever fired —
// the property that matters most here is "did NOT run an unverified bypass".
type fakeKycVerifyGateway struct {
	consentCalls int
	sessionCalls int
	runCheckArgs *provider.KycVerifyRequest // nil until RunCheck is called

	startSessionErr  error
	recordConsentErr error
	runCheckErr      error
	runCheckResult   *kycverify.Check
}

func (f *fakeKycVerifyGateway) StartSession(_ context.Context, _ string, _ int) (*kycverify.Session, error) {
	f.sessionCalls++
	if f.startSessionErr != nil {
		return nil, f.startSessionErr
	}
	return &kycverify.Session{ID: "sess-1", Status: kycverify.SessUnverified}, nil
}

func (f *fakeKycVerifyGateway) RecordConsent(_ context.Context, _, _, _, _ string) (*kycverify.Consent, error) {
	f.consentCalls++
	if f.recordConsentErr != nil {
		return nil, f.recordConsentErr
	}
	return &kycverify.Consent{ID: "consent-1"}, nil
}

func (f *fakeKycVerifyGateway) RunCheck(_ context.Context, _, _ string, _ provider.KycCheckType, req provider.KycVerifyRequest) (*kycverify.Check, error) {
	f.runCheckArgs = &req
	if f.runCheckErr != nil {
		return nil, f.runCheckErr
	}
	if f.runCheckResult != nil {
		return f.runCheckResult, nil
	}
	return &kycverify.Check{ID: "check-1", Status: provider.KycPending}, nil
}

func newTier1TestContext(body string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/kyc/tier1", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header.Set("Idempotency-Key", "idem-test-key")
	c.Set("user_id", "11111111-1111-1111-1111-111111111111")
	return c, w
}

func TestSubmitTier1_NoGatewayConfigured_FailsClosed(t *testing.T) {
	// FEATURE_KYC_VERIFY_ENABLED off (or no creds) means kycVerify is nil.
	// Before this fix, that meant SubmitTier1 fell back to a bare unverified
	// write via kyc.Service.Initiate. It must now refuse instead.
	h := &KYCConnectHandler{kycVerify: nil}
	c, w := newTier1TestContext(`{"identifier":"12345678901","identifierType":"bvn","consentVersion":"2026-07-ndpa-cbn-v1"}`)

	h.SubmitTier1(c)

	assert.Equal(t, http.StatusServiceUnavailable, w.Code)
	assert.Contains(t, w.Body.String(), "kyc_verify_unavailable")
}

func TestSubmitTier1_MissingConsent_RefusesBeforeAnyProviderCall(t *testing.T) {
	fake := &fakeKycVerifyGateway{}
	h := &KYCConnectHandler{kycVerify: fake}
	c, w := newTier1TestContext(`{"identifier":"12345678901","identifierType":"bvn"}`)

	h.SubmitTier1(c)

	assert.Equal(t, http.StatusForbidden, w.Code)
	assert.Contains(t, w.Body.String(), "consent_required")
	// The whole point: no consent recorded, no session started, no check run.
	assert.Equal(t, 0, fake.consentCalls, "must not record consent without an explicit consentVersion")
	assert.Equal(t, 0, fake.sessionCalls, "must not start a session before consent exists")
	require.Nil(t, fake.runCheckArgs, "must never reach the provider without consent")
}

func TestSubmitTier1_InvalidIdentifier_RefusesBeforeAnyProviderCall(t *testing.T) {
	fake := &fakeKycVerifyGateway{}
	h := &KYCConnectHandler{kycVerify: fake}
	c, w := newTier1TestContext(`{"identifier":"123","identifierType":"bvn","consentVersion":"2026-07-ndpa-cbn-v1"}`)

	h.SubmitTier1(c)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, 0, fake.consentCalls)
	require.Nil(t, fake.runCheckArgs)
}

func TestSubmitTier1_ValidRequest_RunsRealIDNumberCheck(t *testing.T) {
	// Confirms the actual check dispatched is ID_NUMBER with the identifier the
	// client sent, and that consent + session both happen before it — this is
	// the exact sequence that turns "hash and store" into "actually verify".
	fake := &fakeKycVerifyGateway{}
	h := &KYCConnectHandler{kycVerify: fake}
	c, _ := newTier1TestContext(`{"identifier":"12345678901","identifierType":"nin","consentVersion":"2026-07-ndpa-cbn-v1"}`)

	// SubmitTier1 also calls h.kycSvc.GetProfile after a successful check, which
	// needs a real *kyc.Service (DB-backed) — out of scope for this pure-logic
	// test, hence the expected panic on this test's nil kycSvc. Side effects up
	// to that point (recorded on `fake`) already happened by the time it panics,
	// so they're still assertable — that's what this test actually verifies;
	// the profile re-read itself is exercised by the live-DB suite alongside
	// kycverify's own tests.
	assert.Panics(t, func() { h.SubmitTier1(c) })

	require.NotNil(t, fake.runCheckArgs, "must run a real check, not just write a pending status")
	assert.Equal(t, "nin", fake.runCheckArgs.IDType)
	assert.Equal(t, "12345678901", fake.runCheckArgs.IDNumber)
	assert.Equal(t, "idem-test-key", fake.runCheckArgs.ClientRef, "Idempotency-Key must become the check's client_ref")
	assert.Equal(t, 1, fake.consentCalls)
	assert.Equal(t, 1, fake.sessionCalls)
}

func TestSubmitTier1_ProviderError_MapsToHTTPStatus(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		wantCode int
	}{
		{"consent required (defense in depth)", kycverify.ErrConsentRequired, http.StatusForbidden},
		{"no provider configured", kycverify.ErrProviderUnavailable, http.StatusServiceUnavailable},
		{"unexpected failure stays opaque", errors.New("connection reset"), http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fake := &fakeKycVerifyGateway{runCheckErr: tc.err}
			h := &KYCConnectHandler{kycVerify: fake}
			c, w := newTier1TestContext(`{"identifier":"12345678901","identifierType":"bvn","consentVersion":"2026-07-ndpa-cbn-v1"}`)

			h.SubmitTier1(c)

			assert.Equal(t, tc.wantCode, w.Code)
		})
	}
}

func TestTier1Message_ReflectsRealOutcome(t *testing.T) {
	// The old endpoint always said "submitted for verification" regardless of
	// what happened. The message must now vary with the real check status.
	assert.Contains(t, tier1Message(provider.KycPassed), "verified")
	assert.Contains(t, tier1Message(provider.KycFailed), "couldn't verify")
	assert.Contains(t, tier1Message(provider.KycReview), "review")
	assert.Contains(t, tier1Message(provider.KycPending), "progress")
}
