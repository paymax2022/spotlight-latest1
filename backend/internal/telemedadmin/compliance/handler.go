package compliance

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// store is the persistence surface the handlers need; Repo implements it and
// tests substitute a fake.
type store interface {
	Summary(ctx context.Context) (*Summary, error)
	Licences(ctx context.Context, bucket, q string, limit, offset int) (*Page[LicenceRow], error)
	Suspended(ctx context.Context, limit, offset int) (*Page[SuspendedClinician], error)
	Suspend(ctx context.Context, userID, actor, reason string) (*StatusChange, error)
	Reinstate(ctx context.Context, userID, actor, reason string, now time.Time) (*StatusChange, error)
	Audit(ctx context.Context, f AuditFilter, limit, offset int) (*Page[AuditEvent], error)
	Training(ctx context.Context, status string, limit, offset int) (*Page[TrainingRow], error)
	Quality(ctx context.Context, limit, offset int) (*Page[QualityRow], error)
	RecordAccess(ctx context.Context, userID, action string, limit, offset int) (*Page[RecordAccessRow], error)
	DocAccess(ctx context.Context, limit, offset int) (*Page[DocAccessRow], error)
}

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, ErrValidation),
	httperr.R(http.StatusNotFound, ErrNotFound),
	httperr.R(http.StatusConflict, ErrNoProfile, ErrNotApproved, ErrNotSuspended, ErrLicenceExpired, ErrNoApproval),
)

type handler struct {
	st  store
	now func() time.Time
}

// Register mounts the compliance routes on g (/api/v1/telemedicine/admin, already
// behind bearer auth). Reads sit behind view, mutations behind manage.
func Register(g *gin.RouterGroup, db *pgxpool.Pool, view, manage gin.HandlerFunc) {
	registerWith(g, &handler{st: NewRepo(db), now: time.Now}, view, manage)
}

func registerWith(g *gin.RouterGroup, h *handler, view, manage gin.HandlerFunc) {
	c := g.Group("/compliance")
	c.GET("/summary", view, h.summary)
	c.GET("/licences", view, h.licences)
	c.GET("/suspended", view, h.suspended)
	c.GET("/audit", view, h.audit)
	c.GET("/training", view, h.training)
	c.GET("/quality", view, h.quality)
	c.GET("/record-access", view, h.recordAccess)
	c.GET("/doc-access", view, h.docAccess)
	c.POST("/doctors/:userId/suspend", manage, h.suspend)
	c.POST("/doctors/:userId/reinstate", manage, h.reinstate)
}

func ok(c *gin.Context, v any) { c.JSON(http.StatusOK, gin.H{"data": v}) }

func fail(c *gin.Context, err error) {
	code := errMap.Code(err)
	c.JSON(code, gin.H{"error": httperr.Msg(c, code, err)})
}

func bad(c *gin.Context, msg string) {
	c.JSON(http.StatusBadRequest, gin.H{"error": msg})
}

// page reads limit/offset, rejecting anything that is not a plain in-range integer.
func page(c *gin.Context) (limit, offset int, valid bool) {
	limit, offset = defaultLimit, 0
	if s := c.Query("limit"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 1 || n > maxLimit {
			bad(c, "limit must be an integer between 1 and 200")
			return 0, 0, false
		}
		limit = n
	}
	if s := c.Query("offset"); s != "" {
		n, err := strconv.Atoi(s)
		if err != nil || n < 0 {
			bad(c, "offset must be a non-negative integer")
			return 0, 0, false
		}
		offset = n
	}
	return limit, offset, true
}

func optUUID(c *gin.Context, name string) (string, bool) {
	v := c.Query(name)
	if v == "" {
		return "", true
	}
	if _, err := uuid.Parse(v); err != nil {
		bad(c, name+" must be a uuid")
		return "", false
	}
	return v, true
}

func optTime(c *gin.Context, name string) (*time.Time, bool) {
	v := c.Query(name)
	if v == "" {
		return nil, true
	}
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		bad(c, name+" must be an RFC3339 timestamp")
		return nil, false
	}
	return &t, true
}

