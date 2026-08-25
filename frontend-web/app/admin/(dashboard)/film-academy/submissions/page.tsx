import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/src/lib/auth/server';
import GradeSubmissionRow from '@/components/academy/admin/GradeSubmissionRow';

export const dynamic = 'force-dynamic';

type PageProps = { searchParams?: Promise<{ status?: string }> };

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'submitted', label: 'Awaiting grade' },
  { key: 'graded', label: 'Graded' },
];

export default async function AcademySubmissionsPage({ searchParams }: PageProps) {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?next=/admin/film-academy/submissions');
  }

  // Next 16: searchParams is a Promise.
  const params = (await searchParams) ?? {};
  const status = params.status || '';

  const supabase = createAdminClient();
  let query = supabase
    .from('academy_assignment_submissions')
    .select(
      'id, assignment_id, submission_link, submission_text, submitted_at, score, grade, feedback, reviewed_at, status, ' +
        'academy_assignments(title, max_score, due_date), ' +
        'academy_enrollments(academy_applications(full_name, email))',
    )
    .order('submitted_at', { ascending: false })
    .limit(200);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  const submissions = (data ?? []) as any[];

  const awaiting = submissions.filter((s) => s.status !== 'graded').length;

  return (
    <div className="max-w-6xl mx-auto px-4 pb-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl text-foreground">Assignment submissions</h1>
          <p className="text-foreground/50 mt-1">
            {awaiting} awaiting a grade of {submissions.length} shown
          </p>
        </div>
        <Link href="/admin/film-academy" className="btn-outline py-2 px-4 text-sm">
          Back to Film Academy
        </Link>
      </div>

      <div className="flex gap-2 mb-6">
        {FILTERS.map((f) => (
          <Link
            key={f.key || 'all'}
            href={f.key ? `/admin/film-academy/submissions?status=${f.key}` : '/admin/film-academy/submissions'}
            className={`py-1.5 px-3 text-sm rounded ${
              status === f.key ? 'btn-primary' : 'btn-outline'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          Could not load submissions: {error.message}
        </div>
      )}

      {!error && submissions.length === 0 && (
        <div className="rounded border border-foreground/10 p-8 text-center text-foreground/50">
          Nothing here yet. Submissions appear once learners send in their work.
        </div>
      )}

      <div className="space-y-3">
        {submissions.map((s) => (
          <GradeSubmissionRow key={s.id} submission={s} />
        ))}
      </div>
    </div>
  );
}
