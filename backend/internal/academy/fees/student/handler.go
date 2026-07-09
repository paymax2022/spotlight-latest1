package feesstudent

import (
	"errors"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/internal/middleware"
	"spotlight/backend/internal/services"
)

// Handler exposes Student + Guardian-linking + bulk-import routes over Gin. Router
// registration into RegisterAcademy is owned by the QA/integration task — see
// RegisterFeesStudent for the groups this package expects.
type Handler struct {
	svc *Service
}

// NewHandler builds the student handler.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func uid(c *gin.Context) string {
	if v := c.GetString("user_id"); v != "" {
		return v
	}
	if u, ok := middleware.GetAuthenticatedUser(c); ok {
		return u.ID
	}
	return ""
}

func (h *Handler) requireUser(c *gin.Context) (string, bool) {
	u := uid(c)
	if u == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return "", false
	}
	return u, true
}

func (h *Handler) fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
	case errors.Is(err, ErrUnauthenticated):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated", "message": err.Error()})
	case errors.Is(err, ErrMissingSchool):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_school", "message": err.Error()})
	case errors.Is(err, ErrMissingAdmissionNo):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_admission_number", "message": err.Error()})
	case errors.Is(err, ErrMissingGuardian):
		c.JSON(http.StatusBadRequest, gin.H{"error": "missing_guardian", "message": err.Error()})
	case errors.Is(err, ErrGuardianAlreadyLinked):
		c.JSON(http.StatusConflict, gin.H{"error": "guardian_already_linked", "message": err.Error()})
	case errors.Is(err, ErrAdmissionNumberTaken):
		c.JSON(http.StatusConflict, gin.H{"error": "admission_number_taken", "message": err.Error()})
	case errors.Is(err, ErrImportNotApprovable):
		c.JSON(http.StatusConflict, gin.H{"error": "import_not_approvable", "message": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal", "message": err.Error()})
	}
}

// RegisterFeesStudent wires student + guardian + import routes onto the passed member
// group. Routes are per-school under /schools/:schoolId. nil pool/groups are skipped.
//
//	member: POST  /schools/:schoolId/students                        create student
//	        GET   /schools/:schoolId/students                        list students (?class= filter)
//	        GET   /schools/:schoolId/students/:studentId             get student
//	        POST  /schools/:schoolId/students/:studentId/guardians   link guardian (existing identity)
//	        DELETE/schools/:schoolId/students/:studentId/guardians/:guardianId  unlink guardian
//	        POST  /schools/:schoolId/students/import/preview         parse+validate CSV → preview
//	        POST  /schools/:schoolId/students/import/approve         approve preview → create rows
func RegisterFeesStudent(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService) *Handler {
	if pool == nil {
		return nil
	}
	h := NewHandler(NewService(pool))
	if member != nil {
		g := member.Group("/schools/:schoolId")
		g.POST("/students", h.CreateStudent)
		g.GET("/students", h.ListStudents)
		g.GET("/students/:studentId", h.GetStudent)
		g.POST("/students/:studentId/guardians", h.LinkGuardian)
		g.DELETE("/students/:studentId/guardians/:guardianId", h.UnlinkGuardian)
		g.POST("/students/import/preview", h.ImportPreview)
		g.POST("/students/import/approve", h.ImportApprove)
	}
	// admin group reserved for platform-scoped listing; rbac kept in signature so the
	// integration task can gate admin variants without a signature change.
	_ = admin
	_ = rbac
	return h
}

// ── Handlers ────────────────────────────────────────────────────────────────────

func (h *Handler) CreateStudent(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req CreateStudentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.CreateStudent(c.Request.Context(), u, c.Param("schoolId"), req)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": out})
}

func (h *Handler) ListStudents(c *gin.Context) {
	out, err := h.svc.ListStudents(c.Request.Context(), c.Param("schoolId"), c.Query("class"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) GetStudent(c *gin.Context) {
	out, err := h.svc.GetStudent(c.Request.Context(), c.Param("studentId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) LinkGuardian(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req LinkGuardianRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.LinkGuardian(c.Request.Context(), u, c.Param("studentId"), req.GuardianUserID)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *Handler) UnlinkGuardian(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	out, err := h.svc.UnlinkGuardian(c.Request.Context(), u, c.Param("studentId"), c.Param("guardianId"))
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// ImportPreview accepts a raw CSV body (Content-Type text/csv) OR a JSON body {"csv":"..."}
// and returns the parse+validate preview WITHOUT writing anything.
func (h *Handler) ImportPreview(c *gin.Context) {
	if _, ok := h.requireUser(c); !ok {
		return
	}
	csvData, err := readCSVBody(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	out, err := h.svc.ParseAndValidateImport(c.Request.Context(), c.Param("schoolId"), csvData)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

// importApproveRequest carries a previously-generated preview to be committed. Sending the
// full preview back makes the approval explicit (the client approves exactly what it saw).
type importApproveRequest struct {
	Preview *ImportPreview `json:"preview" binding:"required"`
}

func (h *Handler) ImportApprove(c *gin.Context) {
	u, ok := h.requireUser(c)
	if !ok {
		return
	}
	var req importApproveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_input", "message": err.Error()})
		return
	}
	created, skipped, err := h.svc.ApproveImport(c.Request.Context(), u, c.Param("schoolId"), req.Preview)
	if err != nil {
		h.fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"data": gin.H{"created": created, "skipped": skipped}})
}

// readCSVBody reads a CSV payload from either a raw text body or a JSON {"csv": "..."}.
func readCSVBody(c *gin.Context) (string, error) {
	ct := c.ContentType()
	if ct == "application/json" {
		var body struct {
			CSV string `json:"csv"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			return "", err
		}
		return body.CSV, nil
	}
	b, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
