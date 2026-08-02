// ── Curriculum live-response adapters (Go → mobile) ──────────────────────────
// The Go backend (GET /api/finance/academy/curriculum/*) returns snake_case rows
// in a named envelope ({classes:[…]}, {versions:[…]}); the mobile screens code
// against camelCase AcademyClass / CurriculumVersion. These pure adapters bridge
// the two so the live branch (USE_MOCK=false) matches the mock shape exactly.
//
// SCOPE: only versions + classes map cleanly today. Subjects/topics/lessons still
// need BACKEND enrichment before they can go live — the Go rows omit fields the
// mobile UI requires (Subject.classCode + topicCount/masteredTopics/progressPct/
// examRelevance are all absent), and /classes/:id/subjects is keyed by the class
// UUID, not the class code the mobile holds. Tracked for a backend slice.

import type { AcademyClass, CurriculumVersion } from './types';

export interface GoClass {
  id: string; version_id: string; phase: string; code: string; name: string; ordinal: number;
}
export interface GoVersion {
  id: string; code: string; name: string; status: string; effective_date?: string;
}

/** Map the Go class phase/code to the mobile band bucket. */
export function bandFromPhase(phase: string, code: string): AcademyClass['band'] {
  const p = `${phase} ${code}`.toLowerCase();
  if (/senior|sss/.test(p)) return 'sss';
  if (/junior|jss/.test(p)) return 'jss';
  return 'primary';
}

export function adaptClass(g: GoClass): AcademyClass {
  return {
    id: g.id,
    code: g.code,
    label: g.name,
    band: bandFromPhase(g.phase, g.code),
    curriculumVersionId: g.version_id,
  };
}

export function adaptVersion(g: GoVersion): CurriculumVersion {
  return {
    id: g.id,
    label: g.name,
    // Go exposes effective_date only on dated versions; 0 marks "unknown".
    effectiveYear: g.effective_date ? new Date(g.effective_date).getUTCFullYear() : 0,
    isLegacy: g.code.toUpperCase() === 'LEGACY',
  };
}

/** Unwrap {classes:[…]} (or a bare array / empty) and adapt. Never throws. */
export function adaptClasses(res: { classes?: GoClass[] } | GoClass[] | null | undefined): AcademyClass[] {
  const rows = Array.isArray(res) ? res : res?.classes ?? [];
  return rows.map(adaptClass);
}

/** Unwrap {versions:[…]} (or a bare array / empty) and adapt. Never throws. */
export function adaptVersions(res: { versions?: GoVersion[] } | GoVersion[] | null | undefined): CurriculumVersion[] {
  const rows = Array.isArray(res) ? res : res?.versions ?? [];
  return rows.map(adaptVersion);
}
