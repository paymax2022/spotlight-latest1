package estate

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
)

// election_governance_handler.go — the HTTP surface for the governance workflow built in
// election_governance.go. Every route lives under /estate/:id/elections/:electionId, so
// the estate in the path always bounds the election: a handler never trusts the id alone.

// writeElectionError maps a governance failure to a status code. Membership failures are
// 403 (the same message sniff the rest of the package uses), a missing subject is 404, an
// election whose state forbids the act is 409, and anything else the caller can correct is
// 400.
func writeElectionError(c *gin.Context, err error) {
	m := err.Error()
	code := http.StatusBadRequest
	switch {
	case isMembershipErr(err):
		code = http.StatusForbidden
	case strings.Contains(m, "not found"):
		code = http.StatusNotFound
	case strings.Contains(m, "already"), strings.Contains(m, "locked"),
		strings.Contains(m, "cancelled"), strings.Contains(m, "cannot"),
		strings.Contains(m, "needs at least"), strings.Contains(m, "only available after"),
		strings.Contains(m, "not open"), strings.Contains(m, "no effect"):
		code = http.StatusConflict
	}
	c.JSON(code, gin.H{keyError: httperr.Msg(c, code, err)})
}

// electionCtx pulls the two path ids every governance route needs.
func electionCtx(c *gin.Context) (estateID, electionID string) {
	return c.Param("id"), c.Param("electionId")
}

func (h *Handler) UpdateElectionConfig(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req ElectionConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	el, err := h.svc.UpdateElectionConfig(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, el)
}

func (h *Handler) ProposeElectionRules(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req SetEligibilityRulesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	prop, err := h.svc.ProposeElectionRules(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, prop)
}

func (h *Handler) ListElectionRuleProposals(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	props, err := h.svc.ListElectionRuleProposals(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: props})
}

type decideRulesRequest struct {
	Approve bool   `json:"approve"`
	Note    string `json:"note"`
}

func (h *Handler) DecideElectionRules(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req decideRulesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	rules, err := h.svc.DecideElectionRules(c.Request.Context(), estateID, ginutil.UserID(c),
		electionID, c.Param("proposalId"), req.Approve, req.Note)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: rules})
}

func (h *Handler) BuildElectionRoll(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	roll, err := h.svc.BuildElectionRoll(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, roll)
}

type freezeRollRequest struct {
	RollID string `json:"roll_id" binding:"required"`
}

func (h *Handler) FreezeElectionRoll(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req freezeRollRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	roll, err := h.svc.FreezeElectionRoll(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req.RollID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, roll)
}

func (h *Handler) ListElectionRoll(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	entries, err := h.svc.ListElectionRoll(c.Request.Context(), estateID, ginutil.UserID(c),
		electionID, atoiDefault(c.Query("version"), 0))
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: entries})
}

type rollEntryActionRequest struct {
	UserID string `json:"user_id" binding:"required"`
	Reason string `json:"reason" binding:"required,min=5"`
}

func (h *Handler) RemoveRollEntry(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req rollEntryActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	entry, err := h.svc.RemoveRollEntry(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req.UserID, req.Reason)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, entry)
}

func (h *Handler) AddRollException(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req rollEntryActionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	entry, err := h.svc.AddRollException(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req.UserID, req.Reason)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, entry)
}

type challengeRollRequest struct {
	SubjectUserID string `json:"subject_user_id" binding:"required"`
	Reason        string `json:"reason" binding:"required,min=5"`
}

func (h *Handler) ChallengeRollEntry(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req challengeRollRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ch, err := h.svc.ChallengeRollEntry(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req.SubjectUserID, req.Reason)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, ch)
}

