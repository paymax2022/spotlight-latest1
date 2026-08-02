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

import type { AcademyClass, CurriculumVersion, Subject, ExamSlug, Topic } from './types';

export interface GoClass {
  id: string; version_id: string; phase: string; code: string; name: string; ordinal: number;
}
export interface GoVersion {
  id: string; code: string; name: string; status: string; effective_date?: string;
}
export interface GoSubject {
  id: string; version_id: string; class_id: string; code: string; name: string;
  kind: string; stream?: string | null; exam_relevance?: string[];
}
export interface GoTopic {
  id: string; subject_id: string; code: string; title: string; ordinal: number;
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

// ── Subjects ─────────────────────────────────────────────────────────────────
const EXAM_SLUGS = new Set<ExamSlug>(['utme', 'bece', 'wassce', 'neco', 'cce', 'nabteb']);
const SUBJECT_COLORS = ['iconBgBlue', 'iconBgTeal', 'iconBgPurple', 'iconBgGold', 'iconBgGreen', 'iconBgRed'];

/** Map Go's UPPERCASE exam tags to the mobile ExamSlug union, dropping unknowns. */
function mapExamRelevance(tags?: string[]): ExamSlug[] {
  return (tags ?? [])
    .map((t) => t.toLowerCase())
    .filter((t): t is ExamSlug => EXAM_SLUGS.has(t as ExamSlug));
}

/** Deterministic display colour for a subject (Go doesn't carry UI theming). */
function subjectColorKey(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return SUBJECT_COLORS[h % SUBJECT_COLORS.length];
}

/**
 * Adapt a Go subject → mobile Subject. `classCode` is injected by the caller
 * (the subjects route is keyed by the class UUID, and the row carries class_id,
 * not the code the screens use). topicCount / masteredTopics / progressPct default
 * to 0 — they need a backend count + per-user progress the API does not yet serve
 * (tracked). icon/colorKey are client display defaults.
 */
export function adaptSubject(g: GoSubject, classCode: string): Subject {
  return {
    id: g.id,
    classCode,
    name: g.name,
    icon: 'BookOpen',
    colorKey: subjectColorKey(g.code),
    topicCount: 0,
    masteredTopics: 0,
    progressPct: 0,
    examRelevance: mapExamRelevance(g.exam_relevance),
  };
}

/** Unwrap {subjects:[…]} (or bare array / empty) and adapt, injecting classCode. */
export function adaptSubjects(res: { subjects?: GoSubject[] } | GoSubject[] | null | undefined, classCode: string): Subject[] {
  const rows = Array.isArray(res) ? res : res?.subjects ?? [];
  return rows.map((s) => adaptSubject(s, classCode));
}

// ── Topics ───────────────────────────────────────────────────────────────────
/**
 * Adapt a Go topic → mobile Topic. mastery/locked/examRelevant default to
 * unlocked-not-started, and objectiveCount/lessonCount to 0 — they need per-user
 * progress + backend counts the API does not yet serve (tracked). The subject id
 * the caller passes is already the Go subject UUID (from the live subjects call),
 * so no code resolution is needed here.
 */
export function adaptTopic(g: GoTopic): Topic {
  return {
    id: g.id,
    subjectId: g.subject_id,
    name: g.title,
    order: g.ordinal,
    mastery: 'not_started',
    locked: false,
    examRelevant: false,
    objectiveCount: 0,
    lessonCount: 0,
  };
}

/** Unwrap {topics:[…]} (or bare array / empty) and adapt. Never throws. */
export function adaptTopics(res: { topics?: GoTopic[] } | GoTopic[] | null | undefined): Topic[] {
  const rows = Array.isArray(res) ? res : res?.topics ?? [];
  return rows.map(adaptTopic);
}
