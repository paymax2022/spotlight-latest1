import Link from 'next/link';
import { listRegistrationApplications } from '@/src/server/registration/store';
import { listContests, listSubmissions } from '@/src/server/openmic/store';
import { listStemAdminContests, listStemApplications } from '@/src/server/stem/store';

function fmtNgn(value: number) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(value);
}

export default function AdminDashboardPage() {
  const registrations = listRegistrationApplications();
  const openMicContests = listContests({ includeNonPublic: true });
  const openMicSubmissions = listSubmissions();
  const stemContests = listStemAdminContests();
  const stemApplications = listStemApplications();

  const totalApplicants = registrations.length + stemApplications.length;
  const approved =
    registrations.filter((r) => ['approved', 'shortlisted'].includes(r.status)).length +
    stemApplications.filter((a) => ['approved', 'shortlisted'].includes(a.status)).length;
  const pending =
    registrations.filter((r) => ['draft', 'under_review', 'submitted'].includes(r.status)).length +
    stemApplications.filter((a) => ['draft', 'under_review', 'submitted'].includes(a.status)).length;
  const rejected =
    registrations.filter((r) => r.status === 'rejected').length +
    stemApplications.filter((a) => a.status === 'rejected').length;

  const paidRegistrations = registrations.filter((r) => String(r.formData['payment.paymentStatus'] || '') === 'paid').length;
  const registrationRevenue = registrations.reduce((sum, row) => {
    const paid = String(row.formData['payment.paymentStatus'] || '') === 'paid';
    const amount = Number(row.formData['payment.feeAmount'] || 0);
    return sum + (paid ? amount : 0);
  }, 0);

  const cards = [
    ['Total Applicants', String(totalApplicants)],
    ['Approved Applications', String(approved)],
    ['Pending Applications', String(pending)],
    ['Rejected Applications', String(rejected)],
    ['Active Contests', String(openMicContests.length + stemContests.length)],
    ['Open Mic Submissions', String(openMicSubmissions.length)],
    ['Paid Registrations', String(paidRegistrations)],
    ['Registration Revenue', fmtNgn(registrationRevenue)],
  ];

  const quickActions = [
    { label: 'Create Contest', href: '/admin/contests' },
    { label: 'Create Program', href: '/admin/programs' },
    { label: 'Review Applications', href: '/admin/applicants' },
    { label: 'Publish Voting Round', href: '/admin/voting' },
    { label: 'Create Open Mic Contest', href: '/admin/open-mic/contests/new' },
    { label: 'Create STEM Contest', href: '/admin/stem' },
    { label: 'Send Notification', href: '/admin/notifications' },
    { label: 'Generate Report', href: '/admin/reports-analytics' },
  ];

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <div className="mb-6">
        <h1 className="font-display text-3xl md:text-4xl text-foreground mb-1">Dashboard</h1>
        <p className="text-foreground-muted">Central command center for Spotlight programs, contests, finance and operations.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        {cards.map(([label, value]) => (
          <div key={label} className="glass-card rounded-md p-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">{label}</div>
            <div className="text-3xl font-bold text-foreground mt-1">{value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-6">
        <div className="xl:col-span-2 glass-card rounded-md p-4">
          <h5 className="font-display text-xl text-foreground">Quick Actions</h5>
          <div className="flex flex-wrap gap-2 mt-3">
            {quickActions.map((action) => (
              <Link key={action.label} href={action.href} className="btn-outline py-2 px-3 text-[11px]">
                {action.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-md p-4">
          <h5 className="font-display text-xl text-foreground">System Alerts</h5>
          <ul className="text-sm text-foreground-muted mt-3 list-disc pl-5 space-y-2">
            <li>2 contests in draft with start date in the past.</li>
            <li>Voting spike anomaly detected for 1 active contest.</li>
            <li>4 payment records awaiting reconciliation.</li>
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="glass-card rounded-md p-4">
          <h5 className="font-display text-xl text-foreground">Open Mic Pipeline</h5>
          <p className="text-foreground-muted text-sm mt-1">Monthly beat contests and submission queue.</p>
          <ul className="text-sm text-foreground-muted mt-3 list-disc pl-5 space-y-2">
            {openMicContests.slice(0, 6).map((contest) => (
              <li key={contest.id}>{contest.title} - {contest.status.replace(/_/g, ' ')}</li>
            ))}
          </ul>
        </div>

        <div className="glass-card rounded-md p-4">
          <h5 className="font-display text-xl text-foreground">STEM Contest Pipeline</h5>
          <p className="text-foreground-muted text-sm mt-1">School and innovator tracks with configurable rounds.</p>
          <ul className="text-sm text-foreground-muted mt-3 list-disc pl-5 space-y-2">
            {stemContests.slice(0, 6).map((contest) => (
              <li key={contest.id}>{contest.title} - {contest.status.replace(/_/g, ' ')}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
