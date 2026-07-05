// ── Paymax Invest · AI Investment Education Assistant — Type Contract ─────────
// Source of truth the Invest-AI screens code against. The assistant EDUCATES —
// it never gives personalized financial advice (docs/crypto/modules.md → "AI
// Investment Education Assistant": Allowed/Prohibited/Guardrails). Every
// assistant turn carries a disclaimer; advice-seeking prompts are refused and
// redirected to education.

/** Who authored a chat turn. */
export type ChatRole = 'user' | 'assistant';

/**
 * One message in the education chat. `disclaimer` is set on assistant turns the
 * UI must footnote with the standing disclaimer (every educational answer + every
 * refusal). `at` is an ISO timestamp so the list can order/age messages.
 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  disclaimer?: boolean;   // assistant turns → render DisclaimerNote
  at: string;             // ISO timestamp
}

/** A tappable starter prompt — always educational (never advice-seeking). */
export interface SuggestedQuestion {
  id: string;
  text: string;
}

/** Optional context the screens may pass so answers can reference the session. */
export interface AskContext {
  symbol?: string;        // asset the user is currently viewing, if any
}
