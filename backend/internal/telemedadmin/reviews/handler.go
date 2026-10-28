package reviews

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

type handler struct{ store Store }

// Register mounts the review-moderation routes on g, which must already be the
// authenticated /api/v1/telemedicine/admin group. view guards reads
// (telemedicine.admin.view); manage guards mutations (telemedicine.admin.manage).
func Register(g *gin.RouterGroup, db *pgxpool.Pool, view, manage gin.HandlerFunc) {
	registerWith(g, NewStore(db), view, manage)
}

func registerWith(g *gin.RouterGroup, store Store, view, manage gin.HandlerFunc) {
	h := &handler{store: store}
	g.GET("/reviews/summary", view, h.summary)
	g.GET("/reviews", view, h.list)
	g.GET("/reviews/disputes", view, h.listDisputes)
	g.GET("/reviews/disputes/:id", view, h.getDispute)
	g.POST("/reviews/disputes/:id/resolve", manage, h.resolve)
	g.GET("/reviews/:source/:id", view, h.get)
	g.POST("/reviews/:source/:id/hide", manage, h.hide)
	g.POST("/reviews/:source/:id/unhide", manage, h.unhide)
}

func fail(c *gin.Context, err error) {
	code := errMap.Code(err)
	c.JSON(code, gin.H{"error": httperr.Msg(c, code, err)})
}

func badRequest(c *gin.Context, format string, a ...any) {
	fail(c, fmt.Errorf("%w: "+format, append([]any{ErrValidation}, a...)...))
}

func (h *handler) summary(c *gin.Context) {
	s, err := h.store.Summary(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": s})
}

func queryInt(c *gin.Context, key string, def int) (int, error) {
	v := strings.TrimSpace(c.Query(key))
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%w: %s must be an integer", ErrValidation, key)
	}
	return n, nil
}

func (h *handler) list(c *gin.Context) {
	f := ListFilter{Source: c.Query("source"), DoctorID: strings.TrimSpace(c.Query("doctor_id")), Query: strings.TrimSpace(c.Query("q"))}
	if f.Source != "" && !validSource(f.Source) {
		badRequest(c, "source must be telemedicine or doctor_module")
		return
	}
	var err error
	if f.Rating, err = queryInt(c, "rating", 0); err != nil {
		fail(c, err)
		return
	}
	if f.Rating != 0 && (f.Rating < 1 || f.Rating > 5) {
		badRequest(c, "rating must be between 1 and 5")
		return
	}
	if v := c.Query("hidden"); v != "" {
		b, perr := strconv.ParseBool(v)
		if perr != nil {
			badRequest(c, "hidden must be true or false")
			return
		}
		f.Hidden = &b
	}
	if f.DoctorID != "" && !validUUID(f.DoctorID) {
		badRequest(c, "doctor_id must be a UUID")
		return
	}
	if len(f.Query) > maxQueryLen {
		badRequest(c, "q is limited to %d characters", maxQueryLen)
		return
	}
	if f.Limit, err = queryInt(c, "limit", 50); err != nil {
		fail(c, err)
		return
	}
	if f.Offset, err = queryInt(c, "offset", 0); err != nil {
		fail(c, err)
		return
	}
	rows, total, err := h.store.ListReviews(c.Request.Context(), f)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total})
}

func reviewKey(c *gin.Context) (source, id string, ok bool) {
	source, id = c.Param("source"), c.Param("id")
	if !validSource(source) {
		badRequest(c, "source must be telemedicine or doctor_module")
		return "", "", false
	}
	if !validUUID(id) {
		badRequest(c, "id must be a UUID")
		return "", "", false
	}
	return source, id, true
}

func (h *handler) get(c *gin.Context) {
	source, id, ok := reviewKey(c)
	if !ok {
		return
	}
	d, err := h.store.GetReview(c.Request.Context(), source, id)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": d})
}

type reasonBody struct {
	Reason string `json:"reason"`
}

func (h *handler) setHidden(c *gin.Context, hidden bool) {
	source, id, ok := reviewKey(c)
	if !ok {
		return
	}
	actor := ginutil.UserID(c)
	if actor == "" || !validUUID(actor) {
		fail(c, ErrNoActor)
		return
	}
	var body reasonBody
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "a JSON body with a reason is required")
		return
	}
	reason, err := cleanReason(body.Reason)
	if err != nil {
		fail(c, err)
		return
	}
	rv, err := h.store.SetHidden(c.Request.Context(), actor, source, id, hidden, reason)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rv})
}

func (h *handler) hide(c *gin.Context)   { h.setHidden(c, true) }
func (h *handler) unhide(c *gin.Context) { h.setHidden(c, false) }

func (h *handler) listDisputes(c *gin.Context) {
	f := DisputeFilter{Status: c.Query("status"), Kind: c.Query("kind")}
	switch f.Status {
	case "", StatusOpen, StatusUpheld, StatusRejected:
	default:
		badRequest(c, "status must be open, upheld or rejected")
		return
	}
	switch f.Kind {
	case "", "dispute", "removal_request", "report":
	default:
		badRequest(c, "kind must be dispute, removal_request or report")
		return
	}
	var err error
	if f.Limit, err = queryInt(c, "limit", 50); err != nil {
		fail(c, err)
		return
	}
	if f.Offset, err = queryInt(c, "offset", 0); err != nil {
		fail(c, err)
		return
	}
	rows, total, err := h.store.ListDisputes(c.Request.Context(), f)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rows, "total": total})
}

func (h *handler) getDispute(c *gin.Context) {
	id := c.Param("id")
	if !validUUID(id) {
		badRequest(c, "id must be a UUID")
		return
	}
	d, err := h.store.GetDispute(c.Request.Context(), id)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": d})
}

func (h *handler) resolve(c *gin.Context) {
	id := c.Param("id")
	if !validUUID(id) {
		badRequest(c, "id must be a UUID")
		return
	}
	actor := ginutil.UserID(c)
	if actor == "" || !validUUID(actor) {
		fail(c, ErrNoActor)
		return
	}
	var body struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		badRequest(c, "a JSON body with decision and reason is required")
		return
	}
	if body.Decision != StatusUpheld && body.Decision != StatusRejected {
		badRequest(c, "decision must be upheld or rejected")
		return
	}
	reason, err := cleanReason(body.Reason)
	if err != nil {
		fail(c, err)
		return
	}
	d, err := h.store.Resolve(c.Request.Context(), actor, id, body.Decision, reason)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": d})
}
