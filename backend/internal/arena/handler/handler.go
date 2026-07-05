// Package handler exposes the Arena HTTP surface (public / member / admin). It is
// a thin transport layer over arena/service — no business logic, no DB. The merit
// firewall lives BELOW this layer: only ScoringService (holding the signer
// gateway) can write merit; the money/engagement handlers reach only the
// LedgerPort-backed rails.
package handler

import (
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/service"
)

// entryHashHex hex-encodes a signed entry's hash for the response.
func entryHashHex(e arena.SignedMeritEntry) string { return hex.EncodeToString(e.EntryHash) }

// Services bundles the constructed Arena services the handler dispatches to.
type Services struct {
	Competition *service.CompetitionService
	Contestant  *service.ContestantService
	Screening   *service.ScreeningService
	Scoring     *service.ScoringService
	Merit       *service.MeritService
	Support     *service.SupportService
	PlayAlong   *service.PlayAlongService
	Prediction  *service.PredictionService
	Credential  *service.CredentialService
	Pot         *service.PotDisbursementService
}

// Handler serves the Arena endpoints.
type Handler struct{ s Services }

// New builds the Arena handler.
func New(s Services) *Handler { return &Handler{s: s} }

func ctxUserID(c *gin.Context) string { return c.GetString("user_id") }

// mapErr maps Arena sentinel errors to HTTP status codes.
func mapErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrForbidden):
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
	case errors.Is(err, service.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrConflict), errors.Is(err, service.ErrReplay):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrKYCTierTooLow):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error(), "code": "KYC_TIER_TOO_LOW"})
	case errors.Is(err, service.ErrUnauthorizedSig):
		c.JSON(http.StatusForbidden, gin.H{"error": err.Error(), "code": "MERIT_SIG_UNAUTHORIZED"})
	case errors.Is(err, service.ErrMissingIdem):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "code": "IDEMPOTENCY_KEY_REQUIRED"})
	case errors.Is(err, service.ErrBadState):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "BAD_STATE"})
	case errors.Is(err, service.ErrPotState):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error(), "code": "POT_STATE"})
	case errors.Is(err, service.ErrRateLimited):
		c.JSON(http.StatusTooManyRequests, gin.H{"error": err.Error()})
	case errors.Is(err, service.ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

// idemKey extracts the required Idempotency-Key header (empty → handler errors).
func idemKey(c *gin.Context) string { return c.GetHeader("Idempotency-Key") }

// ── PUBLIC ───────────────────────────────────────────────────────────────────

// ListCompetitions: GET /api/arena/competitions
func (h *Handler) ListCompetitions(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	items, err := h.s.Competition.List(c.Request.Context(), limit, offset)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"competitions": items})
}

// GetCompetition: GET /api/arena/competitions/:id
func (h *Handler) GetCompetition(c *gin.Context) {
	comp, err := h.s.Competition.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, comp)
}

// MeritLeaderboard: GET /api/arena/competitions/:id/leaderboard/merit
func (h *Handler) MeritLeaderboard(c *gin.Context) {
	stage := arena.Stage(c.DefaultQuery("stage", string(arena.StageFinalePractical)))
	rows, err := h.s.Merit.Leaderboard(c.Request.Context(), c.Param("id"), stage)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"stage": stage, "ranking": service.RankMerit(rows), "rows": rows})
}

// Pot: GET /api/arena/competitions/:id/pot  (derived total + display tallies)
func (h *Handler) Pot(c *gin.Context) {
	id := c.Param("id")
	total, err := h.s.Support.PotTotal(c.Request.Context(), id)
	if err != nil {
		mapErr(c, err)
		return
	}
	pc, ct, sp, st, err := h.s.Support.Tallies(c.Request.Context(), id)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"pot_total_kobo":    total,
		"peoples_champion":  pc,
		"champion_tally":    ct,
		"state_pride":       sp,
		"state_tally":       st,
	})
}

// VerifyCredential: GET /api/arena/credentials/:hash/verify (public)
func (h *Handler) VerifyCredential(c *gin.Context) {
	cred, err := h.s.Credential.VerifyByHash(c.Request.Context(), c.Param("hash"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"valid": cred.Status == "ACTIVE", "credential": cred})
}

// ── MEMBER ───────────────────────────────────────────────────────────────────

