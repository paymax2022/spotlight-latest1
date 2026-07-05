package investai

import (
	"context"
	"regexp"
	"strings"

	"spotlight/backend/internal/aicare"
)

// AIProvider is the minimal reply backend the InvestAI service depends on. It is
// deliberately narrow so the same interface can be satisfied by the real Anthropic
// provider (reused from internal/aicare) or a deterministic mock.
type AIProvider interface {
	// Reply returns the assistant's answer text for userMessage, given prior
	// history (oldest-first). Implementations MUST stay educational.
	Reply(ctx context.Context, history []ChatMessage, userMessage string) (string, error)
}

// systemPrompt pins the assistant to education-only behaviour. The guardrail is
// enforced twice: here (so a real LLM stays in-lane) and again in the service via
// isAdviceSeeking (so advice-seeking prompts are refused before the model runs).
const systemPrompt = "You are Paymax's investment EDUCATION assistant. You explain how " +
	"investing works in plain, neutral terms — volatility, diversification, fees, " +
	"settlement, risk, orders/quotes, and what stocks or cryptocurrencies are. " +
	"HARD RULES you never break: you do NOT recommend specific assets; you do NOT " +
	"tell anyone what to buy, sell, or hold; you do NOT predict prices or price " +
	"direction; you do NOT promise or guarantee returns. If asked for any of those, " +
	"politely decline and redirect to an educational topic. Be concise and factual, " +
	"and never present education as a personalized recommendation."

// anthropicAdapter wraps aicare's AnthropicProvider so it satisfies the local
// AIProvider interface. It maps investai messages onto aicare.Message and delegates
// to the existing, tested HTTP client. The aicare provider's own system prompt is
// support-oriented, so we prepend our education guardrail to the user turn to keep
// behaviour on-topic without modifying the aicare package.
type anthropicAdapter struct {
	inner *aicare.AnthropicProvider
}

func (a *anthropicAdapter) Reply(ctx context.Context, history []ChatMessage, userMessage string) (string, error) {
	h := make([]aicare.Message, 0, len(history))
	for _, m := range history {
		role := aicare.RoleUser
		if m.Role == RoleAssistant {
			role = aicare.RoleAI
		}
		h = append(h, aicare.Message{Role: role, Content: m.Text})
	}
	// Prepend the education guardrail to the live turn; the aicare provider does
	// not expose a system-prompt override, so we inline the policy instead.
	framed := systemPrompt + "\n\nUser question (answer as education only): " + userMessage
	return a.inner.Reply(ctx, h, framed)
}

// NewProvider returns the real Anthropic-backed provider when an API key is
// present, otherwise the deterministic mock. Callers pass cfg.AnthropicAPIKey.
func NewProvider(apiKey string) AIProvider {
	if strings.TrimSpace(apiKey) != "" {
		return &anthropicAdapter{inner: aicare.NewAnthropicProvider(apiKey)}
	}
	return &MockProvider{}
}

// ─── Deterministic mock provider ──────────────────────────────────────────────
// Mirrors the client-side mock engine (mobile ai.mock.ts) so behaviour is
// identical whether the key is present or not. Advice-seeking is handled upstream
// in the service; the mock only produces educational topic answers here.

type mockTopic struct {
	keys   *regexp.Regexp
	answer string
}

