// ── Paymax Invest · AI Investment Education Assistant — Constants ─────────────
// Compliance copy + starter prompts. These encode the guardrail policy from
// docs/crypto/modules.md so the UI and mock share one source of truth:
//  • DISCLAIMER is attached to every assistant turn (educational answers + refusals).
//  • REFUSAL is returned when a prompt seeks personalized advice / predictions /
//    guarantees, then redirects the user back to education.
//  • SYSTEM_GUARDRAIL documents the system-level policy the assistant operates under.
// Educational tone only — nothing here recommends buying/selling a specific asset.

import type { SuggestedQuestion } from '../types/ai.types';

/** Standing disclaimer footnoted on every assistant message. */
export const DISCLAIMER =
  'Educational information only — not financial advice. Paymax does not recommend ' +
  'specific assets or predict prices. Investing carries risk, including loss of ' +
  'capital. Consider your own circumstances and, where needed, a licensed adviser.';

/** Returned when a prompt asks for advice / predictions / guarantees. */
export const REFUSAL =
  "I can't give personalized investment advice, price predictions, or any " +
  "promise of returns — that's outside what this assistant does. What I can do " +
  'is explain how things work so you can make your own informed decision. For ' +
  'example, I can walk through volatility, diversification, fees, settlement, ' +
  'or how a particular asset or order type works. Want me to explain one of those?';

/**
 * System-level compliance policy the assistant operates under (mirrors the
 * Guardrails section of docs/crypto/modules.md). Documented here for the data
 * layer; in production this is enforced server-side too.
 */
export const SYSTEM_GUARDRAIL =
  'You are an investment EDUCATION assistant for Paymax. Educate and explain ' +
  'only. Never give personalized buy/sell advice, never predict prices as ' +
  'certainty, never promise or imply guaranteed returns, never encourage ' +
  'leverage or high-risk trading, and never recommend a specific or ineligible ' +
  'asset. Refuse advice-seeking, illegal, or unsafe requests and redirect to ' +
  'education. Keep a neutral, educational tone and attach the standing ' +
  'disclaimer to every reply.';

/** Educational starter prompts (never advice-seeking). */
export const SUGGESTED_QUESTIONS: SuggestedQuestion[] = [
  { id: 'sq_volatility', text: 'What does volatility mean?' },
  { id: 'sq_diversification', text: 'How does diversification work?' },
  { id: 'sq_fees', text: 'What fees can I pay when investing?' },
  { id: 'sq_settlement', text: 'What is settlement?' },
  { id: 'sq_stock', text: 'What is a stock?' },
  { id: 'sq_crypto', text: 'What is a cryptocurrency?' },
  { id: 'sq_risk', text: 'How should I think about risk?' },
];
