package estate

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type Handler struct{ svc *Service }

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
