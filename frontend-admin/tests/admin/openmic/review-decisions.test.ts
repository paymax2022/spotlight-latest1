// The dropdown in the Submissions tab is the only place an operator types the
// decision, and the server keeps its own list: the review route refuses a value
// outside it with 400, and a second module decides which of those values sends
// the artist a message. Both lists live in frontend-web, which this app cannot
// import — so the lists here are mirrors, and this file is what keeps them flat.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  OPEN_MIC_REVIEW_DECISIONS,
  OPEN_MIC_REVIEW_DECISION_LABELS,
  decisionCarriesArtistNotice,
  isOpenMicReviewDecision,
} from '@/features/openmic/review-decisions';

function webSource(relativePath: string): string {
  return readFileSync(resolve(__dirname, '../../../../frontend-web', relativePath), 'utf8');
}

describe('OPEN_MIC_REVIEW_DECISIONS', () => {
  it('is exactly the set the web review route accepts', () => {
    // frontend-web declares the runtime list once, in constants.ts, and the route
    // checks against it. Every value this console can send has to be in that
    // array — and nothing extra, or the option is a 400 waiting to happen.
    const constants = webSource('src/features/openmic/constants.ts');
    const declared = constants.slice(
      constants.indexOf('OPEN_MIC_REVIEW_STATUSES'),
      constants.indexOf('] as const', constants.indexOf('OPEN_MIC_REVIEW_STATUSES')),
    );
    for (const decision of OPEN_MIC_REVIEW_DECISIONS) {
      expect(declared).toContain(`'${decision}'`);
    }
    expect(OPEN_MIC_REVIEW_DECISIONS).toHaveLength(8);
  });

  it('labels every decision and rejects nothing in its own list', () => {
    for (const decision of OPEN_MIC_REVIEW_DECISIONS) {
      expect(OPEN_MIC_REVIEW_DECISION_LABELS[decision]).toBeTruthy();
      expect(isOpenMicReviewDecision(decision)).toBe(true);
    }
  });

  it('refuses a value the server does not know', () => {
    expect(isOpenMicReviewDecision('approved_by_accident')).toBe(false);
    expect(isOpenMicReviewDecision('')).toBe(false);
  });
});

describe('decisionCarriesArtistNotice', () => {
  it('matches the decisions frontend-web actually notifies for', () => {
    // projectReview() builds the artist notice; the decision names it keys off
    // are the whole contract behind this predicate.
    const rules = webSource('src/server/openmic/review-rules.ts');
    expect(rules).toContain("'published_for_voting'");
    expect(rules).toContain("'correction_requested'");
    for (const decision of ['published_for_voting', 'rejected', 'correction_requested']) {
      expect(decisionCarriesArtistNotice(decision)).toBe(true);
    }
    for (const decision of ['approved', 'clean_version_requested', 'disqualified', 'finalist', 'winner']) {
      expect(decisionCarriesArtistNotice(decision)).toBe(false);
    }
  });

  it('treats an unknown value as silent rather than guessing', () => {
    expect(decisionCarriesArtistNotice('nonsense')).toBe(false);
  });
});
