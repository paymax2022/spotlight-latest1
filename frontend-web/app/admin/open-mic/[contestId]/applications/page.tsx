import { notFound } from 'next/navigation';
import { getContestById, listApplications } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicApplicationsPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const applications = await listApplications({ contestId: contest.id });

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Manage Applications</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>
      <div className="overflow-x-auto mt-4 glass-card rounded-md p-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-foreground/70">
              <th className="py-2 pr-3">Artist</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Phone</th>
              <th className="py-2 pr-3">Application Status</th>
              <th className="py-2 pr-3">Payment Status</th>
              <th className="py-2 pr-3">Beat Download</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2 pr-3">{row.stageName}</td>
                <td className="py-2 pr-3">{row.email || '-'}</td>
                <td className="py-2 pr-3">{row.phone || '-'}</td>
                <td className="py-2 pr-3">{row.applicationStatus.replace(/_/g, ' ')}</td>
                <td className="py-2 pr-3">{row.paymentStatus.replace(/_/g, ' ')}</td>
                <td className="py-2 pr-3">{row.beatDownloadStatus.replace(/_/g, ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {applications.length === 0 ? <p className="text-foreground/60 mt-2">No applications yet.</p> : null}
      </div>
    </section>
  );
}
