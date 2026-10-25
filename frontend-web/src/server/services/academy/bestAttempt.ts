// Picks each exam's BEST graded attempt for the module-unlock gate.
//
// "Last row wins" is wrong here: a learner who passed and then retook and failed
// would re-lock the next module, and an in-progress attempt (percentage NULL)
// would overwrite a real score. Only graded attempts count; the highest
// score stands, and the earliest wins a tie so the result is stable.
//
// "Highest" compares earned/total exactly (cross-multiplied points), not the
// stored percentage, which is rounded to two decimals.

export interface AttemptRow {
  exam_id: string;
  status: string | null;
  score: number | null;
  total_points: number | null;
  percentage: number | null;
  passed: boolean | null;
}

export interface BestAttempt {
  percentage: number;
  score: number;
  totalPoints: number;
}

export function bestAttemptsByExam(rows: AttemptRow[]): Map<string, BestAttempt> {
  const best = new Map<string, BestAttempt>();
  for (const r of rows) {
    if (r.status !== 'graded' || r.percentage == null) continue;
    const candidate: BestAttempt = {
      percentage: Number(r.percentage),
      score: Number(r.score ?? 0),
      totalPoints: Number(r.total_points ?? 0),
    };
    const current = best.get(r.exam_id);
    if (current && !isHigher(candidate, current)) continue;
    best.set(r.exam_id, candidate);
  }
  return best;
}

/** a beats b when a.score/a.total > b.score/b.total; an attempt with no points never beats one with points. */
function isHigher(a: BestAttempt, b: BestAttempt): boolean {
  if (a.totalPoints <= 0) return false;
  if (b.totalPoints <= 0) return true;
  return a.score * b.totalPoints > b.score * a.totalPoints;
}
