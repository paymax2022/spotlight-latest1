// ── Resume-after-blocker ─────────────────────────────────────────────────────
// A tiny app-wide store for "intelligent dynamic routing": when a blocker (the
// transaction-PIN gate, a KYC step-up, or any future gate) interrupts a user
// mid-flow, we remember exactly where they were (route + params). Once the
// blocker is resolved, resumeOrFallback() sends them back to continue — and,
// because the target can carry params, the destination screen can re-open the
// action they were taking (e.g. the Back-a-Driver sheet).
//
// Deliberately a module singleton (not React state): the value must survive
// navigation across the blocker screens without a provider.

import { router } from 'expo-router';

export interface ResumeTarget {
  pathname: string;
  params?: Record<string, string>;
}

let pending: ResumeTarget | null = null;

// Blocker/auth/splash routes must never be remembered as a place to "return to".
function isBlockerRoute(pathname: string): boolean {
  return (
    !pathname ||
    pathname === '/' ||
    pathname.startsWith('/security/set-pin') ||
    pathname.startsWith('/kyc-verify') ||
    pathname.startsWith('/(auth)') ||
    pathname.startsWith('/onboarding')
  );
}

/** Remember where to come back to. Ignores blocker/auth routes. */
export function rememberResume(target: ResumeTarget): void {
  if (isBlockerRoute(target.pathname)) return;
  pending = target;
}

/** Take and clear the pending target. */
export function consumeResume(): ResumeTarget | null {
  const t = pending;
  pending = null;
  return t;
}

export function clearResume(): void {
  pending = null;
}

/**
 * Navigate to the remembered target (clearing it), or to `fallback` when there
 * is nothing to resume. Uses replace so the blocker screen leaves the stack.
 */
export function resumeOrFallback(fallback: string): void {
  const t = consumeResume();
  if (t) {
    router.replace({ pathname: t.pathname, params: t.params ?? {} } as never);
  } else {
    router.replace(fallback as never);
  }
}

/** Coerce expo-router search params into a plain string map for re-navigation. */
export function toParamMap(p: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v == null) continue;
    out[k] = Array.isArray(v) ? (v[0] ?? '') : String(v);
  }
  return out;
}
