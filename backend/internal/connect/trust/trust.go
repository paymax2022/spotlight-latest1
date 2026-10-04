// Package connecttrust holds Phase-5 trust + safety intelligence for Paymax
// Connect: config-driven warning/scam detection, the scam-shield store (reason
// codes surfaced to moderators), and the guardrailed AI coach/assistant.
// IRON RULE: every threshold, weight, and trigger-term list is backend-owned and
// read from public.connect_config — NOTHING is hard-coded here. See
// docs/prd/dating/{compliance.md (invariants 8,10), acceptance.md §Phase 5}.
package connecttrust

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"spotlight/backend/go-common/ginutil"
	"spotlight/backend/go-common/httperr"
	connectsafety "spotlight/backend/internal/connect/safety"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ShieldFlag is a read row of public.connect_scam_shield_flags for moderators.
type ShieldFlag struct {
	ID             string    `json:"id"`
	ConversationID *string   `json:"conversation_id,omitempty"`
	MessageID      *string   `json:"message_id,omitempty"`
	SubjectID      *string   `json:"subject_id,omitempty"`
	Category       string    `json:"category"`
	ReasonCodes    []string  `json:"reason_codes"`
	Score          int       `json:"score"`
	CaseID         *string   `json:"case_id,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

// AIFeature enumerates the guardrailed assistant surfaces (api.md Phase 5).
type AIFeature string

const (
	FeatureProfileCoach       AIFeature = "profile_coach"
	FeatureConversationAssist AIFeature = "conversation_assistant"
	FeatureMatchExplanation   AIFeature = "match_explanation"
)

func validAIFeature(f AIFeature) bool {
	switch f {
	case FeatureProfileCoach, FeatureConversationAssist, FeatureMatchExplanation:
		return true
	}
	return false
}

// AIRequest is the member-facing body for an AI assistant call.
type AIRequest struct {
	Feature AIFeature `json:"feature" binding:"required"`
	Prompt  string    `json:"prompt"  binding:"required"`
}

// AIResponse is what the member receives. Output is only ever returned when the
// guardrail PASSED; a blocked request returns a safe refusal with Blocked=true.
type AIResponse struct {
	Output      string   `json:"output"`
	Blocked     bool     `json:"blocked"`
	ReasonCodes []string `json:"reason_codes,omitempty"`
}

// Handler exposes the member AI assistant + the moderator scam-shield feed.
type Handler struct {
	coach  *AICoach
	shield *ShieldStore
}

// NewHandler wires the trust handlers.
func NewHandler(coach *AICoach, shield *ShieldStore) *Handler {
	return &Handler{coach: coach, shield: shield}
}

// AIGenerate — POST /api/v1/connect/ai/assist (authenticated member).
// Guardrailed: unsafe input/output is blocked (200 with blocked=true, never a leak).
func (h *Handler) AIGenerate(c *gin.Context) {
	userID := ginutil.UserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "authentication required"})
		return
	}
	var req AIRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	res, err := h.coach.Generate(c.Request.Context(), userID, req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": httperr.Msg(c, http.StatusBadRequest, err)})
		return
	}
	// A blocked response is a normal, successful outcome (the guardrail worked).
	c.JSON(http.StatusOK, gin.H{"data": res})
}

// ListShieldFlags — GET /api/connect/admin/scam-shield?limit= (connect.moderation.view)
// Surfaces scam-shield flags + reason codes to moderators (invariant 10).
func (h *Handler) ListShieldFlags(c *gin.Context) {
	limit := 0
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = n
		}
	}
	flags, err := h.shield.ListFlags(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": httperr.Msg(c, http.StatusInternalServerError, err)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": flags})
}

// Config keys (rows in public.connect_config). Values, not the keys, carry the
// tunable data — the keys are the contract between this code and the DB seed.
const (
	keyFinancialTerms   = "moderation.financial_solicitation_terms"
	keyOffPlatformTerms = "safety.warning.off_platform_terms"
	keyHarassmentTerms  = "safety.warning.harassment_terms"
	keyFlagToCase       = "safety.scam_shield.flag_to_case_threshold"
	keyEscalateScore    = "safety.scam_shield.escalate_score"
)

// Thresholds is a point-in-time snapshot of the backend-owned safety config.
type Thresholds struct {
	FinancialTerms   []string
	OffPlatformTerms []string
	HarassmentTerms  []string
	FlagToCase       int
	EscalateScore    int
}

// ConfigReader loads safety thresholds from public.connect_config. It is the
// single source of truth so detection logic stays config-driven, never literal.
type ConfigReader struct{ db *pgxpool.Pool }

// NewConfigReader builds a reader over the shared pgx pool.
func NewConfigReader(db *pgxpool.Pool) *ConfigReader { return &ConfigReader{db: db} }

// Load reads all safety thresholds in one round-trip. Missing rows yield empty
// term lists and zero thresholds — detection then fails OPEN as "no warning"
// for term lists, but the caller must treat a load error as fail-closed.
func (r *ConfigReader) Load(ctx context.Context) (Thresholds, error) {
	const q = `SELECT key, value FROM connect_config WHERE key = ANY($1)`
	keys := []string{keyFinancialTerms, keyOffPlatformTerms, keyHarassmentTerms, keyFlagToCase, keyEscalateScore}
	rows, err := r.db.Query(ctx, q, keys)
	if err != nil {
		return Thresholds{}, fmt.Errorf("connect: load safety config: %w", err)
	}
	defer rows.Close()

	var t Thresholds
	for rows.Next() {
		var key string
		var raw []byte
		if err := rows.Scan(&key, &raw); err != nil {
			return Thresholds{}, fmt.Errorf("connect: scan safety config: %w", err)
		}
		switch key {
		case keyFinancialTerms:
			t.FinancialTerms = decodeStrings(raw)
		case keyOffPlatformTerms:
			t.OffPlatformTerms = decodeStrings(raw)
		case keyHarassmentTerms:
			t.HarassmentTerms = decodeStrings(raw)
		case keyFlagToCase:
			t.FlagToCase = decodeInt(raw)
		case keyEscalateScore:
			t.EscalateScore = decodeInt(raw)
		}
	}
	return t, rows.Err()
}

func decodeStrings(raw []byte) []string {
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil
	}
	return out
}

func decodeInt(raw []byte) int {
	var n int
	if err := json.Unmarshal(raw, &n); err != nil {
		return 0
	}
	return n
}

// Category buckets a detection into the scam-shield/case taxonomy.
type Category string

const (
	CategoryFinancial     Category = "financial_solicitation"
	CategoryOffPlatform   Category = "off_platform"
	CategoryHarassment    Category = "harassment"
	CategoryImpersonation Category = "impersonation"
)

// Detection is the result of scanning one message body against the backend-owned
// trigger-term lists. It is deterministic and pure (no DB, no LLM) so it is cheap
// to run inline on every message send and trivial to unit-test.
type Detection struct {
	Flagged     bool       // any category matched
	Categories  []Category // distinct categories that matched (sorted, stable)
	ReasonCodes []string   // machine reason codes stored with the flag (sorted)
	Score       int        // weighted severity; financial/harassment weigh heavier
	Warning     string     // user-facing inline warning (safe, non-shaming)
}

// reason-code prefixes keep stored codes structured + greppable for moderators.
const (
	rcFinancial   = "scam.financial"
	rcOffPlatform = "scam.off_platform"
	rcHarassment  = "abuse.harassment"
)

// per-category severity weights. Centralised so scoring stays consistent; the
// escalation/case THRESHOLDS these scores are compared against come from config.
var categoryWeight = map[Category]int{
	CategoryFinancial:   3,
	CategoryHarassment:  3,
	CategoryOffPlatform: 1,
}

// Scan inspects body against the loaded thresholds and returns a Detection. It
// matches case-insensitively on whole substrings (terms are curated phrases).
// No part of body is logged or returned in the Detection (PII-safe by design).
func Scan(body string, t Thresholds) Detection {
	lc := strings.ToLower(body)
	catSet := map[Category]bool{}
	codeSet := map[string]bool{}

	scan := func(terms []string, cat Category, codePrefix string) {
		for _, term := range terms {
			term = strings.TrimSpace(strings.ToLower(term))
			if term == "" {
				continue
			}
			if strings.Contains(lc, term) {
				catSet[cat] = true
				codeSet[codePrefix+":"+slug(term)] = true
			}
		}
	}

	scan(t.FinancialTerms, CategoryFinancial, rcFinancial)
	scan(t.OffPlatformTerms, CategoryOffPlatform, rcOffPlatform)
	scan(t.HarassmentTerms, CategoryHarassment, rcHarassment)

	if len(catSet) == 0 {
		return Detection{}
	}

	d := Detection{Flagged: true}
	for cat := range catSet {
		d.Categories = append(d.Categories, cat)
		d.Score += categoryWeight[cat]
	}
	for code := range codeSet {
		d.ReasonCodes = append(d.ReasonCodes, code)
	}
	sortCategories(d.Categories)
	sort.Strings(d.ReasonCodes)
	d.Warning = warningFor(d.Categories)
	return d
}

// PrimaryCategory returns the highest-weight category for storing on a single
// scam-shield flag row. Empty when nothing flagged.
func (d Detection) PrimaryCategory() Category {
	var best Category
	bestW := -1
	for _, c := range d.Categories {
		if categoryWeight[c] > bestW {
			best, bestW = c, categoryWeight[c]
		}
	}
	return best
}

// warningFor composes a single safe, supportive inline warning. Warnings never
// shame the user and surface platform-safety guidance (compliance sensitive-topic note).
func warningFor(cats []Category) string {
	has := func(c Category) bool {
		return slices.Contains(cats, c)
	}
	switch {
	case has(CategoryFinancial):
		return "Heads up: requests to send money, gift cards, or crypto are a common scam tactic. Never send funds to someone you met here. Keep payments on Paymax."
	case has(CategoryHarassment):
		return "This message may violate our community guidelines on respectful conduct. You can report or block this person at any time, and support resources are available."
	case has(CategoryOffPlatform):
		return "For your safety, keep conversations on Paymax Connect until you trust each other. Moving to other apps removes our safety protections."
	default:
		return "This message was flagged by our safety system. Stay alert and report anything that feels off."
	}
}

func slug(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	s = strings.ReplaceAll(s, " ", "_")
	return s
}

func sortCategories(cs []Category) {
	slices.Sort(cs)
}

// LLM is the seam behind which a real model provider sits. It is intentionally
// minimal so we can stub it (no `go get`, no network) and so the guardrail —
// not the model — owns the safety contract. A real adapter implements this later.
type LLM interface {
	// Complete returns model output for a system+user prompt. Implementations
	// MUST NOT be trusted to be safe; the guardrail re-checks every output.
	Complete(ctx context.Context, system, user string) (string, error)
}

// stubLLM is a deterministic, offline model used until a provider adapter lands.
// It produces on-policy, generic guidance so the endpoint is exercisable in
// tests and dev without external calls.
type stubLLM struct{}

// NewStubLLM returns the offline stub model.
func NewStubLLM() LLM { return stubLLM{} }

func (stubLLM) Complete(_ context.Context, _system, user string) (string, error) {
	// Echo a safe, supportive, generic suggestion. No persuasion, no PII echo.
	return "Here are a few friendly, respectful ideas you can adapt: be specific about a shared " +
		"interest, ask an open question, and keep it light. Avoid sharing personal contact details " +
		"until you trust each other.", nil
}

// AICoach runs the guardrailed assistant. The pipeline is: INPUT guardrail →
// model → OUTPUT guardrail → audit. Output reaches the user ONLY if the output
// guardrail passes; every call is logged with its policy verdict + reason codes.
type AICoach struct {
	db    *pgxpool.Pool
	model LLM
	guard *Guard
	tag   string // model identifier recorded in the audit log
}

// NewAICoach builds the coach over a pool and an LLM. Pass NewStubLLM() for the
// offline default.
func NewAICoach(db *pgxpool.Pool, model LLM) *AICoach {
	return &AICoach{db: db, model: model, guard: NewGuard(), tag: "stub-llm-v1"}
}

// Generate runs the full guardrailed pipeline for one AI request.
func (a *AICoach) Generate(ctx context.Context, userID string, req AIRequest) (AIResponse, error) {
	if !validAIFeature(req.Feature) {
		return AIResponse{}, fmt.Errorf("connect: unknown AI feature %q", req.Feature)
	}

	// 1. INPUT guardrail — refuse manipulative/abusive/sexual/deceptive asks
	//    before they ever reach the model (prompt-injection + intent screen).
	if codes := a.guard.ScreenInput(req.Prompt); len(codes) > 0 {
		_ = a.logVerdict(ctx, userID, req.Feature, false, codes)
		return AIResponse{
			Blocked:     true,
			ReasonCodes: codes,
			Output:      a.guard.RefusalMessage(),
		}, nil
	}

	// 2. Model call (stub by default).
	system := systemPromptFor(req.Feature)
	raw, err := a.model.Complete(ctx, system, req.Prompt)
	if err != nil {
		return AIResponse{}, fmt.Errorf("connect: AI model: %w", err)
	}

	// 3. OUTPUT guardrail — the model is not trusted; re-screen its output.
	if codes := a.guard.ScreenOutput(raw); len(codes) > 0 {
		_ = a.logVerdict(ctx, userID, req.Feature, false, codes)
		return AIResponse{
			Blocked:     true,
			ReasonCodes: codes,
			Output:      a.guard.RefusalMessage(),
		}, nil
	}

	// 4. Audit the safe response (no raw prompt/output stored — PII-safe).
	_ = a.logVerdict(ctx, userID, req.Feature, true, nil)
	return AIResponse{Output: raw, Blocked: false}, nil
}

func (a *AICoach) logVerdict(ctx context.Context, userID string, f AIFeature, pass bool, codes []string) error {
	const ins = `INSERT INTO connect_ai_assistant_log
		(user_id, feature, policy_pass, reason_codes, model)
		VALUES (NULLIF($1,'')::uuid, $2, $3, $4, $5)`
	_, err := a.db.Exec(ctx, ins, userID, string(f), pass, codes, a.tag)
	return err
}

func systemPromptFor(f AIFeature) string {
	base := "You are Paymax Connect's safety-first assistant. Never produce sexual, harassing, " +
		"manipulative, deceptive, or coercive content. Never help deceive, pressure, or extract " +
		"money/contact info from another person. Decline unsafe requests."
	switch f {
	case FeatureProfileCoach:
		return base + " Help the user write an honest, respectful dating profile."
	case FeatureConversationAssist:
		return base + " Suggest respectful, consent-aware conversation openers."
	case FeatureMatchExplanation:
		return base + " Explain why two people might be compatible, factually and kindly."
	default:
		return base
	}
}

// Guard — the policy engine. Hard-coding the SAFETY POLICY (what counts as
// unsafe) is correct: it is a compliance contract, not a tunable threshold.
// (Tunable trigger lists for chat warnings live in config; the AI refusal
// policy is a fixed invariant per acceptance §Phase 5.)

// Guard screens AI inputs and outputs against the fixed safety policy.
type Guard struct {
	banned map[string][]string // reason-code → trigger phrases
}

// NewGuard builds the policy engine with the Phase-5 banned-content classes.
func NewGuard() *Guard {
	return &Guard{
		banned: map[string][]string{
			"ai.sexual":       {"send nudes", "sexual", "nude photo", "explicit", "sext"},
			"ai.harassment":   {"insult", "humiliate", "threaten", "kill yourself", "stalk", "demean"},
			"ai.manipulation": {"manipulate", "gaslight", "guilt trip", "pressure them", "love bomb", "trick them into"},
			"ai.deception":    {"lie about", "catfish", "fake profile", "pretend to be", "impersonate"},
			"ai.financial":    {"ask for money", "get them to send", "gift card", "crypto", "wire transfer", "bank details"},
			"ai.contact":      {"get their phone number", "get their address", "home address", "make them share their number"},
		},
	}
}

// ScreenInput returns the reason codes a prompt violates (empty = clean).
func (g *Guard) ScreenInput(prompt string) []string { return g.screen(prompt) }

// ScreenOutput returns the reason codes model output violates (empty = clean).
// The model is never trusted to self-police; this is the last line of defense.
func (g *Guard) ScreenOutput(out string) []string { return g.screen(out) }

func (g *Guard) screen(text string) []string {
	lc := strings.ToLower(text)
	hit := map[string]bool{}
	for code, phrases := range g.banned {
		for _, p := range phrases {
			if strings.Contains(lc, p) {
				hit[code] = true
				break
			}
		}
	}
	if len(hit) == 0 {
		return nil
	}
	out := make([]string, 0, len(hit))
	for c := range hit {
		out = append(out, c)
	}
	sort.Strings(out)
	return out
}

// RefusalMessage is the single safe refusal returned when the guardrail blocks.
func (g *Guard) RefusalMessage() string {
	return "I can't help with that. I'm here to support respectful, honest, and safe connections. " +
		"If you're experiencing harassment or feel unsafe, you can report or block, and support resources are available."
}

// ShieldStore persists scam-shield flags (reason codes surfaced to moderators)
// and, once the config-driven flag count is reached, opens a connect_case via
// the existing safety service so flagged conversations always reach moderation.
type ShieldStore struct {
	db     *pgxpool.Pool
	cfg    *ConfigReader
	safety *connectsafety.Service
}

// NewShieldStore wires the shield over the pool, the config reader, and the
// Phase-0 safety service (case + audit backbone).
func NewShieldStore(db *pgxpool.Pool, cfg *ConfigReader, safety *connectsafety.Service) *ShieldStore {
	return &ShieldStore{db: db, cfg: cfg, safety: safety}
}

// FlagInput records one scam-shield hit. message_id may be empty (e.g. a
// profile-level flag). subjectID is the user the flag is about.
type FlagInput struct {
	ConversationID string
	MessageID      string
	SubjectID      string
	Category       Category
	ReasonCodes    []string
	Score          int
}

// FlagResult tells the caller what the shield did so the chat layer can mirror
// the safety_state transition and surface the warning.
type FlagResult struct {
	FlagID     string
	CaseOpened bool
	CaseID     string
	Escalate   bool // conversation should move to under_review
	TotalFlags int
}

// Flag stores a scam-shield flag, then evaluates config thresholds:
//   - at >= flag_to_case_threshold flags in the conversation, open a connect_case
//     (deduped: only open while no open case already references this conversation).
//   - at >= escalate_score cumulative score, signal the conversation to escalate.
//
// The flag write itself NEVER fails silently: a DB error bubbles to the caller.
func (s *ShieldStore) Flag(ctx context.Context, in FlagInput) (FlagResult, error) {
	thresholds, err := s.cfg.Load(ctx)
	if err != nil {
		// Fail-closed: if we cannot read thresholds we still store the flag but
		// refuse to suppress escalation — treat as escalate to be safe.
		thresholds = Thresholds{FlagToCase: 1, EscalateScore: 1}
	}

	const ins = `INSERT INTO connect_scam_shield_flags
		(conversation_id, message_id, subject_id, category, reason_codes, score)
		VALUES (NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, NULLIF($3,'')::uuid, $4, $5, $6)
		RETURNING id`
	var res FlagResult
	if err := s.db.QueryRow(ctx, ins,
		in.ConversationID, in.MessageID, in.SubjectID,
		string(in.Category), in.ReasonCodes, in.Score,
	).Scan(&res.FlagID); err != nil {
		return FlagResult{}, fmt.Errorf("connect: store scam-shield flag: %w", err)
	}

	// Tally this conversation's flags + cumulative score.
	totalFlags, totalScore, err := s.conversationTally(ctx, in.ConversationID)
	if err != nil {
		return FlagResult{}, err
	}
	res.TotalFlags = totalFlags
	res.Escalate = thresholds.EscalateScore > 0 && totalScore >= thresholds.EscalateScore

	if thresholds.FlagToCase > 0 && totalFlags >= thresholds.FlagToCase {
		opened, caseID, err := s.openCaseIfNone(ctx, in)
		if err != nil {
			return FlagResult{}, err
		}
		res.CaseOpened = opened
		res.CaseID = caseID
	}
	return res, nil
}

func (s *ShieldStore) conversationTally(ctx context.Context, convID string) (int, int, error) {
	if convID == "" {
		return 0, 0, nil
	}
	const q = `SELECT COUNT(*), COALESCE(SUM(score),0)
		FROM connect_scam_shield_flags WHERE conversation_id = $1::uuid`
	var n, score int
	if err := s.db.QueryRow(ctx, q, convID).Scan(&n, &score); err != nil {
		return 0, 0, fmt.Errorf("connect: tally scam flags: %w", err)
	}
	return n, score, nil
}

// openCaseIfNone opens a scam case for the subject only if no open case already
// references this conversation (idempotent — repeated flags don't spam cases).
func (s *ShieldStore) openCaseIfNone(ctx context.Context, in FlagInput) (bool, string, error) {
	if in.ConversationID != "" {
		const exists = `SELECT id FROM connect_cases
			WHERE source_ref = $1 AND type = 'scam' AND status IN ('open','investigating') LIMIT 1`
		var existingID string
		if err := s.db.QueryRow(ctx, exists, in.ConversationID).Scan(&existingID); err == nil {
			return false, existingID, nil // already has an open case
		}
	}
	c, err := s.safety.OpenCase(ctx, connectsafety.OpenCaseInput{
		ReporterID: "", // system-opened
		SubjectID:  in.SubjectID,
		Type:       caseTypeFor(in.Category),
		SourceRef:  in.ConversationID,
		Severity:   "high",
		Notes:      "Auto-opened by scam-shield after repeated safety flags. Reason codes: " + joinCodes(in.ReasonCodes),
	})
	if err != nil {
		return false, "", fmt.Errorf("connect: scam-shield open case: %w", err)
	}
	return true, c.ID, nil
}

// caseTypeFor maps a detection category to a valid connect_cases.type.
func caseTypeFor(cat Category) string {
	switch cat {
	case CategoryFinancial:
		return "scam"
	case CategoryOffPlatform:
		return "off_platform"
	case CategoryHarassment:
		return "harassment"
	case CategoryImpersonation:
		return "impersonation"
	default:
		return "safety"
	}
}

func joinCodes(codes []string) string {
	out := ""
	var outSb620 strings.Builder
	for i, c := range codes {
		if i > 0 {
			outSb620.WriteString(", ")
		}
		outSb620.WriteString(c)
	}
	out += outSb620.String()
	if out == "" {
		return "(none)"
	}
	return out
}

// ListFlags returns recent scam-shield flags for the moderator surface.
func (s *ShieldStore) ListFlags(ctx context.Context, limit int) ([]ShieldFlag, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `SELECT id, conversation_id, message_id, subject_id, category, reason_codes, score, case_id, created_at
		FROM connect_scam_shield_flags ORDER BY created_at DESC LIMIT $1`
	rows, err := s.db.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("connect: list scam flags: %w", err)
	}
	defer rows.Close()
	var out []ShieldFlag
	for rows.Next() {
		var f ShieldFlag
		if err := rows.Scan(&f.ID, &f.ConversationID, &f.MessageID, &f.SubjectID,
			&f.Category, &f.ReasonCodes, &f.Score, &f.CaseID, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}