func (h *Handler) ListRollChallenges(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	out, err := h.svc.ListRollChallenges(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

type resolveRequest struct {
	Uphold     bool   `json:"uphold"`
	Resolution string `json:"resolution" binding:"required,min=5"`
}

func (h *Handler) ResolveRollChallenge(c *gin.Context) {
	estateID, _ := electionCtx(c)
	var req resolveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	ch, err := h.svc.ResolveRollChallenge(c.Request.Context(), estateID, ginutil.UserID(c), c.Param("challengeId"), req.Uphold, req.Resolution)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, ch)
}

func (h *Handler) Nominate(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req NominationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	n, err := h.svc.Nominate(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, n)
}

func (h *Handler) ListNominations(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	out, err := h.svc.ListNominations(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

type decideNominationRequest struct {
	Decision string `json:"decision" binding:"required,oneof=accept decline withdraw"`
	Reason   string `json:"reason"`
}

func (h *Handler) DecideNomination(c *gin.Context) {
	estateID, _ := electionCtx(c)
	var req decideNominationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	n, err := h.svc.DecideNomination(c.Request.Context(), estateID, ginutil.UserID(c), c.Param("nominationId"), req.Decision, req.Reason)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, n)
}

type vetNominationRequest struct {
	Cleared bool   `json:"cleared"`
	Reason  string `json:"reason"`
}

func (h *Handler) VetNomination(c *gin.Context) {
	estateID, _ := electionCtx(c)
	var req vetNominationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	n, err := h.svc.VetNomination(c.Request.Context(), estateID, ginutil.UserID(c), c.Param("nominationId"), req.Cleared, req.Reason)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, n)
}

func (h *Handler) CertifyNomination(c *gin.Context) {
	estateID, _ := electionCtx(c)
	cand, err := h.svc.CertifyNomination(c.Request.Context(), estateID, ginutil.UserID(c), c.Param("nominationId"))
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, cand)
}

func (h *Handler) OpenElection(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	el, err := h.svc.OpenElection(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, el)
}

func (h *Handler) CloseElection(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	el, err := h.svc.CloseElection(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, el)
}

type cancelElectionRequest struct {
	Reason string `json:"reason" binding:"required,min=5"`
}

func (h *Handler) CancelElection(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req cancelElectionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	el, err := h.svc.CancelElection(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req.Reason)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, el)
}

func (h *Handler) TallyElection(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	out, err := h.svc.TallyElection(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) GetElectionOutcome(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	out, err := h.svc.GetOutcome(c.Request.Context(), estateID, electionID, ginutil.UserID(c))
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) GetElectionTurnout(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	out, err := h.svc.GetTurnout(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, out)
}

func (h *Handler) FileElectionComplaint(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req ComplaintRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	complaint, err := h.svc.FileElectionComplaint(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, complaint)
}

func (h *Handler) ListElectionComplaints(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	out, err := h.svc.ListElectionComplaints(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

func (h *Handler) ResolveElectionComplaint(c *gin.Context) {
	estateID, _ := electionCtx(c)
	var req resolveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{keyError: httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	complaint, err := h.svc.ResolveElectionComplaint(c.Request.Context(), estateID, ginutil.UserID(c), c.Param("complaintId"), req.Uphold, req.Resolution)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, complaint)
}

type recountRequest struct {
	ComplaintID string `json:"complaint_id"`
	Note        string `json:"note"`
}

func (h *Handler) RunElectionRecount(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	var req recountRequest
	// A recount can be ordered with no body at all: the admin just wants the aggregate
	// re-derived from the anonymous ballots.
	_ = c.ShouldBindJSON(&req)
	rc, err := h.svc.RunRecount(c.Request.Context(), estateID, ginutil.UserID(c), electionID, req.ComplaintID, req.Note)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusCreated, rc)
}

func (h *Handler) ListElectionRecounts(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	out, err := h.svc.ListRecounts(c.Request.Context(), estateID, ginutil.UserID(c), electionID)
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: out})
}

// GetMyElectionEligibility reports the caller's own standing, rules plus frozen roll
// (EST-UAT-0219). It answers "can I still vote" after a challenge or removal, and only
// ever about the caller.
func (h *Handler) GetMyElectionEligibility(c *gin.Context) {
	estateID, electionID := electionCtx(c)
	elig, err := h.svc.EligibilityOnRoll(c.Request.Context(), estateID, electionID, ginutil.UserID(c))
	if err != nil {
		writeElectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{keyData: elig})
}
