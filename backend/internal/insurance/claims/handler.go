package claims

import (
	"errors"
	"github.com/gin-gonic/gin"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"strconv"
	"time"
)

const keyData = "data"

// Handler exposes member + admin claim routes.
type Handler struct {
	svc *Service
}

// NewHandler constructs the claims handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// mapErr maps service sentinel errors to HTTP responses.
func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrPolicyNotActive):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "policy_not_active"})
	case errors.Is(err, ErrNotBound):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "policy_not_bound"})
	case errors.Is(err, ErrBadState):
		c.JSON(http.StatusConflict, gin.H{"error": httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// SubmitFNOL (member): POST /claims — Idempotency-Key header REQUIRED.
// body: {policy_id, loss_event_at, claimed_amount_kobo, description, inputs}
func (h *Handler) SubmitFNOL(c *gin.Context) {
	uid, ok := ginutil.RequireUser(c)
	if !ok {
		return
	}
	idemKey := ginutil.IdempotencyKey(c)
	if idemKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idempotency-Key header required"})
		return
	}
	var body struct {
		PolicyID          string         `json:"policy_id" binding:"required"`
		LossEventAt       time.Time      `json:"loss_event_at"`
		ClaimedAmountKobo int64          `json:"claimed_amount_kobo"`
		Description       string         `json:"description"`
		Inputs            map[string]any `json:"inputs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if body.LossEventAt.IsZero() {
		body.LossEventAt = time.Now().UTC()
	}
	cl, err := h.svc.SubmitFNOL(c.Request.Context(), uid, FNOLInput{
		PolicyID:          body.PolicyID,
		LossEventAt:       body.LossEventAt,
		ClaimedAmountKobo: body.ClaimedAmountKobo,
		Description:       body.Description,
		Inputs:            body.Inputs,
	}, idemKey)
	if err != nil {
		// A claim row may still be returned (DRAFT) when only the provider hand-off
		// failed — surface it so the client can retry.
		if cl != nil {
			c.JSON(http.StatusAccepted, gin.H{"warning": httperr.Msg(c, http.StatusAccepted, err), keyData: cl})
			return
		}
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{keyData: cl})
}

// List (member): GET /claims
func (h *Handler) List(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	cs, err := h.svc.ListClaims(c.Request.Context(), ginutil.UserID(c), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: cs})
}

// Get (member): GET /claims/:id
func (h *Handler) Get(c *gin.Context) {
	cl, err := h.svc.GetClaim(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: cl})
}

// AddEvidence (member): POST /claims/:id/evidence
// body: {file_name, content_type, storage_ref}
func (h *Handler) AddEvidence(c *gin.Context) {
	var body struct {
		FileName    string `json:"file_name" binding:"required"`
		ContentType string `json:"content_type"`
		StorageRef  string `json:"storage_ref"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ev, err := h.svc.UploadEvidence(c.Request.Context(), ginutil.UserID(c), c.Param("id"), body.FileName, body.ContentType, body.StorageRef)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{keyData: ev})
}

// ListEvidence (member): GET /claims/:id/evidence
func (h *Handler) ListEvidence(c *gin.Context) {
	evs, err := h.svc.ListEvidence(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: evs})
}

// AdminSearch (admin): GET /claims?state=&policy_id=
func (h *Handler) AdminSearch(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	cs, err := h.svc.SearchAdmin(c.Request.Context(), c.Query("state"), c.Query("policy_id"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: cs})
}

// AdminGet (admin): GET /claims/:id
func (h *Handler) AdminGet(c *gin.Context) {
	cl, err := h.svc.AdminGet(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: cl})
}

// AdminDecision (admin): POST /claims/:id/decision
// body: {decision: assess|needs_info|resume|approve|reject|settle, approved_amount_kobo, reason}
func (h *Handler) AdminDecision(c *gin.Context) {
	var body struct {
		Decision           string `json:"decision" binding:"required"`
		ApprovedAmountKobo int64  `json:"approved_amount_kobo"`
		Reason             string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ctx := c.Request.Context()
	id := c.Param("id")
	var (
		cl  *Claim
		err error
	)
	switch body.Decision {
	case "assess":
		cl, err = h.svc.MoveToAssessment(ctx, id)
	case "needs_info":
		cl, err = h.svc.RequestMoreInfo(ctx, id)
	case "resume":
		cl, err = h.svc.ResumeAssessment(ctx, id)
	case "approve":
		cl, err = h.svc.Approve(ctx, id, body.ApprovedAmountKobo)
	case "reject":
		cl, err = h.svc.Reject(ctx, id, body.Reason)
	case "settle":
		cl, err = h.svc.Settle(ctx, id)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown decision"})
		return
	}
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: cl})
}

// Register wires the member + admin claim routes. The aggregator
// (insurance_claims_routes.go) constructs the handler and the per-route RBAC
// guards; this keeps the package self-describing about its own surface.
//   - member (object-level authZ; claimant owns claim):
//     POST   /claims                  (FNOL — Idempotency-Key REQUIRED)
//     GET    /claims
//     GET    /claims/:id
//     POST   /claims/:id/evidence
//     GET    /claims/:id/evidence
//   - admin (per-route RBAC insurance.claim.*):
//     GET    /claims/:id              (insurance.claim.view)
//     POST   /claims/:id/decision     (insurance.claim.manage)
func Register(member *gin.RouterGroup, admin *gin.RouterGroup, h *Handler, guard func(permission string) gin.HandlerFunc) {
	// Member routes.
	mc := member.Group("/claims")
	mc.POST("", h.SubmitFNOL)
	mc.GET("", h.List)
	mc.GET("/:id", h.Get)
	mc.POST("/:id/evidence", h.AddEvidence)
	mc.GET("/:id/evidence", h.ListEvidence)

	// Admin routes (claim search + decisioning).
	ac := admin.Group("/claims")
	ac.GET("", guard("insurance.claim.view"), h.AdminSearch)
	ac.GET("/:id", guard("insurance.claim.view"), h.AdminGet)
	ac.POST("/:id/decision", guard("insurance.claim.manage"), h.AdminDecision)
}