func shortText(c *gin.Context, name string, max int) (string, bool) {
	v := c.Query(name)
	if len(v) > max {
		bad(c, name+" is too long")
		return "", false
	}
	return v, true
}

func (h *handler) summary(c *gin.Context) {
	s, err := h.st.Summary(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, s)
}

func (h *handler) licences(c *gin.Context) {
	limit, offset, valid := page(c)
	if !valid {
		return
	}
	bucket := c.Query("bucket")
	if _, err := bucketPredicate(bucket); err != nil {
		bad(c, "bucket must be one of all, expired, 30d, 90d")
		return
	}
	q, valid := shortText(c, "q", 80)
	if !valid {
		return
	}
	p, err := h.st.Licences(c.Request.Context(), bucket, q, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, p)
}

func (h *handler) suspended(c *gin.Context) {
	limit, offset, valid := page(c)
	if !valid {
		return
	}
	p, err := h.st.Suspended(c.Request.Context(), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, p)
}

func (h *handler) audit(c *gin.Context) {
	limit, offset, valid := page(c)
	if !valid {
		return
	}
	action, valid := shortText(c, "action", 120)
	if !valid {
		return
	}
	userID, valid := optUUID(c, "user_id")
	if !valid {
		return
	}
	from, valid := optTime(c, "from")
	if !valid {
		return
	}
	to, valid := optTime(c, "to")
	if !valid {
		return
	}
	p, err := h.st.Audit(c.Request.Context(), AuditFilter{Action: action, UserID: userID, From: from, To: to}, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, p)
}

func (h *handler) training(c *gin.Context) {
	limit, offset, valid := page(c)
	if !valid {
		return
	}
	status := c.Query("status")
	if status != "" && status != "pending" && status != "completed" {
		bad(c, "status must be pending or completed")
		return
	}
	p, err := h.st.Training(c.Request.Context(), status, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, p)
}

func (h *handler) quality(c *gin.Context) {
	limit, offset, valid := page(c)
	if !valid {
		return
	}
	p, err := h.st.Quality(c.Request.Context(), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, p)
}

func (h *handler) recordAccess(c *gin.Context) {
	limit, offset, valid := page(c)
	if !valid {
		return
	}
	userID, valid := optUUID(c, "user_id")
	if !valid {
		return
	}
	action, valid := shortText(c, "action", 120)
	if !valid {
		return
	}
	p, err := h.st.RecordAccess(c.Request.Context(), userID, action, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, p)
}

func (h *handler) docAccess(c *gin.Context) {
	limit, offset, valid := page(c)
	if !valid {
		return
	}
	p, err := h.st.DocAccess(c.Request.Context(), limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, p)
}

type reasonBody struct {
	Reason string `json:"reason"`
}

// decision validates the path user id and the reason, then runs fn. The acting
// admin must be identifiable — an unattributed suspension is refused.
func (h *handler) decision(c *gin.Context, fn func(ctx context.Context, userID, actor, reason string) (*StatusChange, error)) {
	userID := c.Param("userId")
	if _, err := uuid.Parse(userID); err != nil {
		bad(c, "userId must be a uuid")
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		bad(c, "a JSON body with a reason is required")
		return
	}
	reason, err := ValidReason(body.Reason)
	if err != nil {
		bad(c, "reason must be between 5 and 500 characters")
		return
	}
	actor := ginutil.UserID(c)
	if actor == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
		return
	}
	out, err := fn(c.Request.Context(), userID, actor, reason)
	if err != nil {
		fail(c, err)
		return
	}
	ok(c, out)
}

func (h *handler) suspend(c *gin.Context) {
	h.decision(c, h.st.Suspend)
}

func (h *handler) reinstate(c *gin.Context) {
	h.decision(c, func(ctx context.Context, userID, actor, reason string) (*StatusChange, error) {
		return h.st.Reinstate(ctx, userID, actor, reason, h.now())
	})
}
