import { notFound } from 'next/navigation';
import { getContestById, listPaymentEvents } from '@/src/server/openmic/persistence';
import PaymentsModerationTable from '@/components/openmic/admin/PaymentsModerationTable';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicPaymentsPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const events = await listPaymentEvents(contest.id);

  const entryTotal = events
    .filter((row) => row.eventType === 'entry_fee' && row.paymentStatus === 'successful')
    .reduce((sum, row) => sum + row.amountNgn, 0);
  const voteTotal = events
    .filter((row) => row.eventType === 'vote_payment' && row.paymentStatus === 'successful')
    .reduce((sum, row) => sum + row.amountNgn, 0);

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Payment Events</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Total Events</p>
          <p className="text-2xl text-foreground font-semibold">{events.length}</p>
        </div>
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Entry Fee Revenue</p>
          <p className="text-2xl text-foreground font-semibold">₦{entryTotal}</p>
        </div>
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Voting Revenue</p>
          <p className="text-2xl text-foreground font-semibold">₦{voteTotal}</p>
        </div>
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Failed Events</p>
          <p className="text-2xl text-foreground font-semibold">{events.filter((row) => row.paymentStatus === 'failed').length}</p>
        </div>
      </div>

      <div className="mt-4">
        <a
          href={`/api/admin/open-mic/contests/${contest.id}/payments?format=csv`}
          className="btn-outline py-1.5 px-2 text-[11px]"
        >
          Export CSV
        </a>
      </div>
      <PaymentsModerationTable contestId={contest.id} rows={events} />
    </section>
  );
}
