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
	"time"

	"github.com/gin-gonic/gin"

	"spotlight/backend/internal/arena"
	"spotlight/backend/internal/arena/quiz"
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
	Quiz        *quiz.Service
	QuizRepo    *quiz.Repository
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
		"pot_total_kobo":   total,
		"peoples_champion": pc,
		"champion_tally":   ct,
		"state_pride":      sp,
		"state_tally":      st,
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

// PlayAlongQuestions: GET /api/arena/competitions/:id/playalong/questions?stage={1|2|3}
// Contestant-safe stage envelope (NO correct index / answer / explanation).
func (h *Handler) PlayAlongQuestions(c *gin.Context) {
	stage, err := strconv.Atoi(c.DefaultQuery("stage", "1"))
	if err != nil || stage < 1 || stage > 3 {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	sv, err := h.s.Quiz.StageView(c.Request.Context(), c.Param("id"),
		quiz.DefaultBankKey, quiz.DefaultRubricVersion, stage)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, sv)
}

// PlayAlongAttempt: POST /api/arena/competitions/:id/playalong/attempt (Idempotency-Key required)
// The SERVER scores: body {stage, answers:[{questionId, optionId}]}. Returns the
// score/total/passed + the per-question teaching reveal + credential/cashback
// merged from the engagement rail (NDC-1 — never merit).
func (h *Handler) PlayAlongAttempt(c *gin.Context) {
	if idemKey(c) == "" {
		mapErr(c, service.ErrMissingIdem)
		return
	}
	var body struct {
		Stage   int           `json:"stage"`
		Answers []quiz.Answer `json:"answers"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	if body.Stage < 1 || body.Stage > 3 {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	res, err := h.s.Quiz.ScorePlayAlong(c.Request.Context(), c.Param("id"),
		quiz.DefaultBankKey, quiz.DefaultRubricVersion, ctxUserID(c), body.Stage, body.Answers, idemKey(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, res)
}

// MyExam: GET /api/arena/competitions/:id/me/exam
// Gated to the caller's contestant state THEORY_ASSIGNED. Returns the assigned
// batch + contestant-safe stage questions; 409 (ErrConflict) if not assigned.
func (h *Handler) MyExam(c *gin.Context) {
	sv, batch, err := h.s.Quiz.ExamStage(c.Request.Context(), c.Param("id"), ctxUserID(c),
		quiz.DefaultBankKey, quiz.DefaultRubricVersion)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"batch":         batch,
		"stage":         sv.StageNumber,
		"timeLimitSecs": sv.TimeLimitSecs,
		"questions":     sv.Questions,
	})
}

// SubmitExam: POST /api/arena/competitions/:id/me/exam/submit (Idempotency-Key required)
// body {answers:[{questionId,optionId}], responseTimeMs?}. Records the append-only
// exam attempt and performs the guarded THEORY_ASSIGNED → THEORY_TAKEN transition.
// Mints NO merit (NDC-2). Single attempt per (contestant, batch) — idempotent.
func (h *Handler) SubmitExam(c *gin.Context) {
	if idemKey(c) == "" {
		mapErr(c, service.ErrMissingIdem)
		return
	}
	var body struct {
		Answers        []quiz.Answer `json:"answers"`
		ResponseTimeMs int64         `json:"responseTimeMs"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		mapErr(c, service.ErrInvalidInput)
		return
	}
	res, err := h.s.Quiz.SubmitExam(c.Request.Context(), c.Param("id"), ctxUserID(c),
		quiz.DefaultBankKey, quiz.DefaultRubricVersion, body.Answers, body.ResponseTimeMs, idemKey(c))
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": res.OK, "state": res.State, "submittedAt": time.Now().UTC()})
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
//
// NDC-2 correctness: the raw score is sourced from the contestant's STORED
// arena_quiz_attempt (score/total) for the attested (contestant, stage) whenever
// the request omits an explicit raw["score"]. The proctor remains the signing
// authority — they call this endpoint and their attestation (proctor_id,
// webcam_ok, …) is folded into the signed canonical payload. An explicit raw in
// the body still overrides (e.g. paper-based or corrective scoring).
func (h *Handler) ProctorAttest(c *gin.Context) {
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
	raw := body.Raw
	// Source the score from the stored exam attempt when not supplied explicitly.
	if _, hasScore := raw["score"]; !hasScore && h.s.QuizRepo != nil {
		if st := quizStageForMeritStage(arena.Stage(body.Stage)); st != 0 {
			att, ok, qerr := h.s.QuizRepo.GetAttempt(c.Request.Context(), c.Param("id"), body.ContestantID, st)
			if qerr != nil {
				mapErr(c, qerr)
				return
			}
			if !ok {
				// No exam attempt on file for this contestant/stage — cannot attest.
				mapErr(c, service.ErrNotFound)
				return
			}
			if raw == nil {
				raw = map[string]float64{}
			}
			raw["score"] = float64(att.Score)
			raw["max"] = float64(att.Total)
		}
	}
	entry, err := h.s.Scoring.Submit(c.Request.Context(), ctxUserID(c), service.ScoreInput{
		CompetitionID: c.Param("id"),
		ContestantID:  body.ContestantID,
		Stage:         arena.Stage(body.Stage),
		RubricVersion: body.RubricVersion,
		Raw:           raw,
		Attestation:   body.Attestation,
		AdapterID:     body.AdapterID,
	})
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"entry_hash": entryHashHex(entry), "normalized_score": entry.Payload.NormalizedScore})
}

