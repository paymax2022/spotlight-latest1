package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/kycverify"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/provider"
	"spotlight/backend/internal/services"
)

// kycVerifyGateway is the narrow slice of *kycverify.Service that SubmitTier1
// needs: start a session, record consent, run one check. Declared here (not
// imported as the concrete type everywhere) so this handler's tier-submission
// logic is testable with a fake, without a live kycverify Postgres pool — the
// same reasoning kycverify itself uses for its own TierElevator dependency.
type kycVerifyGateway interface {
	StartSession(ctx context.Context, userID string, targetTier int) (*kycverify.Session, error)
	RecordConsent(ctx context.Context, userID, scope, version, ip string) (*kycverify.Consent, error)
	RunCheck(ctx context.Context, userID, sessionID string, ct provider.KycCheckType, req provider.KycVerifyRequest) (*kycverify.Check, error)
}

// KYCConnectHandler handles /api/v1/kyc/* endpoints for tier progression.
//
// Tier state lives in user_profiles.kyc_tier — the single source of truth that
// finance/tiers enforces limits against and that referrals, virtual accounts,
// marketplace, and academy all read.
//
// SubmitTier1 delegates to kycVerify (the real Dojah/Smile ID/Youverify-backed
// verification gateway) when configured — a real BVN/NIN data-match check runs
// before the tier is ever elevated, and elevation itself happens automatically
// inside kycverify's orchestrator (kyc.Service.Approve is its tier-write sink,
// unchanged). SubmitTier2/SubmitTier3 still delegate to kyc.Service.Initiate
// directly — that write happens with NO automated check — because their
// kycverify equivalents (liveness/facial/document) need real camera/SDK image
// capture the mobile app does not have yet (see registerConnectWalletRoutes's
// comment). GetStatus/GetLimits/GetTierStatus are reads, untouched either way.
type KYCConnectHandler struct {
	kycSvc    *kyc.Service
	tiersSvc  *tiers.Service
	auditSvc  services.AuditService
	kycVerify kycVerifyGateway // nil unless FEATURE_KYC_VERIFY_ENABLED — see SubmitTier1
}

// NewKYCConnectHandler builds the handler. kycVerify may be a nil *kycverify.Service
// (Go's typed-nil-in-interface case is handled explicitly in SubmitTier1 via the
// caller-visible kycVerify != nil param check below, not by calling a method on it)
// when the verification gateway feature flag is off.
func NewKYCConnectHandler(kycSvc *kyc.Service, tiersSvc *tiers.Service, auditSvc services.AuditService, kycVerify *kycverify.Service) *KYCConnectHandler {
	h := &KYCConnectHandler{
		kycSvc:   kycSvc,
		tiersSvc: tiersSvc,
		auditSvc: auditSvc,
	}
	// A nil *kycverify.Service assigned to the kycVerifyGateway interface field
	// would be a non-nil interface wrapping a nil pointer — h.kycVerify != nil
	// would then be true and calling its methods would panic. Keep the interface
	// field itself nil when the concrete pointer is nil.
	if kycVerify != nil {
		h.kycVerify = kycVerify
	}
	return h
}

// kycProfilePayload renders a kyc.Profile for the mobile client.
func kycProfilePayload(p *kyc.Profile) gin.H {
	tier := int(p.Tier)
	out := gin.H{
		"tier":               tier,
		"label":              tierLabels[tier],
		"status":             string(p.Status),
		"verificationStatus": string(p.Status),
		"phoneVerified":      p.PhoneVerified,
		"canSend":            tier >= 1,
		"canReceive":         true,
		"canWithdraw":        tier >= 2,
		"canGoLive":          tier >= 2,
		"nextTier":           tier + 1,
	}
	if p.VerifiedAt != nil {
		out["verifiedAt"] = p.VerifiedAt
	}
	if p.RequestedTier != nil {
		out["requestedTier"] = *p.RequestedTier
	}
	if p.DocumentType != nil {
		out["documentType"] = *p.DocumentType
	}
	return out
}

// GetStatus — GET /api/v1/kyc/status
// View KYC verification state.
func (h *KYCConnectHandler) GetStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	profile, err := h.kycSvc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load kyc status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": kycProfilePayload(profile)})
}

