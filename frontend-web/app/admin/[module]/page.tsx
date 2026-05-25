import Link from 'next/link';
import { adminModules, getAdminModule } from '@/src/features/admin/modules';
import { listAuditEvents } from '@/src/server/admin/audit';

const knownCollections: Record<string, Array<Record<string, string>>> = {
  applicants: [
    { name: 'Adebayo Grace', program: 'Reality TV Show', status: 'Under Review', state: 'Lagos' },
    { name: 'Nnaemeka David', program: 'STEM Contest', status: 'Shortlisted', state: 'Anambra' },
    { name: 'Mariam Bello', program: 'SME Pitch', status: 'Missing Information', state: 'Kano' },
  ],
  contestants: [
    { name: 'Jay Rhythm', contest: 'Open Mic May Edition', stage: 'Voting Round 1', votes: '18,420' },
    { name: 'Team NeuroGrid', contest: 'STEM Challenge', stage: 'Regional Final', votes: '7,932' },
    { name: 'Laila Films', contest: 'Film Academy', stage: 'Bootcamp', votes: 'N/A' },
  ],
  'payments-finance': [
    { reference: 'SPOT-2026-001', type: 'Registration', amount: 'NGN 5,000', status: 'Successful' },
    { reference: 'SPOT-2026-002', type: 'Voting', amount: 'NGN 25,000', status: 'Successful' },
    { reference: 'SPOT-2026-003', type: 'Refund', amount: 'NGN 3,000', status: 'Processed' },
  ],
};

