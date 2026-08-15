// ── Module visibility (client half of the platform module registry) ──────────
//
// The server decides which modules this environment may show; the app asks and
// renders accordingly. The rule itself is NOT reimplemented here — a second copy
// is how a client and server drift apart, and the drift shows up as a module
// appearing in production that nobody published.
//
// Usage:
//   const { isVisible, loading } = useModuleVisibility();
//   if (!isVisible('telemedicine')) return null;

import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

export interface ModuleVisibility {
  environment: string;
  modules: string[];
}

/** Cache lifetime. Publication changes are rare; a stale minute is acceptable. */
const STALE_MS = 60_000;
export const MODULE_VISIBILITY_KEY = ['modules', 'visibility'] as const;

export async function fetchModuleVisibility(): Promise<ModuleVisibility | null> {
  try {
    const res = await api.get('/api/v1/modules/visibility', { skipAuthRedirect: true });
    const d = (res.data?.data ?? res.data) as Record<string, unknown> | undefined;
    if (!d || !Array.isArray(d.modules)) return null;
    return {
      environment: String(d.environment ?? ''),
      modules: (d.modules as unknown[]).map(String),
    };
  } catch {
    // Unreachable registry ⇒ "unknown", never "nothing". See visibilityFor.
    return null;
  }
}

/**
 * Resolve one module's visibility from a fetched list.
 *
 * `null` (registry unreachable / not yet loaded) resolves to VISIBLE, deliberately.
 * This is the one place the fail-closed instinct is wrong: the registry decides
 * what to *render*, not what to authorise. Failing closed here would blank the
 * whole app on a flaky network, while failing open shows a screen whose actions
 * the server still refuses if they are genuinely gated. Authorisation lives in the
 * API; this is presentation.
 */
export function visibilityFor(list: ModuleVisibility | null | undefined, key: string): boolean {
  if (!list) return true;
  return list.modules.includes(key);
}

export function useModuleVisibility() {
  const { data, isLoading, isError } = useQuery({
    queryKey: MODULE_VISIBILITY_KEY,
    queryFn: fetchModuleVisibility,
    staleTime: STALE_MS,
  });

  return {
    loading: isLoading,
    /** True when the registry could not be read; callers may show a subtle notice. */
    degraded: isError || data === null,
    environment: data?.environment ?? '',
    isVisible: (key: string) => visibilityFor(data ?? null, key),
  };
}