// GetLimits — GET /api/v1/kyc/limits
// View the tier limits ladder. Values come from the same tiers config the
// wallet enforces, so what is displayed cannot drift from what is enforced.
func (h *KYCConnectHandler) GetLimits(c *gin.Context) {
	requiredDocs := map[int][]string{
		0: {},
		1: {"BVN"},
		2: {"BVN", "Photo ID", "Proof of address"},
		3: {"BVN", "NIN", "Photo ID", "Liveness check", "Source of funds"},
	}

	data := []gin.H{}
	for t := 0; t <= 3; t++ {
		cfg := tiers.GetConfig(tiers.Tier(t))
		data = append(data, gin.H{
			"tier":              t,
			"label":             tierLabels[t],
			"dailyLimitKobo":    cfg.DailyDebitLimitKobo, // 0 = unlimited (T3) / disabled (T0)
			"maxBalanceKobo":    cfg.MaxBalanceKobo,      // 0 = unlimited
			"walletEnabled":     t > 0,
			"requiredDocuments": requiredDocs[t],
		})
	}

	c.JSON(http.StatusOK, gin.H{"data": data})
}

// requireSubmitContext validates the auth + idempotency preconditions shared by
// every tier submission. Returns false when it has already written a response.
func requireSubmitContext(c *gin.Context) bool {
	if c.GetString("user_id") == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return false
	}
	if c.GetHeader("Idempotency-Key") == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return false
	}
	return true
}

// submitTier is the shared body of the three tier submission endpoints. Each
// tier differs only in the payload it validates and what it forwards to
// kyc.Initiate, which does the hashing, the write, and the audit event.
func (h *KYCConnectHandler) submitTier(c *gin.Context, targetTier int, req kyc.InitiateRequest, message string) {
	userID := c.GetString("user_id")

	profile, err := h.kycSvc.Initiate(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to submit kyc"})
		return
	}

	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "submit_kyc", "kyc", "user_profile",
			userID, nil, map[string]interface{}{
				"targetTier": targetTier,
				"status":     string(profile.Status),
			}, getIPAddress(c), c.Request.UserAgent(), "info")
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":         true,
		"tier":       int(profile.Tier),
		"status":     string(profile.Status),
		"targetTier": targetTier,
		"message":    message,
	}})
}

