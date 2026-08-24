'use client';

// One learner's submission, with the grading form inline.
//
// The score is bounded by the assignment's own max_score both here and on the
// server. Client-side it is guidance; the server rejects out-of-range scores
// outright, because a silently clamped mark corrupts any average built from it.

import { useState } from 'react';
import { adminAuthHeaders } from '@/src/lib/auth/client';

type Submission = {
  id: string;
  submission_link: string | null;
  submission_text: string | null;
  submitted_at: string | null;
  score: number | null;
  grade: string | null;
  feedback: string | null;
  status: string | null;
  academy_assignments?: { title?: string; max_score?: number; due_date?: string } | null;
  academy_enrollments?: { academy_applications?: { full_name?: string; email?: string } | null } | null;
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function GradeSubmissionRow({ submission }: { submission: Submission }) {
  const maxScore = Number(submission.academy_assignments?.max_score ?? 100);
  const learner = submission.academy_enrollments?.academy_applications;

  const [score, setScore] = useState<string>(
    submission.score !== null && submission.score !== undefined ? String(submission.score) : '',
  );
  const [grade, setGrade] = useState(submission.grade ?? '');
  const [feedback, setFeedback] = useState(submission.feedback ?? '');
  const [status, setStatus] = useState(submission.status ?? 'submitted');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const save = async () => {
    setError(null);
    const n = Number(score);
    if (score === '' || !Number.isFinite(n)) {
      setError('Enter a score.');
      return;
    }
    if (n < 0 || n > maxScore) {
      setError(`Score must be between 0 and ${maxScore}.`);
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/admin/academy/submissions', {
        method: 'PATCH',
        headers: await adminAuthHeaders(true),
        body: JSON.stringify({
          submissionId: submission.id,
          score: n,
          grade: grade || undefined,
          feedback: feedback || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || 'Could not save this grade.');
        return;
      }
      setStatus('graded');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const graded = status === 'graded';

  return (
    <div className="rounded border border-foreground/10 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-foreground font-medium">
            {submission.academy_assignments?.title ?? 'Assignment'}
          </p>
          <p className="text-sm text-foreground/50">
            {learner?.full_name ?? 'Unknown learner'}
            {learner?.email ? ` · ${learner.email}` : ''}
          </p>
          <p className="text-xs text-foreground/40 mt-1">
            Submitted {formatDate(submission.submitted_at)} · due{' '}
            {formatDate(submission.academy_assignments?.due_date)}
          </p>
        </div>
        <span
          className="text-xs px-2 py-1 rounded whitespace-nowrap"
          style={{
            background: graded ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
            color: graded ? '#10b981' : '#f59e0b',
          }}
        >
          {graded ? `${submission.score ?? score}/${maxScore}` : 'Awaiting grade'}
        </span>
      </div>

      {submission.submission_link && (
        <a
          href={submission.submission_link}
          target="_blank"
          rel="noopener noreferrer"
          className="block mt-3 text-sm text-amber-400 underline break-all"
        >
          {submission.submission_link}
        </a>
      )}

      {submission.submission_text && (
        <p className="mt-3 text-sm text-foreground/70 whitespace-pre-wrap">
          {submission.submission_text}
        </p>
      )}

      {!open ? (
        <button onClick={() => setOpen(true)} className="btn-outline py-1.5 px-3 text-sm mt-4">
          {graded ? 'Change grade' : 'Grade this'}
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex gap-3">
            <label className="flex-1">
              <span className="block text-xs text-foreground/50 mb-1">Score (max {maxScore})</span>
              <input
                type="number"
                min={0}
                max={maxScore}
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="w-full bg-transparent border border-foreground/20 rounded px-3 py-2 text-sm"
              />
            </label>
            <label className="flex-1">
              <span className="block text-xs text-foreground/50 mb-1">Grade (optional)</span>
              <input
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                placeholder="A, Merit, Pass…"
                className="w-full bg-transparent border border-foreground/20 rounded px-3 py-2 text-sm"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-xs text-foreground/50 mb-1">Feedback</span>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={3}
              placeholder="What worked, what to improve…"
              className="w-full bg-transparent border border-foreground/20 rounded px-3 py-2 text-sm"
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="btn-primary py-1.5 px-4 text-sm">
              {busy ? 'Saving…' : 'Save grade'}
            </button>
            <button onClick={() => setOpen(false)} className="btn-outline py-1.5 px-4 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
