'use client';

import { useEffect, useState } from 'react';
import { getMyStemRoles } from '@/services/stemService';

const MANAGE_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'OPERATIONS_MANAGER', 'CONTEST_MANAGER']);
const READ_ROLES = new Set([
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATIONS_MANAGER',
  'CONTEST_MANAGER',
  'SCHOOL_ADMIN',
  'TEACHER_COACH',
  'JUDGE',
  'MENTOR',
  'SPONSOR',
]);

/**
 * Synchronous fallback role, used only:
 *   1. as useStemRoles()'s initial render value, before the real per-user
 *      fetch below resolves (or on a session where it hasn't been called
 *      yet this page load), and
 *   2. by any caller still passing no argument to canReadStem/canManageStem.
 * Real STEM authorization is enforced server-side regardless of this value
 * (see backend/internal/middleware/stem_authz.go's RequireStemRoles) — a
 * stale value here is at most a UX papercut (a rendered nav item 403s).
 *
 * @deprecated for anything that can use useStemRoles() instead — this never
 * reflects the signed-in user's real roles, only a build-time default.
 */
export function getCurrentStemRole(): string {
  return (process.env.NEXT_PUBLIC_STEM_ROLE || 'ADMIN').toUpperCase();
}

// Module-scoped so every component calling useStemRoles() this page load
// shares one fetch and one cached result instead of each firing its own.
let cachedRoles: string[] | null = null;
let inflight: Promise<string[] | null> | null = null;

function loadStemRoles(): Promise<string[] | null> {
  if (cachedRoles) return Promise.resolve(cachedRoles);
  if (!inflight) {
    inflight = getMyStemRoles().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/**
 * The signed-in admin's REAL STEM role(s) (AUTH-020 follow-up, ADR-056/057):
 * fetched once from GET .../admin/stem/my-role (backend/internal/handlers/
 * stem_handler.go's MyRole, resolved via a real RBAC lookup — not a header
 * or an env var) and cached for the rest of the page load. Starts from
 * [getCurrentStemRole()] so nav/button visibility has a reasonable value on
 * first render instead of blanking out, then updates once the real fetch
 * resolves; if the fetch fails (offline, backend down) it stays on that
 * fallback rather than hiding everything.
 */
export function useStemRoles(): string[] {
  const [roles, setRoles] = useState<string[]>(() => cachedRoles ?? [getCurrentStemRole()]);

  useEffect(() => {
    let cancelled = false;
    loadStemRoles().then((resolved) => {
      if (cancelled || !resolved) return;
      cachedRoles = resolved;
      setRoles(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return roles;
}

export function canReadStem(roles: string | string[] = getCurrentStemRole()): boolean {
  const list = Array.isArray(roles) ? roles : [roles];
  return list.some((r) => READ_ROLES.has(r));
}

export function canManageStem(roles: string | string[] = getCurrentStemRole()): boolean {
  const list = Array.isArray(roles) ? roles : [roles];
  return list.some((r) => MANAGE_ROLES.has(r));
}

