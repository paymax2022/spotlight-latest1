import { notFound } from 'next/navigation';
import {
  getContestById,
  listApplications,
  listBeatDownloads,
  listFraudAlerts,
  listPaymentEvents,
  listSubmissions,
} from '@/src/server/openmic/persistence';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicReportsPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const [applications, downloads, submissions, payments, fraudAlerts] = await Promise.all([
    listApplications({ contestId: contest.id }),
    listBeatDownloads(contest.id),
    listSubmissions({ contestId: contest.id }),
    listPaymentEvents(contest.id),
    listFraudAlerts(contest.id),
  ]);

  const approvedSongs = submissions.filter((row) => ['approved', 'published_for_voting', 'finalist', 'winner'].includes(row.status)).length;
  const finalists = submissions.filter((row) => row.isFinalist).length;
  const winners = submissions.filter((row) => row.isWinner).length;
  const totalVotes = submissions.reduce((sum, row) => sum + row.voteCount, 0);
  const votingRevenue = payments
    .filter((row) => row.eventType === 'vote_payment' && row.paymentStatus === 'successful')
    .reduce((sum, row) => sum + row.amountNgn, 0);
  const entryRevenue = payments
    .filter((row) => row.eventType === 'entry_fee' && row.paymentStatus === 'successful')
    .reduce((sum, row) => sum + row.amountNgn, 0);
  const totalRevenue = votingRevenue + entryRevenue;
  const failedPayments = payments.filter((row) => row.paymentStatus === 'failed').length;

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Open Mic Reports</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Applicants</p><p className="text-2xl text-foreground font-semibold">{applications.length}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Beat Downloads</p><p className="text-2xl text-foreground font-semibold">{downloads.length}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Approved Songs</p><p className="text-2xl text-foreground font-semibold">{approvedSongs}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Total Votes</p><p className="text-2xl text-foreground font-semibold">{totalVotes}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Voting Revenue</p><p className="text-2xl text-foreground font-semibold">₦{votingRevenue}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Entry Fee Revenue</p><p className="text-2xl text-foreground font-semibold">₦{entryRevenue}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Total Revenue</p><p className="text-2xl text-foreground font-semibold">₦{totalRevenue}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Finalists</p><p className="text-2xl text-foreground font-semibold">{finalists}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Winners</p><p className="text-2xl text-foreground font-semibold">{winners}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Failed Payments</p><p className="text-2xl text-foreground font-semibold">{failedPayments}</p></div>
        <div className="glass-card rounded-md p-3"><p className="text-xs text-foreground/60">Suspicious Vote Alerts</p><p className="text-2xl text-foreground font-semibold">{fraudAlerts.length}</p></div>
      </div>
    </section>
  );
}
