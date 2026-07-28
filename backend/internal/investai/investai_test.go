package investai

import (
	"context"
	"strings"
	"testing"
)

// TestIsAdviceSeeking_Refuses covers the P0 guardrail: prompts that seek
// personalized advice, a price prediction, or a guarantee MUST be classified as
// advice-seeking so the service refuses them before any model runs.
func TestIsAdviceSeeking_Refuses(t *testing.T) {
	refuse := []struct {
		name   string
		prompt string
	}{
		// "should I buy/sell/hold" — personalized buy/sell/hold advice.
		{"should_i_buy", "Should I buy Tesla stock?"},
		{"should_i_sell", "should i sell my bitcoin now"},
		{"should_i_hold", "Should I hold or put more into ETH?"},
		{"should_i_invest", "should i invest in this coin"},
		// "what should I buy/invest/do".
		{"what_should_i_invest", "What should I invest in?"},
		{"what_should_i_do", "what should i do with my savings"},
		{"what_should_i_buy", "What should I buy today?"},
		// best/top asset requests.
		{"which_is_best_crypto", "Which is the best crypto?"},
		{"whats_the_top_stock", "what's the top stock right now"},
		{"best_stock_to_buy", "What's the best stock to buy?"},
		{"best_coin_to_invest", "best coin to invest in for 2026"},
		// price-direction predictions.
		{"will_go_up", "Will Bitcoin go up next week?"},
		{"going_to_moon", "Is Ethereum going to moon?"},
		{"will_crash", "is the market going to crash"},
		{"will_rally", "will stocks rally after the news"},
		// explicit price predictions / targets.
		{"price_prediction", "What's your price prediction for BTC?"},
		{"when_will_hit", "When will Bitcoin hit $100k?"},
		{"price_target", "give me a price target for SOL"},
		// how high/low/much will X go.
		{"how_high_will_go", "How high will BTC go?"},
		{"how_much_will_reach", "how much will my shares reach by december"},
		// guarantees / no-risk framing.
		{"guaranteed", "Is this a guaranteed return?"},
		{"guarantee", "can you guarantee I make money"},
		{"risk_free", "Is this risk-free?"},
		{"sure_thing", "is this coin a sure thing"},
		{"cant_lose", "tell me a trade where I can't lose"},
		// get-rich / multiplier hype.
		{"tenx", "Can this 10x my money?"},
		{"double_money", "how do I double my money fast"},
		{"get_rich", "what's the fastest way to get rich"},
		// direct "tell me what to..."
		{"tell_me_what_to_buy", "Tell me what to buy"},
		{"tell_me_what_to_invest", "Could you tell me what to invest in?"},
		// "is X a good buy/investment".
		{"good_buy", "Is Tesla a good buy right now?"},
		{"good_investment", "is dogecoin a good investment"},
		// case-insensitivity (the patterns are all (?i)).
		{"uppercase", "SHOULD I BUY BTC IMMEDIATELY"},
	}
	for _, tc := range refuse {
		t.Run(tc.name, func(t *testing.T) {
			if !isAdviceSeeking(tc.prompt) {
				t.Errorf("isAdviceSeeking(%q) = false, want true (advice-seeking prompt must be refused)", tc.prompt)
			}
		})
	}
}

// TestIsAdviceSeeking_Allows covers benign educational prompts, which MUST NOT be
// classified as advice-seeking so the assistant can answer them.
func TestIsAdviceSeeking_Allows(t *testing.T) {
	allow := []struct {
		name   string
		prompt string
	}{
		{"volatility", "What is volatility?"},
		{"diversification", "Explain diversification to me"},
		{"fees", "How do trading fees work?"},
		{"what_is_stock", "What is a stock?"},
		{"settlement", "How does settlement work?"},
		{"what_is_crypto", "What is cryptocurrency?"},
		{"risk_concept", "Can you explain what risk means in investing?"},
		{"quotes", "How are quotes calculated in the app?"},
		{"diversification_mean", "What does diversification mean?"},
		{"emotions", "Why is emotional trading a bad idea?"},
		// Boundary: "best" and "stock" present but NOT adjacent, so pattern 3/4
		// (which require "best <asset>") must not fire — this is educational.
		{"best_way_to_learn", "What is the best way to learn about stocks?"},
		// Boundary: mentions buying generically but is not a personalized ask.
		{"how_orders_work", "How does placing an order work?"},
	}
	for _, tc := range allow {
		t.Run(tc.name, func(t *testing.T) {
			if isAdviceSeeking(tc.prompt) {
				t.Errorf("isAdviceSeeking(%q) = true, want false (educational prompt must be allowed)", tc.prompt)
			}
		})
	}
}