// Apply: POST /api/arena/competitions/:id/applications
func (h *Handler) Apply(c *gin.Context) {
	var body struct {
		HomeState string `json:"home_state"`
	}
	_ = c.ShouldBindJSON(&body)
	ct, err := h.s.Contestant.Apply(c.Request.Context(), ctxUserID(c), c.Param("id"), body.HomeState)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, ct)
}

// Me: GET /api/arena/competitions/:id/me
func (h *Handler) Me(c *gin.Context) {
	ct, err := h.s.Contestant.Me(c.Request.Context(), c.Param("id"), ctxUserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, ct)
}

// MyMerit: GET /api/arena/competitions/:id/me/merit
func (h *Handler) MyMerit(c *gin.Context) {
	ct, err := h.s.Contestant.Me(c.Request.Context(), c.Param("id"), ctxUserID(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	rows, err := h.s.Merit.ContestantMerit(c.Request.Context(), c.Param("id"), ct.ID)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"merit": rows})
}

// Support: POST /api/arena/competitions/:id/support (Idempotency-Key required)
func (h *Handler) Support(c *gin.Context) {
	if idemKey(c) == "" {
		mapErr(c, service.ErrMissingIdem)
		return
	}
	var body struct {
		ContestantID string `json:"contestant_id" binding:"required"`
		AmountKobo   int64  `json:"amount_kobo" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	err := h.s.Support.Contribute(c.Request.Context(), ctxUserID(c), idemKey(c),
		c.Param("id"), body.ContestantID, body.AmountKobo)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// PlayAlongAttempt: POST /api/arena/competitions/:id/playalong/attempt (Idempotency-Key required)
func (h *Handler) PlayAlongAttempt(c *gin.Context) {
	if idemKey(c) == "" {
		mapErr(c, service.ErrMissingIdem)
		return
	}
	var body service.AttemptPayload
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	res, err := h.s.PlayAlong.Attempt(c.Request.Context(), ctxUserID(c), idemKey(c), c.Param("id"), body)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// Prediction: POST /api/arena/competitions/:id/predictions (Idempotency-Key required)
func (h *Handler) Prediction(c *gin.Context) {
	if idemKey(c) == "" {
		mapErr(c, service.ErrMissingIdem)
		return
	}
	var body service.PredictionPayload
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	total, dup, err := h.s.Prediction.Submit(c.Request.Context(), ctxUserID(c), idemKey(c), c.Param("id"), body)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"total_points": total, "duplicate": dup})
}

// ── ADMIN ────────────────────────────────────────────────────────────────────

// CreateCompetition: POST /api/arena/admin/competitions
func (h *Handler) CreateCompetition(c *gin.Context) {
	var body struct {
		Slug     string `json:"slug" binding:"required"`
		Name     string `json:"name" binding:"required"`
		Timezone string `json:"timezone"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	comp, err := h.s.Competition.Create(c.Request.Context(), ctxUserID(c), body.Slug, body.Name, body.Timezone)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, comp)
}

// PublishConfig: POST /api/arena/admin/competitions/:id/config/publish
func (h *Handler) PublishConfig(c *gin.Context) {
	var cfg service.Config
	if err := c.ShouldBindJSON(&cfg); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	cfg.CompetitionID = c.Param("id")
	version, err := h.s.Competition.PublishConfig(c.Request.Context(), ctxUserID(c), c.Param("id"), cfg)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"version": version})
}

// ScreeningQueue: GET /api/arena/admin/competitions/:id/screening
func (h *Handler) ScreeningQueue(c *gin.Context) {
	items, err := h.s.Screening.Queue(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"queue": items})
}

