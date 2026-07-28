import Link from 'next/link';
import { listContests, listSubmissions } from '@/src/server/openmic/persistence';
import OpenMicContestManager from '@/components/openmic/OpenMicContestManager';
import { hasUsableSupabaseConfig } from '@/src/lib/supabase/runtime';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicPage() {
  const badgeClass = (status: string) => {
    const value = status.toLowerCase();
    if (value.includes('published') || value.includes('live') || value.includes('approved')) return 'badge-approved';
    if (value.includes('rejected') || value.includes('disqualified') || value.includes('failed')) return 'badge-rejected';
    if (value.includes('paid')) return 'badge-paid';
    return 'badge-pending';
  };

  const contests = await listContests({ includeNonPublic: true });
  const submissions = await listSubmissions();
  const dbConfigured = hasUsableSupabaseConfig();

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl md:text-4xl text-foreground">Admin Open Mic Console</h1>
      <p className="text-foreground-muted mt-1">
        Monthly contest builder, recurrence, beat upload, submission review, finalist generation,
        and winner announcement.
      </p>
      <div className="flex gap-2 mb-4 mt-3 flex-wrap">
        <Link href="/admin/open-mic/contests/new" className="btn-primary py-2.5 px-4 text-[11px]">Create Contest Edition</Link>
        <Link href="/admin/open-mic/submissions" className="btn-outline py-2.5 px-4 text-[11px]">Review Submissions</Link>
      </div>

      <section className="my-4 p-4 glass-card rounded-md">
        <h3 className="font-display text-foreground mb-3">Manage Created Open Mic Contests</h3>
        {!dbConfigured ? (
          <p className="text-sm text-amber-300 mb-3">
            Open Mic is running in DB-only mode. Configure valid Supabase keys in <code>frontend-web/.env.local</code> to load records.
          </p>
        ) : null}
        <OpenMicContestManager />
      </section>

      <section className="my-4 p-4 glass-card rounded-md">
        <h3 className="font-display text-foreground">Contest Editions</h3>
        <ul className="mb-0 mt-3 text-sm text-foreground-muted list-disc pl-5 space-y-1">
          {contests.map((contest) => (
            <li key={contest.id}>
              {contest.title} - <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(contest.status)}`}>{contest.status.replace(/_/g, ' ')}</span> - {contest.month}/{contest.year}
            </li>
          ))}
        </ul>
      </section>

      <section className="my-4 p-4 glass-card rounded-md">
        <h3 className="font-display text-foreground">Submission Queue</h3>
        <ul className="mb-0 mt-3 text-sm text-foreground-muted list-disc pl-5 space-y-1">
          {submissions.slice(0, 20).map((submission) => (
            <li key={submission.id}>
              {submission.songTitle} - {submission.stageName} - <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(submission.status)}`}>{submission.status.replace(/_/g, ' ')}</span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
