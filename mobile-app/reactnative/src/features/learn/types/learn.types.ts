// ── Paymax Invest · Learn Center — Type Contract ─────────────────────────────
// The education-first investing-literacy surface. Mirrors the crypto module's
// type-contract conventions (Backend role owns this file). The Learn Center is
// read-mostly: the only mutation is submitting a quiz to score it.
//
// Routes map to /api/v1/learn/* (docs/crypto/api.md envelope). All content is
// server-driven config in production; the client renders what the payload says.

/** Which audience / track a path belongs to (drives chip styling, see constants). */
export type LearnLevel = 'beginner' | 'stock' | 'crypto' | 'wealth';

/** How a lesson is consumed — an article (read) or a video (watch). */
export type LessonKind = 'article' | 'video';

// ─── Learning path (a curated track of lessons) ───────────────────────────────

export interface LearnPath {
  id: string;
  title: string;
  description: string;
  /** Brand-token hex for the path glyph tint (never invented at the call site). */
  iconColor: string;
  level: LearnLevel;
  /** Ordered lesson ids that make up the track. */
  lessonIds: string[];
  /** 0–100 completion for the signed-in learner (server-tracked in production). */
  progressPct: number;
}

// ─── Lesson (a single article or video unit inside a path) ─────────────────────

export interface Lesson {
  id: string;
  pathId: string;
  title: string;
  durationMins: number;
  kind: LessonKind;
  /** Rich body copy (paragraphs separated by blank lines). */
  body: string;
  /** One-line takeaway shown in lists and on the path screen. */
  summary: string;
}

// ─── Quiz (optional knowledge check attached to a lesson) ──────────────────────

export interface QuizOption {
  id: string;
  label: string;
  correct: boolean;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: QuizOption[];
}

export interface Quiz {
  id: string;
  lessonId: string;
  questions: QuizQuestion[];
}

/** Map of questionId → chosen optionId, submitted for scoring. */
export type QuizAnswers = Record<string, string>;

/** Server-authoritative scoring result (client never decides pass/fail). */
export interface QuizResult {
  score: number;        // number of correct answers
  total: number;        // number of questions
  passed: boolean;      // score met the pass threshold
}

// ─── Glossary ──────────────────────────────────────────────────────────────--

export interface GlossaryTerm {
  term: string;
  definition: string;
}