// SubmitTier1 — POST /api/v1/kyc/tier1 (Idempotency-Key required)
// Submit BVN/NIN for Tier 1 — runs a REAL data-match check via the KYC
// verification gateway (Dojah primary, Smile ID/Youverify fallback) before the
// tier is ever elevated. This used to write kyc_status='pending' with the
// identifier hashed and stored, and NOTHING else — no automated check at all,
// an admin (or nothing) decided later. Tier 1 needs exactly one check
// (ID_NUMBER, see kycverify.RequiredChecks) and Dojah's BVN/NIN lookup takes an
// id_number alone — no name/DOB match, no image capture — so this is the one
// tier submission that can be wired to the real gateway today without any
// mobile-side camera/SDK work. Tiers 2/3 cannot: see
// registerConnectWalletRoutes's comment.
func (h *KYCConnectHandler) SubmitTier1(c *gin.Context) {
	if !requireSubmitContext(c) {
		return
	}
	userID := c.GetString("user_id")
	idempotencyKey := c.GetHeader("Idempotency-Key")

	var body struct {
		Identifier     string `json:"identifier"`
		IdentifierType string `json:"identifierType"`
		// ConsentVersion acknowledges NDPA/CBN data-processing consent — required,
		// not optional: kycverify.RunCheck fails closed without a recorded consent
		// (ErrConsentRequired), and that gate must not be silently satisfied
		// server-side just to make an old client request shape "work". A client
		// that omits it gets a clear 403 telling it to collect consent first,
		// which is the correct failure — not a silent unverified approval, which
		// is the bug this endpoint used to have.
		ConsentVersion string `json:"consentVersion"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if len(body.Identifier) != 11 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enter a valid 11-digit identifier"})
		return
	}

	// Fail closed, not silently degrade: no verification gateway configured
	// means Tier 1 cannot be safely granted, not "grant it unchecked like before".
	if h.kycVerify == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "identity verification is temporarily unavailable, please try again shortly",
			"code":  "kyc_verify_unavailable",
		})
		return
	}
	if body.ConsentVersion == "" {
		c.JSON(http.StatusForbidden, gin.H{"error": "consent required before verification", "code": "consent_required"})
		return
	}

	idType := "bvn"
	if body.IdentifierType == "nin" {
		idType = "nin"
	}

	ctx := c.Request.Context()
	if _, err := h.kycVerify.RecordConsent(ctx, userID, "kyc-data-processing", body.ConsentVersion, getIPAddress(c)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record consent"})
		return
	}
	sess, err := h.kycVerify.StartSession(ctx, userID, 1)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start verification"})
		return
	}
	check, err := h.kycVerify.RunCheck(ctx, userID, sess.ID, provider.KycIDNumber, provider.KycVerifyRequest{
		ClientRef: idempotencyKey,
		IDType:    idType,
		IDNumber:  body.Identifier,
	})
	if err != nil {
		writeKycVerifyErr(c, err)
		return
	}

	// A PASSED check elevates the tier automatically inside kycverify's own
	// orchestrator (Recompute -> kyc.Service.Approve) — nothing to call here.
	// Re-read the profile so the response reports what was ACTUALLY persisted,
	// not an assumed outcome.
	profile, perr := h.kycSvc.GetProfile(ctx, userID)
	if perr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "verification ran but failed to load status"})
		return
	}

	if h.auditSvc != nil {
		h.auditSvc.LogAction(userID, "", "submit_kyc", "kyc", "user_profile",
			userID, nil, map[string]interface{}{
				"targetTier":  1,
				"status":      string(profile.Status),
				"checkStatus": string(check.Status),
			}, getIPAddress(c), c.Request.UserAgent(), "info")
	}

	c.JSON(http.StatusCreated, gin.H{"data": gin.H{
		"ok":          true,
		"tier":        int(profile.Tier),
		"status":      string(profile.Status),
		"targetTier":  1,
		"checkStatus": string(check.Status),
		"message":     tier1Message(check.Status),
	}})
}

// tier1Message renders the real check outcome, never a fixed "submitted for
// verification" claim the old endpoint always sent regardless of what (if
// anything) actually happened.
func tier1Message(status provider.KycCheckStatus) string {
	switch status {
	case provider.KycPassed:
		return "Tier 1 verified."
	case provider.KycFailed:
		return "We couldn't verify that BVN/NIN. Check the number and try again."
	case provider.KycReview:
		return "Your details need a closer look — our team will review shortly."
	default: // PENDING/INITIATED — provider answers asynchronously via webhook.
		return "Verification in progress — this can take a few minutes."
	}
}

// writeKycVerifyErr maps kycverify's domain sentinels to HTTP status, mirroring
// kycverify/handler.go's own writeErr (unexported there, so not reused directly).
func writeKycVerifyErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, kycverify.ErrConsentRequired):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "code": "consent_required"})
	case errors.Is(err, kycverify.ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
	case errors.Is(err, kycverify.ErrInvalidRequest), errors.Is(err, kycverify.ErrInvalidTier):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, kycverify.ErrNoProvider), errors.Is(err, kycverify.ErrProviderUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error(), "code": "no_provider"})
	case errors.Is(err, kycverify.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, kycverify.ErrIllegalTransition):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// SubmitTier2 — POST /api/v1/kyc/tier2 (Idempotency-Key required)
// Submit ID + address for Tier 2.
//
// STILL writes kyc_status='pending' via kyc.Service.Initiate with NO automated
// check, same as Tier 1 used to. NOT fixed alongside SubmitTier1: Tier 2 needs
// a real DOCUMENT and/or LIVENESS/FACIAL check (kycverify.RequiredChecks), both
// of which require actual captured images — this client sends a pre-uploaded
// file URI, not the base64 bytes kycverify's checks expect, and the app's own
// capture UI for those checks (src/features/kycverify/components/CaptureStub.tsx)
// is an explicit, commented sandbox stub with no real camera/SDK behind it yet.
// Wiring this through today would submit fake bytes to a real provider. See
// PR retiring the admin manual-approval bypass for the fuller writeup.
func (h *KYCConnectHandler) SubmitTier2(c *gin.Context) {
	if !requireSubmitContext(c) {
		return
	}

	var body struct {
		IdDocumentUri     string `json:"idDocumentUri"`
		ProofOfAddressUri string `json:"proofOfAddressUri"`
		AddressLine       string `json:"addressLine"`
		City              string `json:"city"`
		State             string `json:"state"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if body.IdDocumentUri == "" || body.ProofOfAddressUri == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "upload both a photo ID and proof of address"})
		return
	}
	if body.AddressLine == "" || body.City == "" || body.State == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "complete your residential address"})
		return
	}

	docType := "government_id"
	req := kyc.InitiateRequest{
		RequestedTier: 2,
		DocumentType:  &docType,
		DocumentRef:   &body.IdDocumentUri,
	}

	h.submitTier(c, 2, req, "Documents submitted. Review takes up to 24 hours.")
}

