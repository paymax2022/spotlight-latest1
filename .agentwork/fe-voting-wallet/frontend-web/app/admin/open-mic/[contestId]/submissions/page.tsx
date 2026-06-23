import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContestById, listSubmissions } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicContestSubmissionsPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const submissions = await listSubmissions({ contestId: contest.id });

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Manage Song Submissions</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>
      <div className="mt-3">
        <Link href="/admin/open-mic/submissions" className="btn-outline py-2 px-3 text-xs">Open Submission Review Console</Link>
      </div>

      <div className="glass-card rounded-md p-4 mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-foreground/70">
              <th className="py-2 pr-3">Artist</th>
              <th className="py-2 pr-3">Song</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Votes</th>
              <th className="py-2 pr-3">Public Link</th>
            </tr>
          </thead>
          <tbody>
            {submissions.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2 pr-3">{row.stageName}</td>
                <td className="py-2 pr-3">{row.songTitle}</td>
                <td className="py-2 pr-3">{row.status.replace(/_/g, ' ')}</td>
                <td className="py-2 pr-3">{row.voteCount}</td>
                <td className="py-2 pr-3">
                  <Link href={`/open-mic/${contest.slug}/entry/${row.stageName.toLowerCase().replace(/\s+/g, '-')}`} className="text-accent-gold">
                    View Entry
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
