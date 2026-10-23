import { describe, it, expect } from 'vitest';
import { bestAttemptsByExam, type AttemptRow } from '@/src/server/services/academy/bestAttempt';

const row = (over: Partial<AttemptRow>): AttemptRow => ({
  exam_id: 'e1', status: 'graded', score: 0, total_points: 4, percentage: 0, passed: false, ...over,
});

describe('bestAttemptsByExam', () => {
  it('keeps the pass when a later retake scores lower', () => {
    const best = bestAttemptsByExam([
      row({ percentage: 100, score: 4 }),
      row({ percentage: 50, score: 2 }),
    ]);
    expect(best.get('e1')?.percentage).toBe(100);
  });

  it('keeps the highest regardless of row order', () => {
    const best = bestAttemptsByExam([
      row({ percentage: 50, score: 2 }),
      row({ percentage: 100, score: 4 }),
      row({ percentage: 75, score: 3 }),
    ]);
    expect(best.get('e1')?.percentage).toBe(100);
    expect(best.get('e1')?.score).toBe(4);
  });

  it('ignores in-progress attempts so they cannot overwrite a score', () => {
    const best = bestAttemptsByExam([
      row({ percentage: 100, score: 4 }),
      row({ status: 'submitted', percentage: null, score: null }),
    ]);
    expect(best.get('e1')?.percentage).toBe(100);
  });

  it('has no entry for an exam with only in-progress attempts', () => {
    const best = bestAttemptsByExam([row({ status: 'submitted', percentage: null })]);
    expect(best.has('e1')).toBe(false);
  });

  it('keeps exams separate', () => {
    const best = bestAttemptsByExam([
      row({ exam_id: 'e1', percentage: 90 }),
      row({ exam_id: 'e2', percentage: 40 }),
    ]);
    expect(best.get('e1')?.percentage).toBe(90);
    expect(best.get('e2')?.percentage).toBe(40);
  });
});
