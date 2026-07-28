package estate

import (
	"context"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/platform/r2"
)

// atoiDefault parses s as an int, returning def on empty/invalid input.
func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}

type Handler struct {
	svc           *Service
	presigner     *r2.Presigner // optional; nil/unconfigured disables presigned uploads
	presignBucket string
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) CreateEstate(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CreateEstateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	e, err := h.svc.CreateEstate(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, e)
}

func (h *Handler) AddResident(c *gin.Context) {
	adminID := c.GetString("user_id")
	var body struct {
		UserID string `json:"user_id" binding:"required"`
		Unit   string `json:"unit"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.AddResident(c.Request.Context(), c.Param("id"), adminID, body.UserID, body.Unit)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) IssuePass(c *gin.Context) {
	issuerID := c.GetString("user_id")
	var req IssuePassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.IssueVisitorPass(c.Request.Context(), c.Param("id"), issuerID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, p)
}

func (h *Handler) ScanPass(c *gin.Context) {
	scannerID := c.GetString("user_id")
	var body struct {
		QRCode string `json:"qr_code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.ScanVisitorPass(c.Request.Context(), c.Param("id"), scannerID, body.QRCode)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) CreateElection(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CreateElectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	el, err := h.svc.CreateElection(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, el)
}

func (h *Handler) CastVote(c *gin.Context) {
	voterID := c.GetString("user_id")
	var req CastVoteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.CastVote(c.Request.Context(), c.Param("id"), c.Param("electionId"), voterID, req)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (h *Handler) GetResults(c *gin.Context) {
	results, err := h.svc.GetResults(c.Request.Context(), c.Param("id"), c.Param("electionId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": results})
}

// GetVoterEligibility reports whether the caller may vote in an election.
// GET /estate/:id/elections/:electionId/eligibility
func (h *Handler) GetVoterEligibility(c *gin.Context) {
	userID := c.GetString("user_id")
	elig, err := h.svc.CheckVoterEligibility(c.Request.Context(), c.Param("id"), c.Param("electionId"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": elig})
}

// SetEligibilityRules configures an election's voter gating (estate admin only).
// POST /estate/:id/elections/:electionId/eligibility
func (h *Handler) SetEligibilityRules(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req SetEligibilityRulesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rules, err := h.svc.SetEligibilityRules(c.Request.Context(), c.Param("id"), adminID, c.Param("electionId"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rules})
}

// ── Block 28: Security gate / guard app ───────────────────────────────────────

func (h *Handler) ListGates(c *gin.Context) {
	gates, err := h.svc.ListGates(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gates})
}

func (h *Handler) GetExpectedVisitors(c *gin.Context) {
	visitors, err := h.svc.GetExpectedVisitors(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": visitors})
}

func (h *Handler) LookupCode(c *gin.Context) {
	payload, err := h.svc.LookupCode(
		c.Request.Context(), c.Param("id"),
		c.Query("numeric_code"), c.Query("qr_code"),
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (h *Handler) GuardCheckin(c *gin.Context) {
	guardID := c.GetString("user_id")
	var req GuardCheckinRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	payload, err := h.svc.CheckInVisitor(c.Request.Context(), c.Param("id"), guardID, req)
	if err != nil {
		code := http.StatusForbidden
		if payload != nil && payload.Blacklisted {
			code = http.StatusConflict // 409 = blacklisted
		}
		c.JSON(code, gin.H{"error": err.Error(), "payload": payload})
		return
	}
	c.JSON(http.StatusCreated, payload)
}

func (h *Handler) GuardCheckout(c *gin.Context) {
	guardID := c.GetString("user_id")
	var body struct {
		CodeID string `json:"code_id" binding:"required"`
		GateID string `json:"gate_id"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.CheckOutVisitor(c.Request.Context(), c.Param("id"), guardID, body.CodeID, body.GateID); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"event": "checked_out"})
}

func (h *Handler) SubmitIncident(c *gin.Context) {
	guardID := c.GetString("user_id")
	var req SubmitIncidentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rep, err := h.svc.SubmitIncidentReport(c.Request.Context(), c.Param("id"), guardID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, rep)
}

func (h *Handler) HandoverShift(c *gin.Context) {
	guardID := c.GetString("user_id")
	var req HandoverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	shift, err := h.svc.HandoverShift(c.Request.Context(), c.Param("id"), guardID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, shift)
}

func (h *Handler) SyncOfflineLogs(c *gin.Context) {
	guardID := c.GetString("user_id")
	var req SyncRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	synced, err := h.svc.SyncOfflineLogs(c.Request.Context(), c.Param("id"), guardID, req.Logs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"synced": synced})
}

func (h *Handler) ListIncidents(c *gin.Context) {
	adminID := c.GetString("user_id")
	incidents, err := h.svc.ListIncidents(c.Request.Context(), c.Param("id"), adminID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": incidents})
}

// ── Block 27: Extended visitor access codes ───────────────────────────────────

func (h *Handler) CreateAccessCode(c *gin.Context) {
	userID := c.GetString("user_id")
	var req CreateAccessCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	code, err := h.svc.CreateAccessCode(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, code)
}

func (h *Handler) ListAccessCodes(c *gin.Context) {
	userID := c.GetString("user_id")
	codes, err := h.svc.ListAccessCodes(c.Request.Context(), c.Param("id"), userID, c.Query("status"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": codes})
}

func (h *Handler) GetAccessCode(c *gin.Context) {
	userID := c.GetString("user_id")
	code, err := h.svc.GetAccessCode(c.Request.Context(), c.Param("id"), userID, c.Param("cid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, code)
}

func (h *Handler) RevokeCode(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.RevokeCode(c.Request.Context(), c.Param("id"), userID, c.Param("cid")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "revoked"})
}

func (h *Handler) ExtendCode(c *gin.Context) {
	userID := c.GetString("user_id")
	var req ExtendCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.ExtendCode(c.Request.Context(), c.Param("id"), userID, c.Param("cid"), req.ValidUntil); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"extended": true})
}

func (h *Handler) BlacklistVisitor(c *gin.Context) {
	adminID := c.GetString("user_id")
	if err := h.svc.BlacklistVisitor(c.Request.Context(), c.Param("id"), adminID, c.Param("cid")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"blacklisted": true})
}

func (h *Handler) GetCheckinHistory(c *gin.Context) {
	userID := c.GetString("user_id")
	history, err := h.svc.GetCheckinHistory(c.Request.Context(), c.Param("id"), userID, c.Param("cid"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": history})
}

// ── Block 26: Resident home dashboard ─────────────────────────────────────────

func (h *Handler) GetDashboard(c *gin.Context) {
	userID := c.GetString("user_id")
	dash, err := h.svc.GetDashboard(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, dash)
}

// ── Block 25: Resident profiles ───────────────────────────────────────────────

func (h *Handler) GetProfile(c *gin.Context) {
	userID := c.GetString("user_id")
	p, err := h.svc.GetProfile(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) UpsertProfile(c *gin.Context) {
	userID := c.GetString("user_id")
	var req UpsertProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.UpsertProfile(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) ListHouseholdMembers(c *gin.Context) {
	userID := c.GetString("user_id")
	members, err := h.svc.ListHouseholdMembers(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": members})
}

func (h *Handler) AddHouseholdMember(c *gin.Context) {
	userID := c.GetString("user_id")
	var req AddHouseholdMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.AddHouseholdMember(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, m)
}

func (h *Handler) DeleteHouseholdMember(c *gin.Context) {
	userID := c.GetString("user_id")
	if err := h.svc.DeleteHouseholdMember(c.Request.Context(), c.Param("id"), userID, c.Param("mid")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusNoContent, nil)
}

func (h *Handler) ListDomesticStaff(c *gin.Context) {
	userID := c.GetString("user_id")
	staff, err := h.svc.ListDomesticStaff(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": staff})
}

func (h *Handler) AddDomesticStaff(c *gin.Context) {
	userID := c.GetString("user_id")
	var req AddDomesticStaffRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	st, err := h.svc.AddDomesticStaff(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, st)
}

func (h *Handler) UpdateStaffStatus(c *gin.Context) {
	userID := c.GetString("user_id")
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.UpdateStaffStatus(c.Request.Context(), c.Param("id"), userID, c.Param("sid"), body.Status); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": body.Status})
}

func (h *Handler) ListVehicles(c *gin.Context) {
	userID := c.GetString("user_id")
	vehicles, err := h.svc.ListVehicles(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": vehicles})
}

func (h *Handler) AddVehicle(c *gin.Context) {
	userID := c.GetString("user_id")
	var req AddVehicleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.AddVehicle(c.Request.Context(), c.Param("id"), userID, req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (h *Handler) VerifyVehicle(c *gin.Context) {
	adminID := c.GetString("user_id")
	if err := h.svc.VerifyVehicle(c.Request.Context(), c.Param("id"), adminID, c.Param("vid")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"verified": true})
}

func (h *Handler) GetResidentCard(c *gin.Context) {
	userID := c.GetString("user_id")
	card, err := h.svc.GetResidentCard(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, card)
}

// ── Block 24: Onboarding & property selection ─────────────────────────────────

func (h *Handler) ListEstates(c *gin.Context) {
	search := c.Query("search")
	estates, err := h.svc.ListEstates(c.Request.Context(), search)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": estates})
}

func (h *Handler) GenerateInviteCode(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req GenerateInviteCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ic, err := h.svc.GenerateInviteCode(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, ic)
}

func (h *Handler) JoinWithInviteCode(c *gin.Context) {
	userID := c.GetString("user_id")
	var req JoinWithCodeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.JoinWithInviteCode(c.Request.Context(), userID, req.Code)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) RequestAccess(c *gin.Context) {
	userID := c.GetString("user_id")
	var req RequestAccessRequest
	_ = c.ShouldBindJSON(&req)
	jr, err := h.svc.RequestAccess(c.Request.Context(), c.Param("id"), userID, req.Message)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, jr)
}

func (h *Handler) GetMyJoinRequest(c *gin.Context) {
	userID := c.GetString("user_id")
	jr, err := h.svc.GetMyJoinRequest(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, jr)
}

func (h *Handler) ListJoinRequests(c *gin.Context) {
	adminID := c.GetString("user_id")
	status := c.Query("status")
	reqs, err := h.svc.ListJoinRequests(c.Request.Context(), c.Param("id"), adminID, status)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": reqs})
}

func (h *Handler) ReviewJoinRequest(c *gin.Context) {
	adminID := c.GetString("user_id")
	var body struct {
		Decision string `json:"decision" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	jr, err := h.svc.ReviewJoinRequest(c.Request.Context(), c.Param("id"), adminID, c.Param("reqId"), body.Decision)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, jr)
}

func (h *Handler) AddProperty(c *gin.Context) {
	adminID := c.GetString("user_id")
	var req AddPropertyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.AddProperty(c.Request.Context(), c.Param("id"), adminID, req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, p)
}

func (h *Handler) ListProperties(c *gin.Context) {
	userID := c.GetString("user_id")
	props, err := h.svc.ListProperties(c.Request.Context(), c.Param("id"), userID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": props})
}

func (h *Handler) ClaimOwnership(c *gin.Context) {
	userID := c.GetString("user_id")
	var req ClaimOwnershipRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	claim, err := h.svc.ClaimOwnership(c.Request.Context(), c.Param("pid"), userID, req.OwnershipDocURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, claim)
}

func (h *Handler) ReviewOwnershipClaim(c *gin.Context) {
	adminID := c.GetString("user_id")
	var body struct {
		Decision     string `json:"decision" binding:"required"`
		RejectReason string `json:"reject_reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	claim, err := h.svc.ReviewOwnershipClaim(c.Request.Context(), c.Param("claimId"), adminID, c.Param("id"), body.Decision, body.RejectReason)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, claim)
}

func (h *Handler) CreateTenancyRequest(c *gin.Context) {
	tenantID := c.GetString("user_id")
	var req TenancyRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tr, err := h.svc.CreateTenancyRequest(c.Request.Context(), c.Param("pid"), req, tenantID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, tr)
}

func (h *Handler) ReviewTenancyRequest(c *gin.Context) {
	landlordID := c.GetString("user_id")
	var body struct {
		Decision string `json:"decision" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	tr, err := h.svc.ReviewTenancyRequest(c.Request.Context(), c.Param("tid"), landlordID, c.Param("id"), body.Decision)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tr)
}

// ── Block 29: Property management ─────────────────────────────────────────────

func (h *Handler) GetProperty(c *gin.Context) {
	p, err := h.svc.GetProperty(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("pid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) UpdateProperty(c *gin.Context) {
	var req UpdatePropertyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.UpdateProperty(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("pid"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) AssignLandlord(c *gin.Context) {
	var body struct {
		UserID string `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.AssignLandlord(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("pid"), body.UserID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) AssignTenant(c *gin.Context) {
	var body struct {
		UserID string `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.AssignTenant(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("pid"), body.UserID)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) SetOccupancyStatus(c *gin.Context) {
	var body struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	p, err := h.svc.SetOccupancyStatus(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("pid"), body.Status)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, p)
}

func (h *Handler) ArchiveProperty(c *gin.Context) {
	if err := h.svc.ArchiveProperty(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("pid")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"archived": true})
}

func (h *Handler) RequestPropertyTransfer(c *gin.Context) {
	var body RequestPropertyTransferBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.RequestPropertyTransfer(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("pid"), body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, r)
}

func (h *Handler) ListTransferRequests(c *gin.Context) {
	rs, err := h.svc.ListTransferRequests(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rs})
}

func (h *Handler) ReviewPropertyTransfer(c *gin.Context) {
	var body struct {
		Decision string `json:"decision" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	r, err := h.svc.ReviewPropertyTransfer(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("reqId"), body.Decision)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, r)
}

func (h *Handler) GetPropertyAnalytics(c *gin.Context) {
	a, err := h.svc.GetPropertyAnalytics(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("pid"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, a)
}

// ── Block 32: Meeting management ──────────────────────────────────────────────

func (h *Handler) CreateMeeting(c *gin.Context) {
	var req CreateMeetingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.CreateMeeting(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, m)
}

func (h *Handler) ListMeetings(c *gin.Context) {
	ms, err := h.svc.ListMeetings(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Query("filter"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ms})
}

func (h *Handler) GetMeeting(c *gin.Context) {
	m, err := h.svc.GetMeeting(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, m)
}

func (h *Handler) RSVPMeeting(c *gin.Context) {
	var body struct {
		Response string `json:"response" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RSVP(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid"), body.Response); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) CheckInMeeting(c *gin.Context) {
	var body struct {
		Method string `json:"method"`
	}
	_ = c.ShouldBindJSON(&body)
	if body.Method == "" {
		body.Method = "manual"
	}
	if err := h.svc.CheckInAttendee(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid"), body.Method); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"checked_in": true})
}

func (h *Handler) StartMeeting(c *gin.Context) {
	if err := h.svc.StartMeeting(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "live"})
}

func (h *Handler) EndMeeting(c *gin.Context) {
	if err := h.svc.EndMeeting(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ended"})
}

func (h *Handler) CancelMeeting(c *gin.Context) {
	if err := h.svc.CancelMeeting(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "cancelled"})
}

func (h *Handler) RescheduleMeeting(c *gin.Context) {
	var req RescheduleMeetingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	m, err := h.svc.RescheduleMeeting(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid"), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, m)
}

func (h *Handler) UploadMinutes(c *gin.Context) {
	var req UploadMinutesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	mm, err := h.svc.UploadMinutes(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, mm)
}

func (h *Handler) GetMinutes(c *gin.Context) {
	mm, err := h.svc.GetMinutes(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, mm)
}

func (h *Handler) ApproveMinutes(c *gin.Context) {
	if err := h.svc.ApproveMinutes(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"approved": true})
}

func (h *Handler) AddMeetingDocument(c *gin.Context) {
	var req AddMeetingDocumentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	d, err := h.svc.AddMeetingDocument(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, d)
}

func (h *Handler) ListMeetingDocuments(c *gin.Context) {
	ds, err := h.svc.ListMeetingDocuments(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("mid"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ds})
}

// ── Block 44: Reports & analytics ─────────────────────────────────────────────

func (h *Handler) GetAnalytics(c *gin.Context) {
	a, err := h.svc.GetAnalytics(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("type"), c.Query("from"), c.Query("to"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, a)
}

// ── Block 45: Settings & account ──────────────────────────────────────────────

func (h *Handler) GetMemberSettings(c *gin.Context) {
	s, err := h.svc.GetMemberSettings(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *Handler) UpdateMemberSettings(c *gin.Context) {
	var req UpdateMemberSettingsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	s, err := h.svc.UpdateMemberSettings(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *Handler) DeleteAccount(c *gin.Context) {
	if err := h.svc.SoftDeleteAccount(c.Request.Context(), c.Param("id"), c.GetString("user_id")); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": true})
}

// ── Block 42: Vendor / contractor app ─────────────────────────────────────────

func (h *Handler) OnboardVendor(c *gin.Context) {
	var req OnboardVendorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	v, err := h.svc.OnboardVendor(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (h *Handler) GetVendorProfile(c *gin.Context) {
	v, err := h.svc.GetVendorProfile(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetVendorEarnings(c *gin.Context) {
	e, err := h.svc.GetVendorEarnings(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, e)
}

func (h *Handler) ListVendorJobs(c *gin.Context) {
	js, err := h.svc.GetAssignedJobs(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": js})
}

func (h *Handler) AssignVendorJob(c *gin.Context) {
	var req AssignJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	j, err := h.svc.AssignJob(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, j)
}

// vendorJobAction wraps the simple lifecycle transitions.
func (h *Handler) vendorJobAction(c *gin.Context, fn func(ctx context.Context, e, u, j string) (*VendorJob, error)) {
	j, err := fn(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("jid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, j)
}

func (h *Handler) AcceptVendorJob(c *gin.Context)   { h.vendorJobAction(c, h.svc.AcceptJob) }
func (h *Handler) RejectVendorJob(c *gin.Context)   { h.vendorJobAction(c, h.svc.RejectJob) }
func (h *Handler) CheckInVendorJob(c *gin.Context)  { h.vendorJobAction(c, h.svc.CheckInAtGate) }
func (h *Handler) StartVendorJob(c *gin.Context)    { h.vendorJobAction(c, h.svc.StartJob) }
func (h *Handler) CompleteVendorJob(c *gin.Context) { h.vendorJobAction(c, h.svc.MarkJobComplete) }

func (h *Handler) SubmitVendorQuote(c *gin.Context) {
	var body struct {
		AmountKobo int64 `json:"amount_kobo"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	j, err := h.svc.SubmitQuote(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("jid"), body.AmountKobo)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, j)
}

func (h *Handler) SubmitVendorInvoice(c *gin.Context) {
	var body struct {
		URL string `json:"url" binding:"required,url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	j, err := h.svc.SubmitInvoice(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("jid"), body.URL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, j)
}

func (h *Handler) SubmitVendorEvidence(c *gin.Context) {
	var body struct {
		URL string `json:"url" binding:"required,url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	j, err := h.svc.UploadCompletionEvidence(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("jid"), body.URL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, j)
}

func (h *Handler) RequestVendorPayout(c *gin.Context) {
	idem := c.GetHeader("Idempotency-Key")
	j, err := h.svc.RequestPayout(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("jid"), idem)
	if err != nil {
		switch err {
		case ErrIdempotencyRequired:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case ErrLedgerUnavailable:
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}
	c.JSON(http.StatusOK, j)
}

// ── Block 41: Admin panel & configuration ─────────────────────────────────────

func (h *Handler) GetAdminDashboard(c *gin.Context) {
	d, err := h.svc.GetAdminDashboard(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, d)
}

func (h *Handler) AdminListResidents(c *gin.Context) {
	rs, err := h.svc.ListResidents(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Query("role"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rs})
}

func (h *Handler) BanResident(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	if err := h.svc.BanResident(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("uid"), body.Reason); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"banned": true})
}

func (h *Handler) RestoreResident(c *gin.Context) {
	if err := h.svc.RestoreResident(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("uid")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"restored": true})
}

func (h *Handler) GetEstateConfig(c *gin.Context) {
	cfg, err := h.svc.GetEstateConfig(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

func (h *Handler) SetEstateRules(c *gin.Context) {
	body, _ := c.GetRawData()
	cfg, err := h.svc.SetEstateRules(c.Request.Context(), c.Param("id"), c.GetString("user_id"), body)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

func (h *Handler) ConfigureSubscriptionPlan(c *gin.Context) {
	body, _ := c.GetRawData()
	cfg, err := h.svc.ConfigureSubscriptionPlan(c.Request.Context(), c.Param("id"), c.GetString("user_id"), body)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, cfg)
}

func (h *Handler) GetAuditLog(c *gin.Context) {
	limit := atoiDefault(c.Query("limit"), 50)
	offset := atoiDefault(c.Query("offset"), 0)
	entries, err := h.svc.GetAuditLog(c.Request.Context(), c.Param("id"), c.GetString("user_id"), limit, offset)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries})
}

// ── Block 33: AI note-taking ──────────────────────────────────────────────────

func (h *Handler) GenerateAINotes(c *gin.Context) {
	var req GenerateAINotesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// The mid path param is the meeting; honour it if the body omits it.
	if req.MeetingID == "" {
		req.MeetingID = c.Param("mid")
	}
	n, err := h.svc.GenerateAINotes(c.Request.Context(), c.Param("id"), c.GetString("user_id"), req)
	if err != nil {
		code := http.StatusBadRequest
		if err.Error() == "estate: AI note-taking is not configured" {
			code = http.StatusServiceUnavailable
		}
		c.JSON(code, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, n)
}

func (h *Handler) ListAINotes(c *gin.Context) {
	ns, err := h.svc.ListAINotes(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Query("meeting_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": ns})
}

func (h *Handler) GetAINote(c *gin.Context) {
	n, err := h.svc.GetAINote(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("sid"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, n)
}

func (h *Handler) ApproveAINote(c *gin.Context) {
	if err := h.svc.ApproveAINote(c.Request.Context(), c.Param("id"), c.GetString("user_id"), c.Param("sid")); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"approved": true})
}

// ── Block 47: Maintenance (admin-triggered) ───────────────────────────────────

func (h *Handler) RunMaintenance(c *gin.Context) {
	res, err := h.svc.RunEstateMaintenance(c.Request.Context(), c.Param("id"), c.GetString("user_id"))
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": res})
}
