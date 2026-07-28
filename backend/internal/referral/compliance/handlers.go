package compliance

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes member + admin compliance endpoints.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register wires compliance routes.
//   - member: /api/finance/referral/compliance/{disclosures/:slug,consents}
//   - admin : /api/referral/admin/compliance/*  (RBAC referral.compliance.*)
func Register(member, admin *gin.RouterGroup, svc *Service, rbac services.RBACService) {
	h := NewHandler(svc)

	mg := member.Group("/compliance")
	mg.GET("/disclosures/:slug", h.ActiveDisclosure) // active T&Cs for a slug
	mg.GET("/consents", h.MyConsents)                // my NDPC consents
	mg.POST("/consents", h.RecordConsent)            // capture a consent

	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }
	ag := admin.Group("/compliance")
	// disclosures / T&Cs versioning
	ag.GET("/disclosures", guard("referral.compliance.view"), h.ListDisclosures)
	ag.POST("/disclosures", guard("referral.compliance.manage"), h.PublishDisclosure)
	// AML monitoring
	ag.GET("/aml", guard("referral.compliance.view"), h.ListAML)
	ag.POST("/aml", guard("referral.compliance.manage"), h.RaiseAML)
	ag.POST("/aml/:id/status", guard("referral.compliance.manage"), h.SetAMLStatus)
	// consent / data management
	ag.GET("/users/:id/consents", guard("referral.compliance.view"), h.UserConsents)
	// structural policy
	ag.GET("/policy", guard("referral.compliance.view"), h.GetPolicy)
	ag.PUT("/policy", guard("referral.compliance.manage"), h.UpdatePolicy)
	// earnings-claim review
	ag.GET("/claims", guard("referral.compliance.view"), h.ClaimReview)
	// regulatory reporting export
	ag.GET("/regulatory-export", guard("referral.compliance.view"), h.RegulatoryExport)
}

func uid(c *gin.Context) string {
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return c.GetString("user_id")
}

// --- member ---

func (h *Handler) ActiveDisclosure(c *gin.Context) {
	d, err := h.svc.ActiveDisclosure(c.Request.Context(), c.Param("slug"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if d == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no active disclosure"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"disclosure": d})
}

func (h *Handler) MyConsents(c *gin.Context) {
	id := uid(c)
	if id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	list, err := h.svc.MyConsents(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"consents": list})
}

func (h *Handler) RecordConsent(c *gin.Context) {
	id := uid(c)
	if id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	var in ConsentInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	cons, err := h.svc.RecordConsent(c.Request.Context(), id, in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"consent": cons})
}

// --- admin: disclosures ---

func (h *Handler) ListDisclosures(c *gin.Context) {
	list, err := h.svc.ListDisclosures(c.Request.Context(), c.Query("slug"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"disclosures": list})
}

func (h *Handler) PublishDisclosure(c *gin.Context) {
	var in DisclosureInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	d, err := h.svc.PublishDisclosure(c.Request.Context(), in, uid(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"disclosure": d})
}

// --- admin: AML ---

func (h *Handler) ListAML(c *gin.Context) {
	list, err := h.svc.ListAML(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"flags": list})
}

func (h *Handler) RaiseAML(c *gin.Context) {
	var in AMLFlagInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	f, err := h.svc.RaiseAML(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"flag": f})
}

func (h *Handler) SetAMLStatus(c *gin.Context) {
	var body struct {
		Status      string `json:"status"`
		ReportedRef string `json:"reported_ref"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if err := h.svc.SetAMLStatus(c.Request.Context(), c.Param("id"), body.Status, body.ReportedRef); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// --- admin: consent / data management ---

func (h *Handler) UserConsents(c *gin.Context) {
	list, err := h.svc.UserConsents(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"consents": list})
}

// --- admin: policy ---

func (h *Handler) GetPolicy(c *gin.Context) {
	p, err := h.svc.GetPolicy(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"policy": p})
}

func (h *Handler) UpdatePolicy(c *gin.Context) {
	var in PolicyInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	p, err := h.svc.UpdatePolicy(c.Request.Context(), in, uid(c))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"policy": p})
}

// --- admin: earnings-claim review ---

func (h *Handler) ClaimReview(c *gin.Context) {
	list, err := h.svc.ClaimReview(c.Request.Context(), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"claims": list})
}

// --- admin: regulatory export ---

func (h *Handler) RegulatoryExport(c *gin.Context) {
	rows, err := h.svc.RegulatoryExport(c.Request.Context(), c.Query("since"), c.Query("until"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"rows": rows})
}