// SubmitTier3 — POST /api/v1/kyc/tier3 (Idempotency-Key required)
// Submit liveness + EDD (source of funds + occupation) for Tier 3.
//
// Same gap as SubmitTier2, same reason: no real biometric capture yet. See the
// comment there.
func (h *KYCConnectHandler) SubmitTier3(c *gin.Context) {
	if !requireSubmitContext(c) {
		return
	}

	var body struct {
		LivenessUri   string `json:"livenessUri"`
		SourceOfFunds string `json:"sourceOfFunds"`
		Occupation    string `json:"occupation"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if body.LivenessUri == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "complete the liveness check"})
		return
	}
	if body.SourceOfFunds == "" || body.Occupation == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "complete the enhanced due diligence details"})
		return
	}

	docType := "liveness"
	req := kyc.InitiateRequest{
		RequestedTier: 3,
		DocumentType:  &docType,
		DocumentRef:   &body.LivenessUri,
	}

	h.submitTier(c, 3, req, "EDD submitted. Our compliance team will review shortly.")
}

// GetTierStatus — GET /api/v1/me/tier
// Get current tier status alongside today's remaining allowance.
func (h *KYCConnectHandler) GetTierStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}

	profile, err := h.kycSvc.GetProfile(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load tier status"})
		return
	}

	// Today's allowance, from the SAME tiers.GetUsage the fail-closed wallet-debit
	// gate is derived from — so a client pre-check (e.g. the mobile checkout sheet
	// refusing to open the card gateway for a spend that would be rejected) agrees
	// with what the server will actually do.
	//
	// walletDisabled and dailyUsedKobo are reported explicitly rather than left to be
	// inferred: without them a client has to decode the (0, -1) / (0, 0) encoding of
	// "unlimited" vs "disabled" itself, which is exactly the kind of duplicated money
	// rule that drifts.
	//
	// On a usage error the three fields are OMITTED rather than zeroed — a client
	// must not read a missing allowance as "you have none". Absence means "unknown";
	// the server-side gate remains the authority.
	payload := kycProfilePayload(profile)
	if usage, err := h.tiersSvc.GetUsage(c.Request.Context(), userID); err == nil {
		payload["dailyLimitKobo"] = usage.DailyLimitKobo // 0 = unlimited (T3) or disabled (T0)
		payload["remainingKobo"] = usage.RemainingKobo   // -1 = unlimited
		payload["dailyUsedKobo"] = usage.DailyUsedKobo
		payload["walletDisabled"] = usage.WalletDisabled
		// Purchases may still be permitted while the wallet is otherwise disabled
		// (ADR-043). Sent alongside walletDisabled, never instead of it: a client
		// deciding about a PURCHASE consults these, one deciding about a transfer
		// must keep reading walletDisabled.
		payload["checkoutEnabled"] = usage.CheckoutEnabled
		payload["checkoutAllowanceKobo"] = usage.CheckoutAllowanceKobo
		payload["checkoutRemainingKobo"] = usage.CheckoutRemainingKobo
	}

	c.JSON(http.StatusOK, gin.H{"data": payload})
}
