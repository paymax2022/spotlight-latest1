package onboarding

import (
	"errors"
	"log"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/integrations"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Handler exposes the onboarding API over Gin.
type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusForbidden, ErrForbidden),
	httperr.R(http.StatusConflict, ErrDuplicate, ErrConflict, ErrModuleClosed),
	httperr.R(http.StatusBadRequest, ErrMissingIdemKey),
	httperr.R(http.StatusUnprocessableEntity, ErrValidation),
)

func (h *Handler) fail(c *gin.Context, err error) {
	if ve, ok := errors.AsType[*ValidationError](err); ok {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "validation failed", "fields": ve.Fields})
		return
	}
	code := errMap.Code(err)
	body := gin.H{"error": httperr.Msg(c, code, err)}
	switch {
	case errors.Is(err, ErrNotFound):
		body["error"] = "not found"
	case errors.Is(err, ErrForbidden):
		body["error"] = "forbidden"
	case errors.Is(err, ErrDuplicate):
		body["error"] = "an active application or profile already exists for this merchant type"
	}
	c.JSON(code, body)
}

// authUserID resolves the authenticated user's id from the auth context. It reads the
// AuthenticatedUser that RequireAuthContext stores BEFORE it calls c.Next() — not a
// "user_id" string set afterwards, which would be too late (the handler runs during
// base's c.Next(), before any post-base mirror could execute).
func authUserID(c *gin.Context) string {
	if au, ok := middleware.GetAuthenticatedUser(c); ok {
		return au.ID
	}
	return ""
}

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

func (h *Handler) CreateApplication(c *gin.Context) {
	var req CreateApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	app, err := h.svc.CreateApplication(c.Request.Context(), ginutil.UserID(c, authUserID), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": app})
}

func (h *Handler) SaveDraft(c *gin.Context) {
	var req SaveDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	app, err := h.svc.SaveDraft(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) Submit(c *gin.Context) {
	idemKey := ginutil.IdempotencyKey(c)
	app, err := h.svc.Submit(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), idemKey)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) Resubmit(c *gin.Context) {
	app, err := h.svc.Resubmit(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) GetApplication(c *gin.Context) {
	app, err := h.svc.GetApplication(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), false)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

// Capabilities aggregates the caller's customer + merchant identities.
func (h *Handler) Capabilities(c *gin.Context) {
	displayName := ""
	if au, ok := middleware.GetAuthenticatedUser(c); ok {
		displayName = au.Email
	}
	kycTier, _ := strconv.Atoi(c.GetString("kyc_tier"))
	caps, err := h.svc.Capabilities(c.Request.Context(), ginutil.UserID(c, authUserID), displayName, kycTier)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": caps})
}

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
	app, err := h.svc.GetApplication(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), true)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) Approve(c *gin.Context) {
	app, err := h.svc.Approve(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"))
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
	app, err := h.svc.Reject(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), req.Reason)
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
	app, err := h.svc.RequestInfo(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), req.Checklist)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) Escalate(c *gin.Context) {
	var req EscalateRequest
	_ = c.ShouldBindJSON(&req)
	app, err := h.svc.Escalate(c.Request.Context(), ginutil.UserID(c, authUserID), c.Param("id"), req.Note)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": app})
}

