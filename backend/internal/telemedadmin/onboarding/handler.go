package onboarding

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	"spotlight/backend/internal/doctor"
)

var errMap = httperr.New(http.StatusInternalServerError,
	httperr.R(http.StatusBadRequest, ErrValidation),
	httperr.R(http.StatusNotFound, ErrNotFound, doctor.ErrNotFound),
	httperr.R(http.StatusForbidden, doctor.ErrReviewForbidden),
	httperr.R(http.StatusConflict, ErrNoOpenVerification, doctor.ErrReviewIllegalTransition),
)

type handler struct{ svc *Service }

func fail(c *gin.Context, err error) {
	code := errMap.Code(err)
	c.JSON(code, gin.H{"error": httperr.Msg(c, code, err)})
}

func validUserID(c *gin.Context) (string, bool) {
	id := c.Param("userId")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "userId must be a uuid"})
		return "", false
	}
	return id, true
}

func (h *handler) list(c *gin.Context) {
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	out, err := h.svc.List(c.Request.Context(), ListQuery{
		Stage: c.Query("stage"), Q: c.Query("q"), Limit: limit, Offset: offset,
	})
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *handler) get(c *gin.Context) {
	id, ok := validUserID(c)
	if !ok {
		return
	}
	out, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}

func (h *handler) decide(c *gin.Context) {
	id, ok := validUserID(c)
	if !ok {
		return
	}
	var req DecisionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	out, err := h.svc.Decide(c.Request.Context(), ginutil.UserID(c), id, req)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": out})
}
