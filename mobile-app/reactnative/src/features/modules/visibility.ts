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
import { visibilityFor, type ModuleVisibility } from './rules';

export { visibilityFor };
export type { ModuleVisibility };

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