func (h *Handler) CreateModule(c *gin.Context) {
	var req CreateModuleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	fs, err := h.svc.CreateFormSchemaVersion(c.Request.Context(), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": fs})
}

// Deps carries the collaborators needed to wire onboarding routes.
type Deps struct {
	DB       *pgxpool.Pool
	Supabase *integrations.SupabaseRestClient
	RBAC     services.RBACService
	Enabled  bool // feature flag
}

// ReviewPermission is the RBAC slug required to reach reviewer/admin endpoints.
const ReviewPermission = "onboarding.review"

// ConfigurePermission gates catalogue configuration endpoints.
const ConfigurePermission = "onboarding.configure"

// Register mounts all onboarding routes under /api/v1 on the given engine.
// Customer routes require an authenticated session; admin routes additionally
// require the onboarding.review / onboarding.configure RBAC permission.
// Returns the constructed *Service so callers can inject optional collaborators
// (e.g. SetBusinessGate). Returns nil when the module routes are skipped
// (flag off / no DB).
//
// EXCEPTION: GET /api/v1/me/capabilities mounts whenever a DB pool exists,
// even with the flag off. It is a READ of the caller's own profiles and
// applications — the app shell's capability map depends on it — so gating it
// on FEATURE_ONBOARDING_ENABLED turned "module closed" into a 404 that broke
// the shell instead of an empty capability list. The flag still gates every
// mutation, the catalogue, and the admin surface below.
func Register(r *gin.Engine, d Deps) *Service {
	if d.DB == nil {
		log.Println("[onboarding] no database pool — skipping routes")
		return nil
	}

	svc := NewService(d.DB)
	h := NewHandler(svc)

	// authn validates the bearer token and stores the AuthenticatedUser on the gin
	// context. Handlers read it via middleware.GetAuthenticatedUser (see userID()).
	// NOTE: RequireAuthContext calls c.Next() itself once auth succeeds, so any work
	// wrapped *after* base(c) would run only AFTER the downstream handler has already
	// executed — too late to mirror user_id into the context. Hence handlers source
	// the user directly from the auth context instead of a mirrored string key.
	authn := func() gin.HandlerFunc {
		return middleware.RequireAuthContext(d.Supabase, d.RBAC)
	}

	v1 := r.Group("/api/v1")

	// /me/capabilities — always mounted (see Register doc).
	me := v1.Group("/me")
	me.Use(authn())
	me.GET("/capabilities", h.Capabilities)

	if !d.Enabled {
		log.Println("[onboarding] FEATURE_ONBOARDING_ENABLED is false — /me/capabilities mounted; module routes skipped")
		return nil
	}

	ob := v1.Group("/onboarding")
	ob.Use(authn())
	{
		ob.GET("/modules", h.ListModules)
		ob.GET("/modules/:id/merchant-types", h.ListMerchantTypes)
		ob.GET("/merchant-types/:id", h.GetMerchantType)
		ob.GET("/form-schemas/:id", h.GetFormSchema)

		ob.POST("/applications", h.CreateApplication)
		ob.PATCH("/applications/:id", h.SaveDraft)
		ob.POST("/applications/:id/submit", h.Submit)
		ob.POST("/applications/:id/resubmit", h.Resubmit)
		ob.GET("/applications/:id", h.GetApplication)
	}

	// Admin routes use the engine-level /api/admin convention (matches the
	// shipped rbacAdmin group + the admin frontend's adminApiBase), NOT /api/v1/admin.
	admin := r.Group("/api/admin/onboarding")
	admin.Use(authn())
	{
		review := admin.Group("")
		review.Use(middleware.RequirePermission(d.RBAC, ReviewPermission))
		review.GET("/review-queue", h.ReviewQueue)
		review.GET("/applications/:id", h.AdminGetApplication)
		review.POST("/applications/:id/approve", h.Approve)
		review.POST("/applications/:id/reject", h.Reject)
		review.POST("/applications/:id/request-info", h.RequestInfo)
		review.POST("/applications/:id/escalate", h.Escalate)

		cfg := admin.Group("")
		cfg.Use(middleware.RequirePermission(d.RBAC, ConfigurePermission))
		cfg.POST("/modules", h.CreateModule)
		cfg.POST("/merchant-types", h.CreateMerchantType)
		cfg.POST("/merchant-types/:id/form-schemas", h.CreateFormSchema)
	}

	log.Println("[onboarding] routes registered under /api/v1/onboarding, /api/v1/me, /api/admin/onboarding")
	return svc
}
