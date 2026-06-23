import { notFound } from 'next/navigation';
import { getContestById, listNotifications } from '@/src/server/openmic/persistence';
import NotificationsModerationTable from '@/components/openmic/admin/NotificationsModerationTable';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicNotificationsPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const notifications = await listNotifications(contest.id);

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Open Mic Notifications</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Total Notifications</p>
          <p className="text-2xl text-foreground font-semibold">{notifications.length}</p>
        </div>
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Artist Notifications</p>
          <p className="text-2xl text-foreground font-semibold">{notifications.filter((n) => n.audience === 'artist').length}</p>
        </div>
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Admin Notifications</p>
          <p className="text-2xl text-foreground font-semibold">{notifications.filter((n) => n.audience === 'admin').length}</p>
        </div>
      </div>

      <div className="mt-4">
        <a
          href={`/api/admin/open-mic/contests/${contest.id}/notifications?format=csv`}
          className="btn-outline py-1.5 px-2 text-[11px]"
        >
          Export CSV
        </a>
      </div>
      <NotificationsModerationTable contestId={contest.id} rows={notifications} />
    </section>
  );
}