// TestIsAdviceSeeking_KeywordBreadth documents an adversarial boundary: the
// guardrail is intentionally keyword-broad, so an educational prompt that merely
// contains a trigger word (e.g. "guarantee") is still refused. This asserts the
// ACTUAL fail-closed behavior rather than an idealized one.
func TestIsAdviceSeeking_KeywordBreadth(t *testing.T) {
	// Contains the bare word "guarantee" → pattern 8 fires even though the user
	// is asking for education. Fail-closed by design.
	if !isAdviceSeeking("I don't want a guarantee, just explain how risk works") {
		t.Error("expected a prompt containing 'guarantee' to be refused (fail-closed keyword breadth)")
	}
}

// TestMockProvider_Reply_Topics verifies the deterministic mock routes each
// educational keyword to its canned answer, and falls back to the generic
// education prompt otherwise. It never gives advice.
func TestMockProvider_Reply_Topics(t *testing.T) {
	m := &MockProvider{}
	cases := []struct {
		name     string
		prompt   string
		contains string
	}{
		{"volatility", "Tell me about volatility", "Volatility"},
		{"diversification", "How does diversification help?", "Diversification"},
		{"fees", "Explain the fees I pay", "cost"},
		{"settlement", "What is settlement?", "Settlement"},
		{"stocks", "What is a stock?", "stock"},
		{"crypto", "Explain bitcoin and blockchain", "cryptocurrency"},
		{"risk", "How much could I lose?", "Risk"},
		{"orders", "How do I place an order?", "quote"},
		{"emotions", "Is FOMO trading bad?", "Emotional"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := m.Reply(context.Background(), nil, tc.prompt)
			if err != nil {
				t.Fatalf("Reply returned error: %v", err)
			}
			if !strings.Contains(got, tc.contains) {
				t.Errorf("Reply(%q) = %q, want it to contain %q", tc.prompt, got, tc.contains)
			}
		})
	}
}

// TestMockProvider_Reply_GenericFallback verifies an off-topic prompt yields the
// generic educational fallback (which itself disclaims advice).
func TestMockProvider_Reply_GenericFallback(t *testing.T) {
	m := &MockProvider{}
	got, err := m.Reply(context.Background(), nil, "hello there, how are you today")
	if err != nil {
		t.Fatalf("Reply returned error: %v", err)
	}
	if got != mockGeneric {
		t.Errorf("expected generic fallback, got %q", got)
	}
	if !strings.Contains(got, "can't recommend specific assets or predict prices") {
		t.Errorf("generic fallback should disclaim advice, got %q", got)
	}
}

// TestNewProvider_SelectsBackend confirms provider selection without any network:
// a blank/whitespace key yields the deterministic mock, a present key yields the
// Anthropic-backed adapter (constructed but never invoked).
func TestNewProvider_SelectsBackend(t *testing.T) {
	if _, ok := NewProvider("").(*MockProvider); !ok {
		t.Error("NewProvider(\"\") should return *MockProvider")
	}
	if _, ok := NewProvider("   ").(*MockProvider); !ok {
		t.Error("NewProvider(whitespace) should return *MockProvider")
	}
	if _, ok := NewProvider("sk-test-key").(*anthropicAdapter); !ok {
		t.Error("NewProvider(key) should return *anthropicAdapter")
	}
}

// TestSystemPrompt_EncodesGuardrail is a lightweight guard that the pinned system
// prompt keeps the education-only hard rules; a refactor that drops them should
// break this test.
func TestSystemPrompt_EncodesGuardrail(t *testing.T) {
	for _, want := range []string{
		"EDUCATION",
		"do NOT recommend specific assets",
		"do NOT predict prices",
	} {
		if !strings.Contains(systemPrompt, want) {
			t.Errorf("systemPrompt is missing guardrail phrase %q", want)
		}
	}
}

// TestExplainAsset is a pure (no-DB) check: ExplainAsset never touches s.db, so a
// zero-value Service is safe here. It must normalize the symbol, frame the answer
// as education, and explicitly disclaim a recommendation.
func TestExplainAsset(t *testing.T) {
	s := &Service{} // db/ai unused by ExplainAsset

	if _, err := s.ExplainAsset(context.Background(), "   "); err != ErrBadInput {
		t.Errorf("ExplainAsset(blank) err = %v, want ErrBadInput", err)
	}

	resp, err := s.ExplainAsset(context.Background(), "btc")
	if err != nil {
		t.Fatalf("ExplainAsset error: %v", err)
	}
	if resp.Symbol != "BTC" {
		t.Errorf("Symbol = %q, want normalized %q", resp.Symbol, "BTC")
	}
	if !strings.Contains(resp.Text, "BTC") {
		t.Errorf("Text should reference the symbol, got %q", resp.Text)
	}
	if !strings.Contains(resp.Text, "not a recommendation") {
		t.Errorf("Text must disclaim a recommendation, got %q", resp.Text)
	}
	if resp.Disclaimer != Disclaimer {
		t.Errorf("Disclaimer = %q, want the standing Disclaimer constant", resp.Disclaimer)
	}
}
