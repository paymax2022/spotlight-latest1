import { notFound } from 'next/navigation';
import { getContestById, listFraudAlerts } from '@/src/server/openmic/persistence';
import FraudAlertsModerationTable from '@/components/openmic/admin/FraudAlertsModerationTable';

export const dynamic = 'force-dynamic';

export default async function AdminOpenMicFraudAlertsPage({ params }: { params: { contestId: string } }) {
  const contest = await getContestById(params.contestId);
  if (!contest) notFound();
  const alerts = await listFraudAlerts(contest.id);

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <h1 className="font-display text-3xl text-foreground">Suspicious Voting Alerts</h1>
      <p className="text-foreground-muted mt-1">{contest.title}</p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mt-4">
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Total Alerts</p>
          <p className="text-2xl text-foreground font-semibold">{alerts.length}</p>
        </div>
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">High Severity</p>
          <p className="text-2xl text-foreground font-semibold">{alerts.filter((a) => a.severity === 'high').length}</p>
        </div>
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Medium Severity</p>
          <p className="text-2xl text-foreground font-semibold">{alerts.filter((a) => a.severity === 'medium').length}</p>
        </div>
        <div className="glass-card rounded-md p-3">
          <p className="text-xs text-foreground/60">Low Severity</p>
          <p className="text-2xl text-foreground font-semibold">{alerts.filter((a) => a.severity === 'low').length}</p>
        </div>
      </div>

      <div className="mt-4">
        <a
          href={`/api/admin/open-mic/contests/${contest.id}/fraud-alerts?format=csv`}
          className="btn-outline py-1.5 px-2 text-[11px]"
        >
          Export CSV
        </a>
      </div>
      <FraudAlertsModerationTable contestId={contest.id} rows={alerts.map((row) => ({ ...row, severity: row.severity }))} />
    </section>
  );
}
