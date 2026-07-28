// ── Paymax Invest · Onboarding — Utils ───────────────────────────────────────
// Pure helpers: id generation, suitability scoring and form validators. The
// scoring lives here so the mock API and the screens compute the same result
// (the screens preview a profile; the API records one).

import {
  RISK_CATEGORY_STYLE,
  SUITABILITY_QUESTIONS,
} from '../constants/onboarding.constants';
import type {
  KycPersonal,
  RiskCategory,
  SuitabilityAnswers,
  SuitabilityResult,
} from '../types/onboarding.types';

// ─── Ids ───────────────────────────────────────────────────────────────────--

/** Short non-cryptographic id for mock records (mirrors crypto's pattern). */
export function newId(prefix = 'ob'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Suitability scoring ──────────────────────────────────────────────────────

/** Sum the per-answer scores from the questionnaire definition. */
function totalScore(answers: SuitabilityAnswers): number {
  return SUITABILITY_QUESTIONS.reduce((sum, q) => {
    const chosen = answers[q.id];
    const opt = q.options.find((o) => o.value === chosen);
    return sum + (opt?.score ?? 0);
  }, 0);
}

/** Map a raw score onto one of the four risk buckets (evenly banded). */
function categoryForScore(score: number, maxScore: number): RiskCategory {
  const pct = maxScore > 0 ? score / maxScore : 0;
  if (pct < 0.4) return 'conservative';
  if (pct < 0.6) return 'balanced';
  if (pct < 0.8) return 'growth';
  return 'aggressive';
}

/**
 * Score the questionnaire into a suitability result. Deterministic so the mock
 * API and the result screen agree. Profiles expire after 12 months (re-assess).
 */
export function scoreSuitability(answers: SuitabilityAnswers): SuitabilityResult {
  const maxScore = SUITABILITY_QUESTIONS.reduce(
    (m, q) => m + Math.max(...q.options.map((o) => o.score)),
    0,
  );
  const score = totalScore(answers);
  const riskCategory = categoryForScore(score, maxScore);
  const style = RISK_CATEGORY_STYLE[riskCategory];
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  return {
    riskCategory,
    score,
    eligibleProducts: style.products,
    summary: style.description,
    expiresAt: expires.toISOString(),
  };
}

/** True once every question has an answer. */
export function isQuestionnaireComplete(answers: Partial<SuitabilityAnswers>): boolean {
  return SUITABILITY_QUESTIONS.every((q) => Boolean(answers[q.id]));
}

// ─── Validators ───────────────────────────────────────────────────────────────

/** NG NIN is 11 digits; BVN is 11 digits. */
export function isValidNin(nin: string): boolean {
  return /^\d{11}$/.test(nin.trim());
}

export function isValidBvn(bvn: string): boolean {
  return /^\d{11}$/.test(bvn.trim());
}

/** A loose YYYY-MM-DD check that also requires the user be at least 18. */
export function isValidDob(dob: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob.trim())) return false;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return false;
  const eighteen = new Date();
  eighteen.setFullYear(eighteen.getFullYear() - 18);
  return d <= eighteen;
}

export function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/** Validate the personal-details step; returns field → message for any errors. */
export function validatePersonal(p: KycPersonal): Partial<Record<keyof KycPersonal, string>> {
  const errors: Partial<Record<keyof KycPersonal, string>> = {};
  if (!isNonEmpty(p.firstName)) errors.firstName = 'Enter your first name.';
  if (!isNonEmpty(p.lastName)) errors.lastName = 'Enter your last name.';
  if (!isValidDob(p.dob)) errors.dob = 'Enter your date of birth (YYYY-MM-DD). You must be 18 or older.';
  if (!isValidBvn(p.bvn)) errors.bvn = 'Enter your 11-digit BVN.';
  if (!isValidNin(p.nin)) errors.nin = 'Enter your 11-digit NIN.';
  return errors;
}

/** Convenience: are there no validation errors? */
export function hasNoErrors(errors: Record<string, string | undefined>): boolean {
  return Object.values(errors).every((v) => !v);
}
