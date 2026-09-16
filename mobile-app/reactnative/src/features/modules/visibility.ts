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
import { visibilityFor, moduleStateFor, type ModuleState, type ModuleVisibility } from './rules';

export { visibilityFor, moduleStateFor };
export type { ModuleVisibility, ModuleState };

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
      // Absent on an older backend — treated as "no teasers", not as an error.
      comingSoon: Array.isArray(d.comingSoon) ? (d.comingSoon as unknown[]).map(String) : [],
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
    /** Full tri-state: 'visible' | 'comingSoon' | 'hidden'. */
    stateOf: (key: string): ModuleState => moduleStateFor(data ?? null, key),
  };
}

// ─── Per-user access ─────────────────────────────────────────────────────────

/** What THIS user may use, already intersected with what the environment publishes. */
export interface UserModuleAccess {
  modules: string[];
  comingSoon: string[];
  kycTier: number;
}

export const MODULE_ACCESS_KEY = ['modules', 'access'] as const;

/**
 * Fetch the signed-in user's effective module access.
 *
 * Returns null on any failure, which callers treat as "unknown" and fall back to the
 * environment-level list — the same fail-open stance as the visibility gate, and for
 * the same reason: this decides what to RENDER, not what to authorise. Money is gated
 * by KYC tier server-side regardless of what the grid shows.
 */
export async function fetchModuleAccess(): Promise<UserModuleAccess | null> {
  try {
    const res = await api.get('/api/finance/modules/access', { skipAuthRedirect: true });
    const d = (res.data?.data ?? res.data) as Record<string, unknown> | undefined;
    if (!d || !Array.isArray(d.modules)) return null;
    return {
      modules: (d.modules as unknown[]).map(String),
      comingSoon: Array.isArray(d.comingSoon) ? (d.comingSoon as unknown[]).map(String) : [],
      kycTier: typeof d.kycTier === 'number' ? d.kycTier : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Module state for the CURRENT USER: the environment gate intersected with the user's
 * own entitlements.
 *
 * A module the environment publishes but this user may not access resolves to 'hidden'
 * — not 'comingSoon'. "Coming soon" means "nobody has it yet"; showing a teaser for a
 * module other users already use would invite a support ticket rather than explain
 * anything. The kycTier is exposed separately so a screen can offer "verify to unlock".
 */
export function useUserModuleState() {
  const env = useModuleVisibility();
  const { data, isLoading } = useQuery({
    queryKey: MODULE_ACCESS_KEY,
    queryFn: fetchModuleAccess,
    staleTime: STALE_MS,
  });

  return {
    loading: env.loading || isLoading,
    kycTier: data?.kycTier ?? 0,
    stateOf: (key: string): ModuleState => {
      const envState = env.stateOf(key);
      if (envState === 'hidden') return 'hidden';
      if (!data) return envState; // access unknown — fall back to the environment view
      if (data.modules.includes(key)) return envState;
      if (data.comingSoon.includes(key)) return 'comingSoon';
      return 'hidden'; // published, but not for this user
    },
  };
}
