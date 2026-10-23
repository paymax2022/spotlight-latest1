// Picks each exam's BEST graded attempt for the module-unlock gate.
//
// "Last row wins" is wrong here: a learner who passed and then retook and failed
// would re-lock the next module, and an in-progress attempt (percentage NULL)
// would overwrite a real score. Only graded attempts count; the highest
// percentage stands, and the earliest wins a tie so the result is stable.

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
    const current = best.get(r.exam_id);
    if (current && current.percentage >= Number(r.percentage)) continue;
    best.set(r.exam_id, {
      percentage: Number(r.percentage),
      score: Number(r.score ?? 0),
      totalPoints: Number(r.total_points ?? 0),
    });
  }
  return best;
}