var mockTopics = []mockTopic{
	{regexp.MustCompile(`(?i)\bvolatil`),
		"Volatility describes how much an asset's price moves over time. A highly volatile " +
			"asset can swing sharply up or down within a single day, while a less volatile one " +
			"moves more gradually. Volatility measures price movement, not direction — it tells " +
			"you nothing about whether a price will rise or fall. Higher volatility generally " +
			"means a wider range of possible outcomes, which is one way people think about risk."},
	{regexp.MustCompile(`(?i)\bdiversif`),
		"Diversification means spreading money across different assets so no single one " +
			"determines your whole outcome. Different holdings often behave differently, so a " +
			"fall in one may be cushioned by others. Diversification can reduce the impact of " +
			"any one asset, but it does not remove risk and cannot guarantee a gain or prevent a loss."},
	{regexp.MustCompile(`(?i)\bfee|\bspread|\bcost\b|\bcharge`),
		"Investing usually involves several kinds of cost: a platform or transaction fee, a " +
			"spread (the gap between buy and sell prices), and — for crypto — a network fee to " +
			"move assets on-chain. Fees reduce your net return, so it helps to understand them " +
			"before you trade. In Paymax, fees are itemised on the quote screen before you confirm."},
	{regexp.MustCompile(`(?i)\bsettle|\bsettlement|\bclear`),
		"Settlement is the process of finalising a trade — moving the asset to the buyer and the " +
			"money to the seller so ownership officially changes hands. Different markets settle on " +
			"different timelines: some assets settle almost instantly, while traditional securities " +
			"may take a day or two. Until a trade settles, the transfer is agreed but not complete."},
	{regexp.MustCompile(`(?i)\bstocks?\b|\bshare(s)?\b|\bequit`),
		"A stock (or share) represents partial ownership in a company. If you own a share, you own " +
			"a small slice of that business and may benefit if it grows, while bearing the risk that " +
			"its value falls. Share prices move with company performance, the wider economy, and " +
			"investor sentiment. Owning shares is not a deposit and there is no guaranteed return."},
	{regexp.MustCompile(`(?i)\bcrypto|\bbitcoin\b|\bblockchain|\btoken\b|\bcoin(s)?\b`),
		"A cryptocurrency is a digital asset that records ownership on a blockchain — a shared, " +
			"decentralised ledger — rather than at a bank. Some, like Bitcoin, are used as a store of " +
			"value; others power applications or aim to track a currency (stablecoins). Crypto can be " +
			"highly volatile and is not a bank deposit, so it is not covered by deposit protection."},
	{regexp.MustCompile(`(?i)\brisk|\blose|\bloss|\bsafe`),
		"Risk in investing is the chance that an outcome differs from what you expected — including " +
			"losing some or all of the money you put in. A useful approach is to weigh how much you " +
			"could lose against how much you could gain, over what time horizon, and whether you could " +
			"cope if the value dropped. Higher potential returns generally come with higher risk. No " +
			"investment is risk-free, and past performance never guarantees future results."},
	{regexp.MustCompile(`(?i)\border|\bquote\b|(?i)how.*(buy|sell|trade)`),
		"When you place an order in Paymax you first get a quote showing the price, the spread, and " +
			"every fee, plus how much asset you would receive. The quote is time-limited because prices " +
			"move, so you confirm against that locked figure. After you confirm, the order processes and " +
			"then settles. This explains how the flow works — it is not a suggestion to place any order."},
	{regexp.MustCompile(`(?i)\bemotion|\bfomo|\bpanic|\bdiscipline|\bgreed|\bfear\b`),
		"Emotional trading — buying out of fear of missing out, or selling in a panic when prices drop " +
			"— is a common pitfall. A more disciplined approach is to decide your plan in advance, " +
			"understand the risks, and avoid reacting to short-term swings. Taking time before acting, " +
			"rather than chasing fast moves, tends to support clearer decisions."},
}

const mockGeneric = "I'm here to explain how investing works in plain terms — things like " +
	"volatility, diversification, fees, settlement, risk, or what a stock or cryptocurrency is. " +
	"I can also explain how orders and quotes work in the app. Tell me which topic you'd like to " +
	"understand and I'll walk you through it. I can't recommend specific assets or predict prices."

// MockProvider is the deterministic, guardrailed fallback used when no API key is
// configured. It selects a canned educational topic by keyword.
type MockProvider struct{}

func (m *MockProvider) Reply(_ context.Context, _ []ChatMessage, userMessage string) (string, error) {
	for _, t := range mockTopics {
		if t.keys.MatchString(userMessage) {
			return t.answer, nil
		}
	}
	return mockGeneric, nil
}
