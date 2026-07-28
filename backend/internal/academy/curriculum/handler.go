package curriculum

import (
	"context"
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes the academy curriculum over Gin. Member routes are open reads
// of the versioned curriculum spine. Admin routes are RBAC-gated by the
// "academy.curriculum" permission and audited (actor = c.GetString("user_id")).
//
// GOLDEN RULE: curriculum is VERSIONED DATA. Handlers only read/administer the
// rows in academy_curriculum_versions and its child tables — no hardcoded lists.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterAcademyCurriculum mounts the curriculum routes, mirroring
// identity.RegisterAcademyIdentity exactly.
//
//	member: GET /academy/curriculum/versions
//	        GET /academy/curriculum/classes (optional ?version=)
//	        GET /academy/curriculum/classes/:id/subjects
//	        GET /academy/curriculum/subjects/:id/topics
//	        GET /academy/curriculum/topics/:id/objectives
//	        GET /academy/curriculum/streams, GET /academy/curriculum/trade-tracks
//	admin:  POST/PATCH /academy/admin/curriculum/{versions,classes,subjects,topics,objectives}
//	        (all guarded by academy.curriculum)
//
// Seeding is run best-effort on startup in a logged goroutine so a missing pool
// or seed failure never blocks route registration.
func RegisterAcademyCurriculum(member *gin.RouterGroup, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) {
	if pool == nil {
		return
	}
	h := NewHandler(NewService(pool))
	guard := func(p string) gin.HandlerFunc { return middleware.RequirePermission(rbac, p) }

	// Best-effort idempotent seed on startup (logged, non-blocking).
	SeedOnStart(pool)

	if member != nil {
		mg := member.Group("/academy/curriculum")
		mg.GET("/versions", h.ListVersions)
		mg.GET("/classes", h.ListClasses)
		mg.GET("/classes/:id/subjects", h.ListSubjects)
		mg.GET("/subjects/:id/topics", h.ListTopics)
		mg.GET("/topics/:id/objectives", h.ListObjectives)
		mg.GET("/streams", h.ListStreams)
		mg.GET("/trade-tracks", h.ListTradeTracks)
	}

	if admin != nil {
		ag := admin.Group("/academy/admin/curriculum", guard("academy.curriculum"))
		ag.POST("/versions", h.CreateVersion)
		ag.PATCH("/versions/:id", h.UpdateVersion)
		ag.POST("/versions/:id/publish", h.PublishVersion)
		ag.POST("/classes", h.CreateClass)
		ag.PATCH("/classes/:id", h.UpdateClass)
		ag.POST("/subjects", h.CreateSubject)
		ag.PATCH("/subjects/:id", h.UpdateSubject)
		ag.POST("/topics", h.CreateTopic)
		ag.PATCH("/topics/:id", h.UpdateTopic)
		ag.POST("/objectives", h.CreateObjective)
		ag.PATCH("/objectives/:id", h.UpdateObjective)
	}
}

// SeedOnStart runs Seed best-effort in a logged goroutine. Exposed so callers
// that register routes elsewhere can still trigger seeding.
func SeedOnStart(pool *pgxpool.Pool) {
	if pool == nil {
		return
	}
	go func() {
		if err := Seed(context.Background(), pool); err != nil {
			log.Printf("academy.curriculum: seed failed (non-fatal): %v", err)
		}
	}()
}

// fail maps domain errors to HTTP statuses with stable snake_case codes.
func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// ── Member reads ────────────────────────────────────────────────────────────

func (h *Handler) ListVersions(c *gin.Context) {
	out, err := h.svc.ListVersions(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"versions": out})
}

func (h *Handler) ListClasses(c *gin.Context) {
	versionID := c.Query("version")
	out, err := h.svc.ListClasses(c.Request.Context(), versionID, 0)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"classes": out})
}

func (h *Handler) ListSubjects(c *gin.Context) {
	out, err := h.svc.ListSubjects(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"subjects": out})
}

func (h *Handler) ListTopics(c *gin.Context) {
	out, err := h.svc.ListTopics(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"topics": out})
}

func (h *Handler) ListObjectives(c *gin.Context) {
	out, err := h.svc.GetObjectives(c.Request.Context(), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"objectives": out})
}

func (h *Handler) ListStreams(c *gin.Context) {
	out, err := h.svc.ListStreams(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"streams": out})
}

func (h *Handler) ListTradeTracks(c *gin.Context) {
	out, err := h.svc.ListTradeTracks(c.Request.Context())
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"trade_tracks": out})
}

// ── Admin CRUD (academy.curriculum) ─────────────────────────────────────────

func (h *Handler) CreateVersion(c *gin.Context) {
	var req CreateVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	v, err := h.svc.CreateVersion(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, v)
}

func (h *Handler) UpdateVersion(c *gin.Context) {
	var req UpdateVersionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	v, err := h.svc.UpdateVersion(c.Request.Context(), c.GetString("user_id"), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) PublishVersion(c *gin.Context) {
	v, err := h.svc.PublishVersion(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) CreateClass(c *gin.Context) {
	var req CreateClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	out, err := h.svc.CreateClass(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) UpdateClass(c *gin.Context) {
	var req UpdateClassRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	out, err := h.svc.UpdateClass(c.Request.Context(), c.GetString("user_id"), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) CreateSubject(c *gin.Context) {
	var req CreateSubjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	out, err := h.svc.CreateSubject(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) UpdateSubject(c *gin.Context) {
	var req UpdateSubjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	out, err := h.svc.UpdateSubject(c.Request.Context(), c.GetString("user_id"), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) CreateTopic(c *gin.Context) {
	var req CreateTopicRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	out, err := h.svc.CreateTopic(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) UpdateTopic(c *gin.Context) {
	var req UpdateTopicRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	out, err := h.svc.UpdateTopic(c.Request.Context(), c.GetString("user_id"), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) CreateObjective(c *gin.Context) {
	var req CreateObjectiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	out, err := h.svc.CreateObjective(c.Request.Context(), c.GetString("user_id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) UpdateObjective(c *gin.Context) {
	var req UpdateObjectiveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_body"})
		return
	}
	out, err := h.svc.UpdateObjective(c.Request.Context(), c.GetString("user_id"), c.Param("id"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}
