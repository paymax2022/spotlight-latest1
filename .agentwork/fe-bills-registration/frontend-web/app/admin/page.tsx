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
    ['Total Applicants', String(totalApplicants), '+12.4%', 'fa-users'],
    ['Approved Applications', String(approved), '+8.1%', 'fa-user-check'],
    ['Pending Applications', String(pending), '-2.6%', 'fa-clock'],
    ['Registration Revenue', fmtNgn(registrationRevenue), '+18.2%', 'fa-wallet'],
  ];

  const quickActions = [
    { label: 'Create Contest', href: '/admin/contests' },
    { label: 'Create Program', href: '/admin/programs' },
    { label: 'Review Applications', href: '/admin/applicants' },
    { label: 'Publish Voting Round', href: '/admin/voting' },
    { label: 'Manage Utility Payments', href: '/admin/utility' },
    { label: 'Create Open Mic Contest', href: '/admin/open-mic/contests/new' },
    { label: 'Create STEM Contest', href: '/admin/stem' },
    { label: 'Send Notification', href: '/admin/notifications' },
    { label: 'Generate Report', href: '/admin/reports-analytics' },
  ];

  return (
    <section className="pb-6">
      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr_1fr] gap-4 mb-4">
        <div className="glass-card relative p-4 md:p-5 overflow-hidden" style={{ background: 'linear-gradient(135deg, #7367f0 0%, #655bd8 100%)', color: '#fff', minHeight: 236 }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl text-white mb-1">Spotlight Analytics</h1>
              <p className="text-white/85 mb-0">Programs, utility payments, voting and applicant operations.</p>
            </div>
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full bg-white/55" />
              <span className="w-2 h-2 rounded-full bg-white" />
              <span className="w-2 h-2 rounded-full bg-white/55" />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8 max-w-3xl">
            <div>
              <div className="text-white/80 text-sm font-semibold">Active Contests</div>
              <div className="mt-3 inline-flex items-center gap-2">
                <span className="rounded-md bg-white/15 px-3 py-2 font-bold">{openMicContests.length + stemContests.length}</span>
                <span className="font-semibold">Live</span>
              </div>
            </div>
            <div>
              <div className="text-white/80 text-sm font-semibold">Submissions</div>
              <div className="mt-3 inline-flex items-center gap-2">
                <span className="rounded-md bg-white/15 px-3 py-2 font-bold">{openMicSubmissions.length}</span>
                <span className="font-semibold">Open Mic</span>
              </div>
            </div>
            <div>
              <div className="text-white/80 text-sm font-semibold">Paid Registrations</div>
              <div className="mt-3 inline-flex items-center gap-2">
                <span className="rounded-md bg-white/15 px-3 py-2 font-bold">{paidRegistrations}</span>
                <span className="font-semibold">Orders</span>
              </div>
            </div>
            <div>
              <div className="text-white/80 text-sm font-semibold">Rejected</div>
              <div className="mt-3 inline-flex items-center gap-2">
                <span className="rounded-md bg-white/15 px-3 py-2 font-bold">{rejected}</span>
                <span className="font-semibold">Cases</span>
              </div>
            </div>
          </div>
          <div
            aria-hidden="true"
            className="d-none d-lg-block"
            style={{
              position: 'absolute',
              right: 54,
              bottom: 32,
              width: 132,
              height: 132,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.55), rgba(255,255,255,0.1) 28%, rgba(47,43,61,0.22) 29%, rgba(47,43,61,0.1) 100%)',
              boxShadow: 'inset -22px -24px 44px rgba(47,43,61,0.18), 0 20px 55px rgba(47,43,61,0.22)',
            }}
          />
        </div>

        <div className="glass-card p-4 md:p-5">
          <h2 className="font-display text-xl mb-1">Average Daily Sales</h2>
          <p className="text-foreground-muted mb-2">Total revenue this month</p>
          <div className="text-3xl font-bold text-foreground">{fmtNgn(registrationRevenue || 0)}</div>
          <div className="mt-4" style={{ height: 82, borderRadius: 6, background: 'linear-gradient(180deg, rgba(40,199,111,0.18), rgba(40,199,111,0.02))' }} />
        </div>

        <div className="glass-card p-4 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-foreground-muted mb-1">Operations Overview</p>
              <div className="text-3xl font-bold text-foreground">{totalApplicants}</div>
            </div>
            <span className="text-sm font-bold" style={{ color: '#28c76f' }}>+18.2%</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <div>
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-md" style={{ background: 'rgba(0,207,232,0.14)', color: '#00cfe8' }}>
                <i className="fa-solid fa-user-check" />
              </div>
              <div className="font-bold text-foreground mt-2">{approved}</div>
              <div className="text-sm text-foreground-muted">Approved</div>
            </div>
            <div>
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-md" style={{ background: 'rgba(255,159,67,0.14)', color: '#ff9f43' }}>
                <i className="fa-solid fa-clock" />
              </div>
              <div className="font-bold text-foreground mt-2">{pending}</div>
              <div className="text-sm text-foreground-muted">Pending</div>
            </div>
          </div>
          <div className="mt-4 h-2 rounded-full overflow-hidden" style={{ background: '#ebe9f1' }}>
            <div className="h-full" style={{ width: '72%', background: 'linear-gradient(90deg, #00cfe8, #7367f0)' }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
        {cards.map(([label, value, trend, icon]) => (
          <div key={label} className="glass-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm text-foreground-muted">{label}</div>
                <div className="text-3xl font-bold text-foreground mt-2">{value}</div>
              </div>
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-md" style={{ background: 'rgba(115,103,240,0.13)', color: '#7367f0' }}>
                <i className={`fa-solid ${icon}`} />
              </div>
            </div>
            <div className="mt-3 text-sm font-bold" style={{ color: String(trend).startsWith('-') ? '#ff4c51' : '#28c76f' }}>{trend}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