// ScreeningDecide: POST /api/arena/admin/competitions/:id/screening/:cid/decide
func (h *Handler) ScreeningDecide(c *gin.Context) {
	var body struct {
		Approve bool   `json:"approve"`
		Reason  string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	err := h.s.Screening.Decide(c.Request.Context(), ctxUserID(c), c.Param("id"), c.Param("cid"), body.Approve, body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ProctorAttest: POST /api/arena/admin/competitions/:id/proctor/attest
// Routes a signed theory/screening score through ScoringService (the ONLY merit
// write path). The proctor's attestation is folded into the signed payload.
func (h *Handler) ProctorAttest(c *gin.Context) {
	h.submitScore(c)
}

// JudgeScore: POST /api/arena/admin/competitions/:id/judge/score
// Routes a signed practical/first-aid score through ScoringService.
func (h *Handler) JudgeScore(c *gin.Context) {
	h.submitScore(c)
}

// submitScore is the shared merit-write handler for proctor + judge endpoints.
func (h *Handler) submitScore(c *gin.Context) {
	var body struct {
		ContestantID  string             `json:"contestant_id" binding:"required"`
		Stage         string             `json:"stage" binding:"required"`
		RubricVersion string             `json:"rubric_version"`
		AdapterID     string             `json:"adapter_id"`
		Raw           map[string]float64 `json:"raw"`
		Attestation   map[string]string  `json:"attestation"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	entry, err := h.s.Scoring.Submit(c.Request.Context(), ctxUserID(c), service.ScoreInput{
		CompetitionID: c.Param("id"),
		ContestantID:  body.ContestantID,
		Stage:         arena.Stage(body.Stage),
		RubricVersion: body.RubricVersion,
		Raw:           body.Raw,
		Attestation:   body.Attestation,
		AdapterID:     body.AdapterID,
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"entry_hash": entryHashHex(entry), "normalized_score": entry.Payload.NormalizedScore})
}

// Transition: POST /api/arena/admin/competitions/:id/transitions/:cid
func (h *Handler) Transition(c *gin.Context) {
	var body struct {
		To     string `json:"to" binding:"required"`
		Reason string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	err := h.s.Contestant.Transition(c.Request.Context(), ctxUserID(c), c.Param("id"), c.Param("cid"),
		arena.ContestantState(body.To), body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "to": body.To})
}

// AuditMerit: GET /api/arena/admin/competitions/:id/merit  (auditor read)
func (h *Handler) AuditMerit(c *gin.Context) {
	rows, err := h.s.Merit.CompetitionMerit(c.Request.Context(), c.Param("id"))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"merit": rows})
}

// FinalizeAward: POST /api/arena/admin/competitions/:id/awards/finalize
// Crowns the merit leader via a guarded CROWNED transition (award + credential +
// pot trigger run atomically). The winner is computed from merit ONLY.
func (h *Handler) FinalizeAward(c *gin.Context) {
	var body struct {
		ContestantID string `json:"contestant_id" binding:"required"`
		Reason       string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	err := h.s.Contestant.Transition(c.Request.Context(), ctxUserID(c), c.Param("id"), body.ContestantID,
		arena.StCrowned, body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "crowned": body.ContestantID})
}

// PotDisburse: POST /api/arena/admin/competitions/:id/pot/disburse (Idempotency-Key required)
func (h *Handler) PotDisburse(c *gin.Context) {
	if idemKey(c) == "" {
		mapErr(c, service.ErrMissingIdem)
		return
	}
	var body struct {
		WinnerUserID string `json:"winner_user_id" binding:"required"`
		Approve      bool   `json:"approve"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	ctx := c.Request.Context()
	// An approve flag records this admin's distinct approval first (NDC-4).
	if body.Approve {
		if _, err := h.s.Pot.Approve(ctx, ctxUserID(c), c.Param("id")); err != nil {
			mapErr(c, err)
			return
		}
	}
	if err := h.s.Pot.Disburse(ctx, ctxUserID(c), idemKey(c), c.Param("id"), body.WinnerUserID); err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// IssueCredential: POST /api/arena/admin/competitions/:id/credentials/issue
func (h *Handler) IssueCredential(c *gin.Context) {
	var body struct {
		UserID   string `json:"user_id" binding:"required"`
		Type     string `json:"type" binding:"required"`
		MeritRef string `json:"merit_ref"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	hash, err := h.s.Credential.Issue(c.Request.Context(), ctxUserID(c), body.UserID, c.Param("id"), body.Type, body.MeritRef)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"verifiable_hash": hash})
}

// RevokeCredential: POST /api/arena/admin/competitions/:id/credentials/:cid/revoke
// :cid is the credential's verifiable hash.
func (h *Handler) RevokeCredential(c *gin.Context) {
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)
	err := h.s.Credential.Revoke(c.Request.Context(), ctxUserID(c), c.Param("cid"), body.Reason)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
