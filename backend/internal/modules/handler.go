package modules

import (
	"errors"
	"net/http"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Visibility answers "what may I show?" for the environment this process serves.
// GET /api/v1/modules/visibility
// It returns keys only, scoped to this tier — never the full registry. A client
// has no business knowing that a module exists but is unpublished, and leaking
// that from a production deployment would advertise unreleased work.
// `modules` keeps its original meaning — fully live and tappable — and coming-soon
// keys are reported SEPARATELY rather than folded in. That choice is about how older
// app builds degrade: a build that does not know the field ignores it and simply does
// not render those tiles, which is the safe direction. Folding them into `modules`
// would make an old build show a teaser as fully functional and drop the user into a
// half-built screen.
func (h *Handler) Visibility(c *gin.Context) {
	ctx := c.Request.Context()
	keys, err := h.svc.VisibleKeys(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load module visibility"})
		return
	}
	soon, err := h.svc.ComingSoonKeys(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load module visibility"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"environment": h.svc.Env(),
		"modules":     keys,
		"comingSoon":  soon,
	}})
}

// List returns the whole registry with every environment's state.
// GET /api/v1/admin/modules
func (h *Handler) List(c *gin.Context) {
	mods, err := h.svc.List(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"environment": h.svc.Env(),
		"modules":     mods,
	}})
}

type setVisibilityRequest struct {
	Environment string `json:"environment" binding:"required"`
	Status      string `json:"status" binding:"required"`
	Note        string `json:"note"`
}

