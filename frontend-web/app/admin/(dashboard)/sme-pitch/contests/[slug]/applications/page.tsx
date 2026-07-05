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

export default async function SmePitchApplicationsPage({ params }: { params: { slug: string } }) {
  try {
    await requireAdmin();
  } catch {
    redirect(`/login?next=/admin/sme-pitch/contests/${params.slug}/applications`);
  }

  const contest = getRegistrationContestBySlug(params.slug);
  if (!contest || contest.contestCategory !== 'sme_pitch') notFound();

  const applications = listRegistrationApplications({ contestSlug: contest.slug });

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
        <Link href="/admin/sme-pitch">SME Pitch</Link>
        <span>/</span>
        <Link href={`/admin/sme-pitch/contests/${contest.slug}`}>{contest.title}</Link>
        <span>/</span>
        <span>Applications</span>
      </div>
      <h1 className="font-display text-3xl text-foreground">SME Pitch Applications</h1>
      <p className="text-foreground-muted mt-1 mb-4">{contest.title}</p>

      <div className="glass-card rounded-md overflow-hidden">
        {applications.length === 0 ? (
          <p className="p-6 text-sm text-foreground-muted">No applications yet for this SME Pitch contest.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">Reference</th>
                  <th className="py-3 px-3">Applicant</th>
                  <th className="py-3 px-3">Email</th>
                  <th className="py-3 px-3">Business / Pitch</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Payment</th>
                  <th className="py-3 px-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => (
                  <tr key={app.id} className="border-t border-border text-foreground-muted">
                    <td className="py-2.5 px-3">{app.reference}</td>
                    <td className="py-2.5 px-3">{String(app.formData['personal.firstName'] || app.formData['account.fullName'] || '-')}</td>
                    <td className="py-2.5 px-3">{String(app.formData['personal.email'] || app.formData['account.email'] || '-')}</td>
                    <td className="py-2.5 px-3">{String(app.formData['category.businessName'] || app.formData['category.pitchTitle'] || '-')}</td>
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
