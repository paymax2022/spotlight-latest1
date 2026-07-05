import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/src/lib/auth/server';
import { getRegistrationContestBySlug, listRegistrationApplications } from '@/src/server/registration/store';

export const dynamic = 'force-dynamic';

function badgeClass(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('approved') || normalized.includes('submitted') || normalized.includes('shortlisted')) return 'badge-approved';
  if (normalized.includes('rejected') || normalized.includes('failed') || normalized.includes('disqualified')) return 'badge-rejected';
  if (normalized.includes('paid')) return 'badge-paid';
  return 'badge-pending';
}

export default async function SmePitchContestDetailPage({ params }: { params: { slug: string } }) {
  try {
    await requireAdmin();
  } catch {
    redirect(`/login?next=/admin/sme-pitch/contests/${params.slug}`);
  }

  const contest = getRegistrationContestBySlug(params.slug);
  if (!contest || contest.contestCategory !== 'sme_pitch') notFound();

  const applications = listRegistrationApplications({ contestSlug: contest.slug });
  const stats = {
    total: applications.length,
    submitted: applications.filter((app) => app.status !== 'draft').length,
    pending: applications.filter((app) => ['submitted', 'awaiting_payment', 'under_review'].includes(app.status)).length,
    shortlisted: applications.filter((app) => ['shortlisted', 'approved', 'selected_for_bootcamp'].includes(app.status)).length,
  };

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
            <Link href="/admin/sme-pitch">SME Pitch</Link>
            <span>/</span>
            <span>{contest.title}</span>
          </div>
          <h1 className="font-display text-3xl text-foreground">{contest.title}</h1>
          <p className="text-foreground-muted mt-1">{contest.seasonOrEdition} - {contest.regionScope} - {contest.isPaid ? `NGN ${Number(contest.registrationFeeNgn || 0).toLocaleString('en-NG')}` : 'Free registration'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/sme-pitch/contests/${contest.slug}/edit`} className="btn-primary py-2.5 px-4 text-[11px]">Edit Contest</Link>
          <Link href={`/admin/sme-pitch/contests/${contest.slug}/applications`} className="btn-outline py-2.5 px-4 text-[11px]">Manage Applications</Link>
          <Link href={`/register/${contest.slug}`} target="_blank" className="btn-outline py-2.5 px-4 text-[11px]">Public Registration</Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/50">Applications</p><p className="text-3xl font-bold text-foreground mt-1">{stats.total}</p></div>
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/50">Submitted</p><p className="text-3xl font-bold text-foreground mt-1">{stats.submitted}</p></div>
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/50">Pending Review</p><p className="text-3xl font-bold text-foreground mt-1">{stats.pending}</p></div>
        <div className="glass-card rounded-md p-4"><p className="text-xs text-foreground/50">Shortlisted</p><p className="text-3xl font-bold text-foreground mt-1">{stats.shortlisted}</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="glass-card rounded-md p-4">
          <h2 className="font-semibold text-foreground mb-3">Contest Configuration</h2>
          <dl className="space-y-2 text-sm text-foreground-muted">
            <div><dt className="text-xs text-foreground/40">Slug</dt><dd>{contest.slug}</dd></div>
            <div><dt className="text-xs text-foreground/40">Type</dt><dd>{contest.contestType.replace(/_/g, ' ')}</dd></div>
            <div><dt className="text-xs text-foreground/40">Locations</dt><dd>{contest.auditionStates?.join(', ') || 'Not configured'}</dd></div>
            <div><dt className="text-xs text-foreground/40">Applicant categories</dt><dd>{contest.applicantCategories?.join(', ') || 'Not configured'}</dd></div>
          </dl>
        </div>
        <div className="glass-card rounded-md p-4 lg:col-span-2">
          <h2 className="font-semibold text-foreground mb-3">Enabled Controls</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-foreground-muted">
            <p>Pitch scheduling: {contest.supportsAuditionScheduling ? 'Enabled' : 'Disabled'}</p>
            <p>Team entries: {contest.supportsGroupEntry ? 'Enabled' : 'Disabled'}</p>
            <p>Public voting: {contest.supportsVoting ? 'Enabled' : 'Disabled'}</p>
            <p>Pitch readiness: {contest.requiresBootcampReadiness ? 'Required' : 'Not required'}</p>
            <p>Guardian consent: {contest.requiresGuardianConsentForMinors ? 'Required' : 'Not required'}</p>
            <p>Medical disclosure: {contest.requiresMedical ? 'Required' : 'Not required'}</p>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-md overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="font-semibold text-foreground">Applications</h2>
          <Link href={`/admin/sme-pitch/contests/${contest.slug}/applications`} className="btn-outline py-1.5 px-3 text-[11px]">Open Application Manager</Link>
        </div>
        {applications.length === 0 ? (
          <p className="p-4 text-sm text-foreground-muted">No applications yet for this contest.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-bg-card"><tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]"><th className="py-3 px-3">Reference</th><th className="py-3 px-3">Applicant</th><th className="py-3 px-3">Status</th><th className="py-3 px-3">Payment</th><th className="py-3 px-3">Updated</th></tr></thead>
              <tbody>
                {applications.slice(0, 10).map((app) => (
                  <tr key={app.id} className="border-t border-border text-foreground-muted">
                    <td className="py-2.5 px-3">{app.reference}</td>
                    <td className="py-2.5 px-3">{String(app.formData['personal.firstName'] || app.formData['account.fullName'] || '-')}</td>
                    <td className="py-2.5 px-3"><span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(app.status)}`}>{app.status.replace(/_/g, ' ')}</span></td>
                    <td className="py-2.5 px-3">{String(app.formData['payment.paymentStatus'] || '-')}</td>
                    <td className="py-2.5 px-3">{new Date(app.updatedAt).toLocaleString('en-NG')}</td>
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
