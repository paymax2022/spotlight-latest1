// Module visibility: the fetch, the cache and the hooks. What DECIDES lives in
// rules.ts, which the server also implements — the client reads the server's answer
// and renders accordingly. The rule itself is NOT reimplemented here, because a
// second copy is how a client and server drift apart, and the drift shows up as a
// module appearing in production that nobody published.
//
// The tier is the SERVER's, not the build's: /api/v1/modules/visibility reports the
// environment the backend runs with, so a store build pointed at staging is governed
// by staging's publication until it is pointed at production.

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/api/client';
import {
  bestAnswer,
  moduleStateFor,
  resolveModuleState,
  visibilityFor,
  type ModuleState,
  type ModuleVisibility,
} from './rules';

export { visibilityFor, moduleStateFor, bestAnswer };
export type { ModuleVisibility, ModuleState };

/** Cache lifetime. Publication changes are rare; a stale minute is acceptable. */
const STALE_MS = 60_000;
export const MODULE_VISIBILITY_KEY = ['modules', 'visibility'] as const;

/**
 * Where the last successful answer is kept.
 *
 * The registry gate hides tiles and refuses deep links, but it cannot tell a
 * network fault from "nothing is published". Persisting the last good read lets
 * the fail-closed fallback mean something: an offline user on a train keeps the
 * grid they had, rather than losing every module nobody unpublished. A fresh
 * read always replaces it, so an admin hiding a module still takes effect on the
 * next successful launch.
 */
const VISIBILITY_CACHE_KEY = 'spotlight.moduleVisibility.v1';

function parseCached(raw: string | null): ModuleVisibility | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (!Array.isArray(d.modules)) return null;
    return {
      environment: String(d.environment ?? ''),
      modules: (d.modules as unknown[]).map(String),
      comingSoon: Array.isArray(d.comingSoon) ? (d.comingSoon as unknown[]).map(String) : [],
    };
  } catch {
    // Corrupt or written by an older shape: no answer, not a crash at launch.
    return null;
  }
}

export async function readCachedVisibility(): Promise<ModuleVisibility | null> {
  try {
    return parseCached(await AsyncStorage.getItem(VISIBILITY_CACHE_KEY));
  } catch {
    return null;
  }
}

export async function writeCachedVisibility(list: ModuleVisibility): Promise<void> {
  try {
    await AsyncStorage.setItem(VISIBILITY_CACHE_KEY, JSON.stringify(list));
  } catch {
    // Losing the cache costs a fallback, never a launch. Storage failures are
    // routine when the device is full, and this is not worth a user-visible error.
  }
}

export async function fetchModuleVisibility(): Promise<ModuleVisibility | null> {
  try {
    const res = await api.get('/api/v1/modules/visibility', { skipAuthRedirect: true });
    const d = (res.data?.data ?? res.data) as Record<string, unknown> | undefined;
    if (!d || !Array.isArray(d.modules)) return null;
    const list: ModuleVisibility = {
      environment: String(d.environment ?? ''),
      modules: (d.modules as unknown[]).map(String),
      // Absent on an older backend — treated as "no teasers", not as an error.
      comingSoon: Array.isArray(d.comingSoon) ? (d.comingSoon as unknown[]).map(String) : [],
    };
    // Only a well-formed answer is worth remembering.
    void writeCachedVisibility(list);
    return list;
  } catch {
    // Unreachable registry ⇒ "unknown", never "nothing". The hook then answers
    // from the last good read; see readCachedVisibility and bestAnswer.
    return null;
  }
}

export function useModuleVisibility() {
  const { data, isLoading, isError } = useQuery({
    queryKey: MODULE_VISIBILITY_KEY,
    queryFn: fetchModuleVisibility,
    staleTime: STALE_MS,
  });

  // Hydrated once per mount rather than per tile: the grid asks for dozens of
  // keys on one render and AsyncStorage is async.
  const [cached, setCached] = useState<ModuleVisibility | null>(null);
  useEffect(() => {
    let alive = true;
    void readCachedVisibility().then((value) => {
      if (alive) setCached(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return {
    loading: isLoading,
    /** True when neither this launch nor the cache can answer. */
    degraded: (isError || data === null) && cached === null,
    environment: data?.environment ?? cached?.environment ?? '',
    isVisible: (key: string) => resolveModuleState(data, cached, key),
    /** Full tri-state: 'visible' | 'comingSoon' | 'hidden'. */
    stateOf: (key: string): ModuleState => moduleStateFor(bestAnswer(data, cached), key),
  };
}

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
