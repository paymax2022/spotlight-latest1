// ── Paymax Health — Symptom search React Query hooks ─────────────────────────
// Follows the pharmacy hooks style (React Query v5, KEY-scoped query keys).
// Screens NEVER dead-end: error states surface a retry + pharmacist-chat fallback.

import { useQuery } from '@tanstack/react-query';
import {
  symptomSearch,
  getClassSkus,
  type SymptomRefiners,
  type SymptomWho,
} from './symptomSearch.api';
import { useSymptomSearchStore } from '../pharmacy/symptomSearchStore';

const KEY = 'pharmacy';

/**
 * Resolve symptom terms + refiners to a triage-tiered result. Query (not
 * mutation): resolution is read-only & cacheable, so the results and escalation
 * screens can share one cache entry keyed by terms/refiners.
 */
export function useSymptomSearch(terms: string[], refiners?: SymptomRefiners) {
  return useQuery({
    queryKey: [KEY, 'symptom-search', terms, refiners ?? {}],
    queryFn: async () => {
      const result = await symptomSearch({ terms, refiners });
      // Hold the server event id so checkout can link the order to this search.
      useSymptomSearchStore.getState().setSearchEventId(result.search_event_id ?? null);
      return result;
    },
    enabled: terms.length > 0,
    staleTime: 60_000,
    retry: 1,
  });
}

/** Live SKUs for one therapeutic class (cohort-filtered server-side). */
export function useClassSkus(classId?: string, who?: SymptomWho) {
  return useQuery({
    queryKey: [KEY, 'class-skus', classId, who ?? 'ALL'],
    queryFn: () => getClassSkus(classId as string, who ? { who } : undefined),
    enabled: Boolean(classId),
    staleTime: 60_000,
  });
}