// quizStageForMeritStage maps a Merit theory stage to the quiz bank stage number
// (1/2/3). Non-theory stages → 0 (no stored-attempt lookup).
func quizStageForMeritStage(stage arena.Stage) int {
	switch stage {
	case arena.StageTheoryB1:
		return 1
	case arena.StageTheoryB2:
		return 2
	case arena.StageTheoryB3:
		return 3
	default:
		return 0
	}
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

// ── ADMIN: QUIZ BANK (perm arena.admin.questions) ─────────────────────────────

// ImportQuestions: POST /api/arena/admin/competitions/:id/questions/import
// Binds/loads the quiz bank to the competition (idempotent). body {bankKey?,
// rubricVersion?} defaults to the seeded Naija bank.
func (h *Handler) ImportQuestions(c *gin.Context) {
	var body struct {
		BankKey       string `json:"bankKey"`
		RubricVersion string `json:"rubricVersion"`
	}
	_ = c.ShouldBindJSON(&body)
	bankKey := body.BankKey
	if bankKey == "" {
		bankKey = quiz.DefaultBankKey
	}
	rubricVersion := body.RubricVersion
	if rubricVersion == "" {
		rubricVersion = quiz.DefaultRubricVersion
	}
	imported, stages, err := h.s.Quiz.Import(c.Request.Context(), c.Param("id"), bankKey, rubricVersion)
	if err != nil {
		mapErr(c, err)
		return
	}
	out := make([]gin.H, 0, len(stages))
	for _, st := range stages {
		out = append(out, gin.H{"stage": st.Stage, "count": st.QuestionCount})
	}
	c.JSON(http.StatusOK, gin.H{"imported": imported, "stages": out})
}

// ListQuestions: GET /api/arena/admin/competitions/:id/questions?stage=&category=
// FULL admin view WITH correct_index / correct_answer / explanation + counts.
func (h *Handler) ListQuestions(c *gin.Context) {
	stage, _ := strconv.Atoi(c.DefaultQuery("stage", "0"))
	category := c.Query("category")
	qs, err := h.s.Quiz.AdminList(c.Request.Context(), c.Param("id"), stage, category)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"questions": qs, "count": len(qs), "counts": quiz.CountQuestions(qs)})
}

// QuestionStats: GET /api/arena/admin/competitions/:id/questions/stats
func (h *Handler) QuestionStats(c *gin.Context) {
	perStage, total, err := h.s.Quiz.Stats(c.Request.Context(), c.Param("id"),
		quiz.DefaultBankKey, quiz.DefaultRubricVersion)
	if err != nil {
		mapErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"perStage": perStage, "totalQuestions": total})
}
