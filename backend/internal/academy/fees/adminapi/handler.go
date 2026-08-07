package feesadminapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	feesschool "spotlight/backend/internal/academy/fees/school"
	feessession "spotlight/backend/internal/academy/fees/session"
	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler serves the flat admin oversight surface at /api/academy/admin/fees/*. It is
// read-heavy: list/aggregate GETs plus a handful of config writes that have real backing
// tables (create/issue fee schedule, set gov-export opt-in, and the setup-wizard
// school/session/class creates which REUSE the feesschool / feessession domain services).
// Every route is RBAC-gated at registration time with the seeded academy.fees.* slugs.
// No money path lives here.
type Handler struct {
	repo       *Repository
	schoolSvc  *feesschool.Service  // setup-wizard school create (reused; owns audit + tier machine)
	sessionSvc *feessession.Service // setup-wizard session/class create (reused; owns audit)
}

// NewHandler builds the admin oversight handler.
func NewHandler(repo *Repository) *Handler { return &Handler{repo: repo} }

// actorID resolves the authenticated admin (RequireAuthContext sets user_id).
func actorID(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) fail(c *gin.Context, err error) {
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
}

// RegisterFeesAdminAPI mounts the flat admin oversight surface under the passed admin
// group (adminAcad = /api/academy/admin ⇒ these live at /api/academy/admin/fees/*).
// Each route carries its own RequirePermission gate with a seeded academy.fees.* slug.
// nil pool / group are skipped.
func RegisterFeesAdminAPI(admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil || admin == nil {
		return nil
	}
	h := NewHandler(NewRepository(pool))
	// Reuse the domain services for the setup-wizard creates — they own the guarded state
	// machines + immutable audit (academy_commerce_audit), so no parallel insert logic here.
	h.schoolSvc = feesschool.NewService(pool)
	h.sessionSvc = feessession.NewService(pool)
	g := admin.Group("/fees")

	guard := func(perm string) gin.HandlerFunc { return middleware.RequirePermission(rbac, perm) }

	// SC-29 setup wizard (school → session → class → fee schedule). academy.fees.setup,
	// except the schools directory which is also reachable with school.verify.
	g.GET("/schools", guard("academy.fees.setup"), h.ListSchools)
	g.POST("/schools", guard("academy.fees.setup"), h.CreateSchool) // create school (reuses feesschool.Service)
	g.GET("/schools/:schoolId/sessions", guard("academy.fees.setup"), h.ListSessionsForSchool)
	g.GET("/schools/:schoolId/classes", guard("academy.fees.setup"), h.ListClassesForSchool)
	// Paths below match the console service's TODO(no backend route) calls verbatim so
	// those branches can be switched live unchanged.
	g.GET("/sessions", guard("academy.fees.setup"), h.ListSessions)                 // ?school_id=
	g.POST("/sessions", guard("academy.fees.setup"), h.CreateSession)               // create session (reuses feessession.Service)
	g.GET("/classes", guard("academy.fees.setup"), h.ListClasses)                   // ?session_id=
	g.POST("/classes", guard("academy.fees.setup"), h.CreateClass)                  // create class (reuses feessession.Service)
	g.GET("/schedules", guard("academy.fees.setup"), h.ListFeeSchedules)            // ?class_id=
	g.POST("/schedules", guard("academy.fees.setup"), h.CreateFeeSchedule)          // create draft
	g.POST("/schedules/:id/issue", guard("academy.fees.setup"), h.IssueFeeSchedule) // SF-1 lock/issue

	// SC-33 collections. academy.fees.collections.
	g.GET("/collections/overview", guard("academy.fees.collections"), h.Collections) // ?school_id=
	g.GET("/invoices", guard("academy.fees.collections"), h.ListInvoices)            // ?school_id=&status=

	// SC-35/36 promotions LIST (approve/apply already exist per-school). academy.fees.promotion.approve.
	g.GET("/promotions", guard("academy.fees.promotion.approve"), h.ListPromotions) // ?school_id=

	// SC-37 competitions. academy.fees.competition.manage.
	g.GET("/competitions", guard("academy.fees.competition.manage"), h.ListCompetitions)
	g.GET("/competitions/registrations", guard("academy.fees.competition.manage"), h.ListCompetitionRegistrations) // ?competition_id=

	// SC-38 government export opt-ins. academy.fees.export.run.
	g.GET("/gov-export/opt-ins", guard("academy.fees.export.run"), h.ListGovOptIns) // ?school_id=
	g.PATCH("/gov-export/opt-ins", guard("academy.fees.export.run"), h.SetGovOptIn)

	// SC-40 staff role grants (cross-school list). academy.fees.roles.assign.
	g.GET("/roles", guard("academy.fees.roles.assign"), h.ListRoleGrants)

	return h
}

// ── Handlers ────────────────────────────────────────────────────────────────────

func (h *Handler) ListSchools(c *gin.Context) {
	out, err := h.repo.ListSchools(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListSessions(c *gin.Context) {
	out, err := h.repo.ListSessions(c.Request.Context(), c.Query("school_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListSessionsForSchool(c *gin.Context) {
	out, err := h.repo.ListSessions(c.Request.Context(), c.Param("schoolId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListClasses(c *gin.Context) {
	// The console filters classes by session; academy_fee_classes carries session_id but
	// the flat list is school-scoped, so we accept either school_id or session_id.
	schoolID := c.Query("school_id")
	out, err := h.repo.ListClasses(c.Request.Context(), schoolID)
	if err != nil {
		h.fail(c, err)
		return
	}
	if sid := c.Query("session_id"); sid != "" {
		filtered := out[:0]
		for _, cl := range out {
			if cl.SessionID == sid {
				filtered = append(filtered, cl)
			}
		}
		out = filtered
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListClassesForSchool(c *gin.Context) {
	out, err := h.repo.ListClasses(c.Request.Context(), c.Param("schoolId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListFeeSchedules(c *gin.Context) {
	// The console filters by class_id; school_id is also accepted for the broader admin view.
	out, err := h.repo.ListFeeSchedules(c.Request.Context(), c.Query("school_id"), c.Query("class_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) CreateFeeSchedule(c *gin.Context) {
	var req CreateFeeScheduleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	feeItemsJSON := "[]"
	if len(req.FeeItems) > 0 {
		feeItemsJSON = string(req.FeeItems)
	}
	policyJSON := "{}"
	if len(req.InstallmentPolicy) > 0 {
		policyJSON = string(req.InstallmentPolicy)
	}
	params := CreateFeeScheduleParams{
		SchoolID:              req.SchoolID,
		SessionID:             req.SessionID,
		ClassID:               req.ClassID,
		Term:                  req.Term,
		Name:                  req.Term, // academy_fee_schedules.name is NOT NULL; term is the console label
		AmountMinor:           sumFeeItems(req.FeeItems),
		DueDate:               req.DueDate,
		FeeItemsJSON:          feeItemsJSON,
		InstallmentPolicyJSON: policyJSON,
	}
	id, created, err := h.repo.CreateFeeSchedule(c.Request.Context(), params)
	if err != nil {
		h.fail(c, err)
		return
	}
	out := FeeSchedule{
		ID: id, SchoolID: req.SchoolID, SessionID: req.SessionID, ClassID: req.ClassID,
		Term: req.Term, Status: "draft", DueDate: req.DueDate, AmountMinor: params.AmountMinor,
		FeeItemsRaw: feeItemsJSON, InstallmentPolicyRaw: policyJSON,
	}
	_ = created
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// CreateSchool onboards a school from the flat admin surface. It REUSES feesschool.Service
// (owner = the authenticated admin), which stamps the immutable audit row + starts the
// tier state machine at 'unverified'. No parallel insert.
func (h *Handler) CreateSchool(c *gin.Context) {
	if h.schoolSvc == nil {
		h.fail(c, errors.New("school service unavailable"))
		return
	}
	var req CreateSchoolAdminRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.schoolSvc.Create(c.Request.Context(), actorID(c), feesschool.CreateSchoolRequest{
		Name:              req.Name,
		Code:              req.Code,
		Level:             req.Level,
		VirtualAccountRef: req.VirtualAccountRef,
		Contact:           req.Contact,
	})
	if err != nil {
		h.failCreate(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// CreateSession opens an academic session for a school. Reuses feessession.Service (audit
// + status machine start = 'active').
func (h *Handler) CreateSession(c *gin.Context) {
	if h.sessionSvc == nil {
		h.fail(c, errors.New("session service unavailable"))
		return
	}
	var req CreateSessionAdminRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.sessionSvc.CreateSession(c.Request.Context(), actorID(c), req.SchoolID, feessession.CreateSessionRequest{
		Name:          req.Name,
		TermStructure: req.TermStructure,
		StartDate:     req.StartDate,
		EndDate:       req.EndDate,
	})
	if err != nil {
		h.failCreate(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// CreateClass opens a class within a school. Reuses feessession.Service (validates the
// session belongs to the same school, then audits).
func (h *Handler) CreateClass(c *gin.Context) {
	if h.sessionSvc == nil {
		h.fail(c, errors.New("session service unavailable"))
		return
	}
	var req CreateClassAdminRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.sessionSvc.CreateClass(c.Request.Context(), actorID(c), req.SchoolID, feessession.CreateClassRequest{
		SessionID:          req.SessionID,
		Name:               req.Name,
		Level:              req.Level,
		ClassTeacherUserID: req.ClassTeacherUserID,
	})
	if err != nil {
		h.failCreate(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

// failCreate maps the domain services' validation sentinels to stable HTTP codes; anything
// else falls through to the generic 500 (h.fail).
func (h *Handler) failCreate(c *gin.Context, err error) {
	switch {
	case errors.Is(err, feesschool.ErrUnauthenticated), errors.Is(err, feessession.ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, feesschool.ErrMissingName), errors.Is(err, feessession.ErrMissingName),
		errors.Is(err, feessession.ErrInvalidDate):
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
	case errors.Is(err, feessession.ErrSchoolMismatch):
		c.JSON(http.StatusConflict, gin.H{"error": "school_mismatch", "message": err.Error()})
	case errors.Is(err, feessession.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	default:
		h.fail(c, err)
	}
}

func (h *Handler) IssueFeeSchedule(c *gin.Context) {
	id := c.Param("id")
	issuedAt, found, err := h.repo.IssueFeeSchedule(c.Request.Context(), id)
	if err != nil {
		h.fail(c, err)
		return
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "fee schedule not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": FeeScheduleIssueResult{
		ID: id, Status: "issued", IssuedAt: issuedAt, Immutable: true,
	}})
}

func (h *Handler) Collections(c *gin.Context) {
	out, err := h.repo.CollectionsOverview(c.Request.Context(), c.Query("school_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListInvoices(c *gin.Context) {
	out, err := h.repo.ListInvoices(c.Request.Context(), c.Query("school_id"), c.Query("status"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListPromotions(c *gin.Context) {
	out, err := h.repo.ListPromotions(c.Request.Context(), c.Query("school_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListCompetitions(c *gin.Context) {
	out, err := h.repo.ListCompetitions(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListCompetitionRegistrations(c *gin.Context) {
	out, err := h.repo.ListCompetitionRegistrations(c.Request.Context(), c.Query("competition_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListGovOptIns(c *gin.Context) {
	out, err := h.repo.ListGovOptIns(c.Request.Context(), c.Query("school_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) SetGovOptIn(c *gin.Context) {
	var req SetGovOptInRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.repo.SetGovOptIn(c.Request.Context(), req.SchoolID, req.Category, actorID(c), req.OptedIn)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) ListRoleGrants(c *gin.Context) {
	out, err := h.repo.ListRoleGrants(c.Request.Context(), c.Query("school_id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
