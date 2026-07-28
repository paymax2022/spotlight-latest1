package connecttrust

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

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

// ──────────────────────────────────────────────────────────────────────────
// Guard — the policy engine. Hard-coding the SAFETY POLICY (what counts as
// unsafe) is correct: it is a compliance contract, not a tunable threshold.
// (Tunable trigger lists for chat warnings live in config; the AI refusal
// policy is a fixed invariant per acceptance §Phase 5.)
// ──────────────────────────────────────────────────────────────────────────

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
