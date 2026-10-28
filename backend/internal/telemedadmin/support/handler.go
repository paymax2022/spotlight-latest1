package support

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const (
	keyData  = "data"
	keyError = "error"

	defaultLimit = 25
	maxLimit     = 100
	maxQuery     = 120
	maxBody      = 4000
	maxNote      = 2000
)

// route describes how one queue is mounted.
type route struct {
	kind   Kind
	path   string
	get    bool
	reply  bool
	assign bool
}

var routes = []route{
	{KindTicket, "/support/tickets", true, true, true},
	{KindDispute, "/support/disputes", true, true, true},
	{KindCall, "/support/call-disputes", true, false, true},
	{KindSafety, "/safety/issues", true, false, true},
	{KindCase, "/emergencies/cases", true, false, true},
	{KindEscalation, "/emergencies/escalations", true, false, true},
}

// Handler serves the support admin routes.
type Handler struct{ store *Store }

// Register mounts every route on g (already /api/v1/telemedicine/admin with the
// auth middleware applied). Reads are gated by view, mutations by manage.
func Register(g *gin.RouterGroup, db *pgxpool.Pool, view, manage gin.HandlerFunc) {
	h := &Handler{store: NewStore(db)}
	h.register(g, view, manage)
}

func (h *Handler) register(g *gin.RouterGroup, view, manage gin.HandlerFunc) {
	g.GET("/support/summary", view, h.summary)
	g.GET("/emergencies/facilities", view, h.facilities)
	for _, r := range routes {
		r := r
		g.GET(r.path, view, h.list(r.kind))
		if r.get {
			g.GET(r.path+"/:id", view, h.get(r.kind))
		}
		if r.reply {
			g.POST(r.path+"/:id/reply", manage, h.reply(r.kind))
		}
		g.POST(r.path+"/:id/status", manage, h.setStatus(r.kind))
		if r.assign {
			g.POST(r.path+"/:id/assign", manage, h.assign(r.kind))
		}
	}
}

func fail(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrNotFound):
		status = http.StatusNotFound
	case errors.Is(err, ErrValidation):
		status = http.StatusBadRequest
	case errors.Is(err, ErrInvalidTransition), errors.Is(err, ErrClosed):
		status = http.StatusConflict
	}
	msg := httperr.Msg(c, status, err)
	// Domain errors are written for the operator; 5xx stay sanitised by httperr.
	if status != http.StatusInternalServerError {
		msg = strings.TrimPrefix(err.Error(), "support: ")
	}
	c.JSON(status, gin.H{keyError: msg})
}

func badRequest(c *gin.Context, msg string) {
	c.JSON(http.StatusBadRequest, gin.H{keyError: msg})
}

func parseID(c *gin.Context) (string, bool) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		badRequest(c, "id must be a UUID")
		return "", false
	}
	return id, true
}

func requireAdmin(c *gin.Context) (string, bool) {
	id := ginutil.UserID(c)
	if id == "" {
		c.JSON(http.StatusUnauthorized, gin.H{keyError: "authentication required"})
		return "", false
	}
	return id, true
}

func intParam(raw string, def, min, max int) (int, bool) {
	if raw == "" {
		return def, true
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < min || n > max {
		return 0, false
	}
	return n, true
}

// parseListQuery validates every filter against the kind's vocabulary.
func parseListQuery(c *gin.Context, sp spec) (ListQuery, string) {
	q := ListQuery{
		Status:   strings.TrimSpace(c.Query("status")),
		Severity: strings.TrimSpace(c.Query("severity")),
		Category: strings.TrimSpace(c.Query("category")),
		Q:        strings.TrimSpace(c.Query("q")),
		Assigned: strings.TrimSpace(c.Query("assigned")),
	}
	if q.Status != "" {
		q.Status = sp.normalise(q.Status)
		if !sp.knownStatus(q.Status) {
			return q, "unknown status"
		}
	}
	if q.Severity != "" && !severities[q.Severity] {
		return q, "severity must be low, medium, high or critical"
	}
	if len([]rune(q.Q)) > maxQuery || len([]rune(q.Category)) > maxQuery {
		return q, "filter too long"
	}
	if a := q.Assigned; a != "" && a != "unassigned" && a != "me" {
		if _, err := uuid.Parse(a); err != nil {
			return q, "assigned must be unassigned, me or an admin id"
		}
	}
	var ok bool
	if q.Limit, ok = intParam(c.Query("limit"), defaultLimit, 1, maxLimit); !ok {
		return q, "limit must be 1-100"
	}
	if q.Offset, ok = intParam(c.Query("offset"), 0, 0, 1_000_000); !ok {
		return q, "offset must be 0 or more"
	}
	return q, ""
}

func (h *Handler) list(kind Kind) gin.HandlerFunc {
	sp := specs[kind]
	return func(c *gin.Context) {
		q, msg := parseListQuery(c, sp)
		if msg != "" {
			badRequest(c, msg)
			return
		}
		items, total, err := h.store.List(c.Request.Context(), kind, q, ginutil.UserID(c))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{keyData: gin.H{"items": items, "total": total}})
	}
}

