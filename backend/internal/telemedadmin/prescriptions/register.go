package prescriptions

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// Register mounts the prescription oversight routes on g, which must already be the
// authenticated /api/v1/telemedicine/admin group. Reads use view; flag/unflag use manage.
func Register(g *gin.RouterGroup, db *pgxpool.Pool, view, manage gin.HandlerFunc) {
	register(g, NewService(db), view, manage)
}

func register(g *gin.RouterGroup, svc *Service, view, manage gin.HandlerFunc) {
	h := &handler{svc: svc}
	g.GET("/prescriptions/summary", view, h.summary)
	g.GET("/prescriptions/fulfilments", view, h.fulfilments)
	g.GET("/prescriptions/refills", view, h.refills)
	g.GET("/prescriptions", view, h.list)
	g.GET("/prescriptions/:id", view, h.get)
	g.POST("/prescriptions/:id/flag", manage, h.flag)
	g.POST("/prescriptions/:id/unflag", manage, h.unflag)
}

type handler struct{ svc *Service }

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "prescription not found"})
	case errors.Is(err, ErrValidation):
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

func (h *handler) summary(c *gin.Context) {
	out, err := h.svc.Summary(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *handler) list(c *gin.Context) {
	var q ListQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	items, total, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		fail(c, err)
		return
	}
	limit, offset := clampPage(q.Limit, q.Offset)
	c.JSON(http.StatusOK, gin.H{"data": items, "total": total, "limit": limit, "offset": offset})
}

func (h *handler) fulfilments(c *gin.Context) {
	var q PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	items, total, err := h.svc.ListFulfilments(c.Request.Context(), q)
	if err != nil {
		fail(c, err)
		return
	}
	limit, offset := clampPage(q.Limit, q.Offset)
	c.JSON(http.StatusOK, gin.H{"data": items, "total": total, "limit": limit, "offset": offset})
}

func (h *handler) refills(c *gin.Context) {
	var q PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	items, total, err := h.svc.ListRefills(c.Request.Context(), q)
	if err != nil {
		fail(c, err)
		return
	}
	limit, offset := clampPage(q.Limit, q.Offset)
	c.JSON(http.StatusOK, gin.H{"data": items, "total": total, "limit": limit, "offset": offset})
}

func (h *handler) get(c *gin.Context) {
	adminID := ginutil.UserID(c)
	if adminID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	out, err := h.svc.Get(c.Request.Context(), adminID, c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *handler) flag(c *gin.Context) {
	var b struct {
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&b); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	h.setFlag(c, true, b.Reason)
}

func (h *handler) unflag(c *gin.Context) {
	var b struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&b)
	h.setFlag(c, false, b.Note)
}

func (h *handler) setFlag(c *gin.Context, flag bool, note string) {
	adminID := ginutil.UserID(c)
	if adminID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	out, err := h.svc.SetFlag(c.Request.Context(), adminID, c.Param("id"), flag, note)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