// SetVisibility publishes or hides a module in one environment.
// PATCH /api/v1/admin/modules/:key/visibility
func (h *Handler) SetVisibility(c *gin.Context) {
	var req setVisibilityRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	status, err := ParseStatus(req.Status)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	m, err := h.svc.SetVisibility(c.Request.Context(), c.Param("key"),
		Environment(req.Environment), status, req.Note, ginutil.UserID(c))
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

type setLifecycleRequest struct {
	Lifecycle string `json:"lifecycle" binding:"required"`
	Note      string `json:"note"`
}

// SetLifecycle archives or restores a module.
// PATCH /api/v1/admin/modules/:key/lifecycle
func (h *Handler) SetLifecycle(c *gin.Context) {
	var req setLifecycleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	lc, err := ParseLifecycle(req.Lifecycle)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	m, err := h.svc.SetLifecycle(c.Request.Context(), c.Param("key"), lc, req.Note, ginutil.UserID(c))
	if err != nil {
		h.writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": m})
}

// History returns the audit trail for one module.
// GET /api/v1/admin/modules/:key/history
func (h *Handler) History(c *gin.Context) {
	entries, err := h.svc.History(c.Request.Context(), c.Param("key"), 50)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": entries})
}

// writeErr maps domain errors to status codes. A bad request must not read as a
// server fault: the console shows the operator the actual reason.
func (h *Handler) writeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrModuleNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": httperr.Msg(c, http.StatusNotFound, err)})
	case errors.Is(err, ErrInvalidEnv), errors.Is(err, ErrInvalidStatus), errors.Is(err, ErrInvalidLifecycle):
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
	case errors.Is(err, ErrArchivedModule):
		// 409: the request is well-formed, it conflicts with the module's state.
		c.JSON(http.StatusConflict, gin.H{"error": httperr.Msg(c, http.StatusConflict, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

// MyAccess returns what the CALLING user may use in this environment.
// Distinct from Visibility, which is the unauthenticated environment-level list. This
// one is user-scoped, so it must be authenticated and must never accept a user id from
// the client — the id comes from the validated token only.
func (h *Handler) MyAccess(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not authenticated"})
		return
	}
	acc, err := h.svc.AccessFor(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not load module access"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": acc})
}

// ListUserGrants shows a user's grant history (revoked and expired included, so the
// console can answer "who had access when").
// GET /api/v1/admin/modules/users/:userId/grants
func (h *Handler) ListUserGrants(c *gin.Context) {
	rows, err := h.svc.ListGrants(c.Request.Context(), c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"grants": rows}})
}

// GrantUserModule opens a restricted module for one user.
// POST /api/v1/admin/modules/users/:userId/grants  {"module_key":"...","note":"...","expires_at":"..."}
// NOTE FOR REVIEWERS: this grants MODULE ACCESS ONLY. It does not raise the user's KYC
// tier and is never read by the money path — a granted Tier 0 user can open the module
// and still cannot transact. Keeping it that way is what makes this safe to delegate to
// support staff.
func (h *Handler) GrantUserModule(c *gin.Context) {
	var body struct {
		ModuleKey string     `json:"module_key" binding:"required"`
		Note      string     `json:"note"`
		ExpiresAt *time.Time `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	if body.ExpiresAt != nil && !body.ExpiresAt.After(time.Now()) {
		// An expiry in the past would create a grant that is dead on arrival and read
		// as "granted" in the console. Reject it rather than store a lie.
		c.JSON(http.StatusBadRequest, gin.H{"error": "expires_at must be in the future"})
		return
	}
	if err := h.svc.Grant(c.Request.Context(), c.Param("userId"), body.ModuleKey,
		ginutil.UserID(c), body.Note, body.ExpiresAt); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"granted": body.ModuleKey}})
}

// RevokeUserModule closes a grant (soft, so the trail survives).
// DELETE /api/v1/admin/modules/users/:userId/grants/:moduleKey
func (h *Handler) RevokeUserModule(c *gin.Context) {
	if err := h.svc.Revoke(c.Request.Context(), c.Param("userId"), c.Param("moduleKey")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"revoked": c.Param("moduleKey")}})
}

// Register mounts the module registry.
//
//	public: GET /api/v1/modules/visibility        — UNAUTHENTICATED
//	admin:  GET/PATCH /api/v1/admin/modules/...   — platform.modules.{read,manage}
//
// `admin` is a route group the caller has already put behind authentication.
func Register(public, admin *gin.RouterGroup, db *pgxpool.Pool, rbac services.RBACService, env Environment, flag FlagLookup) {
	h := NewHandler(NewService(db, env, flag))

	// Deliberately UNAUTHENTICATED. The response is the set of modules already
	// visible in this tier's UI — the same information anyone gets by opening the
	// app — so it is not a disclosure. It never includes unpublished modules, and
	// never another tier's state.
	// Requiring auth here broke the callers rather than protecting anything: the
	// web helper fetches server-to-server with no user token, so it always got 401,
	// fell back to "unknown" and rendered everything; and a logged-out mobile user
	// got the same. A gate that silently fails open for its main callers is worse
	// than no gate, because it looks like it is working.
	public.GET("/modules/visibility", h.Visibility)

	// Reading the registry exposes unreleased work, so it is permissioned too —
	// not just the writes.
	mods := admin.Group("/modules")
	mods.GET("", middleware.RequirePermission(rbac, "platform.modules.read"), h.List)
	mods.GET("/:key/history", middleware.RequirePermission(rbac, "platform.modules.read"), h.History)

	// Per-user grants. Same permission as the rest of the registry: deciding who may
	// use an unreleased module is the same class of act as publishing it.
	// These control MODULE ACCESS ONLY — never money. A granted Tier 0 user can open
	// the module and still cannot transact, because finance/tiers remains the sole
	// authority on wallet debits and never reads these rows.
	mods.GET("/users/:userId/grants", middleware.RequirePermission(rbac, "platform.modules.read"), h.ListUserGrants)
	mods.POST("/users/:userId/grants", middleware.RequirePermission(rbac, "platform.modules.manage"), h.GrantUserModule)
	mods.DELETE("/users/:userId/grants/:moduleKey", middleware.RequirePermission(rbac, "platform.modules.manage"), h.RevokeUserModule)

	// Writes change what every user of an environment sees.
	mods.PATCH("/:key/visibility", middleware.RequirePermission(rbac, "platform.modules.manage"), h.SetVisibility)
	mods.PATCH("/:key/lifecycle", middleware.RequirePermission(rbac, "platform.modules.manage"), h.SetLifecycle)
}
