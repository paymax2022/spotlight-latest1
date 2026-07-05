// ── Paymax Invest · AI Investment Education Assistant — Data hooks ────────────
// React Query hooks mirroring useCrypto.ts so the screens stay declarative and
// share the same loading / error contracts. The assistant is read-only (no money
// mutations) — `ask` and `explainAsset` are modelled as mutations because each
// call is a discrete request/response turn rather than cached state.

import { useMutation } from '@tanstack/react-query';
import * as ai from '../api/ai.api';
import type { AskContext } from '../types/ai.types';

const KEY = 'investai';

/** Send a prompt to the education assistant; resolves to a disclaimered turn. */
export function useAskAssistant() {
  return useMutation({
    mutationKey: [KEY, 'ask'],
    mutationFn: ({ prompt, context }: { prompt: string; context?: AskContext }) =>
      ai.ask(prompt, context),
  });
}

/** Request a neutral educational summary for one asset. */
export function useExplainAsset() {
  return useMutation({
    mutationKey: [KEY, 'explain-asset'],
    mutationFn: (symbol: string) => ai.explainAsset(symbol),
  });
}
