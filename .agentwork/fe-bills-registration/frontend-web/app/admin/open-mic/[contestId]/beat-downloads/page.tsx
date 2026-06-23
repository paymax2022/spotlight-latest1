import { notFound } from 'next/navigation';
import { getContestById, listBeatDownloads } from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicBeatDownloadsPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const downloads = await listBeatDownloads(contest.id);

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Beat Download Logs</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>
      <div className="glass-card rounded-md p-4 mt-4">
        <p className="text-sm text-foreground/70 mb-3">
          Total downloads: <strong>{downloads.length}</strong>
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-foreground/70">
                <th className="py-2 pr-3">Artist</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Terms</th>
                <th className="py-2 pr-3">Paid Access</th>
                <th className="py-2 pr-3">Downloaded At</th>
              </tr>
            </thead>
            <tbody>
              {downloads.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-2 pr-3">{row.artistName}</td>
                  <td className="py-2 pr-3">{('artistEmail' in row ? row.artistEmail : '') || '-'}</td>
                  <td className="py-2 pr-3">{row.termsAccepted ? 'Accepted' : 'No'}</td>
                  <td className="py-2 pr-3">{row.paidAccessConfirmed ? 'Confirmed' : 'Not Confirmed'}</td>
                  <td className="py-2 pr-3">{row.downloadedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
