// ── Academy identity adapters (Go /me aggregate → mobile AcademyProfile) ─────
// The Go identity API returns a nested aggregate
// ({user_id, roles[], profiles[], guardian_links[], guarded_by[]}); the mobile
// screens code against a flat AcademyProfile. Pure so it is unit-testable.

import type { AcademyProfile, AcademyRole, KycTier, GuardianConsentState } from './types';

export interface GoRoleGrant { user_id: string; role: string }
export interface GoGuardianLink { guardian_user_id: string; minor_user_id: string; status: string }
export interface GoProfile {
  id: string; user_id: string; role: string;
  class_id?: string | null; stream?: string | null; trade_track?: string | null;
  school?: string | null; display_name?: string | null; avatar_url?: string | null;
  entry_year?: number | null; dob?: string | null; is_minor?: boolean; kyc_tier?: number;
}
export interface GoMe {
  user_id: string; roles?: GoRoleGrant[]; profiles?: GoProfile[];
  guardian_links?: GoGuardianLink[]; guarded_by?: GoGuardianLink[];
}

/** Backend role → mobile role (backend has no 'kid'; 'staff' → tutor). */
export function mapGoRole(r?: string): AcademyRole {
  switch (r) {
    case 'parent': return 'parent';
    case 'tutor':
    case 'staff': return 'tutor';
    default: return 'learner';
  }
}

/** Mobile role → backend role (backend enum: learner|parent|tutor|staff). */
export function mapMobileRole(r: AcademyRole): string {
  switch (r) {
    case 'parent': return 'parent';
    case 'tutor': return 'tutor';
    default: return 'learner'; // 'kid' and 'learner' both map to backend 'learner'
  }
}

export function kycFromInt(n?: number | null): KycTier {
  return n === 2 ? 'tier2' : n === 1 ? 'tier1' : 'tier0';
}
export function kycToInt(t?: KycTier): number {
  return t === 'tier2' ? 2 : t === 'tier1' ? 1 : 0;
}

function mapStream(s?: string | null): AcademyProfile['stream'] {
  return s === 'science' || s === 'humanities' || s === 'commercial' ? s : undefined;
}

/**
 * Guardian-consent state, fail-safe: a minor is only 'granted' with an ACTIVE
 * guardian link — otherwise 'pending' (consent still needed). Non-minors never
 * require consent. Mirrors the child-safety gate.
 */
export function deriveConsent(guardedBy: GoGuardianLink[] | undefined, isMinor: boolean): GuardianConsentState {
  if (!isMinor) return 'not_required';
  return (guardedBy ?? []).some((l) => l.status === 'active') ? 'granted' : 'pending';
}

/**
 * Adapt the Go /me aggregate → the flat mobile AcademyProfile. `classCodeById`
 * maps class UUID → class code (built from the live classes). With no profile the
 * user is treated as not-onboarded (never a minor by default; consent not_required).
 */
export function adaptMe(me: GoMe, classCodeById: Map<string, string>): AcademyProfile {
  const guardedBy = me.guarded_by ?? [];
  const childIds = (me.guardian_links ?? []).map((l) => l.minor_user_id);
  const p = me.profiles?.[0];

  if (!p) {
    return {
      id: me.user_id,
      displayName: '',
      role: mapGoRole(me.roles?.[0]?.role),
      isMinor: false,
      kycTier: 'tier0',
      guardianConsent: 'not_required',
      guardianId: guardedBy[0]?.guardian_user_id,
      childIds: childIds.length ? childIds : undefined,
      onboardingComplete: false,
    };
  }

  const isMinor = !!p.is_minor;
  return {
    id: p.id,
    displayName: p.display_name ?? '',
    role: mapGoRole(p.role),
    dob: p.dob ?? undefined,
    isMinor,
    kycTier: kycFromInt(p.kyc_tier),
    classCode: p.class_id ? classCodeById.get(p.class_id) : undefined,
    stream: mapStream(p.stream),
    guardianConsent: deriveConsent(guardedBy, isMinor),
    guardianId: guardedBy[0]?.guardian_user_id,
    childIds: childIds.length ? childIds : undefined,
    onboardingComplete: Boolean(p.role && p.class_id),
  };
}
