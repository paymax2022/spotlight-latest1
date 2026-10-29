package claims

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

const (
	keyData  = "data"
	keyError = "error"
)

type handler struct{ st *store }

// Register mounts the claims and referrals admin routes on g, which must already
// be the authenticated /api/v1/telemedicine/admin group. Reads sit behind view
// (telemedicine.admin.view); the two mutations sit behind manage
// (telemedicine.admin.manage).
func Register(g *gin.RouterGroup, db *pgxpool.Pool, view, manage gin.HandlerFunc) {
	register(g, &store{db: db}, view, manage)
}

func register(g *gin.RouterGroup, st *store, view, manage gin.HandlerFunc) {
	h := &handler{st: st}

	g.GET("/claims/summary", view, h.claimsSummary)
	g.GET("/claims/claims", view, h.listClaims)
	g.GET("/claims/claims/:id", view, h.getClaim)
	g.POST("/claims/claims/:id/review", manage, h.reviewClaim)
	g.GET("/claims/preauth", view, h.listPreAuth)
	g.GET("/claims/preauth/:id", view, h.getPreAuth)
	g.GET("/claims/fraud-warnings", view, h.listWarnings)
	g.POST("/claims/fraud-warnings/:id/acknowledge", manage, h.acknowledgeWarning)

	g.GET("/referrals/summary", view, h.referralsSummary)
	for path, sp := range map[string]refSpec{"outgoing": specOutgoing, "incoming": specIncoming, "opinions": specOpinion} {
		g.GET("/referrals/"+path, view, h.listReferrals(sp))
		g.GET("/referrals/"+path+"/:id", view, h.getReferral(sp))
	}
}

func fail(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{keyError: "not found"})
	case errors.Is(err, ErrInvalid):
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{keyError: httperr.Msg(c, http.StatusInternalServerError, err)})
	}
}

func parseList(c *gin.Context) (ListQuery, bool) {
	q := ListQuery{Status: strings.TrimSpace(c.Query("status")), Q: strings.TrimSpace(c.Query("q"))}
	if q.Status != "" && !statusRe.MatchString(q.Status) {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid status"})
		return q, false
	}
	if len([]rune(q.Q)) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "q too long"})
		return q, false
	}
	q.Limit, q.Offset = ginutil.PageParams(c, 20, 200)
	return q, true
}

func page(c *gin.Context, data any, total, limit, offset int) {
	c.JSON(http.StatusOK, gin.H{keyData: data, "total": total, "limit": limit, "offset": offset})
}

func (h *handler) claimsSummary(c *gin.Context) {
	out, err := h.st.claimsSummary(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

func (h *handler) listClaims(c *gin.Context) {
	q, ok := parseList(c)
	if !ok {
		return
	}
	items, total, err := h.st.listClaims(c.Request.Context(), q)
	if err != nil {
		fail(c, err)
		return
	}
	page(c, items, total, q.Limit, q.Offset)
}

func (h *handler) getClaim(c *gin.Context) {
	out, err := h.st.getClaim(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

func (h *handler) reviewClaim(c *gin.Context) {
	var body struct {
		Note string `json:"note"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid body"})
		return
	}
	out, err := h.st.reviewClaim(c.Request.Context(), ginutil.UserID(c), c.Param("id"), body.Note)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

func (h *handler) listPreAuth(c *gin.Context) {
	q, ok := parseList(c)
	if !ok {
		return
	}
	items, total, err := h.st.listPreAuth(c.Request.Context(), q)
	if err != nil {
		fail(c, err)
		return
	}
	page(c, items, total, q.Limit, q.Offset)
}

func (h *handler) getPreAuth(c *gin.Context) {
	out, err := h.st.getPreAuth(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

func (h *handler) listWarnings(c *gin.Context) {
	ack := ginutil.BoolParam(c, "acknowledged")
	severity := strings.ToLower(strings.TrimSpace(c.Query("severity")))
	if severity != "" && !statusRe.MatchString(severity) {
		c.JSON(http.StatusBadRequest, gin.H{keyError: "invalid severity"})
		return
	}
	limit, offset := ginutil.PageParams(c, 20, 200)
	items, total, err := h.st.listWarnings(c.Request.Context(), ack, severity, limit, offset)
	if err != nil {
		fail(c, err)
		return
	}
	page(c, items, total, limit, offset)
}

func (h *handler) acknowledgeWarning(c *gin.Context) {
	out, err := h.st.acknowledgeWarning(c.Request.Context(), ginutil.UserID(c), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

func (h *handler) referralsSummary(c *gin.Context) {
	out, err := h.st.referralsSummary(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

func (h *handler) listReferrals(sp refSpec) gin.HandlerFunc {
	return func(c *gin.Context) {
		q, ok := parseList(c)
		if !ok {
			return
		}
		items, total, err := h.st.listReferrals(c.Request.Context(), sp, q)
		if err != nil {
			fail(c, err)
			return
		}
		page(c, items, total, q.Limit, q.Offset)
	}
}

func (h *handler) getReferral(sp refSpec) gin.HandlerFunc {
	return func(c *gin.Context) {
		out, err := h.st.getReferral(c.Request.Context(), sp, c.Param("id"))
		if err != nil {
			fail(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{keyData: out})
	}
}
