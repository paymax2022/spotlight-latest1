package healthpharmacy

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"spotlight/backend/go-common/ginutil"
)

const envData = "data"

func failAdminAction(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrAdminInvalid):
		ginutil.FailOK(c, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrAdminNotFound):
		ginutil.FailOK(c, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrDeciderUnavailable):
		ginutil.FailOK(c, http.StatusServiceUnavailable, err.Error())
	default:
		failErr(c, http.StatusConflict, err)
	}
}

type decisionInput struct{ id, verb, note string }

// bindDecision reads {decision|action, note} plus a uuid :id.
func bindDecision(c *gin.Context, field string) (decisionInput, bool) {
	if _, err := uuid.Parse(c.Param("id")); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "id must be a uuid")
		return decisionInput{}, false
	}
	var req map[string]string
	if err := c.ShouldBindJSON(&req); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return decisionInput{}, false
	}
	return decisionInput{id: c.Param("id"), verb: req[field], note: req["note"]}, true
}

// AdminDecidePcn — POST /pcn/applications/:id/decision  body: { decision, note }
func (h *Handler) AdminDecidePcn(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	in, ok := bindDecision(c, "decision")
	if !ok {
		return
	}
	res, err := h.svc.DecidePcnApplication(c.Request.Context(), h.decider, uid, in.id, in.verb, in.note)
	if err != nil {
		failAdminAction(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, envData: res})
}

// AdminGovernCatalog — POST /catalog/:id/govern  body: { action, note }
func (h *Handler) AdminGovernCatalog(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	in, ok := bindDecision(c, "action")
	if !ok {
		return
	}
	res, err := h.svc.GovernCatalogItem(c.Request.Context(), uid, in.id, in.verb, in.note)
	if err != nil {
		failAdminAction(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, envData: res})
}

// AdminListRecalls — GET /recalls?status=&severity=&q=
func (h *Handler) AdminListRecalls(c *gin.Context) {
	st, sev := c.Query("status"), c.Query("severity")
	if (st != "" && !recallStatuses[st]) || (sev != "" && !recallSeverities[sev]) {
		ginutil.FailOK(c, http.StatusBadRequest, "status or severity is not a recognised value")
		return
	}
	rows, err := h.svc.ListRecalls(c.Request.Context(), st, sev, c.Query("q"))
	if err != nil {
		failErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keySuccess: true, envData: rows})
}

// AdminCreateRecall — POST /recalls  body: CreateRecallInput
func (h *Handler) AdminCreateRecall(c *gin.Context) {
	uid, ok := requireUser(c)
	if !ok {
		return
	}
	var in CreateRecallInput
	if err := c.ShouldBindJSON(&in); err != nil {
		ginutil.FailOK(c, http.StatusBadRequest, "invalid body")
		return
	}
	if in.ProductID != "" {
		if _, err := uuid.Parse(in.ProductID); err != nil {
			ginutil.FailOK(c, http.StatusBadRequest, "product_id must be a uuid")
			return
		}
	}
	r, err := h.svc.CreateRecall(c.Request.Context(), uid, in)
	if err != nil {
		failAdminAction(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{keySuccess: true, envData: gin.H{
		"id": r.ID, "status": r.Status, "audit_id": "", "message": "Recall opened", "recall": r,
	}})
}
