import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireAdmin } from '@/src/lib/auth/server';
import { listRegistrationApplications } from '@/src/server/registration/supabase-store';
import { getPersistedContestBySlug } from '@/src/server/registration-v2/contest-store';
import { getRegistrationContestBySlug } from '@/src/server/registration/store';

export const dynamic = 'force-dynamic';

function badgeClass(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes('approved') || normalized.includes('submitted') || normalized.includes('shortlisted')) return 'badge-approved';
  if (normalized.includes('rejected') || normalized.includes('failed') || normalized.includes('disqualified')) return 'badge-rejected';
  if (normalized.includes('paid')) return 'badge-paid';
  return 'badge-pending';
}

function field(formData: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = formData?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
  }
  return '—';
}

/**
 * Applicants for any contest, addressed by slug.
 *
 * The per-category pages (sme-pitch, open-mic, …) each reimplemented this for
 * their own contests, so a contest created in /admin/contests had no applicant
 * view at all. Applications are read from the SUPABASE store — registrations
 * moved there, while contest definitions did not, so the two come from
 * different places on purpose.
 */
export default async function ContestApplicantsPage({ params }: { params: { slug: string } }) {
  try {
    await requireAdmin();
  } catch {
    redirect(`/login?next=/admin/contests/${params.slug}/applicants`);
  }

  // Postgres first; fall back to the in-memory catalog, which still holds the
  // code-defined contests that were never written to the database.
  const contest =
    (await getPersistedContestBySlug(params.slug)) ?? getRegistrationContestBySlug(params.slug);
  if (!contest) notFound();

  const applications = await listRegistrationApplications({ contestSlug: contest.slug });

  return (
    <section className="max-w-7xl mx-auto px-2 md:px-4 pb-6">
      <div className="flex items-center gap-2 text-xs text-foreground/40 mb-2">
        <Link href="/admin/contests">Contests</Link>
        <span>/</span>
        <span>{contest.title}</span>
        <span>/</span>
        <span>Applicants</span>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-3xl text-foreground">Applicants</h1>
          <p className="text-foreground-muted mt-1 mb-4">
            {contest.title} · {contest.seasonOrEdition || '—'} ·{' '}
            {contest.supportsAuditionScheduling
              ? `auditions in ${(contest.auditionStates || []).join(', ') || '—'}`
              : 'no auditions'}
          </p>
        </div>
        {'id' in contest && contest.id ? (
          <Link
            href={`/admin/voting/${contest.id}/settings`}
            className="text-[12px] underline underline-offset-2 hover:text-foreground mt-2"
          >
            Voting settings
          </Link>
        ) : null}
      </div>

      <div className="glass-card rounded-md overflow-hidden">
        {applications.length === 0 ? (
          <p className="p-6 text-sm text-foreground-muted">No applicants yet for this contest.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-bg-card">
                <tr className="text-left text-foreground-dim uppercase tracking-[0.1em] text-[10px]">
                  <th className="py-3 px-3">Reference</th>
                  <th className="py-3 px-3">Applicant</th>
                  <th className="py-3 px-3">Email</th>
                  <th className="py-3 px-3">Phone</th>
                  <th className="py-3 px-3">State</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3">Payment</th>
                  <th className="py-3 px-3">Updated</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((app) => {
                  const data = (app.formData ?? {}) as Record<string, unknown>;
                  return (
                    <tr key={app.id} className="border-t border-border text-foreground-muted">
                      <td className="py-2.5 px-3">{app.reference}</td>
                      <td className="py-2.5 px-3">{field(data, 'personal.firstName', 'account.fullName')}</td>
                      <td className="py-2.5 px-3">{field(data, 'personal.email', 'account.email')}</td>
                      <td className="py-2.5 px-3">{field(data, 'personal.phone', 'account.phone')}</td>
                      <td className="py-2.5 px-3">{field(data, 'personal.state', 'audition.state')}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[11px] font-semibold ${badgeClass(app.status)}`}>
                          {String(app.status).replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">{field(data, 'payment.paymentStatus')}</td>
                      <td className="py-2.5 px-3">
                        {app.updatedAt ? new Date(app.updatedAt).toLocaleString('en-NG') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