export default function AdminModulePage({ params }: { params: { module: string } }) {
  const buildQuickActionHref = (moduleSlug: string, action: string) => {
    const normalized = action.toLowerCase();
    if (normalized.includes('create contest')) return '/admin/contests';
    if (normalized.includes('create stem contest')) return '/admin/stem';
    if (normalized.includes('review submissions')) return '/admin/open-mic/submissions';
    if (normalized.includes('open voting') || normalized.includes('pause voting') || normalized.includes('lock results')) return '/admin/voting';
    if (normalized.includes('create program')) return '/admin/programs';
    if (normalized.includes('review applications') || normalized.includes('approve') || normalized.includes('request info')) return '/admin/applicants';
    if (normalized.includes('send') || normalized.includes('notification')) return '/admin/notifications';
    if (normalized.includes('report') || normalized.includes('export')) return '/api/admin/reports';
    if (normalized.includes('judge') || normalized.includes('score')) return '/admin/judges-scores';
    if (normalized.includes('sponsor')) return '/admin/sponsors-partners';
    if (normalized.includes('event')) return '/admin/events';
    if (normalized.includes('content') || normalized.includes('cms')) return '/admin/media-cms';
    if (normalized.includes('role') || normalized.includes('admin user')) return '/admin/users-roles';
    if (normalized.includes('audit')) return '/admin/audit-logs';
    if (normalized.includes('settings')) return '/admin/settings';
    return `/admin/${moduleSlug}`;
  };

  const createFirstRecordHref = (moduleSlug: string) => {
    if (moduleSlug === 'contests') return '/admin/contests';
    if (moduleSlug === 'open-mic') return '/admin/open-mic/contests/new';
    if (moduleSlug === 'stem') return '/admin/stem';
    if (moduleSlug === 'programs') return '/admin/programs';
    if (moduleSlug === 'events') return '/admin/events';
    if (moduleSlug === 'media-cms') return '/admin/media-cms';
    if (moduleSlug === 'notifications') return '/admin/notifications';
    if (moduleSlug === 'users-roles') return '/admin/users-roles';
    if (moduleSlug === 'settings') return '/admin/settings';
    return `/admin/${moduleSlug}`;
  };

  const renderStatusBadge = (raw: string) => {
    const value = raw.toLowerCase();
    let cls = 'badge-pending';
    if (value.includes('approved') || value.includes('successful') || value.includes('verified')) cls = 'badge-approved';
    if (value.includes('rejected') || value.includes('failed') || value.includes('disqualified')) cls = 'badge-rejected';
    if (value.includes('paid') || value.includes('processed')) cls = 'badge-paid';
    return <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${cls}`}>{raw}</span>;
  };

  const shouldRenderAsBadge = (key: string) =>
    ['status', 'payment', 'paymentstatus', 'review', 'result'].includes(key.toLowerCase());

  const module = getAdminModule(params.module);

  if (!module) {
    return (
      <section className="max-w-6xl mx-auto px-2 md:px-4">
        <div className="glass-card rounded-md p-8 text-center">
          <h1 className="font-display text-3xl text-foreground">Module Not Found</h1>
          <p className="text-foreground-muted mt-2">This module is not configured.</p>
          <Link href="/admin" className="btn-primary inline-flex mt-5">Back to Dashboard</Link>
        </div>
      </section>
    );
  }

  const rows = knownCollections[module.slug] || [];
  const audit = module.slug === 'audit-logs' ? listAuditEvents(25) : [];

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground">{module.title}</h1>
          <p className="text-foreground-muted mt-1">{module.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {module.quickActions.map((action) => (
            <Link
              key={action}
              href={buildQuickActionHref(module.slug, action)}
              className="btn-outline py-2 px-3 text-[11px]"
            >
              {action}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {module.primaryMetrics.map((metric) => (
          <div key={metric.label} className="glass-card rounded-md p-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-foreground-dim">{metric.label}</div>
            <div className="text-3xl font-bold text-foreground mt-1">{metric.value}</div>
          </div>
        ))}
      </div>

      <div className="glass-card rounded-md p-4 md:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
          <h5 className="font-display text-xl text-foreground">Operational Queue</h5>
          <div className="flex flex-wrap gap-2">
            <input className="form-input h-[40px] w-[220px]" placeholder="Search records" />
            <Link href={`/admin/${module.slug}`} className="btn-outline py-2 px-3 text-[11px]">Filter</Link>
            <Link href="/api/admin/reports" className="btn-outline py-2 px-3 text-[11px]">Export</Link>
          </div>
        </div>

        {module.slug === 'audit-logs' ? (
          audit.length === 0 ? (
            <p className="text-foreground-muted mb-0">No audit events recorded yet.</p>
          ) : (
            <div className="overflow-x-auto border border-border rounded-sm">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-bg-card">
                  <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                    <th className="py-3 px-3">Timestamp</th>
                    <th className="py-3 px-3">Admin</th>
                    <th className="py-3 px-3">Action</th>
                    <th className="py-3 px-3">Module</th>
                    <th className="py-3 px-3">Entity</th>
                    <th className="py-3 px-3">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((event) => (
                    <tr key={event.id} className="border-t border-border text-foreground-muted">
                      <td className="py-2.5 px-3">{new Date(event.timestamp).toLocaleString()}</td>
                      <td className="py-2.5 px-3">{event.adminUser}</td>
                      <td className="py-2.5 px-3">{event.action}</td>
                      <td className="py-2.5 px-3">{event.module}</td>
                      <td className="py-2.5 px-3">{event.entityType}</td>
                      <td className="py-2.5 px-3">{event.reason || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : rows.length === 0 ? (
          <div className="text-center py-10">
            <h6 className="font-display text-lg text-foreground">No records yet</h6>
            <p className="text-foreground-muted mb-3">Start by using one of the quick actions above.</p>
            <Link href={createFirstRecordHref(module.slug)} className="btn-primary py-2.5 px-4 text-[11px] inline-flex">
              Create First Record
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto border border-border rounded-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  {Object.keys(rows[0]).map((key) => (
                    <th key={key} className="py-3 px-3" style={{ textTransform: 'capitalize' }}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className="border-t border-border text-foreground-muted">
                    {Object.entries(row).map(([key, value], vIdx) => (
                      <td key={`${idx}-${vIdx}`} className="py-2.5 px-3">
                        {shouldRenderAsBadge(key) ? renderStatusBadge(value) : value}
                      </td>
                    ))}
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>
        )}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Link href="/admin/applicants" className="btn-outline py-2 px-3 text-[11px]">Bulk Action</Link>
        <Link href="/admin/settings" className="btn-primary py-2 px-3 text-[11px]">Save Changes</Link>
      </div>

      <div className="mt-4 glass-card rounded-md p-4">
        <h6 className="font-display text-foreground mb-2">Module Health Checklist</h6>
        <ul className="text-foreground-muted text-sm list-disc pl-5 space-y-1">
          <li>Validation and permission checks enabled for sensitive actions</li>
          <li>Audit logging required for overrides, publish, refunds, and status transitions</li>
          <li>Export and reporting controls available for operational governance</li>
        </ul>
      </div>

      <div className="mt-4 glass-card rounded-md p-4">
        <h6 className="font-display text-foreground mb-2">Navigate Modules</h6>
        <div className="flex flex-wrap gap-2">
          {adminModules.map((entry) => (
            <Link key={entry.slug} href={`/admin/${entry.slug}`} className="btn-outline py-2 px-3 text-[11px]">
              {entry.title}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
