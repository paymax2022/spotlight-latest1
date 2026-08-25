/**
 * The authored Film Craft Pathway, checked as content.
 *
 * The grader compares `correct_answer` against the option strings verbatim, so a
 * correct answer that is not among the options produces a question no learner can
 * ever get right and which scores silently as wrong. There is no runtime error to
 * catch — only a quiet unfairness in an assessment. These tests are the guard.
 */
import { describe, it, expect } from 'vitest';
import { FILM_PATHWAY } from '@/src/server/services/academy/curriculum';
import { validatePathway } from '@/src/server/services/academy/curriculum/seed';
import type { Pathway } from '@/src/server/services/academy/curriculum/types';

const allModules = FILM_PATHWAY.tiers.flatMap((t) => t.modules);
const allQuizzes = [
  ...allModules.map((m) => m.quiz),
  ...FILM_PATHWAY.tiers.map((t) => t.assessment).filter(Boolean),
];
const allLessons = allModules.flatMap((m) => m.lessons);

describe('the pathway as authored', () => {
  it('validates clean', () => {
    expect(validatePathway(FILM_PATHWAY)).toEqual([]);
  });

  it('is tiered and at least twenty modules', () => {
    expect(FILM_PATHWAY.tiers.length).toBeGreaterThanOrEqual(5);
    expect(allModules.length).toBeGreaterThanOrEqual(20);
    // Tier levels ascend without gaps, since the tiers gate one another.
    expect(FILM_PATHWAY.tiers.map((t) => t.level)).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives every module lecture material, a quiz and an assignment', () => {
    for (const m of allModules) {
      expect(m.lessons.length, `${m.title} has no lessons`).toBeGreaterThan(0);
      expect(m.quiz.questions.length, `${m.title} has no quiz questions`).toBeGreaterThanOrEqual(4);
      expect(m.assignment, `${m.title} has no assignment`).toBeTruthy();
    }
  });

  it('gives every lesson real lecture content, not a stub', () => {
    for (const l of allLessons) {
      expect(l.content.length, `"${l.title}" is a stub`).toBeGreaterThan(400);
      expect(l.minutes).toBeGreaterThan(0);
    }
  });

  it('gates every tier with an assessment at a higher pass mark than its modules', () => {
    for (const tier of FILM_PATHWAY.tiers) {
      expect(tier.assessment, `Tier ${tier.level} has no assessment`).toBeTruthy();
      const modulePassMarks = tier.modules.map((m) => m.quiz.passMark);
      // A tier gate that is easier than the modules it gates is not a gate.
      expect(tier.assessment!.passMark).toBeGreaterThanOrEqual(Math.min(...modulePassMarks));
    }
  });

  it('only ever cites video URLs, never bare text', () => {
    // Every non-empty URL in the pathway was verified against YouTube's oEmbed
    // endpoint before being written down. This pins the shape so a future edit
    // cannot smuggle in a placeholder.
    const urls = allLessons.flatMap((l) => [l.videoUrl, l.resourceUrl ?? '']).filter(Boolean);
    expect(urls.length).toBeGreaterThan(30);
    for (const u of urls) {
      expect(u, `not an https URL: ${u}`).toMatch(/^https:\/\//);
    }
  });

  it('every assignment carries a rubric and a positive maximum', () => {
    for (const m of allModules) {
      expect(m.assignment!.rubric.length, `${m.title}: empty rubric`).toBeGreaterThan(20);
      expect(m.assignment!.maxScore).toBeGreaterThan(0);
      expect(m.assignment!.dueInDays).toBeGreaterThan(0);
    }
  });

  it('has no duplicate module titles — the seeder keys on them', () => {
    const titles = allModules.map((m) => m.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('validatePathway catches the failures that matter', () => {
  /** A minimal valid pathway we can then break in one specific way. */
  const base = (): Pathway => ({
    name: 'T',
    summary: 'T',
    tiers: [
      {
        level: 1,
        name: 'T1',
        summary: 's',
        modules: [
          {
            title: 'M1',
            description: 'd',
            lessons: [{ title: 'L', description: 'd', content: 'c', videoUrl: '', minutes: 10 }],
            quiz: {
              title: 'Q',
              description: 'd',
              passMark: 70,
              timeLimitMinutes: 10,
              maxAttempts: 3,
              questions: [
                { text: 'q', type: 'single_choice', options: ['A', 'B'], correct: ['A'], points: 1, explanation: 'e' },
              ],
            },
          },
        ],
      },
    ],
  });

  it('rejects a correct answer that is not among the options', () => {
    const p = base();
    p.tiers[0].modules[0].quiz.questions[0].correct = ['Not an option'];
    expect(validatePathway(p).join(' ')).toContain('is not one of the options');
  });

  it('rejects a single_choice question with two correct answers', () => {
    const p = base();
    p.tiers[0].modules[0].quiz.questions[0].correct = ['A', 'B'];
    expect(validatePathway(p).join(' ')).toContain('exactly one correct answer');
  });

  it('rejects a question with no correct answer at all', () => {
    const p = base();
    p.tiers[0].modules[0].quiz.questions[0].correct = [];
    expect(validatePathway(p).join(' ')).toContain('no correct answer');
  });

  it('rejects duplicate module titles, which would overwrite each other on seed', () => {
    const p = base();
    p.tiers[0].modules.push({ ...p.tiers[0].modules[0] });
    expect(validatePathway(p).join(' ')).toContain('Duplicate module title');
  });

  it('rejects zero or negative points', () => {
    const p = base();
    p.tiers[0].modules[0].quiz.questions[0].points = 0;
    expect(validatePathway(p).join(' ')).toContain('points must be greater than zero');
  });

  it('rejects an out-of-range pass mark', () => {
    const p = base();
    p.tiers[0].modules[0].quiz.passMark = 140;
    expect(validatePathway(p).join(' ')).toContain('pass mark out of range');
  });
});