func (h *Handler) get(kind Kind) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		d, err := h.store.Get(c.Request.Context(), kind, id)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{keyData: d})
	}
}

func (h *Handler) reply(kind Kind) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		admin, ok := requireAdmin(c)
		if !ok {
			return
		}
		var b struct {
			Body string `json:"body"`
		}
		if err := c.ShouldBindJSON(&b); err != nil {
			badRequest(c, "body is required")
			return
		}
		b.Body = strings.TrimSpace(b.Body)
		if b.Body == "" || len([]rune(b.Body)) > maxBody {
			badRequest(c, "body must be 1-4000 characters")
			return
		}
		key := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
		if len(key) > 120 {
			badRequest(c, "Idempotency-Key too long")
			return
		}
		d, err := h.store.Reply(c.Request.Context(), kind, id, admin, b.Body, key)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{keyData: d})
	}
}

func (h *Handler) setStatus(kind Kind) gin.HandlerFunc {
	sp := specs[kind]
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		admin, ok := requireAdmin(c)
		if !ok {
			return
		}
		var b struct {
			Status string `json:"status"`
			Note   string `json:"note"`
		}
		if err := c.ShouldBindJSON(&b); err != nil {
			badRequest(c, "status is required")
			return
		}
		b.Status = sp.normalise(strings.TrimSpace(b.Status))
		if !sp.knownStatus(b.Status) {
			badRequest(c, "unknown status")
			return
		}
		if len([]rune(b.Note)) > maxNote {
			badRequest(c, "note must be at most 2000 characters")
			return
		}
		d, err := h.store.SetStatus(c.Request.Context(), kind, id, admin, b.Status, b.Note)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{keyData: d})
	}
}

func (h *Handler) assign(kind Kind) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseID(c)
		if !ok {
			return
		}
		admin, ok := requireAdmin(c)
		if !ok {
			return
		}
		// Omitted -> assign to the caller; explicit null/"" -> unassign.
		raw := map[string]any{}
		if c.Request.ContentLength != 0 {
			if err := c.ShouldBindJSON(&raw); err != nil {
				badRequest(c, "invalid JSON body")
				return
			}
		}
		assignee := admin
		if v, present := raw["assignee_id"]; present {
			switch t := v.(type) {
			case nil:
				assignee = ""
			case string:
				assignee = strings.TrimSpace(t)
			default:
				badRequest(c, "assignee_id must be a string or null")
				return
			}
		}
		if assignee != "" {
			if _, err := uuid.Parse(assignee); err != nil {
				badRequest(c, "assignee_id must be a UUID")
				return
			}
		}
		d, err := h.store.Assign(c.Request.Context(), kind, id, admin, assignee)
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{keyData: d})
	}
}

func (h *Handler) summary(c *gin.Context) {
	out, err := h.store.Summary(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

func (h *Handler) facilities(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if len([]rune(q)) > maxQuery {
		badRequest(c, "filter too long")
		return
	}
	limit, ok := intParam(c.Query("limit"), defaultLimit, 1, maxLimit)
	if !ok {
		badRequest(c, "limit must be 1-100")
		return
	}
	offset, ok := intParam(c.Query("offset"), 0, 0, 1_000_000)
	if !ok {
		badRequest(c, "offset must be 0 or more")
		return
	}
	out, err := h.store.Facilities(c.Request.Context(), q, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}
