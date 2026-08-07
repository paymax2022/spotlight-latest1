package association

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Election endpoints. Officer actions are org-scoped inside the service
// (requireElectionOfficer); voter actions are fail-closed on eligibility + window.

func (h *Handler) ListElections(c *gin.Context) {
	v, err := h.svc.ListElections(c.Request.Context(), c.GetString("user_id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) GetElection(c *gin.Context) {
	v, err := h.svc.GetElection(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, v)
}

func (h *Handler) CreateElection(c *gin.Context) {
	var in CreateElectionInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.CreateElection(c.Request.Context(), c.GetString("user_id"), in)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) AddElectionCandidate(c *gin.Context) {
	var in AddCandidateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	id, err := h.svc.AddCandidate(c.Request.Context(), c.GetString("user_id"), c.Param("id"), in)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (h *Handler) OpenElection(c *gin.Context) {
	if err := h.svc.OpenElection(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) CloseElection(c *gin.Context) {
	if err := h.svc.CloseElection(c.Request.Context(), c.GetString("user_id"), c.Param("id")); err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) PublishElectionResults(c *gin.Context) {
	res, err := h.svc.PublishResults(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) HandoverElection(c *gin.Context) {
	res, err := h.svc.HandoverElection(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetElectionTally(c *gin.Context) {
	res, err := h.svc.Tally(c.Request.Context(), c.GetString("user_id"), c.Param("id"))
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) CastVote(c *gin.Context) {
	var in CastVoteInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	receipt, err := h.svc.CastVote(c.Request.Context(), c.GetString("user_id"), c.Param("id"), in)
	if err != nil {
		c.JSON(statusFor(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, receipt)
}
