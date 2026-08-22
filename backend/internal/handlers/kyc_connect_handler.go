package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"spotlight/backend/internal/finance/kyc"
	"spotlight/backend/internal/finance/tiers"
	"spotlight/backend/internal/services"
)

// KYCConnectHandler handles /api/v1/kyc/* endpoints for tier progression.
//
// Tier state lives in user_profiles.kyc_tier — the single source of truth that
// finance/tiers enforces limits against and that referrals, virtual accounts,
// marketplace, and academy all read. Everything here delegates to kyc.Service so
// submissions land in that column, hash BVN/NIN before storage, and emit a
// kyc_events audit row.
type KYCConnectHandler struct {
	kycSvc   *kyc.Service
	tiersSvc *tiers.Service
	auditSvc services.AuditService
}

func NewKYCConnectHandler(kycSvc *kyc.Service, tiersSvc *tiers.Service, auditSvc services.AuditService) *KYCConnectHandler {
	return &KYCConnectHandler{
		kycSvc:   kycSvc,
		tiersSvc: tiersSvc,
		auditSvc: auditSvc,
	}
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
// Submit BVN/NIN for Tier 1.
func (h *KYCConnectHandler) SubmitTier1(c *gin.Context) {
	if !requireSubmitContext(c) {
		return
	}

	var body struct {
		Identifier     string `json:"identifier"`
		IdentifierType string `json:"identifierType"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}
	if len(body.Identifier) != 11 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "enter a valid 11-digit identifier"})
		return
	}

	// The identifier is a BVN unless the client says otherwise. kyc.Initiate
	// hashes it — the raw value is never persisted.
	req := kyc.InitiateRequest{RequestedTier: 1}
	if body.IdentifierType == "nin" {
		req.NIN = &body.Identifier
	} else {
		req.BVN = &body.Identifier
	}

	h.submitTier(c, 1, req, "Tier 1 KYC submitted for verification.")
}

// SubmitTier2 — POST /api/v1/kyc/tier2 (Idempotency-Key required)
// Submit ID + address for Tier 2.
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
