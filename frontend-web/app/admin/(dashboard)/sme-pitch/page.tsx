import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/src/lib/auth/server';
import { listRegistrationApplications, listRegistrationContests } from '@/src/server/registration/store';

export const dynamic = 'force-dynamic';

function badgeClass(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('approved') || normalized.includes('submitted') || normalized.includes('shortlisted')) return 'badge-approved';
  if (normalized.includes('rejected') || normalized.includes('failed') || normalized.includes('disqualified')) return 'badge-rejected';
  if (normalized.includes('paid')) return 'badge-paid';
  return 'badge-pending';
}

export default async function AdminSmePitchPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/login?next=/admin/sme-pitch');
  }

  const contests = listRegistrationContests().filter((contest) => contest.contestCategory === 'sme_pitch');
  const applications = listRegistrationApplications({ contestCategory: 'sme_pitch' });
  const contestSlugs = new Set(contests.map((contest) => contest.slug));

  const stats = {
    contests: contests.length,
    applications: applications.length,
    submitted: applications.filter((app) => app.status !== 'draft').length,
    shortlisted: applications.filter((app) => ['shortlisted', 'approved', 'selected_for_bootcamp'].includes(app.status)).length,
  };

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-3xl md:text-4xl text-foreground">SME Pitch Admin Console</h1>
          <p className="text-foreground-muted mt-1">
            Create and manage SME pitch contests, registration fees, pitch locations, team entry settings, and founder applications.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/sme-pitch/contests/new" className="btn-primary py-2.5 px-4 text-[11px]">Create Pitch Contest</Link>
          <Link href="/api/admin/reports" className="btn-outline py-2.5 px-4 text-[11px]">Export Report</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/50">Pitch Contests</p><p className="text-3xl font-bold text-foreground mt-1">{stats.contests}</p></div>
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/50">Applications</p><p className="text-3xl font-bold text-foreground mt-1">{stats.applications}</p></div>
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/50">Submitted</p><p className="text-3xl font-bold text-foreground mt-1">{stats.submitted}</p></div>
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/50">Shortlisted</p><p className="text-3xl font-bold text-foreground mt-1">{stats.shortlisted}</p></div>
      </div>

      <div className="glass-card rounded-md overflow-hidden mb-6">
        <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">SME Pitch Contests</h2>
          <Link href="/admin/sme-pitch/contests/new" className="btn-outline py-1.5 px-3 text-[11px]">Create New</Link>
        </div>

        {contests.length === 0 ? (
          <div className="p-10 text-center">
            <h3 className="font-display text-xl text-foreground">No SME pitch contests yet</h3>
            <p className="text-foreground-muted mt-1 mb-4">Create a pitch contest so founders can apply through the registration flow.</p>
            <Link href="/admin/sme-pitch/contests/new" className="btn-primary py-2.5 px-4 text-[11px] inline-flex">Create First Pitch Contest</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">Contest</th>
                  <th className="py-3 px-3">Edition</th>
                  <th className="py-3 px-3">Region</th>
                  <th className="py-3 px-3">Fee</th>
                  <th className="py-3 px-3">Applications</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contests.map((contest) => {
                  const count = applications.filter((app) => app.contestSlug === contest.slug).length;
                  return (
                    <tr key={contest.slug} className="border-t border-border text-foreground-muted">
                      <td className="py-3 px-3"><span className="font-medium text-foreground">{contest.title}</span><br /><span className="text-xs">{contest.slug}</span></td>
                      <td className="py-3 px-3">{contest.seasonOrEdition}</td>
                      <td className="py-3 px-3">{contest.regionScope}</td>
                      <td className="py-3 px-3">{contest.isPaid ? `NGN ${Number(contest.registrationFeeNgn || 0).toLocaleString('en-NG')}` : 'Free'}</td>
                      <td className="py-3 px-3">{count}</td>
                      <td className="py-3 px-3">
                        <div className="flex justify-end gap-2 flex-wrap">
                          <Link href={`/admin/sme-pitch/contests/${contest.slug}`} className="btn-outline py-1.5 px-2 text-[11px]">Manage</Link>
                          <Link href={`/admin/sme-pitch/contests/${contest.slug}/edit`} className="btn-outline py-1.5 px-2 text-[11px]">Edit</Link>
                          <Link href={`/admin/sme-pitch/contests/${contest.slug}/applications`} className="btn-outline py-1.5 px-2 text-[11px]">Applications</Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="glass-card rounded-md overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Recent SME Pitch Applications</h2>
        </div>
        {applications.length === 0 ? (
          <p className="p-4 text-sm text-foreground-muted">No SME Pitch applications yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">Reference</th>
                  <th className="py-3 px-3">Contest</th>
                  <th className="py-3 px-3">Applicant</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Payment</th>
                </tr>
              </thead>
              <tbody>
                {applications.slice(0, 10).map((app) => (
                  <tr key={app.id} className="border-t border-border text-foreground-muted">
                    <td className="py-2.5 px-3">{app.reference}</td>
                    <td className="py-2.5 px-3">{contestSlugs.has(app.contestSlug) ? app.contestSlug : String(app.formData['contest.title'] || app.contestSlug)}</td>
                    <td className="py-2.5 px-3">{String(app.formData['personal.firstName'] || app.formData['account.fullName'] || '-')}</td>
                    <td className="py-2.5 px-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(app.status)}`}>{app.status.replace(/_/g, ' ')}</span></td>
                    <td className="py-2.5 px-3">{String(app.formData['payment.paymentStatus'] || '-')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
