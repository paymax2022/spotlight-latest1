package onboarding

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Handler exposes the onboarding API over Gin.
type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// ─── error mapping ───────────────────────────────────────────────────────────

func (h *Handler) fail(c *gin.Context, err error) {
	var ve *ValidationError
	if errors.As(err, &ve) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "validation failed", "fields": ve.Fields})
		return
	}
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	case errors.Is(err, ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, ErrDuplicate):
		c.JSON(http.StatusConflict, gin.H{"error": "an active application or profile already exists for this merchant type"})
	case errors.Is(err, ErrConflict), errors.Is(err, ErrModuleClosed):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, ErrMissingIdemKey):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrValidation):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func userID(c *gin.Context) string { return c.GetString("user_id") }

// ─── Public / customer catalogue ─────────────────────────────────────────────

func (h *Handler) ListModules(c *gin.Context) {
	mods, err := h.svc.ListOpenModules(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	if mods == nil {
		mods = []Module{}
	}
	c.JSON(http.StatusOK, gin.H{"data": mods})
}

func (h *Handler) ListMerchantTypes(c *gin.Context) {
	types, err := h.svc.ListMerchantTypes(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	if types == nil {
		types = []MerchantType{}
	}
	c.JSON(http.StatusOK, gin.H{"data": types})
}

func (h *Handler) GetMerchantType(c *gin.Context) {
	mt, err := h.svc.GetMerchantType(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": mt})
}

func (h *Handler) GetFormSchema(c *gin.Context) {
	fs, err := h.svc.GetFormSchema(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": fs})
}

// ─── Applications ────────────────────────────────────────────────────────────

func (h *Handler) CreateApplication(c *gin.Context) {
	var req CreateApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	app, err := h.svc.CreateApplication(c.Request.Context(), userID(c), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": app})
}

func (h *Handler) SaveDraft(c *gin.Context) {
	var req SaveDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	app, err := h.svc.SaveDraft(c.Request.Context(), userID(c), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) Submit(c *gin.Context) {
	idemKey := c.GetHeader("Idempotency-Key")
	app, err := h.svc.Submit(c.Request.Context(), userID(c), c.Param("id"), idemKey)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) Resubmit(c *gin.Context) {
	app, err := h.svc.Resubmit(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) GetApplication(c *gin.Context) {
	app, err := h.svc.GetApplication(c.Request.Context(), userID(c), c.Param("id"), false)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

// Capabilities aggregates the caller's customer + merchant identities.
func (h *Handler) Capabilities(c *gin.Context) {
	displayName := c.GetString("display_name")
	kycTier, _ := strconv.Atoi(c.GetString("kyc_tier"))
	caps, err := h.svc.Capabilities(c.Request.Context(), userID(c), displayName, kycTier)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": caps})
}

// ─── Admin review ────────────────────────────────────────────────────────────

func (h *Handler) ReviewQueue(c *gin.Context) {
	age, _ := strconv.Atoi(c.Query("age"))
	apps, err := h.svc.ReviewQueue(c.Request.Context(),
		c.Query("module"), c.Query("type"), c.Query("status"), age)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": apps})
}

func (h *Handler) AdminGetApplication(c *gin.Context) {
	app, err := h.svc.GetApplication(c.Request.Context(), userID(c), c.Param("id"), true)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) Approve(c *gin.Context) {
	app, err := h.svc.Approve(c.Request.Context(), userID(c), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) Reject(c *gin.Context) {
	var req RejectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "reason is required"})
		return
	}
	app, err := h.svc.Reject(c.Request.Context(), userID(c), c.Param("id"), req.Reason)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) RequestInfo(c *gin.Context) {
	var req RequestInfoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "checklist is required"})
		return
	}
	app, err := h.svc.RequestInfo(c.Request.Context(), userID(c), c.Param("id"), req.Checklist)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) Escalate(c *gin.Context) {
	var req EscalateRequest
	_ = c.ShouldBindJSON(&req)
	app, err := h.svc.Escalate(c.Request.Context(), userID(c), c.Param("id"), req.Note)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

// ─── Admin config ────────────────────────────────────────────────────────────

func (h *Handler) CreateModule(c *gin.Context) {
	var req CreateModuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.CreateModule(c.Request.Context(), req); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"id": req.ID}})
}

func (h *Handler) CreateMerchantType(c *gin.Context) {
	var req CreateMerchantTypeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.CreateMerchantType(c.Request.Context(), req); err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"id": req.ID}})
}

func (h *Handler) CreateFormSchema(c *gin.Context) {
	var req CreateFormSchemaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	fs, err := h.svc.CreateFormSchemaVersion(c.Request.Context(), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": fs})
}
