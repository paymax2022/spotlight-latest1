// ── Paymax Invest · AI Investment Education Assistant — API wrapper ───────────
// Typed data layer the Invest-AI screens code against. Mirrors crypto.api.ts:
// mock-flagged. Flip EXPO_PUBLIC_AI_USE_MOCK=false once the real Paymax AI
// endpoints (docs/crypto/api.md → "AI Assistant") land.
//
// GUARDRAILS honoured here (docs/crypto/modules.md → AI Investment Education
// Assistant): the assistant educates only, never gives personalized advice /
// price predictions / guarantees; advice-seeking prompts are refused and
// redirected to education; every assistant turn carries a disclaimer. In mock
// mode the policy is enforced client-side (ai.mock.ts); in production the same
// policy is enforced server-side and surfaced via the disclaimer flag.

import { api } from '@/api/client';
import { DISCLAIMER, REFUSAL } from '../constants/ai.constants';
import { answerFor, explainAssetFor, isAdviceSeeking } from './ai.mock';
import type { AskContext, ChatMessage } from '../types/ai.types';

// ─── Feature flag: flip to false once real endpoints are ready ────────────────
const USE_MOCK = (process.env.EXPO_PUBLIC_AI_USE_MOCK ?? 'true').toLowerCase() !== 'false';

/** Simulated network latency so the typing indicator renders in mock mode. */
const delay = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const unwrap = <T>(res: { data: { data?: T } & T }): T => (res.data?.data ?? res.data) as T;

/** Normalise a thrown axios error into a user-facing Error. */
function toAiError(err: unknown): Error {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  const msg = e?.response?.data?.message ?? e?.message ?? 'The assistant is unavailable right now. Please try again.';
  return new Error(msg);
}

let seq = 0;
const newId = (role: string) => `msg_${role}_${Date.now()}_${seq++}`;

// Server-issued session id for the live backend. Held for the app session so
// consecutive `ask` turns thread into one investai_sessions row (history +
// context). Unused in mock mode. Reset by resetInvestAiSession() to start fresh.
let currentSessionId: string | null = null;

/** Start a new server-side conversation (drops the remembered session id). */
export function resetInvestAiSession(): void {
  currentSessionId = null;
}

function assistantMessage(text: string): ChatMessage {
  return { id: newId('a'), role: 'assistant', text, disclaimer: true, at: new Date().toISOString() };
}

/**
 * Ask the education assistant a question. Always resolves to an assistant
 * ChatMessage with `disclaimer: true`. Advice-seeking prompts resolve to the
 * standing refusal; everything else to a canned educational explanation.
 *
 * Maps to POST /api/v1/ai/invest/chat (docs/crypto/api.md).
 */
export async function ask(prompt: string, context?: AskContext): Promise<ChatMessage> {
  if (USE_MOCK) {
    // Refusals come back fast; educational answers take a touch longer to "think".
    await delay(isAdviceSeeking(prompt) ? 450 : 750);
    return assistantMessage(answerFor(prompt, context));
  }
  try {
    const res = await api.post('/api/v1/ai/invest/chat', {
      prompt,
      context,
      session_id: currentSessionId ?? undefined,
    });
    const data = unwrap<{ text: string; refused?: boolean; session_id?: string }>(res);
    // Remember the server session so follow-up turns share one conversation.
    if (data.session_id) currentSessionId = data.session_id;
    // The server enforces the same guardrails (refuses advice-seeking prompts,
    // disclaimers every turn). Default to a disclaimered turn, and fall back to
    // the standing refusal if the server flags a refusal with no message of its own.
    const text = data.text || (data.refused ? REFUSAL : DISCLAIMER);
    return assistantMessage(text);
  } catch (err) {
    throw toAiError(err);
  }
}

/**
 * Neutral, educational summary of one asset — never a recommendation.
 * Maps to POST /api/v1/ai/invest/explain-asset (docs/crypto/api.md).
 */
export async function explainAsset(symbol: string): Promise<ChatMessage> {
  if (USE_MOCK) {
    await delay(700);
    return assistantMessage(explainAssetFor(symbol));
  }
  try {
    const res = await api.post('/api/v1/ai/invest/explain-asset', { symbol });
    const data = unwrap<{ text: string }>(res);
    return assistantMessage(data.text || explainAssetFor(symbol));
  } catch (err) {
    throw toAiError(err);
  }
}
