package announcements

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const (
	keyData  = "data"
	keyError = "error"

	defaultLimit = 25
	maxLimit     = 100
)

// Handler serves the platform-notice authoring routes.
type Handler struct{ store *Store }

// Register mounts the surface on g (already /api/v1/telemedicine/admin with the
// auth middleware applied). The history is read-gated; publishing a notice to
// every provider is a decision, so it is gated on manage.
func Register(g *gin.RouterGroup, db *pgxpool.Pool, view, manage gin.HandlerFunc) {
	h := &Handler{store: NewStore(db)}
	g.GET("/announcements", view, h.list)
	g.POST("/announcements", manage, h.publish)
}

func fail(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, ErrValidation) {
		status = http.StatusBadRequest
	}
	msg := httperr.Msg(c, status, err)
	// Validation messages are written for the operator; 5xx stay sanitised.
	if status != http.StatusInternalServerError {
		msg = strings.TrimPrefix(err.Error(), "announcements: ")
	}
	c.JSON(status, gin.H{keyError: msg})
}

// publish authors one notice and fans it out to every provider portal account.
func (h *Handler) publish(c *gin.Context) {
	var req PublishRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.store.Publish(c.Request.Context(), ginutil.UserID(c), req)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// list returns the campaigns already published, newest first.
func (h *Handler) list(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	if limit <= 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	out, err := h.store.List(c.Request.Context(), limit)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}
